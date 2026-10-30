# ORP SPEC-MODALITIES — Modality Decoupling & Tolerant Reader Standard

> **Status:** Standard  
> **Protocol Version:** ORP v2  
> **License:** MIT

---

## 1. Overview

A critical requirement for cross-platform adoption is that **ORP does not enforce what is not strictly necessary**. 

Not every client has a display or video decoder (e.g. a phone or tablet used purely as a wireless touch controller), not every client has a gamepad (e.g. a spectator watching a couch co-op match), and not every host supports hardware haptics or gyro aiming.

This specification formalizes **Modality Decoupling** and the **Tolerant Reader Standard** to ensure seamless interoperability across diverse device form-factors.

---

## 2. Modality Declarations

Peers declare their active modalities during preflight discovery and signaling:

| Modality | Description | Associated Channels |
|---|---|---|
| `input` | Gamepad, keyboard, mouse, or touch input telemetry | DataChannel `orp-input` |
| `video` | Video stream delivery | DataChannel `orp-video` or WebRTC video track |
| `audio` | Game audio and voice communication | WebRTC audio track |

### 2.1 Standard Session Profiles

1. **Full Interactive (Couch Co-op):** `modalities: ["input", "video", "audio"]`  
   Standard remote play session with full AV streaming and remote gamepad control.
2. **Controller-Only (Virtual Gamepad):** `modalities: ["input"]`  
   The client acts purely as a remote input device (e.g., smartphone touch controller, retro arcade stick, macro runner). The host **MUST NOT** require video decoding or expect the client to open `orp-video`.
3. **Spectator Mode (Watch-Only):** `modalities: ["video", "audio"]`  
   The client is purely viewing the stream. The host **MUST NOT** disconnect the viewer if zero input packets are received.
4. **Audio Stream / Voice-Only:** `modalities: ["audio"]`  
   Stream for low-bandwidth listening or voice channels.

---

## 3. The Tolerant Reader Principle

To guarantee resilience against version skew and partial client capabilities, all ORP implementations MUST adhere to Postel's Law:

> *"Be conservative in what you send, and liberal in what you accept."*

### 3.1 Neutral Fallback Defaults
When incoming packets omit optional or non-universal fields, implementations MUST automatically apply neutral defaults rather than throwing an error:

| Payload | Missing Element | Applied Neutral Default |
|---|---|---|
| `gamepad` | Omitted buttons (<17) | `{ pressed: false, value: 0.0 }` |
| `gamepad` | Omitted axes (<4) | `0.0` |
| `rumble` | Host sends rumble to non-haptic client | Silently discarded by client |
| `motion` | Client sends gyro to non-motion host | Silently discarded by host |
| `keyboard` | Omitted `code` or `repeat` flag | `repeat: false`, raw key mapped |

### 3.2 Extraneous & Vendor Fields
Implementations MUST allow extraneous fields in JSON payloads (`additionalProperties: true`). If a vendor client includes debugging metadata (e.g. `client_battery: 85`), hosts MUST silently accept the packet without rejecting the schema.

---

## 4. Negotiation Flow

1. **Host Advertisement:** The host publishes its supported modalities in the discovery manifest:
   ```json
   {
     "modalities": ["input", "video", "audio"]
   }
   ```
2. **Viewer Declaration:** The viewer declares its desired modalities in the `join` envelope:
   ```json
   {
     "v": 2,
     "type": "join",
     "senderId": "phone-gamepad-1",
     "sessionId": "room-4281",
     "modalities": ["input"]
   }
   ```
3. **Graceful Adaptation:** Because the viewer only requested `["input"]`, the host skips video track generation and DataChannel `orp-video` for this peer, saving CPU, encoder slots, and network bandwidth.
