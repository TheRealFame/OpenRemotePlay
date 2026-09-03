# Open Remote Play (ORP) Protocol Specification — v2 DRAFT

Status: **DRAFT — not yet implemented, not yet tested.** This document is the
single source of truth for ORP. The TypeScript and Rust modules are both
implementations *of this spec* — neither is the reference; this document is.
If an implementation and this spec disagree, the spec wins and the
implementation has a bug.

This draft reflects a set of design decisions made together with several
rounds of follow-up research and clarification. Anything marked
`[OPEN QUESTION]` is not yet decided and must not be implemented until
resolved.

---

## 0. Goals and non-goals

**Goals:**
- Any compliant ORP client can connect to any compliant ORP host, regardless
  of implementation language **or internal transport topology**. This
  matters concretely: a host may use real P2P mesh topology (each viewer
  connects directly to the host), or a star topology instead (the host's
  own machine relays to each guest rather than guests connecting to each
  other) — the latter is a reasonable choice for hosts that can't afford
  dedicated SFU/MFU relay infrastructure. ORP's signaling and wire format
  (§1, §1.3) must not assume mesh-only; a host declares its topology
  capability during the signaling handshake so a cross-topology connection
  negotiates correctly rather than assuming the other side's internals.
  `[OPEN QUESTION: needs a concrete wire-format field (e.g. a
  `topology: 'mesh' | 'star'` hint in the signaling envelope, §1.3) rather
  than being left implicit. Not yet designed in this draft.]`
- No VPS, no self-hosted relay, no TURN server required for the connection to
  work. Signaling uses public serverless infrastructure. Media is direct P2P.
  STUN is used for NAT reflexive-address discovery only.
