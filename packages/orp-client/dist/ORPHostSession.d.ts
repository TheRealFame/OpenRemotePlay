/**
 * OpenRemotePlay (ORP) Protocol v2 — Host Session
 *
 * License: MIT
 * Companion to ORPClient.ts. This is the host-side session manager.
 *
 * Responsibilities:
 *  - Generate a session PIN and advertise the session
 *  - Accept WebRTC connections from viewers
 *  - Verify HMAC signatures on all signaling envelopes (ORP_TRUST_MODEL.md §2)
 *  - Enforce PIN attempt rate limiting per viewer senderId (ORP_TRUST_MODEL.md §3)
 *  - Multiplex encoded video frames to all viewers over WebCodecs DataChannels
 *  - Receive and validate incoming input payloads (ORP_TRUST_MODEL.md §4)
 *  - Track timing for the 2-second connection budget (ORP_SPEC.md §2)
 */
import { ORPHostOptions, ORPInputPayload, ORPConnectionTiming } from './types';
export interface ORPViewer {
    senderId: string;
    displayName: string;
    color: string;
    pc: RTCPeerConnection;
    inputChannel: RTCDataChannel | null;
    videoChannel: RTCDataChannel | null;
    timing: Partial<ORPConnectionTiming>;
    connectedAt: number;
}
type HostEventMap = {
    'viewer-joined': [ORPViewer];
    'viewer-left': [string];
    'input': [ORPInputPayload, string];
    'timing': [ORPConnectionTiming & {
        senderId: string;
    }];
};
type HostHandler<K extends keyof HostEventMap> = (...args: HostEventMap[K]) => void;
/**
 * ORPHostSession manages one ORP host session.
 *
 * Usage (browser context, e.g. WebCodecs host page):
 *   const host = new ORPHostSession({ pin: '1234-5678' });
 *   host.on('input', (payload, senderId) => { ... forward to uinput ... });
 *   host.on('viewer-joined', viewer => console.log('New viewer:', viewer.displayName));
 *   // Pass WebSocket connections to host.handleSignalingSocket(ws)
 */
export declare class ORPHostSession {
    private opts;
    readonly pin: string;
    private viewers;
    /** PIN attempt tracking for rate limiting (ORP_TRUST_MODEL.md §3) */
    private pinAttempts;
    private readonly maxAttempts;
    private readonly WINDOW_MS;
    private _handlers;
    constructor(opts: ORPHostOptions);
    on<K extends keyof HostEventMap>(event: K, fn: HostHandler<K>): this;
    private emit;
    /**
     * Call this for every new viewer WebSocket connection.
     * The host's HTTP/WS server should call this when a new client connects.
     *
     * @param ws - The raw WebSocket for this viewer's signaling channel
     */
    handleSignalingSocket(ws: WebSocket): void;
    private _onViewerJoin;
    private _removeViewer;
    /**
     * Broadcast a raw encoded video buffer to all connected viewers.
     * Call this from your WebCodecs VideoEncoder output callback.
     *
     * `isKey`: whether this is a keyframe (type === 'key')
     * `timestamp`: chunk.timestamp from WebCodecs
     * `data`: Uint8Array of the encoded chunk
     * `config`: JSON string of the VideoDecoderConfig (sent on every keyframe)
     *
     * Buffer-bloat guard: viewers whose videoChannel.bufferedAmount exceeds 2MB
     * are skipped for this frame (they will recover on the next keyframe).
     * Config strings are NEVER dropped (they are short JSON, not video data).
     */
    broadcastFrame(isKey: boolean, timestamp: number, data: Uint8Array, config?: string): void;
    /** Get currently connected viewer count. */
    get viewerCount(): number;
    /** Get all currently connected viewers (read-only). */
    get connectedViewers(): ORPViewer[];
    /**
     * Returns true if the senderId is allowed to attempt.
     * Returns false if they are locked out (too many failed attempts in window).
     */
    private _checkRateLimit;
    private _recordFailedAttempt;
    /**
     * Validates incoming input payload shape and bounds.
     * The host must do this independently of what the client claims to be sending.
     * Returns false (drops the payload) if it fails any check.
     */
    private _validatePayload;
}
export {};
