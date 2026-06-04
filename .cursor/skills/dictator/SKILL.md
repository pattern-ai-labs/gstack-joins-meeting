---
name: dictator
description: Voice loop with the local Dictator widget. The user speaks into a floating macOS/Linux/Windows widget; transcripts land in the current project's .dictator/events.jsonl. You respond by appending tts.speak commands to .dictator/commands.jsonl. The widget shows the reply in a bubble and speaks it through local Kokoro TTS. Trigger when the user asks to "start dictator", "use voice mode", "talk to me via the widget", or similar.
---

# Dictator — Voice loop with the local widget

You are now the agent-side of a bidirectional voice bridge. The user speaks into a floating widget on their desktop; their speech arrives here as `utterance.final` events. You reply by writing `tts.speak` commands.

## Files (per-project)

Each project that wants to participate has its own `.dictator/` folder inside it. The widget can bind multiple projects at once; each project's agent operates against its own folder and only sees its own traffic.

- **Events from the user** (read): `$PWD/.dictator/events.jsonl`
- **Commands to the widget** (write): `$PWD/.dictator/commands.jsonl`

Where `$PWD` is your current working directory — the project you're running in. Resolve the absolute path once via `pwd` and use the same path throughout the session.

> If `.dictator/events.jsonl` doesn't exist in the current project, the widget hasn't bound this project yet. Tell the user to click the pill in the Dictator widget → Browse… and pick this folder. Once they do, the file shows up.

## Event schema (you receive)

```json
{"event":"session.started","session_id":"<16 hex chars>","project":"<name>","voice":"af_heart","ts":1731510000.0}
{"event":"utterance.final","session_id":"<id>","text":"hey can you check the build","duration_ms":2400,"audio_seconds":2.4,"ts":1731510003.6}
{"event":"tts.done","session_id":"<id>","ts":1731510010.1}
{"event":"tts.interrupted","session_id":"<id>","ts":1731510010.1}
{"event":"meeting.join_request","session_id":"<id>","url":"https://meet.google.com/abc-defg-hij","mode":"webpage-av-screenshare","bot_name":"June","ts":1731510020.0}
```

`session_id` is `SHA-256(absolute project path)` truncated to 16 hex chars — deterministic per project, but you don't need to compute it; just pass it through (or omit) on outgoing commands.

Two event kinds require action:

- **`utterance.final`** — the user spoke. Reply via `tts.speak`.
- **`meeting.join_request`** *(Phase J)* — the user pasted a meeting URL in the widget and wants this project's agent to join the call. Invoke the `join-meeting` skill (from the AgentCall plugin) with the supplied `url`, `mode`, and `bot_name`. The user has already signed in — the skill picks up the API key from `~/.agentcall/config.json` automatically. While the agent is in the meeting, the user can keep talking to the widget; their utterances continue to arrive as `utterance.final` events even though you're in a live call.

The other events are status signals — log or ignore.

**Phase H — multi-project routing:** the widget routes the user's voice to whichever project the user has picked as the "active speak target" in the widget UI. If you stop receiving `utterance.final` events, the user has likely switched the active target to another project; just wait — when they switch back, events resume.

## Command schema (you write)

One JSON object per line, appended to `$PWD/.dictator/commands.jsonl`. The widget's file watcher picks up new lines within ~500 ms.

| Command | Fields | Effect |
|---|---|---|
| `tts.speak` | `text` (required), `session_id` (optional), `prefix_project_name` (optional bool) | The widget shows the text in a bubble and speaks it via local Kokoro TTS. Replies from non-active projects are auto-prefixed with `From <project>:` by the widget — you don't need to add the prefix yourself. |
| `tts.cancel` | `session_id` (optional) | Clears the current spoken reply and flushes the playback queue. |
| `voice.set` | `voice` (required, one of `af_heart`, `am_adam`, `bf_emma`, `bm_george`), `session_id` (optional) | Switch the voice for subsequent replies. |

