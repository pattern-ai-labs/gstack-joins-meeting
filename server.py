#!/usr/bin/env python3
"""
gstack × AgentCall — minimal dispatch server.

Serves the static dashboard and exposes:

  POST /dispatch  — spawn one specialist_runner.py subprocess per selected
                    specialist. Each runner drives a bridge.py bot that joins
                    the meeting and speaks its role.
  POST /recall    — send SIGTERM to previously-dispatched runners so they
                    leave the meeting cleanly.

Each runner's stdout/stderr is redirected to
/tmp/gstack-specialists/<id>.<ts>.log. Active PIDs are tracked in
/tmp/gstack-specialists/active.json so /recall can target them.

Stdlib only. No deps.

Run:
    python3 server.py
    # → open http://localhost:8765
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


# ---------------------------------------------------------------------------
# Subprocess env hardening
# ---------------------------------------------------------------------------
# We pass only the env vars the bridge actually needs into spawned children.
# Without this, every secret on the dev's shell (AWS keys, GitHub tokens,
# unrelated API keys) gets handed to a vendored third-party bridge.
_SAFE_ENV_KEYS = frozenset({
    "PATH", "HOME", "USER", "LOGNAME", "SHELL", "PWD",
    "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TZ",
    "PYTHONUNBUFFERED", "PYTHONPATH",
    "AGENTCALL_API_KEY", "AGENTCALL_API_URL",
})


def _safe_env() -> dict:
    return {k: v for k, v in os.environ.items() if k in _SAFE_ENV_KEYS}


def _looks_like_runner(pid: int) -> bool:
    """Verify a PID's argv looks like one of our specialist_runner children.

    Defends against PID re-use: if the OS re-assigned the PID we recorded
    in active.json, we don't want /recall to SIGTERM whatever now holds it.
    Uses `ps` (POSIX, no extra deps) so this works on macOS and Linux.
    """
    try:
        out = subprocess.run(
            ["ps", "-p", str(int(pid)), "-o", "args="],
            capture_output=True, text=True, timeout=2,
        )
        return "specialist_runner.py" in out.stdout
    except Exception:
        return False
from urllib.parse import urlparse

# ──────────────────────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────────────────────

HOST = "127.0.0.1"
PORT = 8765
ROOT = Path(__file__).resolve().parent
SCRIPTS_DIR = ROOT / "scripts"
SESSIONS_ROOT = ROOT / "sessions"
SESSIONS_ROOT.mkdir(parents=True, exist_ok=True)
AVATAR_UI_PORT_PREFERRED = 3000   # preferred starting port for the avatar-page server
AVATAR_UI_PORT_MAX_TRIES = 10     # walk this many ports forward looking for a free/ours one
AVATAR_UI_PORT_MARKER = "gstack-avatar-page"  # HTML marker proving the listener is ours
AVATAR_UI_PORT = AVATAR_UI_PORT_PREFERRED     # resolved at boot by _ensure_avatar_server();
                                              # /dispatch reads this to pass --avatar-port to runners


def _find_bridge() -> Path:
    """Locate bridge.py across known install layouts (skill clone or plugin)."""
    candidates = [
        Path.home() / ".claude" / "skills" / "join-meeting" / "scripts" / "python" / "bridge.py",
        Path.home() / ".claude" / "skills" / "agentcall" / "scripts" / "python" / "bridge.py",
        Path.home() / ".claude" / "plugins" / "marketplaces" / "agentcall" / "scripts" / "python" / "bridge.py",
        Path.home() / ".claude" / "plugins" / "cache" / "agentcall" / "join-meeting" / "1.0.0" / "scripts" / "python" / "bridge.py",
    ]
    for p in candidates:
        if p.is_file():
            return p
    return candidates[0]  # fallback; warning will fire below

BRIDGE = _find_bridge()
RUNNER = ROOT / "specialist_runner.py"
# Per-user, mode-0700 log dir so other local users can't tamper with
# active.json (which /recall trusts for PIDs to SIGTERM).
def _log_dir() -> Path:
    uid = os.getuid() if hasattr(os, "getuid") else 0
    p = Path(f"/tmp/gstack-specialists-{uid}")
    p.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        os.chmod(p, 0o700)
    except Exception:
        pass
    # Back-compat symlink (some older code paths reference the unscoped dir).
    legacy = Path("/tmp/gstack-specialists")
    try:
        if not legacy.exists():
            legacy.symlink_to(p)
    except Exception:
        pass
    return p

LOG_DIR = _log_dir()
ACTIVE_FILE = LOG_DIR / "active.json"
_active_lock = threading.Lock()

# Single source of truth for specialist metadata on the server side.
# Must stay in sync with specialists.js (same ids, same human-readable names).
# Each entry carries the display name, role (used in the greeting), and a
# one-sentence description played after the role.
def _load_specialists_data() -> dict[str, dict[str, str]]:
    """Load the canonical specialist registry from data/specialists.json.

    Single source of truth — keeps server.py, specialist_runner.py,
    specialists.js, and avatar-page in sync. If the JSON file is missing
    we fall back to the hardcoded dict below so dev installs still work.
    """
    json_path = ROOT / "data" / "specialists.json"
    if json_path.is_file():
        try:
            data = json.loads(json_path.read_text())
            return {
                s["id"]: {
                    "name":        s["name"],
                    "role":        s["role"],
                    "description": s["description"],
                    "voice":       s.get("voice", "af_heart"),
                }
                for s in data
            }
        except Exception as e:
            sys.stderr.write(f"[warn] could not parse data/specialists.json: {e}\n")
    return _HARDCODED_SPECIALISTS  # back-compat


# Hardcoded fallback (kept in sync with data/specialists.json by hand —
# we read the JSON when it's present, this exists only for the "user
# deleted the data dir" failure mode).
_HARDCODED_SPECIALISTS: dict[str, dict[str, str]] = {
    "office-hours": {
        "name": "YC Office Hours",
        "role": "YC Office Hours partner",
        "description": "I grill founders on traction, users, and why-now — YC-style, no softball.",
        "voice": "am_michael",
    },
    "plan-ceo-review": {
        "name": "CEO",
        "role": "CEO",
        "description": "I pressure-test the strategy — is this the right bet, right now, for this team.",
        "voice": "am_adam",
    },
    "plan-eng-review": {
        "name": "Eng Manager",
        "role": "Engineering Manager",
        "description": "I lock architecture before a line is written — boundaries, blast radius, and the rewrite path.",
        "voice": "bm_george",
    },
    "plan-design-review": {
        "name": "Senior Designer",
        "role": "Senior Designer",
        "description": "I score the plan against a gold-standard product — hierarchy, density, flow.",
        "voice": "af_sarah",
    },
    "plan-devex-review": {
        "name": "DX Lead",
        "role": "Developer Experience Lead",
        "description": "I plan the developer experience — first-run, docs, and the time from clone to ship.",
        "voice": "bf_emma",
    },
    "design-consultation": {
        "name": "Design Partner",
        "role": "Design Partner",
        "description": "I set the design system direction and review every product surface end to end.",
        "voice": "bf_isabella",
    },
    "design-shotgun": {
        "name": "Design Explorer",
        "role": "Design Explorer",
        "description": "I generate six mockup variants in parallel so we can compare instead of debate.",
        "voice": "af_nicole",
    },
    "design-html": {
        "name": "Design Engineer",
        "role": "Design Engineer",
        "description": "I hand-code production HTML from a spec — semantic, accessible, no framework bloat.",
        "voice": "am_michael",
    },
    "review": {
        "name": "Staff Engineer",
        "role": "Staff Engineer",
        "description": "I read every line of the diff and catch the two things you missed.",
        "voice": "bm_lewis",
    },
    "investigate": {
        "name": "Debugger",
        "role": "Debugger",
        "description": "I root-cause bugs — hypothesis, evidence, fix. No guessing.",
        "voice": "am_adam",
    },
    "design-review": {
        "name": "Designer Who Codes",
        "role": "Designer Who Codes",
        "description": "I audit the live UI against the rubric — what shipped, not what's in the mockup.",
        "voice": "af_bella",
    },
    "devex-review": {
        "name": "DX Tester",
        "role": "Developer Experience Tester",
        "description": "I clone, run, and feel the product — I log every second of friction.",
        "voice": "bf_emma",
    },
    "qa": {
        "name": "QA Lead",
        "role": "QA Lead",
        "description": "I write tests, run them, and fix what breaks — every bug gets a regression.",
        "voice": "af_sarah",
    },
    "cso": {
        "name": "CSO",
        "role": "Chief Security Officer",
        "description": "I run OWASP Top Ten and STRIDE threat models — I find the exploits that ship to prod.",
        "voice": "am_michael",
    },
    "ship": {
        "name": "Release Engineer",
        "role": "Release Engineer",
        "description": "I open the PR with a real description and the right reviewers — ship small, ship often.",
        "voice": "bm_george",
    },
    "land-and-deploy": {
        "name": "Deploy Engineer",
        "role": "Deploy Engineer",
        "description": "I merge, deploy, and verify the new bits are actually live before I clock out.",
        "voice": "bm_lewis",
    },
    "canary": {
        "name": "SRE",
        "role": "Site Reliability Engineer",
        "description": "I watch logs and metrics after every deploy — any error-budget burn and I roll back fast.",
        "voice": "am_adam",
    },
    "retro": {
        "name": "Retro Facilitator",
        "role": "Retrospective Facilitator",
        "description": "I run the weekly retro — what shipped, what slipped, what we'd do different.",
        "voice": "bm_george",
    },
}


# Resolve the actual registry now (JSON if present, else fallback above).
SPECIALISTS: dict[str, dict[str, str]] = _load_specialists_data()


STATIC_FILES = {
    "/":               ("index.html",    "text/html; charset=utf-8"),
    "/index.html":     ("index.html",    "text/html; charset=utf-8"),
    "/specialists.js": ("specialists.js", "application/javascript; charset=utf-8"),
    # Expose the canonical JSON so the dashboard + avatar page can read
    # straight from the source of truth. No JS build step required.
    "/specialists.json": ("data/specialists.json", "application/json; charset=utf-8"),
    "/teams.json":       ("data/teams.json",       "application/json; charset=utf-8"),
}

# ──────────────────────────────────────────────────────────────────────────────
# PID tracking
# ──────────────────────────────────────────────────────────────────────────────

def _load_active() -> dict:
    try:
        return json.loads(ACTIVE_FILE.read_text())
    except Exception:
        return {}


def _save_active(data: dict):
    tmp = ACTIVE_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2))
    tmp.replace(ACTIVE_FILE)


def record_dispatch(entries: list[dict], session_dir: str | None = None):
    """Append dispatched runners to active.json.

    Optionally records the session_dir under `data["session_dir"]` so the
    next /dispatch re-uses the same dir (one LISTENER per session).
    """
    with _active_lock:
        data = _load_active()
        runners = data.get("runners", [])
        runners.extend(entries)
        # Prune entries whose PID is no longer alive.
        runners = [r for r in runners if _pid_alive(r.get("pid"))]
        data["runners"] = runners
        if session_dir:
            data["session_dir"] = session_dir
        elif not runners:
            # All bots gone — clear the session so the next dispatch starts fresh.
            data.pop("session_dir", None)
        _save_active(data)


def _active_session_dir() -> Path | None:
    """Return the current session_dir if there's at least one live runner."""
    with _active_lock:
        data = _load_active()
        runners = [r for r in data.get("runners", []) if _pid_alive(r.get("pid"))]
        sd = data.get("session_dir")
        if runners and sd:
            return Path(sd)
    return None


