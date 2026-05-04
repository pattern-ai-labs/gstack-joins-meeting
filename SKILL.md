---
name: gstack-agentcall
description: Bring GStack specialists into a Google Meet / Zoom / Teams call as voice bots. Use this skill when the user asks to "bring the CEO / CSO / QA / Eng Manager into the meeting", "dispatch the design team", "have a specialist review my pitch live", or otherwise wants a GStack persona to join a real meeting with a 3D avatar and respond in character. Each specialist becomes a separate participant in the call, hears the room, and engages on its domain. Built on top of AgentCall (agentcall.dev) and the gstack roster (github.com/garrytan/gstack).
---

# gstack-agentcall — voice specialists in the meeting

This skill lets Claude Code dispatch any GStack specialist into a live
Google Meet / Zoom / Teams call as a voice bot. Each specialist joins
as its own meeting participant with a unique 3D avatar, hears the
room, and replies in character through TTS.

**18 specialists are pre-defined** — full list in `data/specialists.json`:

| Role | Voice | Glyph |
|---|---|---|
| CEO / Founder | am_adam | ♛ |
| Engineering Manager | bm_george | ⎇ |
| Senior Designer | af_sarah | ◈ |
| Chief Security Officer | am_michael | ⛨ |
| QA Lead | af_sarah | ✓ |
| Staff Engineer (code review) | bm_lewis | ⌘ |
| Debugger | am_adam | ⌕ |
| YC Office Hours Partner | am_michael | YC |
| Release Engineer | bm_george | ▲ |
| …and 9 more (Design Partner, DX Lead, Designer Who Codes, etc.) |

**6 team presets**: Founding Team, Design Team, Build & Review,
QA & Ship, DX Team, Retro. Drop the whole team in with one call.

---

## When to invoke this skill

Trigger phrases (any of these):

- "bring the CEO into this meeting"
- "have the QA team review what we're building"
- "dispatch the engineering manager"
- "let me get a security review of this — bring CSO"
- "send the founding team to my standup"
- "bring my GStack team into the call"
- "recall all the specialists" / "get everyone out of the meeting"

**Do NOT** invoke this skill for:
- Just running gstack slash commands locally (those are `/cso`, `/review`,
  etc. inside the gstack skill itself — text only, no voice bot).
- Generic AgentCall use (joining a meeting as Claude itself — use the
  `agentcall` / `join-meeting` skill for that).

---

## Prerequisites the skill expects

1. **AgentCall API key** at `~/.agentcall/config.json` or
   `$AGENTCALL_API_KEY`. Sign up at https://agentcall.dev.
2. **The repo cloned somewhere on disk.** The install script (below)
   symlinks it under `~/.claude/skills/gstack-agentcall/`.
3. **Python 3.10+.** No Python deps outside stdlib.
4. **The user is the host of the meeting** — bots arrive in the lobby
   and must be admitted.

---

## How Claude should run this skill

### Step 0 — make sure the dashboard server is up

The skill assumes a local HTTP server on port `8765` exposing
`POST /dispatch` and `POST /recall`. If it's not running, start it.

```bash
# Skill root: ~/.claude/skills/gstack-agentcall/
SKILL="${HOME}/.claude/skills/gstack-agentcall"
if ! curl -sf -m 1 http://127.0.0.1:8765/ -o /dev/null; then
  (python3 "$SKILL/server.py" > /tmp/gstack-agentcall.log 2>&1) &
  sleep 2
fi
```

The server auto-spawns the avatar page server on port 3000 the first
time it boots. Both bind to `127.0.0.1` only.

### Step 1 — dispatch a specialist (or team)

`POST /dispatch` with JSON:

```json
{
  "meetUrl": "https://meet.google.com/abc-defg-hij",
  "specialists": ["plan-ceo-review"],
  "mode": "avatar",
  "brief": "optional: paste the agenda or doc link here"
}
```

Specialist ids are the keys in `data/specialists.json`:
`office-hours`, `plan-ceo-review`, `plan-eng-review`,
`plan-design-review`, `plan-devex-review`, `design-consultation`,
`design-shotgun`, `design-html`, `review`, `investigate`,
`design-review`, `devex-review`, `qa`, `cso`, `ship`,
`land-and-deploy`, `canary`, `retro`.

`mode` defaults to `"avatar"` (visible 3D character + voice). Pass
`"audio"` to skip the avatar (faster join, no video).