```bash
# Example reply (resolve path once)
EVENTS="$PWD/.dictator/events.jsonl"
COMMANDS="$PWD/.dictator/commands.jsonl"

echo '{"command":"tts.speak","text":"Build is green on main."}' >> "$COMMANDS"
```

## How to run the loop

Use the **Monitor + `tail -f` + `grep`** pattern (same as the join-meeting skill). It is kernel-driven — zero idle tokens between utterances, instant reaction when the user speaks.

**1. Start a persistent Monitor** on the events file, filtering to the event types you care about:

```bash
tail -f "$PWD/.dictator/events.jsonl" | grep --line-buffered -E '"event": *"(utterance\.final|meeting\.join_request|session\.started|tts\.(done|interrupted))"'
```

Call this via the `Monitor` tool with `persistent: true`. Each matching line arrives as a task notification. The `grep --line-buffered` flag is REQUIRED — without it the pipe buffers and you get events in multi-minute bursts.

**2. For every `utterance.final` notification:**
   - Parse the JSON, extract `text`.
   - Decide if this is a question/request (respond) or just acknowledgment (skip — keep the reply file quiet).
   - If responding, generate a SHORT reply (1–3 sentences max — the bubble is small and the user is in a real-time conversation).
   - Append one `tts.speak` line to `commands.jsonl`. Use a Bash `echo` with the JSON inside single quotes, or a HEREDOC for replies containing single quotes.

**3. If the user asks for something requiring tool use** (read a file, search the codebase, run a command):
   - First acknowledge with a quick reply: `{"command":"tts.speak","text":"Let me check."}` — so the widget shows immediate feedback.
   - Then do the actual work with your normal tools.
   - When done, send a second `tts.speak` with the result. Keep it short; offer details if the user asks.

**4. On a `meeting.join_request` notification** *(Phase J)*:
   - Acknowledge briefly via `tts.speak`: `{"command":"tts.speak","text":"Joining as June."}`.
   - Invoke the `join-meeting` skill with the event's `url`, `mode`, and `bot_name` fields. The skill takes over the meeting lifecycle and uses `~/.agentcall/config.json` for auth.
   - When the meeting ends, post a short summary via `tts.speak` so the user knows you're back. The widget's `utterance.final` events continue to arrive throughout — keep watching them.

**5. Keep the loop alive until the user explicitly ends it.** Stop the Monitor via `TaskStop` only when:
   - The user says "stop", "exit", "end", "quit", "close" via voice or chat, OR
   - The user kills the widget (you'll stop receiving events).

## Conversation style

- **Short replies.** This is voice; long replies feel robotic.
- **No preamble.** Don't say "Sure, here's what I found." Say the thing.
- **Mid-task acknowledgments** when an action will take >2 s: `{"command":"tts.speak","text":"On it."}` — then do the work.
- **Don't echo the user's question back.** The user already knows what they said.

## Activating

Once the user asks you to start (or you detect a voice-loop intent), do these in order:

1. Resolve the project path: `EVENTS_DIR="$PWD/.dictator"`.
2. Verify the widget has bound this project: check that `$EVENTS_DIR/events.jsonl` exists. If not, tell the user:
   > Dictator hasn't been bound to this project yet. Click the pill in the widget → Browse… and pick this folder.
3. Read the LAST line of the events file with `tail -n 1` to confirm the bind is fresh.
4. Start the Monitor as described above.
5. Send a hello so the user knows the loop is live:
   ```bash
   echo '{"command":"tts.speak","text":"Connected. What do you need?"}' >> "$PWD/.dictator/commands.jsonl"
   ```
6. From here on, react to each `utterance.final` notification as they arrive.

## Multi-project notes

- Multiple agents can run simultaneously in different projects. Each tails its own `.dictator/events.jsonl` and writes to its own `commands.jsonl`. The widget aggregates: only the active project receives the user's speech, but ALL projects' replies are queued and played back FIFO with a `From <project>:` prefix on the bubble + spoken audio (unless the reply is from the active project).
- You don't need to coordinate with other projects' agents — they operate independently, all you do is talk to your own `.dictator/`.
