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


def _hash_key(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def pick_idle_worker_for(user_id: str, is_admin: bool) -> Optional[Worker]:
    """Pick an idle worker the user owns. Admins can use any idle worker
    (the implicit pool)."""
    pool = [w for w in WORKERS.values() if w.state == "idle"
            and (is_admin or w.owner_user_id == user_id)]
    if not pool:
        return None
    pool.sort(key=lambda w: w.last_assignment_at or 0)
    return pool[0]


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
    worker = pick_idle_worker_for(user_row["id"], is_admin)
    if worker is None:
        return web.json_response({"error": "no idle worker for this account",
                                  "hint": "start a worker.py with one of your gw_ keys"},
                                 status=503)

    aid = f"a-{int(time.time()*1000)}-{secrets.token_hex(3)}"
    msg = {
        "type":              "assignment",
        "id":                aid,
        "meetUrl":           meet_url,
        "specialists":       specs,
        "brief":             body.get("brief", ""),
        "mode":              body.get("mode", "avatar"),
        "agentcall_api_key": TRANSIENT_AGENTCALL_KEY,
        "end_at":            time.time() + (int(body.get("max_duration_min", 30)) * 60),
    }
    try:
        await worker.ws.send_str(json.dumps(msg))
    except Exception as e:
        return web.json_response({"error": f"worker send failed: {e}"}, status=502)

    worker.state = "busy"
    worker.last_assignment_id = aid
    worker.last_assignment_at = time.time()

    await db.insert_assignment(
        aid, user_row["id"], worker.id, worker.key_hash,
        meet_url, specs, body.get("brief", ""), body.get("mode", "avatar"),
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
    await db.audit(user_row["id"], "recall", {"count": sent})
    return web.json_response({"ok": True, "recalled": sent})


async def list_assignments(req: web.Request) -> web.Response:
    user_row = await _ensure_user(req)
    if user_row is None:
        return web.json_response({"error": "unauthorized"}, status=401)
    is_admin = user_row["role"] == "admin"
    rows = await db.list_assignments(user_id=None if is_admin else user_row["id"], limit=100)
    return web.json_response({"assignments": [_assignment_safe(r) for r in rows]})


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
    h = _hash_key(raw) if raw.startswith("gw_") else raw
    row = await db.get_worker_key(h)
    if not row:
        return web.json_response({"error": "unknown key"}, status=404)
    is_admin = user_row["role"] == "admin"
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
                elif t == "state":
                    new_state = obj.get("state", "idle")
                    if new_state == "idle" and worker.state == "busy" and worker.last_assignment_id:
                        await db.update_assignment_status(worker.last_assignment_id, "ended",
                                                          obj.get("detail"))
                    worker.state = new_state
                elif t == "status":
                    aid = obj.get("id")
                    event = obj.get("event")
                    if aid and event in ("started", "ended", "failed", "rejected"):
                        await db.update_assignment_status(aid, event, obj.get("detail"))
                elif t == "pong":
                    pass
                else:
                    print(f"[worker {worker.id}] msg: {obj}", flush=True)
            elif msg.type == WSMsgType.ERROR:
                break
    finally:
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
        "ended_at":         row["ended_at"].isoformat() if row.get("ended_at") else None,
        "billable_seconds": row.get("billable_seconds"),
    }


_SPECIALISTS_CACHE: list[dict] = []
def _load_specialists_data() -> list[dict]:
    """Load data/specialists.json once and cache for the process lifetime."""
    global _SPECIALISTS_CACHE
    if _SPECIALISTS_CACHE:
        return _SPECIALISTS_CACHE
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    path = os.path.join(repo_root, "data", "specialists.json")
    try:
        with open(path, encoding="utf-8") as f:
            _SPECIALISTS_CACHE = json.load(f)
    except Exception:
        _SPECIALISTS_CACHE = []
    return _SPECIALISTS_CACHE


# ──────────────────────────────────────────────────────────────────────────

async def on_startup(app: web.Application) -> None:
    await db.run_migrations()
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
    origin = req.headers.get("origin", "*")
    resp.headers["Access-Control-Allow-Origin"]      = origin
    resp.headers["Access-Control-Allow-Credentials"] = "true"
    resp.headers["Access-Control-Allow-Headers"]     = "authorization, content-type, x-dev-user-id"
    resp.headers["Access-Control-Allow-Methods"]     = "GET, POST, PUT, DELETE, OPTIONS"


def _cors_preflight(req: web.Request) -> web.Response:
    resp = web.Response(status=204)
    _add_cors(resp, req)
    return resp


def build_app() -> web.Application:
    app = web.Application(middlewares=[cors_middleware, auth.auth_middleware])
    app.router.add_get("/api/me", me)
    app.router.add_get("/api/workers", list_workers)
    app.router.add_post("/api/dispatch", dispatch)
    app.router.add_post("/api/recall", recall)
    app.router.add_get("/api/assignments", list_assignments)
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
