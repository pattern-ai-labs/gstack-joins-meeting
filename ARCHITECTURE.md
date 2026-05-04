# Architecture

This is the deep-dive companion to `README.md`. Read this when you want to know *why* the directory looks like this, what each process does, and where the seams are.

The whole system is four processes deep:

```
browser ──► server.py ──► specialist_runner.py ──► bash launch[-visual].sh ──► bridge[-visual].py
                                                                                    │
                                                                                    ▼
                                                                              AgentCall cloud
                                                                                    │
                                                                                    ▼
                                                                              Google Meet
```

Plus one sidecar:

```
                              python3 -m http.server :3000   (avatar-page/)
                                          ▲
                                          │ HTTPS tunnel from AgentCall
                                          │
                                  bridge-visual.py
```

And one pair of files that act as a bus:

```
        /tmp/gstack-intelligence/
          inbox.jsonl                  ◄── listener runner appends user.message
          outbox/<spec_id>.jsonl       ◄── brain (e.g. Claude session) appends replies
          speaking.lock                ◄── cross-bot speech mutex (PID + ts)
```

The rest of this doc walks each box.

---

## Component-by-component

### `server.py` — dashboard + dispatcher

Stdlib `ThreadingHTTPServer` on `127.0.0.1:8765`. Three routes:

- `GET /`, `GET /index.html`, `GET /specialists.js` — static.
- `GET /avatars/<id>.svg` — serves per-specialist DiceBear SVG. Path-traversal hardened (alnum + `-_` only).
- `POST /dispatch` — body `{meetUrl, specialists: [...], brief?, mode?}`. Spawns one `specialist_runner.py` subprocess per id.
- `POST /recall` — body `{specialists: [...]}` or `{all: true}`. Sends SIGTERM to matching tracked PIDs.

State lives in two files:

- `/tmp/gstack-specialists/active.json` — the canonical list of live runners (id, pid, name, ts, log path) + the active `session_dir`. `record_dispatch()` prunes dead PIDs every write.
- `sessions/session-<unix-ts>/` — per-dispatch dir holding `<id>.cmds`, `<id>.jsonl`, `orchestrator.log`, `session.pid`.

The dispatch loop reuses the active `session_dir` if any runner is still alive — that's how "add a CSO mid-meeting" works without spawning a parallel session. Only the *first* runner in a fresh session is flagged `--listener`; subsequent dispatches into the same session get `--listener=False` and stay silent on the bus.

`SPECIALISTS` (Python dict) is the server-side source of truth — name, role, description, voice. It must stay in sync with `specialists.js` (same ids, same display names). Both files are 18 entries; both get edited for any persona change. See `CONTRIBUTING.md`.

The avatar sidecar server is started lazily by `_ensure_avatar_server()` on `server.py` boot. It checks `127.0.0.1:3000` first, only spawns if nothing is bound. This makes restarting `server.py` safe.

**Could be replaced.** Anything that can read JSON and shell out to a Python script. The reason it's stdlib is so a Show HN reader can clone and run with zero pip install.

### `specialist_runner.py` — one supervisor per bot

This is the supervisor that the boardroom architecture inspired. Each runner:

