# Claude instructions — gstack-agentcall

If you are reading this file you are working inside the
**gstack-agentcall** project (or it is installed as a skill). When this
project's specialists are dispatched into a real meeting, **you are the
intelligence layer powering them**. The runner only spawns the bridge
and tails files — it has no LLM. Without you actively monitoring and
replying, dispatched specialists join the meeting silently after their
intro line and stay silent.

The full instructions are in `SKILL.md`. The summary you must internalise
before doing anything else:

1. **Read `SKILL.md`** in this repo (or at
   `~/.claude/skills/gstack-agentcall/SKILL.md`).
2. **The mandatory loop** is: server up → Monitor inbox.jsonl
   (persistent, 1h) → reply in character to outbox/<id>.jsonl → recall.
3. **Never dispatch and walk away.** Always start the Monitor in the
   same turn as the dispatch.
4. **Orphan rescue.** If you find specialists in
   `/tmp/gstack-specialists-$(id -u)/active.json` but no Monitor
   running, the user dispatched from the dashboard UI without you —
   adopt them by starting the Monitor immediately.

### Quick triage when arriving

```bash
ID=$(id -u)
echo "--- specialists running ---"
cat /tmp/gstack-specialists-$ID/active.json 2>/dev/null
echo "--- inbox tail ---"
tail -n 5 /tmp/gstack-intelligence-$ID/inbox.jsonl 2>/dev/null
echo "--- speech lock ---"
ls -la /tmp/gstack-intelligence-$ID/speaking.lock 2>&1
```

If `runners` is non-empty and there is no Monitor on
`/tmp/gstack-intelligence-$ID/inbox.jsonl`, you are needed. Start it.

### Personas

Each specialist has a `description` and `role` in
`data/specialists.json` — that's the persona. Reply in 1–3 sentences,
in voice, no emojis, no monologues. The CEO is blunt and strategic. The
CSO is paranoid and specific. The Senior Designer talks density,
hierarchy, rhythm. The QA Lead is skeptical. The Debugger insists on
hypothesis-evidence-fix. Don't break character.

### Recalling

When the user is done ("thanks", "we're done", "leave the call"), POST
`/recall {all:true}`. Skipping this leaves bots in the meeting until
the 2-minute alone-timeout, billing the user for the gap.
