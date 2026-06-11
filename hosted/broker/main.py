#!/usr/bin/env python3
"""gstack broker — Phase-2 hosted dispatcher.

Backed by Postgres (psycopg3) and Clerk JWT auth. Replaces the Phase-1
JSON store. Workers still authenticate with their long-lived `gw_xxx`
key; end-users authenticate with their Clerk session JWT.

Surface:

  HTTP  GET  /                       → SPA shell (gstack-web is the real frontend)
  HTTP  GET  /api/me                 → who am I + my user row + my workers
  HTTP  GET  /api/workers            → my online workers (admin: all)
  HTTP  POST /api/dispatch           → assign job to one of MY idle workers
  HTTP  POST /api/recall             → recall my (or specific) worker
  HTTP  GET  /api/assignments        → my dispatch history (admin: all)
  HTTP  POST /api/worker-keys        → mint a key OWNED BY ME (label in body)
  HTTP  GET  /api/worker-keys        → list keys OWNED BY ME (admin: all)
  HTTP  POST /api/worker-keys/revoke → revoke one of my keys (admin: any)
  HTTP  GET  /api/specialists        → my customised specialist list
  HTTP  PUT  /api/specialists/:id    → override description / voice / name
  HTTP  GET  /api/admin/users        → all users (admin only)
  HTTP  POST /api/admin/users/:id    → set user role (admin only)
  WS    /v1/workers/connect?key=gw_  → workers connect here

Env:
  DATABASE_URL                 postgresql://gstack:gstack@host/gstack
  CLERK_JWKS_URL               https://<instance>.clerk.accounts.dev/.well-known/jwks.json
  CLERK_ISSUER                 https://<instance>.clerk.accounts.dev
  GSTACK_POOL_AGENTCALL_KEY    centrally-funded AgentCall key (free tier pool)

If CLERK_JWKS_URL is unset the broker uses a dev fallback that reads
X-Dev-User-Id from the request. Useful for local docker-compose runs.

Run:
  pip install aiohttp websockets psycopg[binary] psycopg_pool PyJWT cryptography
  python3 broker/main.py --port 8787
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import secrets
import time
from collections import deque
from typing import Optional

from aiohttp import web, WSMsgType

# Support both `python -m broker.main` and `python broker/main.py`.
try:
    from . import db, auth                       # type: ignore
except ImportError:
    import sys as _sys
    from pathlib import Path as _Path
    _sys.path.insert(0, str(_Path(__file__).resolve().parent))
    import db, auth                              # type: ignore


TRANSIENT_AGENTCALL_KEY = os.environ.get("GSTACK_POOL_AGENTCALL_KEY", "")

# Comma-separated list of origins allowed to call /api/*. In production
# this should be the gstack-web Vercel URL. Empty = mirror request origin
# (dev-friendly, opens CORS to anyone — fine for local docker-compose).
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("GSTACK_ALLOWED_ORIGINS", "").split(",") if o.strip()]


# ──────────────────────────────────────────────────────────────────────────
# in-memory worker registry (live WS connections)

class Worker:
    def __init__(self, ws: web.WebSocketResponse, key_hash: str,
                 owner_user_id: str) -> None:
        self.ws = ws
        self.key_hash = key_hash
        self.owner_user_id = owner_user_id
        self.id = secrets.token_hex(6)
        self.name = "unnamed"
        self.platform = ""
        self.state = "idle"
        self.connected_at = time.time()
        self.last_assignment_id: Optional[str] = None
        self.last_assignment_at: Optional[float] = None

    def to_json(self) -> dict:
        return {
            "id":                  self.id,
            "owner_user_id":       self.owner_user_id,
            "name":                self.name,
            "platform":            self.platform,
            "state":               self.state,
            "connected_at":        self.connected_at,
            "last_assignment_id":  self.last_assignment_id,
            "last_assignment_at":  self.last_assignment_at,
        }


WORKERS: dict[str, Worker] = {}


# ──────────────────────────────────────────────────────────────────────────
# in-memory live-call state (Phase 3)
#
# TRANSCRIPTS — per-assignment ring buffer of meeting events forwarded by
# the worker (user utterances from the bus inbox, bot replies from the
# outbox). Ephemeral by design: survives for the dashboard's live view,
# evicted FIFO after MAX_TRANSCRIPT_ASSIGNMENTS calls. The durable
# artifact is the post-call summary, which lands in Postgres.
#
# PROGRESS — per-assignment dispatch stage for the stepper UI
# (accepted → launching → started → joined). Worker-reported.
#
# QUEUE — FIFO of dispatches that arrived while no brain was idle.
# Mirrored in the DB (status='queued') so a broker restart reloads it.

TRANSCRIPTS: dict[str, deque] = {}
TRANSCRIPT_SEQ: dict[str, int] = {}
PROGRESS: dict[str, dict] = {}
MAX_TRANSCRIPT_ASSIGNMENTS = 60

QUEUE: list[dict] = []          # {id,user_id,meet_url,specialists,brief,mode,created_ts}
QUEUE_TTL_SEC = 600             # 10 min in line, then auto-cancel


def append_transcript(aid: str, entry: dict) -> None:
    if aid not in TRANSCRIPTS:
        while len(TRANSCRIPTS) >= MAX_TRANSCRIPT_ASSIGNMENTS:
            oldest = next(iter(TRANSCRIPTS))
            TRANSCRIPTS.pop(oldest, None)
            TRANSCRIPT_SEQ.pop(oldest, None)
        TRANSCRIPTS[aid] = deque(maxlen=400)
    seq = TRANSCRIPT_SEQ.get(aid, 0) + 1
    TRANSCRIPT_SEQ[aid] = seq
    entry["seq"] = seq
    TRANSCRIPTS[aid].append(entry)


def queue_position(aid: str) -> Optional[int]:
    for i, item in enumerate(QUEUE):
        if item["id"] == aid:
            return i + 1
    return None


def _assignment_msg(aid: str, meet_url: str, specs: list, brief: str, mode: str,
                    max_duration_min: int = 30) -> dict:
    return {
        "type":              "assignment",
        "id":                aid,
        "meetUrl":           meet_url,
        "specialists":       specs,
        "brief":             brief,
        "mode":              mode,
        "agentcall_api_key": TRANSIENT_AGENTCALL_KEY,
        "end_at":            time.time() + max_duration_min * 60,
    }


async def expire_stale_queued() -> None:
    now = time.time()
    for item in list(QUEUE):
        if now - item["created_ts"] > QUEUE_TTL_SEC:
            QUEUE.remove(item)
            try:
                await db.update_assignment_status(
                    item["id"], "cancelled", {"reason": "queue_expired"})
            except Exception as e:
                print(f"[queue] expire failed for {item['id']}: {e}", flush=True)


async def try_dispatch_queued() -> None:
    """Called whenever a brain frees up (state→idle) or connects. Walks the
    queue oldest-first and places every item a now-idle worker can take."""
    await expire_stale_queued()
    if not QUEUE:
        return
    users = {u["id"]: u for u in await db.list_users()}
    admin_user_ids = {uid for uid, u in users.items() if u.get("role") == "admin"}
    for item in list(QUEUE):
        urow = users.get(item["user_id"])
        is_admin = bool(urow and urow.get("role") == "admin")
        worker = pick_idle_worker_for(item["user_id"], is_admin, admin_user_ids)
        if worker is None:
            continue
        msg = _assignment_msg(item["id"], item["meet_url"], item["specialists"],
                              item["brief"], item["mode"])
        try:
            await worker.ws.send_str(json.dumps(msg))
        except Exception as e:
            print(f"[queue] send to {worker.id} failed: {e}", flush=True)
            continue
        worker.state = "busy"
        worker.last_assignment_id = item["id"]
        worker.last_assignment_at = time.time()
        QUEUE.remove(item)
        PROGRESS[item["id"]] = {"stage": "accepted", "joined": [], "ts": time.time()}
        await db.mark_dispatched(item["id"], worker.id, worker.key_hash)
        await db.audit(item["user_id"], "dispatch.dequeued",
                       {"assignment_id": item["id"], "worker_id": worker.id,
                        "waited_s": int(time.time() - item["created_ts"])})


def _hash_key(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def pick_idle_worker_for(user_id: str, is_admin: bool,
                         admin_user_ids: set[str]) -> Optional[Worker]:
    """Pick an idle brain for a dispatch.

    Routing rules:
      - Admin: prefer their own idle brain, fall back to ANY idle brain
        in the system (a "pool admin" can borrow another admin's brain
        if their own pool is dry).
      - Member: dispatch against any admin-owned idle brain (the shared
        demo pool). Their own brains, if any (e.g. via /byob), are tried
        first because they probably want to drive them; if none online,
        fall back to the admin pool.

    This is the heart of the "members don't need their own worker" UX:
    one admin runs a few brains on their laptop and every signed-in
    member can dispatch against that pool.
    """
    own = [w for w in WORKERS.values() if w.state == "idle" and w.owner_user_id == user_id]
    own.sort(key=lambda w: w.last_assignment_at or 0)
    if own:
        return own[0]
    if is_admin:
        any_idle = [w for w in WORKERS.values() if w.state == "idle"]
    else:
        any_idle = [w for w in WORKERS.values()
                    if w.state == "idle" and w.owner_user_id in admin_user_ids]
    if not any_idle:
        return None
    any_idle.sort(key=lambda w: w.last_assignment_at or 0)
    return any_idle[0]


# ──────────────────────────────────────────────────────────────────────────
# helper: ensure the user row exists for whoever's making this request

async def _ensure_user(req: web.Request) -> Optional[dict]:
    ident = req.get("user")
    if not ident or not ident.get("user_id"):
        return None
    return await db.upsert_user(ident["user_id"], ident.get("email"), ident.get("name"))


# ──────────────────────────────────────────────────────────────────────────
# HTTP routes

async def me(req: web.Request) -> web.Response:
    user_row = await _ensure_user(req)
    if user_row is None:
        return web.json_response({"error": "unauthorized"}, status=401)
    mine = [w.to_json() for w in WORKERS.values() if w.owner_user_id == user_row["id"]]
    return web.json_response({"user": _user_safe(user_row), "online_workers": mine})


async def list_workers(req: web.Request) -> web.Response:
    user_row = await _ensure_user(req)
    if user_row is None:
        return web.json_response({"error": "unauthorized"}, status=401)
    is_admin = user_row["role"] == "admin"
    workers = [w.to_json() for w in WORKERS.values()
               if is_admin or w.owner_user_id == user_row["id"]]
    return web.json_response({"workers": workers})


async def dispatch(req: web.Request) -> web.Response:
    user_row = await _ensure_user(req)
    if user_row is None:
        return web.json_response({"error": "unauthorized"}, status=401)
    try:
        body = await req.json()
    except Exception:
        return web.json_response({"error": "bad json"}, status=400)

    meet_url = (body.get("meetUrl") or "").strip()
    specs    = body.get("specialists") or []
    if not meet_url or not specs:
        return web.json_response({"error": "meetUrl and specialists[] required"}, status=400)

    # Quota check.
    if user_row["minutes_used"] >= user_row["quota_minutes"]:
        return web.json_response({"error": "quota exhausted",
                                  "minutes_used": user_row["minutes_used"],
                                  "quota_minutes": user_row["quota_minutes"]}, status=429)

    is_admin = user_row["role"] == "admin"
    # Resolve the set of admins so members can route to their brains.
    admin_user_ids = {u["id"] for u in await db.list_users() if u.get("role") == "admin"}
    worker = pick_idle_worker_for(user_row["id"], is_admin, admin_user_ids)

    aid   = f"a-{int(time.time()*1000)}-{secrets.token_hex(3)}"
    brief = body.get("brief", "")
    mode  = body.get("mode", "avatar")

    if worker is None:
        # No brain free → hold the dispatch in the queue instead of
        # bouncing the user with a 503. The assignment row is created
        # with status='queued' (dispatched_at NULL); try_dispatch_queued
        # fires it the moment a brain goes idle or connects. 10-min TTL.
        await db.insert_assignment(
            aid, user_row["id"], None, None, meet_url, specs, brief, mode,
            status="queued",
        )
        QUEUE.append({
            "id": aid, "user_id": user_row["id"], "meet_url": meet_url,
            "specialists": specs, "brief": brief, "mode": mode,
            "created_ts": time.time(),
        })
        await db.audit(user_row["id"], "dispatch.queued",
                       {"assignment_id": aid, "position": len(QUEUE)})
        return web.json_response(
            {"ok": True, "queued": True, "assignment_id": aid,
             "position": len(QUEUE)},
            status=202,
        )

    msg = _assignment_msg(aid, meet_url, specs, brief, mode,
                          int(body.get("max_duration_min", 30)))
    try:
        await worker.ws.send_str(json.dumps(msg))
    except Exception as e:
        return web.json_response({"error": f"worker send failed: {e}"}, status=502)

    worker.state = "busy"
    worker.last_assignment_id = aid
    worker.last_assignment_at = time.time()
    PROGRESS[aid] = {"stage": "accepted", "joined": [], "ts": time.time()}

    await db.insert_assignment(
        aid, user_row["id"], worker.id, worker.key_hash,
        meet_url, specs, brief, mode,
    )
    await db.audit(user_row["id"], "dispatch",
                   {"assignment_id": aid, "worker_id": worker.id, "meet_url": meet_url})

    return web.json_response({"ok": True, "assignment_id": aid, "worker_id": worker.id})


async def recall(req: web.Request) -> web.Response:
    user_row = await _ensure_user(req)
    if user_row is None:
        return web.json_response({"error": "unauthorized"}, status=401)
    try:
        body = await req.json()
    except Exception:
        body = {}
    is_admin = user_row["role"] == "admin"
    target_worker = body.get("worker_id")
    targets = [w for w in WORKERS.values()
               if w.state == "busy"
               and (is_admin or w.owner_user_id == user_row["id"])
               and (not target_worker or w.id == target_worker)]
    if not targets:
        return web.json_response({"ok": True, "recalled": 0})
    msg = json.dumps({"type": "recall", "id": body.get("assignment_id", "*")})
    sent = 0
    for w in targets:
        try:
            await w.ws.send_str(msg)
            sent += 1
        except Exception:
            pass
        # Optimistically mark the in-flight assignment ended NOW, instead
        # of waiting for the worker's state=idle ack. If the ack arrives
        # we'll re-update (idempotent). If it never arrives (worker
        # crashed mid-recall, WS write failed, etc.) the dashboard
        # still clears immediately — no orphan.
        if w.last_assignment_id:
            try:
                await db.update_assignment_status(
                    w.last_assignment_id, "ended", {"reason": "recalled"},
                )
            except Exception as e:
                print(f"[recall] cleanup failed for {w.id}: {e}", flush=True)
    await db.audit(user_row["id"], "recall", {"count": sent})
    return web.json_response({"ok": True, "recalled": sent})


async def list_assignments(req: web.Request) -> web.Response:
    user_row = await _ensure_user(req)
    if user_row is None:
        return web.json_response({"error": "unauthorized"}, status=401)
    is_admin = user_row["role"] == "admin"
    rows = await db.list_assignments(user_id=None if is_admin else user_row["id"], limit=100)

    # Self-heal sweep: if a row says 'started' but the worker isn't
    # actually mid-call right now (disconnected entirely, or connected
    # but idle, or busy on a DIFFERENT assignment), it's an orphan from
    # a past crash/disconnect. Clear it in-place so the dashboard's live
    # call card disappears the moment the cleanup-on-disconnect path
    # missed something — or on cold-start after a broker redeploy when
    # WORKERS is empty but the DB remembers old started rows.
    for r in rows:
        if r.get("status") != "started":
            continue
        wid = r.get("worker_id")
        live = WORKERS.get(wid) if wid else None
        is_in_flight = (
            live is not None
            and live.state == "busy"
            and live.last_assignment_id == r["id"]
        )
        if not is_in_flight:
            try:
                await db.update_assignment_status(
                    r["id"], "ended", {"reason": "orphan_swept"},
                )
                r["status"] = "ended"
            except Exception as e:
                print(f"[sweep] failed for {r.get('id')}: {e}", flush=True)

    # Lazy queue TTL sweep — keeps positions honest even if no worker
    # ever connects to trigger try_dispatch_queued.
    await expire_stale_queued()

    out = []
    for r in rows:
        item = _assignment_safe(r)
        if r["status"] == "queued":
            item["queue_position"] = queue_position(r["id"])
        prog = PROGRESS.get(r["id"])
        if prog:
            item["progress"] = {"stage": prog["stage"], "joined": prog["joined"]}
        out.append(item)
    return web.json_response({"assignments": out})


async def get_transcript(req: web.Request) -> web.Response:
    """Live transcript for one assignment. Poll with ?since=<seq> to get
    only new entries. Also carries progress + summary so the dashboard's
    call card needs exactly one poll loop."""
    user_row = await _ensure_user(req)
    if user_row is None:
        return web.json_response({"error": "unauthorized"}, status=401)
    aid = req.match_info["aid"]
    row = await db.get_assignment(aid)
    if row is None:
        return web.json_response({"error": "not_found"}, status=404)
    if row["user_id"] != user_row["id"] and user_row["role"] != "admin":
        return web.json_response({"error": "forbidden"}, status=403)
    try:
        since = int(req.query.get("since", "0"))
    except ValueError:
        since = 0
    entries = [e for e in TRANSCRIPTS.get(aid, []) if e["seq"] > since]
    prog = PROGRESS.get(aid) or {}
    return web.json_response({
        "entries": entries,
        "stage":   prog.get("stage"),
        "joined":  prog.get("joined", []),
        "status":  row["status"],
        "summary": row.get("summary"),
    })


async def say_in_call(req: web.Request) -> web.Response:
    """Relay a dashboard-typed message into the live meeting. The worker
    appends it to the intelligence-bus inbox as a synthetic user.message,
    so the brain replies through the normal turn-taking path and the bot
    speaks the answer in the room."""
    user_row = await _ensure_user(req)
    if user_row is None:
        return web.json_response({"error": "unauthorized"}, status=401)
    aid = req.match_info["aid"]
    row = await db.get_assignment(aid)
    if row is None:
        return web.json_response({"error": "not_found"}, status=404)
    if row["user_id"] != user_row["id"] and user_row["role"] != "admin":
        return web.json_response({"error": "forbidden"}, status=403)
    try:
        body = await req.json()
    except Exception:
        body = {}
    text = (body.get("text") or "").strip()[:500]
    if not text:
        return web.json_response({"error": "text required"}, status=400)
    worker = next((w for w in WORKERS.values()
                   if w.last_assignment_id == aid and w.state == "busy"), None)
    if worker is None:
        return web.json_response({"error": "call_not_active"}, status=409)
    sender = (user_row.get("display_name")
              or (user_row.get("email") or "").split("@")[0]
              or "dashboard")
    try:
        await worker.ws.send_str(json.dumps(
            {"type": "say", "id": aid, "text": text, "from": sender}))
    except Exception as e:
        return web.json_response({"error": f"worker send failed: {e}"}, status=502)
    await db.audit(user_row["id"], "say", {"assignment_id": aid, "chars": len(text)})
    return web.json_response({"ok": True})


async def cancel_assignment(req: web.Request) -> web.Response:
    """Cancel a QUEUED dispatch (started calls end via /api/recall)."""
    user_row = await _ensure_user(req)
    if user_row is None:
        return web.json_response({"error": "unauthorized"}, status=401)
    aid = req.match_info["aid"]
    row = await db.get_assignment(aid)
    if row is None:
        return web.json_response({"error": "not_found"}, status=404)
    if row["user_id"] != user_row["id"] and user_row["role"] != "admin":
        return web.json_response({"error": "forbidden"}, status=403)
    if row["status"] != "queued":
        return web.json_response({"error": "not_queued", "status": row["status"]}, status=409)
    QUEUE[:] = [q for q in QUEUE if q["id"] != aid]
    await db.update_assignment_status(aid, "cancelled", {"reason": "user_cancelled"})
    await db.audit(user_row["id"], "dispatch.cancelled", {"assignment_id": aid})
    return web.json_response({"ok": True})


async def mint_worker_key(req: web.Request) -> web.Response:
    user_row = await _ensure_user(req)
    if user_row is None:
        return web.json_response({"error": "unauthorized"}, status=401)
    try:
        body = await req.json()
    except Exception:
        body = {}
    label = (body.get("label") or "unnamed").strip()[:80]
    plaintext = "gw_" + secrets.token_urlsafe(24)
    await db.insert_worker_key(_hash_key(plaintext), user_row["id"], label)
    await db.audit(user_row["id"], "worker_key.mint", {"label": label})
    return web.json_response({"worker_key": plaintext, "label": label})


async def list_my_worker_keys(req: web.Request) -> web.Response:
    user_row = await _ensure_user(req)
    if user_row is None:
        return web.json_response({"error": "unauthorized"}, status=401)
    is_admin = user_row["role"] == "admin"
    rows = await db.list_worker_keys(owner_user_id=None if is_admin else user_row["id"])
    return web.json_response({"keys": [_key_safe(r) for r in rows]})


async def revoke_my_worker_key(req: web.Request) -> web.Response:
    user_row = await _ensure_user(req)
    if user_row is None:
        return web.json_response({"error": "unauthorized"}, status=401)
    try:
        body = await req.json()
    except Exception:
        body = {}
    raw = body.get("key") or body.get("key_hash") or ""
    is_admin = user_row["role"] == "admin"
    # Resolve the input to a worker_keys row by one of:
    #   - plaintext gw_ key (hash, then exact lookup)
    #   - full 64-char sha256 hash
    #   - 8+ char hash prefix (the UI only ever sees a 12-char prefix;
    #     it can't echo the full hash back without us exposing it)
    if raw.startswith("gw_"):
        row = await db.get_worker_key(_hash_key(raw))
    elif len(raw) == 64:
        row = await db.get_worker_key(raw)
    else:
        # Scope the prefix lookup to the caller's keys unless admin, so a
        # member can't probe other users' keys by trying prefixes.
        row = await db.find_worker_key_by_prefix(
            raw, owner_user_id=None if is_admin else user_row["id"])
    if not row:
        return web.json_response({"error": "unknown or ambiguous key"}, status=404)
    h = row["key_hash"]
    if not is_admin and row["owner_user_id"] != user_row["id"]:
        return web.json_response({"error": "forbidden"}, status=403)
    await db.revoke_worker_key(h)
    # Boot any live worker using this key.
    booted = 0
    for w in list(WORKERS.values()):
        if w.key_hash == h:
            try:
                await w.ws.close(code=4001, message=b"key revoked")
                booted += 1
            except Exception:
                pass
    await db.audit(user_row["id"], "worker_key.revoke", {"key_hash": h[:12], "booted": booted})
    return web.json_response({"ok": True, "booted": booted})


async def get_specialists(req: web.Request) -> web.Response:
    """Return the canonical specialist list with the caller's overrides applied."""
    user_row = await _ensure_user(req)
    if user_row is None:
        return web.json_response({"error": "unauthorized"}, status=401)
    base = _load_specialists_data()
    overrides = await db.get_overrides(user_row["id"])
    merged = []
    for spec in base:
        ov = overrides.get(spec["id"], {})
        merged.append({**spec, **ov, "id": spec["id"]})
    return web.json_response({"specialists": merged})


