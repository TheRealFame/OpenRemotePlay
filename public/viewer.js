const urlParams = new URLSearchParams(window.location.search);
let roomCode = urlParams.get('code') || urlParams.get('pin');

if (!roomCode) {
  roomCode = window.prompt("Enter the 12-character P2P Room Code:");
}

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
  
  decoder.configure({
    codec: config.codec || 'vp8',
    codedWidth: config.width || 1280,
    codedHeight: config.height || 720,
    optimizeForLatency: true
  });
  
  if (!frameRenderLoop) renderFrames();
}

// --- ORP v2 Setup ---
if (roomCode) {
  const orpClient = new ORP.ORPClient({ pin: roomCode, displayName: 'Standalone Viewer' });

  orpClient.on('datachannel', (channel) => {
    // 1. Input Channel
    if (channel.label === 'orp-input' || channel.label === 'input') {
      inputChannel = channel;
      channel.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data.type === 'rumble') {
            console.log('Haptic Rumble:', data.strong, data.weak);
          }
        } catch (e) {}
      };
    }
    
    // 2. WebCodecs Binary Video Channel
    if (channel.label === 'orp-video' || channel.label === 'webcodecs') {
      channel.binaryType = 'arraybuffer';
      channel.onmessage = (msg) => {
        const buffer = msg.data;
        const view = new Uint8Array(buffer);
        const chunkType = view[0];

        if (chunkType === 0x00) {
          const configStr = new TextDecoder().decode(buffer.slice(1));
          initDecoder(configStr);
        } else {
          if (!decoder || decoder.state !== 'configured') return;
          
          const type = (chunkType === 0x01) ? 'key' : 'delta';
          const timestamp = new DataView(buffer).getBigUint64(1, true);
          const chunkData = buffer.slice(9);
          
          decoder.decode(new EncodedVideoChunk({
            type: type,
            timestamp: Number(timestamp),
            data: chunkData
          }));
        }
      };
    }
  });

  orpClient.on('timing', (t) => {
    if (t.outcome === 'success') {
      overlay.innerText = 'Connected! Waiting for WebCodecs config...';
    } else if (t.outcome === 'failed') {
      overlay.innerText = `Connection failed: ${t.failureReason}`;
    }
  });
  
  orpClient.on('stream', (stream) => {
    // Fallback for native tracks (audio)
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length > 0) {
        const audioEl = document.createElement('audio');
        audioEl.srcObject = new MediaStream([audioTracks[0]]);
        audioEl.autoplay = true;
        document.body.appendChild(audioEl);
    }
  });

  ORP.ORPNostrSession.create(roomCode).then(session => {
    orpClient.connect(session);
  });
}

// --- Gamepad Telemetry ---
function sendGamepadState() {
  if (inputChannel && inputChannel.readyState === 'open') {
    const pad = navigator.getGamepads()[0];
    if (pad) {
      let buttons = 0;
      if (pad.buttons[0]?.pressed) buttons |= 0x0001;
      if (pad.buttons[1]?.pressed) buttons |= 0x0002;
      if (pad.buttons[2]?.pressed) buttons |= 0x0004;
      if (pad.buttons[3]?.pressed) buttons |= 0x0008;
      
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
