#!/usr/bin/env bash
# kill-session.sh — emergency teardown for a gstack × AgentCall session.
#
# Adapted from boardroom. Best-effort graceful leave via each bridge's cmds
# file first, then SIGTERM anything in session.pid, then SIGKILL stragglers.
#
# Usage:  bash kill-session.sh <session_dir>
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <session_dir>" >&2
  exit 2
fi

SESSION="$1"
if [[ ! -d "$SESSION" ]]; then
  echo "session dir not found: $SESSION" >&2
  exit 1
fi

# 1. Graceful leave for every bridge via its cmds file.
shopt -s nullglob
for CMDS in "$SESSION"/*.cmds; do
  printf '%s\n' '{"command":"leave"}' >> "$CMDS" 2>/dev/null || true
done

# 2. Give bridges up to 5s to leave cleanly.
sleep 5

# 3. SIGTERM, then SIGKILL, anything listed in session.pid.
PID_FILE="$SESSION/session.pid"
if [[ -f "$PID_FILE" ]]; then
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    kill -0 "$pid" 2>/dev/null && kill -TERM "$pid" 2>/dev/null || true
  done < "$PID_FILE"
  sleep 2
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
  done < "$PID_FILE"
fi

# 4. Report stragglers matching this session dir.
REMAINING=$(pgrep -f "$SESSION" 2>/dev/null || true)
if [[ -n "$REMAINING" ]]; then
  echo "warning: processes still running matching $SESSION:" >&2
  echo "$REMAINING" >&2
  exit 1
fi
echo "session $SESSION torn down cleanly"