- ORP's connection/signaling/trust layers are agnostic to the media
  pipeline riding on top of them — WebRTC-native tracks, WebCodecs-based
  chunked transport (Nearcade's current approach), and any future encoding
  approach are all equally valid; see §1.4.
- A fresh connection — signaling handshake through first rendered video frame
  — completes in under 2 seconds, or the attempt is declared a failure and
  retried per the retry policy in §4.
- A modified or malicious client cannot make an honest peer believe something
  false about connection or session state. See `ORP_TRUST_MODEL.md`.
- One protocol, two reference implementations (TypeScript, Rust), kept in
  sync via this spec rather than via one implementation copying the other.

**Non-goals (explicitly out of scope for v2):**
- TURN relay fallback. If P2P cannot be established after the retry policy in
  §4 is exhausted, the connection attempt fails. This is a deliberate
  trade-off: some fraction of real-world NAT configurations (notably
  symmetric NAT paired with another symmetric or address-restricted NAT, and
  some CGNAT deployments) cannot be traversed with STUN and hole punching
  alone, full stop, regardless of implementation quality. ORP does not paper
  over this with a relay. `[OPEN QUESTION: should ORP at least *detect and
  report* "this pair cannot connect P2P" distinctly from "connection timed
  out for an unknown reason," so a future TURN-fallback feature — if ever
  added — has a clean signal to hook into? Recommend yes, cost is low, see
  §4.5.]`
- Video/audio codec selection and encoding pipeline — that's Nearcade's
  WebCodecs pipeline, orthogonal to this spec. ORP defines the data channel
  and the media transport handshake, not what's inside the media.

---

## 1. Signaling layer

### 1.1 Strategy: Nostr primary, BitTorrent-tracker fallback, raced

ORP uses **Nostr relays** as the primary serverless signaling rendezvous,
with **BitTorrent WebSocket trackers** as an automatic fallback (Nostr has
substantially more relay redundancy — hundreds of active public relays
vs. a handful of BitTorrent trackers — per Trystero's own current
maintainer guidance, superseding their older "BitTorrent is fine for
production" guidance).

**Racing, not failover-after-timeout:** both strategies are started
concurrently the moment a connection attempt begins. Whichever strategy
successfully delivers a working peer connection first wins; the other is
torn down. This is a latency optimization, not just a reliability one — it
means a slow-but-eventually-successful Nostr relay doesn't block on falling
back to BitTorrent only after a fixed timeout elapses. `[OPEN QUESTION:
racing both by default costs each peer 2x the relay connections/bandwidth
for signaling. This is cheap in absolute terms (signaling messages are small
JSON blobs, not media) but worth stating as a conscious trade-off, not an
oversight.]`

### 1.2 Room/topic derivation

The "room" both peers join is derived deterministically from the session's
**pairing code**, not from a random per-run identifier — this is what lets a
host generate a code once and have any client type join it. Concretely:

```
roomId = base32(HMAC-SHA256(key = "orp-v2-room", message = pairingCode))[:20]
```

`[OPEN QUESTION: should the pairing code itself be entered by the human
(short, memorable, like Nearcade's existing 6-6 alphanumeric room codes), or
should it be embedded in a deep link / QR code and never manually typed? A
host-initiates-the-invite model suggests the host generates and shares the
code out-of-band (Discord, link, QR) — recommend the human-facing code
stays short (Nearcade's existing `[0-9a-z]{6}-[0-9a-z]{6}` format is a
reasonable precedent) but the *derivation* above ensures the actual
Nostr/BitTorrent topic string is not directly the human-readable code, so
relay operators / eavesdroppers on the relay network don't trivially see
plaintext session codes.]`

### 1.3 Signaling message envelope

All signaling messages (offer, answer, ICE candidate) are wrapped in a
common envelope before being handed to the Nostr/BitTorrent transport layer:

```typescript
interface ORPSignalEnvelope {
  v: 2;                     // protocol version, integer, always present
  type: 'offer' | 'answer' | 'ice-candidate';
  senderId: string;         // self-certifying peer id — see ORP_TRUST_MODEL.md §8.1
  sdp?: string;              // present for offer/answer
  candidate?: RTCIceCandidateInit; // present for ice-candidate
  sig: string;               // Ed25519 signature over the above fields, verifiable
                              // against the public key senderId was derived from —
                              // see ORP_TRUST_MODEL.md §8
}
```

The `sig` field is mandatory in v2 (it did not exist in the current
`ORPClient.ts`/`orp-bot.js` implementations, which is part of what this
spec fixes — see `ORP_TRUST_MODEL.md`). Note this is a genuine asymmetric
signature tied to the sender's self-certifying identity (`ORP_TRUST_MODEL.md`
§8), not an HMAC — an HMAC would require a pre-shared key between arbitrary
peers who have never met before the session, which doesn't fit ORP's
no-prior-relationship join model at all.

### 1.4 Media pipeline agnosticism

ORP's data channel and signaling layer are **agnostic to which media
pipeline produced the bytes flowing over them**. Concretely: a host using a
native WebRTC `MediaStreamTrack`/RTP pipeline and a host using a WebCodecs
pipeline (encode locally, ship raw encoded chunks over the data channel,
decode client-side via `VideoDecoder`/`AudioDecoder` — Nearcade's current
approach, per `src/docs/ADVANCED_LOGIC.md`) are both fully valid ORP hosts.
ORP does not mandate one over the other, and does not need to know which
one a given peer is using — it only needs the data channel (§2 stage 3)
open and moving bytes; what's inside those bytes and how they're
encoded/decoded is entirely the concerned client/host's business, not
the protocol's.

This extends to **future transport/codec approaches not yet in use by any
current ORP implementation**: nothing in this spec should ever need to
change to accommodate a new encoding pipeline, because the spec never
specifies pipeline internals in the first place — it specifies the
connection (§1–§4), the channel (§2 stage 3, §6.2), and the trust boundary
(`ORP_TRUST_MODEL.md`), not what rides inside the channel. A client
announcing pipeline-specific capability (e.g. "I decode via WebCodecs and
support av1" vs. "I only support a raw RTP `MediaStreamTrack`") is a
capability-negotiation concern, not a wire-format concern — capability
negotiation broadly is deferred rather than designed for v2 (see the
relevant `[OPEN QUESTION]`). Media-pipeline agnosticism does not require
solving that negotiation problem; it only requires that ORP's core
connection/channel/trust layers never assume one pipeline's existence over
another's.

### 1.5 Using ORP with a pipeline not covered above

The two pipelines named in §1.4 (WebRTC-native tracks, WebCodecs chunked
transport) are examples of what already works today, not an exhaustive or
closed list. Any implementer — building a Nearcade-compatible client,
integrating ORP into an existing remote-play project, or building
something entirely new — is free to use **any** media pipeline over ORP's
data channel without needing anyone's permission, provided it fits within
what the protocol actually requires:

1. **The connection layer (§1–§4) and trust boundary
   (`ORP_TRUST_MODEL.md`) are non-negotiable** — a compliant client must
   speak the signaling envelope (§1.3), respect the connection budget (§2),
   and honor the PIN/identity trust model. These exist independent of
   media pipeline choice and are what makes a client "ORP-compatible" in
   the first place.
2. **What flows over the data channel (§2 stage 3) once it's open is
   entirely up to the implementer.** If your pipeline can serialize
   whatever it needs to send into bytes on that channel — encoded video
   chunks, RTP packets, a custom container format, anything — it already
   works with ORP today, with no spec changes and no permission needed.
   This is the common case and covers most future pipelines by
   construction.
3. **If your pipeline genuinely needs something the current wire format
   doesn't provide** — for example, a new field in the signaling envelope
   to negotiate a pipeline-specific parameter before the connection opens,
   or a new control-message type alongside `ORPControllerEvent` (§6.2) —
   that's a real spec change, and the expected path is a **pull request
   against this specification** (or the reference implementations, if the
   gap is in how a pipeline hooks into the connection lifecycle rather
   than the wire format itself), not a private fork that silently diverges
   from what other ORP clients expect. Per §8's versioning rules, any new
   *mandatory* field or changed field meaning requires a version bump
   (`v: 3`), which is exactly the kind of change a PR and discussion should
   precede, so existing compliant clients aren't broken by a change they
   didn't see coming.
4. **If a pipeline needs to intercept or wrap the connection at a point
   this spec doesn't currently expose a hook for** (for instance, needing
   to observe or modify SDP before it's sent, or needing a callback at a
   specific stage-2/stage-3 boundary that isn't already surfaced by the
   timing instrumentation in §2.2) — that's also a legitimate PR target.
   The reference implementations (`packages/orp-client` in TypeScript, the
   planned Rust module) are the concrete place such a hook would need to
   be added, since the spec describes behavior but the implementations are
   what an actual pipeline integrates against.

In short: **most pipelines need nothing from ORP beyond "the data channel
is open" — use it freely.** Only pipelines that need the protocol itself to
do something new require a PR, and that's by design — it's what keeps
"any client can connect to any host" true as the protocol grows, rather
than letting it splinter into incompatible private extensions.

---

## 2. Connection lifecycle and the 2-second budget

The budget covers the **full pipeline**: from
the moment a client begins a connection attempt to the moment it has
decoded and rendered the first video frame from the host. Total budget:
**2000ms**. Subdivided into stages, each with its own sub-budget and
failure behavior:

| Stage | Sub-budget | What "done" means | On budget exceeded |
|---|---|---|---|
| 1. Signaling handshake | 600ms | Offer sent, answer received, both peers have each other's SDP | Abort attempt, go to §4 retry |
| 2. ICE gathering + connectivity checks | 900ms | `RTCPeerConnection.connectionState === 'connected'` | Abort attempt, go to §4 retry |
| 3. Data channel open | 200ms | `RTCDataChannel.readyState === 'open'` on the control channel | Abort attempt, go to §4 retry |
| 4. First frame decoded + rendered | 300ms | First video frame handed to the renderer and a paint has occurred | Log as a *degraded* success, not a failure — see §2.1 |

600 + 900 + 200 + 300 = 2000ms exactly. `[OPEN QUESTION: this split is a
proposed starting allocation, not measured. It needs real-world timing data
from the test plan in §5 before these numbers are trusted. ICE is given the
largest share because it's the least predictable stage — that's a reasoned
guess, not a measurement, and should be revisited after the first test round.]`

### 2.1 Why stage 4 is a soft budget, not a hard one

Unlike stages 1–3, blowing the stage-4 budget does **not** fail the
connection attempt — the peer connection is already live and working at
that point; the person is one dropped frame away from a working stream, not
disconnected. Treat it as: log a "slow first frame" telemetry event, keep
the connection, let the encoder's next keyframe render normally. Failing an
otherwise-successful P2P connection over a slow first paint would be
throwing away a working session over a cosmetic delay.

### 2.2 Timing instrumentation

Both implementations MUST emit stage-boundary timestamps so the test plan
(§5) can actually measure where time goes, not just observe pass/fail:

```typescript
interface ORPConnectionTiming {
  attemptStart: number;      // performance.now() equivalent, ms
  signalingComplete?: number;
  iceConnected?: number;
  dataChannelOpen?: number;
  firstFrameRendered?: number;
  outcome: 'success' | 'degraded' | 'failed';
  failedStage?: 1 | 2 | 3;
}
```

---

## 3. ICE / NAT traversal configuration

### 3.1 STUN only, per explicit decision

**DECIDED**: three independent operators, no signup/credentials required,
resolved via research rather than left as a guess:

```typescript
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.services.mozilla.com:3478' },
];
```

Three different organizations (Google, Cloudflare, Mozilla) means a single
operator's outage doesn't block reflexive-candidate discovery. All three are
established, free, and require no credentials — no reliance on smaller/less
vetted "free STUN list" services found via casual search, which is worth
avoiding given some of those in circulation are unmaintained or
intermittently dead.

No TURN entries. No `turnConfig`. This is intentional per §0.

### 3.2 Trickle ICE: enabled, not disabled

**This is a fix, not a preservation of current behavior.** The current
Trystero-based path in Nearcade forces `trickleIce: false`, which means the
whole SDP is held until ICE gathering completes before it's even sent to
the peer — this actively worked against the old code's own latency, and
directly costs time against our stage-2 budget above. ORP v2 sets
`trickleIce: true`: candidates are sent to the peer as they're discovered,
so connectivity checks can start before gathering finishes.

### 3.3 Forced hole-punch retry tier

If the standard ICE connectivity check phase (stage 2) fails or times out
within its sub-budget, before declaring the whole attempt failed, ORP
attempts one additional aggressive tier:

1. **Simultaneous-open burst**: both peers, coordinated via a signaling
   message exchanged in stage 1, begin sending UDP packets to each other's
   server-reflexive (STUN-discovered) address at a coordinated moment
   (synchronized via relative offset, not wall-clock timestamp — see
   §3.3.1), rather than the normal one-side-initiates ICE check pattern.
   This is standard UDP hole punching, not a new technique.
2. **Port-prediction burst** (for likely-symmetric-NAT peers only, detected
   by observing that the STUN-reflexive port differs from the local bound
   port in a patterned way across two STUN queries to different servers):
   send a small spread of packets to a few sequential/predicted ports
   around the observed reflexive port, since symmetric NATs often allocate
   sequentially. This is the "birthday paradox" style approach — trying a
   spread of guesses concurrently rather than one exact guess.

`[OPEN QUESTION: exact timing/packet-count parameters for both bursts are
not decided. This needs to be tuned against real measurement, not guessed
into the spec. Recommend the test plan's first round includes deliberately
testing behind a symmetric NAT (e.g. many mobile carrier NATs, some
consumer mesh routers) to get real pass/fail data on whether tier 2 is
worth its complexity at all, before over-investing in tuning it.]`

If both tiers fail within the stage-2 sub-budget, the attempt fails per §0's
explicit non-goal — no TURN fallback, report failure clearly (§4.5).

#### 3.3.1 Burst synchronization mechanism

Since the two peers' system clocks cannot be assumed to agree, the burst
above is synchronized via **relative offset, not absolute timestamp**: the
peer initiating hole-punch coordination sends a signaling message
containing `fireInMs: N` (e.g. `N = 300`), and each peer independently
starts a local timer for `N` milliseconds from the moment *it* received
that message, then fires its burst. This avoids needing any NTP-style clock
synchronization between peers, at the cost of some jitter equal to the
one-way signaling delivery latency difference between the two peers (which,
given §1's signaling relays, is expected to be small — tens of
milliseconds, not enough to meaningfully break the "simultaneous" property
UDP hole punching relies on). `[OPEN QUESTION: this is a reasoned design,
not yet measured against real signaling latency — confirm this holds up
during §5 testing rather than assuming it.]`

### 3.4 NAT type self-diagnosis

`[OPEN QUESTION — not yet resolved]`: should the client run a lightweight
NAT-type probe (e.g. comparing reflexive addresses returned by two
different STUN servers) on first launch / periodically, and surface "your
network type may prevent P2P connections" to the person proactively, rather
than only discovering this at connect-time? Recommend building this probe
early so it's self-diagnosing rather than requiring manual investigation,
since the test matrix in §5.1 needs real network-topology data that isn't
characterized yet.

### 3.5 Mid-session reconnection: ICE restart

**DECIDED**: ORP attempts to recover a live session across a network
change (WiFi→cellular handoff, router reboot, brief ISP interruption)
rather than requiring a fresh connect from scratch, using WebRTC's native
**ICE restart** mechanism.

**Trigger**: `RTCPeerConnection.connectionState` transitions to
`'disconnected'` (not yet `'failed'` — `'disconnected'` is the earlier,
recoverable state where connectivity checks are failing but the browser/
engine hasn't given up). ORP starts a restart timer at this point rather
than waiting for the (potentially much later, or never, on some engines)
`'failed'` transition.

**Mechanism**:
1. The side that notices the disconnection generates a new ICE
   ufrag/pwd (`RTCPeerConnection.restartIce()` in browser WebRTC; the
   equivalent explicit re-`initialize_client`-with-new-credentials call in
   `str0m` for the Rust side, since `str0m` is Sans-I/O and does not have
   an automatic restart helper — this must be driven manually in Rust).
2. A fresh offer carrying the new ICE credentials is sent through the
   **same signaling channel** used for the original handshake (§1) —
   critically, this means the Nostr/BitTorrent room must still be joined
   and listening even after the initial connection succeeded, not torn
   down once ICE first connects. `[OPEN QUESTION: this has a real resource
  cost — staying subscribed to a signaling relay for the lifetime of a
  session (which could be hours) rather than just the initial ~2s
  handshake window. Needs a decision on whether to keep a persistent
  lightweight subscription, or have the signaling layer support a fast
  "rejoin" using the same derived roomId (§1.2) if a restart is needed —
  the latter avoids the persistent-subscription cost but adds a small
  extra delay before the restart signal can be sent. Recommend fast-rejoin
  given ORP's whole design philosophy is bias toward the 2-second budget
  over persistent overhead, but flagging this as a real trade-off, not an
  obvious call.]`
3. Restart re-runs stages 2–3 of the connection budget (§2) against a
  **shorter budget** than a fresh connect, since signaling (stage 1) is
  skipped — proposed: 1200ms total for restart (900ms ICE + 200ms data
  channel re-verify + 100ms buffer), roughly matching the original stage
  2+3 budget. The already-open data channel and any application state
  (e.g. controller bindings, §6) are preserved across a successful
  restart — restart is a transport-layer recovery, not a new session.
4. If restart itself fails within its budget, *then* the session is
  declared dead and the client falls back to a full fresh connection
  attempt (§2), surfaced to the user as a visible reconnection rather than
  a silent one, since a full fresh connect re-requires the PIN handshake
  (`ORP_TRUST_MODEL.md` §2) which a background ICE restart does not.

---

## 4. Retry policy

### 4.1 What counts as a failed attempt

Any stage 1–3 budget exceeded (§2), or an explicit ICE failure state, or a
security check failure (`ORP_TRUST_MODEL.md`) is a failed attempt.

### 4.2 Retry behavior

`[OPEN QUESTION — not yet decided]`: how many automatic
retries before surfacing failure to the person, and with what backoff? A
reasonable starting proposal, pending confirmation:

- Retry immediately once (covers transient relay hiccups) — total budget for
  retry 2 is the same 2000ms, fresh attempt.
- If retry 2 also fails, surface failure to the UI rather than retrying
  silently again — repeated silent retries against a hard NAT-traversal
  wall just waste time and battery without changing the outcome.
- Distinguish in the UI between "couldn't reach signaling" (Nostr and
  BitTorrent both unreachable — rare, likely the person's own network is
  down) vs. "reached the host but P2P couldn't establish" (the real NAT
  wall case) — these need different user-facing guidance.

### 4.3 Rate limiting scope (clarifying `ORP_TRUST_MODEL.md` §3)

Per explicit confirmation: rate limiting applies specifically to **PIN
verification attempts** — repeated wrong-PIN guesses or attempts to try
different PIN combinations against a session — not to connection attempts
in general (a legitimate viewer retrying after a transient network hiccup,
§4.2, is not a PIN attempt and is not rate-limited by this mechanism).

The counter is **host-global, not per-viewer-slot**: a single host process
tracks one shared count of failed PIN verifications regardless of how many
distinct `senderId`s are attempting them, because it's the same underlying
secret (one PIN per session) being targeted — tracking separately per
claimed viewer slot would let an attacker reset their own attempt budget
simply by presenting a new `senderId` per guess. Self-certifying identity
(`ORP_TRUST_MODEL.md` §8) stops a peer from *impersonating* another's
`senderId`, but does not stop a peer from generating unlimited fresh, valid
`senderId`s of its own — that's exactly why this counter is host-global
rather than per-identity: it does not rely on `senderId` scarcity holding
up, since it doesn't hold up (see `ORP_TRUST_MODEL.md` §8.3).

### 4.4 ICE-restart failure is a distinct reason, not a fresh-connect failure

When an ICE restart (§3.5) itself fails, that is reported distinctly from
an initial-connection failure (§4.5) — the user-facing and diagnostic
meaning is different ("we had a working session and lost it" vs. "we never
connected"), even though the underlying retry mechanics converge on the
same fresh-attempt path afterward.

### 4.5 Failure taxonomy (for the `[OPEN QUESTION]` in §0)

Recommend ORP failures carry a machine-readable reason, not just
"disconnected," specifically so a future decision about adding an optional
TURN fallback (if that's ever revisited) has a clean signal instead of
requiring a rewrite:

```typescript
type ORPFailureReason =
  | 'signaling-unreachable'   // both Nostr and BitTorrent failed to connect
  | 'signaling-timeout'       // reached relay but no answer within budget
  | 'ice-failed'              // ICE connectivity checks exhausted, incl. hole-punch tier
  | 'ice-timeout'             // budget exceeded before ICE resolved either way
  | 'ice-restart-failed'      // §3.5 — had a working session, restart could not recover it
  | 'security-check-failed'   // see ORP_TRUST_MODEL.md
  | 'data-channel-failed';
```

---

## 5. Testing requirements (per "tested 2 times, reiterated to perfection")

Every major change to ORP must be tested twice before
being considered done, and iterated until it passes. This section defines
what "tested" concretely means, since "it connected once" is not a test:

### 5.1 Minimum test matrix

Each of the following network topology pairings, tested with **both**
peers on real, separate networks (not simulated/loopback — NAT behavior
does not reproduce accurately in loopback):

1. Both peers behind typical home router NAT (full-cone or
   address-restricted cone — the common case)
2. One peer behind CGNAT (common on mobile carriers) + one on typical home
   NAT
3. Both peers behind CGNAT
4. One peer on a symmetric NAT (some corporate/public WiFi, some mesh
   routers) + one on typical home NAT

`[OPEN QUESTION: which of these categories describes the network of
whoever runs the first real-world test pass — this materially affects
which scenarios are easy vs. hard to test locally, and should be recorded
once known rather than left unstated.]`

### 5.2 Pass criteria

For each topology in the matrix, across 2 independent test runs:
- Connection succeeds within the 2000ms budget in both runs, OR
- If it fails, the failure reason (§4.5) correctly identifies *why* in both
  runs (a flaky pass/fail with no clear reason is not a pass — it means the
  retry/failure logic itself is not being tested rigorously).

### 5.3 What "reiterated to perfection" concretely means here

If a topology fails the 2-run pass criteria, the fix goes back through: (a)
identify which stage (§2 table) actually blew its budget using the timing
instrumentation (§2.2) — not guessing, (b) fix that stage specifically, (c)
re-run the full 2-test pass criteria for *all* topologies in the matrix
again, not just the one that failed, since a fix to one stage can regress
another.

---

## 6. Renegotiation and session-level input management

Unlike the initial connect (§2–§4) and mid-session transport recovery
(§3.5), this section covers changes to what's flowing over an already-
established, healthy connection: media parameter changes and controller
management. **In scope for v2**, per explicit decision.

### 6.1 Media renegotiation (resolution/bitrate changes)

When the host changes output resolution, bitrate, or codec mid-session
(e.g. the person adjusts quality settings while streaming), ORP performs a
standard WebRTC renegotiation:

1. Host creates a new offer reflecting updated `RTCRtpSender` parameters
   (via `setParameters()` for bitrate, which does not require a full
   renegotiation; via a fresh offer/answer exchange for resolution/codec
   changes, which do).
2. The offer is sent over the **existing, already-open data channel** —
   not back through the signaling relay (§1) — since both peers are
   already connected and the data channel is a faster, already-authenticated
   path for this. This is a deliberate difference from §3.5's ICE restart,
   which *must* use the signaling channel because the data channel itself
   may be the thing that's broken during a restart; ordinary renegotiation
   assumes the data channel is healthy.
3. Renegotiation carries **no fixed timing budget** the way initial connect
   does (§2) — it's not latency-critical in the same way; a slightly slow
   resolution change is a minor visual hiccup, not a failed connection.
   `[OPEN QUESTION: should there be *any* soft budget here for consistency,
   or is "no budget, just don't be egregiously slow" acceptable for v2?
   Recommend the latter — keep this section simple until real usage shows
   it needs tightening.]`

### 6.2 Controller (data-channel) renegotiation

Per Nearcade's existing model: **one controller slot per session** (not
per-viewer multi-controller in v2 — matching current Nearcade behavior,
not expanding it). A controller connecting or disconnecting does not
require a full data-channel renegotiation in the WebRTC sense (the control
data channel itself stays open for the session's lifetime) — it's an
application-level message on that existing channel:

```typescript
interface ORPControllerEvent {
  v: 2;
  type: 'controller-connected' | 'controller-disconnected';
  slotId: 'primary';   // v2 has exactly one slot; field exists for
                         // forward-compatibility with a possible future
                         // multi-controller mode, not used for anything
                         // else in v2
  streamFingerprint: string;   // see §6.3
}
```

### 6.3 Duplicate-controller detection (Steam Input / virtualized-pad problem)

**The problem, concretely**: Steam Input can present a virtualized copy
of a physical controller to the OS/browser alongside the real device, with
the **same reported hardware identity** (VID:PID, and sometimes even the
same OS-level device path depending on platform) as the original. This
means hardware-identity-based de-duplication cannot distinguish them —
they look identical at that layer. Self-reported IDs are equally unreliable
since the virtualization layer causing the problem doesn't know or care
that it's creating a duplicate.

**DECIDED mechanism: input-stream correlation, not identity.** Two input
sources reporting **near-identical `(axes, buttons)` state across a
sustained window of frames** are, with overwhelming probability, the same
physical input being reported twice — no two genuinely independent physical
devices (even two identical controller models held by two people) produce
byte-identical state indefinitely; there is always some timing jitter or
independent variation between truly separate sources.

**Algorithm:**
1. The client (not the host — detection happens where the duplicate
   inputs are actually produced, before they're even sent, to avoid
   wasting bandwidth/budget relaying a stream that will just be discarded)
   maintains a rolling window of the last **30 frames** (~0.5s at 60Hz,
   matching typical Nearcade polling) of `(axes, buttons)` state per
   connected pad slot.
2. If two distinct pad slots show **>99% identical state** across that
   entire 30-frame window (allowing a small tolerance for legitimate
   floating-point/quantization noise between what should be genuinely
   identical readings from the same physical source read twice), the
   **later-registered** slot (the one that started sending more recently
   — almost always the virtualized copy, since it's created *after* the
   real device is already connected) is suppressed: it stops forwarding
   input, but its stream is still monitored.
3. **Suppression is not permanent or destructive**: the moment the two
   streams diverge beyond the tolerance (i.e. it turns out to genuinely be
   a second, independent controller that happened to briefly mirror the
   first), the suppressed slot resumes sending normally. This avoids a
   false-positive permanently locking out a legitimate second controller.
4. `streamFingerprint` in §6.2's event (a rolling hash of recent state, not
   the full window) lets the **host** independently corroborate this
   client-side detection rather than trusting the client's suppression
   decision blindly — consistent with `ORP_TRUST_MODEL.md`'s "don't trust
   client self-reports" principle; a modified client claiming "no
   duplicate here, trust me" while actually sending doubled input is still
   caught by the host performing the same correlation check independently
   on the streams it actually receives.

`[OPEN QUESTION: exact tolerance threshold (99% proposed) and window
length (30 frames proposed) are reasoned starting points, not measured —
like §3.3's hole-punch parameters, these need tuning against real
controller data during testing, per §5/§9's test harness mode.]`

---

## 7. Session teardown

No dedicated "leave" signaling message in v2.

A dedicated leave message is fast when it works, but adds a case that must
be handled correctly for security purposes anyway: **an unauthenticated or
spoofed "leave" message must not be trusted to actually tear down a
session** (per `ORP_TRUST_MODEL.md`'s "don't trust client self-reports"
principle — a malicious third party sending a fake leave message for
someone else's session would be a denial-of-service vector if honored
naively). Properly authenticating a leave message (signed the same way as
§1.3's envelope) is not meaningfully simpler than just detecting the
underlying transport state change directly, since WebRTC already exposes
reliable, unspoofable connection-state transitions:

- `RTCPeerConnection.connectionState === 'closed'` (explicit close) or
  the data channel's `'close'` event fire **immediately** when a peer
  cleanly exits (e.g. closes the app, clicks "leave") — this is an
  event-driven transport signal that arrives about as fast as a dedicated
  message would, without needing a new authenticated message type.
- Only an actual unclean exit (crash, force-quit, network cable pulled)
  relies on the slower `'disconnected'`→`'failed'` timeout path — and per
  §3.5, `'disconnected'` already triggers ORP's reconnection logic
  first, which is the *correct* behavior for an ambiguous "did they leave,
  or did their WiFi hiccup" situation — a dedicated instant "leave"
  message can't distinguish those cases any better; the ambiguity is
  inherent to a P2P connection dropping, not a gap in signaling.

**Decision**: rely on transport-level state events (`connectionState`,
data channel `close`) for teardown detection, not a dedicated application
message. Simpler, no new authentication surface to get wrong, and not
meaningfully slower for the common clean-exit case.

---

## 8. Versioning and cross-client compatibility

- `v: 2` is mandatory on every signaling envelope (§1.3) and every data
  channel control message.
- A client receiving a signaling envelope with an unrecognized `v` MUST
  reject the connection attempt rather than guess at compatibility. This is
  intentional — silent best-effort compatibility across protocol versions is
  how subtle security and correctness bugs get baked in permanently. A
  version mismatch should be a loud, visible failure so client authors fix
  their client, not a silent degraded mode.
- New optional fields may be added in `v: 2` without a version bump
  (readers must ignore unknown fields). Any change to the *meaning* of an
  existing field, or any new *mandatory* field, requires bumping to `v: 3`.

---

## 9. Test harness mode

A formally spec'd testing mode, so both implementations expose the same
debug capabilities consistently rather than each growing ad-hoc,
incompatible debug flags.

### 9.1 Design

Test harness mode is enabled via an explicit flag at client construction
(`orpTestMode: true` in TS, `--test-mode` CLI flag in Rust), never enabled
implicitly or by any wire-format signal from a peer (a peer cannot remotely
force another peer into test mode — that would itself be a security/trust
issue per `ORP_TRUST_MODEL.md`). When disabled (the default, and the state
of any production build), all test-harness code paths are no-ops; the flags
below don't exist as usable surface area in a normal connection.

### 9.2 Documented fault-injection flags

```typescript
interface ORPTestHarnessConfig {
  forceIceFailure?: boolean;        // skip real ICE, immediately report 'ice-failed'
  forceHolePunchTier?: boolean;     // skip normal ICE success, force §3.3's retry tier to run
  forceSignalingStrategy?: 'nostr' | 'bittorrent';  // disable racing, §1.1, use only one
  forceIceRestart?: boolean;        // simulate the §3.5 disconnect trigger on demand
  injectedLatencyMs?: number;       // artificial delay inserted before each stage of §2
  simulateDuplicateController?: boolean; // §6.3 — feed two correlated synthetic pad streams
}
```

Each flag maps directly to a specific scenario from this spec (hole-punch
tier, ICE restart, controller dedup) rather than being generic/unstructured
"chaos" injection — this keeps test runs reproducible and directly tied to
§5's test matrix rather than being a loose fuzzing surface.

### 9.3 Availability after testing

**Decision**: the flags remain present in both reference implementations
permanently (not stripped from release builds), because:

- Other implementers (anyone integrating ORP under its MIT license) will
  want to run §5's test matrix against their own implementation too, and
  can only do that if the fault-injection surface is actually part of the
  shipped, documented protocol/library — not something only kept in a
  private test build. This directly serves the "let others easily
  integrate" goal.
- The flags are inert by default (§9.1) and require explicit, deliberate
  opt-in to activate, so their presence in a release build is not itself a
  security or stability risk — nobody accidentally triggers
  `forceIceFailure` in production.
- `[OPEN QUESTION: confirm this reasoning is convincing, or if there's a
  specific reason (binary size, wanting to obscure the exact
  fault-injection surface from public scrutiny) to strip it after all —
  recommend keeping it, but this was originally posed as an open question
  rather than settled outright.]`

---

## 10. Document map

- `ORP_SPEC.md` (this document) — wire format, timing budget, retry policy,
  signaling strategy, renegotiation, teardown, versioning, test harness.
- `ORP_TRUST_MODEL.md` — threat model: what a modified/malicious client can
  and cannot get away with, what each peer must independently verify rather
  than trust on assertion, and the PIN/session-auth design replacing the
  current published-static-string scheme.

---

## Summary of open questions requiring decision

1. §0 — should failures distinguish "definitely can't P2P" for a future
   optional TURN toggle?
2. §1.2 — pairing code: short human-typed code (Nearcade-style) vs.
   deep-link/QR only?
3. §3.3.1 — burst-sync jitter assumption needs measurement, not just
   reasoning.
4. §3.3 — hole-punch burst timing/packet-count parameters (needs real
   measurement, not a guess).
5. §3.4 — build a NAT-type self-diagnosis probe now or later?
6. §3.5 — persistent signaling subscription vs. fast-rejoin for ICE restart.
7. §4.2 — retry count and backoff behavior.
8. §5.1 — what NAT topology to test against — needed for local testing.
9. §6.1 — any soft timing budget for renegotiation, or none for v2?
10. §6.3 — tolerance threshold / window length for controller dedup need
    tuning against real data.
11. §9.3 — confirm test-harness flags should ship permanently in release
    builds.
