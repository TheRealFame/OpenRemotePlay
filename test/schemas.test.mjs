/**
 * ORP JSON Schema Conformance Test Suite
 * Validates spec/schemas/*.schema.json against valid & invalid test vectors.
 * Run: node test/schemas.test.mjs
 */

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemasDir = path.join(__dirname, '../spec/schemas');

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

console.log('\n[ORP Schema Test] Validating JSON Schema Registry...\n');

// ─── 1. Envelope Schema ────────────────────────────────────────────────────────
console.log('§ 1. Signaling Envelope Schema (envelope.schema.json)');
const envelopeSchema = JSON.parse(fs.readFileSync(path.join(schemasDir, 'envelope.schema.json'), 'utf-8'));
const validateEnvelope = ajv.compile(envelopeSchema);

// Valid join envelope
const validJoin = {
  v: 2,
  type: 'join',
  senderId: 'usr-f4a38b29',
  sessionId: 'sess-987123abcdef',
  sig: 'a'.repeat(64),
  ts: 1729000000000,
  displayName: 'Player One',
  color: '#c084fc',
  topology: 'mesh'
};
assert(validateEnvelope(validJoin), 'Valid v2 join envelope passes');

// Valid offer envelope
const validOffer = {
  v: 2,
  type: 'offer',
  senderId: 'host-0',
  sessionId: 'sess-987123abcdef',
  sig: 'b'.repeat(64),
  ts: 1729000000000,
  sdp: 'v=0\r\no=- 123 456 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\n',
  topology: 'star'
};
assert(validateEnvelope(validOffer), 'Valid v2 offer envelope with SDP passes');

// Invalid: Protocol version !== 2
const invalidVersion = { ...validJoin, v: 1 };
assert(!validateEnvelope(invalidVersion), 'Rejects envelope where v !== 2');

// Invalid: Missing signature
const missingSig = { ...validJoin };
delete missingSig.sig;
assert(!validateEnvelope(missingSig), 'Rejects envelope without sig');

// Invalid: Bad signature format (not 64-char hex)
const badSig = { ...validJoin, sig: 'short-sig' };
assert(!validateEnvelope(badSig), 'Rejects non-hex/malformed sig');

// ─── 2. Host Manifest Schema ──────────────────────────────────────────────────
console.log('\n§ 2. Host Manifest Schema (manifest.schema.json)');
const manifestSchema = JSON.parse(fs.readFileSync(path.join(schemasDir, 'manifest.schema.json'), 'utf-8'));
const validateManifest = ajv.compile(manifestSchema);

const validManifest = {
  protocol_version: '1.0.0',
  orp_version: 2,
  engine: 'webrtc-nearcade',
  name: "Fame's Arcade",
  features: ['core:gamepad', 'core:webrtc', 'ext:webcodecs', 'ext:rumble'],
  session_id: 'sess-987123abcdef',
  signaling_url: 'ws://127.0.0.1:3001/signaling',
  topology: 'mesh',
  max_viewers: 4
};
assert(validateManifest(validManifest), 'Valid host manifest passes');

const invalidManifest = { ...validManifest };
delete invalidManifest.signaling_url;
assert(!validateManifest(invalidManifest), 'Rejects manifest missing signaling_url');

// ─── 3. Gamepad Input Schema ──────────────────────────────────────────────────
console.log('\n§ 3. Gamepad Input Schema (input-gamepad.schema.json)');
const gamepadSchema = JSON.parse(fs.readFileSync(path.join(schemasDir, 'input-gamepad.schema.json'), 'utf-8'));
const validateGamepad = ajv.compile(gamepadSchema);

const makeButtons = () => Array(17).fill(null).map(() => ({ pressed: false, value: 0.0 }));

const validGamepad = {
  type: 'gamepad',
  viewerId: 'usr-f4a38b29',
  pad_id: 'usr-f4a38b29_0',
  padIndex: 0,
  axes: [0.0, 0.0, 0.0, 0.0],
  buttons: makeButtons(),
  seq: 1
};
assert(validateGamepad(validGamepad), 'Valid standard 17-button/4-axis gamepad input passes');

