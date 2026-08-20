const logEl = document.getElementById('log');
function log(msg) {
  logEl.innerHTML += `<div>[${new Date().toISOString().substring(11, 19)}] ${msg}</div>`;
  logEl.scrollTop = logEl.scrollHeight;
}

const hostUrl = `ws://${window.location.host}`;
const ws = new WebSocket(hostUrl);
const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
let inputChannel = null;
let wcChannel = null;
let encoder = null;
let frameCount = 0;

// Setup Data Channels
inputChannel = pc.createDataChannel('input', { ordered: false, maxRetransmits: 0, priority: 'high' });
wcChannel = pc.createDataChannel('webcodecs', { ordered: false, maxRetransmits: 0, priority: 'low' });
wcChannel.binaryType = 'arraybuffer';

inputChannel.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'gamepad') {
    // Here a real host would pass this to the kernel (e.g., via Nearcade's uinput backend)
    // We just log occasionally to prevent spam
    if (Math.random() < 0.05) log(`Gamepad Input Received: ${msg.buttons} (X:${msg.lx.toFixed(2)} Y:${msg.ly.toFixed(2)})`);
  }
};

// WebRTC Signaling
ws.onopen = () => log('Connected to signaling server');
ws.onmessage = async (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'request-offer') {
    log('Viewer requested offer. Generating...');
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: 'offer', sdp: offer.sdp }));
  } else if (msg.type === 'answer') {
    log('Received answer from viewer');
    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: msg.sdp }));
  } else if (msg.type === 'ice-candidate') {
    await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
  }
};
pc.onicecandidate = (e) => {
  if (e.candidate) ws.send(JSON.stringify({ type: 'ice-candidate', candidate: e.candidate }));
};

// Screen Capture & VideoEncoder
document.getElementById('startBtn').onclick = async () => {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { width: 1280, height: 720, frameRate: 60 } });
  document.getElementById('preview').srcObject = stream;
  const track = stream.getVideoTracks()[0];
  const processor = new MediaStreamTrackProcessor({ track });
  const reader = processor.readable.getReader();

  log('Screen capture started. Initializing WebCodecs VideoEncoder...');

  // 1. Send Configuration Chunk (0x00)
  const config = { codec: 'vp8', width: 1280, height: 720 };
  
  // 2. Setup Encoder
  encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      if (wcChannel.readyState === 'open') {
        // Send config on keyframes
        if (chunk.type === 'key') {
          const configStr = JSON.stringify(config);
          const configBuf = new Uint8Array(1 + configStr.length);
          configBuf[0] = 0x00; // Type 0 = config
          for (let i = 0; i < configStr.length; i++) configBuf[i + 1] = configStr.charCodeAt(i);
          wcChannel.send(configBuf);
        }

        // Send binary video chunk
        const chunkData = new Uint8Array(chunk.byteLength);
        chunk.copyTo(chunkData);
        
        const buf = new ArrayBuffer(9 + chunkData.length);
        const view = new DataView(buf);
        view.setUint8(0, chunk.type === 'key' ? 0x01 : 0x02);
        view.setBigUint64(1, BigInt(chunk.timestamp), true);
        
        new Uint8Array(buf).set(chunkData, 9);
        wcChannel.send(buf);
        
        frameCount++;
        if (frameCount % 60 === 0) log(`Sent 60 frames. (Type: ${chunk.type})`);
      }
    },
    error: (e) => log(`Encoder Error: ${e.message}`)
  });

  encoder.configure({
    codec: config.codec,
    width: config.width,
    height: config.height,
    hardwareAcceleration: 'prefer-hardware',
    bitrate: 2000000,
    framerate: 60,
    latencyMode: 'realtime'
  });

  // 3. Read frames and encode
  const readFrame = async () => {
    const { done, value: frame } = await reader.read();
    if (done) return;
    if (encoder.state === 'configured') {
      encoder.encode(frame, { keyFrame: frameCount % 60 === 0 });
    }
    frame.close();
    readFrame();
  };
  readFrame();
};