def _pid_alive(pid) -> bool:
    try:
        pid = int(pid)
    except Exception:
        return False
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except Exception:
        return False


# ──────────────────────────────────────────────────────────────────────────────
# Dispatch
# ──────────────────────────────────────────────────────────────────────────────

def spawn_specialist(
    spec_id: str,
    meet_url: str,
    session_dir: Path,
    brief: str = "",
    mode: str = "audio",
    listener: bool = False,
) -> tuple[int, str]:
    """Spawn a specialist_runner.py subprocess. Returns (pid, log_path).

    All per-specialist files live inside `session_dir`:
      <session_dir>/<spec_id>.cmds   — commands tailed by bridge
      <session_dir>/<spec_id>.jsonl  — bridge events (--output)
      <session_dir>/orchestrator.log — combined launch.sh + runner logs
      <session_dir>/session.pid      — PIDs for kill-session.sh

    Also writes a small runner-specific log under LOG_DIR for back-compat.
    """
    spec = SPECIALISTS.get(spec_id)
    if not spec:
        raise KeyError(f"unknown specialist: {spec_id}")

    session_dir.mkdir(parents=True, exist_ok=True)
    log_path = LOG_DIR / f"{spec_id}.{int(time.time())}.log"
    log_fh = open(log_path, "ab", buffering=0)

    cmd = [
        sys.executable,
        str(RUNNER),
        "--meet-url",      meet_url,
        "--specialist-id", spec_id,
        "--name",          spec["name"],
        "--role",          spec["role"],
        "--description",   spec["description"],
        "--voice",         spec.get("voice", "af_heart"),
        "--mode",          mode,
        "--session-dir",   str(session_dir),
    ]
    if mode == "avatar":
        cmd.extend(["--avatar-port", str(AVATAR_UI_PORT)])
    if listener:
        cmd.append("--listener")
    if brief:
        cmd.extend(["--brief", brief])

    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.DEVNULL,
        stdout=log_fh,
        stderr=log_fh,
        cwd=str(ROOT),
        env=_safe_env(),
        start_new_session=True,
    )
    return proc.pid, str(log_path)


