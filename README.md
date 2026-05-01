# gstack × AgentCall

Your engineering team, on the call.

Every gstack specialist (CEO, Eng Manager, QA, CSO, Release Engineer, ...) dispatched into your Google Meet as a real voice bot via [AgentCall](https://agentcall.dev).

## Run

```bash
python3 server.py
```

Then open http://localhost:8765

1. Paste a Google Meet / Zoom / Teams URL at the top.
2. Click the specialist cards to build your team.
3. Hit **Dispatch selected** — each specialist joins the call as a named voice bot.

## How it works

- `index.html` — single-page vanilla-JS dashboard.
- `specialists.js` — the 18 gstack specialist definitions.
- `server.py` — stdlib Python HTTP server. `POST /dispatch` spawns one
  `bridge.py` subprocess per selected specialist (from the `agentcall`
  Claude Code skill).

Bot logs land in `/tmp/gstack-specialists/`.

## Requires

- Python 3.10+
- The `agentcall` skill installed at `~/.claude/skills/agentcall/`
- `AGENTCALL_API_KEY` in your environment

```bash
export AGENTCALL_API_KEY="ak_ac_..."
python3 server.py
```