// Tolerant: Gamepad with fewer than 17 buttons (e.g. 8 buttons for retro or mobile) is accepted
const retroButtons = { ...validGamepad, buttons: makeButtons().slice(0, 8) };
assert(validateGamepad(retroButtons), 'Accepts gamepad with fewer than 17 buttons (tolerant reader)');

// Invalid: Empty buttons array
const emptyButtons = { ...validGamepad, buttons: [] };
assert(!validateGamepad(emptyButtons), 'Rejects gamepad with 0 buttons');

// Invalid: Button count exceeding 32
const excessButtons = { ...validGamepad, buttons: Array(33).fill({ pressed: false, value: 0.0 }) };
assert(!validateGamepad(excessButtons), 'Rejects gamepad with > 32 buttons');

// Invalid: axis out of range (-1.0 to 1.0)
const invalidAxis = { ...validGamepad, axes: [1.5, 0.0, 0.0, 0.0] };
assert(!validateGamepad(invalidAxis), 'Rejects axis value exceeding 1.0');

// Invalid: padIndex > 3
const invalidSlot = { ...validGamepad, padIndex: 4 };
assert(!validateGamepad(invalidSlot), 'Rejects padIndex > 3 (max 4 slots)');

// ─── 4. Keyboard & Mouse Input Schemas ─────────────────────────────────────────
console.log('\n§ 4. Keyboard & Mouse Input Schemas');
const kbmKeySchema = JSON.parse(fs.readFileSync(path.join(schemasDir, 'input-keyboard.schema.json'), 'utf-8'));
const validateKey = ajv.compile(kbmKeySchema);

const validKey = {
  type: 'keyboard',
  viewerId: 'usr-f4a38b29',
  event: 'keydown',
  key: 'w',
  code: 'KeyW',
  repeat: false
};
assert(validateKey(validKey), 'Valid keyboard input passes');

const invalidKey = { ...validKey, event: 'keypress' };
assert(!validateKey(invalidKey), 'Rejects invalid keyboard event type');

const mouseSchema = JSON.parse(fs.readFileSync(path.join(schemasDir, 'input-mouse.schema.json'), 'utf-8'));
const validateMouse = ajv.compile(mouseSchema);

const validMouse = {
  type: 'mouse',
  viewerId: 'usr-f4a38b29',
  event: 'mousemove',
  x: 0.5,
  y: 0.5,
  dx: 12.5,
  dy: -4.2
};
assert(validateMouse(validMouse), 'Valid mouse input passes');

// ─── 5. Haptic Rumble & Motion Extensions ─────────────────────────────────────
console.log('\n§ 5. Extension Schemas (Rumble, Motion, WebHID)');
const rumbleSchema = JSON.parse(fs.readFileSync(path.join(schemasDir, 'input-rumble.schema.json'), 'utf-8'));
const validateRumble = ajv.compile(rumbleSchema);

const validRumble = {
  type: 'rumble',
  padIndex: 0,
  weakMagnitude: 0.5,
  strongMagnitude: 0.8,
  duration: 250
};
assert(validateRumble(validRumble), 'Valid haptic rumble packet passes');

const invalidRumble = { ...validRumble, weakMagnitude: 1.5 };
assert(!validateRumble(invalidRumble), 'Rejects rumble intensity > 1.0');

const motionSchema = JSON.parse(fs.readFileSync(path.join(schemasDir, 'input-motion.schema.json'), 'utf-8'));
const validateMotion = ajv.compile(motionSchema);

const validMotion = {
  type: 'motion',
  viewerId: 'usr-f4a38b29',
  padIndex: 0,
  gyro: { x: 0.01, y: -0.02, z: 0.0 },
  accel: { x: 0.0, y: 9.8, z: 0.1 },
  timestamp: 1729000000010
};
assert(validateMotion(validMotion), 'Valid 6-DOF motion packet passes');

const webhidSchema = JSON.parse(fs.readFileSync(path.join(schemasDir, 'input-webhid.schema.json'), 'utf-8'));
const validateWebhid = ajv.compile(webhidSchema);

const validWebhid = {
  type: 'webhid',
  vid: 1356,
  pid: 3302,
  buffer: 'AQIDBA=='
};
assert(validateWebhid(validWebhid), 'Valid raw WebHID packet passes');

