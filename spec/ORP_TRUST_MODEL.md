# ORP Trust Model — v2 DRAFT

Status: **DRAFT.** Companion to `ORP_SPEC.md`. This document exists because
of a specific requirement from this session: *"I did still want to make each
client trust themselves with the connection even if the source code of one
of those clients could or were modified."*

That is a precise, well-known problem in protocol design: **you cannot trust
a peer's client code, only what the wire protocol forces that peer to prove.**
Anyone can modify ORPClient.ts, recompile a Rust client, or write a hostile
client from scratch that speaks the ORP wire format while lying about
everything it can get away with lying about. The job of this document is to
enumerate exactly what a peer can and cannot get away with, given the wire
format in `ORP_SPEC.md`.

---

## 1. The starting problem: what's broken today

Before proposing anything new, here's the concrete finding from this
session's audit that motivates this document:

`tools/open-remote-play/scripts/orp-bot.js` (a public, MIT-licensed
reference client in Fame's own `OpenRemotePlay` GitHub repo) contains:

```javascript
const challenge = msg.nonce + "nearcade_client_v3";
const hash = crypto.createHash('sha256').update(challenge).digest('hex');
```

This is Nearcade's real, current viewer-auth challenge-response scheme,
checked into a public repository. The security of a nonce-based
challenge-response scheme depends entirely on the responder holding a
**secret** the challenger can verify without revealing it. Here, the
"secret" (`"nearcade_client_v3"`) is a fixed string now visible to anyone
who reads the file — which is the explicit purpose of a public reference
client. Any party can now compute a valid response to any nonce, for any
Nearcade host, indefinitely, without knowing anything else. This scheme
currently provides **no security value** — it will pass for a legitimate
client and an adversarial one identically.

This is not a hypothetical for the trust model — it's the direct evidence
for why "trust nothing the client asserts about itself" has to be the
starting design principle for ORP v2, not an afterthought.

---

## 2. Design principle: authenticate the session secret, not the client

The fix is not a better version of the broken scheme (e.g. a different fixed
string, obfuscated differently) — any fixed value shipped in open-source
client code is discoverable by definition, MIT license or not. The fix is to
stop trying to authenticate *which client software* is connecting (that's
unwinnable against a modified client, by definition of "modified") and
instead authenticate possession of the **PIN**, which is:
- generated per-session by the host,
- never checked into any repository,
- the thing Fame explicitly said is the real gate ("*the main gate i care
  about are pins*").

### 2.1 Mechanism: PIN-derived room key, per Trystero's existing primitive

`p2p-signaler.js` already calls `joinRoom({ appId: 'nearcade-arcade' },
roomCode)` with no `password`. Trystero's core (`createPasswordHandshake` in
the bundled library, confirmed present in `trystero-bundle.js` read during
this session) already implements exactly the right primitive if a
`password` is supplied:

- A random challenge is exchanged between the two peers directly (not
  through the relay's plaintext channel).
- Each side proves knowledge of `password` by responding with
  `SHA-256(challenge:password:appId:roomId)` — the password itself is never
  transmitted, only proof of possession of it.
- Additionally, all of Trystero's actual signaling payloads (SDP, ICE
  candidates) are encrypted with an AES-GCM key derived from
  `SHA-256(password:appId:roomId)` — so a relay operator or eavesdropper on
  the Nostr/BitTorrent relay network sees ciphertext, not raw SDP, even
  before a P2P connection exists.

**ORP v2 proposal**: pass the session PIN as Trystero's `password` parameter
directly. This is not new cryptography ORP has to design and audit —
it's using an existing, already-present primitive correctly, which is safer
than either (a) inventing a new scheme or (b) continuing to use the broken
one. `[OPEN QUESTION: confirm this is acceptable — it does mean the PIN
itself becomes load-bearing for the *signaling* layer's confidentiality,
not just for gating who's allowed to join, which is a slightly larger
responsibility for the PIN than it has today. Given Fame's stated priority
on the PIN being the real gate, this seems like a good fit, but flagging the
scope increase explicitly rather than assuming it's fine.]`

### 2.2 What this does NOT protect against

Being precise about limits, per the "trust model" framing:

- **A legitimate viewer who is later malicious**: someone who correctly
  entered the PIN once, is now inside the session, and sends malformed or
  hostile input payloads. The PIN handshake proves *initial* possession of
  the secret; it says nothing about ongoing good behavior. This is what §3
  below (payload validation) is for, and it's a separate concern from
  authentication.
- **PIN brute-forcing** if the PIN space is small and there's no rate limit
  at the point where guesses are checked. This is why §4 (rate limiting)
  exists as a distinct requirement, not something the crypto alone solves —
  see below.
- **A compromised host** — this trust model is about protecting the
  connection from malicious/modified *viewer* clients. A malicious host is
  a different, larger problem (the host has full control over what it sends
  down the media/input channels regardless of protocol) and is out of scope
  for this document. `[OPEN QUESTION: confirm this scoping is correct —
  ORP v2 is viewer-trust, not host-trust, unless you want the latter too.]`

---

## 3. Brute-force protection (the "no security flaws allowing brute force" requirement)

The PIN-as-password scheme in §2 is only as strong as (a) the PIN's entropy
and (b) whether guessing is rate-limited. Both need explicit treatment:

### 3.1 PIN entropy

Nearcade's current PIN generation (`makePin()` in `server.js`, confirmed
during a prior session in this project) produces a 4-digit numeric PIN —
10,000 possible values. That is **not enough entropy on its own** to resist
brute-forcing if an attacker can make guesses fast and cheap. The Trystero
password handshake happens **peer-to-peer**, not through a rate-limitable
central server — which is exactly the property that makes it fast and
serverless, but also means there is no natural chokepoint to rate-limit
guesses at, unlike a traditional login form.