async def put_specialist_override(req: web.Request) -> web.Response:
    user_row = await _ensure_user(req)
    if user_row is None:
        return web.json_response({"error": "unauthorized"}, status=401)
    sid = req.match_info["sid"]
    base_ids = {s["id"] for s in _load_specialists_data()}
    if sid not in base_ids:
        return web.json_response({"error": "unknown specialist"}, status=404)
    try:
        body = await req.json()
    except Exception:
        body = {}
    await db.upsert_override(
        user_row["id"], sid,
        description=body.get("description"),
        voice=body.get("voice"),
        name=body.get("name"),
    )
    return web.json_response({"ok": True})


async def admin_users(req: web.Request) -> web.Response:
    user_row = await _ensure_user(req)
    if user_row is None or user_row["role"] != "admin":
        return web.json_response({"error": "forbidden"}, status=403)
    users = await db.list_users()
    return web.json_response({"users": [_user_safe(u) for u in users]})


async def admin_set_role(req: web.Request) -> web.Response:
    user_row = await _ensure_user(req)
    if user_row is None or user_row["role"] != "admin":
        return web.json_response({"error": "forbidden"}, status=403)
    target = req.match_info["uid"]
    try:
        body = await req.json()
    except Exception:
        body = {}
    role = body.get("role", "")
    if role not in ("admin", "member"):
        return web.json_response({"error": "bad role"}, status=400)
    await db.set_user_role(target, role)
    await db.audit(user_row["id"], "user.set_role", {"target": target, "role": role})
    return web.json_response({"ok": True})


