#!/usr/bin/env bash
# launch.sh — spawn one AgentCall bridge.py for a single specialist (audio-only).
#
# Adapted from boardroom's launch.sh. Key mechanism: bridge.py reads stdin
# from `tail -n 0 -f <persona>.cmds` via process substitution, so the
# orchestrator can append JSON commands live to the cmds file without any
# FIFO bookkeeping.
#
# Usage:
#   bash launch.sh <meet_url> <id> <bot_name> <voice> <session_dir>
#
# Writes:
#   <session_dir>/<id>.cmds    — command stream (tailed by bridge)
#   <session_dir>/<id>.jsonl   — bridge events (--output)
#   <session_dir>/orchestrator.log  — combined bridge stderr/stdout
#   <session_dir>/session.pid  — bridge pid appended
set -euo pipefail

if [[ $# -lt 5 ]]; then
  echo "usage: $0 <meet_url> <id> <bot_name> <voice> <session_dir>" >&2
  exit 2
fi

URL="$1"
ID="$2"
BOT_NAME="$3"
VOICE="$4"
SESSION="$5"

# Bridge script lookup — prefer env var, fall back to known install paths.
BRIDGE="${BRIDGE_SCRIPT:-}"
if [[ -z "$BRIDGE" ]]; then
  HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  for p in \
    "$HERE/../vendor/bridge.py" \
    "$HOME/.claude/skills/join-meeting/scripts/python/bridge.py" \
    "$HOME/.claude/skills/agentcall/scripts/python/bridge.py" \
    "$HOME/.claude/plugins/marketplaces/agentcall/scripts/python/bridge.py" \
    "$HOME/.claude/plugins/cache/agentcall/join-meeting/1.0.0/scripts/python/bridge.py"; do
    if [[ -f "$p" ]]; then
      BRIDGE="$(cd "$(dirname "$p")" && pwd)/$(basename "$p")"
      break
    fi
  done
fi
if [[ -z "$BRIDGE" || ! -f "$BRIDGE" ]]; then
  echo "FATAL: bridge.py not found. Set BRIDGE_SCRIPT env var." >&2
  exit 2
fi

mkdir -p "$SESSION"
CMDS="$SESSION/$ID.cmds"
OUT="$SESSION/$ID.jsonl"
LOG="$SESSION/orchestrator.log"

# Create files if missing. Never truncate.
[[ -f "$CMDS" ]] || : > "$CMDS"
[[ -f "$OUT"  ]] || : > "$OUT"

# Spawn. `tail -n 0 -f CMDS` pipes only new lines appended after this moment,
# so previous noise doesn't re-fire.
PYTHONUNBUFFERED=1 python3 "$BRIDGE" "$URL" \
  --name "$BOT_NAME" --voice "$VOICE" --output "$OUT" \
  < <(tail -n 0 -f "$CMDS") \
  >> "$LOG" 2>&1 &

BRIDGE_PID=$!
echo "$BRIDGE_PID" >> "$SESSION/session.pid"
echo "spawned id=$ID bot=$BOT_NAME voice=$VOICE pid=$BRIDGE_PID cmds=$CMDS out=$OUT"
