# ORP SPEC-SIGNALING — Signaling Handshake Specification v1.0

> **Status:** Published  
> **Protocol Version:** ORP v1 / v2 compatible  
> **License:** MIT

---

## 1. Overview

The OpenRemotePlay (ORP) signaling layer is the mechanism by which a **host** and one or more **viewers** negotiate a peer-to-peer WebRTC connection without a centralised media server.

Signaling is transport-agnostic: ORP defines the *message schema*, not the transport. Implementations may use:
- **WebSocket** (reference — `ws://host:3001/signaling`)
- **Nostr relays** (serverless, ORP v2+)
- **BitTorrent DHT trackers** (ORP v2+ fallback)

---

## 2. Auto-Resolution Preflight (`GET /api/orp/manifest`)

Before connecting, clients SHOULD issue an HTTP GET to discover the host's capabilities:

```
GET http://<host>:<port>/api/orp/manifest
```

**Response (200 OK, `application/json`):**
```json
{
  "protocol_version": "1.0",
  "orp_version":      2,
  "engine":           "webrtc-nearcade",
  "name":             "Player 1's Arcade",
  "features":         ["webcodecs", "gamepad", "kbm", "webhid"],
  "session_id":       "<20-char hex routing key>",
  "signaling_url":    "ws://192.168.1.5:3001/signaling"
}
```

| Field | Required | Description |
|---|---|---|
| `protocol_version` | ✓ | Semver string, current `"1.0"` |
| `orp_version` | ✓ | Integer; 1 or 2 |
| `engine` | ✓ | Identifies the underlying transport driver |
| `name` | ✓ | Human-readable session name |
| `features` | ✓ | Array of capability strings |
| `session_id` | ✓ (v2) | HMAC-derived routing key (see §4) |
| `signaling_url` | ✓ | WebSocket URL for signaling |

---

## 3. Message Schema

All signaling messages are JSON objects transmitted as text frames over WebSocket (or as Nostr event `content` fields in v2).

### 3.1 Host Announcement (Control, not ORP envelope)

Sent by the host immediately after connecting:
```json
{ "type": "host-announce", "sessionId": "<routing-key>" }
```

**Response from server:**
```json
{ "type": "session-ready", "sessionId": "<routing-key>" }
```

### 3.2 ORP v2 Signaling Envelope

All peer-to-peer messages (offer, answer, ICE) MUST use this envelope:

```json
{
  "v":        2,
  "type":     "join | offer | answer | ice-candidate | pin-fail | pin-locked",
  "senderId": "<ephemeral-uuid>",
  "sessionId":"<routing-key>",
  "sdp":      "<SDP string>",
  "candidate": { "candidate": "...", "sdpMid": "...", "sdpMLineIndex": 0 },
  "sig":      "<hex HMAC-SHA256>",
  "ts":       1234567890123,
  "topology": "mesh | star",
  "displayName": "Player 1",
  "color":    "#c084fc"
}
```

#### Mandatory fields:
- `v` — MUST be `2`. Receivers MUST reject envelopes where `v !== 2`.
- `senderId` — ephemeral UUID generated fresh each session; NOT a stable identity.
- `sig` — HMAC-SHA256 over all other fields with `sig=''` placeholder, keyed by the session PIN.
- `ts` — Unix milliseconds; used for hole-punch timing coordination.

#### Conditional fields:
- `sdp` — present for `offer` and `answer` types only.
- `candidate` — present for `ice-candidate` type only.
- `topology` — present in `offer` from host; `mesh` means host connects to each viewer independently.

---

## 4. Session Routing ID Derivation

The `sessionId` used for routing MUST NOT expose the raw PIN. It is derived as:

```
sessionId = hex(HMAC-SHA256("orp-v2-room", pin))[0:20]
```

Both host and viewer independently compute this. The signaling server uses it only for routing — it never sees the PIN.

---

## 5. Handshake State Machine

```
Viewer                    Signaling Server              Host
  |                            |                          |
  |-- WebSocket connect ------->|                          |
  |                            |<-- WebSocket connect ----|
  |                            |<-- host-announce --------|
  |                            |--- session-ready -------->|
  |-- join (v2 envelope) ------>|                          |
  |                            |--- join (forwarded) ------>|
  |                            |<-- offer (v2 envelope) ---|
  |<-- offer (forwarded) ------|                          |
  |-- answer (v2 envelope) ---->|                          |
  |                            |--- answer (forwarded) --->|
  |<-> ICE candidates (trickle, both directions) -------->|
  |                       [WebRTC Connected]               |
```

**Trickle ICE is mandatory (ORP v2).** Candidates MUST be sent immediately as gathered, not held until `onicecandidate` fires `null`.

---

## 6. Time Budget (ORP v2)

| Stage | Budget | Failure Code |
|---|---|---|
| S1 — Signaling handshake | 600 ms | `signaling-timeout` |
| S2 — ICE connectivity | 900 ms | `ice-timeout` |
| S3 — DataChannel open | 200 ms | `data-channel-failed` |
| S4 — First video frame | 300 ms (soft) | outcome `degraded` |
| **Total** | **2000 ms** | |

Implementations MUST enforce per-stage timeouts independently (not a single 2s overall timer) to enable precise failure diagnosis.

---

## 7. Security

See `ORP_TRUST_MODEL.md` for the full security model. Summary:

- The session PIN is the **sole authentication gate**. Viewers who cannot produce a valid HMAC-SHA256 signature are silently ignored.
- Hosts MUST enforce rate limiting: maximum 5 PIN attempts per 5-minute rolling window per `senderId`.
- After lockout, the host stops responding — no rejection message — so the attacker cannot distinguish "wrong PIN" from "host offline".
- `senderId` is ephemeral and provides no long-term identity guarantee.

---

## 8. URI Scheme

ORP hosts are addressable via:

- `web+orp://<host>:<port>` — for web browser links (requires `navigator.registerProtocolHandler`)
- `orp://<host>:<port>` — for native desktop app registration

Web clients MUST register:
```js
navigator.registerProtocolHandler(
  'web+orp',
  'https://your-orp-client.example.com/?target=%s',
  'OpenRemotePlay'
);
```

Shared links SHOULD use `web+orp://` so they are interceptable in browsers.