# ──────────────────────────────────────────────────────────────────────────
# WS endpoint for workers

async def worker_ws(req: web.Request) -> web.WebSocketResponse:
    key = req.query.get("key", "")
    if not key.startswith("gw_"):
        return web.json_response({"error": "bad key format"}, status=400)

    h = _hash_key(key)
    row = await db.get_worker_key(h)
    if not row or row["revoked"]:
        return web.json_response({"error": "unknown or revoked key"}, status=401)
    owner = row["owner_user_id"]
    await db.touch_worker_key(h)

    ws = web.WebSocketResponse(heartbeat=25)
    await ws.prepare(req)

    worker = Worker(ws, h, owner)
    WORKERS[worker.id] = worker
    await ws.send_str(json.dumps({"type": "hello", "worker_id": worker.id}))
    await db.audit(owner, "worker.connected", {"worker_id": worker.id, "label": row["label"]})

    try:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                try:
                    obj = json.loads(msg.data)
                except Exception:
                    continue
                t = obj.get("type")
                if t == "hello":
                    worker.name = (obj.get("name") or "")[:80]
                    worker.platform = (obj.get("platform") or "")[:80]
                    # A brain just came online — see if anyone's in line.
                    asyncio.create_task(try_dispatch_queued())
                elif t == "state":
                    new_state = obj.get("state", "idle")
                    if new_state == "idle" and worker.state == "busy" and worker.last_assignment_id:
                        await db.update_assignment_status(worker.last_assignment_id, "ended",
                                                          obj.get("detail"))
                        PROGRESS.pop(worker.last_assignment_id, None)
                    worker.state = new_state
                    if new_state == "idle":
                        asyncio.create_task(try_dispatch_queued())
                elif t == "status":
                    aid = obj.get("id")
                    event = obj.get("event")
                    if aid and event in ("started", "ended", "failed", "rejected"):
                        await db.update_assignment_status(aid, event, obj.get("detail"))
                        if event in ("ended", "failed", "rejected"):
                            PROGRESS.pop(aid, None)
                elif t == "transcript":
                    # {"type":"transcript","id":aid,"entry":{kind,speaker,specialist_id,text,ts}}
                    aid = obj.get("id")
                    entry = obj.get("entry") or {}
                    if aid and isinstance(entry, dict) and entry.get("text"):
                        append_transcript(aid, {
                            "kind":          entry.get("kind", "bot"),
                            "speaker":       str(entry.get("speaker") or "")[:80],
                            "specialist_id": str(entry.get("specialist_id") or "")[:60],
                            "text":          str(entry.get("text"))[:2000],
                            "ts":            float(entry.get("ts") or time.time()),
                        })
                elif t == "progress":
                    # {"type":"progress","id":aid,"stage":"accepted|launching|joined:<spec_id>"}
                    aid = obj.get("id")
                    stage = str(obj.get("stage") or "")[:60]
                    if aid and stage:
                        p = PROGRESS.setdefault(aid, {"stage": "", "joined": [], "ts": 0.0})
                        if stage.startswith("joined:"):
                            sid = stage.split(":", 1)[1]
                            if sid and sid not in p["joined"]:
                                p["joined"].append(sid)
                            p["stage"] = "joined"
                        else:
                            p["stage"] = stage
                        p["ts"] = time.time()
                elif t == "summary":
                    # {"type":"summary","id":aid,"summary":"...markdown..."}
                    aid = obj.get("id")
                    s = obj.get("summary")
                    if aid and isinstance(s, str) and s.strip():
                        await db.set_assignment_summary(aid, s.strip())
                elif t == "pong":
                    pass
                else:
                    print(f"[worker {worker.id}] msg: {obj}", flush=True)
            elif msg.type == WSMsgType.ERROR:
                break
    finally:
        # If the worker drops while still mid-assignment (network blip,
        # laptop sleep, runner crash, bridge OOM), the broker would
        # otherwise leak a status='started' row in the DB forever — the
        # dashboard's "Now in meeting" card would keep showing a phantom
        # call with an ever-growing elapsed timer. Mark any open
        # assignment ended on the way out so the orphan never appears.
        if worker.state == "busy" and worker.last_assignment_id:
            try:
                await db.update_assignment_status(
                    worker.last_assignment_id, "ended",
                    {"reason": "worker_disconnected"},
                )
            except Exception as e:
                print(f"[worker {worker.id}] cleanup failed: {e}", flush=True)
        WORKERS.pop(worker.id, None)
        await db.audit(owner, "worker.disconnected", {"worker_id": worker.id})
    return ws


