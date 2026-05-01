#!/usr/bin/env python3
"""
gstack × AgentCall — specialist runner (v2, boardroom-inspired).

Thin Python supervisor around one bash-spawned AgentCall bridge. Instead of
managing a FIFO pipe to bridge stdin, this version appends JSON commands to
a per-specialist `.cmds` file that the launch.sh script tails via process
substitution (`bridge.py < <(tail -n 0 -f <id>.cmds)`). That matches the
boardroom architecture and eliminates our earlier pipe deadlocks.

Responsibilities
----------------
1. Spawn the bridge via scripts/launch.sh  (audio mode)
   or scripts/launch-visual.sh  (avatar mode with shared avatar server).
2. Tail the bridge's event file (<session_dir>/<id>.jsonl) and:
     • greet on first participant.joined or call.bot_ready
     • (LISTENER only) forward user.message events to the intelligence bus
       inbox, dropping echoes from other specialist bots.
     • on tts.error / call.ended, log + shut down.
3. Tail the intelligence-bus outbox file
   (/tmp/gstack-intelligence/outbox/<id>.jsonl) and turn each line into a
   tts.speak command appended to the bridge's cmds file.
4. On SIGTERM / SIGINT: append {"command":"leave"} to cmds, wait briefly
   for call.ended, then exit.

Only ONE runner per session should be flagged --listener. That runner is
the single source of user.message events pushed to the intelligence bus —
other bots hear the room via their own bridges but their transcripts are
ignored. This is the boardroom LISTENER pattern; it's how we avoid N-times
duplicate events and bot-to-bot feedback loops.
"""
from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

# ──────────────────────────────────────────────────────────────────────────────
# Paths
# ──────────────────────────────────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parent
SCRIPTS_DIR = ROOT / "scripts"
LAUNCH_AUDIO  = SCRIPTS_DIR / "launch.sh"
LAUNCH_VISUAL = SCRIPTS_DIR / "launch-visual.sh"

# Intelligence bus — shared across all specialists in all sessions.
BUS_DIR = Path("/tmp/gstack-intelligence")
BUS_DIR.mkdir(parents=True, exist_ok=True)
(BUS_DIR / "outbox").mkdir(parents=True, exist_ok=True)
INBOX = BUS_DIR / "inbox.jsonl"

# Cross-bot echo filter — display names of every known bot (self included).
# Listener runner drops user.message events where `speaker.name` matches any
# of these (case-insensitive).
SPECIALIST_DISPLAY_NAMES = {
    "YC Office Hours", "CEO", "Eng Manager", "Senior Designer", "DX Lead",
    "Design Partner", "Design Explorer", "Design Engineer", "Staff Engineer",
    "Debugger", "Designer Who Codes", "DX Tester", "QA Lead", "CSO",
    "Release Engineer", "Deploy Engineer", "SRE", "Retro Facilitator",
    "Claude", "Juno", "Codex",  # common host-bot names
}


# ──────────────────────────────────────────────────────────────────────────────
# Runner
# ──────────────────────────────────────────────────────────────────────────────

