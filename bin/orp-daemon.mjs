#!/usr/bin/env node
// OpenRemotePlay (ORP) — Reference Sidecar Daemon (Binary-as-an-SDK)
// Protocol: ORP v2 JSON-Lines over stdin/stdout
// License: MIT

import readline from 'node:readline';
import WebSocket from 'ws';

const VERSION = '2.0.0';

let config = {
  signalingUrl: process.env.ORP_SIGNALING_URL || 'ws://localhost:3001/signaling',
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  modalities: ['input', 'video', 'audio']
};

let activeWs = null;
let sessionState = {
  role: null, // 'host' | 'client' | null
  roomCode: null,
  sessionId: null,
  peerId: null,
  modalities: ['input', 'video', 'audio'],
  connectedPeers: new Map()
};

function emit(evt) {
  process.stdout.write(JSON.stringify(evt) + '\n');
}

function logStderr(msg) {
  process.stderr.write(`[orp-daemon] ${msg}\n`);
}

// Tolerant padding for gamepad inputs
function sanitizeGamepadInput(payload) {
  const padIndex = typeof payload.padIndex === 'number' ? Math.max(0, Math.min(3, payload.padIndex)) : 0;
  
  // Pad axes to minimum 4 axes [LeftX, LeftY, RightX, RightY]
  let axes = Array.isArray(payload.axes) ? payload.axes.slice(0, 4) : [];
  while (axes.length < 4) {
    axes.push(0.0);
  }
  axes = axes.map(a => Math.max(-1.0, Math.min(1.0, Number(a) || 0.0)));

  // Pad buttons to 17 standard W3C buttons if partial array provided
  let buttons = Array.isArray(payload.buttons) ? payload.buttons.slice(0, 32) : [];
  if (buttons.length === 0) {
    buttons = Array(17).fill(null).map(() => ({ pressed: false, value: 0.0 }));
  } else if (buttons.length < 17) {
    while (buttons.length < 17) {
      buttons.push({ pressed: false, value: 0.0 });
    }
  }
  buttons = buttons.map(b => ({
    pressed: Boolean(b?.pressed),
    value: Math.max(0.0, Math.min(1.0, Number(b?.value) || (b?.pressed ? 1.0 : 0.0)))
  }));

  return {
    padIndex,
    axes,
    buttons,
    seq: typeof payload.seq === 'number' ? payload.seq : Date.now()
  };
}