# Allow-list of host suffixes we'll let bots be dispatched against. Without
# this, /dispatch would happily drive bots at any URL — combined with a CSRF
# bypass (cross-origin tab POSTing to localhost), an attacker could burn the
# user's AgentCall credits or join attacker-controlled meetings.
_ALLOWED_MEET_HOSTS: tuple[str, ...] = (
    "meet.google.com",
    "zoom.us",       # *.zoom.us
    "teams.microsoft.com",
    "teams.live.com",
    "webex.com",     # *.webex.com
)


def validate_meet_url(url: str) -> bool:
    try:
        p = urlparse(url)
        if p.scheme not in ("https", "http"):
            return False
        host = (p.hostname or "").lower()
        if not host:
            return False
        for allowed in _ALLOWED_MEET_HOSTS:
            if host == allowed or host.endswith("." + allowed):
                return True
        return False
    except Exception:
        return False


# ──────────────────────────────────────────────────────────────────────────────
# Recall
# ──────────────────────────────────────────────────────────────────────────────

def recall(targets: list[str] | None, all_targets: bool) -> dict:
    """Send SIGTERM to matching runners. Returns {stopped:[…], missing:[…]}."""
    with _active_lock:
        data = _load_active()
        runners = data.get("runners", [])

    stopped: list[dict] = []
    missing: list[str] = []
    remaining: list[dict] = []

    for r in runners:
        pid = r.get("pid")
        spec_id = r.get("id")
        if not _pid_alive(pid):
            continue  # prune dead
        match = all_targets or (spec_id in (targets or []))
        if not match:
            remaining.append(r)
            continue
        # Defense-in-depth: verify the PID still belongs to one of OUR
        # runners before SIGTERMing it. PIDs roll over after reboot/wrap,
        # and a /recall right after such a roll could otherwise kill an
        # unrelated process.
        if not _looks_like_runner(pid):
            missing.append(f"{spec_id}:pid_no_longer_ours")
            continue
        try:
            os.kill(int(pid), signal.SIGTERM)
            stopped.append({"id": spec_id, "pid": pid, "name": r.get("name")})
        except ProcessLookupError:
            missing.append(spec_id)
        except Exception as e:
            missing.append(f"{spec_id}:{e}")

    # Anything the caller asked for but we didn't find:
    if not all_targets and targets:
        found_ids = {s["id"] for s in stopped}
        for t in targets:
            if t not in found_ids and t not in missing:
                missing.append(t)

    with _active_lock:
        data = _load_active()
        data["runners"] = remaining
        _save_active(data)

    return {"stopped": stopped, "missing": missing}


