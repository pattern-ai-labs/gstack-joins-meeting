# gstack worker — run the brain for hosted gstack

> **TL;DR.** `python3 worker.py` opens a WebSocket to the gstack broker.
> When the broker hands it an assignment, the worker dispatches the
> specialists locally; the Claude Code session running in the same
> terminal is the brain that drives their replies.

This is the agent-side runtime for hosted gstack
(`gstack.fly.dev` in production, `localhost:8787` for local dev).
It's modeled after AgentCall's `agentcall-demo-worker` pattern.

---

## What the worker does

`worker.py` is a **dumb bidirectional bridge** — ~250 lines of stdlib +
`websockets`. It has no LLM. All decision-making lives in the Claude
Code session running alongside it.

```
┌─────────────────────────────────────────────┐
│  YOUR LAPTOP                                │
│                                             │
│  ┌─────────────┐    stdout / stdin          │
│  │ Claude Code │◄──────────────┐            │
│  │  session    │               │            │
│  │  (the BRAIN)│               │            │
│  └──────┬──────┘     ┌─────────┴─────────┐  │
│         │            │     worker.py     │  │
│  Monitor│            │  ─ holds WS to    │  │
│  on     │            │    gstack broker  │  │
│  inbox  │            │  ─ on assignment, │  │
│         │            │    POST /dispatch │  │
│         ▼            │    to local server│  │
│  ┌─────────────┐     │  ─ reports state  │  │
│  │  server.py  │◄────┤    back to broker │  │
│  │             │     └─────────┬─────────┘  │
│  │ + bridges   │               │ wss://     │
│  └──────┬──────┘               │            │
└─────────┼──────────────────────┼────────────┘
          │ AgentCall            │
          ▼                      ▼
        ┌────────────┐    ┌────────────────┐
        │ Meet/Zoom  │    │ gstack broker  │
        └────────────┘    └────────────────┘
```

The worker brings your own compute, your own Claude Code session, and
(in Phase 1) shares an AgentCall key from a centrally-funded pool. The
broker just routes "user N wants the CEO in meeting X" to the next idle
worker.

---

## Once-only setup