// ─── 6. In-Session Renegotiation Schema ────────────────────────────────────────
console.log('\n§ 6. In-Session Renegotiation Schema (renegotiation.schema.json)');
const renegSchema = JSON.parse(fs.readFileSync(path.join(schemasDir, 'renegotiation.schema.json'), 'utf-8'));
const validateReneg = ajv.compile(renegSchema);

const validReneg = {
  type: 'renegotiate',
  action: 'controller-attach',
  padIndex: 1,
  controllerType: 'dualshock'
};
assert(validateReneg(validReneg), 'Valid controller-attach renegotiation passes');

const invalidReneg = {
  type: 'renegotiate',
  action: 'unknown-action'
};
assert(!validateReneg(invalidReneg), 'Rejects unknown renegotiation action');

// ─── 7. Sidecar Daemon IPC Protocol Schema ────────────────────────────────────
console.log('\n§ 7. Sidecar Daemon IPC Protocol Schema (ipc-message.schema.json)');
const ipcSchema = JSON.parse(fs.readFileSync(path.join(schemasDir, 'ipc-message.schema.json'), 'utf-8'));
const validateIpc = ajv.compile(ipcSchema);

const validIpcStartHost = {
  type: 'cmd:start_host',
  roomCode: 'game-room-1234',
  sessionName: 'My Godot Game',
  modalities: ['input', 'video']
};
assert(validateIpc(validIpcStartHost), 'Valid cmd:start_host passes');

const validIpcJoin = {
  type: 'cmd:join',
  roomCode: 'game-room-1234',
  displayName: 'Player 2',
  modalities: ['input']
};
assert(validateIpc(validIpcJoin), 'Valid cmd:join with controller-only modality passes');

const validIpcSendInput = {
  type: 'cmd:send_input',
  padIndex: 0,
  axes: [0.0, -1.0, 0.5, 0.0],
  buttons: [{ pressed: true, value: 1.0 }, { pressed: false, value: 0.0 }]
};
assert(validateIpc(validIpcSendInput), 'Valid cmd:send_input passes');

const validIpcSendRumble = {
  type: 'cmd:send_rumble',
  peerId: 'peer-abc',
  padIndex: 0,
  weakMagnitude: 0.5,
  strongMagnitude: 0.8,
  duration: 250
};
assert(validateIpc(validIpcSendRumble), 'Valid cmd:send_rumble passes');

const validIpcEvtReady = {
  type: 'evt:ready',
  role: 'host',
  roomCode: 'game-room-1234',
  sessionId: 'sess-abc-xyz'
};
assert(validateIpc(validIpcEvtReady), 'Valid evt:ready passes');

const validIpcEvtInput = {
  type: 'evt:input_received',
  peerId: 'peer-abc',
  padIndex: 0,
  axes: [0.0, 0.0, 0.0, 0.0],
  buttons: [{ pressed: false, value: 0.0 }]
};
assert(validateIpc(validIpcEvtInput), 'Valid evt:input_received passes');

const validIpcEvtRumble = {
  type: 'evt:rumble_received',
  padIndex: 0,
  weakMagnitude: 0.5,
  strongMagnitude: 1.0,
  duration: 300
};
assert(validateIpc(validIpcEvtRumble), 'Valid evt:rumble_received passes');

const validIpcEvtError = {
  type: 'evt:error',
  code: 'NETWORK_TIMEOUT',
  message: 'Could not connect to signaling'
};
assert(validateIpc(validIpcEvtError), 'Valid evt:error passes');

// Tolerant reader: extraneous custom fields are permitted
const tolerantIpc = {
  type: 'cmd:send_input',
  padIndex: 0,
  customEngineTimestamp: 98124912,
  batteryLevel: 0.95
};
assert(validateIpc(tolerantIpc), 'Accepts extraneous fields (tolerant reader)');

// Invalid: unknown type discriminator
const invalidIpc = {
  type: 'cmd:unknown_action'
};
assert(!validateIpc(invalidIpc), 'Rejects invalid command type discriminator');

console.log(`\n[ORP Schema Test] Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