For a whole team, pass the team's specialist list. Team presets are
in `data/teams.json`:

| Team id | Specialists |
|---|---|
| `founding` | office-hours, plan-ceo-review, plan-eng-review |
| `design` | plan-design-review, design-consultation, design-shotgun, design-html, design-review |
| `build-review` | plan-eng-review, review, investigate |
| `qa-ship` | qa, cso, ship, land-and-deploy, canary |
| `dx` | plan-devex-review, devex-review |
| `retro` | retro |

```bash
curl -sX POST http://127.0.0.1:8765/dispatch \
  -H 'content-type: application/json' \
  -d "$(jq -n --arg url "$MEET_URL" --argjson ids '["plan-ceo-review"]' \
        '{meetUrl: $url, specialists: $ids, mode: "avatar"}')"
```

The response includes per-specialist PIDs and a `sessionDir`. The bot
takes ~30s to enter the meeting (Google Meet takes longest). The user
must admit the bot from the lobby — tell them this every time.

### Step 2 — drive the specialist while it's in the call

Each specialist becomes a `runner` process that tails its own outbox at
`/tmp/gstack-intelligence-<uid>/outbox/<spec_id>.jsonl`. Append a JSON
line and the runner forwards it to the bridge.

```bash
BUS=/tmp/gstack-intelligence-$(id -u)/outbox
# Speak in character:
echo '{"text":"Cut the thing you spent the most time defending."}' \
  >> "$BUS/plan-ceo-review.jsonl"
# Drop a chat message:
echo '{"action":"send_chat","message":"https://example.com/spec"}' \
  >> "$BUS/plan-ceo-review.jsonl"
# Start screenshare (avatar mode only, port or url):
echo '{"action":"screenshare.start","port":3001}' \
  >> "$BUS/plan-ceo-review.jsonl"
echo '{"action":"screenshare.stop"}' \
  >> "$BUS/plan-ceo-review.jsonl"
```

Cross-bot speech lock at `/tmp/gstack-intelligence-<uid>/speaking.lock`
ensures only one specialist talks at a time. The lock auto-releases
on `tts.done` and is force-stolen after 12s if the holder is stuck.

### Step 3 — observe what's happening in the meeting

Each specialist's transcript stream lands in
`/tmp/gstack-intelligence-<uid>/inbox.jsonl` (the listener forwards
every meeting `user.message` event there). Tail it to know what the
room is saying.

```bash
tail -f /tmp/gstack-intelligence-$(id -u)/inbox.jsonl
```

Per-specialist event streams are at
`<sessionDir>/<spec_id>.jsonl` — full bridge events including
`tts.done`, `participant.joined`, `screenshare.started`, etc.

### Step 4 — recall when done

```bash
curl -sX POST http://127.0.0.1:8765/recall \
  -H 'content-type: application/json' \
  -d '{"all": true}'
# Or specific ones:
curl -sX POST http://127.0.0.1:8765/recall \
  -H 'content-type: application/json' \
  -d '{"specialists": ["plan-ceo-review", "cso"]}'
```

Recall is **defense-in-depth**: it verifies each PID still belongs to
a `specialist_runner.py` before SIGTERM, so a stale PID after reboot
won't kill an unrelated process.

---

## Active participation rules (CRITICAL)

When the skill is engaged and specialists are in the meeting:

1. **The room is live.** Treat every `inbox.jsonl` line as a real
   participant speaking. Latency matters — reply within seconds.
2. **One specialist per outbox line.** Don't queue 10 messages in
   one go; the speech lock will serialize them, but that bunches
   the bot's voice unnaturally. Wait for `tts.done` before queueing
   the next line for the same specialist.
3. **Stay in character.** Each specialist has a `description` and a
   `role` in `data/specialists.json`. Reply in their voice. The CEO
   challenges strategy. The CSO finds exploits. The Senior Designer
   talks about hierarchy and rhythm. **Do not break character.**
4. **Don't speak unless addressed or it's clearly relevant.** The
   default is silence. The user typed "bring the CEO in" — the CEO
   should respond when the conversation touches strategy, OR when
   the user says "CEO, what do you think?" Never fire a TTS just to
   fill silence.
5. **Always recall before exiting.** Killing the runner without
   `/recall` leaves the bot in the meeting until the AgentCall
   alone-timeout (2 min) — billing the user.

---

## Common patterns (paste-ready playbooks)

