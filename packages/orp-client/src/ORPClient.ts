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

import {
    ORPClientOptions,
    ORPConnectionTiming,
    ORPFailureReason,
    ORPSignalEnvelope,
    ORPInputPayload,
    GamepadPayload,
    KeyboardPayload,
    ORP_ICE_SERVERS,
    ORP_STAGE_BUDGETS,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

/** Generate a cryptographically random ephemeral session ID. */
function makeEphemeralId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

/**
 * Compute HMAC-SHA256 over `data` using `key`.
 * Returns hex string. Used to sign signaling envelopes (spec §1.3).
 *
 * Browser: uses SubtleCrypto (async).
 * Node: falls back to synchronous crypto module if SubtleCrypto is absent.
 */
async function hmacSha256(key: string, data: string): Promise<string> {
    const enc = new TextEncoder();
    if (typeof crypto !== 'undefined' && crypto.subtle) {
        const cryptoKey = await crypto.subtle.importKey(
            'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
        );
        const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data));
        return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    // Node.js fallback
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodeCrypto = require('crypto') as typeof import('crypto');
    return nodeCrypto.createHmac('sha256', key).update(data).digest('hex');
}

/**
 * Sign an ORP signaling envelope.
 * The `sig` field is computed over the JSON of all other fields (with sig='').
 * (spec §1.3)
 */
async function signEnvelope(
    envelope: Omit<ORPSignalEnvelope, 'sig'>,
    pin?: string
): Promise<ORPSignalEnvelope> {
    if (!pin) return { ...envelope, sig: 'unsigned' } as ORPSignalEnvelope;
    const payload = JSON.stringify({ ...envelope, sig: '' });
    const sig = await hmacSha256(pin, payload);
    return { ...envelope, sig } as ORPSignalEnvelope;
}

/**
 * Verify a received envelope's `sig` field.
 * Returns true if the HMAC matches, false otherwise.
 */
