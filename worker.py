#!/usr/bin/env python3
"""worker.py — gstack worker WS daemon.

Holds a persistent WebSocket connection to a gstack broker
(default: wss://gstack.fly.dev/v1/workers/connect). Receives `assignment`
messages and turns them into local /dispatch calls against the gstack
`server.py` running on 127.0.0.1:8765. Reports state back to the broker.

Inspired by AgentCall's demo-worker pattern:
  https://docs.agentcall.dev/skill/agentcall-demo-worker

The script is dumb on purpose — all reply-generation lives in the Claude
Code session running alongside this process (see WORKER.md). The script's
only job is to be a reliable bidirectional bridge with auto-reconnect.

Protocol (one JSON object per line, both directions):

  Server → us:
    {"type": "assignment", "id": "...", "meetUrl": "...", "specialists": [...],
     "brief": "...", "mode": "avatar", "agentcall_api_key": "ak_ac_..."}
    {"type": "recall",   "id": "..."}     # tear down a specific assignment
    {"type": "ping"}                       # keepalive
    {"type": "hello", "worker_id": "..."} # broker accepted our key

  Us → server:
    {"type": "state", "state": "idle|busy"}
    {"type": "status", "id": "...", "event": "started|ended|failed",
     "detail": "..."}

Usage:
  python3 worker.py [--broker wss://...] [--key gw_xxx]
                    [--server-port 8765] [--name "Anand's laptop"]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import platform
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Optional

try:
    import websockets
except ImportError:
    print(json.dumps({"type": "error", "message": "missing dep: pip install websockets"}), flush=True)
    sys.exit(1)


DEFAULT_BROKER = os.environ.get("GSTACK_BROKER_URL", "ws://127.0.0.1:8787/v1/workers/connect")
CONFIG_PATH = Path.home() / ".gstack" / "worker.json"
HERE = Path(__file__).resolve().parent


# ──────────────────────────────────────────────────────────────────────────
# config

def load_key(cli_key: Optional[str]) -> Optional[str]:
    if cli_key:
        return cli_key
    if env := os.environ.get("GSTACK_WORKER_KEY"):
        return env
    if CONFIG_PATH.is_file():
        try:
            return json.loads(CONFIG_PATH.read_text()).get("worker_key")
        except Exception:
            return None
    return None


def emit(obj: dict) -> None:
    """One JSON line to stdout — Claude reads these via Monitor."""
    print(json.dumps(obj), flush=True)


# ──────────────────────────────────────────────────────────────────────────
# local server.py management

def server_alive(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1) as r:
            return r.status == 200
    except Exception:
        return False


def ensure_server(port: int, log_path: Path) -> Optional[subprocess.Popen]:
    """Spawn server.py if it isn't already running on the given port.
    Returns the Popen for cleanup, or None if an existing server is reused."""
    if server_alive(port):
        emit({"type": "info", "message": f"reusing server on :{port}"})
        return None
    server = HERE / "server.py"
    if not server.is_file():
        emit({"type": "error", "message": f"server.py not found at {server}"})
        sys.exit(2)
    env = os.environ.copy()
    env["PORT"] = str(port)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_f = open(log_path, "ab", buffering=0)
    proc = subprocess.Popen(
        [sys.executable, str(server)],
        env=env, stdout=log_f, stderr=log_f, start_new_session=True,
    )
    # wait up to 10s for the server to come up
    for _ in range(20):
        if server_alive(port):
            emit({"type": "info", "message": f"spawned server pid={proc.pid} port={port}"})
            return proc
        time.sleep(0.5)
    emit({"type": "error", "message": f"server.py failed to start on :{port}"})
    proc.terminate()
    sys.exit(3)


def http_post(port: int, path: str, body: dict, timeout: float = 5.0) -> tuple[int, dict]:
    """POST JSON to the local server and return (status, body)."""
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}",
        data=data,
        method="POST",
        headers={"Content-Type": "application/json", "Origin": f"http://127.0.0.1:{port}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8") or "{}")
    except Exception as e:
        return 0, {"error": str(e)}


# ──────────────────────────────────────────────────────────────────────────
# assignment handling

class State:
    """Shared state between WS reader/writer and assignment handlers."""

    def __init__(self, server_port: int) -> None:
        self.server_port = server_port
        self.busy_assignment_id: Optional[str] = None
        self.send_q: asyncio.Queue = asyncio.Queue()
        self.original_api_key = os.environ.get("AGENTCALL_API_KEY", "")

    async def send(self, msg: dict) -> None:
        await self.send_q.put(msg)

    def set_transient_key(self, key: Optional[str]) -> None:
        """Set AGENTCALL_API_KEY for the next dispatch's child processes.
        Restored to original after the assignment ends so a revoked
        transient key can't outlive its call."""
        if key:
            os.environ["AGENTCALL_API_KEY"] = key
        else:
            os.environ.pop("AGENTCALL_API_KEY", None)

    def restore_key(self) -> None:
        if self.original_api_key:
            os.environ["AGENTCALL_API_KEY"] = self.original_api_key
        else:
            os.environ.pop("AGENTCALL_API_KEY", None)