# ──────────────────────────────────────────────────────────────────────────
# tiny helpers / serialisers

def _user_safe(row: dict) -> dict:
    return {
        "id":            row["id"],
        "email":         row.get("email"),
        "display_name":  row.get("display_name"),
        "role":          row["role"],
        "plan":          row["plan"],
        "quota_minutes": row["quota_minutes"],
        "minutes_used":  row["minutes_used"],
    }


def _key_safe(row: dict) -> dict:
    return {
        "key_hash_prefix": row["key_hash"][:12] + "…",
        "owner_user_id":   row["owner_user_id"],
        "label":           row["label"],
        "created_at":      row["created_at"].isoformat() if row.get("created_at") else None,
        "last_seen_at":    row["last_seen_at"].isoformat() if row.get("last_seen_at") else None,
        "revoked":         row["revoked"],
    }


def _assignment_safe(row: dict) -> dict:
    return {
        "id":               row["id"],
        "user_id":          row["user_id"],
        "worker_id":        row["worker_id"],
        "meet_url":         row["meet_url"],
        "specialists":      row["specialists"],
        "brief":            row.get("brief"),
        "mode":             row["mode"],
        "status":           row["status"],
        "detail":           row.get("detail"),
        "created_at":       row["created_at"].isoformat() if row.get("created_at") else None,
        "started_at":       row["started_at"].isoformat() if row.get("started_at") else None,
        "dispatched_at":    row["dispatched_at"].isoformat() if row.get("dispatched_at") else None,
        "ended_at":         row["ended_at"].isoformat() if row.get("ended_at") else None,
        "billable_seconds": row.get("billable_seconds"),
        "summary":          row.get("summary"),
    }