1. Spawns `bash scripts/launch.sh` (audio mode) or `bash scripts/launch-visual.sh` (avatar mode). The bash script in turn spawns `bridge.py` with `tail -n 0 -f <id>.cmds` as stdin via process substitution. Critical detail: `subprocess.Popen` for bash must NOT pipe stdout — `tail` inherits the shell's stdout fd and would block the parent forever if Python tried to drain it. Output goes to `orchestrator.log`.
2. Tails `<session_dir>/<id>.jsonl` (the bridge's event stream). On `call.bot_ready` or `greeting.prompt` it greets once. On `participant.joined` (after self-join is observed) it greets if it hasn't already. On `tts.done|error|interrupted` it releases the speech lock. On `call.ended` it sets `shutting_down`.
3. Tails `/tmp/gstack-intelligence/outbox/<id>.jsonl` and converts each `{text, voice?}` line into `{"command":"tts.speak", ...}` appended to the cmds file. Acquires the cross-bot speech lock first.
4. **Listener only**: on `user.message`, drops events whose `speaker.name` matches any known specialist/host display name (echo filter), then appends to `/tmp/gstack-intelligence/inbox.jsonl` with full context (`specialist_id`, `role`, `description`, `brief`, `speaker`, `text`).
5. On SIGTERM/SIGINT: appends `{"command":"leave"}` to cmds, sleeps 2s for the bridge to emit `call.ended`, then `os._exit(0)`.

**Could be replaced.** With a long-running asyncio supervisor, or a Go binary. The reason it's a Python file with two `threading.Thread` tails is that file-tailing is the simplest correctness boundary across language and process restarts: a runner crash leaves the cmds and event files intact, so a new runner can pick up where it left off.

### `scripts/launch.sh` and `scripts/launch-visual.sh`

Bash adapters. They:

- Locate `bridge.py` / `bridge-visual.py` in the vendored copy first, then upstream skill paths.
- `mkdir -p` the session dir, ensure `<id>.cmds` and `<id>.jsonl` exist.
- `exec python3 bridge.py "$URL" --name "$BOT" --voice "$VOICE" --output "$OUT" < <(tail -n 0 -f "$CMDS") >> "$LOG" 2>&1 &` — fork-and-disown the bridge with cmds tailed into stdin and combined stdio appended to `orchestrator.log`.
- Append the bridge PID to `session.pid` (read by `kill-session.sh`) and exit immediately.

The reason these are bash (not Python) is the `< <(tail -n 0 -f CMDS)` process substitution. Doing the equivalent in Python would require reimplementing `tail -n 0 -f` semantics across an OS pipe, which is the bug we got bitten by in v1. Bash does it natively in one line.

### `scripts/kill-session.sh`

Emergency teardown. Loops every `<session_dir>/*.cmds` and appends `{"command":"leave"}`, sleeps 5s, SIGTERMs every PID in `session.pid`, sleeps 2s, SIGKILLs survivors, reports stragglers via `pgrep -f "$SESSION"`. Use this when `/recall` doesn't take.

### `vendor/bridge.py` and `vendor/bridge-visual.py`

These are vendored copies of the AgentCall `join-meeting` skill's bridges. The launchers prefer them over the user's installed copies for two reasons:

1. **Reproducibility for Show HN readers.** The repo has to work offline-of-our-account — cloning shouldn't require a specific skill version installed.
2. **Patches.** We ship a couple of small fixes (mostly around the destination flag in avatar mode and the AudioContext.resume timing). Pinning a known-good copy means the user's auto-updated skill version can't break our flow without us noticing.

The bridges themselves are stdin/stdout JSON protocols around AgentCall's WebSocket. Events out (`call.bot_ready`, `participant.joined`, `user.message`, `tts.done`, `transcript.partial`, `call.ended`); commands in (`tts.speak`, `send_chat`, `screenshare.start`, `leave`). They have NO LLM. The runner is the only thing that decides what to say.

`vendor/tunnel.py` is the shared tunnel client used by `bridge-visual.py` to expose `localhost:3000` to AgentCall.

### `index.html` + `specialists.js`

Single-page dashboard. ~2100 lines total of HTML/CSS/vanilla JS. No framework, no bundler. Specialist cards, team presets, search, category filter, brief textarea (500-char cap, mirrored server-side), session history (in-memory, last 30 events), and the dispatch/recall buttons.

`specialists.js` is the shared metadata source for the client (id, name, role, desc, icon, glyph, accent, category). The server's `SPECIALISTS` dict is the same data minus styling. Same ids, same names. Edits to one need an edit to the other.

### `avatar-page/`

The HTML rendered as each bot's video feed in avatar mode.

- `index.html` — circular avatar with seven voice states (`listening`, `actively_listening`, `thinking`, `waiting_to_speak`, `speaking`, `interrupted`, `contextually_aware`). State driven by `voice.state` events on the WebSocket. Avatar image picked from `?name=<display_name>` via the `SPECIALIST_ID_BY_NAME` map → `avatars/<id>.svg`.
- `agentcall-audio.js` — the `AgentCallAudio` class. Decodes base64 24kHz PCM chunks from `tts.webpage_audio`, schedules them gaplessly into one shared `AudioContext`, tracks sentence index/text/duration so an interruption (`transcript.partial` while playing) can report which sentence got cut and where. Critical detail: the `AudioContext` starts `suspended` in headless Chrome (no user gesture); we explicitly `.resume()` on construction *and* primed on page load. Without this, every queued buffer plays silently and the meeting hears nothing.
- `preview.html` — local-only grid showing all 18 avatars. Useful for visual QA.
- `avatars` — symlink to `../avatars/` so the same SVGs are reachable through the tunnel.

### `avatars/`

Per-specialist 3D-character SVGs (DiceBear `lorelei`, deterministic seed = specialist id, background = the dashboard accent color) plus glyph fallbacks (`glyph-<id>.svg`). Generated by `avatars/gen.py`; rerun if you change accents.

### `recap-page/`

A standalone HTML "live recap" template (currently just CEO output). Designed to be screenshared into the meeting via `screenshare.start` — the CEO bot can pull a generated recap up on the screen as it talks. Not wired to live data yet; this is the static design target.

---

## Lifecycle: dispatch → speak → recall

```
t=0     POST /dispatch {meetUrl, specialists:["plan-ceo-review","cso"], brief:"..."}
        server.py picks/creates session_dir, marks index 0 (CEO) as --listener.
        Spawns specialist_runner.py × 2.
        Returns {pids, sessionDir, dispatched:[…]} 200.

t≈0.5s  Runner #0 (CEO, listener=True) execs bash scripts/launch-visual.sh.
        launch-visual.sh forks bridge-visual.py, returns rc=0.
        Runner starts events_tail and outbox_tail threads.

t≈3s    bridge-visual emits call.bot_joining_meeting, then call.bot_waiting_room.

t≈8s    Bot admitted. bridge emits call.bot_ready.
        events_tail fires greet_once("call.bot_ready").
        Runner appends {"command":"tts.speak", "text":"Hi, I'm the CEO from gstack..."}
          to <id>.cmds.
        bridge speaks via webpage_audio → avatar-page plays.

t≈9s    Same for runner #1 (CSO, listener=False).

t=ongoing
        bridge-visual emits user.message events whenever a human speaks.
        Runner #0 (listener) writes them to /tmp/gstack-intelligence/inbox.jsonl.
        Runner #1 sees them too but ignores (not listener).

        Some external process (Claude session, scripted policy, anything that
        tails inbox.jsonl) writes a reply to outbox/cso.jsonl:
          {"text": "Threat-model that login flow before merge."}
        Runner #1's outbox_tail picks it up, acquires the speech lock,
        appends tts.speak to <id>.cmds. CSO speaks. tts.done releases lock.

t=teardown   POST /recall {all:true}
        server.py SIGTERMs both runner PIDs.
        Each runner appends {"command":"leave"}, waits 2s, exits.
        bridge-visual emits call.ended.
        active.json prunes both entries.
        With no live runners, the next dispatch starts a fresh session_dir.
```

---

## The intelligence bus

The bus is one inbox file plus N outbox files plus one lock file. It is intentionally not a service. There is no daemon. There is no schema validator. The whole point is that you can `tail -F /tmp/gstack-intelligence/inbox.jsonl | your-brain.sh` and pipe anything you want into `/tmp/gstack-intelligence/outbox/<id>.jsonl`.

A "brain" in this architecture is anything that:

1. Reads new lines from `inbox.jsonl`. Each line has `{ts, specialist_id, name, role, description, brief, speaker, text}`. The `specialist_id` field is the listener's id — typically the first specialist dispatched. Use it as a pointer for who's hearing what.
2. Decides what to say from which bot.
3. Appends `{text: "...", voice?: "..."}` (one per line) to `/tmp/gstack-intelligence/outbox/<spec_id>.jsonl`.

The reference brain is a Claude Code session: the user opens a terminal in the gstack repo, runs the slash command for the persona they want, and Claude tails the inbox. That's it. No SDK call, no auth dance — the runner does the meeting plumbing, Claude does the thinking.

**Could be replaced.** With Redis, Kafka, gRPC, sockets. Files are the smallest credible thing and the only thing that survives a runner crash without a server to redrive.

---

## Cross-bot speech lock

Newly shipped. Without it, two bots will start speaking on top of each other the moment the brain pushes simultaneous outbox lines.

```python
# specialist_runner.py
self.speech_lock_path = BUS_DIR / "speaking.lock"   # one file, all bots

def _acquire_speech_lock(self, max_wait=12.0):
    # Lock contents: "<pid> <unix_ts>\n"
    # Steal if PID dead OR ts > 15s old (TTS budget = ~15s/sentence).
    # Otherwise poll every 100ms until free or deadline.
```

Acquired in `_outbox_tail` right before appending `tts.speak` to cmds. Released in `handle_event` on `tts.done|tts.error|tts.interrupted`. Crash-resilient because the steal-after-15s rule guarantees no permanent deadlock — at worst the room goes quiet for 15s if a runner dies mid-utterance.

This is filesystem-based on purpose: every runner already has the bus dir mounted, no extra dependency. The cost is best-effort semantics — two runners can race to write the lock in the same 100ms tick. In a 6-bot meeting that's still rare enough to ignore; if it bites, swap to `fcntl.flock` on the same file.

---

## Avatar-page tunnel + AudioContext.resume nuance

The avatar mode is the most-fiddly part of this repo. The chain is:

```
specialist_runner --mode avatar
  → launch-visual.sh
    → bridge-visual.py --ui-port 3000
      → bridge-visual asks AgentCall to allocate a tunnel hostname
      → AgentCall returns wss://<key>.agentcall.dev/k/<key>/ui/
      → AgentCall's headless Chrome opens that URL
      → that URL forwards to http://127.0.0.1:3000/?name=<bot>&ws=<wsURL>
      → which is avatar-page/index.html, served by Python's http.server
      → which loads agentcall-audio.js
```

Two non-obvious things:

1. **Relative avatar paths.** `index.html` does `avatarFor(name) → "avatars/" + id + ".svg"`. The leading-slash version goes to AgentCall's domain, not your localhost — broken. Relative path resolves through the tunnel. Don't "fix" it.
2. **AudioContext.resume.** The headless Chrome that AgentCall uses has no user gesture, so any `new AudioContext()` starts in `suspended` state. Suspended contexts queue source nodes silently — `source.start(t)` is accepted, no error fires, but no audio is heard. We `.resume()` on construction *and* on page load. If you're debugging "avatar shows up but says nothing," this is always why.

The `dbg("audioctx-...")` beacons in `index.html` ping `/dbg.gif?audioctx=<state>` so you can read the state in the avatar-server access log. AgentCall's headless Chrome has no devtools you can open from outside.

---

## Why bridge*.py is vendored

The `vendor/` copies of `bridge.py` and `bridge-visual.py` exist because:

1. The upstream AgentCall `join-meeting` skill auto-updates inside `~/.claude/skills/`. Pinning a working copy in this repo means a Show HN reader cloning today gets the same behavior we tested. If we relied on the live skill, an update mid-presentation could break us.
2. We have a small set of patches — most are timing fixes around the suspended-AudioContext problem and the destination-flag default. Vendoring lets us keep them under version control without running a fork of AgentCall.
3. The launchers still prefer vendored over installed (`vendor/` first, then the `~/.claude/skills/...` paths). If you want to use a newer upstream copy, set `BRIDGE_SCRIPT=/path/to/bridge.py` (or `BRIDGE_VISUAL_SCRIPT=...`) before running `server.py`.

The diff between vendored and upstream should be small and obvious. See `CONTRIBUTING.md` for the diff-against-upstream check.

---

## Where to extend

### Add a new specialist

Three places, in order:

1. `specialists.js` — append a card definition (`id`, `name`, `role`, `desc`, `icon`, `glyph`, `accent`, `category`).
2. `server.py` — append to the `SPECIALISTS` dict (`name`, `role`, `description`, `voice`).
3. `avatar-page/index.html` — append to the `SPECIALIST_ID_BY_NAME` map (display name → id).
4. `avatars/gen.py` — append the row to `SPECIALISTS` and rerun `python3 gen.py` to fetch the DiceBear SVG.

Run, click, watch them join.

### Add a new persona variant

Just an `id` and a `description` change in `server.py` + `specialists.js` is enough — the description is the second sentence of the bot's intro, so a different description = a different persona. Voice can be reused across personas (multiple bots use `am_michael`).

### Add a new mode

The `--mode` flag is currently `audio` or `avatar`. A new mode (e.g., `screenshare-recap`, `chat-only`) means:

1. A new `scripts/launch-<mode>.sh` that invokes the right bridge with the right flags.
2. A branch in `specialist_runner.py:start_bridge()` that picks that script.
3. A whitelist entry in `server.py:_handle_dispatch()`'s mode parser.
4. Optionally a new `vendor/bridge-<mode>.py` if the AgentCall flags are different enough.

The webpage modes (`webpage-audio`, `webpage-av`, `webpage-av-screenshare`) are already supported by `bridge-visual.py`; `recap-page/` is a half-built target for a screenshare mode where the bot pulls up a live HTML recap as it speaks. That's the natural next mode.
