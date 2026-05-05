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


# Subprocess env hardening — we only pass the bridge what it needs, so
# unrelated dev secrets (AWS, GitHub, etc.) don't leak into vendored code.
_SAFE_ENV_KEYS = frozenset({
    "PATH", "HOME", "USER", "LOGNAME", "SHELL", "PWD",
    "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TZ",
    "PYTHONUNBUFFERED", "PYTHONPATH",
    "AGENTCALL_API_KEY", "AGENTCALL_API_URL",
})


def _safe_env() -> dict:
    return {k: v for k, v in os.environ.items() if k in _SAFE_ENV_KEYS}
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
# Intelligence bus — per-user directory with mode 0700 so other users on a
# shared host cannot drop arbitrary lines into a specialist's outbox (which
# would be spoken in the meeting in the bot's voice). The plain
# /tmp/gstack-intelligence path is symlinked here for backwards compat.
import getpass as _getpass
def _bus_dir() -> Path:
    uid = os.getuid() if hasattr(os, "getuid") else 0
    p = Path(f"/tmp/gstack-intelligence-{uid}")
    p.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        os.chmod(p, 0o700)
    except Exception:
        pass
    (p / "outbox").mkdir(parents=True, exist_ok=True, mode=0o700)
    # Back-compat symlink so old paths keep working for THIS user only.
    legacy = Path("/tmp/gstack-intelligence")
    try:
        if not legacy.exists():
            legacy.symlink_to(p)
    except Exception:
        pass
    return p

BUS_DIR = _bus_dir()
INBOX = BUS_DIR / "inbox.jsonl"

# Cross-bot echo filter — display names of every known bot (self included).
# Listener runner drops user.message events where `speaker.name` matches any
# of these (case-insensitive). Sourced from data/specialists.json so adding
# a specialist there automatically propagates here. The "host bot" names
# (Claude/Juno/Codex) are added because those are the names a coding-agent
# bridge tends to use, regardless of whether they're in the specialist set.
def _load_specialist_names() -> set[str]:
    here = Path(__file__).resolve().parent
    json_path = here / "data" / "specialists.json"
    names: set[str] = {"Claude", "Juno", "Codex"}
    if json_path.is_file():
        try:
            for s in json.loads(json_path.read_text()):
                if "name" in s:
                    names.add(s["name"])
        except Exception:
            pass
    # Hardcoded fallback so a misplaced data dir never breaks the echo guard.
    names.update({
        "YC Office Hours", "CEO", "Eng Manager", "Senior Designer", "DX Lead",
        "Design Partner", "Design Explorer", "Design Engineer", "Staff Engineer",
        "Debugger", "Designer Who Codes", "DX Tester", "QA Lead", "CSO",
        "Release Engineer", "Deploy Engineer", "SRE", "Retro Facilitator",
    })
    return names

