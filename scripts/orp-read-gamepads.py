#!/usr/bin/env python3
"""
OpenRemotePlay (ORP) - Bare Hardware Input Bot
Reads a physical gamepad connected to this computer and forwards it 
over the OpenRemotePlay protocol to a host.

Dependencies:
    pip install websockets pygame

Run:
    python3 orp-read-gamepads.py --host ws://127.0.0.1:3000
"""

import asyncio
import json
import hashlib
import random
import argparse
import sys
import os

try:
    import websockets
    import pygame
except ImportError:
    print("Error: Required libraries not found.")
    print("Run: pip install websockets pygame")
    sys.exit(1)

# Supress pygame welcome message
os.environ['PYGAME_HIDE_SUPPORT_PROMPT'] = "hide"

MY_ID = f"orp-hwbot-{random.randint(1000, 9999)}"

async def input_loop(ws_url, joystick):
    """Reads the physical gamepad and streams the state at 60Hz"""
    async with websockets.connect(ws_url) as ws:
        print(f"[ORP Input] Connected. Streaming inputs from: {joystick.get_name()}")
        try:
            while True:
                pygame.event.pump()
                
                # Standard W3C Gamepad mapping approximation (Xbox/PS)
                # Map axes
                axes = [
                    joystick.get_axis(0) if joystick.get_numaxes() > 0 else 0.0, # LX
                    joystick.get_axis(1) if joystick.get_numaxes() > 1 else 0.0, # LY
                    joystick.get_axis(2) if joystick.get_numaxes() > 2 else 0.0, # RX
                    joystick.get_axis(3) if joystick.get_numaxes() > 3 else 0.0, # RY
                ]
                
                # Map buttons
                buttons = []
                for i in range(min(17, joystick.get_numbuttons())):
                    btn_pressed = joystick.get_button(i)
                    buttons.append({
                        "pressed": btn_pressed,
                        "value": 1.0 if btn_pressed else 0.0
                    })
                    
                # Pad to 17 standard W3C buttons if hardware has fewer
                while len(buttons) < 17:
                    buttons.append({"pressed": False, "value": 0.0})

                payload = {
                    "type": "gamepad",
                    "viewerId": MY_ID,
                    "pad_id": f"{MY_ID}_0",
                    "padIndex": 0,
                    "axes": axes,
                    "buttons": buttons
                }
                
                await ws.send(json.dumps(payload))
                await asyncio.sleep(1 / 60.0)
                
        except Exception as e:
            print(f"[ORP Input] Connection lost: {e}")

async def main():
    parser = argparse.ArgumentParser(description="ORP Hardware Input Forwarder")
    parser.add_argument("--host", default="ws://127.0.0.1:3000", help="ORP Host WS URL")
    args = parser.parse_args()

    pygame.init()
    pygame.joystick.init()
    
    if pygame.joystick.get_count() == 0:
        print("No physical gamepads detected! Please plug one in.")
        sys.exit(1)
        
    joystick = pygame.joystick.Joystick(0)
    joystick.init()
    
    print(f"[ORP Client] Hardware Bot ID: {MY_ID}")
    
    signaling_url = f"{args.host}/ws/viewer"
    
    try:
        async with websockets.connect(signaling_url) as ws:
            print("[ORP Signaling] Connected to host.")
            
            join_msg = {
                "type": "join",
                "viewerId": MY_ID,
                "name": "ORP Hardware Bot",
                "clientVersion": "1.0.0",
                "platform": "python"
            }
            await ws.send(json.dumps(join_msg))
            
            async for message in ws:
                data = json.loads(message)
                
                if data.get("type") == "auth-challenge":
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
                    print("[ORP Signaling] Authenticated successfully.")
                    
                    await ws.send(json.dumps({
                        "type": "gpid",
                        "padIndex": 0,
                        "id": joystick.get_name(),
                        "name": joystick.get_name()
                    }))
                    
                    input_url = f"{args.host}/ws/input?viewerId={MY_ID}&token={session_token}"
                    asyncio.create_task(input_loop(input_url, joystick))

    except Exception as e:
        print(f"[ORP Signaling] Error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
