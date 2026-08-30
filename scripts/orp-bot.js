/**
 * OpenRemotePlay (ORP) - Node.js Reference Client
 * 
 * Demonstrates the signaling handshake and fast-lane JSON input streaming.
 * Run with: node orp-node-bot.js
 */

const WebSocket = require('ws');
const crypto = require('crypto');

// Nearcade hosts typically listen on 3000
const ORP_HOST = 'ws://127.0.0.1:3000'; 
const MY_ID = 'orp-bot-' + Math.floor(Math.random() * 10000);

let signalingWs = null;
let inputWs = null;
let sessionToken = null;

console.log(`[ORP Client] Starting bot ID: ${MY_ID}`);

// 1. Connect to Signaling Channel
signalingWs = new WebSocket(`${ORP_HOST}/ws/viewer`);

signalingWs.on('open', () => {
    console.log('[ORP Signaling] Connected.');
    
    // Announce identity
    signalingWs.send(JSON.stringify({
        type: 'join',
        viewerId: MY_ID,
        name: 'NodeJS ORP Bot',
        clientVersion: '3.0.6',
        platform: 'node'
    }));
});

signalingWs.on('message', (data) => {
    const msg = JSON.parse(data);
    
    if (msg.type === 'auth-challenge') {
        console.log('[ORP Signaling] Received challenge. Authenticating...');
        const challenge = msg.nonce + "nearcade_client_v3";
        const hash = crypto.createHash('sha256').update(challenge).digest('hex');
        signalingWs.send(JSON.stringify({ type: 'auth-response', hash: hash, human: false }));
    }
    
    if (msg.type === 'your-id') {
        sessionToken = msg.inputToken;
        console.log('[ORP Signaling] Authenticated! Session Token:', sessionToken);
        
        // Announce our virtual controller hardware capability
        signalingWs.send(JSON.stringify({
            type: 'gpid',
            padIndex: 0,
            id: 'Generic X-Box pad',
            name: 'Generic X-Box pad'
        }));
        
        // Open the Fast-Lane Input Socket
        connectInputSocket();
    }
});

function connectInputSocket() {
    // Append the session token to bypass anti-impersonation checks
    inputWs = new WebSocket(`${ORP_HOST}/ws/input?viewerId=${MY_ID}&token=${sessionToken}`);
    
    inputWs.on('open', () => {
        console.log('[ORP Input] Connected. Streaming inputs...');
        startStreaming();
    });
    
    inputWs.on('error', err => console.error('[ORP Input] Error:', err));
}

let tick = 0;
function startStreaming() {
    setInterval(() => {
        tick += 0.05;
        
        // Simulate stick rotation and a button press
        const payload = {
            type: 'gamepad',
            viewerId: MY_ID,
            pad_id: MY_ID + '_0',
            padIndex: 0,
            axes: [Math.sin(tick), Math.cos(tick), 0, 0],
            buttons: Array.from({length: 17}, (_, i) => ({
                pressed: i === 0 ? (Math.sin(tick * 5) > 0) : false,
                value: i === 0 && (Math.sin(tick * 5) > 0) ? 1.0 : 0.0
            }))
        };

        if (inputWs.readyState === WebSocket.OPEN) {
            inputWs.send(JSON.stringify(payload));
        }
    }, 16); // 60Hz Input Loop
}
