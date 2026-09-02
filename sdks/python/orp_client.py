"""
orp_client.py — OpenRemotePlay Python SDK v2.0
License: MIT

A minimal, asyncio-based ORP v2 client (viewer role) for headless automation,
AI training bots, or server-side testing. Uses `websockets` for signaling
and `aiortc` for WebRTC DataChannel creation.

Installation:
    pip install websockets aiortc

Usage:
    import asyncio
    from orp_client import ORPClient

    async def main():
        client = ORPClient(signaling_url="ws://192.168.1.5:3001/signaling", pin="1234")
        await client.connect()
        await client.send_gamepad(axes=[0,0,0,0], buttons=[False]*17)
        await client.disconnect()

    asyncio.run(main())
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import time
import uuid
import base64
import logging
from dataclasses import dataclass, field
from typing import Callable, Optional

try:
    import websockets
except ImportError:
    raise ImportError("orp_client requires 'websockets'. Install with: pip install websockets")

try:
    from aiortc import RTCPeerConnection, RTCSessionDescription, RTCIceCandidate
    from aiortc.contrib.signaling import object_from_string
    HAS_AIORTC = True
except ImportError:
    HAS_AIORTC = False

logger = logging.getLogger("orp_client")

# ─── Constants ────────────────────────────────────────────────────────────────

ORP_VERSION = 2
ORP_STUN_SERVERS = [
    {"urls": "stun:stun.l.google.com:19302"},
    {"urls": "stun:stun.cloudflare.com:3478"},
    {"urls": "stun:stun.services.mozilla.com"},
]

# Stage budgets (ms) — mirrors ORP_SPEC.md
BUDGET_SIGNALING = 600
BUDGET_ICE       = 900
BUDGET_DATACHANNEL = 200


# ─── HMAC-SHA256 signature ────────────────────────────────────────────────────

def _compute_sig(payload: dict, pin: str) -> str:
    """Compute HMAC-SHA256 over the JSON payload (with sig='') keyed by PIN."""
    probe = {**payload, "sig": ""}
    msg = json.dumps(probe, sort_keys=True, separators=(',', ':'))
    return hmac.new(pin.encode(), msg.encode(), hashlib.sha256).hexdigest()


def _derive_session_id(pin: str) -> str:
    """Derive the signaling routing key from the PIN (mirrors ORPClient.ts)."""
    return hmac.new(b"orp-v2-room", pin.encode(), hashlib.sha256).hexdigest()[:20]


# ─── Data classes ─────────────────────────────────────────────────────────────

@dataclass
class ORPTimings:
    """Tracks per-stage connection timing for diagnostics."""
    start_ms: float = field(default_factory=lambda: time.time() * 1000)
    signaling_ms: Optional[float] = None
    ice_ms:       Optional[float] = None
    datachannel_ms: Optional[float] = None

    @property
    def total_ms(self) -> Optional[float]:
        if self.datachannel_ms is not None:
            return self.datachannel_ms - self.start_ms
        return None


# ─── ORPClient ─────────────────────────────────────────────────────────────────

class ORPClient:
    """
    ORP v2 Viewer Client.

    Connects to an ORP signaling server, completes WebRTC negotiation,
    and exposes methods for sending input payloads via the DataChannel.
    """

    def __init__(
        self,
        signaling_url: str,
        pin: str,
        display_name: str = "PythonBot",
        on_connected: Optional[Callable] = None,
        on_disconnected: Optional[Callable] = None,
    ):
        self.signaling_url = signaling_url
        self.pin = pin
        self.display_name = display_name
        self.session_id = _derive_session_id(pin)
        self.sender_id = str(uuid.uuid4())
        self.timings = ORPTimings()

        self._on_connected = on_connected
        self._on_disconnected = on_disconnected
        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._pc: Optional["RTCPeerConnection"] = None
        self._channel = None  # RTCDataChannel
        self._connected = asyncio.Event()
        self._closed = False

    # ── Public API ─────────────────────────────────────────────────────────────

    async def connect(self) -> ORPTimings:
        """
        Connect to the ORP host. Raises TimeoutError if any stage exceeds budget.
        Returns ORPTimings with per-stage durations on success.
        """
        if not HAS_AIORTC:
            raise ImportError(
                "aiortc is required for WebRTC. Install with: pip install aiortc\n"
                "Falling back to signaling-only mode is possible — see ORPSignalingClient."
            )

        try:
            await asyncio.wait_for(
                self._connect_internal(),
                timeout=(BUDGET_SIGNALING + BUDGET_ICE + BUDGET_DATACHANNEL) / 1000
            )
        except asyncio.TimeoutError:
            raise TimeoutError("ORP connection exceeded 2-second budget")

        return self.timings

    async def disconnect(self):
        """Gracefully close the DataChannel and WebSocket."""
        self._closed = True
        if self._channel:
            self._channel.close()
        if self._pc:
            await self._pc.close()
        if self._ws:
            await self._ws.close()

    async def send_gamepad(
        self,
        axes: list[float],
        buttons: list[bool | dict],
        pad_index: int = 0,
    ):
        """
        Send a W3C Standard Gamepad payload via the DataChannel.
        axes:    list of 4 floats [-1.0, 1.0]
        buttons: list of 17 dicts { pressed, value } or booleans
        """
        if not self._channel or self._channel.readyState != "open":
            raise RuntimeError("DataChannel not open. Call connect() first.")

        btn_list = []
        for b in buttons:
            if isinstance(b, bool):
                btn_list.append({"pressed": b, "value": 1.0 if b else 0.0})
            else:
                btn_list.append(b)

        payload = json.dumps({
            "type":     "gamepad",
            "viewerId": self.sender_id,
            "pad_id":   f"{self.sender_id}_{pad_index}",
            "padIndex": pad_index,
            "axes":     axes,
            "buttons":  btn_list,
        })
        self._channel.send(payload)

    async def send_kbm(self, event: str, key: str = "", dx: int = 0, dy: int = 0):
        """
        Send a keyboard/mouse event via the DataChannel.
        event: 'keydown' | 'keyup' | 'mousemove' | 'mousedown' | 'mouseup'
        key:   evdev key name (e.g. 'KEY_W', 'BTN_LEFT')
        dx/dy: relative mouse delta for mousemove
        """
        if not self._channel or self._channel.readyState != "open":
            raise RuntimeError("DataChannel not open. Call connect() first.")

        self._channel.send(json.dumps({
            "type":     "keyboard",
            "viewerId": self.sender_id,
            "event":    event,
            "key":      key,
            "dx":       dx,
            "dy":       dy,
        }))

    async def send_webhid(self, vid: int, pid: int, buffer: bytes):
        """Send a raw WebHID report."""
        if not self._channel or self._channel.readyState != "open":
            raise RuntimeError("DataChannel not open.")
        self._channel.send(json.dumps({
            "type":   "webhid",
            "vid":    vid,
            "pid":    pid,
            "buffer": base64.b64encode(buffer).decode(),
        }))

    async def wait_for_connection(self):
        """Block until the DataChannel is open (or disconnect() is called)."""
        await self._connected.wait()

    # ── Internal ───────────────────────────────────────────────────────────────

    def _sign(self, payload: dict) -> str:
        return _compute_sig(payload, self.pin)

    async def _connect_internal(self):
        """Full ORP v2 handshake."""
        logger.debug(f"[ORP] Connecting to {self.signaling_url} (session={self.session_id})")
        t0 = time.time() * 1000

        async with websockets.connect(self.signaling_url) as ws:
            self._ws = ws
            logger.debug("[ORP] WebSocket connected")

            # Send join envelope
            join_env = {
                "v":           ORP_VERSION,
                "type":        "join",
                "senderId":    self.sender_id,
                "sessionId":   self.session_id,
                "sig":         "",
                "ts":          int(time.time() * 1000),
                "displayName": self.display_name,
            }
            join_env["sig"] = self._sign(join_env)
            await ws.send(json.dumps(join_env))

            # Set up RTCPeerConnection
            self._pc = RTCPeerConnection()
            self._channel = self._pc.createDataChannel("orp-input", ordered=False, maxRetransmits=0)

            @self._channel.on("open")
            def on_channel_open():
                now = time.time() * 1000
                self.timings.datachannel_ms = now
                logger.info(f"[ORP] DataChannel open. Total: {self.timings.total_ms:.0f}ms")
                self._connected.set()
                if self._on_connected:
                    asyncio.ensure_future(self._on_connected(self))

            @self._pc.on("icecandidate")
            async def on_ice(candidate):
                if candidate is None: return
                env = {
                    "v": ORP_VERSION, "type": "ice-candidate",
                    "senderId": self.sender_id, "sessionId": self.session_id,
                    "sig": "", "ts": int(time.time() * 1000),
                    "candidate": {
                        "candidate":     candidate.candidate,
                        "sdpMid":        candidate.sdpMid,
                        "sdpMLineIndex": candidate.sdpMLineIndex,
                    }
                }
                env["sig"] = self._sign(env)
                await ws.send(json.dumps(env))

            # Signaling loop
            async for raw in ws:
                if self._closed: break
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                mtype = msg.get("type")

                if mtype == "offer":
                    now = time.time() * 1000
                    self.timings.signaling_ms = now
                    logger.debug(f"[ORP] Got offer ({now - t0:.0f}ms)")

                    await self._pc.setRemoteDescription(RTCSessionDescription(sdp=msg["sdp"], type="offer"))
                    answer = await self._pc.createAnswer()
                    await self._pc.setLocalDescription(answer)

                    ans_env = {
                        "v": ORP_VERSION, "type": "answer",
                        "senderId": self.sender_id, "sessionId": self.session_id,
                        "sdp": self._pc.localDescription.sdp,
                        "sig": "", "ts": int(time.time() * 1000),
                    }
                    ans_env["sig"] = self._sign(ans_env)
                    await ws.send(json.dumps(ans_env))

                elif mtype == "ice-candidate":
                    cand = msg.get("candidate", {})
                    if cand.get("candidate"):
                        await self._pc.addIceCandidate(RTCIceCandidate(
                            candidate=cand["candidate"],
                            sdpMid=cand.get("sdpMid"),
                            sdpMLineIndex=cand.get("sdpMLineIndex", 0),
                        ))

                elif mtype == "error":
                    logger.error(f"[ORP] Server error: {msg}")
                    break

                # Exit loop once data channel opened
                if self._connected.is_set():
                    break


# ─── ORPSignalingClient (no aiortc dependency) ─────────────────────────────────

class ORPSignalingClient:
    """
    Signaling-only ORP client (no WebRTC, no aiortc dependency).
    Useful for testing signaling server behaviour without full WebRTC stacks.
    """

    def __init__(self, signaling_url: str, pin: str, display_name: str = "PythonProbe"):
        self.signaling_url = signaling_url
        self.pin = pin
        self.session_id = _derive_session_id(pin)
        self.sender_id = str(uuid.uuid4())
        self.display_name = display_name

    async def probe(self) -> dict:
        """
        Open a WebSocket, send a join envelope, and return the first response.
        Returns the raw JSON dict from the server.
        """
        async with websockets.connect(self.signaling_url) as ws:
            env = {
                "v": ORP_VERSION, "type": "join",
                "senderId": self.sender_id, "sessionId": self.session_id,
                "sig": "", "ts": int(time.time() * 1000),
                "displayName": self.display_name,
            }
            env["sig"] = _compute_sig(env, self.pin)
            await ws.send(json.dumps(env))
            resp = await asyncio.wait_for(ws.recv(), timeout=2.0)
            return json.loads(resp)


# ─── CLI usage ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    import argparse

    parser = argparse.ArgumentParser(description="ORP Python Client CLI")
    parser.add_argument("--host", default="localhost:3001", help="Signaling host:port")
    parser.add_argument("--pin",  default="0000", help="Session PIN")
    parser.add_argument("--mode", choices=["probe", "bot"], default="probe",
                        help="probe=signaling test; bot=send gamepad inputs in a loop")
    args = parser.parse_args()

    url = f"ws://{args.host}/signaling"

    async def run():
        if args.mode == "probe":
            client = ORPSignalingClient(url, args.pin)
            print(f"[ORP] Probing {url} with PIN={args.pin} session={client.session_id}")
            try:
                resp = await client.probe()
                print(f"[ORP] Server response: {json.dumps(resp, indent=2)}")
            except Exception as e:
                print(f"[ORP] Error: {e}")
        elif args.mode == "bot":
            print("[ORP] Bot mode requires aiortc. Starting connection...")
            client = ORPClient(url, args.pin, display_name="PythonBot")
            try:
                timings = await client.connect()
                print(f"[ORP] Connected! Total: {timings.total_ms:.0f}ms")
                print("[ORP] Sending neutral gamepad state for 5 seconds...")
                for _ in range(50):
                    await client.send_gamepad(axes=[0,0,0,0], buttons=[False]*17)
                    await asyncio.sleep(0.1)
            finally:
                await client.disconnect()
                print("[ORP] Disconnected.")

    asyncio.run(run())