SPECIALIST_DISPLAY_NAMES = _load_specialist_names()


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
        self.bot_ready = False
        self.seen_self_join = False
        self.shutting_down = False
        self.call_ended = False
        self.bridge_proc: subprocess.Popen | None = None
        # Cross-specialist speech lock: only one bot speaks at a time so
        # overlapping TTS doesn't garble the meeting.
        self.speech_lock_path: Path = BUS_DIR / "speaking.lock"
        self._holding_lock = False
        self._lock_acquired_ts: float = 0.0

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
        """
        try:
            with open(self.cmds_path, "a", buffering=1) as fh:
                fh.write(json.dumps(cmd) + "\n")
            self.log(f"→ cmds: {cmd.get('command', '?')}")
        except Exception as e:
            self.log(f"cmd append failed: {e}")

    def _tts_speak_cmd(self, text: str, voice: str | None = None,
                       destination: str | None = None) -> dict:
        """Build a tts.speak command, defaulting to destination='meeting' in avatar mode.

        Why: the bridge's auto-routing tts.speak honors the call's mode.
        For an avatar (webpage-av) call that means audio is sent ONLY to the
        bot's webpage and never injected into the meeting. That path goes
        through FirstCall's headless browser and has empirically been
        unreliable — when used during this session it caused the AgentCall
        WebSocket to drop without firing tts.done, so the user heard nothing.

        Setting destination='meeting' makes the bridge use the explicit-routing
        tts.generate API, which injects audio straight into the meeting room
        and reliably fires tts.done. This matches the bridge's own design
        comments at vendor/bridge-visual.py near the tts.speak handler.

        An earlier revision of this file removed the default; that was a
        misdiagnosis (tts drops were the *symptom*, not the *cause*).
        """
        cmd: dict = {
            "command": "tts.speak",
            "text": text,
            "voice": voice or self.voice,
        }
        if destination is None and self.mode == "avatar":
            destination = "meeting"
        if destination:
            cmd["destination"] = destination
        return cmd

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
        self.send_cmd(self._tts_speak_cmd(text))

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
            env=_safe_env(),
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

        # Track when the bot is actually inside the meeting. Anything that
        # produces audio BEFORE this gets silently dropped by the AgentCall
        # server (no meeting audio context yet → tts.done with no playback).
        if kind == "call.bot_ready":
            self.bot_ready = True
            self.greet_once("call.bot_ready")
            return

        if kind == "greeting.prompt":
            # The skill-emitted prompt fires only after the bot is in the
            # meeting AND a participant has joined — so it's safe to greet.
            self.bot_ready = True
            self.greet_once("greeting.prompt")
            return

        if kind == "participant.joined":
            name = (event.get("name") or "").strip()
            if not self.seen_self_join and name and name.lower() == self.display_name.lower():
                self.seen_self_join = True
                return
            # Only greet on participant.joined if the bot has confirmed entry.
            # Otherwise the join event might be from the meeting roster being
            # snapshotted while we're still in the waiting room.
            if self.bot_ready:
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

        if kind in ("tts.done", "tts.error", "tts.interrupted"):
            # Speech finished — release the cross-bot lock so others can talk.
            if kind == "tts.error":
                self.log(f"tts.error: {event.get('reason')}")
            self._release_speech_lock()
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

    # ── shared speech lock ────────────────────────────────────────────────
    # Cross-bot lock so only one specialist talks at a time. Lock file format:
    #   "<pid> <acquire-ts>"
    # Self-healing: any holder past TTS_MAX_HOLD seconds, or whose PID is
    # dead, is stolen by the next acquirer. A per-runner watchdog also
    # force-releases its own lock if held past TTS_MAX_HOLD without a
    # tts.done event arriving — defense against stuck locks if the bridge
    # crashes mid-TTS.
    TTS_MAX_HOLD: float = 12.0

    def _acquire_speech_lock(self, max_wait: float = 12.0) -> bool:
        """Wait until the cross-bot lock is free, then claim it."""
        deadline = time.time() + max_wait
        while time.time() < deadline:
            if not self.speech_lock_path.exists():
                break
            try:
                contents = self.speech_lock_path.read_text(encoding="utf-8").strip().split()
                pid = int(contents[0])
                ts = float(contents[1]) if len(contents) > 1 else 0.0
                stale_age = time.time() - ts
                # Holder dead OR stale OR it's us already → break and re-claim.
                if (stale_age > self.TTS_MAX_HOLD
                        or not self._pid_alive(pid)
                        or pid == os.getpid()):
                    break
            except Exception:
                break  # corrupt lock → steal
            time.sleep(0.1)
        try:
            self.speech_lock_path.write_text(f"{os.getpid()} {time.time()}\n",
                                             encoding="utf-8")
            self._holding_lock = True
            self._lock_acquired_ts = time.time()
            return True
        except Exception as e:
            self.log(f"lock write failed: {e}")
            return False

    def _release_speech_lock(self) -> None:
        if not self._holding_lock:
            return
        self._holding_lock = False
        try:
            # Only remove if it's still ours.
            contents = self.speech_lock_path.read_text(encoding="utf-8").strip().split()
            if contents and int(contents[0]) == os.getpid():
                self.speech_lock_path.unlink(missing_ok=True)
        except Exception:
            pass

    def _speech_lock_watchdog(self) -> None:
        """Force-release the lock if we've been holding it past the budget.

        Defends against a stuck lock if the bridge never emits tts.done
        (crash, hang, or the AgentCall server dropping the response).
        Polls cheaply every 1s.
        """
        while not self.shutting_down:
            try:
                if self._holding_lock:
                    held_for = time.time() - getattr(self, "_lock_acquired_ts", 0)
                    if held_for > self.TTS_MAX_HOLD:
                        self.log(f"watchdog: force-releasing stale lock held {held_for:.1f}s")
                        self._release_speech_lock()
            except Exception:
                pass
            time.sleep(1.0)

    @staticmethod
    def _pid_alive(pid: int) -> bool:
        try:
            os.kill(pid, 0)
            return True
        except (ProcessLookupError, PermissionError, OSError):
            return False

    # ── outbox tail → tts.speak / send_chat / screenshare ─────────────────
    def _outbox_tail(self) -> None:
        """Claude session writes reply JSON lines; runner forwards them.

        The outbox is a JSONL command stream. Three command shapes:

          {"text": "..."}                   → tts.speak (default)
          {"text": "...",
           "also_chat": true}               → tts.speak + meeting.send_chat
                                              (workaround for sessions where
                                              AgentCall's TTS-to-WebRTC audio
                                              injection is silent but chat
                                              still reaches the room — every
                                              spoken line is mirrored into
                                              the meeting chat panel)
          {"action": "send_chat",
           "message": "..."}                → meeting.send_chat
          {"action": "screenshare.start",
           "url": "https://..."}            → bridge-visual screenshare URL
          {"action": "screenshare.start",
           "port": 3001}                    → bridge-visual screenshare port
          {"action": "screenshare.stop"}    → bridge-visual screenshare off
        """
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

            action = (msg.get("action") or "").strip()

            # --- screenshare control (bridge-visual mode only) ---
            if action == "screenshare.start":
                if self.mode != "avatar":
                    self.log("screenshare.start ignored: not avatar mode")
                    continue
                cmd = {"command": "screenshare.start"}
                if msg.get("url"):
                    cmd["url"] = msg["url"]
                elif msg.get("port"):
                    cmd["port"] = int(msg["port"])
                else:
                    self.log("screenshare.start: need url or port")
                    continue
                self.log(f"← outbox: screenshare.start {cmd.get('url') or cmd.get('port')}")
                self.send_cmd(cmd)
                continue
            if action == "screenshare.stop":
                self.log("← outbox: screenshare.stop")
                self.send_cmd({"command": "screenshare.stop"})
                continue

            # --- chat (no speech lock; chat doesn't collide) ---
            if action == "send_chat":
                chat = (msg.get("message") or "").strip()
                if not chat:
                    continue
                self.log(f"← outbox: send_chat {chat[:60]!r}")
                self.send_cmd({"command": "send_chat", "message": chat})
                continue

            # --- default: tts.speak ---
            text = (msg.get("text") or "").strip()
            if not text:
                continue
            voice = msg.get("voice") or self.voice
            # Honor an outbox-supplied destination (lets a brain force
            # webpage-only audio for testing); otherwise _tts_speak_cmd
            # picks the right default for the bridge mode.
            destination = msg.get("destination")
            # Wait for the room to be quiet before speaking.
            self._acquire_speech_lock()
            self.log(f"← outbox: {text[:80]!r}")
            self.send_cmd(self._tts_speak_cmd(text, voice=voice,
                                              destination=destination))
            # Optional chat mirror — useful when AgentCall's TTS-to-WebRTC
            # audio path silently drops audio (tts.done fires but no one
            # hears anything). Chat goes through a different API path that
            # is empirically reliable, so the spoken content still reaches
            # the room as readable text. Brain opts in per-message.
            if msg.get("also_chat"):
                self.log(f"← outbox: also_chat mirror {text[:60]!r}")
                self.send_cmd({"command": "send_chat", "message": text})

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
        threading.Thread(target=self._speech_lock_watchdog, daemon=True).start()

        # Fallback greeting — only fires if bot reached the meeting but no
        # greeting.prompt arrived. NEVER fires while the bot is still in
        # the waiting room: tts before bot_ready is dropped silently by the
        # AgentCall server, so firing early just wastes the greeting.
        def delayed_greet():
            for _ in range(120):  # poll up to 4 minutes
                time.sleep(2)
                if self.shutting_down or self.greeted:
                    return
                if self.bot_ready:
                    # Bot is in. Wait one more beat to give the natural
                    # greeting.prompt a chance to fire first.
                    time.sleep(3)
                    if not self.greeted and not self.shutting_down:
                        self.greet_once("timeout-fallback")
                    return
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