_SPECIALISTS_CACHE: list[dict] = []
def _load_specialists_data() -> list[dict]:
    """Load data/specialists.json once and cache for the process lifetime.

    The broker now lives at <repo>/hosted/broker/. The canonical data
    file lives at <repo>/data/specialists.json. We try a few layouts so
    the same code works for: a repo checkout (hosted/broker/main.py →
    ../../data/), a docker image (data/ copied next to broker/), and
    edge cases where someone moves things around."""
    global _SPECIALISTS_CACHE
    if _SPECIALISTS_CACHE:
        return _SPECIALISTS_CACHE
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(here, "..", "..", "data", "specialists.json"),  # repo checkout
        os.path.join(here, "..",       "data", "specialists.json"),  # broker_dir/../data
        os.path.join(here,             "data", "specialists.json"),  # docker (data next to broker)
    ]
    for path in candidates:
        if os.path.isfile(path):
            try:
                with open(path, encoding="utf-8") as f:
                    _SPECIALISTS_CACHE = json.load(f)
                break
            except Exception:
                pass
    return _SPECIALISTS_CACHE


# ──────────────────────────────────────────────────────────────────────────

async def on_startup(app: web.Application) -> None:
    await db.run_migrations()
    # Reload the dispatch queue from the DB — a broker redeploy must not
    # silently drop people who were waiting in line.
    try:
        for row in await db.list_queued_assignments():
            QUEUE.append({
                "id":          row["id"],
                "user_id":     row["user_id"],
                "meet_url":    row["meet_url"],
                "specialists": row["specialists"],
                "brief":       row.get("brief") or "",
                "mode":        row.get("mode") or "avatar",
                "created_ts":  row["created_at"].timestamp() if row.get("created_at") else time.time(),
            })
        if QUEUE:
            print(f"[broker] reloaded {len(QUEUE)} queued dispatch(es)", flush=True)
    except Exception as e:
        print(f"[broker] queue reload failed: {e}", flush=True)
    print("[broker] db ready", flush=True)


