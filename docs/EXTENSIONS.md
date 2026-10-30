# ORP Protocol Extension & Capability Specification

> **Status:** Standard  
> **Protocol Version:** ORP v2  
> **License:** MIT

---

## 1. Overview

Open Remote Play (ORP) is designed to be universally extensible without central gatekeeping or breaking backwards compatibility. Independent developers can propose, implement, and negotiate custom capabilities (e.g., haptic feedback, 6-DOF motion, pressure-sensitive triggers, eye-tracking) between any client and host.

This document defines the formal rules for capability namespacing, handshake negotiation, and message dispatching.

---

## 2. Capability Namespacing

Every feature supported by an ORP implementation is represented as a namespaced capability string:

| Prefix | Scope | Rules | Examples |
|---|---|---|---|
| `core:*` | Baseline Protocol | Mandatory for standard compliance. Defined by the core ORP specification. | `core:gamepad`, `core:webrtc`, `core:kbm` |
| `ext:*` | Standard Extensions | Standardized via accepted ORP RFCs. Optional for implementations. | `ext:rumble`, `ext:motion`, `ext:webcodecs`, `ext:webhid` |
| `x-*` | Experimental / Vendor | Custom or vendor-specific features not yet standardized. | `x-custom-voice`, `x-vendor-telemetry` |

---

## 3. Capability Discovery & Handshake

### 3.1 Preflight Discovery (`/api/orp/manifest`)
During auto-resolution preflight, the host publishes its supported capabilities in the `features` array:

```json
{
  "protocol_version": "1.0.0",
  "orp_version": 2,
  "engine": "webrtc-nearcade",
  "features": [
    "core:webrtc",
    "core:gamepad",
    "core:kbm",
    "ext:webcodecs",
    "ext:rumble",
    "ext:motion"
  ]
}
```

### 3.2 Signaling Negotiation
When a viewer connects, it declares its own supported features in the `join` envelope (optional `features` array):

```json
{
  "v": 2,
  "type": "join",
  "senderId": "viewer-uuid",
  "sessionId": "host-session-key",
  "features": [
    "core:gamepad",
    "ext:rumble"
  ]
}
```

The active feature set for the session is the **intersection** of capabilities supported by both host and viewer:

$$\text{Session Features} = \text{Host Features} \cap \text{Viewer Features}$$

---

## 4. Message Dispatching & Fault Tolerance Rules

All ORP implementations MUST strictly enforce the following rules when processing incoming DataChannel and signaling messages:

1. **Silent Discard of Unknown Extensions:** If a peer receives a payload with an unknown `type` or an unrecognized `ext:*` feature, it MUST silently drop the message. It MUST NOT disconnect, crash, or throw an unhandled exception.
2. **Strict Core Validation:** Messages belonging to `core:*` (e.g. `type: "gamepad"`) MUST be strictly validated against their schema. Malformed core messages are silently dropped.
3. **No Unilateral Feature Assertion:** A client MUST NOT send extension packets (e.g. `type: "motion"`) unless the host explicitly advertised support for `ext:motion` in its preflight manifest or handshake.
4. **Graceful Degradation:** If a viewer supports an extension that the host lacks (e.g. `ext:rumble`), the stream and standard gamepad controls MUST continue to operate normally without haptics.

---

## 5. Standard Extensions Catalog

### 5.1 `ext:rumble` (Haptic Rumble)
- **Description:** Allows the host to send dual-motor vibration triggers to client controllers.
- **Direction:** Host $\to$ Viewer over `orp-input` DataChannel.
- **Schema:** [`spec/schemas/input-rumble.schema.json`](../spec/schemas/input-rumble.schema.json)
- **Payload:**
  ```json
  {
    "type": "rumble",
    "padIndex": 0,
    "weakMagnitude": 0.6,
    "strongMagnitude": 0.9,
    "duration": 250
  }
  ```

### 5.2 `ext:motion` (6-DOF Motion / Gyro)
- **Description:** Sends raw gyroscope and accelerometer telemetry for tilt steering and gyro aiming.
- **Direction:** Viewer $\to$ Host over `orp-input` DataChannel.
- **Schema:** [`spec/schemas/input-motion.schema.json`](../spec/schemas/input-motion.schema.json)
- **Payload:**
  ```json
  {
    "type": "motion",
    "viewerId": "usr-uuid",
    "padIndex": 0,
    "gyro": { "x": 0.05, "y": -0.12, "z": 0.0 },
    "accel": { "x": 0.0, "y": 9.81, "z": 0.2 },
    "timestamp": 1729000000045
  }
  ```

### 5.3 `ext:webcodecs` (Single-Encode Multiplexed Video)
- **Description:** Ingests raw encoded H.264/VP9/AV1 chunks over DataChannel `orp-video` rather than native WebRTC media tracks, allowing a host to broadcast to many viewers with a single hardware encode pass.
- **Direction:** Host $\to$ Viewers over `orp-video` DataChannel.
- **Specification:** [`docs/SPEC-MEDIA.md`](SPEC-MEDIA.md)

### 5.4 `ext:webhid` (Raw Hardware Pass-through)
- **Description:** Bypasses browser Gamepad API limitations to forward raw USB/Bluetooth HID reports for advanced hardware (DualSense triggers, flight sticks, racing wheels).
- **Direction:** Viewer $\to$ Host over `orp-input` DataChannel.
- **Schema:** [`spec/schemas/input-webhid.schema.json`](../spec/schemas/input-webhid.schema.json)

### 5.5 `ext:renegotiate` (Dynamic In-Session Reconfiguration)
- **Description:** Dynamically attaches/detaches controllers or changes stream resolutions mid-session without reconnecting WebRTC.
- **Direction:** Bidirectional over `orp-input` DataChannel.
- **Schema:** [`spec/schemas/renegotiation.schema.json`](../spec/schemas/renegotiation.schema.json)
