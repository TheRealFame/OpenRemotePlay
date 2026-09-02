"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ORP_STAGE_BUDGETS = exports.ORP_ICE_SERVERS = void 0;
// ─────────────────────────────────────────────────────────────────────────────
// § 6. ICE server configuration (ORP_SPEC.md §3.1)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Default STUN-only ICE servers.
 * No TURN entries — TURN fallback is explicitly out of scope for ORP v2
 * (ORP_SPEC.md §0 non-goals).
 * Three independent operators for redundancy against single-provider outages.
 */
exports.ORP_ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.nextcloud.com:443' },
];
// ─────────────────────────────────────────────────────────────────────────────
// § 7. Stage time budgets (ORP_SPEC.md §2 table)
// ─────────────────────────────────────────────────────────────────────────────
/** Per-stage timeout budgets in milliseconds. Total: 2000ms. */
exports.ORP_STAGE_BUDGETS = {
    /** Stage 1: Signaling handshake — offer sent and answer received. */
    SIGNALING: 600,
    /** Stage 2: ICE gathering + connectivity checks. */
    ICE: 900,
    /** Stage 3: RTCDataChannel reaches 'open' state. */
    DATA_CHANNEL: 200,
    /** Stage 4: First video frame decoded and rendered (soft budget — degraded, not failed). */
    FIRST_FRAME: 300,
};