1. Install the gstack repo (you already have it if you're reading this):

   ```bash
   curl -fsSL https://raw.githubusercontent.com/pattern-ai-labs/gstack-joins-meeting/main/install | bash
   ```

2. Ask the broker admin for a `gw_…` worker key, and save it:

   ```bash
   mkdir -p ~/.gstack
   cat > ~/.gstack/worker.json <<'EOF'
   {"worker_key": "gw_PASTE_HERE"}
   EOF
   chmod 600 ~/.gstack/worker.json
   ```

3. Make sure `pip install aiohttp websockets` has been run (the
   `install` script already does this if pip is on PATH).

4. (Optional) Tell the worker which broker to talk to:

   ```bash
   export GSTACK_BROKER_URL="wss://gstack.fly.dev/v1/workers/connect"
   ```

---

## Come online

```bash
# 1. Start the worker daemon and pipe its events to a file.
python3 worker.py > /tmp/gstack-worker-events.jsonl 2>&1 &
echo $! > /tmp/gstack-worker.pid
```

Then in Claude Code, follow the mandatory loop below.

---

## The mandatory loop (you are the brain, again)

The runtime is the same loop as the local prototype — the only
difference is the **trigger** is now a broker assignment instead of a
user typing into the dashboard.

### 1. Monitor the worker event stream

```
Use the Monitor tool with:
  description: "gstack worker assignments"
  persistent:  true
  timeout_ms:  3600000   (1 hour; re-arm if longer)
  command: |
    tail -n 0 -F /tmp/gstack-worker-events.jsonl
```

You'll get notifications like:
```json
{"type":"connected","ts":1730000000}
{"type":"assignment","id":"a-...","meetUrl":"https://meet.google.com/...",
 "specialists":["plan-ceo-review"],"brief":"...","mode":"avatar"}
{"type":"dispatched","id":"a-...","result":{...}}
```

### 2. On `assignment`, start monitoring the intelligence inbox

The worker has already dispatched the specialists via the local
`server.py:/dispatch` by the time you see the `dispatched` event. Your
job is the same as the local prototype: monitor `inbox.jsonl`, reply in
character to `outbox/<id>.jsonl`.

```
Use the Monitor tool with:
  description: "Specialist inbox (worker mode)"
  persistent:  true
  timeout_ms:  3600000
  command: |
    tail -n 0 -F /tmp/gstack-intelligence-$(id -u)/inbox.jsonl
```

From here, everything works exactly like the local prototype — see
`SKILL.md` for the persona rules and reply mechanics.

### 3. On `call.ended`, report status back to the broker

The worker reads JSON lines from stdin and forwards them to the broker.
To tell the broker the assignment ended:

```bash
echo '{"type":"status","id":"<assignment_id>","event":"ended"}' \
  >> /tmp/gstack-worker-stdin
# (set up /tmp/gstack-worker-stdin as a named pipe at startup, or
#  pipe directly into the worker process — see below)
```

The simplest pattern: spawn worker.py with a FIFO as stdin:

```bash
mkfifo /tmp/gstack-worker-stdin
python3 worker.py < /tmp/gstack-worker-stdin > /tmp/gstack-worker-events.jsonl 2>&1 &
exec 9>/tmp/gstack-worker-stdin   # keep the FIFO open
```

After reporting `ended`, also call `/recall` on the local server so the
specialists actually leave the meeting (the worker does this
automatically on a `recall` message from the broker — but call it
yourself when you decide the call is over):

```bash
curl -sX POST http://127.0.0.1:8765/recall \
  -H 'content-type: application/json' -d '{"all":true}'
```

---

## Failure modes

| Symptom | Diagnosis | Fix |
|---|---|---|
| `no worker key` on startup | Missing `~/.gstack/worker.json` or `GSTACK_WORKER_KEY` env | Set one or the other |
| `connecting` then `error: …401` | Key revoked or unknown | Ask admin for a new key |
| `assignment` event but no `dispatched` follow-up | `server.py` failed to spawn specialists | Check `/tmp/gstack-worker-*.log` and `sessions/session-*/orchestrator.log` |
| Specialists join meeting but say nothing | You forgot step 2 — start the inbox Monitor | Start it; you are the brain |
| Worker disappears from broker dashboard | Network blip or process died | worker.py auto-reconnects on net; for a dead process, restart with the same command |
| Two assignments in a row collide | Worker rejected the second one (`busy`) | Working as intended — broker should pick a different idle worker |

---

## Don't

- **Don't hold a long-lived AgentCall key.** The broker mints a transient
  one per assignment via the `agentcall_api_key` field. The worker sets
  it in env only long enough for `_safe_env()` to copy it into the
  bridge subprocesses, then restores the original.
- **Don't dispatch from the local dashboard while online as a worker.**
  The intelligence bus is shared — your local CEO and the broker's CEO
  would fight over the same outbox.
- **Don't run two worker.py processes against the same broker key.** The
  broker would treat each as a separate worker but they'd both grab
  assignments and race for the local `server.py`.
- **Don't commit `~/.gstack/worker.json`.** Treat the key like an SSH
  private key.

---

## Admin reference (for the broker operator)

Mint a key:
```bash
curl -sX POST http://broker/api/admin/mint \
  -H "Authorization: Bearer $GSTACK_ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"label":"anand-macbook"}'
# → {"worker_key":"gw_xxx","label":"anand-macbook"}
# Copy the worker_key NOW — it's hashed at rest and never shown again.
```

List keys:
```bash
curl -s http://broker/api/admin/keys \
  -H "Authorization: Bearer $GSTACK_ADMIN_TOKEN"
```

Revoke a key (boots any connected worker using it):
```bash
curl -sX POST http://broker/api/admin/revoke \
  -H "Authorization: Bearer $GSTACK_ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"key":"gw_xxx"}'
```

See `broker/main.py` for the full surface.
