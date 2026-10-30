/**
 * ORP Protocol Conformance & Compliance Test Runner
 * Validates any running ORP host or signaling server against the ORP v2 Specification.
 *
 * Usage:
 *   node test/conformance.test.mjs [--target ws://localhost:3001/signaling]
 */

import { WebSocket } from 'ws';
import http from 'http';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemasDir = path.join(__dirname, '../spec/schemas');

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const envelopeSchema = JSON.parse(fs.readFileSync(path.join(schemasDir, 'envelope.schema.json'), 'utf-8'));
const validateEnvelope = ajv.compile(envelopeSchema);

// Parse CLI flags
const targetArg = process.argv.find(arg => arg.startsWith('--target='));
const SIGNALING_URL = targetArg ? targetArg.split('=')[1] : 'ws://localhost:3001/signaling';

let passed = 0;
let failed = 0;

function assert(condition, label, specRef = '') {
  const ref = specRef ? ` [${specRef}]` : '';
  if (condition) {
    console.log(`  ✓ PASS${ref}: ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL${ref}: ${label}`);
    failed++;
  }
}

// Auto-start server if testing locally and server is not up
await import('../server.js').catch(() => null);
await new Promise(r => setTimeout(r, 600));

console.log('\n========================================================');
console.log('       Open Remote Play (ORP) Conformance Suite         ');
console.log('========================================================');
console.log(`Target Endpoint: ${SIGNALING_URL}\n`);

// ─── Test Group 1: Signaling Transport & Handshake ────────────────────────────
console.log('--- 1. Transport & Handshake Conformance ---');

const test1 = await new Promise(resolve => {
  const ws = new WebSocket(SIGNALING_URL);
  ws.onopen = () => { ws.close(); resolve(true); };
  ws.onerror = () => resolve(false);
  setTimeout(() => resolve(false), 2500);
});
assert(test1, 'Signaling server accepts standard WebSocket connections', 'ORP_SPEC §1.1');

// ─── Test Group 2: Host Session Registration ──────────────────────────────────
console.log('\n--- 2. Session Lifecycle Conformance ---');

const sessionId = 'conf-sess-' + Date.now();
const test2 = await new Promise(resolve => {
  const ws = new WebSocket(SIGNALING_URL);
  ws.onopen = () => ws.send(JSON.stringify({ type: 'host-announce', sessionId }));
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'session-ready' && msg.sessionId === sessionId) {
        ws.close();
        resolve(true);
      }
    } catch (_) { resolve(false); }
  };
  ws.onerror = () => resolve(false);
  setTimeout(() => resolve(false), 2500);
});
assert(test2, 'Host receives session-ready acknowledgement with matching sessionId', 'SPEC-SIGNALING §3.1');

// ─── Test Group 3: Protocol Version Gate (v: 2) ────────────────────────────────
console.log('\n--- 3. Protocol Versioning & Envelope Conformance ---');

const vGateSessionId = 'vgate-sess-' + Date.now();
const test3 = await new Promise(resolve => {
  const hostWs = new WebSocket(SIGNALING_URL);
  hostWs.onopen = () => hostWs.send(JSON.stringify({ type: 'host-announce', sessionId: vGateSessionId }));
  hostWs.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'session-ready') {
      // Connect viewer with obsolete v: 1 envelope
      const viewerWs = new WebSocket(SIGNALING_URL);
      viewerWs.onopen = () => {
        viewerWs.send(JSON.stringify({
          v: 1, // Invalid protocol version
          type: 'join',
          senderId: 'v1-viewer',
          sessionId: vGateSessionId,
          sig: '0'.repeat(64),
          ts: Date.now()
        }));
      };
      // Host should NOT receive the obsolete v:1 envelope
      hostWs.onmessage = (ev2) => {
        const msg2 = JSON.parse(ev2.data);
        if (msg2.v !== 2) {
          hostWs.close();
          resolve(false); // Failed: forwarded invalid version
        }
      };
      // If host didn't get it after 1s, it correctly blocked it
      setTimeout(() => {
        hostWs.close();
        viewerWs.close();
        resolve(true);
      }, 1000);
    }
  };
  hostWs.onerror = () => resolve(false);
});
assert(test3, 'Server enforces v: 2 protocol gate and drops non-v2 envelopes', 'SPEC-SIGNALING §3.2');

// ─── Test Group 4: Signaling Message Routing ──────────────────────────────────
console.log('\n--- 4. Signaling Envelope Routing ---');

const routeSessionId = 'route-sess-' + Date.now();
const test4 = await new Promise(resolve => {
  const hostWs = new WebSocket(SIGNALING_URL);
  hostWs.onopen = () => hostWs.send(JSON.stringify({ type: 'host-announce', sessionId: routeSessionId }));
  hostWs.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'session-ready') {
      const viewerWs = new WebSocket(SIGNALING_URL);
      const testEnvelope = {
        v: 2,
        type: 'join',
        senderId: 'conformance-viewer',
        sessionId: routeSessionId,
        sig: 'f'.repeat(64),
        ts: Date.now(),
        displayName: 'Conformance Runner',
        topology: 'mesh'
      };
      viewerWs.onopen = () => viewerWs.send(JSON.stringify(testEnvelope));

      hostWs.onmessage = (evHost) => {
        const forwarded = JSON.parse(evHost.data);
        if (forwarded.senderId === 'conformance-viewer' && validateEnvelope(forwarded)) {
          hostWs.close();
          viewerWs.close();
          resolve(true);
        }
      };
    }
  };
  hostWs.onerror = () => resolve(false);
  setTimeout(() => resolve(false), 3000);
});
assert(test4, 'Peer join envelope is validated and routed to the correct host session', 'ORP_SPEC §1.3');

// ─── Test Group 5: Non-Existent Session Handling ──────────────────────────────
console.log('\n--- 5. Error & Fallback Conformance ---');

const test5 = await new Promise(resolve => {
  const viewerWs = new WebSocket(SIGNALING_URL);
  viewerWs.onopen = () => viewerWs.send(JSON.stringify({
    v: 2,
    type: 'join',
    senderId: 'lost-viewer',
    sessionId: 'non-existent-session-12345',
    sig: '0'.repeat(64),
    ts: Date.now()
  }));
  viewerWs.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'error' && (msg.code === 'SESSION_NOT_FOUND' || msg.error)) {
        viewerWs.close();
        resolve(true);
      }
    } catch (_) { resolve(false); }
  };
  viewerWs.onerror = () => resolve(false);
  setTimeout(() => resolve(false), 2000);
});
assert(test5, 'Requests to non-existent sessions return standardized error responses', 'SPEC-SIGNALING §3');

console.log('\n========================================================');
console.log(`Conformance Suite Completed: ${passed} passed, ${failed} failed`);
console.log('========================================================\n');

process.exit(failed > 0 ? 1 : 0);
