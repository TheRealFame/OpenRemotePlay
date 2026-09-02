/**
 * ORP v2 Smoke Test
 * Tests: signaling server starts, WebSocket connects, session routing works.
 * Run: node test/smoke.test.mjs
 */

import http from 'http';
import { WebSocket } from 'ws';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Minimal assertions ───────────────────────────────────────────────────────

let passed = 0, failed = 0;
function assert(condition, label) {
    if (condition) { console.log(`  ✓ ${label}`); passed++; }
    else           { console.error(`  ✗ FAIL: ${label}`); failed++; }
}

// ─── Start the signaling server inline ───────────────────────────────────────

// We use a dynamic import trick to avoid running the listen call in server.js,
// so we spin up our own minimal version for testing.
const PORT = 13971;

const serverModule = await import('../server.js').catch(() => null);
// If server.js exports nothing, we test it via HTTP directly
// The server auto-starts when loaded, so we give it a moment

await new Promise(r => setTimeout(r, 500));

console.log('\n[ORP Smoke Test] Starting tests...\n');

// ─── Test 1: Server health ────────────────────────────────────────────────────

console.log('§ 1. Signaling server reachability');
const serverRunning = await new Promise(resolve => {
    const ws = new WebSocket(`ws://localhost:3001/signaling`);
    ws.onopen  = () => { ws.close(); resolve(true); };
    ws.onerror = () => resolve(false);
    setTimeout(() => resolve(false), 2000);
});
assert(serverRunning, 'WebSocket connects to ws://localhost:3001/signaling');

if (!serverRunning) {
    console.log('\n  [SKIP] Server not running — remaining tests require server.');
    console.log('  Start with: npm start (in tools/open-remote-play)');
    console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
}

// ─── Test 2: Host announces a session ─────────────────────────────────────────

console.log('\n§ 2. Host session announcement');
const sessionId = 'test-session-' + Date.now();
const hostReady = await new Promise(resolve => {
    const ws = new WebSocket('ws://localhost:3001/signaling');
    ws.onopen = () => ws.send(JSON.stringify({ type: 'host-announce', sessionId }));
    ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'session-ready') { ws.close(); resolve(true); }
    };
    ws.onerror = () => resolve(false);
    setTimeout(() => resolve(false), 2000);
});
assert(hostReady, 'Host receives session-ready after announcing');

// ─── Test 3: Viewer join is routed to host ─────────────────────────────────────

console.log('\n§ 3. Viewer join routing');
const joinRouted = await new Promise(resolve => {
    // Host WS
    const hostWs = new WebSocket('ws://localhost:3001/signaling');
    const sid = 'route-test-' + Date.now();
    hostWs.onopen  = () => hostWs.send(JSON.stringify({ type: 'host-announce', sessionId: sid }));
    hostWs.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'session-ready') {
            // Viewer connects and sends join envelope
            const viewerWs = new WebSocket('ws://localhost:3001/signaling');
            viewerWs.onopen = () => viewerWs.send(JSON.stringify({
                v: 2, type: 'join', senderId: 'test-viewer', sessionId: sid,
                sig: 'test-sig', ts: Date.now(), displayName: 'TestViewer'
            }));
        }
        if (msg.type === 'join' && msg.displayName === 'TestViewer') {
            hostWs.close();
            resolve(true);
        }
    };
    hostWs.onerror = () => resolve(false);
    setTimeout(() => resolve(false), 3000);
});
assert(joinRouted, 'Viewer join envelope is forwarded to host');

// ─── Test 4: Unknown session returns error ─────────────────────────────────────

console.log('\n§ 4. Unknown session error');
const unknownSessionErr = await new Promise(resolve => {
    const ws = new WebSocket('ws://localhost:3001/signaling');
    ws.onopen = () => ws.send(JSON.stringify({
        v: 2, type: 'join', senderId: 'viewer-x', sessionId: 'nonexistent-abc123',
        sig: 'x', ts: Date.now()
    }));
    ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'error' && msg.code === 'SESSION_NOT_FOUND') { ws.close(); resolve(true); }
    };
    ws.onerror = () => resolve(false);
    setTimeout(() => resolve(false), 2000);
});
assert(unknownSessionErr, 'Unknown sessionId returns SESSION_NOT_FOUND error');

// ─── Results ──────────────────────────────────────────────────────────────────

console.log(`\n[ORP Smoke Test] Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
