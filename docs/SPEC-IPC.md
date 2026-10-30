# ORP SPEC-IPC — Sidecar Daemon Protocol (Binary-as-an-SDK)

> **Status:** Standard  
> **Protocol Version:** ORP v2  
> **License:** MIT

---

## 1. Overview

Many game developers and application authors (e.g. Godot GDScript, Unity C#, Unreal C++, GameMaker, Flutter, Python, Go) do not want to integrate complex WebRTC dependencies, C++ build chains, or signaling stacks directly into their projects.

To make adoption effortless, ORP specifies the **Binary-as-an-SDK** architecture:
- Implementations provide a standalone native executable: `orp-daemon`.
- The host application or game engine launches `orp-daemon` as a child process.
- The application communicates with `orp-daemon` over **Standard Input / Standard Output (stdin/stdout) using newline-delimited JSON (JSON-Lines / NDJSON)** or via a local loopback WebSocket (`127.0.0.1:PORT`).
- **Zero-Touch Upgrades:** When ORP updates (new ICE hole-punching optimizations, relay fixes, or protocol features), developers simply replace the `orp-daemon` binary without changing or recompiling their game code.

---

## 2. Architecture

```
┌────────────────────────────────────────────────────────┐
│     Game Engine / Custom App (Godot, Unity, Python)    │
└───────────────────────────┬────────────────────────────┘
                            │
               Standard I/O (JSON-Lines)
               or Localhost WebSocket
                            │
┌───────────────────────────▼────────────────────────────┐
│              orp-daemon (Standalone Binary)            │
│  - WebRTC DTLS / SRTP / SCTP                           │
│  - Multi-Transport Signaling (Nostr / MQTT / Torrent)  │
│  - STUN Reflexive Discovery & Hole Punching            │
│  - DataChannel Serialization / Deserialization         │
└───────────────────────────┬────────────────────────────┘
                            │
                     Public Internet
                    (WebRTC P2P Mesh)
                            │
┌───────────────────────────▼────────────────────────────┐
│                 Remote Peers / Viewers                 │
└────────────────────────────────────────────────────────┘
```

---

## 3. Wire Protocol: JSON-Lines over stdio

Every message sent to `stdin` or emitted from `stdout` MUST be a single, valid JSON object terminated by a newline (`\n`):

```text
{"type":"cmd:start_host","roomCode":"my-room"}\n
{"type":"evt:ready","roomCode":"my-room","sessionId":"sess-123"}\n
```

### 3.1 Commands (App $\to$ Daemon via `stdin`)

#### 1. `cmd:start_host`
Instructs the daemon to establish a host session.
```json
{
  "type": "cmd:start_host",
  "roomCode": "my-session-code",
  "pin": "optional-pin",
  "sessionName": "My Godot Game",
  "modalities": ["input", "video"]
}
```

#### 2. `cmd:join`
Instructs the daemon to join an existing remote session as a client.
```json
{
  "type": "cmd:join",
  "roomCode": "my-session-code",
  "displayName": "Player 1",
  "modalities": ["input"]
}
```

#### 3. `cmd:send_input`
Sends gamepad telemetry to the host (when running as client).
```json
{
  "type": "cmd:send_input",
  "padIndex": 0,
  "axes": [0.0, -1.0, 0.5, 0.0],
  "buttons": [
    { "pressed": true, "value": 1.0 },
    { "pressed": false, "value": 0.0 }
  ]
}
```

#### 4. `cmd:send_rumble`
Dispatches haptic rumble to a connected viewer (when running as host).
```json
{
  "type": "cmd:send_rumble",
  "peerId": "viewer-uuid",
  "padIndex": 0,
  "weakMagnitude": 0.7,
  "strongMagnitude": 0.9,
  "duration": 250
}
```

#### 5. `cmd:stop`
Gracefully tears down active connections and terminates.
```json
{
  "type": "cmd:stop"
}
```

---

### 3.2 Events (Daemon $\to$ App via `stdout`)

#### 1. `evt:ready`
Emitted when the session is registered on the signaling network and ready for peers.
```json
{
  "type": "evt:ready",
  "role": "host",
  "roomCode": "my-session-code",
  "sessionId": "sess-123"
}
```

#### 2. `evt:peer_joined`
Emitted when a remote viewer or host successfully establishes a WebRTC connection.
```json
{
  "type": "evt:peer_joined",
  "peerId": "viewer-9a4f",
  "displayName": "Player 2",
  "modalities": ["input"]
}
```

#### 3. `evt:peer_left`
Emitted when a peer disconnects.
```json
{
  "type": "evt:peer_left",
  "peerId": "viewer-9a4f"
}
```

#### 4. `evt:input_received`
Emitted to the host application when a remote viewer presses a button or moves an axis.
```json
{
  "type": "evt:input_received",
  "peerId": "viewer-9a4f",
  "padIndex": 0,
  "axes": [0.0, 0.0, 0.0, 0.0],
  "buttons": [
    { "pressed": false, "value": 0.0 }
  ],
  "seq": 105
}
```

#### 5. `evt:rumble_received`
Emitted to the client application when the host triggers haptic feedback.
```json
{
  "type": "evt:rumble_received",
  "padIndex": 0,
  "weakMagnitude": 0.5,
  "strongMagnitude": 0.8,
  "duration": 200
}
```

#### 6. `evt:error`
Emitted when a network, signaling, or validation error occurs.
```json
{
  "type": "evt:error",
  "code": "ICE_FAILED",
  "message": "Direct peer-to-peer connection could not be established."
}
```
