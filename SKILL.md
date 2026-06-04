---
name: gstack-agentcall
description: Bring GStack specialists into a Google Meet / Zoom / Teams call as voice bots, AND act as their brain. Use this skill when the user asks to "bring the CEO / CSO / QA / Eng Manager into the meeting", "dispatch the design team", "have a specialist review my pitch live", or otherwise wants a GStack persona to join a real meeting with a 3D avatar and respond in character. ALSO use this skill when you notice gstack specialists are already running on this machine (active.json non-empty) and need a brain — the specialists go silent without a Claude session powering their replies. Each dispatched specialist becomes its own meeting participant with a unique avatar, hears the room, and only speaks when YOU (Claude) write a reply to its outbox file.
---

# gstack-agentcall — voice specialists in the meeting

> **Read the next section before you do anything else.**
> The dispatch endpoint is dumb on its own — without YOU running the
> brain loop, specialists join silently and never engage.

---

## YOU ARE THE BRAIN. (read this first)

When this skill is engaged, **Claude is the intelligence layer for every
dispatched specialist**. There is no LLM hidden in the runner. The
runner only:

1. spawns the bridge (so the bot enters the meeting)
2. forwards every meeting `user.message` event into a shared inbox file
3. tails an outbox file per specialist, speaks anything you write there

If no Claude session is monitoring the inbox, **the bot just sits
there in the meeting saying nothing after its initial intro line.**
That is the failure mode you must prevent. Don't dispatch and walk
away; dispatch and immediately enter the loop below.

### The mandatory loop

The moment you trigger a dispatch (or detect that a dispatch already
happened — see "orphan rescue" below), do these three things in this
exact order, in the same turn:

#### 1. Confirm or start the dashboard server

```bash
SKILL="${HOME}/.claude/skills/gstack-agentcall"
if ! curl -sf -m 1 http://127.0.0.1:8765/ -o /dev/null; then
  (python3 "$SKILL/server.py" > /tmp/gstack-agentcall.log 2>&1) &
  sleep 2
fi
```

#### 2. Start a Monitor on the intelligence inbox

This is the line that turns Claude into the brain. Each new line
written to `inbox.jsonl` becomes a notification you'll receive while
you keep working — no polling needed.

```
Use the Monitor tool with:
  description: "Specialist inbox (Claude is the brain)"
  persistent:  true
  timeout_ms:  3600000   (1 hour; re-arm if longer)
  command: |
    tail -n 0 -F /tmp/gstack-intelligence-$(id -u)/inbox.jsonl
```

You MUST start this monitor BEFORE telling the user the bot is
dispatched. Without it you will not see what the room is saying.

#### 3. Reply to every meeting message in character

Each notification looks like:

```json
{"ts": 1730000000.0, "specialist_id": "plan-ceo-review",
 "name": "CEO", "role": "CEO",
 "description": "I pressure-test the strategy …",
 "speaker": "Anand Balakrishnan",
 "text": "What do you think of the AgentCall idea?"}
```

To reply, append a JSON line to that specialist's outbox:

```bash
BUS=/tmp/gstack-intelligence-$(id -u)/outbox
echo '{"text":"<your in-character reply>"}' >> "$BUS/<specialist_id>.jsonl"
```

The runner picks the line up within ~250ms, sends it through the
bridge as `tts.speak`, and the specialist speaks it into the meeting.

**Rules for replies (these matter — break them and the experience
falls apart):**

- **Stay in character.** The CEO challenges strategy in blunt one-
  liners. The CSO is paranoid and specific. The Senior Designer
  talks hierarchy and rhythm. The QA Lead is skeptical. Look at the
  specialist's `description` and `role` in the inbox event — that's
  the persona.
- **Keep it short.** 1–3 sentences. TTS over voice is unforgiving;
  long monologues feel robotic. Use meeting chat (see below) for
  anything URL-shaped or longer than ~30 words.
- **Stay silent on filler.** "Yeah", "uh", "okay", and STT-garbled
  noise should NOT trigger TTS. Only reply when the message is a
  real question or a direct address.
- **Don't talk over yourself.** The cross-bot speech lock auto-
  serializes between specialists, but for a single specialist
  don't queue 5 lines at once — let `tts.done` arrive before the
  next reply.
- **If the user addresses Claude directly** (not a dispatched
  specialist), reply through your own bridge if you're in the
  call — never through a specialist's outbox.
- **On STT noise, ignore.** Voice STT often produces fragments like
  "Mm hmm" or non-English phonetic noise. Standing by is a valid
  response.
