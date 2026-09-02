# OpenRemotePlay Python SDK

Asyncio-based ORP v2 client for headless automation, AI bots, and server-side testing.

## Installation

```bash
pip install websockets aiortc
```

`aiortc` is optional — the `ORPSignalingClient` works with only `websockets` installed.

## Quickstart

### Signaling Probe (no WebRTC)
```python
import asyncio
from orp_client import ORPSignalingClient

async def main():
    client = ORPSignalingClient("ws://192.168.1.5:3001/signaling", pin="1234")
    resp = await client.probe()
    print(resp)  # e.g. { "type": "error", "code": "SESSION_NOT_FOUND" }

asyncio.run(main())
```

### Full Viewer Connection (requires aiortc)
```python
import asyncio
from orp_client import ORPClient

async def main():
    client = ORPClient(
        signaling_url="ws://192.168.1.5:3001/signaling",
        pin="1234",
        display_name="MyBot",
    )
    timings = await client.connect()
    print(f"Connected in {timings.total_ms:.0f}ms")

    # Send gamepad inputs
    await client.send_gamepad(
        axes=[0.0, 0.0, 0.0, 0.0],   # [LX, LY, RX, RY]
        buttons=[False] * 17,          # W3C 17-button layout
    )

    # Send keyboard input
    await client.send_kbm("keydown", key="KEY_W")
    await asyncio.sleep(0.5)
    await client.send_kbm("keyup", key="KEY_W")

    await client.disconnect()

asyncio.run(main())
```

## CLI

```bash
# Probe signaling server (no aiortc needed)
python orp_client.py --host 192.168.1.5:3001 --pin 1234 --mode probe

# Run as a gamepad bot (sends neutral state for 5s)
python orp_client.py --host 192.168.1.5:3001 --pin 1234 --mode bot
```

## API Reference

### `ORPClient(signaling_url, pin, display_name, on_connected, on_disconnected)`
Full WebRTC viewer. Requires `aiortc`.

| Method | Description |
|---|---|
| `await connect()` | Complete ORP handshake. Returns `ORPTimings`. |
| `await disconnect()` | Gracefully close. |
| `await send_gamepad(axes, buttons, pad_index)` | W3C gamepad payload. |
| `await send_kbm(event, key, dx, dy)` | Keyboard/mouse payload. |
| `await send_webhid(vid, pid, buffer)` | Raw HID report. |
| `await wait_for_connection()` | Block until DataChannel open. |

### `ORPSignalingClient(signaling_url, pin, display_name)`
Signaling-only. No WebRTC, no `aiortc` dependency.

| Method | Description |
|---|---|
| `await probe()` | Send join and return first server response. |

### `ORPTimings`
| Field | Type | Description |
|---|---|---|
| `signaling_ms` | float | Timestamp when offer was received |
| `ice_ms` | float | Timestamp when ICE completed |
| `datachannel_ms` | float | Timestamp when DataChannel opened |
| `total_ms` | float | `datachannel_ms - start_ms` |

## Security Notes

- The `pin` is never sent over the network. The HMAC-SHA256 signature is computed locally.
- `session_id` is derived as `HMAC-SHA256("orp-v2-room", pin)[0:20]`.
- The signaling server sees only the routing key, not the PIN.
