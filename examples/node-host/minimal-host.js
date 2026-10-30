/**
 * ORP Minimal Node.js Host Example
 * Demonstrates how to announce an ORP host session, respond to preflight manifests,
 * and ingest remote gamepad events from web or native clients.
 *
 * Run: node minimal-host.js
 */

import http from 'http';
import { WebSocket } from 'ws';

const HTTP_PORT = 3000;
const SIGNALING_URL = 'ws://localhost:3001/signaling';
const SESSION_ID = 'host-demo-' + Math.random().toString(36).slice(2, 8);

// ─── 1. HTTP Preflight Server (/api/orp/manifest) ─────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/api/orp/manifest') {
    const manifest = {
      protocol_version: '1.0.0',
      orp_version: 2,
      engine: 'orp-minimal-node',
      name: 'ORP Reference Node Host',
      features: ['core:webrtc', 'core:gamepad', 'core:kbm', 'ext:rumble'],
      session_id: SESSION_ID,
      signaling_url: SIGNALING_URL,
      topology: 'star',
      max_viewers: 4
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(manifest, null, 2));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found. Request /api/orp/manifest for discovery.');
});

server.listen(HTTP_PORT, () => {
  console.log(`[ORP Host] Preflight discovery running at http://localhost:${HTTP_PORT}/api/orp/manifest`);
  console.log(`[ORP Host] Session ID: ${SESSION_ID}`);
  connectSignaling();
});

// ─── 2. Connect to ORP Signaling Server ───────────────────────────────────────
function connectSignaling() {
  console.log(`[ORP Host] Connecting to signaling at ${SIGNALING_URL}...`);
  const ws = new WebSocket(SIGNALING_URL);

  ws.on('open', () => {
    console.log('[ORP Host] Connected to signaling. Registering session...');
    ws.send(JSON.stringify({
      type: 'host-announce',
      sessionId: SESSION_ID
    }));
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'session-ready') {
        console.log(`[ORP Host] Session verified and ready on signaling network!`);
      } else if (msg.type === 'join') {
        console.log(`[ORP Host] Viewer joined: ${msg.displayName || msg.senderId} (${msg.senderId})`);
        console.log(`[ORP Host] Declared topology: ${msg.topology || 'mesh'}`);
      } else if (msg.type === 'gamepad') {
        // Log received gamepad state
        const pressed = (msg.buttons || []).map((b, i) => b.pressed ? i : null).filter(i => i !== null);
        console.log(`[ORP Host] Input from ${msg.viewerId} (Slot ${msg.padIndex}): Axes=${JSON.stringify(msg.axes)} PressedButtons=${JSON.stringify(pressed)}`);
      }
    } catch (e) {
      console.error('[ORP Host] Failed to parse message:', e.message);
    }
  });

  ws.on('error', (err) => {
    console.warn('[ORP Host] Signaling connection error:', err.message);
  });

  ws.on('close', () => {
    console.log('[ORP Host] Signaling disconnected. Reconnecting in 3s...');
    setTimeout(connectSignaling, 3000);
  });
}
