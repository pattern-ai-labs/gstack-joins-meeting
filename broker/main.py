#!/usr/bin/env python3
"""gstack broker — Phase-1 minimal hosted dispatcher.

Two surfaces:

  HTTP  GET  /                       → tiny HTML form (paste Meet URL, pick specialists)
  HTTP  GET  /api/workers            → list of currently-connected workers
  HTTP  POST /api/dispatch           → assign a job to an idle worker
  HTTP  POST /api/recall             → recall all specialists on a worker
  HTTP  POST /api/admin/mint         → mint a new worker key (bearer-auth)
  HTTP  POST /api/admin/revoke       → revoke a worker key (bearer-auth)
  HTTP  GET  /api/admin/keys         → list all worker keys (bearer-auth)
  WS    /v1/workers/connect?key=gw_  → workers connect here

Persistence: a single JSON file at $GSTACK_BROKER_STATE
  (default: /tmp/gstack-broker-state.json). Replaced by Postgres in Phase 2.

Auth model (Phase 1):
  - workers authenticate with a long-lived `gw_xxx` key
  - admin endpoints authenticate with `Authorization: Bearer $GSTACK_ADMIN_TOKEN`
  - end-user /api/dispatch is OPEN in Phase 1 — Phase 2 wraps with Clerk

Run:
  pip install aiohttp websockets
  export GSTACK_ADMIN_TOKEN="$(openssl rand -hex 24)"
  python3 broker/main.py --port 8787

Then on a worker:
  GSTACK_WORKER_KEY=gw_xxx GSTACK_BROKER_URL=ws://127.0.0.1:8787/v1/workers/connect \
    python3 worker.py
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import secrets
import time
from pathlib import Path
from typing import Optional

from aiohttp import web, WSMsgType


STATE_PATH = Path(os.environ.get("GSTACK_BROKER_STATE", "/tmp/gstack-broker-state.json"))
ADMIN_TOKEN = os.environ.get("GSTACK_ADMIN_TOKEN", "")
TRANSIENT_AGENTCALL_KEY = os.environ.get("GSTACK_POOL_AGENTCALL_KEY", "")


# ──────────────────────────────────────────────────────────────────────────
# state — Phase 1: a single JSON file

def _load_state() -> dict:
    if STATE_PATH.is_file():
        try:
            return json.loads(STATE_PATH.read_text())
        except Exception:
            pass
    return {"keys": {}}  # {key_hash: {label, created_at, last_seen, revoked}}


def _save_state(state: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2))
    os.replace(tmp, STATE_PATH)


def _hash_key(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


# ──────────────────────────────────────────────────────────────────────────
# in-memory worker registry (the WS connections themselves)

class Worker:
    def __init__(self, ws: web.WebSocketResponse, key_hash: str) -> None:
        self.ws = ws
        self.key_hash = key_hash
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
            "name":                self.name,
            "platform":            self.platform,
            "state":               self.state,
            "connected_at":        self.connected_at,
            "last_assignment_id":  self.last_assignment_id,
            "last_assignment_at":  self.last_assignment_at,
        }


WORKERS: dict[str, Worker] = {}  # id → Worker


def pick_idle_worker() -> Optional[Worker]:
    # Round-robin would be nicer; for Phase 1 take the oldest-idle.
    idle = [w for w in WORKERS.values() if w.state == "idle"]
    if not idle:
        return None
    idle.sort(key=lambda w: w.last_assignment_at or 0)
    return idle[0]


# ──────────────────────────────────────────────────────────────────────────
# auth helpers

def _require_admin(req: web.Request) -> Optional[web.Response]:
    if not ADMIN_TOKEN:
        return web.json_response(
            {"error": "GSTACK_ADMIN_TOKEN not set on the broker"}, status=500)
    auth = req.headers.get("authorization", "")
    if auth != f"Bearer {ADMIN_TOKEN}":
        return web.json_response({"error": "unauthorized"}, status=401)
    return None


# ──────────────────────────────────────────────────────────────────────────
# HTTP routes

INDEX_HTML = """<!doctype html>
<html><head><meta charset="utf-8"><title>gstack broker</title>
<style>
  body { font: 14px/1.45 ui-monospace, monospace; background: #0a0a0b; color: #e6e6e6; padding: 32px; max-width: 760px; margin: auto; }
  h1 { font-size: 18px; margin: 0 0 16px; color: #a3e635; }
  input, textarea, select { width: 100%; box-sizing: border-box; padding: 10px 12px; background: #16161a; color: #e6e6e6; border: 1px solid #2a2a2e; border-radius: 6px; font: inherit; margin: 4px 0 12px; }
  button { padding: 10px 16px; background: #a3e635; color: #0a0a0b; border: 0; border-radius: 6px; font-weight: 600; cursor: pointer; }
  pre { background: #16161a; border: 1px solid #2a2a2e; border-radius: 6px; padding: 12px; overflow: auto; white-space: pre-wrap; word-wrap: break-word; }
  .row { display: flex; gap: 8px; align-items: center; margin: 8px 0; }
  .row label { white-space: nowrap; }
  .muted { color: #7a7a82; font-size: 12px; }
</style></head><body>
<h1>gstack broker — Phase 1</h1>
<p class="muted">Paste a Meet URL. Pick specialists (comma-separated ids). Click Dispatch — the broker hands the job to the next idle worker.</p>
<form id="f">
  <label>Meet URL <input name="meetUrl" placeholder="https://meet.google.com/abc-defg-hij" required></label>
  <label>Specialists <input name="specialists" placeholder="plan-ceo-review,cso" value="plan-ceo-review"></label>
  <label>Brief (optional) <textarea name="brief" rows="2" placeholder="Pitch we're discussing today..."></textarea></label>
  <div class="row">
    <label>Mode <select name="mode"><option value="avatar">avatar</option><option value="audio">audio</option></select></label>
    <button type="submit">Dispatch</button>
  </div>
</form>
<h2 style="font-size:14px;margin-top:24px">Workers</h2>
<pre id="workers">loading…</pre>
<h2 style="font-size:14px;margin-top:24px">Last response</h2>
<pre id="out">—</pre>
<script>
async function loadWorkers() {
  const r = await fetch('/api/workers');
  document.getElementById('workers').textContent = JSON.stringify(await r.json(), null, 2);
}
loadWorkers(); setInterval(loadWorkers, 3000);
document.getElementById('f').onsubmit = async (ev) => {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const body = {
    meetUrl: fd.get('meetUrl'),
    specialists: fd.get('specialists').split(',').map(s => s.trim()).filter(Boolean),
    brief: fd.get('brief'),
    mode: fd.get('mode'),
  };
  const r = await fetch('/api/dispatch', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body)});
  document.getElementById('out').textContent = JSON.stringify(await r.json(), null, 2);
};
</script></body></html>
"""


async def index(req: web.Request) -> web.Response:
    return web.Response(text=INDEX_HTML, content_type="text/html")


async def list_workers(req: web.Request) -> web.Response:
    return web.json_response({
        "workers": [w.to_json() for w in WORKERS.values()],
        "idle":    sum(1 for w in WORKERS.values() if w.state == "idle"),
        "busy":    sum(1 for w in WORKERS.values() if w.state == "busy"),
    })


async def dispatch(req: web.Request) -> web.Response:
    try:
        body = await req.json()
    except Exception:
        return web.json_response({"error": "bad json"}, status=400)

    meet_url = (body.get("meetUrl") or "").strip()
    specs    = body.get("specialists") or []
    if not meet_url or not specs:
        return web.json_response({"error": "meetUrl and specialists[] required"}, status=400)

    worker = pick_idle_worker()
    if worker is None:
        return web.json_response({"error": "no idle workers"}, status=503)

    aid = f"a-{int(time.time()*1000)}"
    msg = {
        "type":              "assignment",
        "id":                aid,
        "meetUrl":           meet_url,
        "specialists":       specs,
        "brief":             body.get("brief", ""),
        "mode":              body.get("mode", "avatar"),
        "agentcall_api_key": TRANSIENT_AGENTCALL_KEY,  # Phase 1: shared pool
        "end_at":            time.time() + (int(body.get("max_duration_min", 30)) * 60),
    }
    try:
        await worker.ws.send_str(json.dumps(msg))
    except Exception as e:
        return web.json_response({"error": f"worker send failed: {e}"}, status=502)

    # Optimistic state update — the worker will confirm with its own state message.
    worker.state = "busy"
    worker.last_assignment_id = aid
    worker.last_assignment_at = time.time()
    return web.json_response({"ok": True, "assignment_id": aid, "worker_id": worker.id})


async def recall(req: web.Request) -> web.Response:
    try:
        body = await req.json()
    except Exception:
        body = {}
    target_worker = body.get("worker_id")
    targets = [w for w in WORKERS.values()
               if (not target_worker or w.id == target_worker) and w.state == "busy"]
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
    return web.json_response({"ok": True, "recalled": sent})


async def admin_mint(req: web.Request) -> web.Response:
    if err := _require_admin(req):
        return err
    try:
        body = await req.json()
    except Exception:
        body = {}
    label = (body.get("label") or "unnamed").strip()[:80]
    plaintext = "gw_" + secrets.token_urlsafe(24)
    state = _load_state()
    state["keys"][_hash_key(plaintext)] = {
        "label":      label,
        "created_at": time.time(),
        "last_seen":  None,
        "revoked":    False,
    }
    _save_state(state)
    # The plaintext is shown ONCE — admin must copy it now.
    return web.json_response({"worker_key": plaintext, "label": label})


async def admin_revoke(req: web.Request) -> web.Response:
    if err := _require_admin(req):
        return err
    try:
        body = await req.json()
    except Exception:
        body = {}
    hash_or_plain = body.get("key") or ""
    if hash_or_plain.startswith("gw_"):
        h = _hash_key(hash_or_plain)
    else:
        h = hash_or_plain
    state = _load_state()
    if h not in state["keys"]:
        return web.json_response({"error": "unknown key"}, status=404)
    state["keys"][h]["revoked"] = True
    _save_state(state)
    # Boot any currently-connected worker using this key.
    booted = 0
    for w in list(WORKERS.values()):
        if w.key_hash == h:
            try:
                await w.ws.close(code=4001, message=b"key revoked")
                booted += 1
            except Exception:
                pass
    return web.json_response({"ok": True, "revoked": True, "booted": booted})


async def admin_keys(req: web.Request) -> web.Response:
    if err := _require_admin(req):
        return err
    state = _load_state()
    out = []
    for h, meta in state["keys"].items():
        out.append({
            "key_hash":   h[:12] + "...",
            "label":      meta.get("label"),
            "created_at": meta.get("created_at"),
            "last_seen":  meta.get("last_seen"),
            "revoked":    meta.get("revoked", False),
            "online":     any(w.key_hash == h for w in WORKERS.values()),
        })
    return web.json_response({"keys": out})


# ──────────────────────────────────────────────────────────────────────────
# WS endpoint — workers connect here

async def worker_ws(req: web.Request) -> web.WebSocketResponse:
    key = req.query.get("key", "")
    if not key.startswith("gw_"):
        return web.json_response({"error": "bad key format"}, status=400)

    state = _load_state()
    h = _hash_key(key)
    meta = state["keys"].get(h)
    if not meta or meta.get("revoked"):
        return web.json_response({"error": "unknown or revoked key"}, status=401)

    ws = web.WebSocketResponse(heartbeat=25)
    await ws.prepare(req)

    worker = Worker(ws, h)
    WORKERS[worker.id] = worker
    await ws.send_str(json.dumps({"type": "hello", "worker_id": worker.id}))

    # Update last_seen.
    meta["last_seen"] = time.time()
    state["keys"][h] = meta
    _save_state(state)

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
                    worker.state = obj.get("state", "idle")
                elif t == "status":
                    # Forward to anyone listening; Phase-1 just logs.
                    print(f"[worker {worker.id}] status: {obj}", flush=True)
                elif t == "pong":
                    pass
                else:
                    print(f"[worker {worker.id}] msg: {obj}", flush=True)
            elif msg.type == WSMsgType.ERROR:
                break
    finally:
        WORKERS.pop(worker.id, None)
    return ws


# ──────────────────────────────────────────────────────────────────────────

def build_app() -> web.Application:
    app = web.Application()
    app.router.add_get("/", index)
    app.router.add_get("/api/workers", list_workers)
    app.router.add_post("/api/dispatch", dispatch)
    app.router.add_post("/api/recall", recall)
    app.router.add_post("/api/admin/mint", admin_mint)
    app.router.add_post("/api/admin/revoke", admin_revoke)
    app.router.add_get("/api/admin/keys", admin_keys)
    app.router.add_get("/v1/workers/connect", worker_ws)
    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="gstack broker (Phase 1)")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()
    print(f"[broker] state={STATE_PATH} admin_token={'set' if ADMIN_TOKEN else 'MISSING'}",
          flush=True)
    if not ADMIN_TOKEN:
        print("[broker] WARNING: GSTACK_ADMIN_TOKEN not set — /api/admin/* will refuse all requests",
              flush=True)
    web.run_app(build_app(), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
