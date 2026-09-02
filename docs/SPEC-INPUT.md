# ORP SPEC-INPUT — Input Payload Specification v1.0

> **Status:** Published  
> **Protocol Version:** ORP v1 / v2 compatible  
> **License:** MIT

---

## 1. Overview

ORP input payloads are JSON objects transmitted over the **fast-lane WebRTC DataChannel** (`orp-input`) configured as:

```js
pc.createDataChannel('orp-input', { ordered: false, maxRetransmits: 0 })
```

This gives UDP-like semantics: fire-and-forget, no head-of-line blocking, no retransmission. Individual lost frames are acceptable because the next frame will contain the correct state.

---

## 2. Common Fields

All input payloads share the `type` discriminator and `viewerId`:

```json
{ "type": "<gamepad|webhid|keyboard>", "viewerId": "<ephemeral-uuid>", ... }
```

Hosts MUST validate:
1. `viewerId` matches a known, authenticated viewer.
2. All numeric values are within their documented ranges.
3. Payloads that fail validation are **silently dropped** (not rejected with an error).

---

## 3. Standard Gamepad (W3C API)

Maps directly to the [W3C Gamepad API](https://w3c.github.io/gamepad/) layout.

```json
{
  "type":      "gamepad",
  "viewerId":  "uuid-string",
  "pad_id":    "uuid-string_0",
  "padIndex":  0,
  "axes":      [0.0, 0.0, 0.0, 0.0],
  "buttons": [
    { "pressed": false, "value": 0.0 },
    { "pressed": true,  "value": 1.0 }
  ]
}
```

| Field | Type | Range | Description |
|---|---|---|---|
| `pad_id` | string | — | `viewerId + "_" + padIndex`. Unique per controller slot per viewer. |
| `padIndex` | int | 0–3 | Slot index (max 4 simultaneous controllers per viewer) |
| `axes` | float[4] | -1.0 – 1.0 | [LeftX, LeftY, RightX, RightY] |
| `buttons` | array[17] | 0.0 – 1.0 | Standard W3C 17-button layout (see §3.1) |

### 3.1 Button Index Map

| Index | W3C Name | Xbox | PS |
|---|---|---|---|
| 0 | Bottom face | A | Cross |
| 1 | Right face | B | Circle |
| 2 | Left face | X | Square |
| 3 | Top face | Y | Triangle |
| 4 | LB | LB | L1 |
| 5 | RB | RB | R1 |
| 6 | LT | LT | L2 |
| 7 | RT | RT | R2 |
| 8 | Back/Select | Back | Share |
| 9 | Start | Start | Options |
| 10 | LS | LS | L3 |
| 11 | RS | RS | R3 |
| 12 | D-Up | D-Up | D-Up |
| 13 | D-Down | D-Down | D-Down |
| 14 | D-Left | D-Left | D-Left |
| 15 | D-Right | D-Right | D-Right |
| 16 | Guide | Xbox | PS |

### 3.2 Reliability & Stuck Input Prevention

- Inputs are **fire-and-forget**. No acknowledgement is sent.
- Clients MUST send a zeroed state (all axes `0.0`, all buttons `{ pressed: false, value: 0.0 }`) **immediately** when a controller is physically disconnected or the viewer tab is closed.
- Hosts MUST also flush neutral state when a viewer's DataChannel closes.
- Optional `seq` field (monotonically increasing integer) may be attached for **Historical Redundancy** — see ORP-INPUT-RESILIENCY draft.

---

## 4. Raw WebHID Pass-through

Used for accessing hardware features that are invisible to the W3C Gamepad API:
DualSense gyroscope, accelerometer, touchpad, pressure-sensitive triggers, haptic actuators.

```json
{
  "type":   "webhid",
  "vid":    1356,
  "pid":    3302,
  "buffer": "<base64-encoded HID report>"
}
```

| Field | Type | Description |
|---|---|---|
| `vid` | int | USB Vendor ID (decimal) |
| `pid` | int | USB Product ID (decimal) |
| `buffer` | string | Base64-encoded raw HID report, as received from `HIDDevice.transferIn()` |

Hosts receiving WebHID payloads MUST forward them verbatim to the `backend_tablets.py` / `rust_hidmaestro` sidecar, which handles device-specific protocol translation.

**Security note:** Hosts MUST validate that (vid, pid) is in their allowlist before forwarding. Arbitrary HID reports to unrecognised VID/PIDs MUST be dropped.

---

## 5. Keyboard & Mouse (KBM)

```json
{
  "type":     "keyboard",
  "viewerId": "uuid-string",
  "event":    "keydown",
  "key":      "KEY_W",
  "dx":       0,
  "dy":       0,
  "button":   0
}
```

| Field | Type | Events | Description |
|---|---|---|---|
| `event` | string | all | One of: `keydown`, `keyup`, `mousemove`, `mousedown`, `mouseup` |
| `key` | string | keydown/keyup | evdev key name (e.g. `KEY_W`, `KEY_SPACE`, `BTN_LEFT`) |
| `dx` | int | mousemove | Relative X movement in pixels (may be negative) |
| `dy` | int | mousemove | Relative Y movement in pixels (may be negative) |
| `button` | int | mousedown/mouseup | 0=left, 1=middle, 2=right |

### 5.1 Key Name Format

Key names MUST use the evdev naming convention:
- Keyboard: `KEY_<NAME>` (e.g. `KEY_W`, `KEY_ESC`, `KEY_F1`, `KEY_LEFTSHIFT`)
- Mouse buttons: `BTN_<NAME>` (e.g. `BTN_LEFT`, `BTN_RIGHT`, `BTN_MIDDLE`)

This is the same naming convention used by Linux `evdev` and the W3C Keyboard API `code` property with minor differences.

### 5.2 Key Repeat Prevention

Hosts and sidecars MUST track currently-held keys and **reject duplicate `keydown` events for already-held keys**. This prevents OS key-repeat events (fired ~30Hz when held) from flooding the input loop.

---

## 6. Eye Tracking (Draft Extension)

> **Status:** Draft — not yet required for ORP v1/v2 compliance.

```json
{
  "type":     "eyetrack",
  "viewerId": "uuid-string",
  "gaze_x":  0.5,
  "gaze_y":  0.4,
  "blink":   false
}
```

Gaze coordinates are normalised 0.0–1.0 within the streaming viewport.

---

## 7. Touch & Gyroscope (Draft Extension)

> **Status:** Draft — not yet required for ORP v1/v2 compliance.

```json
{
  "type":     "touch",
  "viewerId": "uuid-string",
  "touches": [
    { "id": 0, "x": 0.3, "y": 0.6, "force": 1.0 }
  ]
}
```

```json
{
  "type":     "gyro",
  "viewerId": "uuid-string",
  "alpha":  0.0,
  "beta":   45.0,
  "gamma": -12.0
}
```

---

## 8. WebTransport Binary Format (Performance Extension)

> **Status:** Planned for ORP v3.

For ultra-low latency (sub-5ms input), ORP v3 will define a **16-byte binary packed struct** for the common gamepad case, transmissible via WebTransport datagrams:

```
Byte  0:    magic (0x01 = gamepad state)
Bytes 1–2:  LeftX  (i16 LE, -32767–32767)
Bytes 3–4:  LeftY  (i16 LE)
Bytes 5–6:  RightX (i16 LE)
Bytes 7–8:  RightY (i16 LE)
Byte  9:    LT     (u8, 0–255)
Byte  10:   RT     (u8, 0–255)
Bytes 11–12: Buttons bitmask (u16 LE, bits 0–15 per W3C layout)
Byte  13:   Hat X  (i8, -1/0/1)
Byte  14:   Hat Y  (i8)
Byte  15:   Pad slot index (u8)
```

This 16-byte format is already implemented in the Rust UDP fast-path (`linux_uinput.rs`, `windows_vigem.rs`). The WebTransport integration is pending WebTransport API stabilisation across browsers.