- **One specialist per user turn (when multiple are dispatched).**
  When N specialists are in the same call, every `user.message`
  event lands in the inbox once. Do NOT reply through every
  outbox — pick ONE specialist whose turn it is, using these rules
  in order:

  1. **Explicit address wins.** If the user said "CEO,", "Eng
     Manager", "QA", or any phrase that names a present specialist's
     `name`, `role`, or `id`, reply only via that specialist's outbox.
     Phrasing examples that count: "CEO what do you think", "Hey
     Eng Manager", "QA — break this", "Office Hours partner here?".
  2. **Domain match.** If no explicit name, score each present
     specialist's `description` against the user text — does the
     question fit their beat? CEO = strategy/bets/why-now. CSO =
     auth/secrets/threat model. Senior Designer = layout/rhythm/
     hierarchy. QA Lead = edge cases/null/error paths. Investigate
     = bug/repro/root cause. Pick the strongest match. Tie → next rule.
  3. **Round-robin.** Track which specialist spoke last in this
     session (mentally — the inbox event log is your source of
     truth, scan it for the most recent `← outbox` entry per id).
     Pick whichever specialist has been silent the longest. If it's
     the very first reply of a multi-bot call, default to the
     dispatch order — first specialist in the dispatch list goes first.

  This keeps the meeting feeling like a real team conversation
  (one person speaks at a time) instead of three bots all jumping
  in at once.

#### 4. Other outbox actions (use sparingly)

```bash
# Send a chat message in the meeting (for URLs, code, long lists):
echo '{"action":"send_chat","message":"https://github.com/foo/bar"}' \
  >> "$BUS/<spec_id>.jsonl"

# Avatar mode only — start screensharing a URL or a local port:
echo '{"action":"screenshare.start","url":"https://example.com/recap"}' \
  >> "$BUS/<spec_id>.jsonl"
echo '{"action":"screenshare.start","port":3001}' \
  >> "$BUS/<spec_id>.jsonl"
echo '{"action":"screenshare.stop"}' \
  >> "$BUS/<spec_id>.jsonl"
```

#### 5. Recall when done

