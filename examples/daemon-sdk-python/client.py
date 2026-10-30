#!/usr/bin/env python3
"""
OpenRemotePlay (ORP) — Binary-as-an-SDK Python Wrapper Example
Zero external dependencies (uses standard library subprocess and threading only).
Works with any language or game engine by communicating with orp-daemon over stdin/stdout.
"""

import json
import os
import subprocess
import sys
import threading
import time

class OrpDaemonSDK:
    def __init__(self, daemon_cmd=None):
        if daemon_cmd is None:
            # Default to local orp-daemon executable or node runner
            daemon_bin = os.path.join(os.path.dirname(__file__), "..", "..", "bin", "orp-daemon.mjs")
            self.daemon_cmd = ["node", daemon_bin]
        else:
            self.daemon_cmd = daemon_cmd

        self.proc = None
        self._reader_thread = None
        self._running = False
        self.callbacks = {
            "on_ready": lambda evt: print(f"[SDK] Ready: {evt}"),
            "on_peer_joined": lambda evt: print(f"[SDK] Peer joined: {evt}"),
            "on_input": lambda evt: print(f"[SDK] Input: pad={evt.get('padIndex')} buttons={len(evt.get('buttons', []))}"),
            "on_rumble": lambda evt: print(f"[SDK] Rumble: weak={evt.get('weakMagnitude')} strong={evt.get('strongMagnitude')}"),
            "on_error": lambda evt: print(f"[SDK] Error: {evt}"),
        }

    def start(self):
        """Spawns the orp-daemon process and starts background stdout reader."""
        self.proc = subprocess.Popen(
            self.daemon_cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            universal_newlines=True
        )
        self._running = True
        self._reader_thread = threading.Thread(target=self._stdout_loop, daemon=True)
        self._reader_thread.start()

    def _stdout_loop(self):
        while self._running and self.proc and self.proc.stdout:
            line = self.proc.stdout.readline()
            if not line:
                break
            line = line.strip()
            if not line:
                continue
            try:
                evt = json.loads(line)
                evt_type = evt.get("type", "")
                if evt_type == "evt:ready" and self.callbacks.get("on_ready"):
                    self.callbacks["on_ready"](evt)
                elif evt_type == "evt:peer_joined" and self.callbacks.get("on_peer_joined"):
                    self.callbacks["on_peer_joined"](evt)
                elif evt_type == "evt:input_received" and self.callbacks.get("on_input"):
                    self.callbacks["on_input"](evt)
                elif evt_type == "evt:rumble_received" and self.callbacks.get("on_rumble"):
                    self.callbacks["on_rumble"](evt)
                elif evt_type == "evt:error" and self.callbacks.get("on_error"):
                    self.callbacks["on_error"](evt)
            except Exception as e:
                print(f"[SDK] Failed to parse daemon event: {e}")

    def send_cmd(self, cmd_dict):
        """Writes a single JSON-Lines command to orp-daemon stdin."""
        if not self.proc or not self.proc.stdin:
            raise RuntimeError("orp-daemon process is not running")
        line = json.dumps(cmd_dict) + "\n"
        self.proc.stdin.write(line)
        self.proc.stdin.flush()

    def start_host(self, room_code, modalities=None):
        self.send_cmd({
            "type": "cmd:start_host",
            "roomCode": room_code,
            "modalities": modalities or ["input", "video"]
        })

    def join_session(self, room_code, modalities=None):
        self.send_cmd({
            "type": "cmd:join",
            "roomCode": room_code,
            "modalities": modalities or ["input"]
        })

    def send_gamepad_input(self, pad_index=0, axes=None, buttons=None):
        self.send_cmd({
            "type": "cmd:send_input",
            "padIndex": pad_index,
            "axes": axes or [0.0, 0.0, 0.0, 0.0],
            "buttons": buttons or [{"pressed": False, "value": 0.0}]
        })

    def stop(self):
        self._running = False
        try:
            self.send_cmd({"type": "cmd:stop"})
        except Exception:
            pass
        if self.proc:
            self.proc.terminate()
            self.proc = None


if __name__ == "__main__":
    print("OpenRemotePlay Python Sidecar SDK Example")
    sdk = OrpDaemonSDK()
    sdk.start()

    # Host a game session
    room_id = "test-python-room"
    print(f"Creating host room: {room_id}")
    sdk.start_host(room_id, modalities=["input", "video"])

    # Simulate running game loop
    time.sleep(2)
    sdk.stop()
    print("Demonstration finished.")
