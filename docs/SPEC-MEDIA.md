# ORP SPEC-MEDIA — Media Transport Specification v1.0

> **Status:** Published  
> **Protocol Version:** ORP v1 / v2 compatible  
> **License:** MIT

---

## 1. Overview

ORP Media transport defines how audio and video are streamed from host to viewer(s). ORP strongly recommends the **WebCodecs + DataChannel multiplexing** architecture to enable efficient multi-viewer streaming without a dedicated SFU/MFU server.

---

## 2. Architecture: WebCodecs Star Topology

### 2.1 The Problem with Native WebRTC Media Tracks

Standard WebRTC (`RTCPeerConnection.addTrack()`) requires the browser to:
- Negotiate a separate DTLS + SRTP session per viewer
- Encode the video stream **independently for each peer**

For N viewers, this means N encode operations — prohibitive for self-hosted hosts.

### 2.2 ORP Solution: Single-Encode Multiplexing

```
Host Browser
  ├── capture screen (getDisplayMedia / Tab Capture)
  ├── encode ONCE with VideoEncoder (WebCodecs)
  └── broadcast the encoded chunk bytes to all viewers via DataChannels
      ├── Viewer 1: RTCDataChannel 'orp-video'
      ├── Viewer 2: RTCDataChannel 'orp-video'
      └── Viewer 3: RTCDataChannel 'orp-video'
```

Each viewer decodes independently using `VideoDecoder` (WebCodecs).

This costs the host exactly **one encode operation** regardless of viewer count.

---

## 3. Data Channel Video Protocol

### 3.1 Channel Configuration

```js
const videoChannel = pc.createDataChannel('orp-video', {
  ordered: false,
  maxRetransmits: 0
});
videoChannel.binaryType = 'arraybuffer';
```

Unreliable, unordered: lost video frames are skipped. The decoder discards incomplete frames and waits for the next keyframe to resync.

### 3.2 Packet Format

Every video packet begins with a 9-byte header:

```
Byte  0:    Type flag
              0x00 = VideoDecoderConfig (JSON-encoded string follows)
              0x01 = Keyframe
              0x02 = Delta frame
Bytes 1–8:  Timestamp (f64 LE, microseconds, as from EncodedVideoChunk.timestamp)
Bytes 9+:   Payload
              If type 0x00: UTF-8 JSON string (VideoDecoderConfig)
              If type 0x01/0x02: Raw encoded video bytes
```

### 3.3 Config Distribution

The host MUST prepend a `0x00` config packet before every keyframe. This ensures:
- **Late-joining viewers** receive the config before any video data arrives, allowing their `VideoDecoder` to initialise correctly.
- **Re-negotiation** after a codec change or resolution switch is handled automatically.

If a viewer's DataChannel `bufferedAmount` exceeds **2 MB** (buffer bloat):
- **Delta frames** MUST be dropped for that viewer.
- **Keyframes** MUST still be sent (they are small relative to the benefit of decoder resync).
- **Config packets (0x00)** MUST NEVER be dropped, regardless of buffer state.

> **Rationale:** A viewer that misses its `VideoDecoderConfig` will display a permanent black screen until the stream is restarted. Config packets are tiny (< 1 KB) and skipping them is never worth the tradeoff.

---

## 4. Codec Preferences

### 4.1 Recommended Priority Order

| Priority | Codec | Notes |
|---|---|---|
| 1 | VP9 (profile 0) | Best WebCodecs hardware support; ORP Linux default |
| 2 | AVC / H.264 (Baseline) | Widest compatibility; required for iOS/Safari |
| 3 | AV1 | Future-proof, best quality; hardware support still maturing |

### 4.2 Platform-Specific Notes

- **Linux WebCodecs:** Hardware H.264 encoding via VAAPI is **non-functional** (missing AVCC extradata). Force VP9 on Linux. Custom polyfills are required for dynamic resolution handling.
- **Windows AMD (MediaFoundation):** Known H.264 encoder bugs with certain profiles; test with Baseline profile first.
- **macOS Safari:** Requires H.264 for WebCodecs decode. VP9 decode works in Chrome/Firefox only.

### 4.3 Codec Negotiation

The host advertises supported codecs in the manifest (see `SPEC-SIGNALING.md §2`). Viewers select the highest-priority mutual codec and include their selection in the `join` envelope:

```json
{ ..., "preferredCodec": "vp9" }
```

---

## 5. Audio

### 5.1 Capture

Hosts capture system audio via:
- **Windows:** WASAPI loopback (via `rust_windows_audio` sidecar or Windows `getDisplayMedia` with `audio: true`)
- **Linux:** PulseAudio null-sink + `module-loopback` → captured by `getDisplayMedia` in Electron

### 5.2 Transport

Audio is transported via a standard WebRTC `RTCPeerConnection` audio track (NOT via DataChannel). Each viewer gets their own SRTP audio track since audio is cheap compared to video.

```js
const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
audioStream.getTracks().forEach(t => pc.addTrack(t, audioStream));
```

### 5.3 Audio Sink Routing

Host-side voices in a voice chat system MUST be explicitly routed to the host's hardware output device via `setSinkId()`. Failure to do so will route audio through the virtual PulseAudio sink, causing **infinite echo loops**.

```js
audioElement.setSinkId(hardwareOutputDeviceId);
```

### 5.4 PulseAudio Teardown Order

When stopping the Linux virtual audio engine, modules MUST be unloaded in this order:
1. `module-loopback` — FIRST
2. `null-sink` — SECOND

Reversing this order causes a permanent buzzing sound until the PulseAudio daemon is forcefully killed.

---

## 6. Screen Capture

### 6.1 `getDisplayMedia()` Picker

On Linux and macOS, the system-level screen picker modal is shown automatically by the browser. The custom Electron-based window picker used by Nearcade MUST be bypassed on these platforms.

On Windows, the custom picker may be used.

### 6.2 Resolution & Framerate

Hosts SHOULD request at minimum `{ video: { width: 1280, height: 720, frameRate: 60 } }`. Actual capture resolution is negotiated by the OS/browser.

### 6.3 WebGL Resizing

When resizing a WebGL canvas for WebCodecs output:
1. Use the `VideoFrame.codedWidth` and `VideoFrame.codedHeight` values (hardware dimensions).
2. Re-acquire the WebGL context after resize (`canvas.getContext('webgl2')`) — the browser may invalidate the context.
3. Failure to follow steps 1-2 results in dropped frames and a frozen display.

---

## 7. Latency Targets

| Segment | Target | Notes |
|---|---|---|
| Capture → Encode | < 5 ms | WebCodecs encoder latency mode: `"realtime"` |
| Encode → DataChannel write | < 1 ms | Direct ArrayBuffer pass; no copy |
| DataChannel → Decode | < 5 ms | `VideoDecoder.decode()` is async |
| Decode → Display | < 8 ms | `requestVideoFrameCallback` for precise timing |
| **Total pipeline** | **< 20 ms** | Excluding network RTT |

Network RTT adds the dominant latency. On LAN (< 1 ms RTT), total end-to-end latency of ~20 ms is achievable. WAN requires STUN hole-punching (typical 30–80 ms RTT).
