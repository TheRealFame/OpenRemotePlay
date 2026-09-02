/**
 * OpenRemotePlay (ORP) Protocol v2 — Reference TypeScript Client
 *
 * License: MIT
 * Spec reference: spec/ORP_SPEC.md & spec/ORP_TRUST_MODEL.md
 *
 * Key decisions implemented here:
 *  - Trickle ICE enabled (spec §3.2 — NOT the old force-wait pattern)
 *  - Per-stage timeouts enforced: 600ms signaling, 900ms ICE, 200ms data channel
 *  - HMAC-SHA256 signature on every signaling envelope (spec §1.3)
 *  - PIN-derived room key via Trystero (ORP_TRUST_MODEL.md §2.1) — not yet
 *    implemented in this file (requires Trystero integration), so this file
 *    uses a plain WebSocket signaling path for the reference implementation.
 *    The Nostr/BitTorrent path is in ORPNostrSession.ts (separate file).
 *  - Retry once immediately on stage 1-3 failure, then surface failure (spec §4.2)
 *  - Failure reasons are machine-readable ORPFailureReason codes (spec §4.5)
 */
import { ORPClientOptions, ORPInputPayload, KeyboardPayload } from './types';
type Handler = (...args: unknown[]) => void;
declare class EventEmitter {
    private _listeners;
    on(event: string, fn: Handler): this;
    off(event: string, fn: Handler): void;
    emit(event: string, ...args: unknown[]): void;
}
/**
 * ORPClient: connects to an ORP host, negotiates WebRTC, sends inputs.
 *
 * Emitted events:
 *   'timing'      (ORPConnectionTiming)  — after each attempt (pass or fail)
 *   'ready'       ()                     — data channel is open, inputs can be sent
 *   'stream'      (MediaStream)          — audio/video track arrived
 *   'message'     (string)               — arbitrary text from host (e.g. chat)
 *   'disconnected'()                     — peer connection dropped
 *   'error'       (ORPFailureReason, msg)— unrecoverable failure after all retries
 */
export declare class ORPClient extends EventEmitter {
    private opts;
    readonly viewerId: string;
    private ws;
    private pc;
    private dc;
    private _activePads;
    private _sessionId;
    constructor(opts: ORPClientOptions);
    /**
     * Begin a connection attempt to the ORP host at `signalingUrl`.
     * If stage 1–3 fails, retries once immediately per spec §4.2.
     *
     * `signalingUrl`: WebSocket URL of an ORP-compatible signaling server
     *   (ws://host:port/signaling or wss://...).
     *   For the Nostr/serverless path, use ORPNostrSession instead.
     */
    connect(signalingUrl: string): Promise<void>;
    /** Send an input payload to the host over the fast-lane data channel. */
    sendInput(payload: ORPInputPayload): void;
    /** High-level helper: send the current state of a W3C Gamepad object. */
    sendGamepad(pad: Gamepad): void;
    /** Send a zeroed (neutral) state for a pad — prevents stuck inputs. */
    releaseGamepad(padId: string): void;
    /** Send a keyboard or mouse event. */
    sendKey(payload: KeyboardPayload): void;
    /** Close all resources. */
    disconnect(): void;
    /** One full connection attempt. Throws on stage 1–3 failure. */
    private _attempt;
    /** Open WebSocket, set up peer connection, send/receive offer–answer. */
    private _connectSignaling;
    /** Wait for RTCPeerConnection.connectionState === 'connected'. */
    private _waitForIce;
    /** Wait for the data channel to reach 'open'. */
    private _waitForDataChannel;
    /**
     * Run `fn` with a hard timeout. On timeout, sets the failure reason and
     * failed stage on `timing`, then throws so the retry loop can catch.
     */
    private _withTimeout;
    /** Tear down all resources from a previous attempt. */
    private _cleanup;
}
export {};
