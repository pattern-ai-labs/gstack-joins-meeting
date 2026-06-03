# gstack joins your meeting

**Every [gstack](https://github.com/garrytan/gstack) specialist — CEO, CSO, QA Lead, Senior Designer, SRE, Spec Partner, and 13 others — joins your Google Meet, Zoom, or Teams as a real voice bot with its own 3D avatar.** Stdlib-only Python on the server, vanilla JS on the client, your Claude Code session as the brain. Open source. MIT.

Built on top of [garrytan/gstack](https://github.com/garrytan/gstack) (the slash-command persona library, by **Garry Tan**, President & CEO of YC) and [AgentCall](https://agentcall.dev) (the meeting-bot platform). Huge thanks to Garry for shipping the personas — see [Thanks Garry](#thanks-garry) at the bottom.

![Dashboard](docs/dashboard.png)

---

## Install in 60 seconds

```bash
curl -fsSL https://raw.githubusercontent.com/pattern-ai-labs/gstack-joins-meeting/main/install | bash
```

That clones the repo to `~/gstack-joins-meeting` and registers it as a Claude Code skill at `~/.claude/skills/gstack-joins-meeting/`. Then set your [AgentCall](https://app.agentcall.dev/api-keys) key:

```bash
export AGENTCALL_API_KEY="ak_ac_..."
```

That's it. Nothing to build, no `requirements.txt`, no Postgres. Open Claude Code and say:

> *"Bring the CEO into this meeting: https://meet.google.com/abc-defg-hij"*

The CEO bot joins the call (~30s for avatar mode), introduces itself, listens, and replies in voice as you talk. Your Claude session is the brain — see [`SKILL.md`](./SKILL.md) for the brain-loop.

Or open the dashboard manually:

```bash
python3 ~/gstack-joins-meeting/server.py
# → http://localhost:8765 — paste Meet URL, pick specialists, dispatch
```

---

## The roster

| id                    | Name              | Role                          | Voice          |
|-----------------------|-------------------|-------------------------------|----------------|
| `office-hours`        | YC Office Hours   | YC Office Hours partner       | `am_michael`   |
| `plan-ceo-review`     | CEO               | CEO                           | `am_adam`      |
| `plan-eng-review`     | Eng Manager       | Engineering Manager           | `bm_george`    |
| `plan-design-review`  | Senior Designer   | Senior Designer               | `af_sarah`     |
| `plan-devex-review`   | DX Lead           | Developer Experience Lead     | `bf_emma`      |
| `design-consultation` | Design Partner    | Design Partner                | `bf_isabella`  |
| `design-shotgun`      | Design Explorer   | Design Explorer               | `af_nicole`    |
| `design-html`         | Design Engineer   | Design Engineer               | `am_michael`   |
| `review`              | Staff Engineer    | Staff Engineer                | `bm_lewis`     |
| `investigate`         | Debugger          | Debugger                      | `am_adam`      |
| `design-review`       | Designer Who Codes| Designer Who Codes            | `af_bella`     |
| `devex-review`        | DX Tester         | Developer Experience Tester   | `bf_emma`      |
| `qa`                  | QA Lead           | QA Lead                       | `af_sarah`     |
| `cso`                 | CSO               | Chief Security Officer        | `am_michael`   |
| `ship`                | Release Engineer  | Release Engineer              | `bm_george`    |
| `land-and-deploy`     | Deploy Engineer   | Deploy Engineer               | `bm_lewis`     |
| `canary`              | SRE               | Site Reliability Engineer     | `am_adam`      |
| `retro`               | Retro Facilitator | Retrospective Facilitator     | `bm_george`    |
| `spec`                | Spec Partner      | Spec Authoring Partner        | `bf_isabella`  |

Each id maps 1:1 to an upstream [gstack](https://github.com/garrytan/gstack) slash command (tracked against v1.47.0.0). The six built-in team presets — Founding, Design, Build & Review, QA & Ship, DX, Retro — live in [`data/teams.json`](./data/teams.json).

---

## How it works

```
┌─────────────────────────────────────────────────────────────┐
│  YOUR LAPTOP                                                │
│                                                             │
│   ┌──────────────┐                                          │
│   │ Claude Code  │  Monitor /tmp/gstack-intelligence/inbox  │
│   │   session    │◄────────────────────────────────────────┐│
│   │  (the BRAIN) │  Write replies → outbox/<id>.jsonl     ││
│   └──────┬───────┘                                          ││
│          │                                                  ││
│   ┌──────▼─────────┐    HTTP /dispatch   ┌───────────────┐ ││
│   │   server.py    ├────────────────────►│ specialist_   │ ││
│   │   :8765 dash   │                     │   runner.py   │ ││
│   └────────────────┘                     │   (per bot)   │ ││
│                                          └────────┬──────┘ ││
│                                                   │        ││
│                                          bash launch-      ││
│                                          visual.sh         ││
│                                                   ▼        ││
│                                          ┌────────────────┐││
│                                          │ vendor/bridge- │││
│                                          │   visual.py    │││
│                                          └────────┬───────┘││
└───────────────────────────────────────────────────┼────────┘│
                                                    │         │
                                       AgentCall    │         │
                                       WebSocket    ▼         │
                                          ┌──────────────────┐│
                                          │   meet.google    │┘
                                          │      .com        │
                                          └──────────────────┘
```

Three things to internalize:

1. **The bots have no LLM.** `vendor/bridge.py` and `vendor/bridge-visual.py` are stdin/stdout shims around AgentCall's WebSocket. They emit events (`call.bot_ready`, `user.message`, `tts.done`) and accept commands (`tts.speak`, `send_chat`, `leave`). All decision-making is done by **you (Claude)** via the intelligence bus.
2. **The intelligence bus is two files.** `/tmp/gstack-intelligence-$(id -u)/inbox.jsonl` collects user transcripts. `outbox/<id>.jsonl` is where you append `{"text":"…"}` lines that get spoken by that specific bot.
3. **`server.py` is the dispatcher.** A 700-line stdlib HTTP server. No framework. No build step. The dashboard at `localhost:8765` is one HTML file (`index.html`) reading `data/specialists.json` + `data/teams.json` as the single source of truth.

See [`SKILL.md`](./SKILL.md) for the mandatory brain-loop (monitor inbox → reply in character → recall). See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full data flow.

---

## Repo layout

```
gstack-joins-meeting/
├── README.md                ← you are here
├── SKILL.md                 ← brain-loop instructions for Claude
├── CLAUDE.md                ← project-level Claude instructions
├── ARCHITECTURE.md          ← data flow + design decisions
├── CONTRIBUTING.md          ← how to add a specialist / mode
├── SECURITY.md              ← threat model + 9 findings (all addressed)
│
├── install                  ← one-line installer
├── server.py                ← dashboard + /dispatch + /recall  (stdlib HTTP)
├── specialist_runner.py     ← per-specialist runtime (one process per bot)
├── index.html               ← dashboard UI
├── specialists.js           ← AUTO-GENERATED from data/specialists.json on boot
├── data/                    ← canonical JSON: specialists, teams
├── avatars/                 ← per-specialist DiceBear character SVGs + glyph fallback
├── avatar-page/             ← bot's video feed (rendered by AgentCall headless browser)
├── vendor/                  ← vendored AgentCall bridges (with patches)
├── scripts/                 ← launch.sh, launch-visual.sh, kill-session.sh
├── bin/                     ← brain-status.sh diagnostic
│
└── hosted/                  ← OPTIONAL: multi-tenant wrapper for self-hosting a SaaS
                              variant. Most installers can ignore this entirely.
                              See hosted/README.md.
```

The `hosted/` subtree is **only for maintainers / operators**. If you just want gstack specialists in your meetings, you never touch it.

---

## Modes

| Mode | What the bot has | Latency |
|---|---|---|
| `avatar` *(default)* | Voice + 3D character avatar (DiceBear lorelei) | ~30s join, voice + visual |
| `audio` | Voice only, no avatar tile | ~10s join, voice only |

Avatar mode tunnels a local `python -m http.server` on `:3000` (serving `avatar-page/`) through AgentCall's WebSocket relay so each bot's video tile is a name-keyed SVG character.

---

## Troubleshooting

The common failure modes, in roughly the order you'll hit them:

- **Bot joined but is silent.** AudioContext on AgentCall's headless Chrome starts in `suspended` state. We patch `.resume()` in `avatar-page/agentcall-audio.js`. If you've forked, double-check that patch is intact. Audio mode skips this whole path — try `mode: "audio"` if avatar audio is failing.
- **Bot greeted but never spoke again.** No Claude session is monitoring `inbox.jsonl`. The bots have no LLM — see `SKILL.md` for the brain-loop. Run `bin/brain-status.sh` to check.
- **Two bots talking over each other.** The cross-bot speech lock at `/tmp/gstack-intelligence-*/speaking.lock` should prevent this. If you see overlap, the watchdog releases a stale lock after 12s. `bash scripts/kill-session.sh sessions/session-<ts>/` is the hard reset.
- **`/dispatch` returns 200 but no bot.** Check `sessions/session-<latest>/orchestrator.log`. AgentCall key issues show up as 401/403 on the first request.
- **Recall doesn't take.** `bash scripts/kill-session.sh sessions/session-<ts>/` is the hard reset — appends `{"command":"leave"}` to every cmds file, then SIGTERM/SIGKILL.

---

## Try without installing

Pattern AI Labs runs a hosted demo at the URL in the repo description — paste a Meet URL, get a quick taste, no install required. If you like it, come back and run the 60-second install above so it uses your own Claude session + your own AgentCall key.

(Want to host your own SaaS variant of gstack? See [`hosted/HOSTING.md`](./hosted/HOSTING.md).)

---

<a id="thanks-garry"></a>
## Thanks, Garry

This project would not exist without **[Garry Tan](https://github.com/garrytan)** — President & CEO of Y Combinator — open-sourcing [gstack](https://github.com/garrytan/gstack). Every specialist on this page (the way they ask questions, what they refuse to soften, the rhythm of their feedback) is **his work**. This repo just bridged it to a meeting tile.

Thanks also for everything you do for the early-stage tech ecosystem — the founders you fund, the tools you ship, the public conversations you host. This is one developer's way of saying it back.

If you ship something on top of this, tell us what you broke. PRs welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md).

---

## License

MIT. Same as upstream gstack and AgentCall.

- [garrytan/gstack](https://github.com/garrytan/gstack) — the specialist personas. MIT.
- [AgentCall](https://agentcall.dev) — the meeting-bot platform. Commercial; free tier covers prototyping.
