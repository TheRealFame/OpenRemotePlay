/**
 * ORP v2 Sidecar Daemon Integration Test
 * Verifies Binary-as-an-SDK JSON-Lines stdio communication:
 * 1. Process boot & ready handshake
 * 2. Host session creation (cmd:start_host -> evt:ready)
 * 3. Client session join (cmd:join -> evt:ready, evt:peer_joined)
 * 4. Tolerant input telemetry (cmd:send_input -> evt:input_received)
 * 5. Clean teardown (cmd:stop -> evt:status: stopped)
 */

import { spawn } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DAEMON_PATH = path.resolve(__dirname, '../bin/orp-daemon.mjs');

// Ensure signaling server is running
await import('../server.js').catch(() => null);
await new Promise(r => setTimeout(r, 600));

let passed = 0, failed = 0;
function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

console.log('\n[ORP Daemon Test] Testing Binary-as-an-SDK stdio IPC interface...\n');

class DaemonController {
  constructor() {
    this.proc = spawn('node', [DAEMON_PATH], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.rl = readline.createInterface({
      input: this.proc.stdout,
      terminal: false
    });
    this.listeners = [];
    this.rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line.trim());
        for (const fn of this.listeners) {
          fn(msg);
        }
      } catch (err) {
        console.error('Error parsing daemon output:', err, line);
      }
    });
  }

  send(obj) {
    this.proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  waitFor(predicate, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for daemon event after ${timeoutMs}ms`));
      }, timeoutMs);

      const listener = (msg) => {
        if (predicate(msg)) {
          cleanup();
          resolve(msg);
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.listeners = this.listeners.filter(l => l !== listener);
      };

      this.listeners.push(listener);
    });
  }

  kill() {
    this.proc.kill('SIGTERM');
  }
}

try {
  // Test 1: Daemon Startup
  console.log('§ 1. Daemon Boot & Status Verification');
  const hostDaemon = new DaemonController();
  const bootMsg = await hostDaemon.waitFor(m => m.type === 'evt:status' && m.status === 'daemon_started');
  assert(bootMsg.version === '2.0.0', 'Daemon reports version 2.0.0 on boot');

  // Test 2: Initialization command
  console.log('\n§ 2. Configuration Handshake (cmd:init)');
  hostDaemon.send({
    type: 'cmd:init',
    signalingUrl: 'ws://localhost:3001/signaling',
    modalities: ['input', 'video']
  });
  const initMsg = await hostDaemon.waitFor(m => m.type === 'evt:status' && m.status === 'initialized');
  assert(initMsg.signalingUrl === 'ws://localhost:3001/signaling', 'Daemon configures custom signaling URL');

  // Test 3: Host Session Start
  console.log('\n§ 3. Host Session Establishment (cmd:start_host)');
  const testRoom = `test-room-${Date.now().toString(36)}`;
  hostDaemon.send({
    type: 'cmd:start_host',
    roomCode: testRoom,
    modalities: ['input', 'video']
  });
  const readyMsg = await hostDaemon.waitFor(m => m.type === 'evt:ready' && m.role === 'host');
  assert(readyMsg.roomCode === testRoom, 'Host daemon emits evt:ready with correct roomCode');

  // Test 4: Client Connection (cmd:join)
  console.log('\n§ 4. Client Joins Session (cmd:join)');
  const clientDaemon = new DaemonController();
  await clientDaemon.waitFor(m => m.type === 'evt:status' && m.status === 'daemon_started');

  clientDaemon.send({
    type: 'cmd:join',
    roomCode: testRoom,
    modalities: ['input'] // controller-only mode
  });
  const clientReady = await clientDaemon.waitFor(m => m.type === 'evt:ready' && m.role === 'client');
  assert(clientReady.roomCode === testRoom, 'Client daemon emits evt:ready on session join');

  // Verify host received evt:peer_joined
  const peerJoined = await hostDaemon.waitFor(m => m.type === 'evt:peer_joined');
  assert(peerJoined.peerId.length > 0, 'Host receives evt:peer_joined for connected client');
  assert(Array.isArray(peerJoined.modalities) && peerJoined.modalities.includes('input'), 'Host acknowledges controller-only peer modality');

  // Test 5: Input Telemetry Routing & Neutral Fallback
  console.log('\n§ 5. Tolerant Input Forwarding (cmd:send_input)');
  clientDaemon.send({
    type: 'cmd:send_input',
    padIndex: 0,
    axes: [0.5, -0.5], // Partial 2 axes (should be auto-padded to 4)
    buttons: [{ pressed: true, value: 1.0 }] // Partial 1 button (should be auto-padded to 17)
  });

  const inputReceived = await hostDaemon.waitFor(m => m.type === 'evt:input_received');
  assert(inputReceived.axes.length === 4, 'Host receives sanitized input with 4 padded axes');
  assert(inputReceived.axes[0] === 0.5 && inputReceived.axes[1] === -0.5 && inputReceived.axes[2] === 0.0, 'Input axes retain values and pad missing axes with 0.0');
  assert(inputReceived.buttons.length === 17, 'Host receives sanitized input with 17 padded buttons');
  assert(inputReceived.buttons[0].pressed === true && inputReceived.buttons[1].pressed === false, 'First button actuated, remaining buttons neutral');

  // Test 6: Graceful Teardown
  console.log('\n§ 6. Clean Session Teardown (cmd:stop)');
  hostDaemon.send({ type: 'cmd:stop' });
  const stopMsg = await hostDaemon.waitFor(m => m.type === 'evt:status' && m.status === 'stopped');
  assert(stopMsg.status === 'stopped', 'Daemon terminates session cleanly on cmd:stop');

  hostDaemon.kill();
  clientDaemon.kill();

  console.log(`\n[ORP Daemon Test] Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
} catch (err) {
  console.error('\n[ORP Daemon Test] Unexpected test error:', err);
  process.exit(1);
}
