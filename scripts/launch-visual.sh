#!/usr/bin/env bash
# launch-visual.sh — spawn bridge-visual.py for a specialist in avatar mode.
#
# Adapted from boardroom's launch-visual.sh. The avatar HTML is shared
# across all specialists (gstack-joins-meeting/avatar-page/ serves name-keyed SVG);
# each bot just tunnels to the same local http.server on $AVATAR_PORT and
# FirstCall appends ?name=<bot_name> so the page picks the right avatar.
#
# Usage:
#   bash launch-visual.sh <meet_url> <id> <bot_name> <voice> <session_dir> <avatar_port>
#
# Writes:
#   <session_dir>/<id>.cmds      — command stream (tailed by bridge)
#   <session_dir>/<id>.jsonl     — bridge events (--output)
#   <session_dir>/orchestrator.log
#   <session_dir>/session.pid    — bridge pid appended
set -euo pipefail

if [[ $# -lt 6 ]]; then
  echo "usage: $0 <meet_url> <id> <bot_name> <voice> <session_dir> <avatar_port>" >&2
  exit 2
fi

URL="$1"
ID="$2"
BOT_NAME="$3"
VOICE="$4"
SESSION="$5"
AVATAR_PORT="$6"

BRIDGE="${BRIDGE_VISUAL_SCRIPT:-}"
if [[ -z "$BRIDGE" ]]; then
  # Prefer our locally vendored, patched copy (survives plugin updates).
  HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  for p in \
    "$HERE/../vendor/bridge-visual.py" \
    "$HOME/.claude/skills/join-meeting/scripts/python/bridge-visual.py" \
    "$HOME/.claude/skills/agentcall/scripts/python/bridge-visual.py" \
    "$HOME/.claude/plugins/marketplaces/agentcall/scripts/python/bridge-visual.py" \
    "$HOME/.claude/plugins/cache/agentcall/join-meeting/1.0.0/scripts/python/bridge-visual.py"; do
    if [[ -f "$p" ]]; then
      BRIDGE="$(cd "$(dirname "$p")" && pwd)/$(basename "$p")"
      break
    fi
  done
fi
if [[ -z "$BRIDGE" || ! -f "$BRIDGE" ]]; then
  echo "FATAL: bridge-visual.py not found. Set BRIDGE_VISUAL_SCRIPT env var." >&2
  exit 2
fi

mkdir -p "$SESSION"
CMDS="$SESSION/$ID.cmds"
OUT="$SESSION/$ID.jsonl"
LOG="$SESSION/orchestrator.log"

[[ -f "$CMDS" ]] || : > "$CMDS"
[[ -f "$OUT"  ]] || : > "$OUT"

# Optional: pre-arm a screenshare port so a runtime `screenshare.start`
# can flip on screenshare without renegotiating the call. Set
# SCREENSHARE_PORT=<port> in env before invoking this launcher.
SCREENSHARE_ARG=()
if [[ -n "${SCREENSHARE_PORT:-}" ]]; then
  SCREENSHARE_ARG=(--screenshare-port "$SCREENSHARE_PORT")
fi

PYTHONUNBUFFERED=1 python3 "$BRIDGE" "$URL" \
  --name "$BOT_NAME" --voice "$VOICE" \
  --ui-port "$AVATAR_PORT" \
  "${SCREENSHARE_ARG[@]}" \
  --vad-timeout "${VAD_TIMEOUT:-0.8}" \
  --output "$OUT" \
  < <(tail -n 0 -f "$CMDS") \
  >> "$LOG" 2>&1 &

BRIDGE_PID=$!
echo "$BRIDGE_PID" >> "$SESSION/session.pid"
echo "spawned id=$ID bot=$BOT_NAME voice=$VOICE pid=$BRIDGE_PID avatar_port=$AVATAR_PORT screenshare_port=${SCREENSHARE_PORT:-} cmds=$CMDS out=$OUT"