async def on_cleanup(app: web.Application) -> None:
    await db.close_pool()


@web.middleware
async def cors_middleware(req: web.Request, handler):
    if req.method == "OPTIONS":
        return _cors_preflight(req)
    resp = await handler(req)
    _add_cors(resp, req)
    return resp


def _add_cors(resp: web.StreamResponse, req: web.Request) -> None:
    origin = req.headers.get("origin", "")
    if ALLOWED_ORIGINS:
        # Production: only echo the request origin if it's on the allow-list.
        # Reject silently (no ACAO header) for unknown origins — the browser
        # blocks the response, exactly what we want.
        if origin in ALLOWED_ORIGINS:
            resp.headers["Access-Control-Allow-Origin"] = origin
    else:
        # Dev: mirror whatever origin the request came from (or "*" if absent).
        resp.headers["Access-Control-Allow-Origin"] = origin or "*"
    resp.headers["Access-Control-Allow-Credentials"] = "true"
    resp.headers["Access-Control-Allow-Headers"]     = "authorization, content-type, x-dev-user-id"
    resp.headers["Access-Control-Allow-Methods"]     = "GET, POST, PUT, DELETE, OPTIONS"
    resp.headers["Vary"]                             = "Origin"


def _cors_preflight(req: web.Request) -> web.Response:
    resp = web.Response(status=204)
    _add_cors(resp, req)
    return resp