### "Bring the CEO into this meeting and have it pressure-test my pitch"

```
1. POST /dispatch {meetUrl, ["plan-ceo-review"], mode: "avatar"}
2. Tell the user: "CEO is on the way (~30s). Admit it from the Meet lobby."
3. Tail inbox.jsonl. When user pitches, write CEO replies to outbox.
4. Stay in character (strategic challenges, not technical).
5. On user's "we're done" / "thanks", POST /recall {all: true}.
```

### "Get the QA team to break what we just shipped"

```
1. POST /dispatch {meetUrl, ["qa", "cso"], mode: "avatar"}
2. QA challenges happy-path; CSO challenges auth/secrets.
3. Use {"action":"send_chat","message":"..."} to paste exact failing curls.
```

### "Bring my whole founding team to my standup"

```
1. POST /dispatch {meetUrl, ["office-hours","plan-ceo-review","plan-eng-review"], mode: "avatar"}
2. Each one engages on their domain only; let conversations cross.
3. The cross-bot speech lock serializes them — no overlap.
```

### "Send a recap of our discussion as a screenshare"

```
1. Generate an HTML page with the recap into recap-page/index.html.
2. Spawn a python -m http.server on port 3001 from recap-page/.
3. Append {"action":"screenshare.start","port":3001} to the CEO's outbox.
4. The avatar bot will start sharing the recap page in the meeting.
```

---

## Files in this skill

```
gstack-agentcall/
├── SKILL.md               ← this file
├── install                ← installer (symlinks repo → ~/.claude/skills/)
├── server.py              ← dashboard + /dispatch + /recall
├── specialist_runner.py   ← per-specialist runtime (one process per dispatched bot)
├── index.html             ← dashboard UI (open http://localhost:8765 to drive manually)
├── specialists.js         ← AUTO-GENERATED from data/specialists.json on server boot
├── data/
│   ├── specialists.json   ← canonical: 18 specialists with id/name/role/voice/glyph/accent
│   └── teams.json         ← canonical: 6 team presets
├── avatar-page/           ← bot's video feed (rendered by AgentCall's headless browser)
│   ├── index.html
│   ├── agentcall-audio.js
│   └── avatars/ (symlink → ../avatars)
├── avatars/
│   ├── gen.py             ← regenerate all 18 SVGs from DiceBear API
│   └── *.svg              ← per-specialist 3D-character avatars
├── recap-page/            ← optional screenshare content
├── scripts/
│   ├── launch.sh          ← spawn an audio-mode bot
│   ├── launch-visual.sh   ← spawn an avatar-mode bot
│   └── kill-session.sh    ← graceful teardown
├── vendor/
│   ├── bridge.py          ← vendored AgentCall audio bridge (with patches)
│   ├── bridge-visual.py   ← vendored AgentCall visual bridge (with patches)
│   └── tunnel.py
├── README.md              ← human-facing project README
├── ARCHITECTURE.md        ← detailed system design
├── CONTRIBUTING.md        ← how to add a specialist / mode
├── SECURITY.md            ← OWASP/STRIDE audit (9 findings, all addressed)
└── YC_APPLICATION.md      ← coding-agent transcript narrative for YC S26
```

---

## Install (one-liner)

From inside Claude Code:

```bash
git clone --depth 1 https://github.com/anandpattern/gstack-agentcall.git \
  ~/gstack-agentcall && \
  ~/gstack-agentcall/install
```

The installer:
1. Symlinks the repo into `~/.claude/skills/gstack-agentcall/`
2. Verifies `~/.agentcall/config.json` exists (warns if missing)
3. Smoke-tests `python3 -c "import server, specialist_runner"`

Verify with `ls -la ~/.claude/skills/gstack-agentcall/SKILL.md`.

---

## Safety + scope

- The dashboard binds **127.0.0.1 only** — no remote access by design.
- CSRF guard on `/dispatch` and `/recall` blocks cross-origin POSTs.
- `meetUrl` is allow-listed to Meet/Zoom/Teams/Webex hosts only.
- Per-uid bus + log dirs at mode 0700 prevent same-host tampering.
- Subprocess env scrubbed to a 15-key allow-list — unrelated dev
  secrets do not reach vendored bridge code.

See `SECURITY.md` for the full audit (9 findings, every one addressed
or accepted with rationale).

---

## License

MIT. Same license as the upstream gstack and AgentCall projects.