The user will signal end-of-call ("thanks", "we're done", "leave the
call"). Always run:

```bash
curl -sX POST http://127.0.0.1:8765/recall \
  -H 'content-type: application/json' \
  -d '{"all": true}'
```

Failing to recall leaves bots in the meeting until the AgentCall
alone-timeout (~2 min) — and bills the user for those 2 min.

---

## Orphan rescue (a specialist is dispatched but has no brain)

If the user dispatched specialists from the dashboard UI in another
window and now asks "why isn't the CEO responding?", they have
specialists running with no Claude session attached. Adopt them:

```bash
# Are there orphans?
cat /tmp/gstack-specialists-$(id -u)/active.json
# If "runners" is non-empty, start the Monitor on inbox.jsonl
# (step 2 above) and you're now their brain.
```

Then say something like *"I see the CEO is dispatched but had no
brain attached — I'm the brain now, ask anything."* and run the loop.

---

## When to invoke this skill

Trigger phrases (any of these):

- "bring the CEO into this meeting"
- "have the QA team review what we're building"
- "dispatch the engineering manager"
- "let me get a security review of this — bring CSO"
- "send the founding team to my standup"
- "bring my GStack team into the call"
- "why isn't the CEO responding?" (orphan rescue path)
- "recall all the specialists" / "get everyone out of the meeting"

**Do NOT** invoke this skill for:
- Just running gstack slash commands locally (those are `/cso`, `/review`,
  etc. inside the upstream gstack skill — text only, no voice bot).
- Generic AgentCall use (joining a meeting as Claude itself — use the
  `agentcall` / `join-meeting` skill for that).

---

## Dispatching — the API surface

`POST /dispatch` to start one or more specialists:

```bash
SPEC_IDS='["plan-ceo-review"]'    # or ["plan-ceo-review","plan-eng-review","cso"]
MEET_URL="https://meet.google.com/abc-defg-hij"
curl -sX POST http://127.0.0.1:8765/dispatch \
  -H 'content-type: application/json' \
  -d "$(python3 -c "import json,sys; print(json.dumps({
        'meetUrl': sys.argv[1],
        'specialists': json.loads(sys.argv[2]),
        'mode': 'avatar',
      }))" "$MEET_URL" "$SPEC_IDS")"
```

Specialist ids (single source of truth: `data/specialists.json` —
tracks upstream [gstack](https://github.com/garrytan/gstack) v1.47.0.0):
`office-hours`, `plan-ceo-review`, `plan-eng-review`,
`plan-design-review`, `plan-devex-review`, `design-consultation`,
`design-shotgun`, `design-html`, `review`, `investigate`,
`design-review`, `devex-review`, `qa`, `cso`, `ship`,
`land-and-deploy`, `canary`, `retro`, `spec`.

Team presets (`data/teams.json`):

| Team id | Specialists |
|---|---|
| `founding` | office-hours, plan-ceo-review, plan-eng-review |
| `design` | plan-design-review, design-consultation, design-shotgun, design-html, design-review |
| `build-review` | spec, plan-eng-review, review, investigate |
| `qa-ship` | qa, cso, ship, land-and-deploy, canary |
| `dx` | plan-devex-review, devex-review |
| `retro` | retro |

`mode`:
- `"avatar"` (default) — visible 3D character + voice. Slower join (~30s).
- `"audio"` — voice only, no avatar. Faster.

The user must admit each bot from the meeting lobby. Tell them:
*"Bot is on the way — admit it from your Meet lobby (~30s)."*

---

## Common patterns (paste-ready playbooks)

### "Bring the CEO into this meeting and have it pressure-test my pitch"

```
1. Start dashboard server if not running.
2. POST /dispatch {meetUrl, ["plan-ceo-review"], mode:"avatar"}.
3. Start Monitor on inbox.jsonl (PERSISTENT, 1h).
4. Tell user: "CEO is on the way — admit from lobby."
5. When user pitches → write CEO reply to
   /tmp/gstack-intelligence-$(id -u)/outbox/plan-ceo-review.jsonl
6. Stay strategic. Don't review code, that's not the CEO's beat.
7. On "thanks" / "we're done" → POST /recall {all:true}.
```

### "Get the QA team to break what we just shipped"

```
1. POST /dispatch {meetUrl, ["qa","cso"], mode:"avatar"}.
2. Start inbox Monitor.
3. QA challenges happy paths and asks for null/empty cases.
   CSO challenges auth, secrets, exposed surfaces.
4. Use {"action":"send_chat","message":"…curl repro…"} for repros.
```

### "Bring my whole founding team to my standup"

```
1. POST /dispatch {meetUrl, ["office-hours","plan-ceo-review","plan-eng-review"]}.
2. Start inbox Monitor. Three specialists, three personas.
3. Each one engages on its domain only. Cross-bot speech lock
   serializes their TTS so they don't talk over each other.
```

### "Send a recap of what we just discussed as a screenshare"

```
1. Generate the recap as HTML at recap-page/index.html.
2. (cd recap-page && python3 -m http.server 3001) &
3. Append {"action":"screenshare.start","port":3001} to a specialist's outbox.
4. The avatar bot starts screensharing the recap page.
```

---

## Files in this skill

```
gstack-agentcall/
├── SKILL.md               ← this file (you are reading it)
├── install                ← installer (symlinks repo → ~/.claude/skills/)
├── server.py              ← dashboard + /dispatch + /recall
├── specialist_runner.py   ← per-specialist runtime (one process per dispatched bot)
├── index.html             ← dashboard UI (open http://localhost:8765 to drive manually)
├── specialists.js         ← AUTO-GENERATED from data/specialists.json on server boot
├── data/
│   ├── specialists.json   ← canonical: 18 specialists with id/name/role/voice/glyph/accent
│   └── teams.json         ← canonical: 6 team presets
├── avatar-page/           ← bot's video feed (rendered by AgentCall's headless browser)
├── avatars/               ← per-specialist 3D-character SVGs
├── recap-page/            ← optional screenshare content
├── scripts/               ← launch / kill helpers
├── vendor/                ← vendored AgentCall bridges (with patches)
├── README.md, ARCHITECTURE.md, CONTRIBUTING.md, SECURITY.md
└── YC_APPLICATION.md
```

---

## Install

One line — from any shell:

```bash
curl -fsSL https://raw.githubusercontent.com/pattern-ai-labs/gstack-joins-meeting/main/install | bash
```

Clones into `~/gstack-joins-meeting` and symlinks it as a Claude Code
skill at `~/.claude/skills/gstack-joins-meeting/` so SKILL.md is
auto-discovered. Verify:

```bash
ls -la ~/.claude/skills/gstack-joins-meeting/SKILL.md
```

---

## Safety + scope

- Dashboard binds **127.0.0.1 only** — no remote access by design.
- CSRF guard on `/dispatch` and `/recall` blocks cross-origin POSTs.
- `meetUrl` allow-listed to Meet/Zoom/Teams/Webex hosts only.
- Per-uid bus + log dirs at mode 0700.
- Subprocess env scrubbed to a 15-key allow-list — unrelated dev
  secrets do not reach vendored bridge code.

See `SECURITY.md` for the full audit (9 findings, all addressed).

---

## License

MIT. Same license as the upstream gstack and AgentCall projects.