# ──────────────────────────────────────────────────────────────────────────────
# HTTP handler
# ──────────────────────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    server_version = "gstack-agentcall/0.2"

    def log_message(self, fmt, *args):  # quieter default log
        sys.stderr.write(f"[{self.log_date_time_string()}] {fmt % args}\n")

    # ── Static ─────────────────────────────────────────────────────────────
    def do_GET(self):
        path = self.path.split("?", 1)[0]
        # Serve per-specialist avatar SVGs from /avatars/<id>.svg
        if path.startswith("/avatars/") and path.endswith(".svg"):
            fname = path[len("/avatars/"):]
            # Guard against path traversal.
            if "/" in fname or ".." in fname or not fname.replace("-", "").replace(".svg", "").replace("_", "").isalnum():
                return self._send(400, b"bad path", "text/plain")
            fpath = ROOT / "avatars" / fname
            if fpath.exists() and fpath.is_file():
                return self._send(200, fpath.read_bytes(), "image/svg+xml", cache=False)
            return self._send(404, b"avatar not found", "text/plain")
        entry = STATIC_FILES.get(path)
        if not entry:
            return self._send(404, b"not found", "text/plain")
        filename, ctype = entry
        fpath = ROOT / filename
        if not fpath.exists():
            return self._send(404, b"missing", "text/plain")
        body = fpath.read_bytes()
        self._send(200, body, ctype, cache=False)

    # ── CSRF guard ─────────────────────────────────────────────────────────
    def _csrf_ok(self) -> bool:
        """Reject POSTs from cross-origin pages.

        A phishing tab can submit a `<form enctype="text/plain">` shaped as
        JSON to http://127.0.0.1:8765 and trigger /dispatch /recall on the
        dev's machine. We refuse unless the request looks same-origin.
        """
        # Any browser POST that *can* be CSRF'd carries an Origin header.
        # Accept only when it points back at our local dashboard (or is
        # absent + not from a browser, which is curl/the runner itself).
        origin = self.headers.get("Origin", "").rstrip("/").lower()
        if origin:
            ok_origins = {
                f"http://127.0.0.1:{PORT}",
                f"http://localhost:{PORT}",
            }
            return origin in ok_origins
        # No Origin? Require Sec-Fetch-Site=same-origin OR no Sec-Fetch-Site
        # (curl/python clients don't send it; cross-site browser fetches do).
        sfs = self.headers.get("Sec-Fetch-Site", "").lower()
        if sfs and sfs not in ("same-origin", "same-site", "none"):
            return False
        return True

    # ── POST dispatcher ────────────────────────────────────────────────────
    def do_POST(self):
        if not self._csrf_ok():
            return self._send_json(403, {"error": "cross-origin request blocked"})
        if self.path == "/dispatch":
            return self._handle_dispatch()
        if self.path == "/recall":
            return self._handle_recall()
        return self._send_json(404, {"error": "unknown endpoint"})

    # ── /dispatch ──────────────────────────────────────────────────────────
    def _handle_dispatch(self):
        length = int(self.headers.get("content-length") or 0)
        if length <= 0 or length > 64 * 1024:
            return self._send_json(400, {"error": "bad body size"})

        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception as e:
            return self._send_json(400, {"error": f"bad json: {e}"})

        meet_url = (body.get("meetUrl") or "").strip()
        specs    = body.get("specialists") or []
        brief    = body.get("brief") or ""
        if not isinstance(brief, str):
            brief = ""
        # Mirror the client-side 500-char cap server-side.
        brief = brief.strip()[:500]
        # Default to avatar mode — every bot joins with its specialist avatar.
        # Clients can pass {"mode": "audio"} to opt out.
        mode = (body.get("mode") or "avatar").strip().lower()
        if mode not in ("audio", "avatar"):
            mode = "avatar"

        if not validate_meet_url(meet_url):
            return self._send_json(400, {"error": "invalid meetUrl"})
        if not isinstance(specs, list) or not specs:
            return self._send_json(400, {"error": "specialists[] required"})

        unknown = [s for s in specs if s not in SPECIALISTS]
        if unknown:
            return self._send_json(400, {"error": f"unknown specialists: {unknown}"})

        pids: dict[str, int] = {}
        errors: dict[str, str] = {}
        dispatched: list[dict] = []
        record_entries: list[dict] = []
        ts = int(time.time())

        # Reuse active session dir if any runners are still alive — this is
        # the "add more specialists mid-meeting" path. LISTENER was already
        # chosen; new specialists join as non-listeners.
        existing_session = _active_session_dir()
        if existing_session is not None and existing_session.is_dir():
            session_dir = existing_session
            new_session = False
        else:
            session_dir = SESSIONS_ROOT / f"session-{ts}"
            session_dir.mkdir(parents=True, exist_ok=True)
            new_session = True

        for i, spec_id in enumerate(specs):
            # First spawn in a fresh session becomes the LISTENER.
            is_listener = (new_session and i == 0)
            try:
                pid, log_path = spawn_specialist(
                    spec_id, meet_url, session_dir,
                    brief=brief, mode=mode, listener=is_listener,
                )
                pids[spec_id] = pid
                spec = SPECIALISTS[spec_id]
                dispatched.append({
                    "id": spec_id, "name": spec["name"], "pid": pid,
                    "listener": is_listener,
                })
                record_entries.append({
                    "id":       spec_id,
                    "name":     spec["name"],
                    "pid":      pid,
                    "ts":       ts,
                    "meetUrl":  meet_url,
                    "logPath":  log_path,
                })
            except Exception as e:
                errors[spec_id] = str(e)

        if record_entries:
            try:
                record_dispatch(record_entries, session_dir=str(session_dir))
            except Exception as e:
                sys.stderr.write(f"[dispatch] active.json write failed: {e}\n")

        self._send_json(
            200 if not errors else 207,
            {
                "ok":         not errors,
                "meetUrl":    meet_url,
                "pids":       pids,
                "errors":     errors,
                "logDir":     str(LOG_DIR),
                "sessionDir": str(session_dir),
                "dispatched": dispatched,
            },
        )

    # ── /recall ────────────────────────────────────────────────────────────
    def _handle_recall(self):
        length = int(self.headers.get("content-length") or 0)
        if length < 0 or length > 64 * 1024:
            return self._send_json(400, {"error": "bad body size"})

        body = {}
        if length > 0:
            try:
                body = json.loads(self.rfile.read(length).decode("utf-8"))
            except Exception as e:
                return self._send_json(400, {"error": f"bad json: {e}"})

        all_targets = bool(body.get("all"))
        targets = body.get("specialists") or []

        if not all_targets and (not isinstance(targets, list) or not targets):
            return self._send_json(
                400,
                {"error": "specialists[] or all:true required"},
            )

        if not all_targets:
            unknown = [s for s in targets if s not in SPECIALISTS]
            if unknown:
                return self._send_json(
                    400, {"error": f"unknown specialists: {unknown}"},
                )

        try:
            result = recall(targets if not all_targets else None, all_targets)
        except Exception as e:
            return self._send_json(500, {"error": str(e)})

        self._send_json(200, {"ok": True, **result})

    # ── Helpers ────────────────────────────────────────────────────────────
    def _send(self, status: int, body: bytes, ctype: str, cache: bool = False):
        self.send_response(status)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(body)))
        if not cache:
            self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, status: int, payload: dict):
        self._send(status, json.dumps(payload).encode("utf-8"),
                   "application/json; charset=utf-8")


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────

