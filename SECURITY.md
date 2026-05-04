# Security review — gstack-v2

This is a developer-tool prototype that serves a localhost dashboard, spawns subprocesses to drive third-party meeting bots, and tunnels a local HTTP page out through AgentCall's WebSocket relay so it can be rendered as a video feed inside Google Meet / Zoom / Teams. The realistic attacker is **a malicious web page the developer happens to be visiting at the same time as `server.py` is running** (cross-origin requests against `127.0.0.1:8765`), or **a crafted payload smuggled through the meeting transcript / Claude session into the bot's outbox file**. The codebase already escapes HTML in the dashboard, validates specialist ids against a fixed allow-list, and quotes all subprocess arguments — there is no straightforward command-injection or stored-XSS path. The findings below are the ones that survive the "name a real attacker performing the action" filter.

---

## 1. `/dispatch` and `/recall` lack any CSRF / Origin defense — **HIGH**

**File:** `server.py:407-543` (`do_POST`, `_handle_dispatch`, `_handle_recall`)

The HTTP server binds to `127.0.0.1` but accepts POST JSON with no `Origin` / `Sec-Fetch-Site` check, no CSRF token, and no auth. A browser will preflight `application/json` POSTs, but a `<form enctype="text/plain">` submission can be shaped as parseable JSON (`json.loads` ignores the content-type), making this CSRFable. **Scenario:** the developer is running `python3 server.py` on their laptop, visits a phishing page in another tab, the page submits a form to `http://127.0.0.1:8765/dispatch` with a `meetUrl` pointing at the attacker's own Google Meet, and the developer's machine joins it as a bot — billing the developer's AgentCall key and exposing whatever the LISTENER forwards to `/tmp/gstack-intelligence/`.

**Fix:**
```python
# In do_POST, before dispatching:
origin = self.headers.get("origin", "")
if origin and origin not in (f"http://{HOST}:{PORT}", f"http://localhost:{PORT}"):
    return self._send_json(403, {"error": "bad origin"})
sec_fetch_site = self.headers.get("sec-fetch-site", "")
if sec_fetch_site and sec_fetch_site not in ("same-origin", "none"):
    return self._send_json(403, {"error": "cross-site request blocked"})
```

---

## 2. `meetUrl` validator accepts any http(s) URL → bot redirector / API-key exhaustion — **HIGH**

**File:** `server.py:319-324` (`validate_meet_url`)

`validate_meet_url` returns `True` for anything with an `http`/`https` scheme and a netloc — `https://attacker.example/`, `https://meet.google.com.evil.com/abc`, etc. AgentCall's API will reject obviously-non-meeting URLs, but combined with the CSRF gap (#1) or any future endpoint that lets a third party trigger dispatch, this lets an attacker repeatedly drive the developer's API key against arbitrary URLs (rate-limit / quota abuse). Even without CSRF, dispatch is a funnel that spends paid credits, and the host check is the natural place to cap it.

**Fix:** restrict to known meeting hosts (paste-ready):
```python
ALLOWED_MEET_HOSTS = (
    "meet.google.com", "zoom.us", "teams.microsoft.com",
    "teams.live.com", "us02web.zoom.us", "us04web.zoom.us",
    "us05web.zoom.us", "us06web.zoom.us",
)
def validate_meet_url(url: str) -> bool:
    try:
        p = urlparse(url)
        host = (p.hostname or "").lower()
        return p.scheme == "https" and (
            host in ALLOWED_MEET_HOSTS or host.endswith(".zoom.us")
        )
    except Exception:
        return False
```

---

## 3. Intelligence-bus outbox is a trust boundary that nothing checks → arbitrary TTS injection — **MEDIUM**

**File:** `specialist_runner.py:402-435` (`_outbox_tail`)

Any process that can write to `/tmp/gstack-intelligence/outbox/<id>.jsonl` can append `{"text": "<anything>", "voice": "<anything>"}` and the running listener will read the line and call `tts.speak` in the live meeting. `/tmp` is world-readable on macOS by default and any user-level process (a stray script, a compromised dev tool, an unrelated MCP server) can write there. **Scenario:** while the developer is in a customer call with the CSO bot active, a piece of malicious JS that earlier got code execution as the user's UID writes a damaging line ("we are going to delete your data tonight") to the outbox — the bot speaks it in the developer's voice/avatar.

**Fix:** move the bus into a per-user, mode-700 dir so other users can't write, and reject lines whose `text` exceeds a sane budget:
```python
BUS_DIR = Path(tempfile.gettempdir()) / f"gstack-intelligence-{os.getuid()}"
BUS_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
os.chmod(BUS_DIR, 0o700)  # tighten if it already existed
# ...later, in _outbox_tail, after parsing msg:
text = (msg.get("text") or "").strip()[:2000]
```

---

## 4. PID file is trusted blindly during `/recall` — **MEDIUM**

**File:** `server.py:331-370` (`recall`) and `server.py:240-255` (`_pid_alive`)

`/recall` reads `/tmp/gstack-specialists/active.json`, takes whatever integer is in `pid`, and calls `os.kill(int(pid), signal.SIGTERM)`. There is no check that the PID belongs to a process this server actually spawned (no parent check, no cmdline match, no creation-time match). Combined with #1 and PID re-use, a CSRF-driven `/recall` shortly after a system reboot could SIGTERM unrelated processes whose PIDs happen to match what was stored before the reboot.