class Runner:
    def __init__(self, args):
        self.meet_url: str = args.meet_url
        self.spec_id:  str = args.specialist_id
        self.display_name: str = args.name
        self.role: str = args.role
        self.description: str = args.description
        self.voice: str = args.voice
        self.mode: str = (args.mode or "audio").lower()
        self.session_dir: Path = Path(args.session_dir).resolve()
        self.avatar_port: int = int(args.avatar_port or 0)
        self.is_listener: bool = bool(args.listener)
        self.brief: str = (args.brief or "").strip()[:500]

        self.session_dir.mkdir(parents=True, exist_ok=True)

        self.cmds_path:   Path = self.session_dir / f"{self.spec_id}.cmds"
        self.events_path: Path = self.session_dir / f"{self.spec_id}.jsonl"
        self.outbox_path: Path = BUS_DIR / "outbox" / f"{self.spec_id}.jsonl"

        # Touch files so the tail threads never race on stat.
        self.cmds_path.touch(exist_ok=True)
        self.events_path.touch(exist_ok=True)
        self.outbox_path.touch(exist_ok=True)

        # Append runner logs to the shared orchestrator log (same file
        # launch.sh uses so all correlated lines stay in one place).
        self.log_path: Path = self.session_dir / "orchestrator.log"
        self.log_fh = open(self.log_path, "a", buffering=1)

        self.greeted = False
        self.seen_self_join = False
        self.shutting_down = False
        self.call_ended = False
        self.bridge_proc: subprocess.Popen | None = None

    # ── logging ────────────────────────────────────────────────────────────
    def log(self, msg: str):
        ts = time.strftime("%Y-%m-%d %H:%M:%S")
        line = f"[{ts}] [{self.spec_id}] {msg}\n"
        try:
            self.log_fh.write(line)
        except Exception:
            pass
        try:
            sys.stderr.write(line)
            sys.stderr.flush()
        except Exception:
            pass

    # ── command append ─────────────────────────────────────────────────────
    def send_cmd(self, cmd: dict) -> None:
        """Append one JSON command line to the bridge's cmds file.

        Bridge is tailing this file via `tail -n 0 -f` inside launch.sh —
        the append is picked up immediately. Thread-safe because we open
        append-only and each write is one line.

        In avatar mode, we force destination="meeting" on tts.speak so
        audio is injected directly into the call instead of being routed
        through the webpage's Web Audio API. The avatar page still gets
        voice.state events for visual feedback, but the speech path is
        the same rock-solid audio-mode path.
        """
        try:
            if self.mode == "avatar" and cmd.get("command") == "tts.speak":
                cmd.setdefault("destination", "meeting")
            with open(self.cmds_path, "a", buffering=1) as fh:
                fh.write(json.dumps(cmd) + "\n")
            self.log(f"→ cmds: {cmd.get('command', '?')}")
        except Exception as e:
            self.log(f"cmd append failed: {e}")

    # ── greeting ───────────────────────────────────────────────────────────
    def greeting_text(self) -> str:
        desc = (self.description or "").rstrip()
        if desc and not desc.endswith((".", "!", "?")):
            desc += "."
        brief_sentence = ""
        if self.brief:
            b = " ".join(self.brief.split())
            if len(b) > 80:
                b = b[:80].rstrip() + "…"
            brief_sentence = f"Briefed on: {b}. "
        return (
            f"Hi, I'm the {self.role} from gstack. "
            f"{desc} {brief_sentence}Ready when you need me."
        ).strip()

    def greet_once(self, reason: str) -> None:
        if self.greeted or self.shutting_down:
            return
        self.greeted = True
        text = self.greeting_text()
        self.log(f"greeting ({reason}): {text!r}")
        self.send_cmd({"command": "tts.speak", "text": text, "voice": self.voice})

    # ── bridge spawn via bash launcher ─────────────────────────────────────
    def start_bridge(self) -> None:
        if self.mode == "avatar":
            if not self.avatar_port:
                raise RuntimeError("--avatar-port required in avatar mode")
            script = LAUNCH_VISUAL
            cmd = [
                "bash", str(script),
                self.meet_url, self.spec_id, self.display_name,
                self.voice, str(self.session_dir), str(self.avatar_port),
            ]
        else:
            script = LAUNCH_AUDIO
            cmd = [
                "bash", str(script),
                self.meet_url, self.spec_id, self.display_name,
                self.voice, str(self.session_dir),
            ]

        if not script.exists():
            raise RuntimeError(f"launch script missing: {script}")

        self.log(f"spawning bridge via {script.name} mode={self.mode}")

        # IMPORTANT: do NOT capture bash's stdout via PIPE. launch.sh uses
        # `<(tail -n 0 -f CMDS)` process substitution, and the tail child
        # inherits the stdout fd of its parent shell. If we pipe bash's
        # stdout to Python, `communicate()` blocks until that fd closes —
        # but tail keeps it open for the bridge's lifetime, so we'd hang.
        # Route launch.sh output into orchestrator.log (same file
        # launch.sh itself redirects the bridge's stdio into) and wait on
        # the bash script with a short timeout.
        log_fh = open(self.session_dir / "orchestrator.log", "a")
        self.bridge_proc = subprocess.Popen(
            cmd,
            stdin=subprocess.DEVNULL,
            stdout=log_fh,
            stderr=log_fh,
            text=True,
            env=os.environ.copy(),
        )
        try:
            rc = self.bridge_proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            # launch.sh should exit in <2s after spawning. If it doesn't,
            # something is wrong with the script itself.
            self.bridge_proc.kill()
            raise RuntimeError("launch.sh did not exit within 10s")
        finally:
            try:
                log_fh.close()
            except Exception:
                pass
        if rc != 0:
            raise RuntimeError(f"launcher exited rc={rc}")

    # ── bridge-event tail ──────────────────────────────────────────────────
    def _events_tail(self) -> None:
        """Tail <session>/<id>.jsonl forever. Dispatches to handle_event.

        Opens the file and seeks to end-of-file (we only process events that
        land after we started — prior lines were from earlier runs).
        """
        try:
            fh = open(self.events_path, "r", encoding="utf-8")
            fh.seek(0, os.SEEK_END)
        except Exception as e:
            self.log(f"events tail open failed: {e}")
            return

        while not self.shutting_down:
            line = fh.readline()
            if not line:
                time.sleep(0.25)
                continue
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except Exception:
                self.log(f"non-json event: {line[:160]}")
                continue
            try:
                self.handle_event(event)
            except Exception as e:
                self.log(f"handle_event error: {e}")

        try:
            fh.close()
        except Exception:
            pass

    def handle_event(self, event: dict) -> None:
        kind = event.get("event") or event.get("type") or ""

        if kind == "greeting.prompt":
            self.greet_once("greeting.prompt")
            return

        if kind == "call.bot_ready":
            # Fallback trigger in case greeting.prompt never fires.
            self.greet_once("call.bot_ready")
            return

        if kind == "participant.joined":
            name = (event.get("name") or "").strip()
            if not self.seen_self_join and name and name.lower() == self.display_name.lower():
                self.seen_self_join = True
                return
            self.greet_once("participant.joined")
            return

        if kind == "user.message" and self.is_listener:
            self._forward_to_inbox(event)
            return

        if kind == "call.ended":
            self.log(f"call ended: reason={event.get('reason')}")
            self.call_ended = True
            self.shutting_down = True
            return

        if kind == "tts.error":
            self.log(f"tts.error: {event.get('reason')}")
            return

    # ── listener → inbox forwarding ────────────────────────────────────────
    def _forward_to_inbox(self, event: dict) -> None:
        """Push user.message to the intelligence bus inbox, minus echoes."""
        speaker = ""
        sp = event.get("speaker")
        if isinstance(sp, dict):
            speaker = (sp.get("name") or "").strip()
        elif isinstance(sp, str):
            speaker = sp.strip()

        # Echo filter — any known specialist/host display name gets dropped.
        if speaker and speaker.lower() in {n.lower() for n in SPECIALIST_DISPLAY_NAMES}:
            return

        text = (event.get("text") or "").strip()
        if not text:
            return

        entry = {
            "ts":            time.time(),
            "specialist_id": self.spec_id,
            "name":          self.display_name,
            "role":          self.role,
            "description":   self.description,
            "brief":         self.brief,
            "speaker":       speaker,
            "text":          text,
        }
        try:
            with open(INBOX, "a", buffering=1) as fh:
                fh.write(json.dumps(entry) + "\n")
            self.log(f"→ inbox [{speaker}]: {text[:80]!r}")
        except Exception as e:
            self.log(f"inbox write failed: {e}")

    # ── outbox tail → tts.speak ────────────────────────────────────────────
    def _outbox_tail(self) -> None:
        """Claude session writes reply JSON lines here; we speak each one."""
        try:
            fh = open(self.outbox_path, "r", encoding="utf-8")
            fh.seek(0, os.SEEK_END)
        except Exception as e:
            self.log(f"outbox open failed: {e}")
            return

        while not self.shutting_down:
            line = fh.readline()
            if not line:
                time.sleep(0.25)
                continue
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except Exception:
                self.log(f"outbox non-json: {line[:160]}")
                continue

            text = (msg.get("text") or "").strip()
            if not text:
                continue

            # Allow outbox entries to override voice (e.g., whisper variant).
            voice = msg.get("voice") or self.voice
            self.log(f"← outbox: {text[:80]!r}")
            self.send_cmd({"command": "tts.speak", "text": text, "voice": voice})

    # ── main ───────────────────────────────────────────────────────────────
    def install_signal_handlers(self) -> None:
        def handler(signum, _frame):
            self.log(f"caught signal {signum}")
            self.shutdown(from_signal=True)
            os._exit(0)
        signal.signal(signal.SIGTERM, handler)
        signal.signal(signal.SIGINT, handler)

    def run(self) -> int:
        self.log(
            f"runner starting id={self.spec_id} name={self.display_name!r} "
            f"role={self.role!r} mode={self.mode} listener={self.is_listener} "
            f"session={self.session_dir}"
        )
        self.install_signal_handlers()

        try:
            self.start_bridge()
        except Exception as e:
            self.log(f"bridge spawn failed: {e}")
            return 2

        # Background tails for bridge events and intelligence outbox.
        threading.Thread(target=self._events_tail, daemon=True).start()
        threading.Thread(target=self._outbox_tail, daemon=True).start()

        # 20s fallback greeting — demo safety net.
        def delayed_greet():
            time.sleep(20)
            if not self.greeted and not self.shutting_down:
                self.greet_once("timeout-fallback")
        threading.Thread(target=delayed_greet, daemon=True).start()

        # Idle loop — tails are threaded, signals drive shutdown. We just
        # park here until call ends or we're signalled.
        try:
            while not self.shutting_down:
                time.sleep(0.5)
        except KeyboardInterrupt:
            self.shutdown(from_signal=True)

        # If call ended naturally (not signalled), do polite cleanup but
        # don't double-send leave.
        if not self.call_ended:
            self.shutdown(from_signal=False)

        self.log(f"runner exiting (call_ended={self.call_ended})")
        return 0

    # ── shutdown ───────────────────────────────────────────────────────────
    def shutdown(self, from_signal: bool) -> None:
        if self.shutting_down and not from_signal:
            return
        self.shutting_down = True
        self.log(f"shutdown from_signal={from_signal}")
        try:
            if not self.call_ended:
                self.send_cmd({"command": "leave"})
                # Give bridge a moment to process leave + emit call.ended.
                time.sleep(2)
        except Exception as e:
            self.log(f"leave append failed: {e}")


# ──────────────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────────────

def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--meet-url",      required=True)
    p.add_argument("--specialist-id", required=True)
    p.add_argument("--name",          required=True)
    p.add_argument("--role",          required=True)
    p.add_argument("--description",   required=True)
    p.add_argument("--voice",         default="af_heart")
    p.add_argument("--mode",          choices=("audio", "avatar"), default="avatar")
    p.add_argument("--session-dir",   required=True,
                   help="per-dispatch dir; holds <id>.cmds, <id>.jsonl, session.pid, orchestrator.log")
    p.add_argument("--avatar-port", type=int, default=0,
                   help="avatar-mode only — local port serving the avatar page")
    p.add_argument("--listener", action="store_true",
                   help="forward this bridge's user.message events to the intelligence-bus inbox")
    p.add_argument("--brief", default="",
                   help="optional free-text brief referenced in the greeting")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    return Runner(args).run()


if __name__ == "__main__":
    sys.exit(main())