def _avatar_server_is_ours(port: int) -> bool:
    """Return True iff a *gstack* avatar-page server is reachable on *port*.

    A bare TCP-connect test (the previous behavior) also succeeded against
    any other process bound to the port — e.g. a Next.js dev server,
    a docs preview, anything. The bot would then tunnel to that foreign
    listener and render its empty shell instead of our avatar SVG.
    Here we GET / and require AVATAR_UI_PORT_MARKER in the response body
    so we only reuse a listener that is actually serving avatar-page/index.html.
    """
    import urllib.request
    try:
        with urllib.request.urlopen(
            f"http://127.0.0.1:{port}/", timeout=0.8
        ) as resp:
            body = resp.read(4096).decode("utf-8", errors="replace")
            return AVATAR_UI_PORT_MARKER in body
    except Exception:
        return False


def _port_is_free(port: int) -> bool:
    """Return True if no socket is listening on (127.0.0.1, port)."""
    import socket
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.3):
            return False
    except Exception:
        return True


def _ensure_avatar_server() -> subprocess.Popen | None:
    """Start a local HTTP server for the avatar page if one isn't running.

    Walks AVATAR_UI_PORT_PREFERRED .. PREFERRED+MAX_TRIES-1 and either:
      • reuses an existing gstack avatar-page server (verified via marker), or
      • binds a brand-new http.server on the first port that is both free
        AND where the resulting bind serves our avatar-page/index.html.

    Updates module-level AVATAR_UI_PORT to whatever we ended up using, so
    subsequent /dispatch calls pass the right --avatar-port to runners.
    """
    global AVATAR_UI_PORT

    avatar_dir = ROOT / "avatar-page"
    if not (avatar_dir / "index.html").exists():
        print("[warn] avatar-page/ missing — avatar mode will not work",
              file=sys.stderr)
        return None

    last_proc: subprocess.Popen | None = None
    for offset in range(AVATAR_UI_PORT_MAX_TRIES):
        port = AVATAR_UI_PORT_PREFERRED + offset

        # Case 1: an avatar server is already serving here — reuse it.
        if _avatar_server_is_ours(port):
            AVATAR_UI_PORT = port
            print(f"  ✓ avatar page already serving on :{port}")
            return None

        # Case 2: something else owns this port — skip without disturbing it.
        if not _port_is_free(port):
            print(f"  · :{port} taken by something else (not gstack) — trying :{port + 1}")
            continue

        # Case 3: port looks free — try to bind a new server on it.
        log_path = LOG_DIR / f"avatar-server.{int(time.time())}.log"
        log_fh = open(log_path, "ab", buffering=0)
        proc = subprocess.Popen(
            [sys.executable, "-m", "http.server", str(port),
             "--bind", "127.0.0.1"],
            stdin=subprocess.DEVNULL,
            stdout=log_fh,
            stderr=log_fh,
            cwd=str(avatar_dir),
            start_new_session=True,
        )
        # Poll up to ~2s for the bind to land — http.server can be slow
        # to start on cold cache and `time.sleep(0.5)` was occasionally racy.
        for _ in range(20):
            time.sleep(0.1)
            if _avatar_server_is_ours(port):
                AVATAR_UI_PORT = port
                print(f"  ✓ avatar page started on :{port} (pid={proc.pid})")
                return proc
        # Bind raced or something else jumped in; tear it down and try next.
        try:
            proc.terminate()
        except Exception:
            pass
        last_proc = proc
        print(f"[warn] avatar page failed to start on :{port} — see {log_path}",
              file=sys.stderr)

    print(f"[warn] no usable avatar port found in "
          f"{AVATAR_UI_PORT_PREFERRED}..{AVATAR_UI_PORT_PREFERRED + AVATAR_UI_PORT_MAX_TRIES - 1}; "
          f"avatar-mode bots will render blank",
          file=sys.stderr)
    return last_proc


