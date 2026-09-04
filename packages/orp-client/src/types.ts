/**
 * OpenRemotePlay (ORP) Protocol v2 — Type Definitions
 *
 * License: MIT
 * This file is the single source of type truth for all ORP v2 wire formats.
 * Both the TypeScript SDK and any other implementations MUST conform to these
 * types exactly. If an implementation and this file disagree, this file wins.
 *
 * Spec reference: spec/ORP_SPEC.md
 */

// ─────────────────────────────────────────────────────────────────────────────
// § 1. Signaling envelope (ORP_SPEC.md §1.3)
// ─────────────────────────────────────────────────────────────────────────────

/** The v2 signaling envelope. All signaling messages must use this shape. */
export interface ORPSignalEnvelope {
    /** Protocol version — must always be 2. Receivers must reject other values. */
    v: 2;
    /** Message type: offer/answer/ice-candidate or control messages. */
    type: 'offer' | 'answer' | 'ice-candidate' | 'join' | 'pin-fail' | 'pin-locked';
    /** Ephemeral per-session peer ID, NOT a stable long-term identity. */
    senderId: string;
    /** SDP string, present for offer/answer messages. */
    sdp?: string;
    /** ICE candidate payload, present for ice-candidate messages. */
    candidate?: RTCIceCandidateInit;
    /**
     * HMAC-SHA256 signature over all other fields (hex string).
     * Derived from the session PIN per ORP_TRUST_MODEL.md §2.
     * Mandatory in v2.
     */
    sig: string;
    /**
     * Wall-clock timestamp (ms since epoch), embedded to allow simultaneous
     * hole-punch coordination (ORP_SPEC.md §3.3).
     */
    ts?: number;
    /** Topology hint: 'mesh' (host connects directly to each peer) or 'star'. */
    topology?: 'mesh' | 'star';
}

// ─────────────────────────────────────────────────────────────────────────────
// § 2. Connection timing instrumentation (ORP_SPEC.md §2.2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Emitted by ORPClient after each connection attempt, regardless of outcome.
 * Consumers MUST record these values to diagnose latency regressions.
 */