async function handleCommand(cmd) {
  if (!cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string') {
    emit({ type: 'evt:error', code: 'INVALID_COMMAND', message: 'Payload must be a JSON object with a "type" string.' });
    return;
  }

  switch (cmd.type) {
    case 'cmd:init': {
      if (cmd.signalingUrl) config.signalingUrl = cmd.signalingUrl;
      if (Array.isArray(cmd.iceServers)) config.iceServers = cmd.iceServers;
      if (Array.isArray(cmd.modalities)) config.modalities = cmd.modalities;
      emit({
        type: 'evt:status',
        status: 'initialized',
        version: VERSION,
        signalingUrl: config.signalingUrl
      });
      break;
    }

    case 'cmd:start_host': {
      const roomCode = cmd.roomCode || `room-${Math.random().toString(36).slice(2, 8)}`;
      const modalities = Array.isArray(cmd.modalities) ? cmd.modalities : config.modalities;
      
      sessionState.role = 'host';
      sessionState.roomCode = roomCode;
      sessionState.sessionId = roomCode;
      sessionState.modalities = modalities;

      try {
        if (activeWs) {
          activeWs.terminate();
          activeWs = null;
        }

        activeWs = new WebSocket(config.signalingUrl);

        activeWs.on('open', () => {
          logStderr(`Connected to signaling server at ${config.signalingUrl}`);
          // Send announcement envelope v2
          const announceEnv = {
            v: 2,
            type: 'host-announce',
            senderId: `daemon-host-${Math.random().toString(36).slice(2, 7)}`,
            sessionId: sessionState.roomCode,
            roomCode: sessionState.roomCode,
            sig: '0'.repeat(64),
            ts: Date.now(),
            topology: 'mesh',
            modalities: sessionState.modalities
          };
          activeWs.send(JSON.stringify(announceEnv));
        });

        activeWs.on('message', (raw) => {
          try {
            const data = JSON.parse(raw.toString());
            if (data.type === 'session-ready' || (data.status === 'registered' && data.sessionId)) {
              emit({
                type: 'evt:ready',
                role: 'host',
                roomCode: sessionState.roomCode,
                sessionId: sessionState.sessionId,
                modalities: sessionState.modalities
              });
            } else if (data.type === 'join') {
              const viewerId = data.senderId || 'unknown-peer';
              sessionState.connectedPeers.set(viewerId, {
                modalities: data.modalities || ['input', 'video', 'audio']
              });
              emit({
                type: 'evt:peer_joined',
                peerId: viewerId,
                modalities: data.modalities || ['input', 'video', 'audio']
              });
            } else if (data.type === 'input' || data.type === 'gamepad') {
              emit({
                type: 'evt:input_received',
                peerId: data.senderId || data.viewerId || 'peer',
                ...sanitizeGamepadInput(data)
              });
            }
          } catch (e) {
            logStderr(`Failed to parse signaling message: ${e.message}`);
          }
        });

        activeWs.on('error', (err) => {
          emit({
            type: 'evt:error',
            code: 'SIGNALING_ERROR',
            message: err.message
          });
        });

        activeWs.on('close', () => {
          logStderr('Signaling connection closed');
        });
      } catch (err) {
        emit({
          type: 'evt:error',
          code: 'CONNECTION_FAILED',
          message: err.message
        });
      }
      break;
    }

    case 'cmd:join': {
      const roomCode = cmd.roomCode;
      if (!roomCode) {
        emit({ type: 'evt:error', code: 'MISSING_ROOM_CODE', message: 'roomCode is required for cmd:join' });
        return;
      }

      sessionState.role = 'client';
      sessionState.roomCode = roomCode;
      sessionState.peerId = `daemon-client-${Math.random().toString(36).slice(2, 7)}`;
      sessionState.modalities = Array.isArray(cmd.modalities) ? cmd.modalities : ['input'];

      try {
        if (activeWs) {
          activeWs.terminate();
          activeWs = null;
        }

        activeWs = new WebSocket(config.signalingUrl);

        activeWs.on('open', () => {
          const joinEnv = {
            v: 2,
            type: 'join',
            senderId: sessionState.peerId,
            sessionId: sessionState.roomCode,
            sig: '0'.repeat(64),
            ts: Date.now(),
            modalities: sessionState.modalities
          };
          activeWs.send(JSON.stringify(joinEnv));
          emit({
            type: 'evt:ready',
            role: 'client',
            roomCode: sessionState.roomCode,
            peerId: sessionState.peerId,
            modalities: sessionState.modalities
          });
        });

        activeWs.on('message', (raw) => {
          try {
            const data = JSON.parse(raw.toString());
            if (data.type === 'rumble') {
              emit({
                type: 'evt:rumble_received',
                padIndex: data.padIndex || 0,
                weakMagnitude: data.weakMagnitude || 0.0,
                strongMagnitude: data.strongMagnitude || 0.0,
                duration: data.duration || 200
              });
            } else if (data.type === 'error') {
              emit({
                type: 'evt:error',
                code: data.code || 'SESSION_ERROR',
                message: data.message || 'Session error occurred'
              });
            }
          } catch (e) {
            logStderr(`Failed to parse signaling message: ${e.message}`);
          }
        });

        activeWs.on('error', (err) => {
          emit({
            type: 'evt:error',
            code: 'SIGNALING_ERROR',
            message: err.message
          });
        });
      } catch (err) {
        emit({
          type: 'evt:error',
          code: 'CONNECTION_FAILED',
          message: err.message
        });
      }
      break;
    }

    case 'cmd:send_input': {
      const sanitized = sanitizeGamepadInput(cmd);
      if (activeWs && activeWs.readyState === WebSocket.OPEN) {
        activeWs.send(JSON.stringify({
          type: 'input',
          v: 2,
          senderId: sessionState.peerId || 'daemon-client',
          sessionId: sessionState.roomCode,
          ...sanitized
        }));
      }
      break;
    }

    case 'cmd:send_rumble': {
      if (activeWs && activeWs.readyState === WebSocket.OPEN) {
        activeWs.send(JSON.stringify({
          type: 'rumble',
          v: 2,
          peerId: cmd.peerId,
          padIndex: cmd.padIndex || 0,
          weakMagnitude: typeof cmd.weakMagnitude === 'number' ? cmd.weakMagnitude : 0.5,
          strongMagnitude: typeof cmd.strongMagnitude === 'number' ? cmd.strongMagnitude : 0.5,
          duration: typeof cmd.duration === 'number' ? cmd.duration : 200
        }));
      }
      break;
    }

    case 'cmd:stop': {
      if (activeWs) {
        activeWs.terminate();
        activeWs = null;
      }
      sessionState.connectedPeers.clear();
      sessionState.role = null;
      emit({ type: 'evt:status', status: 'stopped' });
      break;
    }

    default:
      emit({
        type: 'evt:error',
        code: 'UNKNOWN_COMMAND',
        message: `Command "${cmd.type}" is not recognized.`
      });
      break;
  }
}

// Stdio JSON-Lines reader
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const cmd = JSON.parse(trimmed);
    handleCommand(cmd);
  } catch (err) {
    emit({
      type: 'evt:error',
      code: 'JSON_PARSE_ERROR',
      message: `Invalid JSON-Lines payload: ${err.message}`
    });
  }
});

rl.on('close', () => {
  if (activeWs) activeWs.terminate();
  process.exit(0);
});

// Initial boot message to announce readiness
emit({
  type: 'evt:status',
  status: 'daemon_started',
  version: VERSION
});
