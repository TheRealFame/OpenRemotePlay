<script>
  function showPanel(which) {
    document.getElementById('landing').style.display = 'none';
    document.getElementById('panelHost').classList.remove('active');
    document.getElementById('panelJoin').classList.remove('active');
    document.getElementById('panel' + which.charAt(0).toUpperCase() + which.slice(1)).classList.add('active');
    
    if (which === 'host') {
      // Generate a simple P2P code like Nearcade (peer-xxxx)
      document.getElementById('hostCode').value = 'peer-' + Math.floor(Math.random() * 100000);
    }
  }

  function showLanding() {
    document.getElementById('landing').style.display = 'flex';
    document.getElementById('panelHost').classList.remove('active');
    document.getElementById('panelJoin').classList.remove('active');
  }

  function logHost(msg) { document.getElementById('hostLog').textContent = msg; }
  function logJoin(msg) {
    const logDiv = document.getElementById('joinLog');
    const entry = document.createElement('div');
    entry.textContent = msg;
    logDiv.appendChild(entry);
    logDiv.scrollTop = logDiv.scrollHeight;
  }

  let hostWs = null;
  let orpClient = null;

  function startHost() {
    const code = document.getElementById('hostCode').value;
    const sigUrl = 'ws://localhost:3001/signaling';
    
    logHost('Connecting to signaling server...');
    document.getElementById('btnStartHost').disabled = true;

    if (hostWs) hostWs.close();
    hostWs = new WebSocket(sigUrl);

    hostWs.onopen = () => {
      // Use the P2P code directly as the sessionId
      hostWs.send(JSON.stringify({ type: 'host-announce', sessionId: code }));
      logHost(`Live. Share P2P code: ${code}`);
    };

    hostWs.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'join') {
        logHost(`Viewer joined! DataChannel active.`);
      }
    };

    hostWs.onerror = () => {
      logHost('Error: Could not reach signaling server.');
      document.getElementById('btnStartHost').disabled = false;
    };
  }

  async function startJoin() {
    const code = document.getElementById('joinCode').value.trim();
    const sigUrl = document.getElementById('joinSigUrl').value.trim();

    if (!code) return logJoin('Enter a P2P code.');
    
    logJoin('Connecting...');
    document.getElementById('btnJoin').disabled = true;

    if (orpClient) {
      try { orpClient.disconnect(); } catch(e) {}
    }

    // We pass the raw code as the pin/session identifier
    orpClient = new ORP.ORPClient({ pin: code, displayName: 'Viewer' });

    orpClient.on('timing', (t) => {
      if (t.outcome === 'success') {
        logJoin('Connected successfully. Data channel open.');
      } else if (t.outcome === 'failed') {
        logJoin(`Failed: ${t.failureReason}`);
        document.getElementById('btnJoin').disabled = false;
      }
    });

    orpClient.on('error', (reason, msg) => {
      logJoin(`Error: ${reason} - ${msg}`);
      document.getElementById('btnJoin').disabled = false;
    });

    // Connect using P2P Nostr relays to find the Nearcade host
    const sigSession = await ORP.ORPNostrSession.create(code);
    // (We must call connect() AFTER registering all event listeners below)

    // --- WebCodecs Video Decoder Setup ---
    const canvas = document.getElementById('videoPreview');
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
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
        output: (frame) => pendingFrames.push(frame),
        error: (e) => console.error('WebCodecs Decoder Error:', e)
      });
      
      decoder.configure({
        codec: config.codec || 'vp8',
        codedWidth: config.width || 1280,
        codedHeight: config.height || 720,
        optimizeForLatency: true
      });
      
      if (!frameRenderLoop) renderFrames();
      canvas.style.display = 'block';
    }

    orpClient.on('datachannel', (channel) => {
      console.log('Got datachannel:', channel.label);
      if (channel.label === 'orp-video' || channel.label === 'webcodecs') {
        channel.binaryType = 'arraybuffer';
        channel.onmessage = (msg) => {
          const data = msg.data;
          if (typeof data === 'string') {
            console.log('[WebCodecs] Received string config payload');
            initDecoder(data);
            return;
          }

          const buffer = data;
          const view = new Uint8Array(buffer);
          const chunkType = view[0];

          if (chunkType === 0x00) {
            console.log('[WebCodecs] Received binary config chunk (0x00)');
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

    orpClient.on('stream', (stream) => {
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
          const audioEl = document.createElement('audio');
          audioEl.srcObject = new MediaStream([audioTracks[0]]);
          audioEl.autoplay = true;
          document.body.appendChild(audioEl);
      }
    });

    // NOW that all event listeners are registered, we can connect.
    await orpClient.connect(sigSession).catch(() => {
      document.getElementById('btnJoin').disabled = false;
    });
  }

  // Handle web+orp:// auto-fill
  window.addEventListener('DOMContentLoaded', () => {
    try {
      const target = new URLSearchParams(location.search).get('target');
      if (target) {
        const url = new URL(target.replace(/^web\+orp:\/\//, 'http://'));
        document.getElementById('joinSigUrl').value = `ws://${url.host}/signaling`;
        const code = url.searchParams.get('code') || url.searchParams.get('pin');
        if (code) {
          document.getElementById('joinCode').value = code;
          showPanel('join');
        }
      }
    } catch (e) {}
  });
</script>
</body>
</html>