export interface ORPConnectionTiming {
    /** performance.now() at the moment connect() was called. */
    attemptStart: number;
    /** performance.now() when signaling was complete (offer/answer done). */
    signalingComplete?: number;
    /** performance.now() when RTCPeerConnection.connectionState === 'connected'. */
    iceConnected?: number;
    /** performance.now() when the control RTCDataChannel.readyState === 'open'. */
    dataChannelOpen?: number;
    /** performance.now() when the first video frame was decoded and painted. */
    firstFrameRendered?: number;
    /** Overall result of this attempt. */
    outcome: 'success' | 'degraded' | 'failed';
    /**
     * Which stage failed (1=signaling, 2=ICE, 3=data channel).
     * Only present when outcome is 'failed'.
     */
    failedStage?: 1 | 2 | 3;
    /** Machine-readable failure reason for tooling and diagnostics. */
    failureReason?: ORPFailureReason;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 3. Failure taxonomy (ORP_SPEC.md §4.5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Machine-readable failure reason codes. Kept stable across v2 so a future
 * TURN fallback feature (if ever added) has a clean signal to hook into,
 * without requiring callers to parse error message strings.
 */
export type ORPFailureReason =
    | 'signaling-unreachable'   // Both Nostr and BitTorrent relay attempts failed to connect
    | 'signaling-timeout'       // Reached relay but received no answer within the stage-1 budget (600ms)
    | 'ice-failed'              // ICE connectivity checks exhausted, including the hole-punch retry tier
    | 'ice-timeout'             // Stage-2 budget (900ms) exceeded before ICE resolved
    | 'security-check-failed'   // PIN HMAC verification failed — see ORP_TRUST_MODEL.md
    | 'data-channel-failed'     // RTCDataChannel failed to open within stage-3 budget (200ms)
    | 'pin-locked';             // Host rejected us: too many failed PIN attempts (rate limiting)

// ─────────────────────────────────────────────────────────────────────────────
// § 4. Client options
// ─────────────────────────────────────────────────────────────────────────────

export interface ORPClientOptions {
    /**
     * The P2P Room Code (e.g. 'peer-12345').
     * This is the primary and required identifier for routing a session.
     */
    roomCode: string;
    /**
     * Optional cryptographic session PIN.
     * Software can use this to derive the roomCode via HMAC or use it for
     * secondary authentication if they choose to implement it.
     */
    pin?: string;
    /**
     * Human-readable display name for the viewer.
     * Displayed in the host's session UI.
     */
    displayName: string;
    /** Optional hex color for the viewer's chat/UI identity. */
    color?: string;
    /**
     * An optional pre-existing ephemeral viewer ID.
     * If not provided, a new UUID is generated per session.
     */
    viewerId?: string;
    /**
     * Maximum PIN attempts before the host ignores us.
     * Only relevant on the host side; set by the host config.
     * Default: 5 attempts per 5-minute rolling window.
     */
    maxPinAttempts?: number;
}

export interface ORPHostOptions {
    /** The primary P2P Room Code for this session (e.g. 'peer-12345'). */
    roomCode: string;
    /** Optional cryptographic session PIN for derived routing and signatures. */
    pin?: string;
    /** Human-readable session/room name. */
    sessionName?: string;
    /**
     * Maximum failed PIN attempts before locking out a senderId.
     * Default: 5. After lockout, the host stops responding — gives no
     * rejection either, so an attacker learns nothing by continuing.
     */
    maxPinAttempts?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// § 5. Input payloads (ORP_SPEC.md §4 / ORP draft §4.1–4.3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Standard W3C Gamepad payload.
 * Axes are -1.0 to 1.0. Button values are 0.0 to 1.0.
 * The host MUST validate all ranges server-side regardless of client claims
 * (ORP_TRUST_MODEL.md §4).
 */
export interface GamepadPayload {
    type: 'gamepad';
    viewerId: string;
    pad_id: string;
    padIndex: number;
    /** Always 4 elements: [lx, ly, rx, ry]. Clamped to [-1, 1]. */
    axes: [number, number, number, number];
    /** Standard 17-button layout. Buttons 0–16 per W3C Gamepad spec. */
    buttons: { pressed: boolean; value: number }[];
}

/**
 * Raw WebHID hardware pass-through.
 * Used for DualSense gyroscope, trackpad, and pressure-sensitive triggers.
 */
export interface WebHIDPayload {
    type: 'webhid';
    /** USB Vendor ID (decimal integer). */
    vid: number;
    /** USB Product ID (decimal integer). */
    pid: number;
    /** Base64-encoded raw HID report buffer. */
    buffer: string;
}

/** Keyboard and mouse input payload. */
export interface KeyboardPayload {
    type: 'keyboard';
    viewerId: string;
    event: 'keydown' | 'keyup' | 'mousemove' | 'mousedown' | 'mouseup';
    /** evdev key name (e.g. 'KEY_W', 'BTN_LEFT'). */
    key?: string;
    /** Relative X movement, only for mousemove. */
    dx?: number;
    /** Relative Y movement, only for mousemove. */
    dy?: number;
    /** Mouse button index (0=left, 1=middle, 2=right), only for mousedown/mouseup. */
    button?: number;
}

/** 
 * Controller renegotiation event (ORP_SPEC.md §6.2).
 * Sent over the data channel to manage session-level controller state.
 */
export interface ORPControllerEvent {
    v: 2;
    type: 'controller-connected' | 'controller-disconnected';
    slotId: 'primary';
    streamFingerprint: string;
}

/** Union of all valid input payloads. */
export type ORPInputPayload = GamepadPayload | WebHIDPayload | KeyboardPayload | ORPControllerEvent;

// ─────────────────────────────────────────────────────────────────────────────
// § 6. ICE server configuration (ORP_SPEC.md §3.1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default STUN-only ICE servers.
 * No TURN entries — TURN fallback is explicitly out of scope for ORP v2
 * (ORP_SPEC.md §0 non-goals).
 * Three independent operators for redundancy against single-provider outages.
 */
export const ORP_ICE_SERVERS: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.nextcloud.com:443' },
];

// ─────────────────────────────────────────────────────────────────────────────
// § 7. Stage time budgets (ORP_SPEC.md §2 table)
// ─────────────────────────────────────────────────────────────────────────────

/** Per-stage timeout budgets in milliseconds. Total: 2000ms. */
export const ORP_STAGE_BUDGETS = {
    /** Stage 1: Signaling handshake — offer sent and answer received. */
    SIGNALING: 600,
    /** Stage 2: ICE gathering + connectivity checks. */
    ICE: 900,
    /** Stage 3: RTCDataChannel reaches 'open' state. */
    DATA_CHANNEL: 200,
    /** Stage 4: First video frame decoded and rendered (soft budget — degraded, not failed). */
    FIRST_FRAME: 300,
} as const;