async def handle_assignment(state: State, msg: dict) -> None:
    aid = msg.get("id") or f"a-{int(time.time()*1000)}"
    if state.busy_assignment_id is not None:
        await state.send({"type": "status", "id": aid, "event": "rejected",
                          "detail": f"busy with {state.busy_assignment_id}"})
        return

    meet_url = msg.get("meetUrl") or msg.get("meet_url") or ""
    specs    = msg.get("specialists") or []
    brief    = msg.get("brief") or ""
    mode     = msg.get("mode") or "avatar"
    api_key  = msg.get("agentcall_api_key") or msg.get("agentcallApiKey")

    if not meet_url or not specs:
        await state.send({"type": "status", "id": aid, "event": "failed",
                          "detail": "missing meetUrl or specialists"})
        return

    state.busy_assignment_id = aid
    await state.send({"type": "state", "state": "busy"})
    # Also emit to stdout so the local Claude session sees the assignment
    # via Monitor and kicks off the brain-loop for these specialists.
    emit({"type": "assignment", "id": aid, "meetUrl": meet_url,
          "specialists": specs, "brief": brief, "mode": mode})

    state.set_transient_key(api_key)
    try:
        code, body = http_post(state.server_port, "/dispatch", {
            "meetUrl": meet_url, "specialists": specs,
            "brief": brief, "mode": mode,
        }, timeout=20.0)
    finally:
        # Drop the transient key from our env IMMEDIATELY after dispatch —
        # the bridges have already copied it into their own env via
        # server.py's _safe_env().
        state.restore_key()

    if code == 200:
        await state.send({"type": "status", "id": aid, "event": "started",
                          "detail": body})
        emit({"type": "dispatched", "id": aid, "result": body})
    else:
        state.busy_assignment_id = None
        await state.send({"type": "state", "state": "idle"})
        await state.send({"type": "status", "id": aid, "event": "failed",
                          "detail": f"http {code}: {body}"})
        emit({"type": "dispatch_failed", "id": aid, "code": code, "body": body})


async def handle_recall(state: State, msg: dict) -> None:
    aid = msg.get("id") or state.busy_assignment_id or "*"
    code, body = http_post(state.server_port, "/recall", {"all": True}, timeout=10.0)
    state.busy_assignment_id = None
    state.restore_key()
    await state.send({"type": "state", "state": "idle"})
    await state.send({"type": "status", "id": aid, "event": "ended",
                      "detail": body if code == 200 else f"http {code}"})
    emit({"type": "recalled", "id": aid, "code": code})


# ──────────────────────────────────────────────────────────────────────────
# WS loop