**Fix:** before killing, confirm the cmdline contains `specialist_runner.py` or that the process group matches what we created. Quickest patch:
```python
import psutil  # or read /proc on Linux / `ps -p` on macOS
def _is_our_runner(pid: int) -> bool:
    try:
        p = psutil.Process(int(pid))
        return any("specialist_runner.py" in c for c in p.cmdline())
    except Exception:
        return False
# in recall(): if not _is_our_runner(pid): continue
```
If pulling in `psutil` is unwanted, store and verify the runner's *creation time* alongside the pid (also via `psutil.Process(pid).create_time()`).

---

## 5. Subprocess inherits the entire parent environment, including the API key — **MEDIUM**

**File:** `server.py:307-315` (`subprocess.Popen(..., env=os.environ.copy(), ...)`) and `specialist_runner.py:213` (same pattern in `start_bridge`)

`AGENTCALL_API_KEY` is propagated by `os.environ.copy()` into every spawned `bridge.py` / `bash launch.sh`. That part is intentional — the bridge needs it. But every *other* env var on the developer's shell (AWS keys, GitHub tokens, OpenAI keys, etc.) is also handed to a third-party vendored bridge that opens an outbound WebSocket to `api.agentcall.dev`. If that vendored code is ever compromised, every secret in the dev's shell goes with it.

**Fix:** pass only the variables the bridge actually needs, with everything else explicitly stripped:
```python
SAFE_KEYS = {"PATH", "HOME", "LANG", "LC_ALL", "PYTHONUNBUFFERED",
             "AGENTCALL_API_KEY", "AGENTCALL_API_URL"}
clean_env = {k: v for k, v in os.environ.items() if k in SAFE_KEYS}
proc = subprocess.Popen(cmd, env=clean_env, ...)
```

---

## 6. API key embedded in WebSocket URL query string is leaked through logs — **MEDIUM**

**File:** `vendor/bridge.py:240-243` (`connect_ws`) and `vendor/bridge-visual.py:243-245`

The bridge connects with `wss://...?api_key=<KEY>`. `aiohttp`/`websockets` write the URL to stderr on connect/reconnect failures, and `specialist_runner.py:206-214` redirects the bridge's stderr into `<session_dir>/orchestrator.log`. Anyone the dev later shares a session log with (filing a bug, pasting it in Slack, attaching to a GitHub issue from inside an MIT-licensed clone) hands over a working API key.

**Fix:** authenticate via header, not query string. In `vendor/bridge.py:240-243`:
```python
self.ws = await websockets.connect(
    f"{ws_url}/v1/calls/{call_id}/ws",
    additional_headers=[("Authorization", f"Bearer {API_KEY}")],
)
```
This is also a vendored-third-party file — if upstream won't accept the change, at minimum scrub `?api_key=` out of `emit_err` log lines before they are written.

---

## 7. `~/.agentcall/config.json` has no permission check on read — **LOW**

**File:** `vendor/bridge.py:103-116`

`bridge.py` reads `~/.agentcall/config.json` with no check that the file is mode 0600. If the user's home dir is on a shared volume (corporate macOS, dev container with a mounted home), the API key file may be world-readable. The bridge silently uses it anyway.

**Fix:** warn on insecure permissions before using the key. In `vendor/bridge.py` after `_config = json.loads(...)`:
```python
mode = _config_path.stat().st_mode & 0o777
if mode & 0o077:
    emit_err(f"WARNING: {_config_path} is mode {oct(mode)}; chmod 600 recommended")
```

---

## 8. `record_dispatch` writes JSON to `/tmp/gstack-specialists/active.json` non-atomically across users — **LOW**

**File:** `server.py:202-205` (`_save_active`)

`/tmp/gstack-specialists/` is created mode 0777 (directory default — `mkdir(parents=True, exist_ok=True)`), so on a multi-user macOS / Linux box another local user can replace `active.json` between `_load_active` and `_save_active`, causing `/recall` to act on attacker-supplied PIDs (interacts with finding #4). On a single-user dev laptop this is moot; for an MIT prototype that may run on shared CI runners it is not.

**Fix:** create the dir under the user's tempdir with mode 0700:
```python
LOG_DIR = Path(tempfile.gettempdir()) / f"gstack-specialists-{os.getuid()}"
LOG_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
os.chmod(LOG_DIR, 0o700)
```
Same pattern fixes BUS_DIR (#3) — they should use the same mechanism.

---

## 9. README / open-source release should warn users about port 8765 exposure on shared networks — **LOW (process)**

**File:** `README.md`, `server.py:41-42`

The server binds 127.0.0.1, which is correct, but `_ensure_avatar_server` spawns `python -m http.server 3000 --bind 127.0.0.1` whose access log records every tunnel-proxied request — including the `dbg.gif?...` beacons from `agentcall-audio.js:98` and `avatar-page/index.html:214-219`, which include the AgentCall WS URL prefix and audio-context error messages. Other users running `lsof` / `ps` on the same box can see these. This is informational, but the README should call out that running this on a multi-tenant box (jump host, lab machine) leaks request metadata to anyone who can read process output.

**Fix:** add a "Threat model" section to `README.md` stating "designed for a single-user dev machine; do not run on shared hosts," and consider stripping query-string from the avatar-server access log or silencing it.
