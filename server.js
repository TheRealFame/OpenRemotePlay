/**
 * OpenRemotePlay (ORP) v2 — Signaling Server
 * License: MIT
 *
 * A minimal WebSocket signaling server. Accepts ORP v2 envelopes from
 * host and viewer clients and forwards them to the correct peer.
 *
 * Session management:
 *  - A host registers by connecting and sending a 'host-announce' message
 *    (non-ORP control message, plaintext) with a session ID derived from their PIN.
 *  - Viewers connect and send 'join' ORP envelopes. The server routes them
 *    to the host of that session.
 *  - The server does NOT inspect or verify the HMAC signatures — that is
 *    done peer-to-peer (ORP_TRUST_MODEL.md). The server is a dumb pipe.
 *  - Sessions expire 10 minutes after the host disconnects.
 *
 * Run: node server.js
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3001;

// ─── Static file server ───────────────────────────────────────────────────────

const MIME = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.map': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

/**
 * Sessions: Map<sessionId, { hostWs, viewers: Map<senderId, ws> }>
 * sessionId is a short deterministic ID derived by the host from their PIN.
 * The server doesn't know or verify the PIN — it's just a routing key.
 */
const sessions = new Map();

/** Track which session each ws belongs to, for cleanup on disconnect. */
const wsToSession = new Map(); // ws -> { sessionId, role: 'host'|'viewer', senderId }

const app = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    // ── ORP Manifest endpoint (SPEC-SIGNALING §2) ─────────────────────────────
    // GET /api/orp/manifest — returns host capabilities for auto-resolution
    if (url.pathname === '/api/orp/manifest') {
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        });

        // Build session ID from the active host session (first available),
        // or a placeholder if no host is connected yet.
        const activeSessionId = sessions.size > 0 ? Array.from(sessions.keys())[0] : null;

        res.end(JSON.stringify({
            protocol_version: '1.0',
            orp_version: 2,
            engine: 'webrtc-orp',
            name: process.env.ORP_SESSION_NAME || 'ORP Host',
            features: ['webcodecs', 'gamepad', 'kbm', 'webhid'],
            session_id: activeSessionId,
            signaling_url: `ws://localhost:${PORT}/signaling`,
            viewer_count: activeSessionId ? (sessions.get(activeSessionId)?.viewers?.size ?? 0) : 0,
        }));
        return;
    }

    // ── Static file server for web UI ─────────────────────────────────────────
    // Serve from apps/minimal-web-client/ for the demo UI
    let filePath;
    if (url.pathname.startsWith('/packages/')) {
        filePath = path.join(__dirname, url.pathname);
    } else {
        filePath = path.join(__dirname, 'apps/minimal-web-client', url.pathname === '/' ? '/index.html' : url.pathname);
    }
    const ext = path.extname(filePath);

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
        res.writeHead(200, { 
            'Content-Type': MIME[ext] || 'application/octet-stream',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        res.end(data);
    });
});

// ─── WebSocket signaling server ────────────────────────────────────────────────

const wss = new WebSocket.Server({ server: app, path: '/signaling' });

/**
 * Sessions: Map<sessionId, { hostWs, viewers: Map<senderId, ws> }>
 * sessionId is a short deterministic ID derived by the host from their PIN.
 * The server doesn't know or verify the PIN — it's just a routing key.
 */


wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }

        // ── Host announces a new session (plain control message, not ORP envelope) ──
        if (msg.type === 'host-announce' && msg.sessionId) {
            const sessionId = msg.sessionId;
            if (!sessions.has(sessionId)) {
                sessions.set(sessionId, { hostWs: ws, viewers: new Map() });
            } else {
                sessions.get(sessionId).hostWs = ws;
            }
            wsToSession.set(ws, { sessionId, role: 'host' });
            console.log(`[ORP Signaling] Host registered session: ${sessionId}`);
            ws.send(JSON.stringify({ type: 'session-ready', sessionId }));
            return;
        }

        // ── Viewer join or any ORP envelope directed toward the host ──────────────
        if (msg.v === 2 && msg.type === 'join' && msg.sessionId) {
            const sessionId = msg.sessionId;
            const session = sessions.get(sessionId);
            if (!session) {
                ws.send(JSON.stringify({ type: 'error', code: 'SESSION_NOT_FOUND', message: 'No host active for that session ID. Is the host online?' }));
                return;
            }
            session.viewers.set(msg.senderId, ws);
            wsToSession.set(ws, { sessionId, role: 'viewer', senderId: msg.senderId });
            // Forward join envelope to host
            if (session.hostWs?.readyState === WebSocket.OPEN) {
                session.hostWs.send(raw.toString());
            }
            return;
        }

        // ── ORP envelope forwarding (offer, answer, ice-candidate) ────────────────
        if (msg.v === 2) {
            const meta = wsToSession.get(ws);
            if (!meta) return;
            const session = sessions.get(meta.sessionId);
            if (!session) return;

            if (meta.role === 'host') {
                // Host → specific viewer
                const targetViewer = session.viewers.get(msg.target || msg.senderId);
                // Actually the host sends to a specific viewer via target field
                // Forward to the appropriate viewer
                for (const [viewerId, viewerWs] of session.viewers) {
                    if (msg.target && msg.target !== viewerId) continue;
                    if (viewerWs.readyState === WebSocket.OPEN) {
                        viewerWs.send(raw.toString());
                    }
                }
            } else {
                // Viewer → host
                if (session.hostWs?.readyState === WebSocket.OPEN) {
                    session.hostWs.send(raw.toString());
                }
            }
            return;
        }
    });

    ws.on('close', () => {
        const meta = wsToSession.get(ws);
        if (!meta) return;
        wsToSession.delete(ws);

        const session = sessions.get(meta.sessionId);
        if (!session) return;

        if (meta.role === 'host') {
            console.log(`[ORP Signaling] Host disconnected from session ${meta.sessionId}`);
            // Notify all viewers
            for (const [, viewerWs] of session.viewers) {
                if (viewerWs.readyState === WebSocket.OPEN) {
                    viewerWs.send(JSON.stringify({ type: 'host-left', sessionId: meta.sessionId }));
                }
            }
            // Delete session after brief grace period
            setTimeout(() => sessions.delete(meta.sessionId), 600000); // 10 min
        } else {
            session.viewers.delete(meta.senderId);
            // Notify host that viewer left
            if (session.hostWs?.readyState === WebSocket.OPEN) {
                session.hostWs.send(JSON.stringify({ type: 'viewer-left', senderId: meta.senderId }));
            }
        }
    });

    ws.on('error', (e) => console.error('[ORP Signaling] WS error:', e.message));
});

app.listen(PORT, () => {
    console.log(`[ORP] Signaling server running at http://localhost:${PORT}`);
    console.log(`[ORP] Open http://localhost:${PORT}/ to use the web UI`);
    console.log(`[ORP] WebSocket signaling at ws://localhost:${PORT}/signaling`);
});