async def healthz(req: web.Request) -> web.Response:
    """Liveness probe — no auth, no DB. 200 means the process is up."""
    return web.json_response({"ok": True})


async def readyz(req: web.Request) -> web.Response:
    """Readiness probe — also checks the DB is reachable."""
    try:
        pool = await db.init_pool()
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute("SELECT 1")
                await cur.fetchone()
        return web.json_response({"ok": True, "db": "ready"})
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=503)


def build_app() -> web.Application:
    app = web.Application(middlewares=[cors_middleware, auth.auth_middleware])
    app.router.add_get("/healthz", healthz)
    app.router.add_get("/readyz", readyz)
    app.router.add_get("/api/me", me)
    app.router.add_get("/api/workers", list_workers)
    app.router.add_post("/api/dispatch", dispatch)
    app.router.add_post("/api/recall", recall)
    app.router.add_get("/api/assignments", list_assignments)
    app.router.add_get("/api/assignments/{aid}/transcript", get_transcript)
    app.router.add_post("/api/assignments/{aid}/say", say_in_call)
    app.router.add_post("/api/assignments/{aid}/cancel", cancel_assignment)
    app.router.add_post("/api/worker-keys", mint_worker_key)
    app.router.add_get("/api/worker-keys", list_my_worker_keys)
    app.router.add_post("/api/worker-keys/revoke", revoke_my_worker_key)
    app.router.add_get("/api/specialists", get_specialists)
    app.router.add_put("/api/specialists/{sid}", put_specialist_override)
    app.router.add_get("/api/admin/users", admin_users)
    app.router.add_post("/api/admin/users/{uid}/role", admin_set_role)
    app.router.add_get("/v1/workers/connect", worker_ws)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="gstack broker (Phase 2)")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()
    print(f"[broker] db={db.DSN}", flush=True)
    print(f"[broker] clerk={'configured' if auth.CLERK_JWKS_URL else 'DEV-FALLBACK (X-Dev-User-Id)'}",
          flush=True)
    if not TRANSIENT_AGENTCALL_KEY:
        print("[broker] WARNING: GSTACK_POOL_AGENTCALL_KEY not set — dispatched bots will lack an API key",
              flush=True)
    web.run_app(build_app(), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
