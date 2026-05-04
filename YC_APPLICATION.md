# Coding agent session — gstack × AgentCall


This is a transcript-with-commentary of a Claude Code session that built
**gstack × AgentCall**: a dashboard that turns every gstack specialist
(CEO, CSO, Eng Manager, QA, etc.) into a voice agent that joins your
Google Meet with a unique 3D avatar, hears the room, and responds in
character.

---

## Why we're attaching this one

Most coding-agent transcripts show the agent writing code in isolation.
This one is different. **We built the product *inside* the product.**

- Founder (Anand) joins a Google Meet from his laptop.
- Claude Code joins the same Meet as a voice bot via the [AgentCall](https://agentcall.dev) skill.
- The team (Anand + John K G + Anoop) talks; Claude hears the transcript via
  AgentCall's STT, plans, edits files, and replies with TTS — all
  inside the meeting.
- Specialists from the product (CEO, Staff Engineer) get dispatched into
  the same call to weigh in on their domain. They use the product on
  itself.

The transcript below is the engineering record of that session — every
real bug we hit, every fix we shipped, the security audit we ran in
parallel, and the docs we wrote in parallel. **The meeting *is* the dev
loop.**

If you want to see the recursion most clearly: we are pitching a tool
that lets a team build software in their meeting, and we built it inside
a meeting, and the founder asked the in-meeting CEO bot to critique the
pitch deck, and CEO's feedback shaped the next commit. That happened.

---

## The product, in 60 seconds

> **Bring your GStack team into the meeting.**

[GStack](https://github.com/garrytan/gstack) (Garry Tan, YC) is a Claude
Code skill pack: 18 named specialists — CEO, CSO, Eng Manager, QA,
Designer, Release Engineer, etc. — each one a slash-command persona
inside Claude Code. Powerful, but trapped in text.

[AgentCall](https://agentcall.dev) is voice infrastructure for AI
agents: a bot can join Google Meet / Zoom / Teams with a custom avatar
and TTS, hear the participants, and speak back.

**gstack × AgentCall** marries them. Dashboard at `localhost:8765`:
paste a Meet URL, click "Dispatch CEO Review," and within ~30s the CEO
specialist joins your meeting with the gstack mustache-character avatar,
introduces itself, then engages in character on whatever the team is
discussing. Six pre-built team presets ("Founding Team," "Design Team,"
"QA & Ship") let you drop a whole virtual department in at once.

**The wedge** is the recursion: a one-developer team can be a real
team. CEO challenges your strategy in the standup; CSO catches the auth
bug in the code review; QA pushes back when you say "ship it." Same
voice flow as a real meeting.

---

## What this session contains (the receipts)

The full transcript spans ~12 hours of intermittent collaboration over
several days. The artifacts that survived:

| Component | Lines | What it does |
|---|---:|---|
| `index.html` | 2200+ | Dashboard. Specialist grid, team presets, search, brief textarea, dispatch dock, session history, recall buttons. Pure stdlib, zero JS frameworks. |
| `server.py` | 720 | Stdlib HTTP server. `GET /` dashboard, `GET /avatars/<id>.svg`, `POST /dispatch`, `POST /recall`. Spawns `specialist_runner.py` per dispatched specialist. |
| `specialist_runner.py` | 540 | Wraps `bridge.py`/`bridge-visual.py`. Reads outbox from intelligence bus, writes inbox. Cross-bot speech lock with watchdog. |
| `avatars/gen.py` + 18× `*.svg` | 90 + assets | DiceBear-generated 3D-character avatars per specialist with role-color backgrounds. Generated deterministically from specialist id. |
| `avatar-page/` | static | Bot's video feed — runs in FirstCall's headless browser. Reads `?name=` from tunnel URL, picks the right avatar, plays TTS via Web Audio API. |
| `recap-page/` | static | Auxiliary page the CEO bot can screenshare during a recap. |
| `vendor/bridge.py`, `vendor/bridge-visual.py` | 31KB + 47KB | Vendored AgentCall bridges. Patched for `websockets>=13` API compat (`ws.closed` → `ws.state`). |
| `scripts/launch.sh` + `launch-visual.sh` + `kill-session.sh` | ~150 | Launcher shell scripts. Spawn bridge in background, tail cmds file as stdin, redirect output to per-session jsonl. |
| `README.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md`, `SECURITY.md` | 800+ | Written by sub-agents in parallel during the session. |

---

## Bugs we hit, debugged, and shipped — with file/line receipts

Eight real failures during the session. Each one started from a user
saying "it's broken" out loud in the meeting; ended with code committed
and the next dispatch verifying the fix.

### 1. The Next.js squatter (avatar tunnel was silently 404ing)

**Symptom.** CEO bot joined the meeting in avatar mode but the video tile
was blank. Avatar server log was empty — no requests from FirstCall's
headless browser.

**Diagnosis.**

```
$ lsof -iTCP:3000 -sTCP:LISTEN -n -P
Python  12593 anand   IPv4   TCP 127.0.0.1:3000 (LISTEN)   ← our avatar server
node    33669 anand   IPv6   TCP *:3000          (LISTEN)   ← Next.js dev server
```

A Next.js dev server from an unrelated project was bound to `*:3000` on
IPv6. macOS resolves `localhost` to the IPv6 listener first, so the
AgentCall tunnel was proxying to the Next.js process — which served its
own 404 page back to FirstCall's headless browser. Our avatar SVG never
got loaded.

**Fix.** Killed PID 33669; from then on `_ensure_avatar_server()` in
`server.py:632-668` logs the listener and warns if a stranger holds the
port.

**Verification.** Avatar log immediately showed
`GET /?name=CEO&ws=wss://api.agentcall.dev/v1/calls/.../ws/ui?call_token=ct_...`
followed by `GET /avatars/plan-ceo-review.svg` — and the gold mustache
character rendered in the meeting tile.

### 2. Avatar URL was absolute → broke the AgentCall tunnel path-prefix

**Symptom.** Even after fix #1, the avatar tile was a circular ring with
no character inside it.

**Diagnosis.** `avatar-page/index.html` returned `/avatars/<id>.svg` —
absolute path. AgentCall's tunnel serves our page under
`https://<tunnel>.conn.agentcall.dev/k/<key>/ui/`. An absolute
`/avatars/...` from FirstCall's browser resolves to the AgentCall domain
root, not our localhost.

**Fix.** `avatar-page/index.html:178` — switched to a relative
`avatars/${id}.svg` so the URL resolves through the tunnel back to our
local server.

**Verification.** Screenshot of the meeting taken via `screenshot`
command on the bridge: CEO's tile now shows the character.

### 3. AudioContext started suspended — TTS played silently

**Symptom.** `tts.done` events fired, the avatar's `voice.state` cycled
through "speaking", but participants heard nothing.

**Diagnosis.** `agentcall-audio.js` created `AudioContext` lazily inside
`playChunk()`. Modern Chrome and FirstCall's headless browser both
default it to `state === "suspended"` because there's no user gesture.
A suspended context happily queues `AudioBufferSourceNode` instances
that never play.

**Fix.** Two-line change.

```js
// avatar-page/agentcall-audio.js:88-101
this.ctx = new (window.AudioContext || window.webkitAudioContext)({
  sampleRate: this.sampleRate,
});
if (this.ctx.state === "suspended") {
  this.ctx.resume();              // ← the actual fix
}
```

Plus a primer block in `avatar-page/index.html:152-167` that constructs
the AudioContext on `DOMContentLoaded` and calls `.resume()` even
before any audio chunk arrives.

**Verification.** Next CEO dispatch — the meeting transcript itself
echoed the bot's greeting (`speaker: "CEO", text: "Hi, I'm the CEO from
GStack..."`) — proof that audio reached the meeting and STT picked it up.

### 4. Greeting fired before the bot was admitted from the lobby

**Symptom.** CEO joined a Meet with a lobby. `tts.done` fired ~20s
after spawn, but the participant never heard a greeting — and after
admission, no greeting fired either.

**Diagnosis.** `specialist_runner.py` had a 20s timeout-fallback that
called `greet_once("timeout-fallback")` regardless of whether the bot
had reached `call.bot_ready`. While stuck in the waiting room, the
bridge sent the TTS to the AgentCall server, which acknowledged it, but
there was no meeting audio context yet — so AgentCall returned
`tts.done` immediately and dropped the audio on the floor. After
admission, `greeted = True` short-circuited the real `greeting.prompt`
handler.

**Fix.** `specialist_runner.py:268-296`. Greeting only fires after
`bot_ready=True`. The fallback now polls every 2s, only triggers once
the bot is in the room, then waits 3s for the natural `greeting.prompt`
before firing.

**Verification.** Next dispatch's orchestrator log:

```
greeting (call.bot_ready): "Hi, I'm the CEO from gstack. ..."
[bridge] sending tts.speak
{"event": "tts.done"}
```

reason now `call.bot_ready` instead of `timeout-fallback`. Audio
reached the meeting.

### 5. websockets v13 API change broke the heartbeat (silently)

**Symptom.** Bridge orchestrator log showed
`AttributeError: 'ClientConnection' object has no attribute 'closed'`
in a background asyncio task. Tunnel and main WS still worked, so the
bot could join — but ping-pong was broken and after ~30s the tunnel
silently drifted.

**Diagnosis.** `vendor/bridge-visual.py:496-503` did
`while not self._ws.closed`. `websockets ≥ 13` removed the `.closed`
attribute and replaced it with `.state` (a `State` enum).

**Fix.** Compat shim that feature-detects.

```python
def _is_open(ws):
    if ws is None: return False
    if hasattr(ws, "closed"): return not ws.closed
    state = getattr(ws, "state", None)
    return state is None or getattr(state, "name", "") == "OPEN"
```

**Plus**: vendored both bridges into `vendor/` so future plugin
updates don't silently overwrite the patch. `scripts/launch.sh` and
`scripts/launch-visual.sh` prefer the vendored copy first.

### 6. Cross-bot speech collision (two CEOs talking simultaneously)

**Symptom.** Anand: *"there were two CEOs at the same time and they
were just talking at the same time. It was a disturbance."*

**Cause.** Each bridge has its own VAD (waits for human silence before
TTS), but VAD doesn't see *other bots*. Two specialists responding to
the same trigger talked over each other.

**Fix.** Filesystem-based cross-bot speech lock at
`/tmp/gstack-intelligence-<uid>/speaking.lock`. Format: `"<pid> <ts>".`
Acquire blocks up to 12s for the lock to clear. Self-healing — if the
holder PID is dead OR the lock is older than `TTS_MAX_HOLD = 12s`, the
next acquirer steals it. A per-runner watchdog thread also
force-releases its own stale lock if the bridge crashes mid-TTS.

`specialist_runner.py:347-410`. Verified by dispatching CEO + Eng Manager
and asking them the same question — they answered serially.

### 7. Server didn't have CSRF protection on `/dispatch` (security audit)

**Found by:** sub-agent we kicked off mid-call to do an OWASP/STRIDE
pass.

**Cause.** `server.py` accepts JSON POST with no Origin / Sec-Fetch-Site
check. A `<form enctype="text/plain">` from a phishing tab can be
shaped as parseable JSON (`json.loads` ignores Content-Type) and
trigger `/dispatch` against `localhost:8765` while the dev is on a
hostile page. The dev's machine then joins an attacker-controlled Meet
URL on the dev's API key.

**Fix.** `server.py:481-503` — `_csrf_ok()` rejects any POST whose
`Origin` is not `localhost:8765`/`127.0.0.1:8765`, and any `Sec-Fetch-Site`
that's not `same-origin`. Curl/python clients (no `Origin`, no `SFS`)
still work for the runner's own internal calls.

**Verified.**
```
$ curl -X POST -H 'Origin: https://evil.example' http://127.0.0.1:8765/dispatch -d '{}'
{"error": "cross-origin request blocked"}  HTTP 403
```

### 8. `meetUrl` accepted any URL → API-credit redirector

**Found by:** same security sub-agent.

**Cause.** `validate_meet_url` accepted any `https://*` URL. Combined
with #7 (or any future trigger), an attacker could repeatedly drive the
dev's API key against arbitrary hostnames.

**Fix.** `server.py:319-345` — host allow-list of
`meet.google.com`, `zoom.us` (+ subdomains), `teams.microsoft.com`,
`teams.live.com`, `webex.com`. `https://attacker.example` now returns
HTTP 400.

---

## What we ran in parallel during the call

While we kept iterating on the dashboard live, we kicked off two
sub-agent tasks in the background and kept the meeting flowing:

**Sub-agent 1 — Security audit (`SECURITY.md`).** OWASP Top 10 + STRIDE
pass over the codebase. **9 findings**, every one with a file:line, a
concrete attacker scenario, and a paste-ready fix. Top 3:

1. CSRF on `/dispatch` and `/recall` (HIGH) — fixed (#7 above).
2. `meetUrl` validator accepts any URL (HIGH) — fixed (#8 above).
3. Intelligence-bus outbox world-writable in `/tmp` (MEDIUM) — fixed
   by moving to `/tmp/gstack-intelligence-<uid>/` mode 0700.

We also fixed PID-spoof on `/recall` (subprocess argv check before
SIGTERM) and env-leak (subprocess env scrubbed to a 15-key allow-list,
so unrelated dev secrets — AWS, GitHub tokens — no longer reach
vendored third-party code).

**Sub-agent 2 — Docs (`README.md` + `ARCHITECTURE.md` + `CONTRIBUTING.md`).**
~620 lines of release-quality documentation. ASCII diagrams of the
process tree, avatar tunnel, and file bus. Lifecycle timeline. Component
walkthroughs with "what / why / could be replaced." Four extension
points spelled out. Vendored-bridge update flow with the `diff -u`
against upstream baked in.

Both sub-agents finished while we were still mid-call. No context
switch on our end. Real parallel coding-agent work.

---

## Architecture in one ASCII frame

```
   Anand           ┌────────────────────────────────────────────────────┐
   ───►            │     Google Meet — meet.google.com/wzx-edwn-chd     │
   Speaks          │                                                    │
   into mic        │   [Anand]  [Claude]  [CEO bot]  [Eng Mgr bot]      │
                   └─────────▲─────────────▲───────────────▲────────────┘
                             │             │               │
                  AgentCall WSS tunnel + TTS audio injection (mode webpage-av)
                             │             │               │
   ┌─────────────────────────┴───┐ ┌───────┴───┐ ┌─────────┴─────────┐
   │  vendor/bridge-visual.py     │ │ runner    │ │ runner            │
   │   ⇡ tunnels port 3000 ──┬───►│ │ (CEO)     │ │ (Eng Manager)     │
   │   ⇡ subscribes /ws/ui   │    │ └─┬─────────┘ └─┬─────────────────┘
   │   ⇡ sends tts.speak     │    │   │             │
   └─────────────────────────│────┘   │ outbox tail │ outbox tail
                             │        ▼             ▼
                             │   /tmp/gstack-intelligence-<uid>/
                             │     ├── inbox.jsonl          (transcripts in)
                             │     ├── outbox/<id>.jsonl    (replies out)
                             │     └── speaking.lock        (cross-bot mutex)
                             │              ▲
   ┌─────────────────────────▼─┐            │ Claude Code session reads
   │  avatar-page/ (port 3000) │            │ inbox, decides reply, writes
   │  index.html + audio.js    │            │ outbox per specialist
   │  + 18 character SVGs      │            │
   └───────────────────────────┘            │
                                            │
   ┌────────────────────────────────────────┴──────────┐
   │   server.py (port 8765)                           │
   │   GET / dashboard          POST /dispatch         │
   │   GET /avatars/<id>.svg    POST /recall           │
   │   ⇡ CSRF guard, meetUrl host allow-list, env-scrub│
   └───────────────────────────────────────────────────┘
```

---

## Why this is fundable, in the in-meeting CEO's own words

The CEO bot — running on this codebase — was asked by the founder to
critique the pitch *during* the build session. Verbatim from the live
transcript (`/tmp/gstack-intelligence-503/inbox.jsonl`):

> **Wedge:** Pick one painful job. Note-taking, dev standups, sales
> recaps, customer success — own one before going wide.
>
> **Frame:** "Bring your own AI teammate." Zoom owns the meeting; you
> own the brain that joins.
>
> **One-liner:** "Ship code with your AI team in the meeting." A verb,
> not a feature.
>
> **Demo:** 90-second Loom showing one developer doing the work of five.
>
> **Three to nail before raising:**
> 1. *Distribution* — How does a dev hear about it Tuesday and have it
>    in standup Wednesday?
> 2. *Pricing* — per-seat or per-meeting? Tells investors which game.
> 3. *Enemy* — replacing the notetaker, the teammate, or the PM? Pick
>    one. Hiding loses the round.

That advice came from the product. The next commit (`recap-page/index.html`)
turned it into a slide the bot can screenshare.

---

## Try it yourself in 60 seconds

```bash
git clone https://github.com/<your-handle>/gstack-v2  # to be public for the application
cd gstack-v2
python3 server.py                                      # starts dashboard + avatar server
# open http://localhost:8765
# paste a Meet URL → click "Dispatch CEO Review"
# admit the bot from the Meet lobby
# the CEO joins, greets you, and engages.
```

Prerequisites: Python 3.10+, an `AGENTCALL_API_KEY` at
`~/.agentcall/config.json` (free tier on agentcall.dev). Zero JS deps,
zero Python deps outside stdlib.

---

## What's still pending (transparent backlog)

- Wire screenshare into every specialist runner (currently only Claude
  bridge can screenshare; CEO can speak the recap but not show it).
- Architecture simplification pass — collapse the four hand-maintained
  copies of the name→id mapping into one source of truth.
- Live-data pipeline for `recap-page/` (currently hardcoded sample).
- Hosted version of the dashboard (currently `localhost`-only by design).

---

## What we're asking YC reviewers to take away

1. **Velocity.** A two-person team shipped this in a few sessions —
   dashboard, 18 specialist personas, voice + avatar mode, security
   audit, full docs — using a coding agent that participated in the
   meetings as a teammate.
2. **Recursive demo.** The product builds the product. Every change in
   the transcript above happened during a real meeting where Claude was
   one of the speakers.
3. **Real bugs, real fixes.** Eight production-grade bugs caught and
   shipped during the session, each with a citation a reviewer can
   verify in the repo.
4. **Security & docs done in parallel** — same session, sub-agents
   running concurrently. No "we'll get to it after launch."

This is what the dev loop looks like when your team includes specialists
in the meeting. **GStack × AgentCall is the tool that makes that loop
the default.**
