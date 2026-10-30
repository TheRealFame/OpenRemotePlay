#!/usr/bin/env python3
"""
ORP Headless Python Client Example
Demonstrates how to connect an automated bot or script to an ORP signaling session
and dispatch standard W3C 17-button / 4-axis gamepad telemetry.

Usage:
  python3 headless_client.py [session_id] [signaling_url]
"""

import sys
import json
import time
import uuid

try:
    import websocket
except ImportError:
    print("Error: 'websocket-client' package is required. Install via: pip install websocket-client")
    sys.exit(1)

SIGNALING_URL = sys.argv[2] if len(sys.argv) > 2 else "ws://localhost:3001/signaling"
SESSION_ID = sys.argv[1] if len(sys.argv) > 1 else "demo-session"
VIEWER_ID = f"py_bot_{uuid.uuid4().hex[:8]}"

print(f"[ORP Bot] Connecting as {VIEWER_ID} to session '{SESSION_ID}' at {SIGNALING_URL}...")

def on_open(ws):
    print("[ORP Bot] Connected to signaling server. Emitting join envelope...")
    join_payload = {
        "v": 2,
        "type": "join",
        "senderId": VIEWER_ID,
        "sessionId": SESSION_ID,
        "sig": "0" * 64,
        "ts": int(time.time() * 1000),
        "displayName": "Python Test Bot",
        "topology": "mesh"
    }
    ws.send(json.dumps(join_payload))

def on_message(ws, message):
    try:
        data = json.loads(message)
        msg_type = data.get("type")
        print(f"[ORP Bot] Received signaling message: {msg_type}")
    except Exception as e:
        print(f"[ORP Bot] Error parsing message: {e}")

def on_error(ws, error):
    print(f"[ORP Bot] WebSocket error: {error}")

def on_close(ws, close_status_code, close_msg):
    print(f"[ORP Bot] Connection closed ({close_status_code}): {close_msg}")

if __name__ == "__main__":
    ws = websocket.WebSocketApp(
        SIGNALING_URL,
        on_open=on_open,
        on_message=on_message,
        on_error=on_error,
        on_close=on_close
    )
    ws.run_forever()
