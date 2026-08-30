#!/usr/bin/env python3
"""
OpenRemotePlay (ORP) - Python Reference Client
Provides a headless automation bot for ORP hosts (e.g. Nearcade).

Dependencies:
    pip install websockets
    
Run:
    python3 orp-python-bot.py
"""

import asyncio
import json
import hashlib
import random
import math
import time

try:
    import websockets
except ImportError:
    print("Error: The 'websockets' library is required.")
    print("Run: pip install websockets")
    exit(1)

ORP_HOST = "ws://127.0.0.1:3000"
MY_ID = f"orp-pybot-{random.randint(1000, 9999)}"

async def input_loop(ws_url):
    """Streams dummy gamepad inputs at 60Hz over the fast-lane input socket."""
    async with websockets.connect(ws_url) as ws:
        print("[ORP Input] Connected. Streaming 60Hz inputs...")
        tick = 0.0
        try:
            while True:
                tick += 0.05
                
                # Orbit the stick and pulse button 0 (A)
                left_x = math.sin(tick)
                left_y = math.cos(tick)
                btn_a_pressed = math.sin(tick * 5) > 0

                buttons = []
                for i in range(17):
                    if i == 0:
                        buttons.append({"pressed": btn_a_pressed, "value": 1.0 if btn_a_pressed else 0.0})
                    else:
                        buttons.append({"pressed": False, "value": 0.0})
                
                payload = {
                    "type": "gamepad",
                    "viewerId": MY_ID,
                    "pad_id": f"{MY_ID}_0",
                    "padIndex": 0,
                    "axes": [left_x, left_y, 0.0, 0.0],
                    "buttons": buttons
                }
                
                await ws.send(json.dumps(payload))
                await asyncio.sleep(1 / 60.0)
        except Exception as e:
            print(f"[ORP Input] Disconnected: {e}")

async def main():
    print(f"[ORP Client] Starting Python bot ID: {MY_ID}")
    
    signaling_url = f"{ORP_HOST}/ws/viewer"
    
    try:
        async with websockets.connect(signaling_url) as ws:
            print("[ORP Signaling] Connected.")
            
            # 1. Join Request
            join_msg = {
                "type": "join",
                "viewerId": MY_ID,
                "name": "Python ORP Bot",
                "clientVersion": "3.0.6",
                "platform": "python"
            }
            await ws.send(json.dumps(join_msg))
            
            # 2. Wait for challenge & auth
            async for message in ws:
                data = json.loads(message)
                
                if data.get("type") == "auth-challenge":
                    print("[ORP Signaling] Received challenge. Authenticating...")
                    nonce = data.get("nonce", "")
                    challenge = f"{nonce}nearcade_client_v3".encode('utf-8')
                    hash_val = hashlib.sha256(challenge).hexdigest()
                    
                    auth_resp = {
                        "type": "auth-response",
                        "hash": hash_val,
                        "human": False
                    }
                    await ws.send(json.dumps(auth_resp))
                    
                elif data.get("type") == "your-id":
                    session_token = data.get("inputToken")
                    print(f"[ORP Signaling] Authenticated! Session Token: {session_token}")
                    
                    # Announce virtual hardware capability
                    await ws.send(json.dumps({
                        "type": "gpid",
                        "padIndex": 0,
                        "id": "Python Virtual Pad",
                        "name": "Python Virtual Pad"
                    }))
                    
                    # Branch off to input loop (fire and forget)
                    input_url = f"{ORP_HOST}/ws/input?viewerId={MY_ID}&token={session_token}"
                    asyncio.create_task(input_loop(input_url))

    except Exception as e:
        print(f"[ORP Signaling] Error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