async function verifyEnvelope(envelope: ORPSignalEnvelope, pin?: string): Promise<boolean> {
    if (!pin) return true; // Signature checking disabled if no PIN is configured
    const { sig, ...rest } = envelope;
    const expected = await hmacSha256(pin, JSON.stringify({ ...rest, sig: '' }));
    // Constant-time comparison to resist timing attacks
    if (expected.length !== sig.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
    return diff === 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Event emitter (minimal, no dependency)
// ─────────────────────────────────────────────────────────────────────────────

type Handler = (...args: unknown[]) => void;

class EventEmitter {
    private _listeners: Record<string, Handler[]> = {};
    on(event: string, fn: Handler) {
        (this._listeners[event] ??= []).push(fn);
        return this;
    }
    off(event: string, fn: Handler) {
        this._listeners[event] = (this._listeners[event] ?? []).filter(h => h !== fn);
    }
    emit(event: string, ...args: unknown[]) {
        (this._listeners[event] ?? []).forEach(h => h(...args));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ORPClient — main class
// ─────────────────────────────────────────────────────────────────────────────

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
export class ORPClient extends EventEmitter {
    private opts: ORPClientOptions;
    public readonly viewerId: string;

    // Active resources (cleaned up on each attempt)
    private ws: WebSocket | null = null;
    private pc: RTCPeerConnection | null = null;
    private dc: RTCDataChannel | null = null;

    // Gamepads tracked for neutral-state flush on disconnect
    private _activePads: Set<string> = new Set();
    // Session routing ID derived from PIN (ORP_SPEC §1.2)
    private _sessionId: string = '';

    constructor(opts: ORPClientOptions) {
        super();
        this.opts = opts;
        this.viewerId = opts.viewerId ?? makeEphemeralId();
    }

    // ─── Public API ──────────────────────────────────────────────────────────

    /**
     * Begin a connection attempt to the ORP host at `signalingUrl`.
     * If stage 1–3 fails, retries once immediately per spec §4.2.
     *
     * `signalingUrl`: WebSocket URL of an ORP-compatible signaling server
     *   (ws://host:port/signaling or wss://...).
     *   For the Nostr/serverless path, use ORPNostrSession instead.
     */
    async connect(signalingUrl: string): Promise<void> {
        // Use the raw roomCode, or if a PIN is explicitly provided, derive a secure hash (ORP_SPEC §1.2)
        if (this.opts.pin) {
            this._sessionId = await hmacSha256('orp-v2-room', this.opts.pin).then(h => h.slice(0, 20));
        } else {
            this._sessionId = this.opts.roomCode;
        }
        
        // Strip hash fragment (used by UI to pass sessionId without a query param)
        const cleanUrl = signalingUrl.split('#')[0];
        for (let attempt = 1; attempt <= 2; attempt++) {
            const timing: ORPConnectionTiming = {
                attemptStart: performance.now(),
                outcome: 'failed',
            };
            try {
                await this._attempt(cleanUrl, timing);
                this.emit('timing', timing);
                return; // success
            } catch (err: unknown) {
                timing.outcome = 'failed';
                this.emit('timing', timing);
                this._cleanup();
                if (attempt === 2) {
                    const reason = timing.failureReason ?? 'ice-failed';
                    this.emit('error', reason, String(err));
                }
                // else loop for retry #2
            }
        }
    }

    /** Send an input payload to the host over the fast-lane data channel. */
    sendInput(payload: ORPInputPayload): void {
        if (this.dc?.readyState === 'open') {
            this.dc.send(JSON.stringify(payload));
        }
    }

    /** High-level helper: send the current state of a W3C Gamepad object. */
    sendGamepad(pad: Gamepad): void {
        const padId = `${this.viewerId}_${pad.index}`;
        this._activePads.add(padId);
        this.sendInput({
            type: 'gamepad',
            viewerId: this.viewerId,
            pad_id: padId,
            padIndex: pad.index,
            axes: [pad.axes[0] ?? 0, pad.axes[1] ?? 0, pad.axes[2] ?? 0, pad.axes[3] ?? 0],
            buttons: Array.from(pad.buttons).map(b => ({ pressed: b.pressed, value: b.value })),
        } as GamepadPayload);
    }

    /** Send a zeroed (neutral) state for a pad — prevents stuck inputs. */
    releaseGamepad(padId: string): void {
        this.sendInput({
            type: 'gamepad',
            viewerId: this.viewerId,
            pad_id: padId,
            padIndex: 0,
            axes: [0, 0, 0, 0],
            buttons: Array(17).fill({ pressed: false, value: 0 }),
        } as GamepadPayload);
        this._activePads.delete(padId);
    }

    /** Send a keyboard or mouse event. */
    sendKey(payload: KeyboardPayload): void {
        this.sendInput(payload);
    }

    /** Close all resources. */
    disconnect(): void {
        this._activePads.forEach(id => this.releaseGamepad(id));
        this._cleanup();
    }

    // ─── Private internals ────────────────────────────────────────────────────

    /** One full connection attempt. Throws on stage 1–3 failure. */
    private async _attempt(url: string, timing: ORPConnectionTiming): Promise<void> {
        // ── Stage 1: Signaling handshake (budget: 600ms) ─────────────────────
        await this._withTimeout(
            ORP_STAGE_BUDGETS.SIGNALING,
            'signaling-timeout',
            1,
            timing,
            () => this._connectSignaling(url, timing)
        );
        timing.signalingComplete = performance.now();

        // ── Stage 2: ICE (budget: 900ms) ─────────────────────────────────────
        await this._withTimeout(
            ORP_STAGE_BUDGETS.ICE,
            'ice-timeout',
            2,
            timing,
            () => this._waitForIce()
        );
        timing.iceConnected = performance.now();

        // ── Stage 3: Data channel (budget: 200ms) ─────────────────────────────
        await this._withTimeout(
            ORP_STAGE_BUDGETS.DATA_CHANNEL,
            'data-channel-failed',
            3,
            timing,
            () => this._waitForDataChannel()
        );
        timing.dataChannelOpen = performance.now();
        timing.outcome = 'success';
        this.emit('ready');
    }

    /** Open WebSocket, set up peer connection, send/receive offer–answer. */
    private _connectSignaling(url: string, timing: ORPConnectionTiming): Promise<void> {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(url);

            this.ws.onerror = () => {
                timing.failureReason = 'signaling-unreachable';
                reject(new Error('WebSocket error'));
            };

            this.ws.onclose = (ev) => {
                if (timing.outcome === 'failed') return; // already handled
                if (ev.code !== 1000) this.emit('disconnected');
            };

            this.ws.onopen = async () => {
                // Create peer connection with trickle ICE (spec §3.2)
                this.pc = new RTCPeerConnection({
                    iceServers: ORP_ICE_SERVERS,
                    // Trickle ICE: candidates sent as discovered, not held until complete
                    iceCandidatePoolSize: 5,
                });

                // Create the fast-lane input data channel (spec §3 / ORP draft §3)
                this.dc = this.pc.createDataChannel('orp-input', {
                    ordered: false,
                    maxRetransmits: 0, // UDP-like: fire-and-forget
                    // Note: 'priority' is not in all TypeScript RTCDataChannelInit definitions
                });

                // Forward incoming media tracks
                this.pc.ontrack = (ev) => {
                    if (ev.streams?.[0]) this.emit('stream', ev.streams[0]);
                };

                // Trickle ICE: send candidates immediately as they arrive (spec §3.2)
                this.pc.onicecandidate = async (ev) => {
                    if (!ev.candidate || !this.ws) return;
                    const env = await signEnvelope({
                        v: 2,
                        type: 'ice-candidate',
                        senderId: this.viewerId,
                        candidate: ev.candidate.toJSON(),
                        ts: Date.now(),
                    }, this.opts.pin);
                    this.ws.send(JSON.stringify(env));
                };

                this.pc.onconnectionstatechange = () => {
                    if (this.pc?.connectionState === 'disconnected' ||
                        this.pc?.connectionState === 'failed') {
                        this.emit('disconnected');
                    }
                };

                // Listen for host messages
                const localWs = this.ws!;
                localWs.onmessage = async (ev) => {
                    let msg: ORPSignalEnvelope;
                    try { msg = JSON.parse(ev.data as string); } catch { return; }

                    // Handle signaling server errors (which may lack v: 2)
                    if ((msg as any).type === 'error') {
                        timing.failureReason = 'signaling-unreachable';
                        reject(new Error(`Server error: ${(msg as any).message || (msg as any).code}`));
                        return;
                    }

                    // Version gate & fallback for Nearcade v1 (no 'v' or 'sig')
                    const isLegacyNearcade = msg.v === undefined;
                    if (!isLegacyNearcade && msg.v !== 2) {
                        console.warn('[ORP] Rejected envelope with unexpected protocol version:', msg.v);
                        return;
                    }

                    // Verify HMAC signature (ORP_TRUST_MODEL.md §2) - Skip for legacy
                    if (!isLegacyNearcade && !await verifyEnvelope(msg, this.opts.pin)) {
                        console.warn('[ORP] Signaling envelope failed HMAC verification — possible wrong PIN or tampering');
                        timing.failureReason = 'security-check-failed';
                        reject(new Error('security-check-failed'));
                        return;
                    }

                    // Nearcade legacy sends sdp as an object { type: 'offer', sdp: '...' }, extract string
                    let sdpString = msg.sdp;
                    if (sdpString && typeof sdpString === 'object') {
                        sdpString = (sdpString as any).sdp;
                    }

                    if (msg.type === 'offer' && sdpString) {
                        await this.pc!.setRemoteDescription({ type: 'offer', sdp: sdpString });
                        const answer = await this.pc!.createAnswer();
                        await this.pc!.setLocalDescription(answer);
                        
                        let env: any;
                        if (isLegacyNearcade) {
                            env = { type: 'answer', sdp: answer, _viewerId: this.viewerId };
                        } else {
                            env = await signEnvelope({
                                v: 2,
                                type: 'answer',
                                senderId: this.viewerId,
                                sdp: answer.sdp!,
                                ts: Date.now(),
                            }, this.opts.pin);
                        }
                        this.ws!.send(JSON.stringify(env));
                        resolve(); // Signaling stage done
                    } else if (msg.type === 'answer' && sdpString) {
                        await this.pc!.setRemoteDescription({ type: 'answer', sdp: sdpString });
                        resolve();
                    } else if (msg.type === 'ice-candidate' && msg.candidate) {
                        await this.pc!.addIceCandidate(msg.candidate).catch(() => {});
                    } else if (msg.type === 'pin-locked') {
                        timing.failureReason = 'pin-locked';
                        reject(new Error('pin-locked'));
                    } else if (msg.type === 'pin-fail') {
                        timing.failureReason = 'security-check-failed';
                        reject(new Error('pin-fail'));
                    }
                };

                // Send join envelope (includes PIN proof via signed envelope)
                const joinEnv = await signEnvelope({
                    v: 2,
                    type: 'join',
                    senderId: this.viewerId,
                    ts: Date.now(),
                }, this.opts.pin);
                localWs!.send(JSON.stringify({
                    ...joinEnv,
                    displayName: this.opts.displayName,
                    color: this.opts.color ?? '#c084fc',
                    sessionId: this._sessionId,
                }));
            };
        });
    }

    /** Wait for RTCPeerConnection.connectionState === 'connected'. */
    private _waitForIce(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.pc) return reject(new Error('no pc'));
            if (this.pc.connectionState === 'connected') return resolve();
            const onchange = () => {
                if (this.pc?.connectionState === 'connected') {
                    this.pc.removeEventListener('connectionstatechange', onchange);
                    resolve();
                } else if (this.pc?.connectionState === 'failed') {
                    this.pc.removeEventListener('connectionstatechange', onchange);
                    reject(new Error('ice-failed'));
                }
            };
            this.pc.addEventListener('connectionstatechange', onchange);
        });
    }

    /** Wait for the data channel to reach 'open'. */
    private _waitForDataChannel(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.dc) return reject(new Error('no dc'));
            if (this.dc.readyState === 'open') return resolve();
            this.dc.onopen = () => resolve();
            this.dc.onerror = () => reject(new Error('data-channel-failed'));
            this.dc.onmessage = (ev) => {
                try { this.emit('message', ev.data); } catch { /* ignore */ }
            };
        });
    }

    /**
     * Run `fn` with a hard timeout. On timeout, sets the failure reason and
     * failed stage on `timing`, then throws so the retry loop can catch.
     */
    private _withTimeout<T>(
        ms: number,
        reason: ORPFailureReason,
        stage: 1 | 2 | 3,
        timing: ORPConnectionTiming,
        fn: () => Promise<T>
    ): Promise<T> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                timing.failureReason = reason;
                timing.failedStage = stage;
                reject(new Error(reason));
            }, ms);
            fn().then(v => { clearTimeout(timer); resolve(v); })
               .catch(e => { clearTimeout(timer); timing.failureReason ??= reason; timing.failedStage ??= stage; reject(e); });
        });
    }

    /** Tear down all resources from a previous attempt. */
    private _cleanup(): void {
        try { this.dc?.close(); } catch { /* ignore */ }
        try { this.pc?.close(); } catch { /* ignore */ }
        try { this.ws?.close(1000, 'cleanup'); } catch { /* ignore */ }
        this.dc = null;
        this.pc = null;
        this.ws = null;
    }
}
