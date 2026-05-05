# Contributing

Short version: keep it stdlib, keep it one-file-per-concept, edit `specialists.js` and `server.py` together, and don't reach for a framework.

## Run locally

```bash
git clone https://github.com/pattern-ai-labs/gstack-joins-meeting.git
cd gstack-joins-meeting
export AGENTCALL_API_KEY="ak_ac_..."
python3 server.py
```

That's it. No build step, no `requirements.txt`. The HTTP server, dispatch loop, and runner are stdlib Python; the dashboard is vanilla JS. The vendored `bridge.py` / `bridge-visual.py` need `aiohttp` and `websockets` (installed by the AgentCall skill itself; if you're running offline you can `pip install aiohttp websockets`).

For a quick visual sanity check on the avatars without joining a meeting:

```bash
cd avatar-page && python3 -m http.server 3000
# open http://127.0.0.1:3000/preview.html
```

Logs:

- Per-runner stdout/stderr → `/tmp/gstack-specialists/<id>.<ts>.log`
- Per-session bridge events → `sessions/session-<ts>/<id>.jsonl`
- Per-session combined log → `sessions/session-<ts>/orchestrator.log`
- Active PIDs → `/tmp/gstack-specialists/active.json`

## Adding a specialist

A specialist lives in three files. All three must change together; the dispatcher will reject unknown ids and the dashboard will silently skip un-named bots.

1. **`specialists.js`** — append to `window.SPECIALISTS`:

   ```js
   {
     id: "your-id",            // matches the gstack slash command
     name: "Card Title",       // shown on the dashboard card
     role: "Pretty Role Name", // shown under the name
     desc: "One-liner pitch.",
     icon: "✦",                // 1–3 chars
     glyph: "✦",
     accent: "#hexcolor",
     category: "Strategy",     // one of the existing buckets, or new
   }
   ```

2. **`server.py`** — append to the `SPECIALISTS` dict (the server-side metadata is the source of truth for what gets spoken):

   ```python
   "your-id": {
       "name":        "Display Name",  # what the meeting roster shows
       "role":        "Role Sentence", # used in the spoken intro
       "description": "Single-sentence self-description spoken by the bot.",
       "voice":       "am_michael",   # AgentCall voice id
   },
   ```

   The display name here must match `name` in `specialists.js` and must also be added to the echo-filter set in `specialist_runner.py:SPECIALIST_DISPLAY_NAMES` — otherwise the listener will ingest its own bot as a user message and feed itself.

3. **`avatar-page/index.html`** — append to `SPECIALIST_ID_BY_NAME`:

   ```js
   "Display Name": "your-id",
   ```

   This is how the avatar page picks the right SVG when AgentCall opens the tunnel with `?name=<DisplayName>`.

4. **`avatars/gen.py`** — append a row to its `SPECIALISTS` list (id, name, glyph, accent_hex), then `python3 avatars/gen.py`. This regenerates `avatars/<id>.svg` (DiceBear character) and `avatars/glyph-<id>.svg` (fallback). DiceBear is deterministic on `seed=<id>`, so the same id always gets the same character.

> Note: the user-facing "RESPONSES dict" in some boardroom forks is collapsed here — `SPECIALISTS["<id>"]["description"]` *is* the response template. The runner builds the intro from `role` + `description` + optional `brief`. If you need richer per-bot text generation, write to `/tmp/gstack-intelligence/outbox/<id>.jsonl` from your brain process; don't bake long strings into the runner.

## Adding a new mode

The `--mode` flag drives launcher selection. Today: `audio` (`launch.sh` → `bridge.py`) and `avatar` (`launch-visual.sh` → `bridge-visual.py`). A new mode follows the audio/avatar pattern:

1. **New launcher** — `scripts/launch-<mode>.sh`, copy `launch.sh` and swap the bridge path / args. Keep the `< <(tail -n 0 -f "$CMDS")` stdin redirect; that's the boardroom-style command channel and the runner relies on it.
2. **Wire the runner** — `specialist_runner.py:start_bridge()` picks the script. Add a branch:

   ```python
   if self.mode == "your-mode":
       script = SCRIPTS_DIR / "launch-your-mode.sh"
       cmd = ["bash", str(script), self.meet_url, self.spec_id, self.display_name,
              self.voice, str(self.session_dir), <your extra args>]
   ```

3. **Whitelist server-side** — `server.py:_handle_dispatch()` validates `mode in ("audio", "avatar")`. Add yours to the tuple. Default mode is `avatar`.
4. **Vendor a bridge** if the AgentCall command-line is different enough — `vendor/bridge-<mode>.py`. Keep it stdin/stdout JSON; the runner can't talk to anything else.

Screenshare-recap mode (where the bot pulls up `recap-page/` as it speaks) is the natural next one — `recap-page/index.html` is already designed to be the target. PRs welcome.

## Code style and constraints

- **Stdlib only on the Python side.** `server.py` and `specialist_runner.py` must run with a fresh Python 3.10+ install, no pip. The vendored bridges depend on `aiohttp` and `websockets`; that's the only allowed exception, and only because they're handed to us by AgentCall.
- **Vanilla JS on the client.** No build step, no React, no Tailwind. CSS variables and one `<script>` block. The whole dashboard is one file by design — it makes the Show HN demo "view source" satisfying.
- **One file per concept.** The dispatcher is one file. The runner is one file. The dashboard is one file. If you're tempted to break something into a package, it probably doesn't belong here yet.
- **Keep `specialists.js` and `server.py:SPECIALISTS` in lockstep.** Same ids, same display names. There's no automated check (yet); a TODO comment at the top of each is fine.
- **No emojis in source files unless rendered as UI.** The specialist `icon` field is a unicode glyph — that's fine; it's data. Don't sprinkle them in log strings or comments.
- **Stderr for diagnostics, stdout JSON for protocol.** The bridges enforce this. The runner inherits the convention.

## Updating the vendored bridges

The vendored copies live at `vendor/bridge.py`, `vendor/bridge-visual.py`, and `vendor/tunnel.py`. They are pinned forks of the AgentCall `join-meeting` skill's scripts.

To pull a new upstream:

```bash
# Diff the vendored copy against the latest skill copy.
diff -u vendor/bridge.py ~/.claude/skills/join-meeting/scripts/python/bridge.py
diff -u vendor/bridge-visual.py ~/.claude/skills/join-meeting/scripts/python/bridge-visual.py
diff -u vendor/tunnel.py ~/.claude/skills/join-meeting/scripts/python/tunnel.py
```

If the diff is small and our patches still apply, copy the upstream and re-apply by hand:

```bash
cp ~/.claude/skills/join-meeting/scripts/python/bridge.py vendor/bridge.py
cp ~/.claude/skills/join-meeting/scripts/python/bridge-visual.py vendor/bridge-visual.py
cp ~/.claude/skills/join-meeting/scripts/python/tunnel.py vendor/tunnel.py
# then re-apply the timing/destination fixes; run a smoke test before committing.
```

If the diff is large, don't auto-merge. Open an issue, paste the upstream commit, and we'll re-vendor deliberately. The vendored copies are the closest thing this repo has to a critical dependency.

## Sending a PR

- One change per PR.
- Run `python3 server.py`, dispatch a single specialist into a real Meet, watch them greet, recall them. That's the smoke test.
- If you touch the runner's lifecycle, dispatch two specialists and watch them not stomp on each other's audio (cross-bot speech lock).
- If you touch the avatar page, open `avatar-page/preview.html` and confirm all 18 cards render before/after.
