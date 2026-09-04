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

import {
    ORPHostOptions,
    ORPSignalEnvelope,
    ORPInputPayload,
    GamepadPayload,
    ORP_ICE_SERVERS,
    ORP_STAGE_BUDGETS,
    ORPConnectionTiming,
} from './types';

// ─── Utilities (duplicated from ORPClient.ts to keep files self-contained) ──

async function hmacSha256(key: string, data: string): Promise<string> {
    const enc = new TextEncoder();
    if (typeof crypto !== 'undefined' && crypto.subtle) {
        const k = await crypto.subtle.importKey(
            'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
        );
        const sig = await crypto.subtle.sign('HMAC', k, enc.encode(data));
        return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nc = require('crypto') as typeof import('crypto');
    return nc.createHmac('sha256', key).update(data).digest('hex');
}

async function signEnvelope(env: Omit<ORPSignalEnvelope, 'sig'>, pin?: string): Promise<ORPSignalEnvelope> {
    if (!pin) return { ...env, sig: 'unsigned' } as ORPSignalEnvelope;
    const payload = JSON.stringify({ ...env, sig: '' });
    const sig = await hmacSha256(pin, payload);
    return { ...env, sig } as ORPSignalEnvelope;
}

async function verifyEnvelope(env: ORPSignalEnvelope, pin?: string): Promise<boolean> {
    if (!pin) return true; // Signature checking disabled if no PIN is configured
    const { sig, ...rest } = env;
    const expected = await hmacSha256(pin, JSON.stringify({ ...rest, sig: '' }));
    if (expected.length !== sig.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
    return diff === 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

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
    'viewer-left': [string]; // senderId
    'input': [ORPInputPayload, string]; // payload, senderId
    'timing': [ORPConnectionTiming & { senderId: string }];
};

type HostHandler<K extends keyof HostEventMap> = (...args: HostEventMap[K]) => void;

// ─────────────────────────────────────────────────────────────────────────────
// ORPHostSession
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ORPHostSession manages one ORP host session.
 *
 * Usage (browser context, e.g. WebCodecs host page):
 *   const host = new ORPHostSession({ pin: '1234-5678' });
 *   host.on('input', (payload, senderId) => { ... forward to uinput ... });
 *   host.on('viewer-joined', viewer => console.log('New viewer:', viewer.displayName));
 *   // Pass WebSocket connections to host.handleSignalingSocket(ws)
 */
export class ORPHostSession {
    private opts: ORPHostOptions;
    public readonly roomCode: string;
    public readonly pin?: string;

    private viewers: Map<string, ORPViewer> = new Map();

    /** PIN attempt tracking for rate limiting (ORP_TRUST_MODEL.md §3) */
    private pinAttempts: Map<string, { count: number; windowStart: number }> = new Map();
    private readonly maxAttempts: number;
    private readonly WINDOW_MS = 5 * 60 * 1000; // 5 minutes

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _handlers: Record<string, ((...args: any[]) => void)[]> = {};

    constructor(opts: ORPHostOptions) {
        this.opts = opts;
        this.roomCode = opts.roomCode;
        this.pin = opts.pin;
        this.maxAttempts = opts.maxPinAttempts ?? 5;
    }

    // ─── Event emitter ────────────────────────────────────────────────────────

    on<K extends keyof HostEventMap>(event: K, fn: HostHandler<K>): this {
        (this._handlers[event] ??= []).push(fn as (...args: unknown[]) => void);
        return this;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private emit<K extends keyof HostEventMap>(event: K, ...args: any[]): void {
        (this._handlers[event] ?? []).forEach(h => h(...args));
    }

    // ─── Signaling entry point ────────────────────────────────────────────────

    /**
     * Call this for every new viewer WebSocket connection.
     * The host's HTTP/WS server should call this when a new client connects.
     *
     * @param ws - The raw WebSocket for this viewer's signaling channel
     */
    handleSignalingSocket(ws: WebSocket): void {
        const timing: Partial<ORPConnectionTiming> = { attemptStart: performance.now() };
        let senderId: string | null = null;

        ws.addEventListener('message', async (ev: MessageEvent) => {
            let msg: ORPSignalEnvelope & { displayName?: string; color?: string };
            try { msg = JSON.parse(ev.data as string); } catch { return; }

            // Protocol version gate (spec §6)
            if (msg.v !== 2) {
                console.warn('[ORP Host] Rejected non-v2 envelope from', msg.senderId);
                return;
            }

            senderId = msg.senderId;

            // ── Rate limit check before verifying PIN ─────────────────────────
            // We check BEFORE verifying so that even computing a bad HMAC
            // consumes an attempt (prevents computing HMACs in parallel to race).
            if (!this._checkRateLimit(senderId)) {
                // Send pin-locked, then stop responding (spec §3.2: attacker learns nothing)
                const lockEnv = await signEnvelope({ v: 2, type: 'pin-locked', senderId: 'host', ts: Date.now() }, this.pin);
                ws.send(JSON.stringify(lockEnv));
                ws.close(1008, 'rate-limited');
                return;
            }

            // ── Verify HMAC signature (ORP_TRUST_MODEL.md §2) ─────────────────
            const valid = await verifyEnvelope(msg, this.pin);
            if (!valid) {
                this._recordFailedAttempt(senderId);
                const failEnv = await signEnvelope({ v: 2, type: 'pin-fail', senderId: 'host', ts: Date.now() }, this.pin);
                ws.send(JSON.stringify(failEnv));
                return;
            }

            // ── Handle message types ───────────────────────────────────────────
            if (msg.type === 'join') {
                await this._onViewerJoin(senderId, msg.displayName ?? 'Viewer', msg.color ?? '#c084fc', ws, timing);
            } else if (msg.type === 'ice-candidate' && msg.candidate) {
                const viewer = this.viewers.get(senderId);
                if (viewer?.pc) await viewer.pc.addIceCandidate(msg.candidate).catch(() => {});
            } else if (msg.type === 'answer' && msg.sdp) {
                const viewer = this.viewers.get(senderId);
                if (viewer?.pc) {
                    await viewer.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
                    timing.signalingComplete = performance.now();
                }
            }
        });

        ws.addEventListener('close', () => {
            if (senderId) this._removeViewer(senderId);
        });
    }

    // ─── Viewer lifecycle ─────────────────────────────────────────────────────

    private async _onViewerJoin(
        senderId: string,
        displayName: string,
        color: string,
        ws: WebSocket,
        timing: Partial<ORPConnectionTiming>
    ): Promise<void> {
        const pc = new RTCPeerConnection({
            iceServers: ORP_ICE_SERVERS,
            iceCandidatePoolSize: 5,
        });

        // Fast-lane input channel (unreliable, ordered=false = UDP-like)
        const inputChannel = pc.createDataChannel('orp-input', { ordered: false, maxRetransmits: 0 });
        // Video channel for WebCodecs multiplexed frames
        const videoChannel = pc.createDataChannel('orp-video', { ordered: false, maxRetransmits: 0 });
        videoChannel.binaryType = 'arraybuffer';

        const viewer: ORPViewer = {
            senderId, displayName, color,
            pc, inputChannel, videoChannel,
            timing: timing as Partial<ORPConnectionTiming>,
            connectedAt: Date.now(),
        };
        this.viewers.set(senderId, viewer);

        // Trickle ICE: forward candidates to viewer immediately (spec §3.2)
        pc.addEventListener('icecandidate', async (ev) => {
            if (!ev.candidate) return;
            const env = await signEnvelope({
                v: 2, type: 'ice-candidate', senderId: 'host',
                candidate: ev.candidate.toJSON(), ts: Date.now(),
            }, this.pin);
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(env));
        });

        pc.addEventListener('connectionstatechange', () => {
            if (pc.connectionState === 'connected') {
                viewer.timing.iceConnected = performance.now();
                this.emit('viewer-joined', viewer);
            } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                this._removeViewer(senderId);
            }
        });

        // Receive input payloads from viewer
        inputChannel.addEventListener('message', (ev: MessageEvent) => {
            let payload: ORPInputPayload;
            try { payload = JSON.parse(ev.data as string); } catch { return; }
            // Validate shape before passing to application code (ORP_TRUST_MODEL.md §4)
            if (this._validatePayload(payload)) this.emit('input', payload, senderId);
        });

        inputChannel.addEventListener('open', () => {
            viewer.timing.dataChannelOpen = performance.now();
        });

        // Generate offer and send to viewer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const offerEnv = await signEnvelope({
            v: 2, type: 'offer', senderId: 'host', sdp: offer.sdp!, ts: Date.now(), topology: 'mesh',
        }, this.pin);
        ws.send(JSON.stringify(offerEnv));
    }

    private _removeViewer(senderId: string): void {
        const v = this.viewers.get(senderId);
        if (v) {
            try { v.inputChannel?.close(); } catch { /* ignore */ }
            try { v.videoChannel?.close(); } catch { /* ignore */ }
            try { v.pc.close(); } catch { /* ignore */ }
            this.viewers.delete(senderId);
            this.emit('viewer-left', senderId);
        }
    }

    // ─── Video multiplexing ───────────────────────────────────────────────────

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
    broadcastFrame(isKey: boolean, timestamp: number, data: Uint8Array, config?: string): void {
        const header = new ArrayBuffer(9);
        const view = new DataView(header);
        view.setUint8(0, isKey ? 0x01 : 0x02);
        view.setBigUint64(1, BigInt(Math.round(timestamp)), true);
        const frame = new Uint8Array(9 + data.length);
        frame.set(new Uint8Array(header), 0);
        frame.set(data, 9);

        for (const [, v] of this.viewers) {
            const dc = v.videoChannel;
            if (!dc || dc.readyState !== 'open') continue;

            // Buffer-bloat guard: drop frames for slow viewers, but NEVER drop config (spec note §1)
            const BLOAT_LIMIT = 2 * 1024 * 1024; // 2 MB
            if (dc.bufferedAmount > BLOAT_LIMIT && !isKey) continue;

            // Send config on every keyframe so late-joining viewers can init their decoder
            if (isKey && config) {
                const cfgBytes = new TextEncoder().encode(config);
                const cfgBuf = new Uint8Array(1 + cfgBytes.length);
                cfgBuf[0] = 0x00; // type 0 = config
                cfgBuf.set(cfgBytes, 1);
                dc.send(cfgBuf.buffer);
            }

            dc.send(frame.buffer);
        }
    }

    /** Get currently connected viewer count. */
    get viewerCount(): number { return this.viewers.size; }

    /** Get all currently connected viewers (read-only). */
    get connectedViewers(): ORPViewer[] { return Array.from(this.viewers.values()); }

    // ─── Rate limiting (ORP_TRUST_MODEL.md §3) ───────────────────────────────

    /**
     * Returns true if the senderId is allowed to attempt.
     * Returns false if they are locked out (too many failed attempts in window).
     */
    private _checkRateLimit(senderId: string): boolean {
        const now = Date.now();
        const record = this.pinAttempts.get(senderId);
        if (!record) return true;
        if (now - record.windowStart > this.WINDOW_MS) {
            this.pinAttempts.delete(senderId); // window expired, reset
            return true;
        }
        return record.count < this.maxAttempts;
    }

    private _recordFailedAttempt(senderId: string): void {
        const now = Date.now();
        const record = this.pinAttempts.get(senderId);
        if (!record || now - record.windowStart > this.WINDOW_MS) {
            this.pinAttempts.set(senderId, { count: 1, windowStart: now });
        } else {
            record.count++;
        }
    }

    // ─── Payload validation (ORP_TRUST_MODEL.md §4) ───────────────────────────

    /**
     * Validates incoming input payload shape and bounds.
     * The host must do this independently of what the client claims to be sending.
     * Returns false (drops the payload) if it fails any check.
     */
    private _validatePayload(payload: ORPInputPayload): boolean {
        if (!payload || typeof payload.type !== 'string') return false;
        if (payload.type === 'gamepad') {
            const gp = payload as GamepadPayload;
            if (!Array.isArray(gp.axes) || gp.axes.length > 4) return false;
            if (!Array.isArray(gp.buttons) || gp.buttons.length > 32) return false;
            for (const a of gp.axes) if (typeof a !== 'number' || a < -1.1 || a > 1.1) return false;
            for (const b of gp.buttons) {
                if (typeof b.value !== 'number' || b.value < 0 || b.value > 1) return false;
            }
        }
        if (payload.type === 'keyboard') {
            const kp = payload as import('./types').KeyboardPayload;
            const validEvents = ['keydown', 'keyup', 'mousemove', 'mousedown', 'mouseup'];
            if (!validEvents.includes(kp.event)) return false;
        }
        if (payload.type === 'controller-connected' || payload.type === 'controller-disconnected') {
            const cp = payload as import('./types').ORPControllerEvent;
            if (cp.v !== 2 || typeof cp.slotId !== 'string' || typeof cp.streamFingerprint !== 'string') return false;
        }
        return true;
    }
}
