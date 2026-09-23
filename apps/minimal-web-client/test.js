  window.showPanel = function(which) {
    document.getElementById('landing').style.display = 'none';
    document.getElementById('panelHost').classList.remove('active');
    document.getElementById('panelJoin').classList.remove('active');
    document.getElementById('panel' + which.charAt(0).toUpperCase() + which.slice(1)).classList.add('active');
    
    if (which === 'host') {
      document.getElementById('hostCode').value = 'peer-' + Math.floor(Math.random() * 100000);
    }
  };

  window.showLanding = function() {
    document.getElementById('landing').style.display = 'flex';
    document.getElementById('panelHost').classList.remove('active');
    document.getElementById('panelJoin').classList.remove('active');
  };

  window.logHost = function(msg) { 
    document.getElementById('hostLog').textContent = msg; 
  };
  
  window.logJoin = function(msg) {
    const logDiv = document.getElementById('joinLog');
    const entry = document.createElement('div');
    entry.textContent = msg;
    logDiv.appendChild(entry);
    logDiv.scrollTop = logDiv.scrollHeight;
  };

  window.hostWs = null;
  window.orpClient = null;

  window.startHost = function() {
    const code = document.getElementById('hostCode').value;
    const sigUrl = 'ws://localhost:3001/signaling';
    
    window.logHost('Connecting to signaling server...');
    document.getElementById('btnStartHost').disabled = true;

    if (window.hostWs) window.hostWs.close();
    window.hostWs = new WebSocket(sigUrl);

    window.hostWs.onopen = () => {
      window.hostWs.send(JSON.stringify({ type: 'host-announce', sessionId: code }));
      window.logHost(`Live. Share P2P code: ${code}`);
    };

    window.hostWs.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'join') {
        window.logHost(`Viewer joined! DataChannel active.`);
      }
    };

    window.hostWs.onerror = () => {
      window.logHost('Error: Could not reach signaling server.');
      document.getElementById('btnStartHost').disabled = false;
    };
  };

  window.startJoin = async function() {
    const code = document.getElementById('joinCode').value.trim();
    const sigUrl = document.getElementById('joinSigUrl').value.trim();

    if (!code) return window.logJoin('Enter a P2P code.');
    
    window.logJoin('Connecting...');
    document.getElementById('btnJoin').disabled = true;

    if (window.orpClient) {
      try { window.orpClient.disconnect(); } catch(e) {}
    }

    window.orpClient = new ORP.ORPClient({ pin: code, displayName: 'Viewer' });

    window.orpClient.on('timing', (t) => {
      if (t.outcome === 'success') {
        window.logJoin('Connected successfully. Data channel open.');
      } else if (t.outcome === 'failed') {
        window.logJoin(`Failed: ${t.failureReason}`);
        document.getElementById('btnJoin').disabled = false;
      }
    });

    window.orpClient.on('error', (reason, msg) => {
      window.logJoin(`Error: ${reason} - ${msg}`);
      document.getElementById('btnJoin').disabled = false;
    });

    const sigSession = await ORP.ORPNostrSession.create(code);

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
        error: (e) => {
            console.error('WebCodecs Decoder Error:', e);
            window.logJoin(`Decoder Error: ${e.message}`);
        }
      });
      
      try {
          decoder.configure({
            codec: config.codec || 'vp8',
            codedWidth: config.width || 1280,
            codedHeight: config.height || 720,
            optimizeForLatency: true
          });
      } catch (err) {
          console.error("Failed to configure VideoDecoder:", err);
          window.logJoin(`Decoder Config Error: ${err.message}`);
      }
      
      if (!frameRenderLoop) renderFrames();
      canvas.style.display = 'block';
    }

    window.orpClient.on('datachannel', (channel) => {
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
            
            try {
                decoder.decode(new EncodedVideoChunk({
                  type: type,
                  timestamp: Number(timestamp),
                  data: chunkData
                }));
            } catch (err) {
                console.error("Failed to decode frame:", err);
            }
          }
        };
      }
    });

    window.orpClient.on('stream', (stream) => {
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
          const audioEl = document.createElement('audio');
          audioEl.srcObject = new MediaStream([audioTracks[0]]);
          audioEl.autoplay = true;
          document.body.appendChild(audioEl);
      }
    });

    await window.orpClient.connect(sigSession).catch(() => {
      document.getElementById('btnJoin').disabled = false;
    });
  };

  window.addEventListener('DOMContentLoaded', () => {
    try {
      const target = new URLSearchParams(location.search).get('target');
      if (target) {
        const url = new URL(target.replace(/^web\+orp:\/\//, 'http://'));
        document.getElementById('joinSigUrl').value = `ws://${url.host}/signaling`;
        const code = url.searchParams.get('code') || url.searchParams.get('pin');
        if (code) {
          document.getElementById('joinCode').value = code;
          window.showPanel('join');
        }
      }
    } catch (e) {}
  });