def _regen_specialists_js() -> None:
    """Regenerate specialists.js from data/specialists.json + data/teams.json.

    The dashboard's index.html reads `window.SPECIALISTS` + `window.TEAMS`
    synchronously at load time. To keep one source of truth without making
    the dashboard async, we regenerate the static JS bundle from JSON every
    time the server starts. Edit the JSON; restart the server; UI updates.
    """
    json_path  = ROOT / "data" / "specialists.json"
    teams_path = ROOT / "data" / "teams.json"
    out_path   = ROOT / "specialists.js"
    if not json_path.is_file():
        return  # JSON missing → leave the existing JS alone
    try:
        specs = json.loads(json_path.read_text())
        teams = json.loads(teams_path.read_text()) if teams_path.is_file() else []
    except Exception as e:
        sys.stderr.write(f"[warn] regen specialists.js skipped: {e}\n")
        return

    # Map JSON shape → dashboard JS shape (shorter field names, single
    # description, accent + glyph for the card UI).
    js_specs = []
    for s in specs:
        js_specs.append({
            "id":       s.get("id"),
            "name":     s.get("card_name", s.get("name")),
            "role":     s.get("role"),
            "desc":     s.get("desc_card", s.get("description")),
            "icon":     s.get("icon", ""),
            "glyph":    s.get("glyph", ""),
            "accent":   s.get("accent", "#9dff6b"),
            "category": s.get("category", "Misc"),
        })
    body = (
        "// AUTO-GENERATED from data/specialists.json + data/teams.json.\n"
        "// Edit the JSON; restart server.py to regenerate this file.\n"
        f"window.SPECIALISTS = {json.dumps(js_specs, indent=2, ensure_ascii=False)};\n"
        f"window.TEAMS = {json.dumps(teams, indent=2, ensure_ascii=False)};\n"
    )
    out_path.write_text(body, encoding="utf-8")


def main():
    if not BRIDGE.exists():
        print(f"[warn] bridge.py not found at {BRIDGE}", file=sys.stderr)
        print("       /dispatch will still respond, but the subprocess will fail.",
              file=sys.stderr)
    if not RUNNER.exists():
        print(f"[warn] specialist_runner.py not found at {RUNNER}", file=sys.stderr)

    # Regenerate the dashboard JS bundle from the canonical JSON so we
    # have one source of truth (data/specialists.json + data/teams.json).
    _regen_specialists_js()

    # Boot the avatar-page server on port 3000 so avatar-mode dispatch
    # always has a target to tunnel to. Skipped if already running.
    _ensure_avatar_server()

    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    url = f"http://{HOST}:{PORT}"
    print(f"\n  gstack × AgentCall — dashboard running")
    print(f"  → {url}")
    print(f"  logs → {LOG_DIR}\n")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n  shutting down")
        srv.shutdown()


if __name__ == "__main__":
    main()