async def stdin_reader(state: State) -> None:
    """Forward JSON lines from stdin to the broker. Lets the Claude session
    (which already monitors inbox.jsonl) push status updates back."""
    loop = asyncio.get_event_loop()
    while True:
        line = await loop.run_in_executor(None, sys.stdin.readline)
        if not line:
            return
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError as e:
            print(f"worker.py: invalid stdin json: {e}", file=sys.stderr, flush=True)
            continue
        await state.send(msg)


async def run_session(url: str, key: str, state: State, meta: dict) -> None:
    full_url = f"{url}?key={key}"
    emit({"type": "connecting", "broker": url, "ts": time.time()})
    async with websockets.connect(full_url, ping_interval=25, ping_timeout=20) as ws:
        emit({"type": "connected", "ts": time.time()})
        # Announce ourselves with platform metadata.
        await ws.send(json.dumps({"type": "hello", **meta}))
        await ws.send(json.dumps({"type": "state", "state": "idle"}))

        async def writer() -> None:
            while True:
                msg = await state.send_q.get()
                try:
                    await ws.send(json.dumps(msg))
                except Exception as e:
                    emit({"type": "error", "message": f"send failed: {e}"})
                    return

        async def reader() -> None:
            async for raw in ws:
                try:
                    obj = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                t = obj.get("type")
                if t == "assignment":
                    asyncio.create_task(handle_assignment(state, obj))
                elif t in ("recall", "cancel"):
                    asyncio.create_task(handle_recall(state, obj))
                elif t == "hello":
                    emit({"type": "broker_hello", "worker_id": obj.get("worker_id")})
                elif t == "ping":
                    await state.send({"type": "pong"})
                else:
                    # Surface everything else so Claude can see it.
                    emit({"type": "broker_message", "message": obj})

        done, pending = await asyncio.wait(
            [asyncio.create_task(reader()), asyncio.create_task(writer())],
            return_when=asyncio.FIRST_COMPLETED,
        )
        for t in pending:
            t.cancel()


async def main_async(args: argparse.Namespace) -> None:
    key = load_key(args.key)
    if not key:
        emit({"type": "error", "message":
              "no worker key — set GSTACK_WORKER_KEY or write {worker_key:...} to ~/.gstack/worker.json"})
        sys.exit(2)

    # Start local server.py if not already up — the worker dispatches
    # against it on assignment.
    server_proc = ensure_server(args.server_port, Path("/tmp") / f"gstack-worker-{os.getuid()}.log")

    state = State(args.server_port)
    asyncio.create_task(stdin_reader(state))

    meta = {
        "name":     args.name or socket.gethostname(),
        "platform": f"{platform.system()} {platform.machine()}",
        "version":  "1.0.0",
        "pid":      os.getpid(),
    }

    def _bye(*_: Any) -> None:
        if server_proc is not None:
            try:
                server_proc.terminate()
            except Exception:
                pass
        emit({"type": "shutdown", "ts": time.time()})
        sys.exit(0)

    signal.signal(signal.SIGINT, _bye)
    signal.signal(signal.SIGTERM, _bye)

    backoff = 1.0
    while True:
        try:
            await run_session(args.broker, key, state, meta)
            emit({"type": "disconnected", "ts": time.time()})
            backoff = 1.0
        except asyncio.CancelledError:
            return
        except Exception as e:
            emit({"type": "error", "message": f"session: {e}"})
        wait = min(backoff, 30.0)
        emit({"type": "reconnecting", "in_seconds": wait})
        await asyncio.sleep(wait)
        backoff = min(backoff * 2, 30.0)


def main() -> None:
    parser = argparse.ArgumentParser(description="gstack worker WS daemon")
    parser.add_argument("--broker", default=DEFAULT_BROKER,
                        help=f"Broker WS URL (default: {DEFAULT_BROKER})")
    parser.add_argument("--key", default=None,
                        help="Worker key (overrides env / config)")
    parser.add_argument("--server-port", type=int, default=8765,
                        help="Local server.py port (default: 8765)")
    parser.add_argument("--name", default="",
                        help="Worker display name (default: hostname)")
    args = parser.parse_args()
    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
