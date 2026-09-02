# Open Remote Play (ORP)

This repository serves as the reference implementation and specification for **Open Remote Play (ORP)**, an open WebRTC-based interactive streaming protocol.

The goal of this project is to allow developers to build their own independent remote-play clients (e.g. mobile apps, alternative web viewers, or custom desktop software) that natively interoperate with compliant ORP hosts like [Nearcade](https://github.com/TheRealFame/Nearcade).

## Specification status: v2 draft

The full protocol specification lives in [`spec/ORP_SPEC.md`](spec/ORP_SPEC.md) and its companion [`spec/ORP_TRUST_MODEL.md`](spec/ORP_TRUST_MODEL.md). This README covers the high-level shape; the spec files are the actual source of truth and should be read before implementing a client or host.

v2 is a draft. It has not yet been implemented against or tested. See the spec's own "Summary of open questions" sections for what's still unresolved.

### What v2 covers, at a glance

- [x] Serverless signaling (Nostr primary, BitTorrent-tracker fallback, raced) — no VPS required for signaling or media.
- [x] A defined connection-time budget (2000ms, signaling through first rendered frame) with per-stage sub-budgets and timing instrumentation, so "fast" is measured, not just claimed.
- [x] STUN-only NAT traversal (three independent public operators) plus a forced hole-punch retry tier for when plain ICE fails — no TURN, by design; see the spec's non-goals for why.
- [x] Mid-session recovery via ICE restart (network changes don't require a full reconnect).
- [x] In-session renegotiation for media parameters and controller (dis)connection, including a specific fix for the Steam Input virtualized-controller duplicate-input problem.
- [x] A trust model that assumes any peer's client code may be modified or adversarial, and defines what's actually provable on the wire (PIN possession) versus what isn't (which client software is really running).
- [x] A documented, permanent, cross-language test-harness mode so any implementer can reproduce the same fault scenarios (forced ICE failure, forced hole-punch, forced restart, etc.) rather than inventing their own ad hoc debug flags.
- [x] Explicit support for any media pipeline (WebRTC-native, WebCodecs, or anything not yet invented) without requiring permission or a spec change for the common case, plus a documented path (pull request) for pipelines that do need something new from the protocol — see ["Using ORP with your own pipeline"](#using-orp-with-your-own-pipeline) below.
- [ ] TURN relay fallback — explicitly out of scope. Some NAT topologies (symmetric-to-symmetric, some CGNAT) cannot be P2P-traversed by any implementation, full stop; ORP reports this clearly rather than papering over it with a relay.
- [ ] Cross-topology signaling field (`mesh` vs `star`) — needed so hosts like Nearcade (real P2P mesh) and hosts like Soda Arcade (host-relayed star, used because SFU/MFU infrastructure isn't affordable for every project) can both speak ORP without either side assuming the other's internals. Not yet designed at the wire-format level.
- [ ] Sybil/UUID trust for fully decentralized identity — acknowledged as an open, currently-unsolved problem in the trust model rather than something papered over with a fake guarantee.
- [ ] Source-hash client attestation — designed as an informational-only signal (see trust model §6), not a security gate, because no self-reported hash can be trusted against a genuinely adversarial modified client without hardware attestation infrastructure neither this project nor Nearcade currently has.

## What a compliant implementation looks like

At minimum, a compliant ORP v2 client or host:

1. Speaks the signaling envelope in spec §1.3 (versioned, signed) over both Nostr and BitTorrent-tracker transports, racing them per §1.1.
2. Enforces the 2000ms connection budget with the four-stage breakdown in §2, and emits the timing telemetry in §2.2 so failures are diagnosable rather than opaque.
3. Uses only the three STUN operators in §3.1 — no TURN — and implements the forced hole-punch tier in §3.3 as the last resort before failing an attempt.
4. Recovers from network changes via ICE restart (§3.5) rather than treating every hiccup as a full disconnect.
5. Authenticates PIN possession using the mechanism in the trust model (§2) rather than any static or self-asserted secret — this is a direct fix for a real vulnerability found in this repository's own earlier `orp-bot.js` reference client, which had a static shared-secret challenge checked into public source. That mistake is why the trust model exists as its own document rather than a few bullet points.
6. Supports the documented test-harness flags (spec §9) so its behavior under fault conditions can be verified by anyone, not just its own author.

## Reference implementations

Two reference implementations track the spec, kept in sync by the spec rather than by one copying the other:

| Client mode | TypeScript (`packages/orp-client`) | Rust (`packages/orp-rust` — planned) |
|---|---|---|
| Browser (WebRTC native) | Primary target | N/A (browsers don't run native binaries) |
| Linux native / CLI | Via Node.js | Planned — native binary via [str0m](https://github.com/algesten/str0m) |
| Windows native / CLI | Via Node.js | Planned |
| macOS native / CLI | Via Node.js | Planned |

The TypeScript module wraps [Trystero](https://github.com/dmotz/trystero) directly (MIT-licensed, matches Nearcade's existing dependency, fast to build against). The Rust module cannot depend on Trystero — it's a browser/JS library — so it implements the Nostr and BitTorrent-tracker signaling clients itself, against the same spec, so a CLI-based host or client (e.g. for headless/server use, or for other projects wanting a non-browser implementation) has a real, independent option. Neither module is authoritative over the other; the spec documents in `spec/` are.

## Using ORP with your own pipeline

**ORP is not tied to WebRTC-native tracks or WebCodecs specifically.** Those are the two pipelines in current use, not an exhaustive list. If you're building a client or host with a different capture, encoding, or transport approach — anything at all — you can use ORP for the connection and signaling layer without asking permission, as long as you can put your data on the data channel once it's open. See [`spec/ORP_SPEC.md` §1.4–§1.5](spec/ORP_SPEC.md) for the full explanation, but the short version:

- **The connection and trust layers (signaling envelope, PIN handshake, identity) are fixed** — every compliant client/host speaks these the same way, regardless of what media pipeline it uses.
- **What you send over the open data channel is entirely yours to define.** Most pipelines — including ones that don't exist yet — need nothing more from ORP than an open channel to write bytes into, so most integration work needs no changes to this repository at all.
- **If your pipeline needs something the protocol doesn't currently expose** — a new signaling field, a new control-message type, or a hook into the connection lifecycle that isn't already there — that's a legitimate reason to open a pull request against the spec or the reference implementations, rather than fork silently. Keeping changes like that as PRs (even ones that get discussed and reworked before merging) is what keeps "any client connects to any host" true as the protocol grows. Silent, undocumented forks defeat the entire point of this being a shared protocol.

If you're not sure whether your use case needs a spec change or already works as-is, open an issue or a draft PR describing what you're trying to do — that's a fine way to find out.

## Design influences and conversations

ORP is only implemented and used by Nearcade today — no other project has adopted or integrated it. The two items below are **not integrations, partnerships, or endorsements**; they're independent open-source remote-play projects whose developers were consulted informally while designing this protocol, and whose real architecture directly shaped specific decisions in the spec. Naming them here is about giving credit for that influence and being transparent about where design constraints came from, not about implying any current relationship:

- **[LibreRemotePlay](https://github.com/PiterWeb/LibreRemotePlay)** — an independent, MIT-licensed WebRTC remote-play client/host built in Go (Wails + pion/webrtc), with its own OS and gamepad support matrix (Windows and Linux supported, no macOS due to lack of dev hardware; XInput/DirectInput and Xbox controllers supported, PlayStation controllers require an external emulation workaround). In an early discussion about this protocol, its author independently suggested the same MIT-protocol / GPL-implementation licensing split this project uses.
- **[Soda Arcade](https://soda-arcade.com)** — a hosted remote-play platform. In a conversation about its architecture, its developer described its use of a star topology (host relays to each guest, rather than a P2P mesh) specifically because dedicated SFU/MFU relay infrastructure isn't affordable for every project. That conversation is the concrete motivating case for the `mesh`/`star` topology field noted as not-yet-designed above — without it, the spec would likely have assumed mesh-only topology by default.

## Data Channels
- Specifies strict JSON payload structures for 16-bit Gamepad states, KBM events, and Haptic feedback. See `packages/orp-client/src/types.ts` for the current v1-era shapes; these are being extended for v2 per the spec (`ORPControllerEvent`, `ORPSignalEnvelope`, etc.) rather than replaced outright.

## Deep Linking
Uses `openremoteplay://join?url=<host_url>` so users can instantly open their preferred client from a link or QR code, without requiring the browser tab that generated the invite to still be open.

## License
This specification and the included example templates are released under the permissive [MIT License](LICENSE), explicitly allowing you to embed, fork, or modify this logic in your own commercial or open-source clients without restriction. The specification documents in `spec/` are MIT for the same reason — the protocol should be freely implementable by anyone, in any language, without licensing friction; that's the entire point of it being a protocol rather than a product.

## Local Testing Environment
This package includes a minimal testing server and a highly optimized **WebCodecs-based** HTML client. We intentionally omitted any GPL-licensed code so you can safely use this as a boilerplate for your own projects.

1. Run `npm install`
2. Run `npm start`
3. Open `http://localhost:3001` in your browser to use this repo's own bundled signaling server directly.

`public/index.html` and `public/viewer.js` implement the `VideoDecoder` API to parse and render low-latency binary chunks directly from the WebRTC DataChannel.

> **Note on `server.js`**: this is a real v2-aware signaling server, not a v1 leftover — it routes by session ID (derived from the host's PIN), forwards `v: 2` envelopes only between the correct host/viewer pair rather than broadcasting to everyone, and deliberately does not inspect or verify the envelope's signature itself (that verification happens peer-to-peer per `ORP_TRUST_MODEL.md` — the server is meant to stay a dumb, untrusted pipe). It's still a minimal reference implementation of the signaling routing described in spec §1, not a hardened production deployment, so review it against the spec before relying on it as-is.

## Building a Host?
If you are building an ORP host rather than a client, you can leverage the **Nearcade uinput backend**, which has been released as a standalone npm package. This allows your Node.js server to seamlessly translate the incoming 16-bit ORP telemetry directly into Linux kernel controller events.
