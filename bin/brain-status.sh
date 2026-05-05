#!/usr/bin/env bash
# brain-status — show whether dispatched specialists have a Claude
# session driving their replies, or are sitting orphaned with no brain.
#
# Usage:  bin/brain-status.sh
#         bin/brain-status.sh --watch    # refresh every 2s
#
# Exit code: 0 if brain attached or no specialists running,
#            2 if specialists are running with no brain.

set -euo pipefail

UID_=$(id -u)
ACTIVE="/tmp/gstack-specialists-${UID_}/active.json"
INBOX="/tmp/gstack-intelligence-${UID_}/inbox.jsonl"
LOCK="/tmp/gstack-intelligence-${UID_}/speaking.lock"

watch=false
[[ "${1:-}" == "--watch" ]] && watch=true

snapshot() {
  echo
  echo "─── gstack-agentcall brain status ──────────────"
  if [[ -f "$ACTIVE" ]]; then
    n=$(python3 -c "import json,sys; d=json.load(open('$ACTIVE')); print(len(d.get('runners',[])))")
    echo "specialists running: $n"
    if [[ "$n" -gt 0 ]]; then
      python3 -c "
import json
d = json.load(open('$ACTIVE'))
for r in d.get('runners', []):
    print(f\"  · {r.get('name','?'):<22} pid={r.get('pid','?')}  id={r.get('id','?')}\")"
    fi
  else
    echo "specialists running: 0  (no active.json)"
    n=0
  fi

  if [[ -f "$INBOX" ]]; then
    last=$(tail -n 1 "$INBOX" 2>/dev/null)
    if [[ -n "$last" ]]; then
      ago=$(python3 -c "
import json, time
try:
  ts = json.loads('''$last''').get('ts', 0)
  print(int(time.time() - ts))
except Exception:
  print('?')")
      echo "inbox: last event ${ago}s ago"
    else
      echo "inbox: empty"
    fi
  else
    echo "inbox: missing"
  fi

  # Heuristic for "is anyone reading the inbox?": look for a tail/Monitor
  # process whose argv references the inbox path.
  if pgrep -af "$INBOX" 2>/dev/null | grep -v "$0" | grep -v grep | grep -q .; then
    echo "brain: ATTACHED  (a tail/monitor is reading inbox.jsonl)"
    rc=0
  else
    if [[ "$n" -gt 0 ]]; then
      echo "brain: ❗ MISSING  — specialists are running but no Claude"
      echo "        session is monitoring inbox.jsonl. Start one:"
      echo
      echo "  In Claude Code, say: 'why isn't the CEO responding?'"
      echo "  or run:   tail -F $INBOX"
      rc=2
    else
      echo "brain: idle  (nothing to drive)"
      rc=0
    fi
  fi

  if [[ -f "$LOCK" ]]; then
    pid=$(awk '{print $1}' "$LOCK")
    if kill -0 "$pid" 2>/dev/null; then
      echo "speech-lock: held by pid $pid"
    else
      echo "speech-lock: stale (pid $pid dead) — will steal on next acquire"
    fi
  fi
  echo "────────────────────────────────────────────────"
}

if $watch; then
  while true; do
    clear
    snapshot || true
    sleep 2
  done
else
  snapshot
  # snapshot sets `rc` as a global; default 0 if branch never set it.
  exit "${rc:-0}"
fi