`[OPEN QUESTION — this is a real tension worth surfacing plainly rather
than glossing over]`: a P2P password handshake with no central
rate-limiter, combined with a 4-digit PIN, is guessable by a patient
attacker running many parallel join attempts against a known room code,
because nothing on the wire stops them from trying. Concrete options, pick
one or propose another:

  a. **Increase PIN entropy** (e.g. 6+ alphanumeric chars instead of 4
     digits) — raises the cost of brute force without adding new
     mechanism, but changes the human-facing PIN experience Fame may not
     want changed.
  b. **Client-side exponential backoff enforced by the host peer itself**:
     the host's ORP session tracks failed handshake attempts per
     `senderId`/source and simply stops responding (or artificially
     delays responses) after N failures within a time window. This works
     because the host is a real, single, addressable peer even in a P2P
     topology — it can enforce a local rate limit even without a central
     server. This doesn't require a VPS; it's local state in the host's own
     ORP session.
  c. **Both** — raise entropy and rate-limit, defense in depth.

**DECIDED**: option (b), host-configurable. The host sets
`maxPinAttempts` (a config value, not a spec-hardcoded constant) before
the lockout engages. Recommended default: `5` attempts per `senderId`
within a rolling 5-minute window, then that `senderId` is ignored
entirely (no response sent at all, not even a rejection — an attacker
learns nothing more by continuing) until the window rolls over. PIN
length stays as-is (Fame did not want the PIN UX changed); the lockout is
the defense, not increased entropy. `[OPEN QUESTION: is 5 attempts /
5 minutes the right default, or should this be tuned after the test plan
in ORP_SPEC.md §5 gives real data on legitimate-user typo rates? A
lockout that's too aggressive locks out someone who fat-fingered their
own PIN twice.]`

### 3.2 Rate limiting is a host-side responsibility, and must survive a modified client

