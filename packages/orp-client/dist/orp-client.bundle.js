/* OpenRemotePlay (ORP) v2 — MIT License — https://github.com/TheRealFame/OpenRemotePlay */
// Shim Node's require() for dead-code Node-only fallback paths in browser bundle
var require = typeof require !== 'undefined' ? require : function(id) {
  if (id === 'crypto') return {}; // SubtleCrypto branch always wins in modern browsers
  throw new Error('[ORP] require() is not supported in browser: ' + id);
};
"use strict";
var ORP = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/index.ts
  var index_exports = {};
  __export(index_exports, {
    ORPClient: () => ORPClient,
    ORPHostSession: () => ORPHostSession,
    ORP_ICE_SERVERS: () => ORP_ICE_SERVERS,
    ORP_STAGE_BUDGETS: () => ORP_STAGE_BUDGETS
  });

  // src/types.ts
  var ORP_ICE_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: "stun:stun.nextcloud.com:443" }
  ];
  var ORP_STAGE_BUDGETS = {
    /** Stage 1: Signaling handshake — offer sent and answer received. */
    SIGNALING: 600,
    /** Stage 2: ICE gathering + connectivity checks. */
    ICE: 900,
    /** Stage 3: RTCDataChannel reaches 'open' state. */
    DATA_CHANNEL: 200,
    /** Stage 4: First video frame decoded and rendered (soft budget — degraded, not failed). */
    FIRST_FRAME: 300
  };

  // src/ORPClient.ts
  function makeEphemeralId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === "x" ? r : r & 3 | 8).toString(16);
    });
  }
  async function hmacSha256(key, data) {
    const enc = new TextEncoder();
    if (typeof crypto !== "undefined" && crypto.subtle) {
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        enc.encode(key),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
      return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    const nodeCrypto = __require("crypto");
    return nodeCrypto.createHmac("sha256", key).update(data).digest("hex");
  }
  async function signEnvelope(envelope, pin) {
    if (!pin) return { ...envelope, sig: "unsigned" };
    const payload = JSON.stringify({ ...envelope, sig: "" });
    const sig = await hmacSha256(pin, payload);
    return { ...envelope, sig };
  }
  async function verifyEnvelope(envelope, pin) {
    if (!pin) return true;
    const { sig, ...rest } = envelope;
    const expected = await hmacSha256(pin, JSON.stringify({ ...rest, sig: "" }));
    if (expected.length !== sig.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
    return diff === 0;
  }
  var EventEmitter = class {
    constructor() {
      this._listeners = {};
    }
    on(event, fn) {
      var _a;
      ((_a = this._listeners)[event] ?? (_a[event] = [])).push(fn);
      return this;
    }
    off(event, fn) {
      this._listeners[event] = (this._listeners[event] ?? []).filter((h) => h !== fn);
    }
    emit(event, ...args) {
      (this._listeners[event] ?? []).forEach((h) => h(...args));
    }
  };
  var ORPClient = class extends EventEmitter {
    constructor(opts) {
      super();
      // Active resources (cleaned up on each attempt)
      this.ws = null;
      this.pc = null;
      this.dc = null;
      // Gamepads tracked for neutral-state flush on disconnect
      this._activePads = /* @__PURE__ */ new Set();
      // Session routing ID derived from PIN (ORP_SPEC §1.2)
      this._sessionId = "";
      this.opts = opts;
      this.viewerId = opts.viewerId ?? makeEphemeralId();
    }
    // ─── Public API ──────────────────────────────────────────────────────────
    /**
     * Begin a connection attempt to the ORP host at `signalingUrl`.
     * If stage 1–3 fails, retries once immediately per spec §4.2.
     *
     * `signalingUrl`: WebSocket URL of an ORP-compatible signaling server
     *   (ws://host:port/signaling or wss://...).
     *   For the Nostr/serverless path, use ORPNostrSession instead.
     */
    async connect(signalingUrl) {
      if (this.opts.pin) {
        this._sessionId = await hmacSha256("orp-v2-room", this.opts.pin).then((h) => h.slice(0, 20));
      } else {
        this._sessionId = this.opts.roomCode;
      }
      const cleanUrl = signalingUrl.split("#")[0];
      for (let attempt = 1; attempt <= 2; attempt++) {
        const timing = {
          attemptStart: performance.now(),
          outcome: "failed"
        };
        try {
          await this._attempt(cleanUrl, timing);
          this.emit("timing", timing);
          return;
        } catch (err) {
          timing.outcome = "failed";
          this.emit("timing", timing);
          this._cleanup();
          if (attempt === 2) {
            const reason = timing.failureReason ?? "ice-failed";
            this.emit("error", reason, String(err));
          }
        }
      }
    }
    /** Send an input payload to the host over the fast-lane data channel. */
    sendInput(payload) {
      var _a;
      if (((_a = this.dc) == null ? void 0 : _a.readyState) === "open") {
        this.dc.send(JSON.stringify(payload));
      }
    }
    /** High-level helper: send the current state of a W3C Gamepad object. */
    sendGamepad(pad) {
      const padId = `${this.viewerId}_${pad.index}`;
      this._activePads.add(padId);
      this.sendInput({
        type: "gamepad",
        viewerId: this.viewerId,
        pad_id: padId,
        padIndex: pad.index,
        axes: [pad.axes[0] ?? 0, pad.axes[1] ?? 0, pad.axes[2] ?? 0, pad.axes[3] ?? 0],
        buttons: Array.from(pad.buttons).map((b) => ({ pressed: b.pressed, value: b.value }))
      });
    }
    /** Send a zeroed (neutral) state for a pad — prevents stuck inputs. */
    releaseGamepad(padId) {
      this.sendInput({
        type: "gamepad",
        viewerId: this.viewerId,
        pad_id: padId,
        padIndex: 0,
        axes: [0, 0, 0, 0],
        buttons: Array(17).fill({ pressed: false, value: 0 })
      });
      this._activePads.delete(padId);
    }
    /** Send a keyboard or mouse event. */
    sendKey(payload) {
      this.sendInput(payload);
    }
    /** Close all resources. */
    disconnect() {
      this._activePads.forEach((id) => this.releaseGamepad(id));
      this._cleanup();
    }
    // ─── Private internals ────────────────────────────────────────────────────
    /** One full connection attempt. Throws on stage 1–3 failure. */
    async _attempt(url, timing) {
      await this._withTimeout(
        ORP_STAGE_BUDGETS.SIGNALING,
        "signaling-timeout",
        1,
        timing,
        () => this._connectSignaling(url, timing)
      );
      timing.signalingComplete = performance.now();
      await this._withTimeout(
        ORP_STAGE_BUDGETS.ICE,
        "ice-timeout",
        2,
        timing,
        () => this._waitForIce()
      );
      timing.iceConnected = performance.now();
      await this._withTimeout(
        ORP_STAGE_BUDGETS.DATA_CHANNEL,
        "data-channel-failed",
        3,
        timing,
        () => this._waitForDataChannel()
      );
      timing.dataChannelOpen = performance.now();
      timing.outcome = "success";
      this.emit("ready");
    }
    /** Open WebSocket, set up peer connection, send/receive offer–answer. */
    _connectSignaling(url, timing) {
      return new Promise((resolve, reject) => {
        this.ws = new WebSocket(url);
        this.ws.onerror = () => {
          timing.failureReason = "signaling-unreachable";
          reject(new Error("WebSocket error"));
        };
        this.ws.onclose = (ev) => {
          if (timing.outcome === "failed") return;
          if (ev.code !== 1e3) this.emit("disconnected");
        };
        this.ws.onopen = async () => {
          this.pc = new RTCPeerConnection({
            iceServers: ORP_ICE_SERVERS,
            // Trickle ICE: candidates sent as discovered, not held until complete
            iceCandidatePoolSize: 5
          });
          this.dc = this.pc.createDataChannel("orp-input", {
            ordered: false,
            maxRetransmits: 0
            // UDP-like: fire-and-forget
            // Note: 'priority' is not in all TypeScript RTCDataChannelInit definitions
          });
          this.pc.ontrack = (ev) => {
            var _a;
            if ((_a = ev.streams) == null ? void 0 : _a[0]) this.emit("stream", ev.streams[0]);
          };
          this.pc.onicecandidate = async (ev) => {
            if (!ev.candidate || !this.ws) return;
            const env = await signEnvelope({
              v: 2,
              type: "ice-candidate",
              senderId: this.viewerId,
              candidate: ev.candidate.toJSON(),
              ts: Date.now()
            }, this.opts.pin);
            this.ws.send(JSON.stringify(env));
          };
          this.pc.onconnectionstatechange = () => {
            var _a, _b;
            if (((_a = this.pc) == null ? void 0 : _a.connectionState) === "disconnected" || ((_b = this.pc) == null ? void 0 : _b.connectionState) === "failed") {
              this.emit("disconnected");
            }
          };
          const localWs = this.ws;
          localWs.onmessage = async (ev) => {
            let msg;
            try {
              msg = JSON.parse(ev.data);
            } catch {
              return;
            }
            if (msg.type === "error") {
              timing.failureReason = "signaling-unreachable";
              reject(new Error(`Server error: ${msg.message || msg.code}`));
              return;
            }
            const isLegacyNearcade = msg.v === void 0;
            if (!isLegacyNearcade && msg.v !== 2) {
              console.warn("[ORP] Rejected envelope with unexpected protocol version:", msg.v);
              return;
            }
            if (!isLegacyNearcade && !await verifyEnvelope(msg, this.opts.pin)) {
              console.warn("[ORP] Signaling envelope failed HMAC verification \u2014 possible wrong PIN or tampering");
              timing.failureReason = "security-check-failed";
              reject(new Error("security-check-failed"));
              return;
            }
            let sdpString = msg.sdp;
            if (sdpString && typeof sdpString === "object") {
              sdpString = sdpString.sdp;
            }
            if (msg.type === "offer" && sdpString) {
              await this.pc.setRemoteDescription({ type: "offer", sdp: sdpString });
              const answer = await this.pc.createAnswer();
              await this.pc.setLocalDescription(answer);
              let env;
              if (isLegacyNearcade) {
                env = { type: "answer", sdp: answer, _viewerId: this.viewerId };
              } else {
                env = await signEnvelope({
                  v: 2,
                  type: "answer",
                  senderId: this.viewerId,
                  sdp: answer.sdp,
                  ts: Date.now()
                }, this.opts.pin);
              }
              this.ws.send(JSON.stringify(env));
              resolve();
            } else if (msg.type === "answer" && sdpString) {
              await this.pc.setRemoteDescription({ type: "answer", sdp: sdpString });
              resolve();
            } else if (msg.type === "ice-candidate" && msg.candidate) {
              await this.pc.addIceCandidate(msg.candidate).catch(() => {
              });
            } else if (msg.type === "pin-locked") {
              timing.failureReason = "pin-locked";
              reject(new Error("pin-locked"));
            } else if (msg.type === "pin-fail") {
              timing.failureReason = "security-check-failed";
              reject(new Error("pin-fail"));
            }
          };
          const joinEnv = await signEnvelope({
            v: 2,
            type: "join",
            senderId: this.viewerId,
            ts: Date.now()
          }, this.opts.pin);
          localWs.send(JSON.stringify({
            ...joinEnv,
            displayName: this.opts.displayName,
            color: this.opts.color ?? "#c084fc",
            sessionId: this._sessionId
          }));
        };
      });
    }
    /** Wait for RTCPeerConnection.connectionState === 'connected'. */
    _waitForIce() {
      return new Promise((resolve, reject) => {
        if (!this.pc) return reject(new Error("no pc"));
        if (this.pc.connectionState === "connected") return resolve();
        const onchange = () => {
          var _a, _b;
          if (((_a = this.pc) == null ? void 0 : _a.connectionState) === "connected") {
            this.pc.removeEventListener("connectionstatechange", onchange);
            resolve();
          } else if (((_b = this.pc) == null ? void 0 : _b.connectionState) === "failed") {
            this.pc.removeEventListener("connectionstatechange", onchange);
            reject(new Error("ice-failed"));
          }
        };
        this.pc.addEventListener("connectionstatechange", onchange);
      });
    }
    /** Wait for the data channel to reach 'open'. */
    _waitForDataChannel() {
      return new Promise((resolve, reject) => {
        if (!this.dc) return reject(new Error("no dc"));
        if (this.dc.readyState === "open") return resolve();
        this.dc.onopen = () => resolve();
        this.dc.onerror = () => reject(new Error("data-channel-failed"));
        this.dc.onmessage = (ev) => {
          try {
            this.emit("message", ev.data);
          } catch {
          }
        };
      });
    }
    /**
     * Run `fn` with a hard timeout. On timeout, sets the failure reason and
     * failed stage on `timing`, then throws so the retry loop can catch.
     */
    _withTimeout(ms, reason, stage, timing, fn) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          timing.failureReason = reason;
          timing.failedStage = stage;
          reject(new Error(reason));
        }, ms);
        fn().then((v) => {
          clearTimeout(timer);
          resolve(v);
        }).catch((e) => {
          clearTimeout(timer);
          timing.failureReason ?? (timing.failureReason = reason);
          timing.failedStage ?? (timing.failedStage = stage);
          reject(e);
        });
      });
    }
    /** Tear down all resources from a previous attempt. */
    _cleanup() {
      var _a, _b, _c;
      try {
        (_a = this.dc) == null ? void 0 : _a.close();
      } catch {
      }
      try {
        (_b = this.pc) == null ? void 0 : _b.close();
      } catch {
      }
      try {
        (_c = this.ws) == null ? void 0 : _c.close(1e3, "cleanup");
      } catch {
      }
      this.dc = null;
      this.pc = null;
      this.ws = null;
    }
  };

  // src/ORPHostSession.ts
  async function hmacSha2562(key, data) {
    const enc = new TextEncoder();
    if (typeof crypto !== "undefined" && crypto.subtle) {
      const k = await crypto.subtle.importKey(
        "raw",
        enc.encode(key),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const sig = await crypto.subtle.sign("HMAC", k, enc.encode(data));
      return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    const nc = __require("crypto");
    return nc.createHmac("sha256", key).update(data).digest("hex");
  }
  async function signEnvelope2(env, pin) {
    if (!pin) return { ...env, sig: "unsigned" };
    const payload = JSON.stringify({ ...env, sig: "" });
    const sig = await hmacSha2562(pin, payload);
    return { ...env, sig };
  }
  async function verifyEnvelope2(env, pin) {
    if (!pin) return true;
    const { sig, ...rest } = env;
    const expected = await hmacSha2562(pin, JSON.stringify({ ...rest, sig: "" }));
    if (expected.length !== sig.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
    return diff === 0;
  }
  var ORPHostSession = class {
    constructor(opts) {
      this.viewers = /* @__PURE__ */ new Map();
      /** PIN attempt tracking for rate limiting (ORP_TRUST_MODEL.md §3) */
      this.pinAttempts = /* @__PURE__ */ new Map();
      this.WINDOW_MS = 5 * 60 * 1e3;
      // 5 minutes
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this._handlers = {};
      this.opts = opts;
      this.roomCode = opts.roomCode;
      this.pin = opts.pin;
      this.maxAttempts = opts.maxPinAttempts ?? 5;
    }
    // ─── Event emitter ────────────────────────────────────────────────────────
    on(event, fn) {
      var _a;
      ((_a = this._handlers)[event] ?? (_a[event] = [])).push(fn);
      return this;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    emit(event, ...args) {
      (this._handlers[event] ?? []).forEach((h) => h(...args));
    }
    // ─── Signaling entry point ────────────────────────────────────────────────
    /**
     * Call this for every new viewer WebSocket connection.
     * The host's HTTP/WS server should call this when a new client connects.
     *
     * @param ws - The raw WebSocket for this viewer's signaling channel
     */
    handleSignalingSocket(ws) {
      const timing = { attemptStart: performance.now() };
      let senderId = null;
      ws.addEventListener("message", async (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.v !== 2) {
          console.warn("[ORP Host] Rejected non-v2 envelope from", msg.senderId);
          return;
        }
        senderId = msg.senderId;
        if (!this._checkRateLimit(senderId)) {
          const lockEnv = await signEnvelope2({ v: 2, type: "pin-locked", senderId: "host", ts: Date.now() }, this.pin);
          ws.send(JSON.stringify(lockEnv));
          ws.close(1008, "rate-limited");
          return;
        }
        const valid = await verifyEnvelope2(msg, this.pin);
        if (!valid) {
          this._recordFailedAttempt(senderId);
          const failEnv = await signEnvelope2({ v: 2, type: "pin-fail", senderId: "host", ts: Date.now() }, this.pin);
          ws.send(JSON.stringify(failEnv));
          return;
        }
        if (msg.type === "join") {
          await this._onViewerJoin(senderId, msg.displayName ?? "Viewer", msg.color ?? "#c084fc", ws, timing);
        } else if (msg.type === "ice-candidate" && msg.candidate) {
          const viewer = this.viewers.get(senderId);
          if (viewer == null ? void 0 : viewer.pc) await viewer.pc.addIceCandidate(msg.candidate).catch(() => {
          });
        } else if (msg.type === "answer" && msg.sdp) {
          const viewer = this.viewers.get(senderId);
          if (viewer == null ? void 0 : viewer.pc) {
            await viewer.pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
            timing.signalingComplete = performance.now();
          }
        }
      });
      ws.addEventListener("close", () => {
        if (senderId) this._removeViewer(senderId);
      });
    }
    // ─── Viewer lifecycle ─────────────────────────────────────────────────────
    async _onViewerJoin(senderId, displayName, color, ws, timing) {
      const pc = new RTCPeerConnection({
        iceServers: ORP_ICE_SERVERS,
        iceCandidatePoolSize: 5
      });
      const inputChannel = pc.createDataChannel("orp-input", { ordered: false, maxRetransmits: 0 });
      const videoChannel = pc.createDataChannel("orp-video", { ordered: false, maxRetransmits: 0 });
      videoChannel.binaryType = "arraybuffer";
      const viewer = {
        senderId,
        displayName,
        color,
        pc,
        inputChannel,
        videoChannel,
        timing,
        connectedAt: Date.now()
      };
      this.viewers.set(senderId, viewer);
      pc.addEventListener("icecandidate", async (ev) => {
        if (!ev.candidate) return;
        const env = await signEnvelope2({
          v: 2,
          type: "ice-candidate",
          senderId: "host",
          candidate: ev.candidate.toJSON(),
          ts: Date.now()
        }, this.pin);
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(env));
      });
      pc.addEventListener("connectionstatechange", () => {
        if (pc.connectionState === "connected") {
          viewer.timing.iceConnected = performance.now();
          this.emit("viewer-joined", viewer);
        } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          this._removeViewer(senderId);
        }
      });
      inputChannel.addEventListener("message", (ev) => {
        let payload;
        try {
          payload = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (this._validatePayload(payload)) this.emit("input", payload, senderId);
      });
      inputChannel.addEventListener("open", () => {
        viewer.timing.dataChannelOpen = performance.now();
      });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const offerEnv = await signEnvelope2({
        v: 2,
        type: "offer",
        senderId: "host",
        sdp: offer.sdp,
        ts: Date.now(),
        topology: "mesh"
      }, this.pin);
      ws.send(JSON.stringify(offerEnv));
    }
    _removeViewer(senderId) {
      var _a, _b;
      const v = this.viewers.get(senderId);
      if (v) {
        try {
          (_a = v.inputChannel) == null ? void 0 : _a.close();
        } catch {
        }
        try {
          (_b = v.videoChannel) == null ? void 0 : _b.close();
        } catch {
        }
        try {
          v.pc.close();
        } catch {
        }
        this.viewers.delete(senderId);
        this.emit("viewer-left", senderId);
      }
    }
    // ─── Video multiplexing ───────────────────────────────────────────────────
    /**
     * Broadcast a raw encoded video buffer to all connected viewers.
     * Call this from your WebCodecs VideoEncoder output callback.
     *
     * `isKey`: whether this is a keyframe (type === 'key')
     * `timestamp`: chunk.timestamp from WebCodecs
     * `data`: Uint8Array of the encoded chunk
     * `config`: JSON string of the VideoDecoderConfig (sent on every keyframe)
     *
     * Buffer-bloat guard: viewers whose videoChannel.bufferedAmount exceeds 2MB
     * are skipped for this frame (they will recover on the next keyframe).
     * Config strings are NEVER dropped (they are short JSON, not video data).
     */
    broadcastFrame(isKey, timestamp, data, config) {
      const header = new ArrayBuffer(9);
      const view = new DataView(header);
      view.setUint8(0, isKey ? 1 : 2);
      view.setBigUint64(1, BigInt(Math.round(timestamp)), true);
      const frame = new Uint8Array(9 + data.length);
      frame.set(new Uint8Array(header), 0);
      frame.set(data, 9);
      for (const [, v] of this.viewers) {
        const dc = v.videoChannel;
        if (!dc || dc.readyState !== "open") continue;
        const BLOAT_LIMIT = 2 * 1024 * 1024;
        if (dc.bufferedAmount > BLOAT_LIMIT && !isKey) continue;
        if (isKey && config) {
          const cfgBytes = new TextEncoder().encode(config);
          const cfgBuf = new Uint8Array(1 + cfgBytes.length);
          cfgBuf[0] = 0;
          cfgBuf.set(cfgBytes, 1);
          dc.send(cfgBuf.buffer);
        }
        dc.send(frame.buffer);
      }
    }
    /** Get currently connected viewer count. */
    get viewerCount() {
      return this.viewers.size;
    }
    /** Get all currently connected viewers (read-only). */
    get connectedViewers() {
      return Array.from(this.viewers.values());
    }
    // ─── Rate limiting (ORP_TRUST_MODEL.md §3) ───────────────────────────────
    /**
     * Returns true if the senderId is allowed to attempt.
     * Returns false if they are locked out (too many failed attempts in window).
     */
    _checkRateLimit(senderId) {
      const now = Date.now();
      const record = this.pinAttempts.get(senderId);
      if (!record) return true;
      if (now - record.windowStart > this.WINDOW_MS) {
        this.pinAttempts.delete(senderId);
        return true;
      }
      return record.count < this.maxAttempts;
    }
    _recordFailedAttempt(senderId) {
      const now = Date.now();
      const record = this.pinAttempts.get(senderId);
      if (!record || now - record.windowStart > this.WINDOW_MS) {
        this.pinAttempts.set(senderId, { count: 1, windowStart: now });
      } else {
        record.count++;
      }
    }
    // ─── Payload validation (ORP_TRUST_MODEL.md §4) ───────────────────────────
    /**
     * Validates incoming input payload shape and bounds.
     * The host must do this independently of what the client claims to be sending.
     * Returns false (drops the payload) if it fails any check.
     */
    _validatePayload(payload) {
      if (!payload || typeof payload.type !== "string") return false;
      if (payload.type === "gamepad") {
        const gp = payload;
        if (!Array.isArray(gp.axes) || gp.axes.length > 4) return false;
        if (!Array.isArray(gp.buttons) || gp.buttons.length > 32) return false;
        for (const a of gp.axes) if (typeof a !== "number" || a < -1.1 || a > 1.1) return false;
        for (const b of gp.buttons) {
          if (typeof b.value !== "number" || b.value < 0 || b.value > 1) return false;
        }
      }
      if (payload.type === "keyboard") {
        const kp = payload;
        const validEvents = ["keydown", "keyup", "mousemove", "mousedown", "mouseup"];
        if (!validEvents.includes(kp.event)) return false;
      }
      return true;
    }
  };
  return __toCommonJS(index_exports);
})();
//# sourceMappingURL=orp-client.bundle.js.map
