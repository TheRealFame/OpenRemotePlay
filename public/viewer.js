const urlParams = new URLSearchParams(window.location.search);
let hostUrl = urlParams.get('host') || 'ws://localhost:3000/ws/signaling';
hostUrl = hostUrl.replace('http://', 'ws://').replace('https://', 'wss://');

const ws = new WebSocket(hostUrl);
const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
const canvas = document.getElementById('stream');
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
const overlay = document.getElementById('overlay');
let inputChannel = null;

// --- WebCodecs Video Decoder Setup ---
let decoder = null;
let pendingFrames = [];
let frameRenderLoop = null;

function renderFrames() {
  if (pendingFrames.length > 0) {
    const frame = pendingFrames.shift();
    if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
      canvas.width = frame.displayWidth;
      canvas.height = frame.displayHeight;
    }
    ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
    frame.close();
  }
  frameRenderLoop = requestAnimationFrame(renderFrames);
}

function initDecoder(configStr) {
  if (decoder && decoder.state !== 'closed') decoder.close();
  const config = JSON.parse(configStr);
  
  decoder = new VideoDecoder({
    output: (frame) => {
      pendingFrames.push(frame);
      overlay.innerText = `ORP WebCodecs Live: ${frame.displayWidth}x${frame.displayHeight}`;
    },
    error: (e) => console.error('WebCodecs Decoder Error:', e)
  });
  
  // The host will send configuration matching this schema
  decoder.configure({
    codec: config.codec || 'vp8',
    codedWidth: config.width || 1280,
    codedHeight: config.height || 720,
    optimizeForLatency: true
  });
  
  if (!frameRenderLoop) renderFrames();
}

// --- WebRTC Datachannels ---
pc.ondatachannel = (e) => {
  const channel = e.channel;
  
  // 1. Input Channel
  if (channel.label === 'input') {
    inputChannel = channel;
    channel.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.type === 'rumble') {
        console.log('Haptic Rumble:', data.strong, data.weak);
      }
    };
  }
  
  // 2. WebCodecs Binary Video Channel
  if (channel.label === 'webcodecs') {
    channel.binaryType = 'arraybuffer';
    channel.onmessage = (msg) => {
      const buffer = msg.data;
      const view = new Uint8Array(buffer);
      const chunkType = view[0];

      if (chunkType === 0x00) {
        // Configuration Chunk
        const configStr = new TextDecoder().decode(buffer.slice(1));
        initDecoder(configStr);
      } else {
        // Encoded Video Chunk (0x01 = key, 0x02 = delta)
        if (!decoder || decoder.state !== 'configured') return;
        
        const type = (chunkType === 0x01) ? 'key' : 'delta';
        const timestamp = new DataView(buffer).getBigUint64(1, true); // Next 8 bytes
        const chunkData = buffer.slice(9);
        
        decoder.decode(new EncodedVideoChunk({
          type: type,
          timestamp: Number(timestamp), // microseconds
          data: chunkData
        }));
      }
    };
  }
};

// --- Audio Routing (Native WebRTC Track) ---
pc.ontrack = (e) => {
  // Audio is still sent via standard RTP
  if (e.track.kind === 'audio') {
    const audioEl = document.createElement('audio');
    audioEl.srcObject = e.streams[0];
    audioEl.autoplay = true;
    document.body.appendChild(audioEl);
  }
};

// --- Signaling Handshake ---
ws.onopen = () => ws.send(JSON.stringify({ type: 'request-offer', viewerId: 'orp-client-wc' }));

ws.onmessage = async (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'offer') {
    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: msg.sdp }));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    ws.send(JSON.stringify({ type: 'answer', sdp: answer.sdp }));
  } else if (msg.type === 'ice-candidate') {
    await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
  }
};

pc.onicecandidate = (e) => {
  if (e.candidate) ws.send(JSON.stringify({ type: 'ice-candidate', candidate: e.candidate }));
};

// --- Gamepad Telemetry ---
function sendGamepadState() {
  if (inputChannel && inputChannel.readyState === 'open') {
    const pad = navigator.getGamepads()[0];
    if (pad) {
      let buttons = 0;
      if (pad.buttons[0]?.pressed) buttons |= 0x0001; // A
      if (pad.buttons[1]?.pressed) buttons |= 0x0002; // B
      if (pad.buttons[2]?.pressed) buttons |= 0x0004; // X
      if (pad.buttons[3]?.pressed) buttons |= 0x0008; // Y
      
      inputChannel.send(JSON.stringify({
        type: 'gamepad',
        pad_id: 'orp-client-wc',
        buttons: buttons,
        lx: pad.axes[0] || 0,
        ly: pad.axes[1] || 0,
        rx: pad.axes[2] || 0,
        ry: pad.axes[3] || 0,
        lt: pad.buttons[6]?.value || 0,
        rt: pad.buttons[7]?.value || 0
      }));
    }
  }
  requestAnimationFrame(sendGamepadState);
}
requestAnimationFrame(sendGamepadState);