Critically: rate limiting must be enforced by the **host's own logic**, not
trusted to any signal a viewer client sends about itself (a modified viewer
client would simply not report its own failed attempts). The host counts
failures it observes directly (a handshake response that doesn't verify),
independent of anything the connecting client claims.

---

## 4. Payload integrity during an active session

Once a session is established, every gamepad/KBM/WebHID payload
(`types.ts`) travels over the Trystero data channel, which — given §2 — is
already running over a connection whose SDP/ICE was exchanged under the
PIN-derived encryption. But payload *content* validation is a separate
layer:

- The host MUST validate incoming payload shape server-side (bounds on
  array lengths, numeric ranges) regardless of what the client claims to be
  sending — this already exists in Nearcade's current `server.js`
  (`normalizeGamepadMsg`'s "STRICT DATA VALIDATION REWRITE" block, read in
  a prior session) and that pattern should carry forward into ORP's Rust/TS
  reference implementations, not be re-invented differently in each.
- A modified client cannot use the *shape* of a malformed payload to crash
  or exploit the host, but this trust model does not attempt to prevent a
  legitimately-authenticated viewer from sending *semantically* hostile but
  well-formed input (e.g. spamming inputs) — that's a moderation/session-
  management concern, not a wire-protocol trust concern, and is out of
  scope here.

---

## 5. Summary: what each side must independently verify

| Claim | Trust it because the peer said so? | Or verify independently? |
|---|---|---|
| "I know the session PIN" | No | Verified via Trystero password handshake (§2.1) — proof of possession, not assertion |
| "I am client software version X" | No — never verifiable, don't ask the protocol to do this | N/A — see below |
| "This SDP/ICE candidate is legitimate" | No | Encrypted+authenticated under the PIN-derived key; a peer without the PIN cannot produce valid ciphertext |
| "This gamepad payload is well-formed" | No | Host validates shape/bounds itself, regardless of claims |
| "I haven't exceeded my failed-attempt limit" | No | Host tracks failures it observes directly, not what the client reports |

The one deliberately-absent row is client software identity/version
attestation as a hard guarantee — ORP v2 does not attempt that. Trying to
have the protocol verify "this is the real ORPClient.ts, unmodified" with
certainty is not achievable against an adversary who controls their own
machine (this is the same reason DRM/client-side anti-cheat is
fundamentally different from protocol security). However, see §6 below for
a weaker, opt-in *soft* version of this idea that Fame raised separately
and that is worth including precisely because it doesn't overclaim what it
proves.

---

## 6. Soft client-integrity signal (source-hash attestation)

Raised by Fame in a separate conversation, distinct from the PIN gate
above: *"there's still an easy way to check for minimal or large
modifications by looking on the publicly stored code as a index... I think
i meant the SHA256 checksum."* This is a real, different mechanism from
§2 — worth its own section rather than folding it into the PIN discussion,
and worth being precise about what it does and does not prove.

### 6.1 What this mechanism is

Since ORP reference clients are open-source and published (MIT-licensed,
publicly indexed on GitHub), a host can optionally ask a connecting client
to report a hash of its own running code (e.g. `SHA-256` over the bundled
JS/WASM it loaded, or over its own binary for the Rust CLI case) and
compare that against the hash of known-good published releases. If it
matches a known release hash, the host can display "verified official
client" or similar; if it doesn't match anything published, the host can
choose to warn, or simply display "custom/modified client" neutrally
rather than blocking it outright (blocking third-party ORP clients
outright would undermine the entire point of an open, cross-client
protocol).

### 6.2 What this mechanism does NOT prove, precisely

This needs to be stated as plainly as §5's table states the PIN
guarantee, because it's easy to overclaim:

- **A self-reported hash is not verified by anything except the peer's own
  honesty in computing and reporting it.** A modified client can simply
  hash the *original* unmodified source it forked from and report that
  hash instead of hashing its own modified code, since the hash
  computation itself runs on hardware the peer fully controls. This is not
  a bug in the design — it is a fundamental property of self-attestation
  without a trusted execution environment or code-signing authority
  neither Nearcade nor ORP currently has.
- Given that, this mechanism is **informational, not a security
  boundary**. It catches casual/accidental use of stale or unofficial
  builds, and gives a legitimate host operator a "this looks like the real
  thing" signal for their own peace of mind — it does not and cannot stop
  a deliberately adversarial modified client, which is exactly why the PIN
  handshake in §2 (a real cryptographic proof-of-possession) is the actual
  security boundary and this is not a substitute for it.
- **Recommendation**: implement this as an optional, clearly-labeled
  "client info" display (e.g. "Connected via: ORPClient.ts v2.1 [hash
  matches official release]" vs "[unrecognized build]"), never as a gate
  that blocks connection, and never described to users as a security
  feature — mislabeling it that way would create false confidence in a
  signal an adversary can trivially spoof. `[OPEN QUESTION: confirm this
  framing — informational only, not gating — matches what Fame actually
  wants from this idea, since the original phrasing ("check for
  modifications") could also be read as wanting it to gate/block. Given §6.2
  above, gating on it would be a false security guarantee, so this needs
  explicit confirmation rather than assumption.]`

---

## 7. Decentralized identity / UUID trust (open problem, unsolved)

Also raised by Fame, and explicitly flagged by Fame as unsolved: *"UUID's
for decentralized are always the risky part... I haven't found a solution
to put a lock on each generated one."*

The problem, stated precisely: in a fully P2P, no-VPS, no-central-registry
system, any peer can generate any UUID and claim it as their own identity
(e.g. for the friend-list/pairing system already in Nearcade's
`server.js`, which stores friends keyed by UUID with an HMAC pairing
secret — that part is already sound per that file's design read in a
prior session). The specific unsolved piece is: **what stops a peer from
generating a fresh UUID indistinguishable from a legitimate one, with
nothing to "lock" a UUID to a specific real-world identity or prevent
UUID churn/Sybil-style behavior** (one attacker presenting as many distinct
"peers")?

This is a genuinely hard, open problem in decentralized-identity design
generally (not specific to ORP), and this document does not propose a
full solution here — doing so responsibly needs its own dedicated design
pass, not a paragraph tacked onto the trust model. What's worth recording
now, so it isn't lost:

- For the **existing** Nearcade friend-list system, the risk is already
  bounded by the pairing-secret HMAC design (a UUID alone isn't
  sufficient to act as a friend — you also need the pairing secret
  exchanged out-of-band once). That existing mitigation does not
  automatically extend to arbitrary ORP sessions between strangers (the
  friend system assumes a prior relationship; ORP's PIN-join flow in §2
  assumes no prior relationship, just a shared PIN for one session).
- For ORP's PIN-based session join specifically, UUID/`senderId` churn is
  *partially* mitigated already by §3's rate-limiting being keyed to
  `senderId` — but a peer that simply generates a new `senderId` per
  attempt evades that rate limit entirely. §8 below addresses *half* of
  this gap (impersonation of an existing peer's identity); the other half
  (unlimited fresh-identity generation to evade rate limiting) remains
  genuinely open — see §8.3.
- Recommend the remaining open half of this topic (Sybil resistance for
  fresh-identity generation) become its own follow-up document once ORP
  v2's core connection protocol is implemented and tested, rather than
  blocking the current spec on solving a problem that the wider research
  literature (§8) treats as a separate, harder problem from identity
  spoofing. Flagging it here so it's on record as a known, named,
  deliberately-deferred gap — not something overlooked.

---

## 8. Self-certifying peer identity

A real, researched improvement over a plain random `senderId`, found via
follow-up research into this exact question. This directly addresses the
**impersonation** half of §7's UUID problem (stopping a peer from claiming
to be a UUID it doesn't actually control) — it does **not** address the
**proliferation** half (stopping a peer from minting unlimited fresh,
legitimately-unforgeable UUIDs), which stays an open problem per §8.3.
Both halves need to be understood as genuinely separate problems, per the
research literature itself (see §8.3), not as one problem with one fix.

### 8.1 Mechanism

This is the same technique underlying Tor's `.onion` addresses and IPFS's
`PeerID` system: a peer generates a public/private keypair **locally, on
first run**, and its `senderId` (§1.3) is derived from a hash of its own
public key, rather than being an arbitrary random string:

```
senderId = base32(SHA-256(publicKey))[:26]
```

Because the identity is mathematically tied to a specific keypair, a peer
can **prove** it controls a given `senderId` by signing a challenge (e.g.
the nonce already present in the signaling flow) with the corresponding
private key — verifiable by anyone who knows the public key (which is
trivially derivable from the claimed `senderId` plus the peer providing
its public key once). This is provable possession, not assertion, exactly
like the PIN mechanism in §2 — the two are complementary, not competing:
the PIN gates *session* access ("you may join this specific session"); the
self-certifying `senderId` gates *identity* claims ("you are who you say
you are across this session, including through an ICE restart or
renegotiation").

### 8.2 What this concretely stops

- **Identity spoofing mid-session**: without this, nothing stops a
  malicious third peer from injecting a signaling message claiming to be
  an already-established `senderId` (e.g. during §3.5's ICE restart flow,
  where a fresh offer is expected from a specific already-known peer). With
  self-certifying IDs, such a message must carry a valid signature from the
  matching private key, which an impersonator does not have.
- **Replay of a previous peer's identity in a later session**: a UUID
  alone, if ever observed (e.g. leaked in a log or captured on the relay
  network), could previously be reused by anyone. A self-certifying ID
  requires the private key, not just the public identifier, so observing
  the ID alone grants no ability to act as that peer.

### 8.3 What this does NOT stop (confirmed by the research, not just reasoning)

The research literature on this exact technique (self-certifying/onion-
style identifiers as used in Tor and IPFS) is explicit that Sybil
resistance is a **separate, harder problem** requiring additional
mechanisms of its own — typically proof-of-work on identity creation, a
trusted issuer, or rate-limited issuance, none of which are free or simple
to add. This is not a gap specific to ORP's design; it is a structural
limitation of self-certifying identity schemes generally:

- **Keypair generation is free and instant.** Nothing stops a peer from
  generating an unlimited number of distinct, individually-unforgeable
  `senderId`s, each one perfectly legitimate on its own terms. This
  directly defeats naive `senderId`-keyed rate limiting (§3, §7) — an
  attacker simply presents a fresh self-certifying identity per attempt,
  and each one passes identity verification perfectly, because it *is* a
  real, valid identity; it's just a new one every time.
- This is why §4.3's host-global (not per-`senderId`) PIN attempt counter
  in `ORP_SPEC.md` remains the actual defense against brute-forcing the
  PIN — it does not depend on `senderId` uniqueness holding up under
  Sybil pressure, unlike a naive per-identity rate limit would.
- Fully solving Sybil resistance (bounding *how many* distinct identities
  a single real-world attacker can cheaply produce, not just verifying
  each one honestly) remains the genuinely unsolved problem from §7 —
  self-certifying identity is a real, useful building block for a future
  solution, but is not that solution by itself, and should not be
  presented as though it were.

### 8.4 Recommendation for v2

Adopt self-certifying `senderId` generation (§8.1) as the identity layer
underneath the existing PIN gate (§2), specifically because it's a
genuine, low-cost improvement over a plain random string with no
downside — it doesn't require Sybil resistance to be solved first to be
worth having. Continue treating §7/§8.3's Sybil-proliferation problem as
deferred and open, not blocking v2.

---

## Summary of open questions requiring your decision

1. §2.1 — confirm using the PIN as Trystero's `password` is the right
   scope (it becomes load-bearing for signaling confidentiality, not just
   session gating).
2. §2.2 — confirm this trust model is viewer-trust only, not host-trust.
3. §3.1 — **DECIDED**: host-configurable max attempts, default 5/5min,
   confirm the default numbers once real typo-rate data exists.
4. §6.2 — confirm source-hash attestation is informational/display-only,
   never a connection gate.
5. §7/§8.3 — UUID impersonation is now addressed (§8, self-certifying
   identity); Sybil-style fresh-identity proliferation remains an
   acknowledged open problem, deferred to a follow-up document — confirm
   that deferral is acceptable.
6. §8.4 — confirm adopting self-certifying `senderId` generation for v2.
