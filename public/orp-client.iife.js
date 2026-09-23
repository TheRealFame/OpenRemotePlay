/* OpenRemotePlay (ORP) v2 — MIT License — IIFE Bundle */
var require = typeof require !== 'undefined' ? require : function(id) {
  if (id === 'crypto') return {};
  throw new Error('[ORP] require() is not supported in browser: ' + id);
};
"use strict";
var ORP = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __export = (target, all3) => {
    for (var name in all3)
      __defProp(target, name, { get: all3[name], enumerable: true });
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
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // src/index.ts
  var index_exports = {};
  __export(index_exports, {
    ORPClient: () => ORPClient,
    ORPHostSession: () => ORPHostSession,
    ORPMqttSession: () => ORPMqttSession,
    ORPNostrSession: () => ORPNostrSession,
    ORP_ICE_SERVERS: () => ORP_ICE_SERVERS,
    ORP_STAGE_BUDGETS: () => ORP_STAGE_BUDGETS
  });

  // src/types.ts
  var ORP_ICE_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: "stun:stun.nextcloud.com:443" },
    { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" }
  ];
  var ORP_STAGE_BUDGETS = {
    /** Stage 1: Signaling handshake — offer sent and answer received. */
    SIGNALING: 15e3,
    /** Stage 2: ICE gathering + connectivity checks. */
    ICE: 8e3,
    /** Stage 3: RTCDataChannel reaches 'open' state. */
    DATA_CHANNEL: 3e3,
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
    try {
      if (!crypto || !crypto.subtle) throw new Error("crypto.subtle is undefined (insecure context)");
      const encoder3 = new TextEncoder();
      const keyData = encoder3.encode(key);
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder3.encode(data));
      return btoa(String.fromCharCode(...new Uint8Array(signature)));
    } catch (e) {
      console.warn("[ORP] HMAC failed (likely insecure HTTP context). Sending unsigned.", e);
      return "insecure-context";
    }
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
      // Rolling buffers for duplicate controller detection (ORP_SPEC §6.3)
      this._padBuffers = /* @__PURE__ */ new Map();
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
      const cleanUrl = typeof signalingUrl === "string" ? signalingUrl.split("#")[0] : signalingUrl;
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
      const isSuppressed = this._checkDuplicateAndBuffer(padId, pad);
      if (isSuppressed) return;
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
      if (this._padBuffers.has(padId)) {
        this.sendInput({
          v: 2,
          type: "controller-disconnected",
          slotId: "primary",
          streamFingerprint: padId
        });
        this._padBuffers.delete(padId);
      }
      this._activePads.delete(padId);
    }
    /** Send a keyboard or mouse event. */
    sendKey(payload) {
      this.sendInput(payload);
    }
    /** Close all resources. */
    disconnect() {
      this._activePads.forEach((id) => this.releaseGamepad(id));
      this._padBuffers.clear();
      this._cleanup();
    }
    // ─── Private internals ────────────────────────────────────────────────────
    /** ORP_SPEC.md §6.3: Track controller state rolling window and suppress duplicates. */
    _checkDuplicateAndBuffer(padId, pad) {
      var _a;
      let state = this._padBuffers.get(padId);
      if (!state) {
        state = { buffer: new Float32Array(30 * 21), ptr: 0, frames: 0, registeredAt: performance.now(), suppressed: false };
        this._padBuffers.set(padId, state);
        this.sendInput({
          v: 2,
          type: "controller-connected",
          slotId: "primary",
          streamFingerprint: padId
        });
      }
      const buffer = state.buffer;
      const ptr = state.ptr;
      const offset = ptr * 21;
      for (let i = 0; i < 4; i++) buffer[offset + i] = pad.axes[i] || 0;
      for (let i = 0; i < 17; i++) buffer[offset + 4 + i] = ((_a = pad.buttons[i]) == null ? void 0 : _a.value) || 0;
      state.ptr = (ptr + 1) % 30;
      if (state.frames < 30) state.frames++;
      if (state.frames >= 30) {
        let isDuplicate = false;
        for (const [otherId, otherState] of this._padBuffers.entries()) {
          if (otherId === padId || otherState.frames < 30) continue;
          if (otherState.registeredAt <= state.registeredAt) {
            let identicalFrames = 0;
            for (let f = 0; f < 30; f++) {
              const thisOffset = (state.ptr - 1 - f + 30) % 30 * 21;
              const otherOffset = (otherState.ptr - 1 - f + 30) % 30 * 21;
              let frameDiff = 0;
              for (let i = 0; i < 21; i++) {
                frameDiff += Math.abs(buffer[thisOffset + i] - otherState.buffer[otherOffset + i]);
              }
              if (frameDiff < 0.05) identicalFrames++;
            }
            if (identicalFrames >= 29) {
              isDuplicate = true;
              break;
            }
          }
        }
        state.suppressed = isDuplicate;
      }
      return state.suppressed;
    }
    /** One full connection attempt. Throws on stage 1–3 failure. */
    async _attempt(url, timing) {
      await this._withTimeout(
        typeof url === "string" && (url.startsWith("ws://") || url.startsWith("wss://")) ? ORP_STAGE_BUDGETS.SIGNALING : 45e3,
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
        this.ws = typeof url === "string" ? new WebSocket(url) : url;
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
            iceServers: this.opts.iceServers ?? ORP_ICE_SERVERS,
            // Trickle ICE: candidates sent as discovered, not held until complete
            iceCandidatePoolSize: 5
          });
          this.pc.ondatachannel = (ev) => {
            if (ev.channel.label === "orp-input") {
              this.dc = ev.channel;
            }
            this.emit("datachannel", ev.channel);
          };
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
            var _a, _b, _c;
            if (((_a = this.pc) == null ? void 0 : _a.connectionState) === "disconnected" || ((_b = this.pc) == null ? void 0 : _b.connectionState) === "failed" || ((_c = this.pc) == null ? void 0 : _c.connectionState) === "closed") {
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
            if (msg.target && msg.target !== this.viewerId) return;
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
        var _a;
        const bindDc = (dc) => {
          if (dc.readyState === "open") {
            dc.onmessage = (ev) => {
              try {
                this.emit("message", ev.data);
              } catch {
              }
            };
            resolve();
          } else {
            dc.onopen = () => {
              dc.onmessage = (ev) => {
                try {
                  this.emit("message", ev.data);
                } catch {
                }
              };
              resolve();
            };
            dc.onerror = () => reject(new Error("data-channel-failed"));
          }
        };
        if (this.dc) {
          bindDc(this.dc);
        } else {
          const onDc = (ev) => {
            var _a2;
            if (ev.channel.label === "orp-input") {
              this.dc = ev.channel;
              bindDc(this.dc);
              (_a2 = this.pc) == null ? void 0 : _a2.removeEventListener("datachannel", onDc);
            }
          };
          (_a = this.pc) == null ? void 0 : _a.addEventListener("datachannel", onDc);
        }
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
    try {
      if (!crypto || !crypto.subtle) throw new Error("crypto.subtle is undefined (insecure context)");
      const encoder3 = new TextEncoder();
      const keyData = encoder3.encode(key);
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder3.encode(data));
      return btoa(String.fromCharCode(...new Uint8Array(signature)));
    } catch (e) {
      console.warn("[ORP] HMAC failed (likely insecure HTTP context). Sending unsigned.", e);
      return "insecure-context";
    }
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
      this._ws = ws;
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
        iceServers: this.opts.iceServers ?? ORP_ICE_SERVERS,
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
        target: senderId,
        sdp: offer.sdp,
        ts: Date.now(),
        topology: "mesh"
      }, this.pin);
      ws.send(JSON.stringify(offerEnv));
    }
    async renegotiate(senderId) {
      const viewer = this.viewers.get(senderId);
      if (!viewer || !this._ws) return;
      const offer = await viewer.pc.createOffer();
      await viewer.pc.setLocalDescription(offer);
      const offerEnv = await signEnvelope2({
        v: 2,
        type: "offer",
        senderId: "host",
        target: senderId,
        sdp: offer.sdp,
        ts: Date.now(),
        topology: "mesh"
      }, this.pin);
      this._ws.send(JSON.stringify(offerEnv));
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
      const now2 = Date.now();
      const record = this.pinAttempts.get(senderId);
      if (!record) return true;
      if (now2 - record.windowStart > this.WINDOW_MS) {
        this.pinAttempts.delete(senderId);
        return true;
      }
      return record.count < this.maxAttempts;
    }
    _recordFailedAttempt(senderId) {
      const now2 = Date.now();
      const record = this.pinAttempts.get(senderId);
      if (!record || now2 - record.windowStart > this.WINDOW_MS) {
        this.pinAttempts.set(senderId, { count: 1, windowStart: now2 });
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
      if (payload.type === "controller-connected" || payload.type === "controller-disconnected") {
        const cp = payload;
        if (cp.v !== 2 || typeof cp.slotId !== "string" || typeof cp.streamFingerprint !== "string") return false;
      }
      return true;
    }
  };

  // ../../../../node_modules/@trystero-p2p/core/dist/utils.mjs
  var { floor, min, sin } = Math;
  var libName = "Trystero";
  var alloc = (n, f) => Array(n).fill(void 0).map(f);
  var charSet = "0123456789AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz";
  var genId = (n) => alloc(n, () => charSet[floor(Math.random() * 62)] ?? "").join("");
  var selfId = genId(20);
  var all = Promise.all.bind(Promise);
  var isBrowser = typeof window !== "undefined";
  var { entries, fromEntries, keys, values } = Object;
  var noOp = () => {
  };
  var candidateType = "candidate";
  var resetTimer = (timer) => {
    if (timer !== null) clearTimeout(timer);
    return null;
  };
  var mkErr = (msg) => /* @__PURE__ */ new Error(`${libName}: ${msg}`);
  var toErrorMessage = (reason, fallback) => {
    if (reason instanceof Error && reason.message) return reason.message;
    if (typeof reason === "string" && reason) return reason;
    return toJson(reason ?? fallback);
  };
  var toError = (reason, fallback) => reason instanceof Error ? reason : mkErr(toErrorMessage(reason, fallback));
  var encoder = new TextEncoder();
  var decoder = new TextDecoder();
  var encodeBytes = (txt) => encoder.encode(txt);
  var decodeBytes = (buffer) => decoder.decode(buffer);
  var toHex = (buffer) => buffer.reduce((a, c) => a + c.toString(16).padStart(2, "0"), "");
  var topicPath = (...parts) => parts.join("@");
  var shuffle = (xs, seed) => {
    const a = [...xs];
    const rand = () => {
      const x = sin(seed++) * 1e4;
      return x - floor(x);
    };
    let i = a.length;
    while (i) {
      const j = floor(rand() * i--);
      const tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  };
  var getRelays = (config, defaults, defaultN, deriveFromAppId = false) => {
    var _a, _b;
    return ((_a = config.relayConfig) == null ? void 0 : _a.urls) || (deriveFromAppId ? shuffle(defaults, strToNum(config.appId)) : defaults).slice(0, ((_b = config.relayConfig) == null ? void 0 : _b.redundancy) ?? defaultN);
  };
  var toJson = JSON.stringify;
  var fromJson = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      throw mkErr(`failed to parse JSON: ${s}`);
    }
  };
  var strToNum = (str, limit = Number.MAX_SAFE_INTEGER) => str.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % limit;
  var defaultRetryMs = 3333;
  var maxRetryMs = 6e4;
  var socketRetryPeriods = {};
  var reconnectionLockingPromise = null;
  var resolver = null;
  var pauseRelayReconnection = () => {
    if (!reconnectionLockingPromise) reconnectionLockingPromise = new Promise((resolve) => {
      resolver = resolve;
    }).finally(() => {
      resolver = null;
      reconnectionLockingPromise = null;
    });
  };
  var resumeRelayReconnection = () => {
    resolver == null ? void 0 : resolver();
  };
  var makeSocket = (url, onMessage, onReconnect) => {
    const client = {};
    let didOpen = false;
    let isReconnectPending = false;
    let resolveReady = noOp;
    client.ready = new Promise((res) => resolveReady = res);
    const init = () => {
      isReconnectPending = false;
      const socket = new WebSocket(url);
      socket.onclose = () => {
        if (isReconnectPending) return;
        isReconnectPending = true;
        if (reconnectionLockingPromise) {
          reconnectionLockingPromise.then(init);
          return;
        }
        const period = socketRetryPeriods[url] ?? (socketRetryPeriods[url] = defaultRetryMs);
        setTimeout(init, Math.random() * period);
        socketRetryPeriods[url] = min(period * 2, maxRetryMs);
      };
      socket.onmessage = (e) => onMessage(String(e.data));
      client.socket = socket;
      client.url = socket.url;
      socket.onopen = () => {
        const isReconnect = didOpen;
        didOpen = true;
        resolveReady(client);
        socketRetryPeriods[url] = defaultRetryMs;
        if (isReconnect) onReconnect == null ? void 0 : onReconnect();
      };
      client.send = (data) => {
        if (socket.readyState === 1) socket.send(data);
      };
    };
    init();
    return client;
  };
  var createRelayManager = (getSocket) => {
    const relays = {};
    const keysByRelay = /* @__PURE__ */ new WeakMap();
    const keyOf = (relay) => {
      const key = keysByRelay.get(relay);
      if (!key) throw mkErr("relay bookkeeping missing registration for relay client");
      return key;
    };
    const scoped = () => {
      const store2 = {};
      const forKey = (key) => store2[key] ?? (store2[key] = {});
      return {
        forKey,
        forRelay: (relay) => forKey(keyOf(relay))
      };
    };
    const store = (key, relay) => {
      relays[key] = relay;
      keysByRelay.set(relay, key);
      return relay;
    };
    return {
      register: (key, createRelay) => {
        const relay = relays[key];
        if (relay) return relay;
        return store(key, createRelay());
      },
      keyOf,
      scoped,
      getSockets: () => fromEntries(entries(relays).flatMap(([key, relay]) => {
        const socket = getSocket(relay);
        return socket ? [[key, socket]] : [];
      }))
    };
  };
  var watchOnline = () => {
    if (isBrowser) {
      const controller = new AbortController();
      addEventListener("online", resumeRelayReconnection, { signal: controller.signal });
      addEventListener("offline", pauseRelayReconnection, { signal: controller.signal });
      return () => controller.abort();
    }
    return noOp;
  };

  // ../../../../node_modules/@trystero-p2p/core/dist/crypto.mjs
  var algo = "AES-GCM";
  var strToSha1 = {};
  var pack = (buff) => btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(buff))));
  var unpack = (packed) => {
    const str = atob(packed);
    return new Uint8Array(str.length).map((_, i) => str.charCodeAt(i)).buffer;
  };
  var hashWith = async (algorithm, str) => new Uint8Array(await crypto.subtle.digest(algorithm, encodeBytes(str)));
  var sha1 = async (str) => strToSha1[str] ?? (strToSha1[str] = Array.from(await hashWith("SHA-1", str)).map((b) => b.toString(36)).join(""));
  var genKey = async (secret, appId, roomId) => crypto.subtle.importKey("raw", await crypto.subtle.digest({ name: "SHA-256" }, encodeBytes(`${secret}:${appId}:${roomId}`)), { name: algo }, false, ["encrypt", "decrypt"]);
  var deriveRoomNamespace = async (appId, roomId) => toHex(await hashWith("SHA-256", `${libName}:${appId}:${roomId}`));
  var joinChar = "$";
  var ivJoinChar = ",";
  var encrypt = async (keyP, plaintext) => {
    const iv = crypto.getRandomValues(new Uint8Array(16));
    return iv.join(ivJoinChar) + joinChar + pack(await crypto.subtle.encrypt({
      name: algo,
      iv
    }, await keyP, encodeBytes(plaintext)));
  };
  var decrypt = async (keyP, raw) => {
    const [iv, c] = raw.split(joinChar);
    return decodeBytes(await crypto.subtle.decrypt({
      name: algo,
      iv: new Uint8Array((iv == null ? void 0 : iv.split(ivJoinChar).map(Number)) ?? [])
    }, await keyP, unpack(c ?? "")));
  };

  // ../../../../node_modules/@trystero-p2p/core/dist/offer-pool.mjs
  var offerTtl = 57333;
  var offerLeaseTtlMs = 18e4;
  var poolSize = 20;
  var OfferPool = class {
    constructor(makeOffer) {
      __publicField(this, "makeOffer");
      __publicField(this, "pool", []);
      __publicField(this, "pooled", /* @__PURE__ */ new Set());
      __publicField(this, "leased", /* @__PURE__ */ new Map());
      __publicField(this, "recycling", /* @__PURE__ */ new Set());
      __publicField(this, "cleanupTimer", null);
      __publicField(this, "active", false);
      this.makeOffer = makeOffer;
    }
    get isActive() {
      return this.active;
    }
    warmup() {
      this.pool = [];
      this.pooled.clear();
      alloc(poolSize, this.makeOffer).forEach((p) => this.push(p));
      this.active = true;
      this.cleanupTimer = setInterval(() => {
        this.pool = this.pool.filter((peer) => {
          if (peer.isDead) {
            this.pooled.delete(peer);
            return false;
          }
          return true;
        });
      }, offerTtl);
    }
    push(peer) {
      if (peer.isDead || this.pooled.has(peer) || this.leased.has(peer)) return;
      this.pool.push(peer);
      this.pooled.add(peer);
    }
    shift(n) {
      const peers = [];
      while (peers.length < n && this.pool.length > 0) {
        const peer = this.pool.shift();
        if (!peer) break;
        this.pooled.delete(peer);
        peers.push(peer);
      }
      return peers;
    }
    claimLeased(peer) {
      const timer = this.leased.get(peer);
      if (timer) {
        resetTimer(timer);
        this.leased.delete(peer);
      }
    }
    recycle(peer) {
      if (peer.isDead || this.recycling.has(peer)) return;
      if (peer.connection.remoteDescription) {
        peer.destroy();
        return;
      }
      if (!this.active) {
        peer.destroy();
        return;
      }
      this.recycling.add(peer);
      peer.setHandlers({
        connect: noOp,
        close: noOp,
        error: noOp
      });
      peer.getOffer(true).then((offer) => {
        if (!offer || offer.type !== "offer" || peer.isDead || !this.active) {
          peer.destroy();
          return;
        }
        this.push(peer);
      }).catch(() => peer.destroy()).finally(() => this.recycling.delete(peer));
    }
    reclaimLeased(peer) {
      const timer = this.leased.get(peer);
      if (!timer) return;
      resetTimer(timer);
      this.leased.delete(peer);
      this.recycle(peer);
    }
    lease(peer) {
      this.claimLeased(peer);
      this.leased.set(peer, setTimeout(() => {
        this.leased.delete(peer);
        this.recycle(peer);
      }, offerLeaseTtlMs));
    }
    checkout(n, leaseOffers, encryptOffer) {
      const peers = this.shift(n);
      const missing = Math.max(0, n - peers.length);
      if (missing > 0) peers.push(...alloc(missing, this.makeOffer));
      const toRecord = async (candidate, didRetry = false) => {
        try {
          const offer = await encryptOffer(candidate);
          if (leaseOffers) {
            this.lease(candidate);
            return {
              peer: candidate,
              offer,
              claim: () => this.claimLeased(candidate),
              reclaim: () => this.reclaimLeased(candidate)
            };
          }
          return {
            peer: candidate,
            offer
          };
        } catch (err) {
          this.claimLeased(candidate);
          this.pooled.delete(candidate);
          candidate.destroy();
          if (!didRetry) return toRecord(this.makeOffer(), true);
          throw err;
        }
      };
      return all(peers.map((peer) => toRecord(peer)));
    }
    getOffers(n, encryptOffer) {
      return this.checkout(n, true, encryptOffer);
    }
    destroy() {
      this.active = false;
      if (this.cleanupTimer) {
        clearInterval(this.cleanupTimer);
        this.cleanupTimer = null;
      }
      this.pool.forEach((peer) => peer.destroy());
      this.pool = [];
      this.pooled.clear();
      this.leased.forEach((timeout, peer) => {
        resetTimer(timeout);
        peer.destroy();
      });
      this.leased.clear();
      this.recycling.forEach((peer) => peer.destroy());
      this.recycling.clear();
    }
  };

  // ../../../../node_modules/@trystero-p2p/core/dist/handshake.mjs
  var overlapRoomPasswordErr = mkErr("incorrect password for overlapping room");
  var createPasswordHandshake = (password, appId, roomId) => {
    const hashChallenge = (challenge2) => hashWith("SHA-256", `${challenge2}:${password}:${appId}:${roomId}`).then(toHex);
    const run = async (send2, receive, isInitiator) => {
      if (!password) return;
      if (isInitiator) {
        const challenge2 = genId(36);
        await send2({
          __trystero_pw: "challenge",
          c: challenge2
        });
        const { data: data2 } = await receive();
        if (!data2 || typeof data2 !== "object" || data2.__trystero_pw !== "response" || typeof data2.h !== "string") throw overlapRoomPasswordErr;
        const expected = await hashChallenge(challenge2);
        if (data2.h !== expected) throw overlapRoomPasswordErr;
        return;
      }
      const { data } = await receive();
      if (!data || typeof data !== "object" || data.__trystero_pw !== "challenge" || typeof data.c !== "string") throw overlapRoomPasswordErr;
      await send2({
        __trystero_pw: "response",
        h: await hashChallenge(data.c)
      });
    };
    const compose = (userHandshake) => password || userHandshake ? async (peerId, send2, receive, isInitiator) => {
      await run(send2, receive, isInitiator);
      await (userHandshake == null ? void 0 : userHandshake(peerId, send2, receive, isInitiator));
    } : void 0;
    return {
      run,
      compose
    };
  };
  var toHandshakeErrorMessage = (error) => {
    const message = toErrorMessage(error, "unknown error");
    return message.startsWith("handshake ") ? message : `handshake failed: ${message}`;
  };
  var createHandshakeManager = ({ onPeerHandshake, onHandshakeError, handshakeTimeoutMs, sendHandshakeData, sendHandshakeReady, onActivate, onFailure }) => {
    const peerStates = {};
    const maybeActivatePeer = (id, peer) => {
      const state = peerStates[id];
      if (!state || peer && state.peer !== peer || state.isActive) return;
      if (!state.didLocalHandshakePass || !state.didReceiveRemoteReady) return;
      state.isActive = true;
      state.handshakeTimer = resetTimer(state.handshakeTimer);
      onActivate(id, state.peer);
    };
    const failPeerHandshake = (id, peer, reason) => {
      const state = peerStates[id];
      if (!state || state.peer !== peer) return;
      const error = toHandshakeErrorMessage(reason);
      onHandshakeError == null ? void 0 : onHandshakeError(id, error);
      onFailure(id, peer, mkErr(error));
    };
    const markLocalHandshakePassed = (id, peer) => {
      const state = peerStates[id];
      if (!state || state.peer !== peer || state.isActive) return;
      state.didLocalHandshakePass = true;
      sendHandshakeReady("", id).catch((err) => failPeerHandshake(id, peer, mkErr(`failed sending handshake readiness: ${toErrorMessage(err, "unknown send failure")}`)));
      maybeActivatePeer(id, peer);
    };
    return {
      addPeer: (id, peer) => {
        peerStates[id] = {
          peer,
          isActive: false,
          didLocalHandshakePass: false,
          didReceiveRemoteReady: false,
          handshakeTimer: null,
          pendingHandshakePayloads: [],
          handshakeWaiters: []
        };
      },
      clearPeer: (id, error) => {
        const state = peerStates[id];
        if (!state) return;
        state.handshakeTimer = resetTimer(state.handshakeTimer);
        state.pendingHandshakePayloads.length = 0;
        state.handshakeWaiters.splice(0).forEach((waiter) => waiter.reject(error));
        delete peerStates[id];
      },
      canReceiveFromPeer: (id, receiveWhilePending) => {
        const state = peerStates[id];
        return Boolean(state && (state.isActive || receiveWhilePending));
      },
      start: (id, peer) => {
        const state = peerStates[id];
        if (!state || state.peer !== peer) return;
        state.handshakeTimer = setTimeout(() => failPeerHandshake(id, peer, mkErr(`handshake timed out after ${handshakeTimeoutMs}ms`)), handshakeTimeoutMs);
        const sendHandshake = async (data, metadata) => {
          await sendHandshakeData(data, id, metadata);
        };
        const receiveHandshake = () => new Promise((resolve, reject) => {
          const current = peerStates[id];
          if (!current || current.peer !== peer) {
            reject(mkErr("peer disconnected during handshake"));
            return;
          }
          const payload = current.pendingHandshakePayloads.shift();
          if (payload) {
            resolve(payload);
            return;
          }
          current.handshakeWaiters.push({
            resolve,
            reject: (error) => reject(error)
          });
        });
        const isInitiator = selfId < id;
        Promise.resolve(onPeerHandshake == null ? void 0 : onPeerHandshake(id, sendHandshake, receiveHandshake, isInitiator)).then(() => markLocalHandshakePassed(id, peer)).catch((err) => failPeerHandshake(id, peer, toError(err, "handshake failed")));
      },
      receiveHandshakeData: (data, id, metadata) => {
        const state = peerStates[id];
        if (!state || state.isActive) return;
        const payload = metadata === void 0 ? { data } : {
          data,
          metadata
        };
        const pending = state.handshakeWaiters.shift();
        if (pending) {
          pending.resolve(payload);
          return;
        }
        state.pendingHandshakePayloads.push(payload);
      },
      receiveHandshakeReady: (id) => {
        const state = peerStates[id];
        if (!state || state.isActive) return;
        state.didReceiveRemoteReady = true;
        maybeActivatePeer(id);
      }
    };
  };

  // ../../../../node_modules/@trystero-p2p/core/dist/peer.mjs
  var iceTimeout = 15e3;
  var disconnectedCloseDelayMs = 5e3;
  var iceStateEvent = "icegatheringstatechange";
  var iceConnectionStateEvent = "iceconnectionstatechange";
  var offerType = "offer";
  var answerType = "answer";
  var outOfRangePattern = /out of range/i;
  var rewriteMdnsCandidatesToLoopback = (sdp) => sdp.replace(/ (\S+\.local) (\d+) typ host/g, " 127.0.0.1 $2 typ host");
  var peer_default = (initiator, { trickleIce, rtcConfig, rtcPolyfill, turnConfig, _test_only_mdnsHostFallbackToLoopback }) => {
    const pc = new (rtcPolyfill ?? RTCPeerConnection)({
      iceServers: defaultIceServers.concat(turnConfig ?? []),
      ...rtcConfig
    });
    const handlers = {};
    const pendingSignals = [];
    const pendingData = [];
    const shouldTrickleIce = trickleIce !== false;
    const pendingRemoteCandidates = [];
    const pendingTracks = [];
    let makingOffer = false;
    let isSettingRemoteAnswerPending = false;
    let dataChannel = null;
    let disconnectedCloseTimer = null;
    let didEmitClose = false;
    const clearDisconnectedCloseTimer = () => disconnectedCloseTimer = resetTimer(disconnectedCloseTimer);
    const emitClose = () => {
      var _a;
      if (didEmitClose) return;
      didEmitClose = true;
      clearDisconnectedCloseTimer();
      (_a = handlers.close) == null ? void 0 : _a.call(handlers);
    };
    const emitSignal = (signal) => {
      if (handlers.signal) handlers.signal(signal);
      else pendingSignals.push(signal);
    };
    const appendSignalHandler = (handler) => {
      const previousSignalHandler = handlers.signal;
      handlers.signal = (signal) => {
        previousSignalHandler == null ? void 0 : previousSignalHandler(signal);
        handler(signal);
      };
      if (pendingSignals.length > 0) pendingSignals.splice(0).forEach((signal) => {
        var _a;
        return (_a = handlers.signal) == null ? void 0 : _a.call(handlers, signal);
      });
    };
    const normalizeSdp = (sdp) => _test_only_mdnsHostFallbackToLoopback ? rewriteMdnsCandidatesToLoopback(sdp) : sdp;
    const normalizeCandidate = (candidate) => {
      if (!_test_only_mdnsHostFallbackToLoopback || typeof candidate.candidate !== "string") return candidate;
      const normalizedCandidate = rewriteMdnsCandidatesToLoopback(candidate.candidate);
      return normalizedCandidate === candidate.candidate ? candidate : {
        ...candidate,
        candidate: normalizedCandidate
      };
    };
    const localDescriptionSignal = (peerConnection) => {
      var _a, _b;
      return {
        type: ((_a = peerConnection.localDescription) == null ? void 0 : _a.type) ?? offerType,
        sdp: normalizeSdp(((_b = peerConnection.localDescription) == null ? void 0 : _b.sdp) ?? "")
      };
    };
    const getRemoteUfrag = () => {
      var _a, _b;
      const sdp = (_a = pc.remoteDescription) == null ? void 0 : _a.sdp;
      if (!sdp) return null;
      return ((_b = sdp.match(/a=ice-ufrag:([^\s]+)/)) == null ? void 0 : _b[1]) ?? null;
    };
    const getRemoteMediaSectionCount = () => {
      var _a, _b;
      return (((_b = (_a = pc.remoteDescription) == null ? void 0 : _a.sdp) == null ? void 0 : _b.match(/^m=/gm)) ?? []).length;
    };
    const canApplyRemoteCandidate = (candidate) => {
      if (!pc.remoteDescription) return false;
      const remoteMLineCount = getRemoteMediaSectionCount();
      if (typeof candidate.sdpMLineIndex === "number" && remoteMLineCount > 0 && candidate.sdpMLineIndex >= remoteMLineCount) return false;
      const remoteUfrag = getRemoteUfrag();
      if (remoteUfrag && candidate.usernameFragment && candidate.usernameFragment !== remoteUfrag) return false;
      return true;
    };
    const addIceCandidateSafe = async (candidate) => {
      try {
        await pc.addIceCandidate(candidate);
        return true;
      } catch (err) {
        if (err instanceof Error && outOfRangePattern.test(err.message) && typeof candidate.sdpMLineIndex === "number") return false;
        throw err;
      }
    };
    const flushPendingRemoteCandidates = async () => {
      if (!pc.remoteDescription || pendingRemoteCandidates.length === 0) return;
      const queuedCandidates = pendingRemoteCandidates.splice(0);
      const stillPending = [];
      for (const candidate of queuedCandidates) {
        if (!canApplyRemoteCandidate(candidate)) {
          stillPending.push(candidate);
          continue;
        }
        if (!await addIceCandidateSafe(candidate)) stillPending.push(candidate);
      }
      if (stillPending.length > 0) pendingRemoteCandidates.push(...stillPending);
    };
    const addRemoteCandidate = async (candidate) => {
      if (canApplyRemoteCandidate(candidate)) {
        if (!await addIceCandidateSafe(candidate)) pendingRemoteCandidates.push(candidate);
        return;
      }
      pendingRemoteCandidates.push(candidate);
    };
    const setupDataChannel = (channel) => {
      channel.binaryType = "arraybuffer";
      channel.bufferedAmountLowThreshold = 65535;
      channel.onmessage = (e) => {
        const data = e.data;
        if (handlers.data) handlers.data(data);
        else pendingData.push(data);
      };
      channel.onopen = () => {
        var _a;
        return (_a = handlers.connect) == null ? void 0 : _a.call(handlers);
      };
      channel.onclose = emitClose;
      channel.onerror = ({ error }) => {
        var _a;
        return (_a = handlers.error) == null ? void 0 : _a.call(handlers, toError(error, "data channel error"));
      };
    };
    const waitForIceGathering = async (peerConnection) => {
      let timeout = null;
      try {
        await Promise.race([new Promise((res) => {
          const checkState = () => {
            if (peerConnection.iceGatheringState === "complete") {
              peerConnection.removeEventListener(iceStateEvent, checkState);
              res();
            }
          };
          peerConnection.addEventListener(iceStateEvent, checkState);
          checkState();
        }), new Promise((res) => {
          timeout = setTimeout(res, iceTimeout);
        })]);
      } finally {
        resetTimer(timeout);
      }
      return localDescriptionSignal(peerConnection);
    };
    const emitLocalDescriptionSignal = async () => {
      const signal = shouldTrickleIce ? localDescriptionSignal(pc) : await waitForIceGathering(pc);
      emitSignal(signal);
      return signal;
    };
    if (initiator) {
      dataChannel = pc.createDataChannel("data");
      setupDataChannel(dataChannel);
    } else pc.ondatachannel = ({ channel }) => {
      dataChannel = channel;
      setupDataChannel(channel);
    };
    const createOffer = async (restartIce = false) => {
      var _a, _b;
      if (pc.connectionState === "closed") return;
      try {
        makingOffer = true;
        if (restartIce) {
          if (pc.signalingState !== "stable" && pc.signalingState !== "closed" && ((_a = pc.localDescription) == null ? void 0 : _a.type) === offerType) await pc.setLocalDescription({ type: "rollback" });
          if (typeof pc.restartIce === "function") pc.restartIce();
        }
        await pc.setLocalDescription(restartIce ? await pc.createOffer({ iceRestart: true }) : void 0);
        return await emitLocalDescriptionSignal();
      } catch (err) {
        (_b = handlers.error) == null ? void 0 : _b.call(handlers, toError(err, "failed to create local offer"));
      } finally {
        makingOffer = false;
      }
    };
    pc.onnegotiationneeded = async () => createOffer(false);
    pc.onicecandidate = ({ candidate }) => {
      if (!shouldTrickleIce || !candidate) return;
      const candidatePayload = normalizeCandidate(typeof candidate.toJSON === "function" ? candidate.toJSON() : {
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
        usernameFragment: candidate.usernameFragment
      });
      emitSignal({
        type: candidateType,
        sdp: JSON.stringify(candidatePayload)
      });
    };
    const handleConnectionStateChange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed" || pc.iceConnectionState === "failed" || pc.iceConnectionState === "closed") {
        emitClose();
        return;
      }
      if (pc.connectionState === "connected" || pc.connectionState === "connecting" || pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed" || pc.iceConnectionState === "checking") {
        clearDisconnectedCloseTimer();
        return;
      }
      if (pc.connectionState === "disconnected" || pc.iceConnectionState === "disconnected") {
        if (!disconnectedCloseTimer) disconnectedCloseTimer = setTimeout(() => {
          disconnectedCloseTimer = null;
          if (pc.connectionState === "disconnected" || pc.iceConnectionState === "disconnected") emitClose();
        }, disconnectedCloseDelayMs);
        return;
      }
    };
    pc.onconnectionstatechange = handleConnectionStateChange;
    pc.addEventListener(iceConnectionStateEvent, handleConnectionStateChange);
    pc.ontrack = (e) => {
      var _a, _b;
      const stream = e.streams[0];
      if (stream) {
        if (!handlers.track && !handlers.stream) {
          pendingTracks.push({
            track: e.track,
            stream
          });
          return;
        }
        (_a = handlers.track) == null ? void 0 : _a.call(handlers, e.track, stream);
        (_b = handlers.stream) == null ? void 0 : _b.call(handlers, stream);
      }
    };
    pc.onremovestream = (e) => {
      var _a;
      return (_a = handlers.stream) == null ? void 0 : _a.call(handlers, e.stream);
    };
    const offerPromise = initiator ? new Promise((res) => appendSignalHandler((signal) => {
      if (signal.type === offerType) res(signal);
    })) : Promise.resolve();
    if (initiator) queueMicrotask(() => {
      var _a;
      if (!makingOffer && pc.signalingState === "stable" && !pc.localDescription && pc.connectionState !== "closed") (_a = pc.onnegotiationneeded) == null ? void 0 : _a.call(pc, new Event("negotiationneeded"));
    });
    return {
      created: Date.now(),
      connection: pc,
      get channel() {
        return dataChannel;
      },
      get isDead() {
        return pc.connectionState === "closed";
      },
      getOffer: async (restartIce = false) => {
        var _a;
        if (!initiator) return;
        if (restartIce) return createOffer(true);
        if (((_a = pc.localDescription) == null ? void 0 : _a.type) === offerType) return shouldTrickleIce ? localDescriptionSignal(pc) : waitForIceGathering(pc);
        return offerPromise;
      },
      async signal(sdp) {
        var _a, _b, _c;
        if (sdp.type === "candidate") {
          try {
            const candidate = JSON.parse(sdp.sdp);
            if (candidate && typeof candidate === "object") await addRemoteCandidate(normalizeCandidate(candidate));
          } catch (err) {
            (_a = handlers.error) == null ? void 0 : _a.call(handlers, toError(err, "failed to parse remote candidate"));
          }
          return;
        }
        if ((dataChannel == null ? void 0 : dataChannel.readyState) === "open" && !((_b = sdp.sdp) == null ? void 0 : _b.includes("a=rtpmap"))) return;
        try {
          const rtcSdp = {
            ...sdp,
            sdp: normalizeSdp(sdp.sdp)
          };
          if (sdp.type === offerType) {
            if (makingOffer || pc.signalingState !== "stable" && !isSettingRemoteAnswerPending) {
              if (initiator) return;
              await all([pc.setLocalDescription({ type: "rollback" }), pc.setRemoteDescription(rtcSdp)]);
            } else await pc.setRemoteDescription(rtcSdp);
            await flushPendingRemoteCandidates();
            await pc.setLocalDescription();
            return await emitLocalDescriptionSignal();
          }
          if (sdp.type === answerType) {
            isSettingRemoteAnswerPending = true;
            try {
              await pc.setRemoteDescription(rtcSdp);
              await flushPendingRemoteCandidates();
            } finally {
              isSettingRemoteAnswerPending = false;
            }
          }
        } catch (err) {
          (_c = handlers.error) == null ? void 0 : _c.call(handlers, toError(err, "failed to apply remote signal"));
        }
      },
      sendData: (data) => dataChannel == null ? void 0 : dataChannel.send(data),
      destroy: () => {
        clearDisconnectedCloseTimer();
        dataChannel == null ? void 0 : dataChannel.close();
        pc.close();
        makingOffer = false;
        isSettingRemoteAnswerPending = false;
        emitClose();
      },
      setHandlers: (newHandlers) => {
        const { signal, ...restHandlers } = newHandlers;
        Object.assign(handlers, restHandlers);
        if (handlers.data && pendingData.length > 0) pendingData.splice(0).forEach((data) => {
          var _a;
          return (_a = handlers.data) == null ? void 0 : _a.call(handlers, data);
        });
        if (signal) appendSignalHandler(signal);
        if ((handlers.track || handlers.stream) && pendingTracks.length > 0) pendingTracks.splice(0).forEach(({ track, stream }) => {
          var _a, _b;
          (_a = handlers.track) == null ? void 0 : _a.call(handlers, track, stream);
          (_b = handlers.stream) == null ? void 0 : _b.call(handlers, stream);
        });
      },
      offerPromise,
      addStream: (stream) => stream.getTracks().forEach((track) => pc.addTrack(track, stream)),
      removeStream: (stream) => pc.getSenders().filter((sender) => sender.track && stream.getTracks().includes(sender.track)).forEach((sender) => pc.removeTrack(sender)),
      addTrack: (track, stream) => pc.addTrack(track, stream),
      removeTrack: (track) => {
        const sender = pc.getSenders().find((s) => s.track === track);
        if (sender) pc.removeTrack(sender);
      },
      replaceTrack: (oldTrack, newTrack) => {
        const sender = pc.getSenders().find((s) => s.track === oldTrack);
        if (sender) return sender.replaceTrack(newTrack);
      }
    };
  };
  var defaultIceServers = [...alloc(3, (_, i) => `stun:stun${i || ""}.l.google.com:19302`), "stun:stun.cloudflare.com:3478"].map((url) => ({ urls: url }));

  // ../../../../node_modules/@trystero-p2p/core/dist/action-wire.mjs
  var TypedArray = Object.getPrototypeOf(Uint8Array);
  var typeByteLimit = 32;
  var typeIndex = 0;
  var nonceIndex = 32;
  var tagIndex = 34;
  var progressIndex = 35;
  var payloadIndex = 36;
  var chunkSize = 16 * 2 ** 10 - payloadIndex;
  var oneByteMax = 255;
  var twoByteMax = 65535;
  var buffLowEvent = "bufferedamountlow";
  var channelCloseEvent = "close";
  var channelErrorEvent = "error";
  var backpressureWaitTimeoutMs = 1e4;
  var toByteArray = (value) => value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  var waitForBufferedAmountLow = (channel, timeoutMs = backpressureWaitTimeoutMs) => {
    if (channel.readyState !== "open" || channel.bufferedAmount <= channel.bufferedAmountLowThreshold) return Promise.resolve(channel.readyState === "open");
    return new Promise((res) => {
      let settled = false;
      let timeout = null;
      const finish = (didDrain) => {
        if (settled) return;
        settled = true;
        channel.removeEventListener(buffLowEvent, onBufferLow);
        channel.removeEventListener(channelCloseEvent, onCloseOrError);
        channel.removeEventListener(channelErrorEvent, onCloseOrError);
        resetTimer(timeout);
        res(didDrain);
      };
      const onBufferLow = () => finish(true);
      const onCloseOrError = () => finish(false);
      channel.addEventListener(buffLowEvent, onBufferLow);
      channel.addEventListener(channelCloseEvent, onCloseOrError);
      channel.addEventListener(channelErrorEvent, onCloseOrError);
      timeout = setTimeout(() => finish(false), timeoutMs);
      if (channel.readyState !== "open") {
        finish(false);
        return;
      }
      if (channel.bufferedAmount <= channel.bufferedAmountLowThreshold) finish(true);
    });
  };
  var createActionWireManager = ({ getPeer, getPeerIds, canReceiveFromPeer, throwIfAborted: throwIfAborted3 }) => {
    const actions = {};
    const actionsCache = {};
    const pendingTransmissions = {};
    const pendingActionPayloads = {};
    const iterate = (targets, f, { includePending = false } = {}) => (targets ? Array.isArray(targets) ? targets : [targets] : getPeerIds(includePending)).flatMap((id) => {
      const peer = getPeer(id, includePending);
      if (!peer) {
        console.warn(`${libName}: no peer with id ${id} found`);
        return [];
      }
      return [Promise.resolve(f(id, peer))];
    });
    const makeInternalAction = (type, options = {}) => {
      const cached = actionsCache[type];
      if (actions[type] && cached) {
        const cachedOptions = actions[type].options;
        if (cachedOptions.sendToPending !== Boolean(options.sendToPending) || cachedOptions.receiveWhilePending !== Boolean(options.receiveWhilePending)) throw mkErr(`action type "${type}" cannot be redefined`);
        return cached;
      }
      if (!type) throw mkErr("action type argument is required");
      const typeBytes = encodeBytes(type);
      if (typeBytes.byteLength > typeByteLimit) throw mkErr(`action type string "${type}" (${typeBytes.byteLength}b) exceeds byte limit (${typeByteLimit}). Hint: choose a shorter name.`);
      const normalizedOptions = {
        sendToPending: Boolean(options.sendToPending),
        receiveWhilePending: Boolean(options.receiveWhilePending)
      };
      const typeBytesPadded = new Uint8Array(typeByteLimit);
      typeBytesPadded.set(typeBytes);
      let nonce = 0;
      actions[type] = {
        onComplete: noOp,
        onProgress: noOp,
        setOnComplete: (f) => {
          actions[type].onComplete = f;
          const pending = pendingActionPayloads[type];
          if (pending == null ? void 0 : pending.length) {
            delete pendingActionPayloads[type];
            pending.forEach(({ payload, peerId, metadata }) => f(payload, peerId, metadata));
          }
        },
        setOnProgress: (f) => {
          actions[type].onProgress = f;
        },
        send: async (data, targets, meta, onProgress, signal) => {
          throwIfAborted3(signal);
          const dataType = typeof data;
          if (dataType === "undefined") throw mkErr("action data cannot be undefined");
          const isJson = dataType !== "string";
          const isBlob = data instanceof Blob;
          const isBinary = isBlob || data instanceof ArrayBuffer || data instanceof TypedArray;
          const hasMeta = meta !== void 0;
          const buffer = isBinary ? toByteArray(isBlob ? await data.arrayBuffer() : data) : encodeBytes(isJson ? toJson(data) : data);
          const metaEncoded = hasMeta ? encodeBytes(toJson(meta)) : null;
          const chunkTotal = Math.ceil(buffer.byteLength / chunkSize) + (hasMeta ? 1 : 0) || 1;
          const chunks = alloc(chunkTotal, (_, i) => {
            const isLast = i === chunkTotal - 1;
            const isMeta = Boolean(hasMeta && i === 0);
            const chunk = new Uint8Array(payloadIndex + (isMeta ? (metaEncoded == null ? void 0 : metaEncoded.byteLength) ?? 0 : isLast ? buffer.byteLength - chunkSize * (chunkTotal - (hasMeta ? 2 : 1)) : chunkSize));
            chunk.set(typeBytesPadded);
            chunk.set([nonce >> 8, nonce & oneByteMax], nonceIndex);
            chunk.set([Number(isLast) | Number(isMeta) << 1 | Number(isBinary) << 2 | Number(isJson) << 3], tagIndex);
            chunk.set([Math.round((i + 1) / chunkTotal * oneByteMax)], progressIndex);
            chunk.set(hasMeta ? isMeta ? metaEncoded ?? new Uint8Array() : buffer.subarray((i - 1) * chunkSize, i * chunkSize) : buffer.subarray(i * chunkSize, (i + 1) * chunkSize), payloadIndex);
            return chunk;
          });
          nonce = nonce + 1 & twoByteMax;
          await all(iterate(targets, async (id, peer) => {
            const { channel } = peer;
            let chunkN = 0;
            while (chunkN < chunkTotal) {
              throwIfAborted3(signal);
              const chunk = chunks[chunkN];
              if (!chunk) break;
              if (channel && channel.bufferedAmount > channel.bufferedAmountLowThreshold) {
                const didDrain = await waitForBufferedAmountLow(channel);
                throwIfAborted3(signal);
                if (!didDrain) break;
              }
              const currentPeer = getPeer(id, normalizedOptions.sendToPending);
              if (!currentPeer || currentPeer !== peer) break;
              peer.sendData(chunk);
              chunkN++;
              const progressByte = chunk[progressIndex] ?? oneByteMax;
              onProgress == null ? void 0 : onProgress(progressByte / oneByteMax, id, meta);
            }
          }, { includePending: normalizedOptions.sendToPending }));
          return [];
        },
        options: normalizedOptions
      };
      return actionsCache[type] = {
        send: actions[type].send,
        onMessage: actions[type].setOnComplete,
        onProgress: actions[type].setOnProgress
      };
    };
    const handleData = (id, data) => {
      var _a, _b;
      const buffer = new Uint8Array(data);
      const type = decodeBytes(buffer.subarray(typeIndex, nonceIndex)).replaceAll("\0", "");
      const action = actions[type];
      if (!canReceiveFromPeer(id, Boolean(action == null ? void 0 : action.options.receiveWhilePending))) return;
      const nonce = (buffer[nonceIndex] ?? 0) << 8 | (buffer[33] ?? 0);
      const tag2 = buffer[tagIndex] ?? 0;
      const progress = buffer[progressIndex] ?? 0;
      const payload = buffer.subarray(payloadIndex);
      const isLast = Boolean(tag2 & 1);
      const isMeta = Boolean(tag2 & 2);
      const isBinary = Boolean(tag2 & 4);
      const isJson = Boolean(tag2 & 8);
      pendingTransmissions[id] ?? (pendingTransmissions[id] = {});
      (_a = pendingTransmissions[id])[type] ?? (_a[type] = {});
      const target = (_b = pendingTransmissions[id][type])[nonce] ?? (_b[nonce] = { chunks: [] });
      if (isMeta) target.meta = fromJson(decodeBytes(payload));
      else target.chunks.push(payload);
      action == null ? void 0 : action.onProgress(progress / oneByteMax, id, target.meta);
      if (!isLast) return;
      const full = new Uint8Array(target.chunks.reduce((a, c) => a + c.byteLength, 0));
      target.chunks.reduce((a, c) => {
        full.set(c, a);
        return a + c.byteLength;
      }, 0);
      delete pendingTransmissions[id][type][nonce];
      const payloadValue = isBinary ? full : isJson ? fromJson(decodeBytes(full)) : decodeBytes(full);
      if (action) {
        action.onComplete(payloadValue, id, target.meta);
        return;
      }
      (pendingActionPayloads[type] ?? (pendingActionPayloads[type] = [])).push({
        payload: payloadValue,
        peerId: id,
        ...target.meta === void 0 ? {} : { metadata: target.meta }
      });
    };
    return {
      makeInternalAction,
      handleData,
      clearPeer: (id) => {
        delete pendingTransmissions[id];
      }
    };
  };

  // ../../../../node_modules/@trystero-p2p/core/dist/actions.mjs
  var requestHandlerBufferMs = 500;
  var makeActionError = (kind, message) => {
    const error = mkErr(message);
    error.kind = kind;
    error.name = kind === "aborted" ? "AbortError" : error.name;
    return error;
  };
  var throwIfAborted = (signal) => {
    if (signal == null ? void 0 : signal.aborted) throw makeActionError("aborted", "operation aborted");
  };
  var getRequestMetadata = (metadata) => {
    if (metadata && typeof metadata === "object" && !Array.isArray(metadata) && typeof metadata.r === "string") return {
      r: metadata.r,
      ...Object.hasOwn(metadata, "m") ? { m: metadata.m } : {}
    };
    return null;
  };
  var getResponseMetadata = (metadata) => {
    if (metadata && typeof metadata === "object" && !Array.isArray(metadata) && typeof metadata.r === "string") return {
      r: metadata.r,
      ...typeof metadata.e === "string" ? { e: metadata.e } : {}
    };
    return null;
  };
  var withMetadata = (context, metadata) => metadata === void 0 ? context : {
    ...context,
    metadata
  };
  var createActionManager = ({ getPeer, getPeerIds, canReceiveFromPeer }) => {
    const publicActions = {};
    const pendingRequestWaiters = {};
    const wire = createActionWireManager({
      getPeer,
      getPeerIds,
      canReceiveFromPeer,
      throwIfAborted
    });
    const makeInternalAction = wire.makeInternalAction;
    const handleData = wire.handleData;
    const clearPendingRequestWaiter = (requestId) => {
      const waiter = pendingRequestWaiters[requestId];
      if (!waiter) return;
      resetTimer(waiter.timer);
      if (waiter.signal && waiter.abortHandler) waiter.signal.removeEventListener("abort", waiter.abortHandler);
      delete pendingRequestWaiters[requestId];
    };
    const rejectPendingRequestsForPeer = (id, error) => {
      entries(pendingRequestWaiters).forEach(([requestId, waiter]) => {
        if (waiter.peerId !== id) return;
        clearPendingRequestWaiter(requestId);
        waiter.reject(error);
      });
    };
    const clearPeer = (id, error) => {
      wire.clearPeer(id);
      rejectPendingRequestsForPeer(id, makeActionError("disconnected", toErrorMessage(error, "peer disconnected")));
    };
    const responseAction = makeInternalAction("@_response");
    responseAction.onMessage((payload, id, metadata) => {
      const parsed = getResponseMetadata(metadata);
      if (!parsed) return;
      const waiter = pendingRequestWaiters[parsed.r];
      if (!waiter || waiter.peerId !== id) return;
      clearPendingRequestWaiter(parsed.r);
      if (parsed.e !== void 0) {
        waiter.reject(makeActionError("rejected", parsed.e));
        return;
      }
      waiter.resolve(payload);
    });
    const makeActionImpl = (type, config) => {
      if (config && "onRequest" in config && config.kind !== "request") throw mkErr('request actions must use kind: "request"');
      const kind = (config == null ? void 0 : config.kind) ?? "message";
      const rawAction = makeInternalAction(type);
      const existingState = publicActions[type];
      if (existingState) {
        if (existingState.kind !== kind) throw mkErr(`action type "${type}" cannot be redefined`);
        return existingState.action;
      }
      const state = {
        kind,
        action: null,
        pendingMessages: [],
        pendingRequests: [],
        onReceiveProgress: (config == null ? void 0 : config.onReceiveProgress) ?? null
      };
      const toProgressHandler = (handler, metadata) => handler ? (progress, peerId) => handler(progress, withMetadata({ peerId }, metadata)) : void 0;
      const setReceiveProgress = (handler) => {
        state.onReceiveProgress = handler;
      };
      const dispatchReceiveProgress = (progress, peerId, metadata) => {
        var _a;
        const requestMetadata = state.kind === "request" ? getRequestMetadata(metadata) : null;
        (_a = state.onReceiveProgress) == null ? void 0 : _a.call(state, progress, withMetadata({ peerId }, requestMetadata ? requestMetadata.m : metadata));
      };
      rawAction.onProgress(dispatchReceiveProgress);
      if (kind === "message") {
        let onMessage = (config == null ? void 0 : config.onMessage) ?? null;
        const flushMessages = () => {
          if (!onMessage) return;
          const handler = onMessage;
          state.pendingMessages.splice(0).forEach(({ payload, peerId, metadata }) => {
            Promise.resolve().then(() => handler(payload, withMetadata({ peerId }, metadata))).catch((err) => console.error(`${libName} action handler error:`, err));
          });
        };
        const action2 = {
          send: async (data, options = {}) => {
            await rawAction.send(data, options.target, options.metadata, toProgressHandler(options.onProgress, options.metadata), options.signal);
          },
          get onMessage() {
            return onMessage;
          },
          set onMessage(handler) {
            onMessage = handler;
            flushMessages();
          },
          get onReceiveProgress() {
            return state.onReceiveProgress;
          },
          set onReceiveProgress(handler) {
            setReceiveProgress(handler);
          }
        };
        rawAction.onMessage((payload, peerId, metadata) => {
          if (!onMessage) {
            state.pendingMessages.push(metadata === void 0 ? {
              payload,
              peerId
            } : {
              payload,
              peerId,
              metadata
            });
            return;
          }
          const handler = onMessage;
          Promise.resolve().then(() => handler(payload, withMetadata({ peerId }, metadata))).catch((err) => console.error(`${libName} action handler error:`, err));
        });
        state.action = action2;
        publicActions[type] = state;
        flushMessages();
        return action2;
      }
      let onRequest = (config == null ? void 0 : config.onRequest) ?? null;
      const removePendingIncomingRequest = (request) => {
        resetTimer(request.timer);
        const i = state.pendingRequests.indexOf(request);
        if (i > -1) state.pendingRequests.splice(i, 1);
      };
      const sendRequestError = (peerId, requestId, error) => {
        responseAction.send(null, peerId, {
          r: requestId,
          e: toErrorMessage(error, "request failed")
        });
      };
      const respondToIncomingRequest = (request, handler) => {
        removePendingIncomingRequest(request);
        Promise.resolve().then(() => handler(request.payload, {
          peerId: request.peerId,
          ...request.metadata === void 0 ? {} : { metadata: request.metadata },
          signal: request.controller.signal
        })).then(async (response) => {
          if (response === void 0) throw mkErr("request handler returned undefined");
          await responseAction.send(response, request.peerId, { r: request.requestId });
        }).catch((err) => sendRequestError(request.peerId, request.requestId, err)).finally(() => request.controller.abort());
      };
      const flushRequests = () => {
        if (!onRequest) return;
        state.pendingRequests.slice().forEach((request) => respondToIncomingRequest(request, onRequest));
      };
      const queueIncomingRequest = (payload, peerId, metadata, requestId) => {
        if (onRequest) {
          respondToIncomingRequest({
            payload,
            peerId,
            ...metadata === void 0 ? {} : { metadata },
            requestId,
            controller: new AbortController(),
            timer: null
          }, onRequest);
          return;
        }
        const request = {
          payload,
          peerId,
          ...metadata === void 0 ? {} : { metadata },
          requestId,
          controller: new AbortController(),
          timer: setTimeout(() => {
            removePendingIncomingRequest(request);
            request.controller.abort();
            sendRequestError(peerId, requestId, "request handler unavailable");
          }, requestHandlerBufferMs)
        };
        state.pendingRequests.push(request);
      };
      const requestOne = async (data, options) => {
        const { target, metadata, onProgress, signal, timeoutMs } = options;
        throwIfAborted(signal);
        if (!getPeer(target, false)) throw makeActionError("disconnected", `no active peer with id ${target}`);
        const requestId = genId(20);
        const handledResponsePromise = new Promise((resolve, reject) => {
          const waiter = {
            peerId: target,
            resolve,
            reject,
            timer: null,
            ...signal === void 0 ? {} : { signal }
          };
          const rejectAsAborted = () => {
            clearPendingRequestWaiter(requestId);
            reject(makeActionError("aborted", "operation aborted"));
          };
          if (signal) {
            waiter.abortHandler = rejectAsAborted;
            signal.addEventListener("abort", rejectAsAborted, { once: true });
          }
          pendingRequestWaiters[requestId] = waiter;
        }).catch((err) => {
          throw err;
        });
        try {
          await rawAction.send(data, target, metadata === void 0 ? { r: requestId } : {
            r: requestId,
            m: metadata
          }, toProgressHandler(onProgress, metadata), signal);
          const waiter = pendingRequestWaiters[requestId];
          if (waiter && timeoutMs !== void 0) waiter.timer = setTimeout(() => {
            clearPendingRequestWaiter(requestId);
            waiter.reject(makeActionError("timeout", "request timed out"));
          }, timeoutMs);
          return await handledResponsePromise;
        } catch (err) {
          clearPendingRequestWaiter(requestId);
          throw err;
        }
      };
      const action = {
        request: requestOne,
        requestMany: async (data, options) => {
          throwIfAborted(options.signal);
          return await all(options.targets.map(async (target) => {
            var _a, _b;
            try {
              const result = {
                peerId: target,
                status: "fulfilled",
                value: await requestOne(data, {
                  target,
                  ...options.metadata === void 0 ? {} : { metadata: options.metadata },
                  ...options.timeoutMs === void 0 ? {} : { timeoutMs: options.timeoutMs },
                  ...options.onProgress === void 0 ? {} : { onProgress: options.onProgress },
                  ...options.signal === void 0 ? {} : { signal: options.signal }
                })
              };
              (_a = options.onResult) == null ? void 0 : _a.call(options, result);
              return result;
            } catch (err) {
              const error = toError(err, "request failed");
              if (error.kind === "aborted" || !error.kind) throw error;
              const result = error.kind === "timeout" ? {
                peerId: target,
                status: "timeout"
              } : error.kind === "disconnected" ? {
                peerId: target,
                status: "disconnected"
              } : {
                peerId: target,
                status: "rejected",
                error
              };
              (_b = options.onResult) == null ? void 0 : _b.call(options, result);
              return result;
            }
          }));
        },
        get onRequest() {
          return onRequest;
        },
        set onRequest(handler) {
          onRequest = handler;
          flushRequests();
        },
        get onReceiveProgress() {
          return state.onReceiveProgress;
        },
        set onReceiveProgress(handler) {
          setReceiveProgress(handler);
        }
      };
      rawAction.onMessage((payload, peerId, metadata) => {
        const requestMetadata = getRequestMetadata(metadata);
        if (!requestMetadata) return;
        queueIncomingRequest(payload, peerId, requestMetadata.m, requestMetadata.r);
      });
      state.action = action;
      publicActions[type] = state;
      flushRequests();
      return action;
    };
    return {
      makeAction: makeActionImpl,
      makeInternalAction,
      handleData,
      clearPeer
    };
  };

  // ../../../../node_modules/@trystero-p2p/core/dist/media.mjs
  var toPendingMediaMeta = (value) => {
    if (value && typeof value === "object" && !Array.isArray(value) && typeof value.k === "string") return {
      key: value.k,
      ...typeof value.s === "string" ? { streamId: value.s } : {},
      ...typeof value.t === "string" ? { trackId: value.t } : {},
      ...Object.hasOwn(value, "m") ? { metadata: value.m } : {}
    };
    return null;
  };
  var makeKeyGetter = (map) => (item) => {
    let key = map.get(item);
    if (!key) {
      key = genId(20);
      map.set(item, key);
    }
    return key;
  };
  var createMediaIdentityCache = () => {
    const localStreamKeys = /* @__PURE__ */ new WeakMap();
    const localTrackKeys = /* @__PURE__ */ new WeakMap();
    const remoteStreamsByKey = /* @__PURE__ */ new Map();
    const remoteStreamsById = /* @__PURE__ */ new Map();
    const remoteTracksByKey = /* @__PURE__ */ new Map();
    const remoteTracksById = /* @__PURE__ */ new Map();
    return {
      getStreamKey: makeKeyGetter(localStreamKeys),
      getTrackKey: makeKeyGetter(localTrackKeys),
      rememberRemoteStream: (key, stream, streamId) => {
        remoteStreamsByKey.set(key, stream);
        if (streamId) remoteStreamsById.set(streamId, stream);
      },
      getRemoteStream: (key, streamId) => remoteStreamsByKey.get(key) ?? (streamId ? remoteStreamsById.get(streamId) : void 0),
      rememberRemoteTrack: (key, track, stream, trackId, streamId) => {
        const ref = {
          track,
          stream
        };
        remoteTracksByKey.set(key, ref);
        if (trackId) remoteTracksById.set(trackId, ref);
        if (streamId) remoteStreamsById.set(streamId, stream);
      },
      getRemoteTrack: (key, trackId) => remoteTracksByKey.get(key) ?? (trackId ? remoteTracksById.get(trackId) : void 0),
      clearRemote: () => {
        remoteStreamsByKey.clear();
        remoteStreamsById.clear();
        remoteTracksByKey.clear();
        remoteTracksById.clear();
      }
    };
  };
  var createMediaManager = ({ iterate, isActive, getSharedMediaPeer }) => {
    const pendingStreamMetas = {};
    const pendingTrackMetas = {};
    const localMedia = createMediaIdentityCache();
    const listeners = {
      onPeerStream: null,
      onPeerTrack: null
    };
    const emitStream = (id, key, stream, metadata) => {
      var _a, _b, _c;
      if (!isActive(id)) return;
      (_b = (_a = getSharedMediaPeer(id)) == null ? void 0 : _a.__trysteroMedia) == null ? void 0 : _b.rememberRemoteStream(key, stream, typeof stream.id === "string" ? stream.id : void 0);
      (_c = listeners.onPeerStream) == null ? void 0 : _c.call(listeners, stream, id, metadata);
    };
    const emitTrack = (id, key, track, stream, metadata) => {
      var _a, _b, _c;
      if (!isActive(id)) return;
      (_b = (_a = getSharedMediaPeer(id)) == null ? void 0 : _a.__trysteroMedia) == null ? void 0 : _b.rememberRemoteTrack(key, track, stream, typeof track.id === "string" ? track.id : void 0, typeof stream.id === "string" ? stream.id : void 0);
      (_c = listeners.onPeerTrack) == null ? void 0 : _c.call(listeners, track, stream, id, metadata);
    };
    const applyMediaOp = (targets, key, metadata, sendMeta, op, mediaIds = {}) => {
      const payload = {
        k: key,
        ...mediaIds,
        ...metadata === void 0 ? {} : { m: metadata }
      };
      return iterate(targets, async (id, peer) => {
        await sendMeta(payload, id);
        op(peer);
      });
    };
    return {
      addStream: (stream, options, sendMeta) => applyMediaOp(options.target, localMedia.getStreamKey(stream), options.metadata, sendMeta, (peer) => peer.addStream(stream), { s: stream.id }),
      removeStream: (stream, target) => {
        iterate(target, (_, peer) => peer.removeStream(stream));
      },
      addTrack: (track, stream, options, sendMeta) => applyMediaOp(options.target, localMedia.getTrackKey(track), options.metadata, sendMeta, (peer) => peer.addTrack(track, stream), {
        s: stream.id,
        t: track.id
      }),
      removeTrack: (track, target) => {
        iterate(target, (_, peer) => peer.removeTrack(track));
      },
      replaceTrack: (oldTrack, newTrack, options, sendMeta) => applyMediaOp(options.target, localMedia.getTrackKey(newTrack), options.metadata, sendMeta, (peer) => peer.replaceTrack(oldTrack, newTrack), { t: oldTrack.id }),
      receiveStreamMeta: (meta, id) => {
        var _a, _b;
        if (!isActive(id)) return;
        const parsed = toPendingMediaMeta(meta);
        if (!parsed) return;
        const cached = (_b = (_a = getSharedMediaPeer(id)) == null ? void 0 : _a.__trysteroMedia) == null ? void 0 : _b.getRemoteStream(parsed.key, parsed.streamId);
        if (cached) {
          emitStream(id, parsed.key, cached, parsed.metadata);
          return;
        }
        (pendingStreamMetas[id] ?? (pendingStreamMetas[id] = [])).push(parsed);
      },
      receiveTrackMeta: (meta, id) => {
        var _a, _b;
        if (!isActive(id)) return;
        const parsed = toPendingMediaMeta(meta);
        if (!parsed) return;
        const cached = (_b = (_a = getSharedMediaPeer(id)) == null ? void 0 : _a.__trysteroMedia) == null ? void 0 : _b.getRemoteTrack(parsed.key, parsed.trackId);
        if (cached) {
          emitTrack(id, parsed.key, cached.track, cached.stream, parsed.metadata);
          return;
        }
        (pendingTrackMetas[id] ?? (pendingTrackMetas[id] = [])).push(parsed);
      },
      receiveRemoteStream: (id, stream) => {
        var _a;
        if (!isActive(id)) return;
        const next = (_a = pendingStreamMetas[id]) == null ? void 0 : _a.shift();
        if (!next) return;
        emitStream(id, next.key, stream, next.metadata);
      },
      receiveRemoteTrack: (id, track, stream) => {
        var _a;
        if (!isActive(id)) return;
        const next = (_a = pendingTrackMetas[id]) == null ? void 0 : _a.shift();
        if (!next) return;
        emitTrack(id, next.key, track, stream, next.metadata);
      },
      clearPeer: (id) => {
        delete pendingStreamMetas[id];
        delete pendingTrackMetas[id];
      },
      get onPeerStream() {
        return listeners.onPeerStream;
      },
      set onPeerStream(handler) {
        listeners.onPeerStream = handler;
      },
      get onPeerTrack() {
        return listeners.onPeerTrack;
      },
      set onPeerTrack(handler) {
        listeners.onPeerTrack = handler;
      }
    };
  };

  // ../../../../node_modules/@trystero-p2p/core/dist/room.mjs
  var unloadEvent = "beforeunload";
  var defaultHandshakeTimeoutMs = 1e4;
  var internalNs = (ns) => "@_" + ns;
  var beforeUnloadRoomCleanups = /* @__PURE__ */ new Set();
  var cleanupActiveRoomsOnBeforeUnload = () => beforeUnloadRoomCleanups.forEach((cleanup) => cleanup());
  var registerBeforeUnloadCleanup = (cleanup) => {
    beforeUnloadRoomCleanups.add(cleanup);
    if (beforeUnloadRoomCleanups.size === 1) addEventListener(unloadEvent, cleanupActiveRoomsOnBeforeUnload);
    return () => {
      beforeUnloadRoomCleanups.delete(cleanup);
      if (!beforeUnloadRoomCleanups.size) removeEventListener(unloadEvent, cleanupActiveRoomsOnBeforeUnload);
    };
  };
  var room_default = (onPeer, onPeerLeave, onSelfLeave, { onPeerHandshake, onHandshakeError, handshakeTimeoutMs = defaultHandshakeTimeoutMs, isPassive = false } = {}) => {
    const peerMap = {};
    const activePeerMap = {};
    const pendingPongs = {};
    const listeners = {
      onPeerJoin: null,
      onPeerLeave: null
    };
    let unregisterBeforeUnloadCleanup = noOp;
    let handshakeManager = null;
    const iterate = (targets, f, { includePending = false } = {}) => (targets ? Array.isArray(targets) ? targets : [targets] : keys(includePending ? peerMap : activePeerMap)).flatMap((id) => {
      const peer = includePending ? peerMap[id] : activePeerMap[id];
      if (!peer) {
        console.warn(`${libName}: no peer with id ${id} found`);
        return [];
      }
      return [Promise.resolve(f(id, peer))];
    });
    const mediaManager = createMediaManager({
      iterate: (targets, f) => iterate(targets, (id, peer) => f(id, peer)),
      isActive: (id) => Boolean(activePeerMap[id]),
      getSharedMediaPeer: (id) => peerMap[id] ?? null
    });
    const actionManager = createActionManager({
      getPeer: (id, includePending) => (includePending ? peerMap : activePeerMap)[id],
      getPeerIds: (includePending) => keys(includePending ? peerMap : activePeerMap),
      canReceiveFromPeer: (id, receiveWhilePending) => Boolean(handshakeManager == null ? void 0 : handshakeManager.canReceiveFromPeer(id, receiveWhilePending))
    });
    const makeActionInternal = actionManager.makeInternalAction;
    const handleData = actionManager.handleData;
    const makeAction = actionManager.makeAction;
    const clearPeerState = (id, reason = mkErr("peer disconnected")) => {
      var _a;
      const err = toError(reason, "peer disconnected");
      handshakeManager == null ? void 0 : handshakeManager.clearPeer(id, err);
      delete peerMap[id];
      delete activePeerMap[id];
      actionManager.clearPeer(id, err);
      (_a = pendingPongs[id]) == null ? void 0 : _a.splice(0).forEach((waiter) => waiter.reject(err));
      delete pendingPongs[id];
      mediaManager.clearPeer(id);
    };
    const exitPeer = (id, peer, reason) => {
      var _a;
      const current = peerMap[id];
      if (!current) return;
      if (peer && current !== peer) return;
      const wasActive = Boolean(activePeerMap[id]);
      clearPeerState(id, reason);
      current.destroy();
      if (wasActive) (_a = listeners.onPeerLeave) == null ? void 0 : _a.call(listeners, id);
      onPeerLeave(id);
    };
    const leave = async () => {
      await leaveAction.send("");
      await new Promise((res) => setTimeout(res, 99));
      entries(peerMap).forEach(([id, peer]) => {
        peer.destroy();
        clearPeerState(id, mkErr("room left"));
      });
      unregisterBeforeUnloadCleanup();
      onSelfLeave();
    };
    const pingAction = makeActionInternal(internalNs("ping"));
    const pongAction = makeActionInternal(internalNs("pong"));
    const signalAction = makeActionInternal(internalNs("signal"));
    const streamMetaAction = makeActionInternal(internalNs("stream"));
    const trackMetaAction = makeActionInternal(internalNs("track"));
    const leaveAction = makeActionInternal(internalNs("leave"), {
      sendToPending: true,
      receiveWhilePending: true
    });
    const handshakeDataAction = makeActionInternal(internalNs("hsdata"), {
      sendToPending: true,
      receiveWhilePending: true
    });
    const handshakeReadyAction = makeActionInternal(internalNs("hsready"), {
      sendToPending: true,
      receiveWhilePending: true
    });
    handshakeManager = createHandshakeManager({
      ...onPeerHandshake === void 0 ? {} : { onPeerHandshake },
      ...onHandshakeError === void 0 ? {} : { onHandshakeError },
      handshakeTimeoutMs,
      sendHandshakeData: handshakeDataAction.send,
      sendHandshakeReady: handshakeReadyAction.send,
      onActivate: (id, peer) => {
        var _a;
        activePeerMap[id] = peer;
        (_a = listeners.onPeerJoin) == null ? void 0 : _a.call(listeners, id);
      },
      onFailure: (id, peer, reason) => exitPeer(id, peer, reason)
    });
    pingAction.onMessage((_, id) => pongAction.send("", id));
    pongAction.onMessage((_, id) => {
      var _a;
      const queue = pendingPongs[id];
      (_a = queue == null ? void 0 : queue.shift()) == null ? void 0 : _a.resolve();
      if (queue && !queue.length) delete pendingPongs[id];
    });
    signalAction.onMessage((sdp, id) => {
      var _a;
      if (!activePeerMap[id]) return;
      (_a = peerMap[id]) == null ? void 0 : _a.signal(sdp);
    });
    streamMetaAction.onMessage((meta, id) => mediaManager.receiveStreamMeta(meta, id));
    trackMetaAction.onMessage((meta, id) => mediaManager.receiveTrackMeta(meta, id));
    leaveAction.onMessage((_, id) => exitPeer(id, void 0, mkErr("peer left room")));
    handshakeDataAction.onMessage((data, id, metadata) => handshakeManager == null ? void 0 : handshakeManager.receiveHandshakeData(data, id, metadata));
    handshakeReadyAction.onMessage((_, id) => handshakeManager == null ? void 0 : handshakeManager.receiveHandshakeReady(id));
    onPeer((peer, id) => {
      const existingPeer = peerMap[id];
      if (existingPeer) {
        if (existingPeer === peer) return;
        existingPeer.destroy();
        clearPeerState(id, mkErr("peer replaced"));
      }
      peerMap[id] = peer;
      handshakeManager == null ? void 0 : handshakeManager.addPeer(id, peer);
      peer.setHandlers({
        data: (d) => handleData(id, d),
        stream: (stream) => mediaManager.receiveRemoteStream(id, stream),
        track: (track, stream) => mediaManager.receiveRemoteTrack(id, track, stream),
        signal: (sdp) => {
          if (!activePeerMap[id]) return;
          signalAction.send(sdp, id);
        },
        close: () => exitPeer(id, peer, mkErr("peer disconnected")),
        error: (err) => {
          console.error(`${libName} peer error:`, err);
          exitPeer(id, peer, err);
        }
      });
      handshakeManager == null ? void 0 : handshakeManager.start(id, peer);
    });
    if (isBrowser) unregisterBeforeUnloadCleanup = registerBeforeUnloadCleanup(() => leave().catch(noOp));
    return {
      makeAction,
      leave,
      ping: async (id) => {
        if (!activePeerMap[id]) throw mkErr(`no active peer with id ${id}`);
        const start = Date.now();
        await new Promise((resolve, reject) => {
          const queue = pendingPongs[id] ?? (pendingPongs[id] = []);
          const clearFromQueue = () => {
            const currentQueue = pendingPongs[id];
            if (!currentQueue) return;
            const i = currentQueue.indexOf(waiter);
            if (i > -1) currentQueue.splice(i, 1);
            if (!currentQueue.length) delete pendingPongs[id];
          };
          const waiter = {
            resolve: () => {
              clearFromQueue();
              resolve();
            },
            reject: (reason) => {
              clearFromQueue();
              reject(reason);
            }
          };
          queue.push(waiter);
          pingAction.send("", id).catch((err) => waiter.reject(toError(err, "peer disconnected")));
        });
        return Date.now() - start;
      },
      isPassive: () => isPassive,
      getPeers: () => fromEntries(entries(activePeerMap).map(([id, peer]) => [id, peer.connection])),
      addStream: (stream, options = {}) => mediaManager.addStream(stream, options, streamMetaAction.send),
      removeStream: (stream, options = {}) => {
        mediaManager.removeStream(stream, options.target);
      },
      addTrack: (track, stream, options = {}) => mediaManager.addTrack(track, stream, options, trackMetaAction.send),
      removeTrack: (track, options = {}) => {
        mediaManager.removeTrack(track, options.target);
      },
      replaceTrack: (oldTrack, newTrack, options = {}) => mediaManager.replaceTrack(oldTrack, newTrack, options, trackMetaAction.send),
      get onPeerJoin() {
        return listeners.onPeerJoin;
      },
      set onPeerJoin(handler) {
        listeners.onPeerJoin = handler;
        if (handler) keys(activePeerMap).forEach((peerId) => handler(peerId));
      },
      get onPeerLeave() {
        return listeners.onPeerLeave;
      },
      set onPeerLeave(handler) {
        listeners.onPeerLeave = handler;
      },
      get onPeerStream() {
        return mediaManager.onPeerStream;
      },
      set onPeerStream(handler) {
        mediaManager.onPeerStream = handler;
      },
      get onPeerTrack() {
        return mediaManager.onPeerTrack;
      },
      set onPeerTrack(handler) {
        mediaManager.onPeerTrack = handler;
      }
    };
  };

  // ../../../../node_modules/@trystero-p2p/core/dist/shared-peer.mjs
  var roomFrameVersion = 1;
  var roomPresenceFrameVersion = 2;
  var wrapRoomFrame = (roomToken, data) => {
    const tokenBytes = encodeBytes(roomToken);
    const frame = new Uint8Array(3 + tokenBytes.byteLength + data.byteLength);
    frame[0] = roomFrameVersion;
    frame[1] = tokenBytes.byteLength >>> 8 & 255;
    frame[2] = tokenBytes.byteLength & 255;
    frame.set(tokenBytes, 3);
    frame.set(data, 3 + tokenBytes.byteLength);
    return frame;
  };
  var wrapRoomPresenceFrame = (roomToken, isPresent) => {
    const tokenBytes = encodeBytes(roomToken);
    const frame = new Uint8Array(4 + tokenBytes.byteLength);
    frame[0] = roomPresenceFrameVersion;
    frame[1] = Number(isPresent);
    frame[2] = tokenBytes.byteLength >>> 8 & 255;
    frame[3] = tokenBytes.byteLength & 255;
    frame.set(tokenBytes, 4);
    return frame;
  };
  var unwrapFrame = (data) => {
    const buffer = new Uint8Array(data);
    if (buffer.byteLength < 3) return null;
    if (buffer[0] === roomFrameVersion) {
      const tokenSize2 = (buffer[1] ?? 0) << 8 | (buffer[2] ?? 0);
      const headerSize2 = 3 + tokenSize2;
      if (tokenSize2 <= 0 || buffer.byteLength < headerSize2) return null;
      return {
        type: "room",
        roomToken: decodeBytes(buffer.subarray(3, headerSize2)),
        payload: buffer.subarray(headerSize2).slice().buffer
      };
    }
    if (buffer[0] !== roomPresenceFrameVersion || buffer.byteLength < 4) return null;
    const tokenSize = (buffer[2] ?? 0) << 8 | (buffer[3] ?? 0);
    const headerSize = 4 + tokenSize;
    if (tokenSize <= 0 || buffer.byteLength < headerSize) return null;
    return {
      type: "presence",
      roomToken: decodeBytes(buffer.subarray(4, headerSize)),
      isPresent: buffer[1] === 1
    };
  };
  var isPeerUnderlyingStale = (peer) => {
    const { connection, channel } = peer;
    return peer.isDead || connection.connectionState === "closed" || connection.connectionState === "failed" || connection.iceConnectionState === "closed" || connection.iceConnectionState === "failed" || (channel == null ? void 0 : channel.readyState) === "closing" || (channel == null ? void 0 : channel.readyState) === "closed";
  };
  var getConnectedPeerHealth = (peer) => {
    if (isPeerUnderlyingStale(peer)) return "stale";
    const { channel } = peer;
    if (!channel || channel.readyState !== "open") return "transient";
    return "live";
  };
  var SharedPeerManager = class {
    constructor() {
      __publicField(this, "byApp", {});
      __publicField(this, "roomPresenceHandlers", {});
    }
    getMap(appId) {
      var _a;
      return (_a = this.byApp)[appId] ?? (_a[appId] = {});
    }
    get(appId, peerId) {
      var _a;
      return (_a = this.byApp[appId]) == null ? void 0 : _a[peerId];
    }
    isPeerStale(peer) {
      return isPeerUnderlyingStale(peer);
    }
    getHealth(peer) {
      return this.isPeerStale(peer) ? "stale" : "live";
    }
    setRoomPresenceHandler(appId, handler) {
      this.roomPresenceHandlers[appId] = handler;
      return () => {
        if (this.roomPresenceHandlers[appId] === handler) delete this.roomPresenceHandlers[appId];
      };
    }
    sendRoomPresence(shared, roomToken, isPresent) {
      if (shared.isClosing || shared.peer.isDead) return;
      shared.peer.sendData(wrapRoomPresenceFrame(roomToken, isPresent));
    }
    clear(appId, peerId, { destroyPeer }) {
      const map = this.byApp[appId];
      const shared = map == null ? void 0 : map[peerId];
      if (!shared || shared.isClosing) return;
      shared.idleTimer = resetTimer(shared.idleTimer);
      shared.isClosing = true;
      if (destroyPeer && !shared.peer.isDead) shared.peer.destroy();
      const bindings = values(shared.bindings);
      shared.bindings = {};
      shared.bindingsByToken = {};
      shared.controlRoomId = null;
      delete map[peerId];
      bindings.forEach((binding) => {
        var _a, _b;
        (_b = (_a = binding.handlers).close) == null ? void 0 : _b.call(_a);
        binding.pendingData.length = 0;
        binding.pendingSendData.length = 0;
        binding.pendingTracks.length = 0;
      });
      shared.media.clearRemote();
      shared.pendingDataByToken.clear();
      shared.remoteRoomTokens.clear();
      if (keys(map).length === 0) delete this.byApp[appId];
    }
    register(appId, peerId, peer, idleMs) {
      const map = this.getMap(appId);
      const existing = map[peerId];
      if (existing) {
        existing.idleTimer = resetTimer(existing.idleTimer);
        if (existing.peer === peer) return existing;
        this.clear(appId, peerId, { destroyPeer: true });
      }
      const shared = {
        appId,
        peerId,
        peer,
        bindings: {},
        bindingsByToken: {},
        pendingDataByToken: /* @__PURE__ */ new Map(),
        remoteRoomTokens: /* @__PURE__ */ new Set(),
        idleTimer: null,
        controlRoomId: null,
        streamOwners: /* @__PURE__ */ new Map(),
        trackOwners: /* @__PURE__ */ new Map(),
        media: createMediaIdentityCache(),
        idleMs,
        isClosing: false
      };
      peer.setHandlers({
        data: (data) => this.dispatchData(shared, data),
        signal: (signal) => this.dispatchSignal(shared, signal),
        close: () => this.clear(appId, peerId, { destroyPeer: false }),
        error: (err) => {
          console.error(`${libName} peer error:`, err);
          this.clear(appId, peerId, { destroyPeer: false });
        },
        track: (track, stream) => this.dispatchTrack(shared, track, stream)
      });
      map[peerId] = shared;
      return shared;
    }
    bind(roomId, roomTokenPromise, shared, { onDetach }) {
      const existingBinding = shared.bindings[roomId];
      if (existingBinding) {
        shared.idleTimer = resetTimer(shared.idleTimer);
        return {
          proxy: existingBinding.proxy,
          isNew: false
        };
      }
      const binding = {
        roomId,
        roomToken: null,
        roomTokenPromise,
        handlers: {},
        pendingData: [],
        pendingSendData: [],
        pendingTracks: [],
        detach: noOp,
        proxy: {}
      };
      const detachBinding = () => {
        if (!shared.bindings[roomId]) return;
        this.pruneRoomOwnership(shared, roomId);
        delete shared.bindings[roomId];
        if (binding.roomToken && shared.bindingsByToken[binding.roomToken] === binding) delete shared.bindingsByToken[binding.roomToken];
        if (shared.controlRoomId === roomId) shared.controlRoomId = keys(shared.bindings)[0] ?? null;
        onDetach();
        this.scheduleIdleTimer(shared);
      };
      const proxy = {
        created: shared.peer.created,
        get connection() {
          return shared.peer.connection;
        },
        get channel() {
          return shared.peer.channel;
        },
        get isDead() {
          return shared.peer.isDead;
        },
        getOffer: (restartIce) => shared.peer.getOffer(restartIce),
        signal: (sdp) => shared.peer.signal(sdp),
        sendData: (data) => {
          if (!binding.roomToken) {
            binding.pendingSendData.push(data);
            return;
          }
          shared.peer.sendData(wrapRoomFrame(binding.roomToken, data));
        },
        destroy: () => detachBinding(),
        setHandlers: (newHandlers) => {
          const { signal, ...rest } = newHandlers;
          Object.assign(binding.handlers, rest);
          if (signal) binding.handlers.signal = signal;
          this.flushBindingQueues(binding);
        },
        offerPromise: shared.peer.offerPromise,
        addStream: (stream) => {
          const owners = shared.streamOwners.get(stream) ?? /* @__PURE__ */ new Set();
          const shouldAttach = owners.size === 0;
          owners.add(roomId);
          shared.streamOwners.set(stream, owners);
          if (shouldAttach) shared.peer.addStream(stream);
        },
        removeStream: (stream) => {
          const owners = shared.streamOwners.get(stream);
          if (!owners) return;
          owners.delete(roomId);
          if (owners.size === 0) {
            shared.streamOwners.delete(stream);
            shared.peer.removeStream(stream);
          }
        },
        addTrack: (track, stream) => {
          const entry = shared.trackOwners.get(track) ?? {
            stream,
            rooms: /* @__PURE__ */ new Set()
          };
          const shouldAttach = entry.rooms.size === 0;
          entry.stream = stream;
          entry.rooms.add(roomId);
          shared.trackOwners.set(track, entry);
          if (shouldAttach) return shared.peer.addTrack(track, stream);
          return shared.peer.connection.getSenders().find((s) => s.track === track) ?? shared.peer.addTrack(track, stream);
        },
        removeTrack: (track) => {
          const entry = shared.trackOwners.get(track);
          if (!entry) return;
          entry.rooms.delete(roomId);
          if (entry.rooms.size === 0) {
            shared.trackOwners.delete(track);
            shared.peer.removeTrack(track);
          }
        },
        replaceTrack: (oldTrack, newTrack) => {
          const oldEntry = shared.trackOwners.get(oldTrack);
          if (oldEntry) {
            shared.trackOwners.delete(oldTrack);
            const nextEntry = shared.trackOwners.get(newTrack) ?? {
              stream: oldEntry.stream,
              rooms: /* @__PURE__ */ new Set()
            };
            oldEntry.rooms.forEach((room) => nextEntry.rooms.add(room));
            shared.trackOwners.set(newTrack, nextEntry);
          }
          return shared.peer.replaceTrack(oldTrack, newTrack);
        },
        __trysteroMedia: shared.media
      };
      binding.proxy = proxy;
      binding.detach = detachBinding;
      shared.bindings[roomId] = binding;
      shared.controlRoomId ?? (shared.controlRoomId = roomId);
      shared.idleTimer = resetTimer(shared.idleTimer);
      roomTokenPromise.then((roomToken) => {
        if (shared.isClosing || shared.bindings[roomId] !== binding) return;
        binding.roomToken = roomToken;
        shared.bindingsByToken[roomToken] = binding;
        const pendingData = shared.pendingDataByToken.get(roomToken);
        if (pendingData == null ? void 0 : pendingData.length) {
          binding.pendingData.push(...pendingData);
          shared.pendingDataByToken.delete(roomToken);
        }
        binding.pendingSendData.splice(0).forEach((payload) => shared.peer.sendData(wrapRoomFrame(roomToken, payload)));
        this.flushBindingQueues(binding);
      });
      return {
        proxy,
        isNew: true
      };
    }
    pruneRoomOwnership(shared, roomIdToRemove) {
      shared.streamOwners.forEach((rooms, stream) => {
        rooms.delete(roomIdToRemove);
        if (rooms.size === 0) {
          shared.streamOwners.delete(stream);
          shared.peer.removeStream(stream);
        }
      });
      shared.trackOwners.forEach((entry, track) => {
        entry.rooms.delete(roomIdToRemove);
        if (entry.rooms.size === 0) {
          shared.trackOwners.delete(track);
          shared.peer.removeTrack(track);
        }
      });
    }
    scheduleIdleTimer(shared) {
      if (shared.isClosing || keys(shared.bindings).length > 0) return;
      shared.idleTimer = resetTimer(shared.idleTimer);
      shared.idleTimer = setTimeout(() => {
        var _a;
        const current = (_a = this.byApp[shared.appId]) == null ? void 0 : _a[shared.peerId];
        if (!current || keys(current.bindings).length > 0) return;
        this.clear(shared.appId, shared.peerId, { destroyPeer: true });
      }, shared.idleMs);
    }
    getSignalBinding(shared) {
      if (shared.controlRoomId) {
        const selected = shared.bindings[shared.controlRoomId];
        if (selected == null ? void 0 : selected.handlers.signal) return selected;
      }
      const fallback = values(shared.bindings).find((binding) => Boolean(binding.handlers.signal));
      if (!fallback) return null;
      shared.controlRoomId = fallback.roomId;
      return fallback;
    }
    flushBindingQueues(binding) {
      const { handlers } = binding;
      if (handlers.data && binding.pendingData.length > 0) binding.pendingData.splice(0).forEach((payload) => {
        var _a;
        return (_a = handlers.data) == null ? void 0 : _a.call(handlers, payload);
      });
      if ((handlers.track || handlers.stream) && binding.pendingTracks.length) binding.pendingTracks.splice(0).forEach(({ track, stream }) => {
        var _a, _b;
        (_a = handlers.track) == null ? void 0 : _a.call(handlers, track, stream);
        (_b = handlers.stream) == null ? void 0 : _b.call(handlers, stream);
      });
    }
    dispatchData(shared, data) {
      var _a, _b;
      const decoded = unwrapFrame(data);
      if (!decoded) return;
      if (decoded.type === "presence") {
        if (decoded.isPresent) shared.remoteRoomTokens.add(decoded.roomToken);
        else shared.remoteRoomTokens.delete(decoded.roomToken);
        (_b = (_a = this.roomPresenceHandlers)[shared.appId]) == null ? void 0 : _b.call(_a, shared.peerId, decoded.roomToken, decoded.isPresent);
        return;
      }
      const binding = shared.bindingsByToken[decoded.roomToken];
      if (!binding) {
        const pending = shared.pendingDataByToken.get(decoded.roomToken) ?? [];
        pending.push(decoded.payload);
        shared.pendingDataByToken.set(decoded.roomToken, pending);
        return;
      }
      if (binding.handlers.data) binding.handlers.data(decoded.payload);
      else binding.pendingData.push(decoded.payload);
    }
    dispatchSignal(shared, signal) {
      var _a, _b, _c;
      (_c = (_a = this.getSignalBinding(shared)) == null ? void 0 : (_b = _a.handlers).signal) == null ? void 0 : _c.call(_b, signal);
    }
    dispatchTrack(shared, track, stream) {
      values(shared.bindings).forEach((binding) => {
        var _a, _b, _c, _d;
        if (binding.handlers.track || binding.handlers.stream) {
          (_b = (_a = binding.handlers).track) == null ? void 0 : _b.call(_a, track, stream);
          (_d = (_c = binding.handlers).stream) == null ? void 0 : _d.call(_c, stream);
          return;
        }
        binding.pendingTracks.push({
          track,
          stream
        });
      });
    }
  };

  // ../../../../node_modules/@trystero-p2p/core/dist/signal-handler.mjs
  var offerPostAnswerTtlMs = 23333;
  var offerIdSize = 12;
  var disconnectedPeerGraceMs = 7533;
  var answeringTtlMs = 23333;
  var legacyCandidateKey = "__legacy__";
  var offerRelayPlaceholder = "offer-placeholder";
  var signalKeys = [
    "offer",
    "answer",
    "candidate"
  ];
  var toPayload = (msg) => {
    if (typeof msg === "string") try {
      const parsed = fromJson(msg);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
    return msg && typeof msg === "object" ? msg : null;
  };
  var getString = (payload, key) => typeof payload[key] === "string" && payload[key] ? payload[key] : void 0;
  var hasInvalidSignalField = (payload) => signalKeys.some((key) => key in payload && (typeof payload[key] !== "string" || payload[key] === ""));
  var publishCipheredSignalingMessage = (ctx, signal, peerTopic, signalPeer, buildPayload, stillValid) => {
    ctx.toCipher(signal).then((encryptedSignal) => {
      if (ctx.isLeaving() || !stillValid()) return;
      signalPeer(peerTopic, toJson(buildPayload(encryptedSignal.sdp)));
    });
  };
  var makeState = () => ({
    status: "idle",
    offerPeer: null,
    offerId: null,
    offerSdp: null,
    offerInitPromise: null,
    offerAnswered: false,
    offerRelays: [],
    offerSignalRelays: [],
    offerSignalBacklog: [],
    offerRelayTimers: [],
    offerExpiryTimer: null,
    connectedPeer: null,
    connectedPeerUnhealthySinceMs: null,
    answeringExpiryTimer: null,
    answeringPeer: null,
    answerSent: false,
    connectionErrorReported: false,
    pendingCandidates: {}
  });
  var hasTurnServer = (config) => {
    var _a;
    return [...config.turnConfig ?? [], ...((_a = config.rtcConfig) == null ? void 0 : _a.iceServers) ?? []].some(({ urls }) => {
      return (Array.isArray(urls) ? urls : [urls]).some((url) => /^turns?:/i.test(url));
    });
  };
  var getSdpExchangeConnectionError = (peerId, config) => `could not connect to peer ${peerId} after exchanging SDP; ${hasTurnServer(config) ? "check that your TURN server URLs and credentials are reachable by both peers" : "configure TURN servers with turnConfig or rtcConfig.iceServers"}`;
  var reportSdpExchangeConnectionFailure = (ctx, state, peerId) => {
    var _a;
    if (ctx.isLeaving() || state.connectedPeer || state.connectionErrorReported) return;
    state.connectionErrorReported = true;
    (_a = ctx.onJoinError) == null ? void 0 : _a.call(ctx, {
      error: getSdpExchangeConnectionError(peerId, ctx.config),
      appId: ctx.appId,
      peerId,
      roomId: ctx.roomId
    });
  };
  var getState = (peerStates, peerId) => peerStates[peerId] ?? (peerStates[peerId] = makeState());
  var updateStatus = (state) => {
    if (state.connectedPeer) state.status = "connected";
    else if (state.answeringPeer) state.status = "answering";
    else if (state.offerPeer || state.offerRelays.some(Boolean)) state.status = "offering";
    else state.status = "idle";
  };
  var clearAnswering = (state, peer) => {
    if (state.answeringPeer === peer) {
      state.answeringExpiryTimer = resetTimer(state.answeringExpiryTimer);
      state.answeringPeer = null;
      state.answerSent = false;
      updateStatus(state);
    }
  };
  var clearConnectedPeer = (state, peerId, _reason) => {
    if (!state.connectedPeer) return;
    if (!state.connectedPeer.isDead) state.connectedPeer.destroy();
    state.connectedPeer = null;
    state.connectedPeerUnhealthySinceMs = null;
    updateStatus(state);
  };
  var clearOfferRelay = (state, relayId) => {
    state.offerRelayTimers[relayId] = resetTimer(state.offerRelayTimers[relayId]);
    if (state.offerRelays[relayId]) {
      state.offerRelays[relayId] = void 0;
      updateStatus(state);
    }
  };
  var clearOfferRelayIfPlaceholder = (state, relayId) => {
    if ((state == null ? void 0 : state.offerRelays[relayId]) === offerRelayPlaceholder) clearOfferRelay(state, relayId);
  };
  var hasRemoteDescription = (peer) => {
    if (peer.isDead || peer.connection.connectionState === "closed") return true;
    try {
      return Boolean(peer.connection.remoteDescription);
    } catch {
      return true;
    }
  };
  var resetOfferState = (state, offerPool) => {
    const previousOfferAnswered = state.offerAnswered;
    state.offerExpiryTimer = resetTimer(state.offerExpiryTimer);
    state.offerInitPromise = null;
    state.offerRelays.forEach((_, relayId) => clearOfferRelay(state, relayId));
    state.offerRelays = [];
    state.offerSignalRelays = [];
    state.offerRelayTimers = [];
    state.offerSignalBacklog = [];
    if (state.offerPeer && state.offerPeer !== state.connectedPeer) if (previousOfferAnswered || hasRemoteDescription(state.offerPeer)) {
      if (!state.offerPeer.isDead) state.offerPeer.destroy();
    } else offerPool.recycle(state.offerPeer);
    state.offerPeer = null;
    state.offerId = null;
    state.offerSdp = null;
    state.offerAnswered = false;
    state.connectionErrorReported = false;
    updateStatus(state);
  };
  var scheduleAnsweringExpiry = (ctx, state, peerId, peer) => {
    resetTimer(state.answeringExpiryTimer);
    state.answeringExpiryTimer = setTimeout(() => {
      const current = ctx.peerStates[peerId];
      if (!current || current.connectedPeer || current.answeringPeer !== peer) return;
      if (current.answerSent) reportSdpExchangeConnectionFailure(ctx, current, peerId);
      peer.destroy();
      clearAnswering(current, peer);
      ctx.checkDeactivate();
    }, answeringTtlMs);
  };
  var flushBufferedCandidates = async (state, peer, offerId) => {
    const bufferKeys = offerId ? [offerId, legacyCandidateKey] : [legacyCandidateKey];
    for (const key of bufferKeys) {
      const buffered = state.pendingCandidates[key];
      if (!(buffered == null ? void 0 : buffered.length)) continue;
      delete state.pendingCandidates[key];
      for (const candidate of buffered) await peer.signal(candidate);
    }
  };
  var scheduleOfferExpiry = (ctx, state, peerId, ttlMs = offerTtl) => {
    resetTimer(state.offerExpiryTimer);
    const offerId = state.offerId;
    state.offerExpiryTimer = setTimeout(() => {
      const current = ctx.peerStates[peerId];
      if (!current || current.connectedPeer || current.offerId !== offerId) return;
      if (current.offerAnswered) reportSdpExchangeConnectionFailure(ctx, current, peerId);
      resetOfferState(current, ctx.offerPool);
      ctx.checkDeactivate();
    }, ttlMs);
  };
  var ensureOffer = (ctx, state, peerId, relayId) => {
    if (state.offerPeer && state.offerId && state.offerSdp) return Promise.resolve({
      peer: state.offerPeer,
      offer: state.offerSdp,
      offerId: state.offerId
    });
    if (state.offerInitPromise) return state.offerInitPromise;
    state.offerInitPromise = (async () => {
      const firstOffer = (await ctx.offerPool.checkout(1, false, ctx.encryptOffer))[0];
      if (!firstOffer) throw mkErr("failed to allocate offer peer");
      const { peer, offer } = firstOffer;
      state.offerPeer = peer;
      state.offerId = genId(offerIdSize);
      state.offerSdp = offer;
      state.offerAnswered = false;
      state.connectionErrorReported = false;
      state.offerSignalBacklog = [];
      updateStatus(state);
      const onOfferPeerClosedOrError = () => {
        if (state.offerPeer === peer && !state.connectedPeer) {
          if (state.offerAnswered) reportSdpExchangeConnectionFailure(ctx, state, peerId);
          resetOfferState(state, ctx.offerPool);
        }
        ctx.disconnectPeer(peer, peerId);
        ctx.checkDeactivate();
      };
      peer.setHandlers({
        connect: () => ctx.connectPeer(peer, peerId, relayId),
        signal: (signal) => {
          if (state.offerPeer !== peer) return;
          state.offerSignalBacklog.push(signal);
          state.offerSignalRelays.forEach((sendSignal) => sendSignal == null ? void 0 : sendSignal(signal));
        },
        close: onOfferPeerClosedOrError,
        error: onOfferPeerClosedOrError
      });
      scheduleOfferExpiry(ctx, state, peerId);
      return {
        peer,
        offer,
        offerId: state.offerId
      };
    })().finally(() => state.offerInitPromise = null);
    return state.offerInitPromise;
  };
  var handleAnnouncement = async (ctx, relayId, peerId, shared, signalPeer) => {
    if (shared) {
      ctx.attachSharedPeerToRoom(peerId, shared);
      return;
    }
    const state = ctx.peerStates[peerId];
    if (!state || state.connectedPeer || state.answeringPeer || state.offerAnswered) {
      clearOfferRelayIfPlaceholder(state, relayId);
      return;
    }
    if (state.offerRelays[relayId] !== offerRelayPlaceholder) return;
    const [peerTopic, offerInfo] = await all([sha1(topicPath(ctx.rootTopicPlaintext, peerId)), ensureOffer(ctx, state, peerId, relayId)]);
    if (ctx.isLeaving()) return;
    if (state.connectedPeer || state.answeringPeer || state.offerAnswered || state.offerRelays[relayId] !== offerRelayPlaceholder) {
      clearOfferRelayIfPlaceholder(state, relayId);
      return;
    }
    state.offerRelayTimers[relayId] = resetTimer(state.offerRelayTimers[relayId]);
    state.offerRelays[relayId] = true;
    updateStatus(state);
    state.offerRelayTimers[relayId] = setTimeout(() => prunePendingOffer(ctx, peerId, relayId), (ctx.announceIntervals[relayId] ?? ctx.announceIntervalMs) * 0.9);
    let didSendOffer = false;
    state.offerSignalRelays[relayId] = (signal) => {
      if (!didSendOffer) return;
      if (ctx.isLeaving() || state.connectedPeer || state.offerPeer !== offerInfo.peer || state.offerId !== offerInfo.offerId || signal.type !== "candidate") return;
      publishCipheredSignalingMessage(ctx, signal, peerTopic, signalPeer, (sdp) => ({
        peerId: selfId,
        offerId: offerInfo.offerId,
        candidate: sdp,
        ...ctx.isPassive ? { passive: true } : {}
      }), () => !state.connectedPeer && state.offerPeer === offerInfo.peer && state.offerId === offerInfo.offerId);
    };
    signalPeer(peerTopic, toJson({
      peerId: selfId,
      offerId: offerInfo.offerId,
      offer: offerInfo.offer,
      ...ctx.isPassive ? { passive: true } : {}
    }));
    didSendOffer = true;
    state.offerSignalBacklog.forEach((signal) => {
      var _a, _b;
      return (_b = (_a = state.offerSignalRelays)[relayId]) == null ? void 0 : _b.call(_a, signal);
    });
  };
  var handleOffer = async (ctx, relayId, peerId, offer, offerId, hasOutgoingOfferHint, signalPeer) => {
    var _a;
    const state = getState(ctx.peerStates, peerId);
    if (state.answeringPeer || state.offerAnswered) return;
    const hasTrackedOutgoingOffer = Boolean(state.offerPeer || state.offerRelays.some(Boolean));
    if ((hasTrackedOutgoingOffer || hasOutgoingOfferHint) && selfId < peerId) return;
    if (hasTrackedOutgoingOffer) resetOfferState(state, ctx.offerPool);
    const answerPeer = ctx.initPeer(false, ctx.config);
    state.answeringPeer = answerPeer;
    state.answerSent = false;
    state.connectionErrorReported = false;
    scheduleAnsweringExpiry(ctx, state, peerId, answerPeer);
    updateStatus(state);
    const onAnswerPeerClosedOrError = () => {
      if (state.answeringPeer === answerPeer && !state.connectedPeer && state.answerSent) reportSdpExchangeConnectionFailure(ctx, state, peerId);
      clearAnswering(state, answerPeer);
      ctx.disconnectPeer(answerPeer, peerId);
      ctx.checkDeactivate();
    };
    answerPeer.setHandlers({
      connect: () => ctx.connectPeer(answerPeer, peerId, relayId),
      close: onAnswerPeerClosedOrError,
      error: onAnswerPeerClosedOrError
    });
    let plainOffer;
    try {
      plainOffer = await ctx.toPlain({
        type: "offer",
        sdp: offer
      });
    } catch {
      clearAnswering(state, answerPeer);
      (_a = ctx.onJoinError) == null ? void 0 : _a.call(ctx, {
        error: "incorrect room password when decrypting offer",
        appId: ctx.appId,
        peerId,
        roomId: ctx.roomId
      });
      return;
    }
    if (answerPeer.isDead) {
      clearAnswering(state, answerPeer);
      return;
    }
    const peerTopic = await sha1(topicPath(ctx.rootTopicPlaintext, peerId));
    if (ctx.isLeaving()) return;
    answerPeer.setHandlers({ signal: (signal) => {
      if (ctx.isLeaving() || state.answeringPeer !== answerPeer || answerPeer.isDead) return;
      if (signal.type !== "answer" && signal.type !== "candidate") return;
      publishCipheredSignalingMessage(ctx, signal, peerTopic, signalPeer, (sdp) => {
        const payloadToSend = { peerId: selfId };
        if (signal.type === "answer") {
          state.answerSent = true;
          payloadToSend["answer"] = sdp;
        } else payloadToSend["candidate"] = sdp;
        if (offerId) payloadToSend["offerId"] = offerId;
        if (ctx.isPassive) payloadToSend["passive"] = true;
        return payloadToSend;
      }, () => state.answeringPeer === answerPeer && !answerPeer.isDead);
    } });
    await answerPeer.signal(plainOffer);
    await flushBufferedCandidates(state, answerPeer, offerId);
  };
  var handleCandidate = async (ctx, peerId, candidate, offerId, peer) => {
    var _a;
    let plainCandidate;
    try {
      plainCandidate = await ctx.toPlain({
        type: candidateType,
        sdp: candidate
      });
    } catch {
      return;
    }
    const state = getState(ctx.peerStates, peerId);
    const offerPeerMatch = offerId && (state == null ? void 0 : state.offerPeer) && state.offerId === offerId ? state.offerPeer : null;
    const answeringPeer = (state == null ? void 0 : state.answeringPeer) ?? null;
    const fallbackOfferPeer = !offerId && (state == null ? void 0 : state.offerPeer) ? state.offerPeer : null;
    const targetPeer = peer && !peer.isDead ? peer : offerPeerMatch ?? answeringPeer ?? fallbackOfferPeer;
    if (!targetPeer || targetPeer.isDead) {
      const pendingKey = offerId ?? legacyCandidateKey;
      ((_a = state.pendingCandidates)[pendingKey] ?? (_a[pendingKey] = [])).push(plainCandidate);
      return;
    }
    targetPeer.signal(plainCandidate);
  };
  var handleAnswer = async (ctx, relayId, peerId, answer, offerId, peer) => {
    var _a;
    let plainAnswer;
    try {
      plainAnswer = await ctx.toPlain({
        type: "answer",
        sdp: answer
      });
    } catch {
      (_a = ctx.onJoinError) == null ? void 0 : _a.call(ctx, {
        error: "incorrect room password when decrypting answer",
        appId: ctx.appId,
        peerId,
        roomId: ctx.roomId
      });
      return;
    }
    if (peer) {
      ctx.offerPool.claimLeased(peer);
      peer.setHandlers({
        connect: () => ctx.connectPeer(peer, peerId, relayId),
        close: () => ctx.disconnectPeer(peer, peerId)
      });
      peer.signal(plainAnswer);
    } else {
      const state = ctx.peerStates[peerId];
      if (!state || !state.offerPeer || state.offerAnswered || offerId && state.offerId && offerId !== state.offerId || state.offerPeer.isDead) return;
      state.offerAnswered = true;
      scheduleOfferExpiry(ctx, state, peerId, offerPostAnswerTtlMs);
      state.offerPeer.signal(plainAnswer);
    }
  };
  var prunePendingOffer = (ctx, peerId, relayId) => {
    const state = ctx.peerStates[peerId];
    if (!state || state.connectedPeer) return;
    if (state.offerRelays[relayId]) {
      clearOfferRelay(state, relayId);
      ctx.checkDeactivate();
    }
  };
  var createSignalHandler = (ctx) => (relayId) => async (topic, msg, signalPeer) => {
    var _a;
    if (ctx.isLeaving()) return;
    const payload = toPayload(msg);
    if (!payload || hasInvalidSignalField(payload)) return;
    const peerId = getString(payload, "peerId") ?? "";
    const offer = getString(payload, "offer");
    const answer = getString(payload, "answer");
    const candidate = getString(payload, "candidate");
    const offerId = getString(payload, "offerId");
    const peer = payload["peer"];
    const hasOutgoingOfferHint = payload["hasOutgoingOffer"] === true;
    const remoteIsPassive = payload["passive"] === true;
    if (!peerId || peerId === selfId) return;
    const [rootTopic, selfTopic] = await all([ctx.rootTopicP, ctx.selfTopicP]);
    if (ctx.isLeaving()) return;
    if (topic !== rootTopic && topic !== selfTopic) return;
    if (ctx.isPassive && remoteIsPassive) return;
    if (ctx.isPassive && !ctx.isActive && !answer && !candidate) {
      ctx.isActive = true;
      (_a = ctx.requeueAnnounce) == null ? void 0 : _a.call(ctx);
    }
    if (ctx.isPassive && !ctx.isActive) return;
    const state = ctx.peerStates[peerId];
    const connectedPeer = state == null ? void 0 : state.connectedPeer;
    if (connectedPeer && state) {
      const health = getConnectedPeerHealth(connectedPeer);
      if (health === "live") {
        state.connectedPeerUnhealthySinceMs = null;
        return;
      }
      if (health === "stale") clearConnectedPeer(state, peerId, "message-from-stale-peer");
      else {
        const nowMs = Date.now();
        const unhealthySinceMs = state.connectedPeerUnhealthySinceMs ?? nowMs;
        state.connectedPeerUnhealthySinceMs = unhealthySinceMs;
        if (nowMs - unhealthySinceMs < disconnectedPeerGraceMs) return;
        clearConnectedPeer(state, peerId, "message-from-prolonged-disconnect");
      }
    }
    let shared = ctx.sharedPeers.get(ctx.appId, peerId);
    if (shared && ctx.sharedPeers.getHealth(shared.peer) === "stale") {
      ctx.sharedPeers.clear(ctx.appId, peerId, { destroyPeer: true });
      shared = void 0;
    }
    const isAnnouncement = Boolean(peerId && !offer && !answer && !candidate);
    if (isAnnouncement && !shared) {
      const announcePeerState = getState(ctx.peerStates, peerId);
      const shouldLeadOffer = selfId < peerId;
      if (announcePeerState.answeringPeer || announcePeerState.connectedPeer || announcePeerState.offerAnswered) return;
      if (!shouldLeadOffer && !announcePeerState.offerPeer) {
        const peerSelfTopic = await sha1(topicPath(ctx.rootTopicPlaintext, peerId));
        if (!ctx.isLeaving() && !announcePeerState.connectedPeer) signalPeer(peerSelfTopic, toJson({ peerId: selfId }));
        return;
      }
      if (announcePeerState.offerRelays[relayId]) return;
      announcePeerState.offerRelays[relayId] = offerRelayPlaceholder;
      updateStatus(announcePeerState);
    }
    if (shared && (offer || answer || candidate)) {
      if (shared.bindings[ctx.roomId]) return;
      ctx.attachSharedPeerToRoom(peerId, shared);
      return;
    }
    if (isAnnouncement) return handleAnnouncement(ctx, relayId, peerId, shared, signalPeer);
    if (offer) return handleOffer(ctx, relayId, peerId, offer, offerId, hasOutgoingOfferHint, signalPeer);
    if (candidate) return handleCandidate(ctx, peerId, candidate, offerId, peer);
    if (answer) return handleAnswer(ctx, relayId, peerId, answer, offerId, peer);
  };

  // ../../../../node_modules/@trystero-p2p/core/dist/strategy.mjs
  var announceIntervalMs = 5333;
  var announceWarmupIntervalsMs = [
    233,
    533,
    1333
  ];
  var passiveActivationGraceMs = 7533;
  var sharedPeerIdleMsDefault = 123333;
  var strategy_default = ({ init, subscribe, announce, deactivate }) => {
    const occupiedRooms = {};
    const roomRegistrations = {};
    const roomIdsByToken = {};
    const roomPresenceHandlerCleanups = {};
    const sharedPeers = new SharedPeerManager();
    const hasActiveRooms = () => values(occupiedRooms).some((rooms) => keys(rooms).length > 0);
    const getRoomRegistrations = (appId) => roomRegistrations[appId] ?? (roomRegistrations[appId] = {});
    const getRoomIdsByToken = (appId) => roomIdsByToken[appId] ?? (roomIdsByToken[appId] = {});
    const advertiseRoomPresence = (shared, roomToken, isPresent) => {
      if (sharedPeers.getHealth(shared.peer) === "live") sharedPeers.sendRoomPresence(shared, roomToken, isPresent);
    };
    const advertiseKnownRoomsToShared = (appId, shared) => {
      entries(roomRegistrations[appId] ?? {}).forEach(([roomId, registration]) => {
        if (!registration.shouldAdvertise()) return;
        const { roomToken, roomTokenPromise } = registration;
        if (roomToken) {
          advertiseRoomPresence(shared, roomToken, true);
          return;
        }
        roomTokenPromise.then((token) => {
          var _a;
          if (((_a = roomRegistrations[appId]) == null ? void 0 : _a[roomId]) !== registration) return;
          if (registration.roomToken !== token) return;
          if (sharedPeers.get(appId, shared.peerId) !== shared || shared.isClosing) return;
          if (!registration.shouldAdvertise()) return;
          advertiseRoomPresence(shared, token, true);
        });
      });
    };
    const advertiseRoomPresenceToAll = (appId, roomToken, isPresent) => values(sharedPeers.getMap(appId)).forEach((shared) => advertiseRoomPresence(shared, roomToken, isPresent));
    const ensureRoomPresenceHandler = (appId) => {
      if (roomPresenceHandlerCleanups[appId]) return;
      roomPresenceHandlerCleanups[appId] = sharedPeers.setRoomPresenceHandler(appId, (peerId, roomToken, isPresent) => {
        var _a, _b, _c;
        if (!isPresent) return;
        const shared = sharedPeers.get(appId, peerId);
        const roomId = (_a = roomIdsByToken[appId]) == null ? void 0 : _a[roomToken];
        if (!shared || !roomId) return;
        (_c = (_b = roomRegistrations[appId]) == null ? void 0 : _b[roomId]) == null ? void 0 : _c.attachSharedPeerToRoom(peerId, shared);
      });
    };
    const cleanupRoomPresenceHandler = (appId) => {
      var _a;
      if (occupiedRooms[appId] && keys(occupiedRooms[appId]).length > 0) return;
      (_a = roomPresenceHandlerCleanups[appId]) == null ? void 0 : _a.call(roomPresenceHandlerCleanups);
      delete roomPresenceHandlerCleanups[appId];
      delete roomRegistrations[appId];
      delete roomIdsByToken[appId];
    };
    let didInit = false;
    let initPromises = [];
    let offerPool = null;
    let cleanupWatchOnline = noOp;
    return (config, roomId, callbacks) => {
      var _a, _b;
      if (!config) throw mkErr("requires a config map as the first argument");
      if (callbacks && typeof callbacks !== "object") throw mkErr("third argument must be a callbacks object");
      const { appId } = config;
      const onJoinError = callbacks == null ? void 0 : callbacks.onJoinError;
      const onPeerHandshake = callbacks == null ? void 0 : callbacks.onPeerHandshake;
      const handshakeTimeoutMs = callbacks == null ? void 0 : callbacks.handshakeTimeoutMs;
      if (!appId) throw mkErr("config map is missing appId field");
      if (!roomId) throw mkErr("roomId argument required");
      if (handshakeTimeoutMs !== void 0 && (!Number.isFinite(handshakeTimeoutMs) || handshakeTimeoutMs <= 0)) throw mkErr("handshakeTimeoutMs must be a positive number");
      if ((_a = occupiedRooms[appId]) == null ? void 0 : _a[roomId]) return occupiedRooms[appId][roomId];
      ensureRoomPresenceHandler(appId);
      const rootTopicPlaintext = topicPath(libName, appId, roomId);
      const rootTopicP = sha1(rootTopicPlaintext);
      const selfTopicP = sha1(topicPath(rootTopicPlaintext, selfId));
      const key = genKey(config.password ?? "", appId, roomId);
      const roomNamespacePromise = deriveRoomNamespace(appId, roomId);
      const sharedPeerIdleMs = config._test_only_sharedPeerIdleMs ?? sharedPeerIdleMsDefault;
      let didLeaveRoom = false;
      const withKey = (f) => async (signal) => ({
        type: signal.type,
        sdp: await f(key, signal.sdp)
      });
      const toPlain = withKey(decrypt);
      const toCipher = withKey(encrypt);
      const sharedPeerMap = sharedPeers.getMap(appId);
      const makeOffer = () => peer_default(true, config);
      offerPool || (offerPool = new OfferPool(makeOffer));
      const pool = offerPool;
      const encryptOffer = async (peer) => {
        const plainOffer = await peer.getOffer(Date.now() - peer.created > offerTtl);
        if (!plainOffer || plainOffer.type !== "offer") throw mkErr("failed to get offer for peer");
        return (await toCipher(plainOffer)).sdp;
      };
      const attachSharedPeerToRoom = (peerId, shared) => {
        const state = getState(ctx.peerStates, peerId);
        state.answeringExpiryTimer = resetTimer(state.answeringExpiryTimer);
        state.answeringPeer = null;
        const { proxy, isNew } = sharedPeers.bind(roomId, roomNamespacePromise, shared, { onDetach: () => {
          const current = ctx.peerStates[peerId];
          if ((current == null ? void 0 : current.connectedPeer) === shared.peer) {
            current.connectedPeer = null;
            current.connectedPeerUnhealthySinceMs = null;
            updateStatus(current);
          }
        } });
        state.connectedPeer = shared.peer;
        state.connectedPeerUnhealthySinceMs = null;
        updateStatus(state);
        if (isNew) onPeerConnect(proxy, peerId);
        resetOfferState(state, pool);
      };
      const connectPeer = (peer, peerId, _relayId) => {
        if (didLeaveRoom) {
          peer.destroy();
          return;
        }
        const state = getState(ctx.peerStates, peerId);
        if (state.connectedPeer) {
          const shared2 = sharedPeerMap[peerId];
          if (shared2 && state.connectedPeer === shared2.peer && shared2.bindings[roomId]) return;
          if (state.connectedPeer !== peer && !peer.isDead) peer.destroy();
          return;
        }
        let shared = sharedPeerMap[peerId];
        if (shared && sharedPeers.getHealth(shared.peer) === "stale") {
          sharedPeers.clear(appId, peerId, { destroyPeer: true });
          shared = void 0;
        }
        if (shared && shared.peer !== peer) {
          if (!peer.isDead) peer.destroy();
          attachSharedPeerToRoom(peerId, shared);
          return;
        }
        const isNewShared = !shared;
        shared || (shared = sharedPeers.register(appId, peerId, peer, sharedPeerIdleMs));
        attachSharedPeerToRoom(peerId, shared);
        if (isNewShared) advertiseKnownRoomsToShared(appId, shared);
      };
      const disconnectPeer = (peer, peerId) => {
        if (didLeaveRoom) return;
        const state = ctx.peerStates[peerId];
        if ((state == null ? void 0 : state.connectedPeer) === peer) {
          clearConnectedPeer(state, peerId, "close-event");
          checkDeactivate();
        }
      };
      const isPassive = Boolean(config.passive);
      let roomRegistration = null;
      let passiveActivationTimeout;
      let deactivateRelayAnnouncements = noOp;
      const checkDeactivate = () => {
        if (!isPassive || !ctx.isActive) return;
        let hasActiveWork = false;
        entries(ctx.peerStates).forEach(([peerId, state]) => {
          if (state.connectedPeer || state.answeringPeer || state.offerInitPromise || state.offerPeer || state.offerRelays.some(Boolean)) hasActiveWork = true;
          else if (state.status === "idle") delete ctx.peerStates[peerId];
        });
        if (!hasActiveWork) {
          ctx.isActive = false;
          passiveActivationTimeout = resetTimer(passiveActivationTimeout);
          announceTimeouts.forEach(resetTimer);
          announceTimeouts.length = 0;
          deactivateRelayAnnouncements();
          if (roomRegistration == null ? void 0 : roomRegistration.roomToken) advertiseRoomPresenceToAll(appId, roomRegistration.roomToken, false);
        }
      };
      const ctx = {
        appId,
        roomId,
        config,
        peerStates: {},
        rootTopicPlaintext,
        rootTopicP,
        selfTopicP,
        toPlain,
        toCipher,
        isLeaving: () => didLeaveRoom,
        isPassive,
        isActive: !isPassive,
        onJoinError,
        sharedPeers,
        offerPool: pool,
        encryptOffer,
        initPeer: peer_default,
        connectPeer,
        disconnectPeer,
        attachSharedPeerToRoom,
        checkDeactivate,
        announceIntervals: [],
        announceIntervalMs
      };
      const strategyContext = {
        config,
        appId,
        roomId,
        isPassive
      };
      const handleMessage = createSignalHandler(ctx);
      if (!didInit) {
        const initRes = init(config);
        initPromises = (Array.isArray(initRes) ? initRes : [initRes]).map((value) => Promise.resolve(value));
        didInit = true;
        cleanupWatchOnline = ((_b = config.relayConfig) == null ? void 0 : _b.manualReconnection) ? noOp : watchOnline();
      }
      if (!isPassive && !pool.isActive) pool.warmup();
      ctx.announceIntervals = initPromises.map(() => announceIntervalMs);
      const announceAttemptCounts = initPromises.map(() => 0);
      const announceErrorStreaks = initPromises.map(() => 0);
      const announceTimeouts = [];
      const unsubFns = initPromises.map(async (relayP, i) => subscribe(await relayP, await rootTopicP, await selfTopicP, handleMessage(i), (n) => pool.getOffers(n, encryptOffer), strategyContext));
      all([rootTopicP, selfTopicP]).then(([rootTopic, selfTopic]) => {
        if (didLeaveRoom) return;
        const queueAnnounce = async (relay, i) => {
          if (didLeaveRoom) return;
          if (isPassive && !ctx.isActive) return;
          const extra = isPassive ? { passive: true } : void 0;
          let ms = void 0;
          try {
            ms = await announce(relay, rootTopic, selfTopic, extra, strategyContext);
            announceErrorStreaks[i] = 0;
          } catch (error) {
            const errorStreak = announceErrorStreaks[i] ?? 0;
            if (errorStreak === 0) console.warn(`${libName}: announce failed - ${toErrorMessage(error, "")}`);
            announceErrorStreaks[i] = errorStreak + 1;
          }
          if (didLeaveRoom || isPassive && !ctx.isActive) return;
          if (typeof ms === "number") ctx.announceIntervals[i] = ms;
          const announceAttempt = announceAttemptCounts[i] ?? 0;
          announceAttemptCounts[i] = announceAttempt + 1;
          const currentInterval = ctx.announceIntervals[i] ?? announceIntervalMs;
          const warmupDelay = announceWarmupIntervalsMs[announceAttempt];
          announceTimeouts[i] = setTimeout(() => {
            queueAnnounce(relay, i);
          }, typeof warmupDelay === "number" ? Math.min(currentInterval, warmupDelay) : currentInterval);
        };
        deactivateRelayAnnouncements = () => {
          if (!deactivate) return;
          initPromises.forEach(async (relayP) => {
            const relay = await relayP;
            if (!didLeaveRoom) deactivate(relay, rootTopic, selfTopic, strategyContext);
          });
        };
        ctx.requeueAnnounce = () => {
          announceTimeouts.forEach(resetTimer);
          announceTimeouts.length = 0;
          passiveActivationTimeout = resetTimer(passiveActivationTimeout);
          if (!pool.isActive) pool.warmup();
          if (roomRegistration == null ? void 0 : roomRegistration.roomToken) advertiseRoomPresenceToAll(appId, roomRegistration.roomToken, true);
          passiveActivationTimeout = setTimeout(checkDeactivate, passiveActivationGraceMs);
          initPromises.forEach(async (relayP, i) => {
            const relay = await relayP;
            if (relay && !didLeaveRoom) {
              announceAttemptCounts[i] = 0;
              queueAnnounce(relay, i);
            }
          });
        };
        unsubFns.forEach(async (didSub, i) => {
          await didSub;
          if (didLeaveRoom) return;
          const relay = await initPromises[i];
          if (relay && !didLeaveRoom && (!isPassive || ctx.isActive)) queueAnnounce(relay, i);
        });
      });
      let onPeerConnect = noOp;
      const { compose } = createPasswordHandshake(config.password ?? "", appId, roomId);
      const composedPeerHandshake = compose(onPeerHandshake);
      const roomOptions = {
        ...composedPeerHandshake ? { onPeerHandshake: composedPeerHandshake } : {},
        ...handshakeTimeoutMs === void 0 ? {} : { handshakeTimeoutMs },
        isPassive,
        onHandshakeError: (peerId, error) => onJoinError == null ? void 0 : onJoinError({
          error: error.replace(/^handshake failed: /, ""),
          appId,
          peerId,
          roomId
        })
      };
      occupiedRooms[appId] ?? (occupiedRooms[appId] = {});
      const appRoomRegistrations = getRoomRegistrations(appId);
      const joinedRoom = room_default((f) => onPeerConnect = f, (id) => {
        if (didLeaveRoom) return;
        const state = ctx.peerStates[id];
        if (state == null ? void 0 : state.connectedPeer) {
          state.connectedPeer = null;
          updateStatus(state);
          checkDeactivate();
        }
      }, () => {
        var _a2, _b2;
        didLeaveRoom = true;
        onPeerConnect = noOp;
        const registration = (_a2 = roomRegistrations[appId]) == null ? void 0 : _a2[roomId];
        if (registration == null ? void 0 : registration.roomToken) {
          advertiseRoomPresenceToAll(appId, registration.roomToken, false);
          (_b2 = roomIdsByToken[appId]) == null ? true : delete _b2[registration.roomToken];
          if (roomIdsByToken[appId] && !keys(roomIdsByToken[appId]).length) delete roomIdsByToken[appId];
        }
        if (roomRegistrations[appId]) {
          delete roomRegistrations[appId][roomId];
          if (!keys(roomRegistrations[appId]).length) delete roomRegistrations[appId];
        }
        entries(ctx.peerStates).forEach(([peerId, state]) => {
          state.answeringExpiryTimer = resetTimer(state.answeringExpiryTimer);
          if (state.connectedPeer && !state.connectedPeer.isDead) {
            const shared = sharedPeerMap[peerId];
            if (!shared || shared.peer !== state.connectedPeer) state.connectedPeer.destroy();
          }
          if (state.answeringPeer && !state.answeringPeer.isDead) state.answeringPeer.destroy();
          resetOfferState(state, pool);
          state.connectedPeer = null;
          state.answeringPeer = null;
          updateStatus(state);
        });
        if (occupiedRooms[appId]) {
          delete occupiedRooms[appId][roomId];
          if (keys(occupiedRooms[appId]).length === 0) delete occupiedRooms[appId];
        }
        announceTimeouts.forEach(resetTimer);
        passiveActivationTimeout = resetTimer(passiveActivationTimeout);
        unsubFns.forEach(async (f) => {
          (await f)();
        });
        if (hasActiveRooms()) return;
        didInit = false;
        pool.destroy();
        offerPool = null;
        cleanupWatchOnline();
        cleanupRoomPresenceHandler(appId);
      }, roomOptions);
      roomRegistration = {
        roomToken: null,
        roomTokenPromise: roomNamespacePromise,
        attachSharedPeerToRoom,
        shouldAdvertise: () => !isPassive || ctx.isActive
      };
      appRoomRegistrations[roomId] = roomRegistration;
      roomNamespacePromise.then((roomToken) => {
        var _a2;
        const registration = roomRegistration;
        if (!registration || didLeaveRoom || ((_a2 = roomRegistrations[appId]) == null ? void 0 : _a2[roomId]) !== registration) return;
        registration.roomToken = roomToken;
        getRoomIdsByToken(appId)[roomToken] = roomId;
        values(sharedPeerMap).forEach((shared) => {
          if (shared.remoteRoomTokens.has(roomToken)) attachSharedPeerToRoom(shared.peerId, shared);
        });
        if (!isPassive || ctx.isActive) advertiseRoomPresenceToAll(appId, roomToken, true);
      });
      return occupiedRooms[appId][roomId] = joinedRoom;
    };
  };

  // ../../../../node_modules/@trystero-p2p/torrent/dist/index.mjs
  var relayManager = createRelayManager((client) => client.socket);
  var topicToInfoHash = {};
  var infoHashToTopic = {};
  var announceIntervals = relayManager.scoped();
  var announceFns = relayManager.scoped();
  var subscriptionTokens = relayManager.scoped();
  var trackerAnnounceMs = {};
  var handledSignals = {};
  var msgHandlers = relayManager.scoped();
  var topicStates = relayManager.scoped();
  var roomOutstandingOffers = {};
  var roomOfferGenerationPromises = {};
  var roomSubscriberCounts = {};
  var trackerAction = "announce";
  var hashLimit = 20;
  var offerPoolSize = 3;
  var defaultAnnounceMs = 1e4;
  var dormantAnnounceMs = 12e4;
  var maxAnnounceMs = 2e4;
  var offerRetentionMs = 12e4;
  var signalDedupeWindowMs = 4e3;
  var defaultRedundancy = 3;
  var getInfoHash = async (topic) => {
    if (topicToInfoHash[topic]) return topicToInfoHash[topic];
    const hash = (await sha1(topic)).slice(0, hashLimit);
    topicToInfoHash[topic] = hash;
    infoHashToTopic[hash] = topic;
    return hash;
  };
  var send = async (client, topic, payload) => client.send(toJson({
    action: trackerAction,
    info_hash: await getInfoHash(topic),
    peer_id: selfId,
    ...payload
  }));
  var warn = (url, msg, didFail = false) => console.warn(`${libName}: torrent tracker ${didFail ? "failure" : "warning"} from ${url} - ${msg}`);
  var getRoomOutstandingOffers = (rootTopic) => roomOutstandingOffers[rootTopic] ?? (roomOutstandingOffers[rootTopic] = {});
  var deleteRoomOfferBookkeeping = (rootTopic) => {
    delete roomOutstandingOffers[rootTopic];
    delete roomOfferGenerationPromises[rootTopic];
  };
  var claimOutstandingOffer = (rootTopic, offerId) => {
    var _a;
    const outstandingOffers = roomOutstandingOffers[rootTopic];
    const offer = outstandingOffers == null ? void 0 : outstandingOffers[offerId];
    if (!offer) return;
    delete outstandingOffers[offerId];
    (_a = offer.claim) == null ? void 0 : _a.call(offer);
    if (!keys(outstandingOffers).length && !roomSubscriberCounts[rootTopic]) deleteRoomOfferBookkeeping(rootTopic);
    return offer;
  };
  var reclaimOutstandingOffer = (rootTopic, offerId) => {
    var _a;
    const outstandingOffers = roomOutstandingOffers[rootTopic];
    const offer = outstandingOffers == null ? void 0 : outstandingOffers[offerId];
    if (!offer) return;
    delete outstandingOffers[offerId];
    (_a = offer.reclaim) == null ? void 0 : _a.call(offer);
    if (!keys(outstandingOffers).length && !roomSubscriberCounts[rootTopic]) deleteRoomOfferBookkeeping(rootTopic);
  };
  var reclaimAllOutstandingOffers = (rootTopic) => {
    keys(getRoomOutstandingOffers(rootTopic)).forEach((offerId) => reclaimOutstandingOffer(rootTopic, offerId));
    deleteRoomOfferBookkeeping(rootTopic);
  };
  var pruneOutstandingOffers = (rootTopic) => {
    const now2 = Date.now();
    entries(getRoomOutstandingOffers(rootTopic)).forEach(([offerId, offer]) => {
      if (now2 - offer.createdAt > offerRetentionMs) reclaimOutstandingOffer(rootTopic, offerId);
    });
  };
  var ensureOutstandingOffers = async (rootTopic, getOffers) => {
    while (roomOfferGenerationPromises[rootTopic]) await roomOfferGenerationPromises[rootTopic];
    const nextPromise = (async () => {
      pruneOutstandingOffers(rootTopic);
      const outstandingOffers = getRoomOutstandingOffers(rootTopic);
      const outstandingCount = keys(outstandingOffers).length;
      const missingOffers = Math.max(0, offerPoolSize - outstandingCount);
      if (missingOffers > 0) (await getOffers(missingOffers)).forEach((peerAndOffer) => {
        outstandingOffers[genId(hashLimit)] = {
          ...peerAndOffer,
          createdAt: Date.now()
        };
      });
    })().finally(() => {
      if (roomOfferGenerationPromises[rootTopic] === nextPromise) delete roomOfferGenerationPromises[rootTopic];
    });
    roomOfferGenerationPromises[rootTopic] = nextPromise;
    await nextPromise;
    return getRoomOutstandingOffers(rootTopic);
  };
  var joinRoomStrategy = strategy_default({
    init: (config) => getRelays(config, defaultRelayUrls, defaultRedundancy).map((rawUrl) => {
      const client = relayManager.register(rawUrl, () => makeSocket(rawUrl, (rawData) => {
        var _a, _b;
        const data = fromJson(rawData);
        const errMsg = data["failure reason"];
        const warnMsg = data["warning message"];
        const { interval } = data;
        const topic = data.info_hash ? infoHashToTopic[data.info_hash] : void 0;
        if (errMsg) {
          warn(client.url, errMsg, true);
          return;
        }
        if (warnMsg) warn(client.url, warnMsg);
        if (interval && interval * 1e3 > (trackerAnnounceMs[client.url] ?? defaultAnnounceMs) && topic && announceFns.forKey(rawUrl)[topic]) {
          const nextInterval = Math.min(interval * 1e3, maxAnnounceMs);
          const relayIntervals = announceIntervals.forKey(rawUrl);
          const relayFns = announceFns.forKey(rawUrl);
          if (relayIntervals[topic]) clearInterval(relayIntervals[topic]);
          trackerAnnounceMs[client.url] = nextInterval;
          const relayFn = relayFns[topic];
          if (relayFn) relayIntervals[topic] = setInterval(() => {
            relayFn();
          }, nextInterval);
        }
        if ((data.offer || data.answer) && topic && data.offer_id) {
          if (data.peer_id === selfId) return;
          const signalKey = `${topic}:${data.offer ? "offer" : "answer"}:${data.offer_id}:${data.peer_id ?? ""}`;
          const nowMs = Date.now();
          const lastHandledMs = handledSignals[signalKey];
          if (typeof lastHandledMs === "number" && nowMs - lastHandledMs < signalDedupeWindowMs) return;
          handledSignals[signalKey] = nowMs;
          entries(handledSignals).forEach(([key, handledAtMs]) => {
            if (nowMs - handledAtMs > signalDedupeWindowMs * 6) delete handledSignals[key];
          });
          (_b = (_a = msgHandlers.forKey(rawUrl))[topic]) == null ? void 0 : _b.call(_a, data);
        }
      }));
      return client.ready;
    }),
    subscribe: (client, rootTopic, _, onMessage, getOffers, context) => {
      const handlers = msgHandlers.forRelay(client);
      const relayFns = announceFns.forRelay(client);
      const relayIntervals = announceIntervals.forRelay(client);
      const activeTokens = subscriptionTokens.forRelay(client);
      const states = topicStates.forRelay(client);
      const subscriptionToken = Symbol(rootTopic);
      activeTokens[rootTopic] = subscriptionToken;
      roomSubscriberCounts[rootTopic] = (roomSubscriberCounts[rootTopic] ?? 0) + 1;
      const topicHandler = (data) => {
        if (data.offer && data.peer_id && data.offer_id) onMessage(rootTopic, {
          offer: data.offer.sdp,
          peerId: data.peer_id,
          hasOutgoingOffer: keys(getRoomOutstandingOffers(rootTopic)).length > 0
        }, (_2, signal) => void send(client, rootTopic, {
          answer: {
            type: "answer",
            sdp: fromJson(signal).answer
          },
          offer_id: data.offer_id,
          to_peer_id: data.peer_id
        }));
        else if (data.answer && data.offer_id && data.peer_id) {
          const offer = claimOutstandingOffer(rootTopic, data.offer_id);
          if (offer) onMessage(rootTopic, {
            answer: data.answer.sdp,
            peerId: data.peer_id,
            peer: offer.peer
          }, () => {
          });
        }
      };
      handlers[rootTopic] = topicHandler;
      const topicState = {
        announce: async () => {
          if (activeTokens[rootTopic] !== subscriptionToken) return;
          if (!topicState.isActive) {
            send(client, rootTopic, {
              left: 0,
              numwant: offerPoolSize,
              offers: []
            });
            return;
          }
          send(client, rootTopic, {
            numwant: offerPoolSize,
            offers: entries(await ensureOutstandingOffers(rootTopic, getOffers)).map(([id, { offer }]) => ({
              offer_id: id,
              offer: {
                type: "offer",
                sdp: offer
              }
            }))
          });
        },
        isActive: !(context == null ? void 0 : context.isPassive)
      };
      trackerAnnounceMs[client.url] = defaultAnnounceMs;
      const { announce } = topicState;
      relayFns[rootTopic] = announce;
      states[rootTopic] = topicState;
      const initialInterval = topicState.isActive ? trackerAnnounceMs[client.url] : dormantAnnounceMs;
      relayIntervals[rootTopic] = setInterval(announce, initialInterval);
      announce();
      return () => {
        roomSubscriberCounts[rootTopic] = Math.max(0, (roomSubscriberCounts[rootTopic] ?? 1) - 1);
        if (!roomSubscriberCounts[rootTopic]) delete roomSubscriberCounts[rootTopic];
        if (activeTokens[rootTopic] !== subscriptionToken) {
          if (!roomSubscriberCounts[rootTopic]) {
            reclaimAllOutstandingOffers(rootTopic);
            delete states[rootTopic];
          }
          return;
        }
        const interval = relayIntervals[rootTopic];
        if (interval) {
          clearInterval(interval);
          delete relayIntervals[rootTopic];
        }
        if (handlers[rootTopic] === topicHandler) delete handlers[rootTopic];
        if (relayFns[rootTopic] === announce) delete relayFns[rootTopic];
        delete activeTokens[rootTopic];
        if (states[rootTopic] === topicState) delete states[rootTopic];
        if (!roomSubscriberCounts[rootTopic]) reclaimAllOutstandingOffers(rootTopic);
      };
    },
    announce: (client, rootTopic) => {
      const state = topicStates.forRelay(client)[rootTopic];
      const relayIntervals = announceIntervals.forRelay(client);
      const fn = announceFns.forRelay(client)[rootTopic];
      if (state) state.isActive = true;
      if (fn && relayIntervals[rootTopic]) {
        clearInterval(relayIntervals[rootTopic]);
        relayIntervals[rootTopic] = setInterval(() => {
          fn();
        }, trackerAnnounceMs[client.url]);
        fn();
      }
      return trackerAnnounceMs[client.url];
    },
    deactivate: (client, rootTopic) => {
      const state = topicStates.forRelay(client)[rootTopic];
      const relayIntervals = announceIntervals.forRelay(client);
      const fn = announceFns.forRelay(client)[rootTopic];
      if (state) state.isActive = false;
      reclaimAllOutstandingOffers(rootTopic);
      if (fn && relayIntervals[rootTopic]) {
        clearInterval(relayIntervals[rootTopic]);
        relayIntervals[rootTopic] = setInterval(() => {
          fn();
        }, dormantAnnounceMs);
        fn();
      }
    }
  });
  var joinRoom = (config, roomId, callbacks) => joinRoomStrategy({
    ...config,
    trickleIce: config.trickleIce ?? false
  }, roomId, callbacks);
  var getRelaySockets = relayManager.getSockets;
  var defaultRelayUrls = [
    "tracker.webtorrent.dev",
    "tracker.openwebtorrent.com",
    "tracker.btorrent.xyz",
    "tracker.files.fm:7073/announce"
  ].map((url) => "wss://" + url);

  // ../../../../node_modules/@noble/secp256k1/index.js
  var freeze = Object.freeze;
  var P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
  var N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  var Gx = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
  var Gy = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
  var secp256k1_CURVE = freeze({
    p: P,
    n: N,
    h: 1n,
    a: 0n,
    b: 7n,
    Gx,
    Gy
  });
  var L = 32;
  var isBytes = (a) => {
    return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && a.BYTES_PER_ELEMENT === 1;
  };
  var abytes = (value, length, title = "") => {
    if (isBytes(value) && (length === void 0 || value.length === length))
      return value;
    const bytes = isBytes(value);
    const ofLen = length !== void 0 ? ` of length ${length}` : "";
    const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
    const message = (title ? `"${title}" ` : "") + "expected Uint8Array" + ofLen + ", got " + got;
    if (!bytes)
      throw new TypeError(message);
    throw new RangeError(message);
  };
  var cloneBytes = (value) => Uint8Array.from(value);
  var snapshotBytes = (value, title, length) => cloneBytes(abytes(value, length, title));
  var padh = (n, pad) => n.toString(16).padStart(pad, "0");
  var bytesToHex = (bytes) => {
    let hex = "";
    for (const byte of abytes(bytes))
      hex += padh(byte, 2);
    return hex;
  };
  var hexToBytes = (hex) => {
    const e = "hex invalid";
    if (typeof hex !== "string")
      throw new TypeError(e);
    if (hex.length % 2 || !/^[\da-f]*$/i.test(hex))
      throw new RangeError(e);
    const array = new Uint8Array(hex.length / 2);
    for (let ai = 0, hi = 0; ai < array.length; ai++, hi += 2) {
      const n1 = hex.charCodeAt(hi);
      const n2 = hex.charCodeAt(hi + 1);
      array[ai] = ((n1 & 15) + (n1 >> 6) * 9) * 16 + (n2 & 15) + (n2 >> 6) * 9;
    }
    return array;
  };
  var subtle = () => {
    var _a;
    const s = (_a = globalThis == null ? void 0 : globalThis.crypto) == null ? void 0 : _a.subtle;
    if (s)
      return s;
    throw new Error("crypto.subtle must be defined, consider polyfill");
  };
  var concatBytes = (...arrays) => {
    let sum = 0;
    for (const a of arrays)
      sum += abytes(a).length;
    const res = new Uint8Array(sum);
    let pad = 0;
    for (const a of arrays) {
      res.set(a, pad);
      pad += a.length;
    }
    return res;
  };
  var randomBytes = (len = L) => {
    const c = globalThis == null ? void 0 : globalThis.crypto;
    if (typeof (c == null ? void 0 : c.getRandomValues) !== "function")
      throw new Error("crypto.getRandomValues must be defined, consider polyfill");
    return c.getRandomValues(new Uint8Array(len));
  };
  var big = BigInt;
  var arange = (n, min3, max, msg = "bad number: out of range") => {
    if (typeof n !== "bigint")
      throw new TypeError(msg);
    if (min3 <= n && n < max)
      return n;
    throw new RangeError(msg);
  };
  var M = (a, b = P) => (a %= b) >= 0n ? a : b + a;
  var modN = (a) => M(a, N);
  var invert = (number, modulo) => {
    if (number === 0n)
      throw new Error("invert: expected non-zero number");
    if (modulo <= 1n)
      throw new Error("invert: expected modulus > 1, got " + modulo);
    let a = M(number, modulo);
    let b = modulo;
    let x = 0n, u = 1n;
    while (a !== 0n) {
      const q = b / a;
      const r = b - a * q;
      const m = x - u * q;
      b = a, a = r, x = u, u = m;
    }
    const gcd = b;
    if (gcd !== 1n)
      throw new Error("invert: does not exist");
    return M(x, modulo);
  };
  var _hash = (name) => {
    const fn = hashes[name];
    if (typeof fn !== "function")
      throw new Error("hashes." + name + " not set");
    return fn;
  };
  var callHash = (name, a, b) => abytes(_hash(name)(a, b), L, "digest");
  var callHashAsync = async (name, a, b) => abytes(await _hash(name)(a, b), L, "digest");
  var apoint = (p) => {
    if (p instanceof Point)
      return p;
    throw new TypeError("Point expected");
  };
  var E_BADPOINT = "bad point: not on curve";
  var koblitz = (x) => M(M(x * x) * x + 7n);
  var FpIsValid = (n) => arange(n, 0n, P);
  var FpIsValidNot0 = (n) => arange(n, 1n, P);
  var FnIsValidNot0 = (n) => arange(n, 1n, N);
  var isEven = (y) => !(y & 1n);
  var getPrefix = (y) => Uint8Array.of(isEven(y) ? 2 : 3);
  var lift_x = (x) => {
    const c = koblitz(FpIsValidNot0(x));
    let r = 1n;
    for (let num = c, e = (P + 1n) / 4n; e > 0n; e >>= 1n) {
      if (e & 1n)
        r = r * num % P;
      num = num * num % P;
    }
    if (M(r * r) !== c)
      throw new Error("sqrt invalid");
    return new Point(x, isEven(r) ? r : M(-r), 1n);
  };
  var _Point = class _Point {
    constructor(X, Y, Z) {
      __publicField(this, "X");
      __publicField(this, "Y");
      __publicField(this, "Z");
      this.X = FpIsValid(X);
      this.Y = FpIsValidNot0(Y);
      this.Z = FpIsValid(Z);
      freeze(this);
    }
    /** Returns the shared curve metadata object by reference.
     * It is readonly only at type level, and mutating it won't retarget arithmetic,
     * which already uses module-load snapshots. */
    static CURVE() {
      return secp256k1_CURVE;
    }
    /** Create 3d xyz point from 2d xy. (0, 0) => (0, 1, 0), not (0, 0, 1) */
    static fromAffine(ap) {
      const { x, y } = ap;
      return x === 0n && y === 0n ? I : new _Point(x, y, 1n);
    }
    /** Convert Uint8Array or hex string to Point. */
    static fromBytes(bytes) {
      abytes(bytes);
      const length = bytes.length;
      const head = bytes[0];
      const x = sliceBytesNumBE(bytes, 1, 33);
      try {
        if (length === 33 && (head === 2 || head === 3)) {
          const p = lift_x(x);
          return head === 3 ? p.negate() : p;
        }
        if (length === 65 && head === 4)
          return new _Point(x, sliceBytesNumBE(bytes, 33, 65), 1n).assertValidity();
      } catch (error) {
        throw new Error(E_BADPOINT);
      }
      throw new Error(E_BADPOINT);
    }
    static fromHex(hex) {
      return _Point.fromBytes(hexToBytes(hex));
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    /** Equality check: compare points P&Q. */
    equals(other) {
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = apoint(other);
      return M(X1 * Z2) === M(X2 * Z1) && M(Y1 * Z2) === M(Y2 * Z1);
    }
    is0() {
      return this.Z === 0n;
    }
    /** Flip point over y coordinate. */
    negate() {
      return new _Point(this.X, M(-this.Y), this.Z);
    }
    /** Point doubling: P+P, complete formula. */
    double() {
      return this.add(this);
    }
    /**
     * Point addition: P+Q, complete, exception-free formula
     * (Renes-Costello-Batina, algo 1 of [2015/1060](https://eprint.iacr.org/2015/1060)).
     * Cost: `12M + 0S + 3*a + 3*b3 + 23add`.
     */
    // prettier-ignore
    add(other) {
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = apoint(other);
      const a = 0n;
      const b = 7n;
      let X3 = 0n, Y3 = 0n, Z3 = 0n;
      const b3 = M(b * 3n);
      let t0 = M(X1 * X2), t1 = M(Y1 * Y2), t2 = M(Z1 * Z2), t3 = M(X1 + Y1);
      let t4 = M(X2 + Y2);
      t3 = M(t3 * t4);
      t4 = M(t0 + t1);
      t3 = M(t3 - t4);
      t4 = M(X1 + Z1);
      let t5 = M(X2 + Z2);
      t4 = M(t4 * t5);
      t5 = M(t0 + t2);
      t4 = M(t4 - t5);
      t5 = M(Y1 + Z1);
      X3 = M(Y2 + Z2);
      t5 = M(t5 * X3);
      X3 = M(t1 + t2);
      t5 = M(t5 - X3);
      Z3 = M(a * t4);
      X3 = M(b3 * t2);
      Z3 = M(X3 + Z3);
      X3 = M(t1 - Z3);
      Z3 = M(t1 + Z3);
      Y3 = M(X3 * Z3);
      t1 = M(t0 + t0);
      t1 = M(t1 + t0);
      t2 = M(a * t2);
      t4 = M(b3 * t4);
      t1 = M(t1 + t2);
      t2 = M(t0 - t2);
      t2 = M(a * t2);
      t4 = M(t4 + t2);
      t0 = M(t1 * t4);
      Y3 = M(Y3 + t0);
      t0 = M(t5 * t4);
      X3 = M(t3 * X3);
      X3 = M(X3 - t0);
      t0 = M(t3 * t1);
      Z3 = M(t5 * Z3);
      Z3 = M(Z3 + t0);
      return new _Point(X3, Y3, Z3);
    }
    subtract(other) {
      return this.add(apoint(other).negate());
    }
    /**
     * Point-by-scalar multiplication. Scalar must be in range 1 <= n < CURVE.n.
     * Uses {@link wNAF} for base point.
     * Uses fake point to mitigate leakage shape in JS, not as a hard constant-time guarantee.
     * @param n scalar by which point is multiplied
     * @param safe safe mode guards against timing attacks; unsafe mode is faster
     */
    multiply(n, safe = true) {
      if (!safe && n === 0n)
        return I;
      FnIsValidNot0(n);
      if (n === 1n)
        return this;
      if (this.equals(G))
        return wNAF(n).p;
      let p = I;
      let f = G;
      let d = this;
      for (let i = 0; safe ? i < 256 : n > 0n; i++) {
        if (n & 1n)
          p = p.add(d);
        else if (safe)
          f = f.add(d);
        d = d.double();
        n >>= 1n;
      }
      return p;
    }
    multiplyUnsafe(scalar) {
      return this.multiply(scalar, false);
    }
    /** Convert point to 2d xy affine point. (X, Y, Z) ∋ (x=X/Z, y=Y/Z) */
    toAffine() {
      const { X: x, Y: y, Z: z } = this;
      if (z === 0n)
        return { x: 0n, y: 0n };
      if (z === 1n)
        return { x, y };
      const iz = invert(z, P);
      if (M(z * iz) !== 1n)
        throw new Error("inverse invalid");
      return { x: M(x * iz), y: M(y * iz) };
    }
    /** Checks if the point is valid and on-curve. */
    assertValidity() {
      const { x, y } = this.toAffine();
      FpIsValidNot0(x);
      FpIsValidNot0(y);
      if (M(y * y) !== koblitz(x))
        throw new Error(E_BADPOINT);
      return this;
    }
    /** Converts point to 33/65-byte Uint8Array. */
    toBytes(isCompressed = true) {
      const { x, y } = this.assertValidity().toAffine();
      const x32b = numTo32b(x);
      if (isCompressed)
        return concatBytes(getPrefix(y), x32b);
      return concatBytes(Uint8Array.of(4), x32b, numTo32b(y));
    }
    toHex(isCompressed) {
      return bytesToHex(this.toBytes(isCompressed));
    }
  };
  __publicField(_Point, "BASE");
  __publicField(_Point, "ZERO");
  var Point = _Point;
  var G = new Point(Gx, Gy, 1n);
  var I = new Point(0n, 1n, 0n);
  Point.BASE = G;
  Point.ZERO = I;
  var doubleScalarMulUns = (R, u1, u2) => {
    return G.multiply(u1, false).add(R.multiply(u2, false)).assertValidity();
  };
  var bytesToNumBE = (b) => big("0x" + (bytesToHex(b) || "0"));
  var sliceBytesNumBE = (b, from, to) => bytesToNumBE(b.subarray(from, to));
  var numTo32b = (num) => hexToBytes(padh(arange(num, 0n, 2n ** 256n), L * 2));
  var secretKeyToScalar = (secretKey2) => {
    const num = bytesToNumBE(abytes(secretKey2, L, "secret key"));
    return arange(num, 1n, N, "invalid secret key: outside of range");
  };
  var _sha = "SHA-256";
  var hashes = {
    hmacSha256Async: async (key, message) => {
      const s = subtle();
      const k = await s.importKey("raw", key, { name: "HMAC", hash: _sha }, false, ["sign"]);
      return new Uint8Array(await s.sign("HMAC", k, message));
    },
    hmacSha256: void 0,
    sha256Async: async (msg) => new Uint8Array(await subtle().digest(_sha, msg)),
    sha256: void 0
  };
  var randomSecretKey = (seed) => {
    seed = seed === void 0 ? randomBytes(48) : seed;
    abytes(seed);
    if (seed.length < 48 || seed.length > 1024)
      throw new RangeError("expected 48-1024b");
    const num = M(bytesToNumBE(seed), N - 1n);
    return numTo32b(num + 1n);
  };
  var createKeygen = (getPublicKey) => (seed) => {
    const secretKey2 = randomSecretKey(seed);
    return { secretKey: secretKey2, publicKey: getPublicKey(secretKey2) };
  };
  var getTag = (tag2) => Uint8Array.from("BIP0340/" + tag2, (c) => c.charCodeAt(0));
  var taggedHash = (tag2, ...messages) => {
    const tagH = callHash("sha256", getTag(tag2));
    return callHash("sha256", concatBytes(tagH, tagH, ...messages));
  };
  var taggedHashAsync = (tag2, ...messages) => callHashAsync("sha256Async", getTag(tag2)).then((tagH) => callHashAsync("sha256Async", concatBytes(tagH, tagH, ...messages)));
  var extpubSchnorr = (priv) => {
    const d_ = secretKeyToScalar(priv);
    const p = G.multiply(d_);
    const { x, y } = p.assertValidity().toAffine();
    const d = isEven(y) ? d_ : modN(-d_);
    const px = numTo32b(x);
    return { d, px };
  };
  var bytesModN = (bytes) => modN(bytesToNumBE(bytes));
  var challenge = (...args) => bytesModN(taggedHash("challenge", ...args));
  var challengeAsync = async (...args) => bytesModN(await taggedHashAsync("challenge", ...args));
  var pubSchnorr = (secretKey2) => {
    return extpubSchnorr(secretKey2).px;
  };
  var keygenSchnorr = /* @__PURE__ */ createKeygen(pubSchnorr);
  var prepSigSchnorr = (message, secretKey2, auxRand) => {
    const m = snapshotBytes(message, "message");
    const { px, d } = extpubSchnorr(secretKey2);
    return { m, px, d, a: abytes(auxRand, L) };
  };
  var extractK = (rand) => {
    const k_ = bytesModN(rand);
    if (k_ === 0n)
      throw new Error("sign failed: k is zero");
    const { px, d } = extpubSchnorr(numTo32b(k_));
    return { rx: px, k: d };
  };
  var createSigSchnorr = (k, px, e, d) => {
    return concatBytes(px, numTo32b(modN(k + e * d)));
  };
  var E_INVSIG = "invalid signature produced";
  var signSchnorr = (message, secretKey2, auxRand = randomBytes(L)) => {
    const { m, px, d, a } = prepSigSchnorr(message, secretKey2, auxRand);
    const t = numTo32b(d ^ bytesToNumBE(taggedHash("aux", a)));
    const { rx, k } = extractK(taggedHash("nonce", t, px, m));
    const sig = createSigSchnorr(k, rx, challenge(rx, px, m), d);
    if (!verifySchnorr(sig, m, px))
      throw new Error(E_INVSIG);
    return sig;
  };
  var signSchnorrAsync = async (message, secretKey2, auxRand = randomBytes(L)) => {
    const { m, px, d, a } = prepSigSchnorr(message, secretKey2, auxRand);
    const t = numTo32b(d ^ bytesToNumBE(await taggedHashAsync("aux", a)));
    const { rx, k } = extractK(await taggedHashAsync("nonce", t, px, m));
    const sig = createSigSchnorr(k, rx, await challengeAsync(rx, px, m), d);
    if (!await verifySchnorrAsync(sig, m, px))
      throw new Error(E_INVSIG);
    return sig;
  };
  var callSyncAsyncFn = (res, later) => {
    return res instanceof Promise ? res.then(later) : later(res);
  };
  var _verifSchnorr = (signature, message, publicKey2, challengeFn) => {
    const sig = abytes(signature, 64, "signature");
    const msg = abytes(message, void 0, "message");
    const pub = abytes(publicKey2, L, "publicKey");
    let P_;
    let r;
    let s;
    let chalInput;
    try {
      const x = bytesToNumBE(pub);
      P_ = lift_x(x);
      r = FpIsValidNot0(sliceBytesNumBE(sig, 0, L));
      s = FnIsValidNot0(sliceBytesNumBE(sig, L, 64));
      chalInput = concatBytes(numTo32b(r), pub, msg);
    } catch (error) {
      return false;
    }
    return callSyncAsyncFn(challengeFn(chalInput), (e) => {
      try {
        const { x, y } = doubleScalarMulUns(P_, s, modN(-e)).toAffine();
        if (!isEven(y) || x !== r)
          return false;
        return true;
      } catch (error) {
        return false;
      }
    });
  };
  var verifySchnorr = (s, m, p) => _verifSchnorr(s, m, p, challenge);
  var verifySchnorrAsync = async (s, m, p) => _verifSchnorr(s, m, p, challengeAsync);
  var schnorr = /* @__PURE__ */ freeze({
    keygen: keygenSchnorr,
    getPublicKey: pubSchnorr,
    sign: signSchnorr,
    verify: verifySchnorr,
    signAsync: signSchnorrAsync,
    verifyAsync: verifySchnorrAsync
  });
  var precompute = () => {
    const points = [];
    let p = G;
    let b = p;
    for (let w = 0; w < 33; w++) {
      b = p;
      points.push(b);
      for (let i = 1; i < 128; i++) {
        b = b.add(p);
        points.push(b);
      }
      p = b.double();
    }
    return points;
  };
  var Gpows = void 0;
  var ctneg = (cnd, p) => {
    const n = p.negate();
    return cnd ? n : p;
  };
  var wNAF = (n) => {
    const comp = Gpows || (Gpows = precompute());
    let p = I;
    let f = G;
    for (let w = 0; w < 33; w++) {
      let wbits = Number(n & 255n);
      n >>= 8n;
      if (wbits > 128) {
        wbits -= 256;
        n += 1n;
      }
      const off = w * 128;
      const offP = off + Math.abs(wbits) - 1;
      const isOddW = w % 2 !== 0;
      const isNeg = wbits < 0;
      if (wbits === 0) {
        f = f.add(ctneg(isOddW, comp[off]));
      } else {
        p = p.add(ctneg(isNeg, comp[offP]));
      }
    }
    if (n !== 0n)
      throw new Error("invalid wnaf");
    return { p, f };
  };

  // ../../../../node_modules/@trystero-p2p/nostr/node_modules/@trystero-p2p/core/dist/utils.mjs
  var { floor: floor2, min: min2, sin: sin2 } = Math;
  var libName2 = "Trystero";
  var alloc2 = (n, f) => Array(n).fill(void 0).map(f);
  var charSet2 = "0123456789AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz";
  var genId2 = (n) => alloc2(n, () => charSet2[floor2(Math.random() * 62)] ?? "").join("");
  var selfId2 = genId2(20);
  var all2 = Promise.all.bind(Promise);
  var isBrowser2 = typeof window !== "undefined";
  var { entries: entries2, fromEntries: fromEntries2, keys: keys2, values: values2 } = Object;
  var noOp2 = () => {
  };
  var candidateType2 = "candidate";
  var resetTimer2 = (timer) => {
    if (timer !== null) clearTimeout(timer);
    return null;
  };
  var mkErr2 = (msg) => /* @__PURE__ */ new Error(`${libName2}: ${msg}`);
  var toErrorMessage2 = (reason, fallback) => {
    if (reason instanceof Error && reason.message) return reason.message;
    if (typeof reason === "string" && reason) return reason;
    return toJson2(reason ?? fallback);
  };
  var toError2 = (reason, fallback) => reason instanceof Error ? reason : mkErr2(toErrorMessage2(reason, fallback));
  var encoder2 = new TextEncoder();
  var decoder2 = new TextDecoder();
  var encodeBytes2 = (txt) => encoder2.encode(txt);
  var decodeBytes2 = (buffer) => decoder2.decode(buffer);
  var toHex2 = (buffer) => buffer.reduce((a, c) => a + c.toString(16).padStart(2, "0"), "");
  var topicPath2 = (...parts) => parts.join("@");
  var shuffle2 = (xs, seed) => {
    const a = [...xs];
    const rand = () => {
      const x = sin2(seed++) * 1e4;
      return x - floor2(x);
    };
    let i = a.length;
    while (i) {
      const j = floor2(rand() * i--);
      const tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  };
  var getRelays2 = (config, defaults, defaultN, deriveFromAppId = false) => {
    var _a, _b;
    return ((_a = config.relayConfig) == null ? void 0 : _a.urls) || (deriveFromAppId ? shuffle2(defaults, strToNum2(config.appId)) : defaults).slice(0, ((_b = config.relayConfig) == null ? void 0 : _b.redundancy) ?? defaultN);
  };
  var toJson2 = JSON.stringify;
  var fromJson2 = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      throw mkErr2(`failed to parse JSON: ${s}`);
    }
  };
  var strToNum2 = (str, limit = Number.MAX_SAFE_INTEGER) => str.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % limit;
  var defaultRetryMs2 = 3333;
  var maxRetryMs2 = 6e4;
  var socketRetryPeriods2 = {};
  var reconnectionLockingPromise2 = null;
  var resolver2 = null;
  var pauseRelayReconnection2 = () => {
    if (!reconnectionLockingPromise2) reconnectionLockingPromise2 = new Promise((resolve) => {
      resolver2 = resolve;
    }).finally(() => {
      resolver2 = null;
      reconnectionLockingPromise2 = null;
    });
  };
  var resumeRelayReconnection2 = () => {
    resolver2 == null ? void 0 : resolver2();
  };
  var makeSocket2 = (url, onMessage, onReconnect) => {
    const client = {};
    let didOpen = false;
    let isReconnectPending = false;
    let retryTimer;
    let resolveReady = noOp2;
    client.isClosed = false;
    client.ready = new Promise((res) => resolveReady = res);
    const init = () => {
      if (client.isClosed) return;
      retryTimer = void 0;
      isReconnectPending = false;
      const socket = new WebSocket(url);
      socket.onclose = () => {
        if (client.isClosed || isReconnectPending) return;
        isReconnectPending = true;
        if (reconnectionLockingPromise2) {
          reconnectionLockingPromise2.then(init);
          return;
        }
        const period = socketRetryPeriods2[url] ?? (socketRetryPeriods2[url] = defaultRetryMs2);
        if (period >= maxRetryMs2) {
          client.isClosed = true;
          return;
        }
        retryTimer = setTimeout(init, Math.random() * period);
        socketRetryPeriods2[url] = min2(period * 2, maxRetryMs2);
      };
      socket.onmessage = (e) => onMessage(String(e.data));
      client.socket = socket;
      client.url = socket.url;
      socket.onopen = () => {
        const isReconnect = didOpen;
        didOpen = true;
        resolveReady(client);
        socketRetryPeriods2[url] = defaultRetryMs2;
        if (isReconnect) onReconnect == null ? void 0 : onReconnect();
      };
      client.send = (data) => {
        if (socket.readyState === 1) socket.send(data);
      };
    };
    client.close = () => {
      client.isClosed = true;
      if (retryTimer !== void 0) {
        clearTimeout(retryTimer);
        retryTimer = void 0;
      }
      client.socket.close();
    };
    init();
    return client;
  };
  var createRelayManager2 = (getSocket) => {
    const relays = {};
    const keysByRelay = /* @__PURE__ */ new WeakMap();
    const keyOf = (relay) => {
      const key = keysByRelay.get(relay);
      if (!key) throw mkErr2("relay bookkeeping missing registration for relay client");
      return key;
    };
    const scoped = () => {
      const store2 = {};
      const forKey = (key) => store2[key] ?? (store2[key] = {});
      return {
        forKey,
        forRelay: (relay) => forKey(keyOf(relay))
      };
    };
    const store = (key, relay) => {
      relays[key] = relay;
      keysByRelay.set(relay, key);
      return relay;
    };
    return {
      register: (key, createRelay) => {
        const relay = relays[key];
        if (relay) return relay;
        return store(key, createRelay());
      },
      keyOf,
      scoped,
      getSockets: () => fromEntries2(entries2(relays).flatMap(([key, relay]) => {
        const socket = getSocket(relay);
        return socket ? [[key, socket]] : [];
      }))
    };
  };
  var watchOnline2 = () => {
    if (isBrowser2) {
      const controller = new AbortController();
      addEventListener("online", resumeRelayReconnection2, { signal: controller.signal });
      addEventListener("offline", pauseRelayReconnection2, { signal: controller.signal });
      return () => controller.abort();
    }
    return noOp2;
  };

  // ../../../../node_modules/@trystero-p2p/nostr/node_modules/@trystero-p2p/core/dist/crypto.mjs
  var algo2 = "AES-GCM";
  var strToSha12 = {};
  var pack2 = (buff) => btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(buff))));
  var unpack2 = (packed) => {
    const str = atob(packed);
    return new Uint8Array(str.length).map((_, i) => str.charCodeAt(i)).buffer;
  };
  var hashWith2 = async (algorithm, str) => new Uint8Array(await crypto.subtle.digest(algorithm, encodeBytes2(str)));
  var sha12 = async (str) => strToSha12[str] ?? (strToSha12[str] = Array.from(await hashWith2("SHA-1", str)).map((b) => b.toString(36)).join(""));
  var genKey2 = async (secret, appId, roomId) => crypto.subtle.importKey("raw", await crypto.subtle.digest({ name: "SHA-256" }, encodeBytes2(`${secret}:${appId}:${roomId}`)), { name: algo2 }, false, ["encrypt", "decrypt"]);
  var deriveRoomNamespace2 = async (appId, roomId) => toHex2(await hashWith2("SHA-256", `${libName2}:${appId}:${roomId}`));
  var joinChar2 = "$";
  var ivJoinChar2 = ",";
  var encrypt2 = async (keyP, plaintext) => {
    const iv = crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(16));
    return iv.join(ivJoinChar2) + joinChar2 + pack2(await crypto.subtle.encrypt({
      name: algo2,
      iv
    }, await keyP, encodeBytes2(plaintext)));
  };
  var decrypt2 = async (keyP, raw) => {
    const [iv, c] = raw.split(joinChar2);
    return decodeBytes2(await crypto.subtle.decrypt({
      name: algo2,
      iv: new Uint8Array((iv == null ? void 0 : iv.split(ivJoinChar2).map(Number)) ?? [])
    }, await keyP, unpack2(c ?? "")));
  };

  // ../../../../node_modules/@trystero-p2p/nostr/node_modules/@trystero-p2p/core/dist/offer-pool.mjs
  var offerTtl2 = 57333;
  var offerLeaseTtlMs2 = 18e4;
  var poolSize2 = 20;
  var OfferPool2 = class {
    constructor(makeOffer) {
      __publicField(this, "makeOffer");
      __publicField(this, "pool", []);
      __publicField(this, "pooled", /* @__PURE__ */ new Set());
      __publicField(this, "leased", /* @__PURE__ */ new Map());
      __publicField(this, "recycling", /* @__PURE__ */ new Set());
      __publicField(this, "cleanupTimer", null);
      __publicField(this, "active", false);
      this.makeOffer = makeOffer;
    }
    get isActive() {
      return this.active;
    }
    warmup() {
      this.pool = [];
      this.pooled.clear();
      alloc2(poolSize2, this.makeOffer).forEach((p) => this.push(p));
      this.active = true;
      this.cleanupTimer = setInterval(() => {
        this.pool = this.pool.filter((peer) => {
          if (peer.isDead) {
            this.pooled.delete(peer);
            return false;
          }
          return true;
        });
      }, offerTtl2);
    }
    push(peer) {
      if (peer.isDead || this.pooled.has(peer) || this.leased.has(peer)) return;
      this.pool.push(peer);
      this.pooled.add(peer);
    }
    shift(n) {
      const peers = [];
      while (peers.length < n && this.pool.length > 0) {
        const peer = this.pool.shift();
        if (!peer) break;
        this.pooled.delete(peer);
        peers.push(peer);
      }
      return peers;
    }
    claimLeased(peer) {
      const timer = this.leased.get(peer);
      if (timer) {
        resetTimer2(timer);
        this.leased.delete(peer);
      }
    }
    recycle(peer) {
      if (peer.isDead || this.recycling.has(peer)) return;
      if (peer.connection.remoteDescription) {
        peer.destroy();
        return;
      }
      if (!this.active) {
        peer.destroy();
        return;
      }
      this.recycling.add(peer);
      peer.setHandlers({
        connect: noOp2,
        close: noOp2,
        error: noOp2
      });
      peer.getOffer(true).then((offer) => {
        if (!offer || offer.type !== "offer" || peer.isDead || !this.active) {
          peer.destroy();
          return;
        }
        this.push(peer);
      }).catch(() => peer.destroy()).finally(() => this.recycling.delete(peer));
    }
    reclaimLeased(peer) {
      const timer = this.leased.get(peer);
      if (!timer) return;
      resetTimer2(timer);
      this.leased.delete(peer);
      this.recycle(peer);
    }
    lease(peer) {
      this.claimLeased(peer);
      this.leased.set(peer, setTimeout(() => {
        this.leased.delete(peer);
        this.recycle(peer);
      }, offerLeaseTtlMs2));
    }
    checkout(n, leaseOffers, encryptOffer) {
      const peers = this.shift(n);
      const missing = Math.max(0, n - peers.length);
      if (missing > 0) peers.push(...alloc2(missing, this.makeOffer));
      const toRecord = async (candidate, didRetry = false) => {
        try {
          const offer = await encryptOffer(candidate);
          if (leaseOffers) {
            this.lease(candidate);
            return {
              peer: candidate,
              offer,
              claim: () => this.claimLeased(candidate),
              reclaim: () => this.reclaimLeased(candidate)
            };
          }
          return {
            peer: candidate,
            offer
          };
        } catch (err) {
          this.claimLeased(candidate);
          this.pooled.delete(candidate);
          candidate.destroy();
          if (!didRetry) return toRecord(this.makeOffer(), true);
          throw err;
        }
      };
      return all2(peers.map((peer) => toRecord(peer)));
    }
    getOffers(n, encryptOffer) {
      return this.checkout(n, true, encryptOffer);
    }
    destroy() {
      this.active = false;
      if (this.cleanupTimer) {
        clearInterval(this.cleanupTimer);
        this.cleanupTimer = null;
      }
      this.pool.forEach((peer) => peer.destroy());
      this.pool = [];
      this.pooled.clear();
      this.leased.forEach((timeout, peer) => {
        resetTimer2(timeout);
        peer.destroy();
      });
      this.leased.clear();
      this.recycling.forEach((peer) => peer.destroy());
      this.recycling.clear();
    }
  };

  // ../../../../node_modules/@trystero-p2p/nostr/node_modules/@trystero-p2p/core/dist/handshake.mjs
  var overlapRoomPasswordErr2 = mkErr2("incorrect password for overlapping room");
  var createPasswordHandshake2 = (password, appId, roomId) => {
    const hashChallenge = (challenge2) => hashWith2("SHA-256", `${challenge2}:${password}:${appId}:${roomId}`).then(toHex2);
    const run = async (send2, receive, isInitiator) => {
      if (!password) return;
      if (isInitiator) {
        const challenge2 = genId2(36);
        await send2({
          __trystero_pw: "challenge",
          c: challenge2
        });
        const { data: data2 } = await receive();
        if (!data2 || typeof data2 !== "object" || data2.__trystero_pw !== "response" || typeof data2.h !== "string") throw overlapRoomPasswordErr2;
        const expected = await hashChallenge(challenge2);
        if (data2.h !== expected) throw overlapRoomPasswordErr2;
        return;
      }
      const { data } = await receive();
      if (!data || typeof data !== "object" || data.__trystero_pw !== "challenge" || typeof data.c !== "string") throw overlapRoomPasswordErr2;
      await send2({
        __trystero_pw: "response",
        h: await hashChallenge(data.c)
      });
    };
    const compose = (userHandshake) => password || userHandshake ? async (peerId, send2, receive, isInitiator) => {
      await run(send2, receive, isInitiator);
      await (userHandshake == null ? void 0 : userHandshake(peerId, send2, receive, isInitiator));
    } : void 0;
    return {
      run,
      compose
    };
  };
  var toHandshakeErrorMessage2 = (error) => {
    const message = toErrorMessage2(error, "unknown error");
    return message.startsWith("handshake ") ? message : `handshake failed: ${message}`;
  };
  var createHandshakeManager2 = ({ onPeerHandshake, onHandshakeError, handshakeTimeoutMs, sendHandshakeData, sendHandshakeReady, onActivate, onFailure }) => {
    const peerStates = {};
    const maybeActivatePeer = (id, peer) => {
      const state = peerStates[id];
      if (!state || peer && state.peer !== peer || state.isActive) return;
      if (!state.didLocalHandshakePass || !state.didReceiveRemoteReady) return;
      state.isActive = true;
      state.handshakeTimer = resetTimer2(state.handshakeTimer);
      onActivate(id, state.peer);
    };
    const failPeerHandshake = (id, peer, reason) => {
      const state = peerStates[id];
      if (!state || state.peer !== peer) return;
      const error = toHandshakeErrorMessage2(reason);
      onHandshakeError == null ? void 0 : onHandshakeError(id, error);
      onFailure(id, peer, mkErr2(error));
    };
    const markLocalHandshakePassed = (id, peer) => {
      const state = peerStates[id];
      if (!state || state.peer !== peer || state.isActive) return;
      state.didLocalHandshakePass = true;
      sendHandshakeReady("", id).catch((err) => failPeerHandshake(id, peer, mkErr2(`failed sending handshake readiness: ${toErrorMessage2(err, "unknown send failure")}`)));
      maybeActivatePeer(id, peer);
    };
    return {
      addPeer: (id, peer) => {
        peerStates[id] = {
          peer,
          isActive: false,
          didLocalHandshakePass: false,
          didReceiveRemoteReady: false,
          handshakeTimer: null,
          pendingHandshakePayloads: [],
          handshakeWaiters: []
        };
      },
      clearPeer: (id, error) => {
        const state = peerStates[id];
        if (!state) return;
        state.handshakeTimer = resetTimer2(state.handshakeTimer);
        state.pendingHandshakePayloads.length = 0;
        state.handshakeWaiters.splice(0).forEach((waiter) => waiter.reject(error));
        delete peerStates[id];
      },
      canReceiveFromPeer: (id, receiveWhilePending) => {
        const state = peerStates[id];
        return Boolean(state && (state.isActive || receiveWhilePending));
      },
      start: (id, peer) => {
        const state = peerStates[id];
        if (!state || state.peer !== peer) return;
        state.handshakeTimer = setTimeout(() => failPeerHandshake(id, peer, mkErr2(`handshake timed out after ${handshakeTimeoutMs}ms`)), handshakeTimeoutMs);
        const sendHandshake = async (data, metadata) => {
          await sendHandshakeData(data, id, metadata);
        };
        const receiveHandshake = () => new Promise((resolve, reject) => {
          const current = peerStates[id];
          if (!current || current.peer !== peer) {
            reject(mkErr2("peer disconnected during handshake"));
            return;
          }
          const payload = current.pendingHandshakePayloads.shift();
          if (payload) {
            resolve(payload);
            return;
          }
          current.handshakeWaiters.push({
            resolve,
            reject: (error) => reject(error)
          });
        });
        const isInitiator = selfId2 < id;
        Promise.resolve(onPeerHandshake == null ? void 0 : onPeerHandshake(id, sendHandshake, receiveHandshake, isInitiator)).then(() => markLocalHandshakePassed(id, peer)).catch((err) => failPeerHandshake(id, peer, toError2(err, "handshake failed")));
      },
      receiveHandshakeData: (data, id, metadata) => {
        const state = peerStates[id];
        if (!state || state.isActive) return;
        const payload = metadata === void 0 ? { data } : {
          data,
          metadata
        };
        const pending = state.handshakeWaiters.shift();
        if (pending) {
          pending.resolve(payload);
          return;
        }
        state.pendingHandshakePayloads.push(payload);
      },
      receiveHandshakeReady: (id) => {
        const state = peerStates[id];
        if (!state || state.isActive) return;
        state.didReceiveRemoteReady = true;
        maybeActivatePeer(id);
      }
    };
  };

  // ../../../../node_modules/@trystero-p2p/nostr/node_modules/@trystero-p2p/core/dist/peer.mjs
  var iceTimeout2 = 15e3;
  var disconnectedCloseDelayMs2 = 5e3;
  var iceStateEvent2 = "icegatheringstatechange";
  var iceConnectionStateEvent2 = "iceconnectionstatechange";
  var offerType2 = "offer";
  var answerType2 = "answer";
  var outOfRangePattern2 = /out of range/i;
  var rewriteMdnsCandidatesToLoopback2 = (sdp) => sdp.replace(/ (\S+\.local) (\d+) typ host/g, " 127.0.0.1 $2 typ host");
  var peer_default2 = (initiator, { trickleIce, rtcConfig, rtcPolyfill, turnConfig, _test_only_mdnsHostFallbackToLoopback }) => {
    const pc = new (rtcPolyfill ?? RTCPeerConnection)({
      iceServers: defaultIceServers2.concat(turnConfig ?? []),
      ...rtcConfig
    });
    const handlers = {};
    const pendingSignals = [];
    const pendingData = [];
    const shouldTrickleIce = trickleIce !== false;
    const pendingRemoteCandidates = [];
    const pendingTracks = [];
    let makingOffer = false;
    let isSettingRemoteAnswerPending = false;
    let dataChannel = null;
    let disconnectedCloseTimer = null;
    let didEmitClose = false;
    const clearDisconnectedCloseTimer = () => disconnectedCloseTimer = resetTimer2(disconnectedCloseTimer);
    const emitClose = () => {
      var _a;
      if (didEmitClose) return;
      didEmitClose = true;
      clearDisconnectedCloseTimer();
      (_a = handlers.close) == null ? void 0 : _a.call(handlers);
    };
    const emitSignal = (signal) => {
      if (handlers.signal) handlers.signal(signal);
      else pendingSignals.push(signal);
    };
    const appendSignalHandler = (handler) => {
      const previousSignalHandler = handlers.signal;
      handlers.signal = (signal) => {
        previousSignalHandler == null ? void 0 : previousSignalHandler(signal);
        handler(signal);
      };
      if (pendingSignals.length > 0) pendingSignals.splice(0).forEach((signal) => {
        var _a;
        return (_a = handlers.signal) == null ? void 0 : _a.call(handlers, signal);
      });
    };
    const normalizeSdp = (sdp) => _test_only_mdnsHostFallbackToLoopback ? rewriteMdnsCandidatesToLoopback2(sdp) : sdp;
    const normalizeCandidate = (candidate) => {
      if (!_test_only_mdnsHostFallbackToLoopback || typeof candidate.candidate !== "string") return candidate;
      const normalizedCandidate = rewriteMdnsCandidatesToLoopback2(candidate.candidate);
      return normalizedCandidate === candidate.candidate ? candidate : {
        ...candidate,
        candidate: normalizedCandidate
      };
    };
    const localDescriptionSignal = (peerConnection) => {
      var _a, _b;
      return {
        type: ((_a = peerConnection.localDescription) == null ? void 0 : _a.type) ?? offerType2,
        sdp: normalizeSdp(((_b = peerConnection.localDescription) == null ? void 0 : _b.sdp) ?? "")
      };
    };
    const getRemoteUfrag = () => {
      var _a, _b;
      const sdp = (_a = pc.remoteDescription) == null ? void 0 : _a.sdp;
      if (!sdp) return null;
      return ((_b = sdp.match(/a=ice-ufrag:([^\s]+)/)) == null ? void 0 : _b[1]) ?? null;
    };
    const getRemoteMediaSectionCount = () => {
      var _a, _b;
      return (((_b = (_a = pc.remoteDescription) == null ? void 0 : _a.sdp) == null ? void 0 : _b.match(/^m=/gm)) ?? []).length;
    };
    const canApplyRemoteCandidate = (candidate) => {
      if (!pc.remoteDescription) return false;
      const remoteMLineCount = getRemoteMediaSectionCount();
      if (typeof candidate.sdpMLineIndex === "number" && remoteMLineCount > 0 && candidate.sdpMLineIndex >= remoteMLineCount) return false;
      const remoteUfrag = getRemoteUfrag();
      if (remoteUfrag && candidate.usernameFragment && candidate.usernameFragment !== remoteUfrag) return false;
      return true;
    };
    const addIceCandidateSafe = async (candidate) => {
      try {
        await pc.addIceCandidate(candidate);
        return true;
      } catch (err) {
        if (err instanceof Error && outOfRangePattern2.test(err.message) && typeof candidate.sdpMLineIndex === "number") return false;
        throw err;
      }
    };
    const flushPendingRemoteCandidates = async () => {
      if (!pc.remoteDescription || pendingRemoteCandidates.length === 0) return;
      const queuedCandidates = pendingRemoteCandidates.splice(0);
      const stillPending = [];
      for (const candidate of queuedCandidates) {
        if (!canApplyRemoteCandidate(candidate)) {
          stillPending.push(candidate);
          continue;
        }
        if (!await addIceCandidateSafe(candidate)) stillPending.push(candidate);
      }
      if (stillPending.length > 0) pendingRemoteCandidates.push(...stillPending);
    };
    const addRemoteCandidate = async (candidate) => {
      if (canApplyRemoteCandidate(candidate)) {
        if (!await addIceCandidateSafe(candidate)) pendingRemoteCandidates.push(candidate);
        return;
      }
      pendingRemoteCandidates.push(candidate);
    };
    const setupDataChannel = (channel) => {
      channel.binaryType = "arraybuffer";
      channel.bufferedAmountLowThreshold = 65535;
      channel.onmessage = (e) => {
        const data = e.data;
        if (handlers.data) handlers.data(data);
        else pendingData.push(data);
      };
      channel.onopen = () => {
        var _a;
        return (_a = handlers.connect) == null ? void 0 : _a.call(handlers);
      };
      channel.onclose = emitClose;
      channel.onerror = ({ error }) => {
        var _a;
        return (_a = handlers.error) == null ? void 0 : _a.call(handlers, toError2(error, "data channel error"));
      };
    };
    const waitForIceGathering = async (peerConnection) => {
      let timeout = null;
      try {
        await Promise.race([new Promise((res) => {
          const checkState = () => {
            if (peerConnection.iceGatheringState === "complete") {
              peerConnection.removeEventListener(iceStateEvent2, checkState);
              res();
            }
          };
          peerConnection.addEventListener(iceStateEvent2, checkState);
          checkState();
        }), new Promise((res) => {
          timeout = setTimeout(res, iceTimeout2);
        })]);
      } finally {
        resetTimer2(timeout);
      }
      return localDescriptionSignal(peerConnection);
    };
    const emitLocalDescriptionSignal = async () => {
      const signal = shouldTrickleIce ? localDescriptionSignal(pc) : await waitForIceGathering(pc);
      emitSignal(signal);
      return signal;
    };
    if (initiator) {
      dataChannel = pc.createDataChannel("data");
      setupDataChannel(dataChannel);
    } else pc.ondatachannel = ({ channel }) => {
      dataChannel = channel;
      setupDataChannel(channel);
    };
    const createOffer = async (restartIce = false) => {
      var _a, _b;
      if (pc.connectionState === "closed") return;
      try {
        makingOffer = true;
        if (restartIce) {
          if (pc.signalingState !== "stable" && pc.signalingState !== "closed" && ((_a = pc.localDescription) == null ? void 0 : _a.type) === offerType2) await pc.setLocalDescription({ type: "rollback" });
          if (typeof pc.restartIce === "function") pc.restartIce();
        }
        await pc.setLocalDescription(restartIce ? await pc.createOffer({ iceRestart: true }) : void 0);
        return await emitLocalDescriptionSignal();
      } catch (err) {
        (_b = handlers.error) == null ? void 0 : _b.call(handlers, toError2(err, "failed to create local offer"));
      } finally {
        makingOffer = false;
      }
    };
    pc.onnegotiationneeded = async () => createOffer(false);
    pc.onicecandidate = ({ candidate }) => {
      if (!shouldTrickleIce || !candidate) return;
      const candidatePayload = normalizeCandidate(typeof candidate.toJSON === "function" ? candidate.toJSON() : {
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
        usernameFragment: candidate.usernameFragment
      });
      emitSignal({
        type: candidateType2,
        sdp: JSON.stringify(candidatePayload)
      });
    };
    const handleConnectionStateChange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed" || pc.iceConnectionState === "failed" || pc.iceConnectionState === "closed") {
        emitClose();
        return;
      }
      if (pc.connectionState === "connected" || pc.connectionState === "connecting" || pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed" || pc.iceConnectionState === "checking") {
        clearDisconnectedCloseTimer();
        return;
      }
      if (pc.connectionState === "disconnected" || pc.iceConnectionState === "disconnected") {
        if (!disconnectedCloseTimer) disconnectedCloseTimer = setTimeout(() => {
          disconnectedCloseTimer = null;
          if (pc.connectionState === "disconnected" || pc.iceConnectionState === "disconnected") emitClose();
        }, disconnectedCloseDelayMs2);
        return;
      }
    };
    pc.onconnectionstatechange = handleConnectionStateChange;
    pc.addEventListener(iceConnectionStateEvent2, handleConnectionStateChange);
    pc.ontrack = (e) => {
      var _a, _b;
      const stream = e.streams[0];
      if (stream) {
        if (!handlers.track && !handlers.stream) {
          pendingTracks.push({
            track: e.track,
            stream
          });
          return;
        }
        (_a = handlers.track) == null ? void 0 : _a.call(handlers, e.track, stream);
        (_b = handlers.stream) == null ? void 0 : _b.call(handlers, stream);
      }
    };
    pc.onremovestream = (e) => {
      var _a;
      return (_a = handlers.stream) == null ? void 0 : _a.call(handlers, e.stream);
    };
    const offerPromise = initiator ? new Promise((res) => appendSignalHandler((signal) => {
      if (signal.type === offerType2) res(signal);
    })) : Promise.resolve();
    if (initiator) queueMicrotask(() => {
      var _a;
      if (!makingOffer && pc.signalingState === "stable" && !pc.localDescription && pc.connectionState !== "closed") (_a = pc.onnegotiationneeded) == null ? void 0 : _a.call(pc, new Event("negotiationneeded"));
    });
    return {
      created: Date.now(),
      connection: pc,
      get channel() {
        return dataChannel;
      },
      get isDead() {
        return pc.connectionState === "closed";
      },
      getOffer: async (restartIce = false) => {
        var _a;
        if (!initiator) return;
        if (restartIce) return createOffer(true);
        if (((_a = pc.localDescription) == null ? void 0 : _a.type) === offerType2) return shouldTrickleIce ? localDescriptionSignal(pc) : waitForIceGathering(pc);
        return offerPromise;
      },
      async signal(sdp) {
        var _a, _b, _c;
        if (sdp.type === "candidate") {
          try {
            const candidate = JSON.parse(sdp.sdp);
            if (candidate && typeof candidate === "object") await addRemoteCandidate(normalizeCandidate(candidate));
          } catch (err) {
            (_a = handlers.error) == null ? void 0 : _a.call(handlers, toError2(err, "failed to parse remote candidate"));
          }
          return;
        }
        if ((dataChannel == null ? void 0 : dataChannel.readyState) === "open" && !((_b = sdp.sdp) == null ? void 0 : _b.includes("a=rtpmap"))) return;
        try {
          const rtcSdp = {
            ...sdp,
            sdp: normalizeSdp(sdp.sdp)
          };
          if (sdp.type === offerType2) {
            if (makingOffer || pc.signalingState !== "stable" && !isSettingRemoteAnswerPending) {
              if (initiator) return;
              await all2([pc.setLocalDescription({ type: "rollback" }), pc.setRemoteDescription(rtcSdp)]);
            } else await pc.setRemoteDescription(rtcSdp);
            await flushPendingRemoteCandidates();
            await pc.setLocalDescription();
            return await emitLocalDescriptionSignal();
          }
          if (sdp.type === answerType2) {
            isSettingRemoteAnswerPending = true;
            try {
              await pc.setRemoteDescription(rtcSdp);
              await flushPendingRemoteCandidates();
            } finally {
              isSettingRemoteAnswerPending = false;
            }
          }
        } catch (err) {
          (_c = handlers.error) == null ? void 0 : _c.call(handlers, toError2(err, "failed to apply remote signal"));
        }
      },
      sendData: (data) => dataChannel == null ? void 0 : dataChannel.send(data),
      destroy: () => {
        clearDisconnectedCloseTimer();
        dataChannel == null ? void 0 : dataChannel.close();
        pc.close();
        makingOffer = false;
        isSettingRemoteAnswerPending = false;
        emitClose();
      },
      setHandlers: (newHandlers) => {
        const { signal, ...restHandlers } = newHandlers;
        Object.assign(handlers, restHandlers);
        if (handlers.data && pendingData.length > 0) pendingData.splice(0).forEach((data) => {
          var _a;
          return (_a = handlers.data) == null ? void 0 : _a.call(handlers, data);
        });
        if (signal) appendSignalHandler(signal);
        if ((handlers.track || handlers.stream) && pendingTracks.length > 0) pendingTracks.splice(0).forEach(({ track, stream }) => {
          var _a, _b;
          (_a = handlers.track) == null ? void 0 : _a.call(handlers, track, stream);
          (_b = handlers.stream) == null ? void 0 : _b.call(handlers, stream);
        });
      },
      offerPromise,
      addStream: (stream) => stream.getTracks().forEach((track) => pc.addTrack(track, stream)),
      removeStream: (stream) => pc.getSenders().filter((sender) => sender.track && stream.getTracks().includes(sender.track)).forEach((sender) => pc.removeTrack(sender)),
      addTrack: (track, stream) => pc.addTrack(track, stream),
      removeTrack: (track) => {
        const sender = pc.getSenders().find((s) => s.track === track);
        if (sender) pc.removeTrack(sender);
      },
      replaceTrack: (oldTrack, newTrack) => {
        const sender = pc.getSenders().find((s) => s.track === oldTrack);
        if (sender) return sender.replaceTrack(newTrack);
      }
    };
  };
  var defaultIceServers2 = [...alloc2(3, (_, i) => `stun:stun${i || ""}.l.google.com:19302`), "stun:stun.cloudflare.com:3478"].map((url) => ({ urls: url }));

  // ../../../../node_modules/@trystero-p2p/nostr/node_modules/@trystero-p2p/core/dist/action-wire.mjs
  var TypedArray2 = Object.getPrototypeOf(Uint8Array);
  var typeByteLimit2 = 32;
  var typeIndex2 = 0;
  var nonceIndex2 = 32;
  var tagIndex2 = 34;
  var progressIndex2 = 35;
  var payloadIndex2 = 36;
  var chunkSize2 = 16 * 2 ** 10 - payloadIndex2;
  var oneByteMax2 = 255;
  var twoByteMax2 = 65535;
  var buffLowEvent2 = "bufferedamountlow";
  var channelCloseEvent2 = "close";
  var channelErrorEvent2 = "error";
  var backpressureWaitTimeoutMs2 = 1e4;
  var toByteArray2 = (value) => value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  var waitForBufferedAmountLow2 = (channel, timeoutMs = backpressureWaitTimeoutMs2) => {
    if (channel.readyState !== "open" || channel.bufferedAmount <= channel.bufferedAmountLowThreshold) return Promise.resolve(channel.readyState === "open");
    return new Promise((res) => {
      let settled = false;
      let timeout = null;
      const finish = (didDrain) => {
        if (settled) return;
        settled = true;
        channel.removeEventListener(buffLowEvent2, onBufferLow);
        channel.removeEventListener(channelCloseEvent2, onCloseOrError);
        channel.removeEventListener(channelErrorEvent2, onCloseOrError);
        resetTimer2(timeout);
        res(didDrain);
      };
      const onBufferLow = () => finish(true);
      const onCloseOrError = () => finish(false);
      channel.addEventListener(buffLowEvent2, onBufferLow);
      channel.addEventListener(channelCloseEvent2, onCloseOrError);
      channel.addEventListener(channelErrorEvent2, onCloseOrError);
      timeout = setTimeout(() => finish(false), timeoutMs);
      if (channel.readyState !== "open") {
        finish(false);
        return;
      }
      if (channel.bufferedAmount <= channel.bufferedAmountLowThreshold) finish(true);
    });
  };
  var createActionWireManager2 = ({ getPeer, getPeerIds, canReceiveFromPeer, throwIfAborted: throwIfAborted3 }) => {
    const actions = {};
    const actionsCache = {};
    const pendingTransmissions = {};
    const pendingActionPayloads = {};
    const iterate = (targets, f, { includePending = false } = {}) => (targets ? Array.isArray(targets) ? targets : [targets] : getPeerIds(includePending)).flatMap((id) => {
      const peer = getPeer(id, includePending);
      if (!peer) {
        console.warn(`${libName2}: no peer with id ${id} found`);
        return [];
      }
      return [Promise.resolve(f(id, peer))];
    });
    const makeInternalAction = (type, options = {}) => {
      const cached = actionsCache[type];
      if (actions[type] && cached) {
        const cachedOptions = actions[type].options;
        if (cachedOptions.sendToPending !== Boolean(options.sendToPending) || cachedOptions.receiveWhilePending !== Boolean(options.receiveWhilePending)) throw mkErr2(`action type "${type}" cannot be redefined`);
        return cached;
      }
      if (!type) throw mkErr2("action type argument is required");
      const typeBytes = encodeBytes2(type);
      if (typeBytes.byteLength > typeByteLimit2) throw mkErr2(`action type string "${type}" (${typeBytes.byteLength}b) exceeds byte limit (${typeByteLimit2}). Hint: choose a shorter name.`);
      const normalizedOptions = {
        sendToPending: Boolean(options.sendToPending),
        receiveWhilePending: Boolean(options.receiveWhilePending)
      };
      const typeBytesPadded = new Uint8Array(typeByteLimit2);
      typeBytesPadded.set(typeBytes);
      let nonce = 0;
      actions[type] = {
        onComplete: noOp2,
        onProgress: noOp2,
        setOnComplete: (f) => {
          actions[type].onComplete = f;
          const pending = pendingActionPayloads[type];
          if (pending == null ? void 0 : pending.length) {
            delete pendingActionPayloads[type];
            pending.forEach(({ payload, peerId, metadata }) => f(payload, peerId, metadata));
          }
        },
        setOnProgress: (f) => {
          actions[type].onProgress = f;
        },
        send: async (data, targets, meta, onProgress, signal) => {
          throwIfAborted3(signal);
          const dataType = typeof data;
          if (dataType === "undefined") throw mkErr2("action data cannot be undefined");
          const isJson = dataType !== "string";
          const isBlob = data instanceof Blob;
          const isBinary = isBlob || data instanceof ArrayBuffer || data instanceof TypedArray2;
          const hasMeta = meta !== void 0;
          const buffer = isBinary ? toByteArray2(isBlob ? await data.arrayBuffer() : data) : encodeBytes2(isJson ? toJson2(data) : data);
          const metaEncoded = hasMeta ? encodeBytes2(toJson2(meta)) : null;
          const chunkTotal = Math.ceil(buffer.byteLength / chunkSize2) + (hasMeta ? 1 : 0) || 1;
          const chunks = alloc2(chunkTotal, (_, i) => {
            const isLast = i === chunkTotal - 1;
            const isMeta = Boolean(hasMeta && i === 0);
            const chunk = new Uint8Array(payloadIndex2 + (isMeta ? (metaEncoded == null ? void 0 : metaEncoded.byteLength) ?? 0 : isLast ? buffer.byteLength - chunkSize2 * (chunkTotal - (hasMeta ? 2 : 1)) : chunkSize2));
            chunk.set(typeBytesPadded);
            chunk.set([nonce >> 8, nonce & oneByteMax2], nonceIndex2);
            chunk.set([Number(isLast) | Number(isMeta) << 1 | Number(isBinary) << 2 | Number(isJson) << 3], tagIndex2);
            chunk.set([Math.round((i + 1) / chunkTotal * oneByteMax2)], progressIndex2);
            chunk.set(hasMeta ? isMeta ? metaEncoded ?? /* @__PURE__ */ new Uint8Array() : buffer.subarray((i - 1) * chunkSize2, i * chunkSize2) : buffer.subarray(i * chunkSize2, (i + 1) * chunkSize2), payloadIndex2);
            return chunk;
          });
          nonce = nonce + 1 & twoByteMax2;
          await all2(iterate(targets, async (id, peer) => {
            const { channel } = peer;
            let chunkN = 0;
            while (chunkN < chunkTotal) {
              throwIfAborted3(signal);
              const chunk = chunks[chunkN];
              if (!chunk) break;
              if (channel && channel.bufferedAmount > channel.bufferedAmountLowThreshold) {
                const didDrain = await waitForBufferedAmountLow2(channel);
                throwIfAborted3(signal);
                if (!didDrain) break;
              }
              const currentPeer = getPeer(id, normalizedOptions.sendToPending);
              if (!currentPeer || currentPeer !== peer) break;
              peer.sendData(chunk);
              chunkN++;
              const progressByte = chunk[progressIndex2] ?? oneByteMax2;
              onProgress == null ? void 0 : onProgress(progressByte / oneByteMax2, id, meta);
            }
          }, { includePending: normalizedOptions.sendToPending }));
          return [];
        },
        options: normalizedOptions
      };
      return actionsCache[type] = {
        send: actions[type].send,
        onMessage: actions[type].setOnComplete,
        onProgress: actions[type].setOnProgress
      };
    };
    const handleData = (id, data) => {
      var _a, _b;
      const buffer = new Uint8Array(data);
      const type = decodeBytes2(buffer.subarray(typeIndex2, nonceIndex2)).replaceAll("\0", "");
      const action = actions[type];
      if (!canReceiveFromPeer(id, Boolean(action == null ? void 0 : action.options.receiveWhilePending))) return;
      const nonce = (buffer[nonceIndex2] ?? 0) << 8 | (buffer[33] ?? 0);
      const tag2 = buffer[tagIndex2] ?? 0;
      const progress = buffer[progressIndex2] ?? 0;
      const payload = buffer.subarray(payloadIndex2);
      const isLast = Boolean(tag2 & 1);
      const isMeta = Boolean(tag2 & 2);
      const isBinary = Boolean(tag2 & 4);
      const isJson = Boolean(tag2 & 8);
      pendingTransmissions[id] ?? (pendingTransmissions[id] = {});
      (_a = pendingTransmissions[id])[type] ?? (_a[type] = {});
      const target = (_b = pendingTransmissions[id][type])[nonce] ?? (_b[nonce] = { chunks: [] });
      if (isMeta) target.meta = fromJson2(decodeBytes2(payload));
      else target.chunks.push(payload);
      action == null ? void 0 : action.onProgress(progress / oneByteMax2, id, target.meta);
      if (!isLast) return;
      const full = new Uint8Array(target.chunks.reduce((a, c) => a + c.byteLength, 0));
      target.chunks.reduce((a, c) => {
        full.set(c, a);
        return a + c.byteLength;
      }, 0);
      delete pendingTransmissions[id][type][nonce];
      const payloadValue = isBinary ? full : isJson ? fromJson2(decodeBytes2(full)) : decodeBytes2(full);
      if (action) {
        action.onComplete(payloadValue, id, target.meta);
        return;
      }
      (pendingActionPayloads[type] ?? (pendingActionPayloads[type] = [])).push({
        payload: payloadValue,
        peerId: id,
        ...target.meta === void 0 ? {} : { metadata: target.meta }
      });
    };
    return {
      makeInternalAction,
      handleData,
      clearPeer: (id) => {
        delete pendingTransmissions[id];
      }
    };
  };

  // ../../../../node_modules/@trystero-p2p/nostr/node_modules/@trystero-p2p/core/dist/actions.mjs
  var requestHandlerBufferMs2 = 500;
  var makeActionError2 = (kind, message) => {
    const error = mkErr2(message);
    error.kind = kind;
    error.name = kind === "aborted" ? "AbortError" : error.name;
    return error;
  };
  var throwIfAborted2 = (signal) => {
    if (signal == null ? void 0 : signal.aborted) throw makeActionError2("aborted", "operation aborted");
  };
  var getRequestMetadata2 = (metadata) => {
    if (metadata && typeof metadata === "object" && !Array.isArray(metadata) && typeof metadata.r === "string") return {
      r: metadata.r,
      ...Object.hasOwn(metadata, "m") ? { m: metadata.m } : {}
    };
    return null;
  };
  var getResponseMetadata2 = (metadata) => {
    if (metadata && typeof metadata === "object" && !Array.isArray(metadata) && typeof metadata.r === "string") return {
      r: metadata.r,
      ...typeof metadata.e === "string" ? { e: metadata.e } : {}
    };
    return null;
  };
  var withMetadata2 = (context, metadata) => metadata === void 0 ? context : {
    ...context,
    metadata
  };
  var createActionManager2 = ({ getPeer, getPeerIds, canReceiveFromPeer }) => {
    const publicActions = {};
    const pendingRequestWaiters = {};
    const wire = createActionWireManager2({
      getPeer,
      getPeerIds,
      canReceiveFromPeer,
      throwIfAborted: throwIfAborted2
    });
    const makeInternalAction = wire.makeInternalAction;
    const handleData = wire.handleData;
    const clearPendingRequestWaiter = (requestId) => {
      const waiter = pendingRequestWaiters[requestId];
      if (!waiter) return;
      resetTimer2(waiter.timer);
      if (waiter.signal && waiter.abortHandler) waiter.signal.removeEventListener("abort", waiter.abortHandler);
      delete pendingRequestWaiters[requestId];
    };
    const rejectPendingRequestsForPeer = (id, error) => {
      entries2(pendingRequestWaiters).forEach(([requestId, waiter]) => {
        if (waiter.peerId !== id) return;
        clearPendingRequestWaiter(requestId);
        waiter.reject(error);
      });
    };
    const clearPeer = (id, error) => {
      wire.clearPeer(id);
      rejectPendingRequestsForPeer(id, makeActionError2("disconnected", toErrorMessage2(error, "peer disconnected")));
    };
    const responseAction = makeInternalAction("@_response");
    responseAction.onMessage((payload, id, metadata) => {
      const parsed = getResponseMetadata2(metadata);
      if (!parsed) return;
      const waiter = pendingRequestWaiters[parsed.r];
      if (!waiter || waiter.peerId !== id) return;
      clearPendingRequestWaiter(parsed.r);
      if (parsed.e !== void 0) {
        waiter.reject(makeActionError2("rejected", parsed.e));
        return;
      }
      waiter.resolve(payload);
    });
    const makeActionImpl = (type, config) => {
      if (config && "onRequest" in config && config.kind !== "request") throw mkErr2('request actions must use kind: "request"');
      const kind = (config == null ? void 0 : config.kind) ?? "message";
      const rawAction = makeInternalAction(type);
      const existingState = publicActions[type];
      if (existingState) {
        if (existingState.kind !== kind) throw mkErr2(`action type "${type}" cannot be redefined`);
        return existingState.action;
      }
      const state = {
        kind,
        action: null,
        pendingMessages: [],
        pendingRequests: [],
        onReceiveProgress: (config == null ? void 0 : config.onReceiveProgress) ?? null
      };
      const toProgressHandler = (handler, metadata) => handler ? (progress, peerId) => handler(progress, withMetadata2({ peerId }, metadata)) : void 0;
      const setReceiveProgress = (handler) => {
        state.onReceiveProgress = handler;
      };
      const dispatchReceiveProgress = (progress, peerId, metadata) => {
        var _a;
        const requestMetadata = state.kind === "request" ? getRequestMetadata2(metadata) : null;
        (_a = state.onReceiveProgress) == null ? void 0 : _a.call(state, progress, withMetadata2({ peerId }, requestMetadata ? requestMetadata.m : metadata));
      };
      rawAction.onProgress(dispatchReceiveProgress);
      if (kind === "message") {
        let onMessage = (config == null ? void 0 : config.onMessage) ?? null;
        const flushMessages = () => {
          if (!onMessage) return;
          const handler = onMessage;
          state.pendingMessages.splice(0).forEach(({ payload, peerId, metadata }) => {
            Promise.resolve().then(() => handler(payload, withMetadata2({ peerId }, metadata))).catch((err) => console.error(`${libName2} action handler error:`, err));
          });
        };
        const action2 = {
          send: async (data, options = {}) => {
            await rawAction.send(data, options.target, options.metadata, toProgressHandler(options.onProgress, options.metadata), options.signal);
          },
          get onMessage() {
            return onMessage;
          },
          set onMessage(handler) {
            onMessage = handler;
            flushMessages();
          },
          get onReceiveProgress() {
            return state.onReceiveProgress;
          },
          set onReceiveProgress(handler) {
            setReceiveProgress(handler);
          }
        };
        rawAction.onMessage((payload, peerId, metadata) => {
          if (!onMessage) {
            state.pendingMessages.push(metadata === void 0 ? {
              payload,
              peerId
            } : {
              payload,
              peerId,
              metadata
            });
            return;
          }
          const handler = onMessage;
          Promise.resolve().then(() => handler(payload, withMetadata2({ peerId }, metadata))).catch((err) => console.error(`${libName2} action handler error:`, err));
        });
        state.action = action2;
        publicActions[type] = state;
        flushMessages();
        return action2;
      }
      let onRequest = (config == null ? void 0 : config.onRequest) ?? null;
      const removePendingIncomingRequest = (request) => {
        resetTimer2(request.timer);
        const i = state.pendingRequests.indexOf(request);
        if (i > -1) state.pendingRequests.splice(i, 1);
      };
      const sendRequestError = (peerId, requestId, error) => {
        responseAction.send(null, peerId, {
          r: requestId,
          e: toErrorMessage2(error, "request failed")
        });
      };
      const respondToIncomingRequest = (request, handler) => {
        removePendingIncomingRequest(request);
        Promise.resolve().then(() => handler(request.payload, {
          peerId: request.peerId,
          ...request.metadata === void 0 ? {} : { metadata: request.metadata },
          signal: request.controller.signal
        })).then(async (response) => {
          if (response === void 0) throw mkErr2("request handler returned undefined");
          await responseAction.send(response, request.peerId, { r: request.requestId });
        }).catch((err) => sendRequestError(request.peerId, request.requestId, err)).finally(() => request.controller.abort());
      };
      const flushRequests = () => {
        if (!onRequest) return;
        state.pendingRequests.slice().forEach((request) => respondToIncomingRequest(request, onRequest));
      };
      const queueIncomingRequest = (payload, peerId, metadata, requestId) => {
        if (onRequest) {
          const request2 = {
            payload,
            peerId,
            ...metadata === void 0 ? {} : { metadata },
            requestId,
            controller: new AbortController(),
            timer: null
          };
          respondToIncomingRequest(request2, onRequest);
          return;
        }
        const request = {
          payload,
          peerId,
          ...metadata === void 0 ? {} : { metadata },
          requestId,
          controller: new AbortController(),
          timer: setTimeout(() => {
            removePendingIncomingRequest(request);
            request.controller.abort();
            sendRequestError(peerId, requestId, "request handler unavailable");
          }, requestHandlerBufferMs2)
        };
        state.pendingRequests.push(request);
      };
      const requestOne = async (data, options) => {
        const { target, metadata, onProgress, signal, timeoutMs } = options;
        throwIfAborted2(signal);
        if (!getPeer(target, false)) throw makeActionError2("disconnected", `no active peer with id ${target}`);
        const requestId = genId2(20);
        const handledResponsePromise = new Promise((resolve, reject) => {
          const waiter = {
            peerId: target,
            resolve,
            reject,
            timer: null,
            ...signal === void 0 ? {} : { signal }
          };
          const rejectAsAborted = () => {
            clearPendingRequestWaiter(requestId);
            reject(makeActionError2("aborted", "operation aborted"));
          };
          if (signal) {
            waiter.abortHandler = rejectAsAborted;
            signal.addEventListener("abort", rejectAsAborted, { once: true });
          }
          pendingRequestWaiters[requestId] = waiter;
        }).catch((err) => {
          throw err;
        });
        try {
          await rawAction.send(data, target, metadata === void 0 ? { r: requestId } : {
            r: requestId,
            m: metadata
          }, toProgressHandler(onProgress, metadata), signal);
          const waiter = pendingRequestWaiters[requestId];
          if (waiter && timeoutMs !== void 0) waiter.timer = setTimeout(() => {
            clearPendingRequestWaiter(requestId);
            waiter.reject(makeActionError2("timeout", "request timed out"));
          }, timeoutMs);
          return await handledResponsePromise;
        } catch (err) {
          clearPendingRequestWaiter(requestId);
          throw err;
        }
      };
      const action = {
        request: requestOne,
        requestMany: async (data, options) => {
          throwIfAborted2(options.signal);
          return await all2(options.targets.map(async (target) => {
            var _a, _b;
            try {
              const result = {
                peerId: target,
                status: "fulfilled",
                value: await requestOne(data, {
                  target,
                  ...options.metadata === void 0 ? {} : { metadata: options.metadata },
                  ...options.timeoutMs === void 0 ? {} : { timeoutMs: options.timeoutMs },
                  ...options.onProgress === void 0 ? {} : { onProgress: options.onProgress },
                  ...options.signal === void 0 ? {} : { signal: options.signal }
                })
              };
              (_a = options.onResult) == null ? void 0 : _a.call(options, result);
              return result;
            } catch (err) {
              const error = toError2(err, "request failed");
              if (error.kind === "aborted" || !error.kind) throw error;
              const result = error.kind === "timeout" ? {
                peerId: target,
                status: "timeout"
              } : error.kind === "disconnected" ? {
                peerId: target,
                status: "disconnected"
              } : {
                peerId: target,
                status: "rejected",
                error
              };
              (_b = options.onResult) == null ? void 0 : _b.call(options, result);
              return result;
            }
          }));
        },
        get onRequest() {
          return onRequest;
        },
        set onRequest(handler) {
          onRequest = handler;
          flushRequests();
        },
        get onReceiveProgress() {
          return state.onReceiveProgress;
        },
        set onReceiveProgress(handler) {
          setReceiveProgress(handler);
        }
      };
      rawAction.onMessage((payload, peerId, metadata) => {
        const requestMetadata = getRequestMetadata2(metadata);
        if (!requestMetadata) return;
        queueIncomingRequest(payload, peerId, requestMetadata.m, requestMetadata.r);
      });
      state.action = action;
      publicActions[type] = state;
      flushRequests();
      return action;
    };
    return {
      makeAction: makeActionImpl,
      makeInternalAction,
      handleData,
      clearPeer
    };
  };

  // ../../../../node_modules/@trystero-p2p/nostr/node_modules/@trystero-p2p/core/dist/media.mjs
  var toPendingMediaMeta2 = (value) => {
    if (value && typeof value === "object" && !Array.isArray(value) && typeof value.k === "string") return {
      key: value.k,
      ...typeof value.s === "string" ? { streamId: value.s } : {},
      ...typeof value.t === "string" ? { trackId: value.t } : {},
      ...Object.hasOwn(value, "m") ? { metadata: value.m } : {}
    };
    return null;
  };
  var makeKeyGetter2 = (map) => (item) => {
    let key = map.get(item);
    if (!key) {
      key = genId2(20);
      map.set(item, key);
    }
    return key;
  };
  var createMediaIdentityCache2 = () => {
    const localStreamKeys = /* @__PURE__ */ new WeakMap();
    const localTrackKeys = /* @__PURE__ */ new WeakMap();
    const remoteStreamsByKey = /* @__PURE__ */ new Map();
    const remoteStreamsById = /* @__PURE__ */ new Map();
    const remoteTracksByKey = /* @__PURE__ */ new Map();
    const remoteTracksById = /* @__PURE__ */ new Map();
    return {
      getStreamKey: makeKeyGetter2(localStreamKeys),
      getTrackKey: makeKeyGetter2(localTrackKeys),
      rememberRemoteStream: (key, stream, streamId) => {
        remoteStreamsByKey.set(key, stream);
        if (streamId) remoteStreamsById.set(streamId, stream);
      },
      getRemoteStream: (key, streamId) => remoteStreamsByKey.get(key) ?? (streamId ? remoteStreamsById.get(streamId) : void 0),
      rememberRemoteTrack: (key, track, stream, trackId, streamId) => {
        const ref = {
          track,
          stream
        };
        remoteTracksByKey.set(key, ref);
        if (trackId) remoteTracksById.set(trackId, ref);
        if (streamId) remoteStreamsById.set(streamId, stream);
      },
      getRemoteTrack: (key, trackId) => remoteTracksByKey.get(key) ?? (trackId ? remoteTracksById.get(trackId) : void 0),
      clearRemote: () => {
        remoteStreamsByKey.clear();
        remoteStreamsById.clear();
        remoteTracksByKey.clear();
        remoteTracksById.clear();
      }
    };
  };
  var createMediaManager2 = ({ iterate, isActive, getSharedMediaPeer }) => {
    const pendingStreamMetas = {};
    const pendingTrackMetas = {};
    const localMedia = createMediaIdentityCache2();
    const listeners = {
      onPeerStream: null,
      onPeerTrack: null
    };
    const emitStream = (id, key, stream, metadata) => {
      var _a, _b, _c;
      if (!isActive(id)) return;
      (_b = (_a = getSharedMediaPeer(id)) == null ? void 0 : _a.__trysteroMedia) == null ? void 0 : _b.rememberRemoteStream(key, stream, typeof stream.id === "string" ? stream.id : void 0);
      (_c = listeners.onPeerStream) == null ? void 0 : _c.call(listeners, stream, id, metadata);
    };
    const emitTrack = (id, key, track, stream, metadata) => {
      var _a, _b, _c;
      if (!isActive(id)) return;
      (_b = (_a = getSharedMediaPeer(id)) == null ? void 0 : _a.__trysteroMedia) == null ? void 0 : _b.rememberRemoteTrack(key, track, stream, typeof track.id === "string" ? track.id : void 0, typeof stream.id === "string" ? stream.id : void 0);
      (_c = listeners.onPeerTrack) == null ? void 0 : _c.call(listeners, track, stream, id, metadata);
    };
    const applyMediaOp = (targets, key, metadata, sendMeta, op, mediaIds = {}) => {
      const payload = {
        k: key,
        ...mediaIds,
        ...metadata === void 0 ? {} : { m: metadata }
      };
      return iterate(targets, async (id, peer) => {
        await sendMeta(payload, id);
        op(peer);
      });
    };
    return {
      addStream: (stream, options, sendMeta) => applyMediaOp(options.target, localMedia.getStreamKey(stream), options.metadata, sendMeta, (peer) => peer.addStream(stream), { s: stream.id }),
      removeStream: (stream, target) => {
        iterate(target, (_, peer) => peer.removeStream(stream));
      },
      addTrack: (track, stream, options, sendMeta) => applyMediaOp(options.target, localMedia.getTrackKey(track), options.metadata, sendMeta, (peer) => peer.addTrack(track, stream), {
        s: stream.id,
        t: track.id
      }),
      removeTrack: (track, target) => {
        iterate(target, (_, peer) => peer.removeTrack(track));
      },
      replaceTrack: (oldTrack, newTrack, options, sendMeta) => applyMediaOp(options.target, localMedia.getTrackKey(newTrack), options.metadata, sendMeta, (peer) => peer.replaceTrack(oldTrack, newTrack), { t: oldTrack.id }),
      receiveStreamMeta: (meta, id) => {
        var _a, _b;
        if (!isActive(id)) return;
        const parsed = toPendingMediaMeta2(meta);
        if (!parsed) return;
        const cached = (_b = (_a = getSharedMediaPeer(id)) == null ? void 0 : _a.__trysteroMedia) == null ? void 0 : _b.getRemoteStream(parsed.key, parsed.streamId);
        if (cached) {
          emitStream(id, parsed.key, cached, parsed.metadata);
          return;
        }
        (pendingStreamMetas[id] ?? (pendingStreamMetas[id] = [])).push(parsed);
      },
      receiveTrackMeta: (meta, id) => {
        var _a, _b;
        if (!isActive(id)) return;
        const parsed = toPendingMediaMeta2(meta);
        if (!parsed) return;
        const cached = (_b = (_a = getSharedMediaPeer(id)) == null ? void 0 : _a.__trysteroMedia) == null ? void 0 : _b.getRemoteTrack(parsed.key, parsed.trackId);
        if (cached) {
          emitTrack(id, parsed.key, cached.track, cached.stream, parsed.metadata);
          return;
        }
        (pendingTrackMetas[id] ?? (pendingTrackMetas[id] = [])).push(parsed);
      },
      receiveRemoteStream: (id, stream) => {
        var _a;
        if (!isActive(id)) return;
        const next = (_a = pendingStreamMetas[id]) == null ? void 0 : _a.shift();
        if (!next) return;
        emitStream(id, next.key, stream, next.metadata);
      },
      receiveRemoteTrack: (id, track, stream) => {
        var _a;
        if (!isActive(id)) return;
        const next = (_a = pendingTrackMetas[id]) == null ? void 0 : _a.shift();
        if (!next) return;
        emitTrack(id, next.key, track, stream, next.metadata);
      },
      clearPeer: (id) => {
        delete pendingStreamMetas[id];
        delete pendingTrackMetas[id];
      },
      get onPeerStream() {
        return listeners.onPeerStream;
      },
      set onPeerStream(handler) {
        listeners.onPeerStream = handler;
      },
      get onPeerTrack() {
        return listeners.onPeerTrack;
      },
      set onPeerTrack(handler) {
        listeners.onPeerTrack = handler;
      }
    };
  };

  // ../../../../node_modules/@trystero-p2p/nostr/node_modules/@trystero-p2p/core/dist/room.mjs
  var unloadEvent2 = "beforeunload";
  var defaultHandshakeTimeoutMs2 = 1e4;
  var internalNs2 = (ns) => "@_" + ns;
  var beforeUnloadRoomCleanups2 = /* @__PURE__ */ new Set();
  var cleanupActiveRoomsOnBeforeUnload2 = () => beforeUnloadRoomCleanups2.forEach((cleanup) => cleanup());
  var registerBeforeUnloadCleanup2 = (cleanup) => {
    beforeUnloadRoomCleanups2.add(cleanup);
    if (beforeUnloadRoomCleanups2.size === 1) addEventListener(unloadEvent2, cleanupActiveRoomsOnBeforeUnload2);
    return () => {
      beforeUnloadRoomCleanups2.delete(cleanup);
      if (!beforeUnloadRoomCleanups2.size) removeEventListener(unloadEvent2, cleanupActiveRoomsOnBeforeUnload2);
    };
  };
  var room_default2 = (onPeer, onPeerLeave, onSelfLeave, { onPeerHandshake, onHandshakeError, handshakeTimeoutMs = defaultHandshakeTimeoutMs2, isPassive = false } = {}) => {
    const peerMap = {};
    const activePeerMap = {};
    const pendingPongs = {};
    const listeners = {
      onPeerJoin: null,
      onPeerLeave: null
    };
    let unregisterBeforeUnloadCleanup = noOp2;
    let handshakeManager = null;
    const iterate = (targets, f, { includePending = false } = {}) => (targets ? Array.isArray(targets) ? targets : [targets] : keys2(includePending ? peerMap : activePeerMap)).flatMap((id) => {
      const peer = includePending ? peerMap[id] : activePeerMap[id];
      if (!peer) {
        console.warn(`${libName2}: no peer with id ${id} found`);
        return [];
      }
      return [Promise.resolve(f(id, peer))];
    });
    const mediaManager = createMediaManager2({
      iterate: (targets, f) => iterate(targets, (id, peer) => f(id, peer)),
      isActive: (id) => Boolean(activePeerMap[id]),
      getSharedMediaPeer: (id) => peerMap[id] ?? null
    });
    const actionManager = createActionManager2({
      getPeer: (id, includePending) => (includePending ? peerMap : activePeerMap)[id],
      getPeerIds: (includePending) => keys2(includePending ? peerMap : activePeerMap),
      canReceiveFromPeer: (id, receiveWhilePending) => Boolean(handshakeManager == null ? void 0 : handshakeManager.canReceiveFromPeer(id, receiveWhilePending))
    });
    const makeActionInternal = actionManager.makeInternalAction;
    const handleData = actionManager.handleData;
    const makeAction = actionManager.makeAction;
    const clearPeerState = (id, reason = mkErr2("peer disconnected")) => {
      var _a;
      const err = toError2(reason, "peer disconnected");
      handshakeManager == null ? void 0 : handshakeManager.clearPeer(id, err);
      delete peerMap[id];
      delete activePeerMap[id];
      actionManager.clearPeer(id, err);
      (_a = pendingPongs[id]) == null ? void 0 : _a.splice(0).forEach((waiter) => waiter.reject(err));
      delete pendingPongs[id];
      mediaManager.clearPeer(id);
    };
    const exitPeer = (id, peer, reason) => {
      var _a;
      const current = peerMap[id];
      if (!current) return;
      if (peer && current !== peer) return;
      const wasActive = Boolean(activePeerMap[id]);
      clearPeerState(id, reason);
      current.destroy();
      if (wasActive) (_a = listeners.onPeerLeave) == null ? void 0 : _a.call(listeners, id);
      onPeerLeave(id);
    };
    const leave = async () => {
      await leaveAction.send("");
      await new Promise((res) => setTimeout(res, 99));
      entries2(peerMap).forEach(([id, peer]) => {
        peer.destroy();
        clearPeerState(id, mkErr2("room left"));
      });
      unregisterBeforeUnloadCleanup();
      onSelfLeave();
    };
    const pingAction = makeActionInternal(internalNs2("ping"));
    const pongAction = makeActionInternal(internalNs2("pong"));
    const signalAction = makeActionInternal(internalNs2("signal"));
    const streamMetaAction = makeActionInternal(internalNs2("stream"));
    const trackMetaAction = makeActionInternal(internalNs2("track"));
    const leaveAction = makeActionInternal(internalNs2("leave"), {
      sendToPending: true,
      receiveWhilePending: true
    });
    const handshakeDataAction = makeActionInternal(internalNs2("hsdata"), {
      sendToPending: true,
      receiveWhilePending: true
    });
    const handshakeReadyAction = makeActionInternal(internalNs2("hsready"), {
      sendToPending: true,
      receiveWhilePending: true
    });
    handshakeManager = createHandshakeManager2({
      ...onPeerHandshake === void 0 ? {} : { onPeerHandshake },
      ...onHandshakeError === void 0 ? {} : { onHandshakeError },
      handshakeTimeoutMs,
      sendHandshakeData: handshakeDataAction.send,
      sendHandshakeReady: handshakeReadyAction.send,
      onActivate: (id, peer) => {
        var _a;
        activePeerMap[id] = peer;
        (_a = listeners.onPeerJoin) == null ? void 0 : _a.call(listeners, id);
      },
      onFailure: (id, peer, reason) => exitPeer(id, peer, reason)
    });
    pingAction.onMessage((_, id) => pongAction.send("", id));
    pongAction.onMessage((_, id) => {
      var _a;
      const queue = pendingPongs[id];
      (_a = queue == null ? void 0 : queue.shift()) == null ? void 0 : _a.resolve();
      if (queue && !queue.length) delete pendingPongs[id];
    });
    signalAction.onMessage((sdp, id) => {
      var _a;
      if (!activePeerMap[id]) return;
      (_a = peerMap[id]) == null ? void 0 : _a.signal(sdp);
    });
    streamMetaAction.onMessage((meta, id) => mediaManager.receiveStreamMeta(meta, id));
    trackMetaAction.onMessage((meta, id) => mediaManager.receiveTrackMeta(meta, id));
    leaveAction.onMessage((_, id) => exitPeer(id, void 0, mkErr2("peer left room")));
    handshakeDataAction.onMessage((data, id, metadata) => handshakeManager == null ? void 0 : handshakeManager.receiveHandshakeData(data, id, metadata));
    handshakeReadyAction.onMessage((_, id) => handshakeManager == null ? void 0 : handshakeManager.receiveHandshakeReady(id));
    onPeer((peer, id) => {
      const existingPeer = peerMap[id];
      if (existingPeer) {
        if (existingPeer === peer) return;
        existingPeer.destroy();
        clearPeerState(id, mkErr2("peer replaced"));
      }
      peerMap[id] = peer;
      handshakeManager == null ? void 0 : handshakeManager.addPeer(id, peer);
      peer.setHandlers({
        data: (d) => handleData(id, d),
        stream: (stream) => mediaManager.receiveRemoteStream(id, stream),
        track: (track, stream) => mediaManager.receiveRemoteTrack(id, track, stream),
        signal: (sdp) => {
          if (!activePeerMap[id]) return;
          signalAction.send(sdp, id);
        },
        close: () => exitPeer(id, peer, mkErr2("peer disconnected")),
        error: (err) => {
          console.error(`${libName2} peer error:`, err);
          exitPeer(id, peer, err);
        }
      });
      handshakeManager == null ? void 0 : handshakeManager.start(id, peer);
    });
    if (isBrowser2) unregisterBeforeUnloadCleanup = registerBeforeUnloadCleanup2(() => leave().catch(noOp2));
    return {
      makeAction,
      leave,
      ping: async (id) => {
        if (!activePeerMap[id]) throw mkErr2(`no active peer with id ${id}`);
        const start = Date.now();
        await new Promise((resolve, reject) => {
          const queue = pendingPongs[id] ?? (pendingPongs[id] = []);
          const clearFromQueue = () => {
            const currentQueue = pendingPongs[id];
            if (!currentQueue) return;
            const i = currentQueue.indexOf(waiter);
            if (i > -1) currentQueue.splice(i, 1);
            if (!currentQueue.length) delete pendingPongs[id];
          };
          const waiter = {
            resolve: () => {
              clearFromQueue();
              resolve();
            },
            reject: (reason) => {
              clearFromQueue();
              reject(reason);
            }
          };
          queue.push(waiter);
          pingAction.send("", id).catch((err) => waiter.reject(toError2(err, "peer disconnected")));
        });
        return Date.now() - start;
      },
      isPassive: () => isPassive,
      getPeers: () => fromEntries2(entries2(activePeerMap).map(([id, peer]) => [id, peer.connection])),
      addStream: (stream, options = {}) => mediaManager.addStream(stream, options, streamMetaAction.send),
      removeStream: (stream, options = {}) => {
        mediaManager.removeStream(stream, options.target);
      },
      addTrack: (track, stream, options = {}) => mediaManager.addTrack(track, stream, options, trackMetaAction.send),
      removeTrack: (track, options = {}) => {
        mediaManager.removeTrack(track, options.target);
      },
      replaceTrack: (oldTrack, newTrack, options = {}) => mediaManager.replaceTrack(oldTrack, newTrack, options, trackMetaAction.send),
      get onPeerJoin() {
        return listeners.onPeerJoin;
      },
      set onPeerJoin(handler) {
        listeners.onPeerJoin = handler;
        if (handler) keys2(activePeerMap).forEach((peerId) => handler(peerId));
      },
      get onPeerLeave() {
        return listeners.onPeerLeave;
      },
      set onPeerLeave(handler) {
        listeners.onPeerLeave = handler;
      },
      get onPeerStream() {
        return mediaManager.onPeerStream;
      },
      set onPeerStream(handler) {
        mediaManager.onPeerStream = handler;
      },
      get onPeerTrack() {
        return mediaManager.onPeerTrack;
      },
      set onPeerTrack(handler) {
        mediaManager.onPeerTrack = handler;
      }
    };
  };

  // ../../../../node_modules/@trystero-p2p/nostr/node_modules/@trystero-p2p/core/dist/shared-peer.mjs
  var roomFrameVersion2 = 1;
  var roomPresenceFrameVersion2 = 2;
  var wrapRoomFrame2 = (roomToken, data) => {
    const tokenBytes = encodeBytes2(roomToken);
    const frame = new Uint8Array(3 + tokenBytes.byteLength + data.byteLength);
    frame[0] = roomFrameVersion2;
    frame[1] = tokenBytes.byteLength >>> 8 & 255;
    frame[2] = tokenBytes.byteLength & 255;
    frame.set(tokenBytes, 3);
    frame.set(data, 3 + tokenBytes.byteLength);
    return frame;
  };
  var wrapRoomPresenceFrame2 = (roomToken, isPresent) => {
    const tokenBytes = encodeBytes2(roomToken);
    const frame = new Uint8Array(4 + tokenBytes.byteLength);
    frame[0] = roomPresenceFrameVersion2;
    frame[1] = Number(isPresent);
    frame[2] = tokenBytes.byteLength >>> 8 & 255;
    frame[3] = tokenBytes.byteLength & 255;
    frame.set(tokenBytes, 4);
    return frame;
  };
  var unwrapFrame2 = (data) => {
    const buffer = new Uint8Array(data);
    if (buffer.byteLength < 3) return null;
    if (buffer[0] === roomFrameVersion2) {
      const tokenSize2 = (buffer[1] ?? 0) << 8 | (buffer[2] ?? 0);
      const headerSize2 = 3 + tokenSize2;
      if (tokenSize2 <= 0 || buffer.byteLength < headerSize2) return null;
      return {
        type: "room",
        roomToken: decodeBytes2(buffer.subarray(3, headerSize2)),
        payload: buffer.subarray(headerSize2).slice().buffer
      };
    }
    if (buffer[0] !== roomPresenceFrameVersion2 || buffer.byteLength < 4) return null;
    const tokenSize = (buffer[2] ?? 0) << 8 | (buffer[3] ?? 0);
    const headerSize = 4 + tokenSize;
    if (tokenSize <= 0 || buffer.byteLength < headerSize) return null;
    return {
      type: "presence",
      roomToken: decodeBytes2(buffer.subarray(4, headerSize)),
      isPresent: buffer[1] === 1
    };
  };
  var isPeerUnderlyingStale2 = (peer) => {
    const { connection, channel } = peer;
    return peer.isDead || connection.connectionState === "closed" || connection.connectionState === "failed" || connection.iceConnectionState === "closed" || connection.iceConnectionState === "failed" || (channel == null ? void 0 : channel.readyState) === "closing" || (channel == null ? void 0 : channel.readyState) === "closed";
  };
  var getConnectedPeerHealth2 = (peer) => {
    if (isPeerUnderlyingStale2(peer)) return "stale";
    const { channel } = peer;
    if (!channel || channel.readyState !== "open") return "transient";
    return "live";
  };
  var SharedPeerManager2 = class {
    constructor() {
      __publicField(this, "byApp", {});
      __publicField(this, "roomPresenceHandlers", {});
    }
    getMap(appId) {
      var _a;
      return (_a = this.byApp)[appId] ?? (_a[appId] = {});
    }
    get(appId, peerId) {
      var _a;
      return (_a = this.byApp[appId]) == null ? void 0 : _a[peerId];
    }
    isPeerStale(peer) {
      return isPeerUnderlyingStale2(peer);
    }
    getHealth(peer) {
      return this.isPeerStale(peer) ? "stale" : "live";
    }
    setRoomPresenceHandler(appId, handler) {
      this.roomPresenceHandlers[appId] = handler;
      return () => {
        if (this.roomPresenceHandlers[appId] === handler) delete this.roomPresenceHandlers[appId];
      };
    }
    sendRoomPresence(shared, roomToken, isPresent) {
      if (shared.isClosing || shared.peer.isDead) return;
      shared.peer.sendData(wrapRoomPresenceFrame2(roomToken, isPresent));
    }
    clear(appId, peerId, { destroyPeer }) {
      const map = this.byApp[appId];
      const shared = map == null ? void 0 : map[peerId];
      if (!shared || shared.isClosing) return;
      shared.idleTimer = resetTimer2(shared.idleTimer);
      shared.isClosing = true;
      if (destroyPeer && !shared.peer.isDead) shared.peer.destroy();
      const bindings = values2(shared.bindings);
      shared.bindings = {};
      shared.bindingsByToken = {};
      shared.controlRoomId = null;
      delete map[peerId];
      bindings.forEach((binding) => {
        var _a, _b;
        (_b = (_a = binding.handlers).close) == null ? void 0 : _b.call(_a);
        binding.pendingData.length = 0;
        binding.pendingSendData.length = 0;
        binding.pendingTracks.length = 0;
      });
      shared.media.clearRemote();
      shared.pendingDataByToken.clear();
      shared.remoteRoomTokens.clear();
      if (keys2(map).length === 0) delete this.byApp[appId];
    }
    register(appId, peerId, peer, idleMs) {
      const map = this.getMap(appId);
      const existing = map[peerId];
      if (existing) {
        existing.idleTimer = resetTimer2(existing.idleTimer);
        if (existing.peer === peer) return existing;
        this.clear(appId, peerId, { destroyPeer: true });
      }
      const shared = {
        appId,
        peerId,
        peer,
        bindings: {},
        bindingsByToken: {},
        pendingDataByToken: /* @__PURE__ */ new Map(),
        remoteRoomTokens: /* @__PURE__ */ new Set(),
        idleTimer: null,
        controlRoomId: null,
        streamOwners: /* @__PURE__ */ new Map(),
        trackOwners: /* @__PURE__ */ new Map(),
        media: createMediaIdentityCache2(),
        idleMs,
        isClosing: false
      };
      peer.setHandlers({
        data: (data) => this.dispatchData(shared, data),
        signal: (signal) => this.dispatchSignal(shared, signal),
        close: () => this.clear(appId, peerId, { destroyPeer: false }),
        error: (err) => {
          console.error(`${libName2} peer error:`, err);
          this.clear(appId, peerId, { destroyPeer: false });
        },
        track: (track, stream) => this.dispatchTrack(shared, track, stream)
      });
      map[peerId] = shared;
      return shared;
    }
    bind(roomId, roomTokenPromise, shared, { onDetach }) {
      const existingBinding = shared.bindings[roomId];
      if (existingBinding) {
        shared.idleTimer = resetTimer2(shared.idleTimer);
        return {
          proxy: existingBinding.proxy,
          isNew: false
        };
      }
      const binding = {
        roomId,
        roomToken: null,
        roomTokenPromise,
        handlers: {},
        pendingData: [],
        pendingSendData: [],
        pendingTracks: [],
        detach: noOp2,
        proxy: {}
      };
      const detachBinding = () => {
        if (!shared.bindings[roomId]) return;
        this.pruneRoomOwnership(shared, roomId);
        delete shared.bindings[roomId];
        if (binding.roomToken && shared.bindingsByToken[binding.roomToken] === binding) delete shared.bindingsByToken[binding.roomToken];
        if (shared.controlRoomId === roomId) shared.controlRoomId = keys2(shared.bindings)[0] ?? null;
        onDetach();
        this.scheduleIdleTimer(shared);
      };
      const proxy = {
        created: shared.peer.created,
        get connection() {
          return shared.peer.connection;
        },
        get channel() {
          return shared.peer.channel;
        },
        get isDead() {
          return shared.peer.isDead;
        },
        getOffer: (restartIce) => shared.peer.getOffer(restartIce),
        signal: (sdp) => shared.peer.signal(sdp),
        sendData: (data) => {
          if (!binding.roomToken) {
            binding.pendingSendData.push(data);
            return;
          }
          shared.peer.sendData(wrapRoomFrame2(binding.roomToken, data));
        },
        destroy: () => detachBinding(),
        setHandlers: (newHandlers) => {
          const { signal, ...rest } = newHandlers;
          Object.assign(binding.handlers, rest);
          if (signal) binding.handlers.signal = signal;
          this.flushBindingQueues(binding);
        },
        offerPromise: shared.peer.offerPromise,
        addStream: (stream) => {
          const owners = shared.streamOwners.get(stream) ?? /* @__PURE__ */ new Set();
          const shouldAttach = owners.size === 0;
          owners.add(roomId);
          shared.streamOwners.set(stream, owners);
          if (shouldAttach) shared.peer.addStream(stream);
        },
        removeStream: (stream) => {
          const owners = shared.streamOwners.get(stream);
          if (!owners) return;
          owners.delete(roomId);
          if (owners.size === 0) {
            shared.streamOwners.delete(stream);
            shared.peer.removeStream(stream);
          }
        },
        addTrack: (track, stream) => {
          const entry = shared.trackOwners.get(track) ?? {
            stream,
            rooms: /* @__PURE__ */ new Set()
          };
          const shouldAttach = entry.rooms.size === 0;
          entry.stream = stream;
          entry.rooms.add(roomId);
          shared.trackOwners.set(track, entry);
          if (shouldAttach) return shared.peer.addTrack(track, stream);
          return shared.peer.connection.getSenders().find((s) => s.track === track) ?? shared.peer.addTrack(track, stream);
        },
        removeTrack: (track) => {
          const entry = shared.trackOwners.get(track);
          if (!entry) return;
          entry.rooms.delete(roomId);
          if (entry.rooms.size === 0) {
            shared.trackOwners.delete(track);
            shared.peer.removeTrack(track);
          }
        },
        replaceTrack: (oldTrack, newTrack) => {
          const oldEntry = shared.trackOwners.get(oldTrack);
          if (oldEntry) {
            shared.trackOwners.delete(oldTrack);
            const nextEntry = shared.trackOwners.get(newTrack) ?? {
              stream: oldEntry.stream,
              rooms: /* @__PURE__ */ new Set()
            };
            oldEntry.rooms.forEach((room) => nextEntry.rooms.add(room));
            shared.trackOwners.set(newTrack, nextEntry);
          }
          return shared.peer.replaceTrack(oldTrack, newTrack);
        },
        __trysteroMedia: shared.media
      };
      binding.proxy = proxy;
      binding.detach = detachBinding;
      shared.bindings[roomId] = binding;
      shared.controlRoomId ?? (shared.controlRoomId = roomId);
      shared.idleTimer = resetTimer2(shared.idleTimer);
      roomTokenPromise.then((roomToken) => {
        if (shared.isClosing || shared.bindings[roomId] !== binding) return;
        binding.roomToken = roomToken;
        shared.bindingsByToken[roomToken] = binding;
        const pendingData = shared.pendingDataByToken.get(roomToken);
        if (pendingData == null ? void 0 : pendingData.length) {
          binding.pendingData.push(...pendingData);
          shared.pendingDataByToken.delete(roomToken);
        }
        binding.pendingSendData.splice(0).forEach((payload) => shared.peer.sendData(wrapRoomFrame2(roomToken, payload)));
        this.flushBindingQueues(binding);
      });
      return {
        proxy,
        isNew: true
      };
    }
    pruneRoomOwnership(shared, roomIdToRemove) {
      shared.streamOwners.forEach((rooms, stream) => {
        rooms.delete(roomIdToRemove);
        if (rooms.size === 0) {
          shared.streamOwners.delete(stream);
          shared.peer.removeStream(stream);
        }
      });
      shared.trackOwners.forEach((entry, track) => {
        entry.rooms.delete(roomIdToRemove);
        if (entry.rooms.size === 0) {
          shared.trackOwners.delete(track);
          shared.peer.removeTrack(track);
        }
      });
    }
    scheduleIdleTimer(shared) {
      if (shared.isClosing || keys2(shared.bindings).length > 0) return;
      shared.idleTimer = resetTimer2(shared.idleTimer);
      shared.idleTimer = setTimeout(() => {
        var _a;
        const current = (_a = this.byApp[shared.appId]) == null ? void 0 : _a[shared.peerId];
        if (!current || keys2(current.bindings).length > 0) return;
        this.clear(shared.appId, shared.peerId, { destroyPeer: true });
      }, shared.idleMs);
    }
    getSignalBinding(shared) {
      if (shared.controlRoomId) {
        const selected = shared.bindings[shared.controlRoomId];
        if (selected == null ? void 0 : selected.handlers.signal) return selected;
      }
      const fallback = values2(shared.bindings).find((binding) => Boolean(binding.handlers.signal));
      if (!fallback) return null;
      shared.controlRoomId = fallback.roomId;
      return fallback;
    }
    flushBindingQueues(binding) {
      const { handlers } = binding;
      if (handlers.data && binding.pendingData.length > 0) binding.pendingData.splice(0).forEach((payload) => {
        var _a;
        return (_a = handlers.data) == null ? void 0 : _a.call(handlers, payload);
      });
      if ((handlers.track || handlers.stream) && binding.pendingTracks.length) binding.pendingTracks.splice(0).forEach(({ track, stream }) => {
        var _a, _b;
        (_a = handlers.track) == null ? void 0 : _a.call(handlers, track, stream);
        (_b = handlers.stream) == null ? void 0 : _b.call(handlers, stream);
      });
    }
    dispatchData(shared, data) {
      var _a, _b;
      const decoded = unwrapFrame2(data);
      if (!decoded) return;
      if (decoded.type === "presence") {
        if (decoded.isPresent) shared.remoteRoomTokens.add(decoded.roomToken);
        else shared.remoteRoomTokens.delete(decoded.roomToken);
        (_b = (_a = this.roomPresenceHandlers)[shared.appId]) == null ? void 0 : _b.call(_a, shared.peerId, decoded.roomToken, decoded.isPresent);
        return;
      }
      const binding = shared.bindingsByToken[decoded.roomToken];
      if (!binding) {
        const pending = shared.pendingDataByToken.get(decoded.roomToken) ?? [];
        pending.push(decoded.payload);
        shared.pendingDataByToken.set(decoded.roomToken, pending);
        return;
      }
      if (binding.handlers.data) binding.handlers.data(decoded.payload);
      else binding.pendingData.push(decoded.payload);
    }
    dispatchSignal(shared, signal) {
      var _a, _b, _c;
      (_c = (_a = this.getSignalBinding(shared)) == null ? void 0 : (_b = _a.handlers).signal) == null ? void 0 : _c.call(_b, signal);
    }
    dispatchTrack(shared, track, stream) {
      values2(shared.bindings).forEach((binding) => {
        var _a, _b, _c, _d;
        if (binding.handlers.track || binding.handlers.stream) {
          (_b = (_a = binding.handlers).track) == null ? void 0 : _b.call(_a, track, stream);
          (_d = (_c = binding.handlers).stream) == null ? void 0 : _d.call(_c, stream);
          return;
        }
        binding.pendingTracks.push({
          track,
          stream
        });
      });
    }
  };

  // ../../../../node_modules/@trystero-p2p/nostr/node_modules/@trystero-p2p/core/dist/signal-handler.mjs
  var offerPostAnswerTtlMs2 = 23333;
  var offerIdSize2 = 12;
  var disconnectedPeerGraceMs2 = 7533;
  var answeringTtlMs2 = 23333;
  var legacyCandidateKey2 = "__legacy__";
  var offerRelayPlaceholder2 = "offer-placeholder";
  var signalKeys2 = [
    "offer",
    "answer",
    "candidate"
  ];
  var toPayload2 = (msg) => {
    if (typeof msg === "string") try {
      const parsed = fromJson2(msg);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
    return msg && typeof msg === "object" ? msg : null;
  };
  var getString2 = (payload, key) => typeof payload[key] === "string" && payload[key] ? payload[key] : void 0;
  var hasInvalidSignalField2 = (payload) => signalKeys2.some((key) => key in payload && (typeof payload[key] !== "string" || payload[key] === ""));
  var publishCipheredSignalingMessage2 = (ctx, signal, peerTopic, signalPeer, buildPayload, stillValid) => {
    ctx.toCipher(signal).then((encryptedSignal) => {
      if (ctx.isLeaving() || !stillValid()) return;
      signalPeer(peerTopic, toJson2(buildPayload(encryptedSignal.sdp)));
    });
  };
  var makeState2 = () => ({
    status: "idle",
    offerPeer: null,
    offerId: null,
    offerSdp: null,
    offerInitPromise: null,
    offerAnswered: false,
    offerRelays: [],
    offerSignalRelays: [],
    offerSignalBacklog: [],
    offerRelayTimers: [],
    offerExpiryTimer: null,
    connectedPeer: null,
    connectedPeerUnhealthySinceMs: null,
    answeringExpiryTimer: null,
    answeringPeer: null,
    answerSent: false,
    connectionErrorReported: false,
    pendingCandidates: {}
  });
  var hasTurnServer2 = (config) => {
    var _a;
    return [...config.turnConfig ?? [], ...((_a = config.rtcConfig) == null ? void 0 : _a.iceServers) ?? []].some(({ urls }) => {
      return (Array.isArray(urls) ? urls : [urls]).some((url) => /^turns?:/i.test(url));
    });
  };
  var getSdpExchangeConnectionError2 = (peerId, config) => `could not connect to peer ${peerId} after exchanging SDP; ${hasTurnServer2(config) ? "check that your TURN server URLs and credentials are reachable by both peers" : "configure TURN servers with turnConfig or rtcConfig.iceServers"}`;
  var reportSdpExchangeConnectionFailure2 = (ctx, state, peerId) => {
    var _a;
    if (ctx.isLeaving() || state.connectedPeer || state.connectionErrorReported) return;
    state.connectionErrorReported = true;
    (_a = ctx.onJoinError) == null ? void 0 : _a.call(ctx, {
      error: getSdpExchangeConnectionError2(peerId, ctx.config),
      appId: ctx.appId,
      peerId,
      roomId: ctx.roomId
    });
  };
  var getState2 = (peerStates, peerId) => peerStates[peerId] ?? (peerStates[peerId] = makeState2());
  var updateStatus2 = (state) => {
    if (state.connectedPeer) state.status = "connected";
    else if (state.answeringPeer) state.status = "answering";
    else if (state.offerPeer || state.offerRelays.some(Boolean)) state.status = "offering";
    else state.status = "idle";
  };
  var clearAnswering2 = (state, peer) => {
    if (state.answeringPeer === peer) {
      state.answeringExpiryTimer = resetTimer2(state.answeringExpiryTimer);
      state.answeringPeer = null;
      state.answerSent = false;
      updateStatus2(state);
    }
  };
  var clearConnectedPeer2 = (state, peerId, _reason) => {
    if (!state.connectedPeer) return;
    if (!state.connectedPeer.isDead) state.connectedPeer.destroy();
    state.connectedPeer = null;
    state.connectedPeerUnhealthySinceMs = null;
    updateStatus2(state);
  };
  var clearOfferRelay2 = (state, relayId) => {
    state.offerRelayTimers[relayId] = resetTimer2(state.offerRelayTimers[relayId]);
    if (state.offerRelays[relayId]) {
      state.offerRelays[relayId] = void 0;
      updateStatus2(state);
    }
  };
  var clearOfferRelayIfPlaceholder2 = (state, relayId) => {
    if ((state == null ? void 0 : state.offerRelays[relayId]) === offerRelayPlaceholder2) clearOfferRelay2(state, relayId);
  };
  var hasRemoteDescription2 = (peer) => {
    if (peer.isDead || peer.connection.connectionState === "closed") return true;
    try {
      return Boolean(peer.connection.remoteDescription);
    } catch {
      return true;
    }
  };
  var resetOfferState2 = (state, offerPool) => {
    const previousOfferAnswered = state.offerAnswered;
    state.offerExpiryTimer = resetTimer2(state.offerExpiryTimer);
    state.offerInitPromise = null;
    state.offerRelays.forEach((_, relayId) => clearOfferRelay2(state, relayId));
    state.offerRelays = [];
    state.offerSignalRelays = [];
    state.offerRelayTimers = [];
    state.offerSignalBacklog = [];
    if (state.offerPeer && state.offerPeer !== state.connectedPeer) if (previousOfferAnswered || hasRemoteDescription2(state.offerPeer)) {
      if (!state.offerPeer.isDead) state.offerPeer.destroy();
    } else offerPool.recycle(state.offerPeer);
    state.offerPeer = null;
    state.offerId = null;
    state.offerSdp = null;
    state.offerAnswered = false;
    state.connectionErrorReported = false;
    updateStatus2(state);
  };
  var scheduleAnsweringExpiry2 = (ctx, state, peerId, peer) => {
    resetTimer2(state.answeringExpiryTimer);
    state.answeringExpiryTimer = setTimeout(() => {
      const current = ctx.peerStates[peerId];
      if (!current || current.connectedPeer || current.answeringPeer !== peer) return;
      if (current.answerSent) reportSdpExchangeConnectionFailure2(ctx, current, peerId);
      peer.destroy();
      clearAnswering2(current, peer);
      ctx.checkDeactivate();
    }, answeringTtlMs2);
  };
  var flushBufferedCandidates2 = async (state, peer, offerId) => {
    const bufferKeys = offerId ? [offerId, legacyCandidateKey2] : [legacyCandidateKey2];
    for (const key of bufferKeys) {
      const buffered = state.pendingCandidates[key];
      if (!(buffered == null ? void 0 : buffered.length)) continue;
      delete state.pendingCandidates[key];
      for (const candidate of buffered) await peer.signal(candidate);
    }
  };
  var scheduleOfferExpiry2 = (ctx, state, peerId, ttlMs = offerTtl2) => {
    resetTimer2(state.offerExpiryTimer);
    const offerId = state.offerId;
    state.offerExpiryTimer = setTimeout(() => {
      const current = ctx.peerStates[peerId];
      if (!current || current.connectedPeer || current.offerId !== offerId) return;
      if (current.offerAnswered) reportSdpExchangeConnectionFailure2(ctx, current, peerId);
      resetOfferState2(current, ctx.offerPool);
      ctx.checkDeactivate();
    }, ttlMs);
  };
  var ensureOffer2 = (ctx, state, peerId, relayId) => {
    if (state.offerPeer && state.offerId && state.offerSdp) return Promise.resolve({
      peer: state.offerPeer,
      offer: state.offerSdp,
      offerId: state.offerId
    });
    if (state.offerInitPromise) return state.offerInitPromise;
    state.offerInitPromise = (async () => {
      const firstOffer = (await ctx.offerPool.checkout(1, false, ctx.encryptOffer))[0];
      if (!firstOffer) throw mkErr2("failed to allocate offer peer");
      const { peer, offer } = firstOffer;
      state.offerPeer = peer;
      state.offerId = genId2(offerIdSize2);
      state.offerSdp = offer;
      state.offerAnswered = false;
      state.connectionErrorReported = false;
      state.offerSignalBacklog = [];
      updateStatus2(state);
      const onOfferPeerClosedOrError = () => {
        if (state.offerPeer === peer && !state.connectedPeer) {
          if (state.offerAnswered) reportSdpExchangeConnectionFailure2(ctx, state, peerId);
          resetOfferState2(state, ctx.offerPool);
        }
        ctx.disconnectPeer(peer, peerId);
        ctx.checkDeactivate();
      };
      peer.setHandlers({
        connect: () => ctx.connectPeer(peer, peerId, relayId),
        signal: (signal) => {
          if (state.offerPeer !== peer) return;
          state.offerSignalBacklog.push(signal);
          state.offerSignalRelays.forEach((sendSignal) => sendSignal == null ? void 0 : sendSignal(signal));
        },
        close: onOfferPeerClosedOrError,
        error: onOfferPeerClosedOrError
      });
      scheduleOfferExpiry2(ctx, state, peerId);
      return {
        peer,
        offer,
        offerId: state.offerId
      };
    })().finally(() => state.offerInitPromise = null);
    return state.offerInitPromise;
  };
  var handleAnnouncement2 = async (ctx, relayId, peerId, shared, signalPeer) => {
    if (shared) {
      ctx.attachSharedPeerToRoom(peerId, shared);
      return;
    }
    const state = ctx.peerStates[peerId];
    if (!state || state.connectedPeer || state.answeringPeer || state.offerAnswered) {
      clearOfferRelayIfPlaceholder2(state, relayId);
      return;
    }
    if (state.offerRelays[relayId] !== offerRelayPlaceholder2) return;
    const [peerTopic, offerInfo] = await all2([sha12(topicPath2(ctx.rootTopicPlaintext, peerId)), ensureOffer2(ctx, state, peerId, relayId)]);
    if (ctx.isLeaving()) return;
    if (state.connectedPeer || state.answeringPeer || state.offerAnswered || state.offerRelays[relayId] !== offerRelayPlaceholder2) {
      clearOfferRelayIfPlaceholder2(state, relayId);
      return;
    }
    state.offerRelayTimers[relayId] = resetTimer2(state.offerRelayTimers[relayId]);
    state.offerRelays[relayId] = true;
    updateStatus2(state);
    state.offerRelayTimers[relayId] = setTimeout(() => prunePendingOffer2(ctx, peerId, relayId), (ctx.announceIntervals[relayId] ?? ctx.announceIntervalMs) * 0.9);
    let didSendOffer = false;
    state.offerSignalRelays[relayId] = (signal) => {
      if (!didSendOffer) return;
      if (ctx.isLeaving() || state.connectedPeer || state.offerPeer !== offerInfo.peer || state.offerId !== offerInfo.offerId || signal.type !== "candidate") return;
      publishCipheredSignalingMessage2(ctx, signal, peerTopic, signalPeer, (sdp) => ({
        peerId: selfId2,
        offerId: offerInfo.offerId,
        candidate: sdp,
        ...ctx.isPassive ? { passive: true } : {}
      }), () => !state.connectedPeer && state.offerPeer === offerInfo.peer && state.offerId === offerInfo.offerId);
    };
    signalPeer(peerTopic, toJson2({
      peerId: selfId2,
      offerId: offerInfo.offerId,
      offer: offerInfo.offer,
      ...ctx.isPassive ? { passive: true } : {}
    }));
    didSendOffer = true;
    state.offerSignalBacklog.forEach((signal) => {
      var _a, _b;
      return (_b = (_a = state.offerSignalRelays)[relayId]) == null ? void 0 : _b.call(_a, signal);
    });
  };
  var handleOffer2 = async (ctx, relayId, peerId, offer, offerId, hasOutgoingOfferHint, signalPeer) => {
    var _a;
    const state = getState2(ctx.peerStates, peerId);
    if (state.answeringPeer || state.offerAnswered) return;
    const hasTrackedOutgoingOffer = Boolean(state.offerPeer || state.offerRelays.some(Boolean));
    if ((hasTrackedOutgoingOffer || hasOutgoingOfferHint) && selfId2 < peerId) return;
    if (hasTrackedOutgoingOffer) resetOfferState2(state, ctx.offerPool);
    const answerPeer = ctx.initPeer(false, ctx.config);
    state.answeringPeer = answerPeer;
    state.answerSent = false;
    state.connectionErrorReported = false;
    scheduleAnsweringExpiry2(ctx, state, peerId, answerPeer);
    updateStatus2(state);
    const onAnswerPeerClosedOrError = () => {
      if (state.answeringPeer === answerPeer && !state.connectedPeer && state.answerSent) reportSdpExchangeConnectionFailure2(ctx, state, peerId);
      clearAnswering2(state, answerPeer);
      ctx.disconnectPeer(answerPeer, peerId);
      ctx.checkDeactivate();
    };
    answerPeer.setHandlers({
      connect: () => ctx.connectPeer(answerPeer, peerId, relayId),
      close: onAnswerPeerClosedOrError,
      error: onAnswerPeerClosedOrError
    });
    let plainOffer;
    try {
      plainOffer = await ctx.toPlain({
        type: "offer",
        sdp: offer
      });
    } catch {
      clearAnswering2(state, answerPeer);
      (_a = ctx.onJoinError) == null ? void 0 : _a.call(ctx, {
        error: "incorrect room password when decrypting offer",
        appId: ctx.appId,
        peerId,
        roomId: ctx.roomId
      });
      return;
    }
    if (answerPeer.isDead) {
      clearAnswering2(state, answerPeer);
      return;
    }
    const peerTopic = await sha12(topicPath2(ctx.rootTopicPlaintext, peerId));
    if (ctx.isLeaving()) return;
    answerPeer.setHandlers({ signal: (signal) => {
      if (ctx.isLeaving() || state.answeringPeer !== answerPeer || answerPeer.isDead) return;
      if (signal.type !== "answer" && signal.type !== "candidate") return;
      publishCipheredSignalingMessage2(ctx, signal, peerTopic, signalPeer, (sdp) => {
        const payloadToSend = { peerId: selfId2 };
        if (signal.type === "answer") {
          state.answerSent = true;
          payloadToSend["answer"] = sdp;
        } else payloadToSend["candidate"] = sdp;
        if (offerId) payloadToSend["offerId"] = offerId;
        if (ctx.isPassive) payloadToSend["passive"] = true;
        return payloadToSend;
      }, () => state.answeringPeer === answerPeer && !answerPeer.isDead);
    } });
    await answerPeer.signal(plainOffer);
    await flushBufferedCandidates2(state, answerPeer, offerId);
  };
  var handleCandidate2 = async (ctx, peerId, candidate, offerId, peer) => {
    var _a;
    let plainCandidate;
    try {
      plainCandidate = await ctx.toPlain({
        type: candidateType2,
        sdp: candidate
      });
    } catch {
      return;
    }
    const state = getState2(ctx.peerStates, peerId);
    const offerPeerMatch = offerId && (state == null ? void 0 : state.offerPeer) && state.offerId === offerId ? state.offerPeer : null;
    const answeringPeer = (state == null ? void 0 : state.answeringPeer) ?? null;
    const fallbackOfferPeer = !offerId && (state == null ? void 0 : state.offerPeer) ? state.offerPeer : null;
    const targetPeer = peer && !peer.isDead ? peer : offerPeerMatch ?? answeringPeer ?? fallbackOfferPeer;
    if (!targetPeer || targetPeer.isDead) {
      const pendingKey = offerId ?? legacyCandidateKey2;
      ((_a = state.pendingCandidates)[pendingKey] ?? (_a[pendingKey] = [])).push(plainCandidate);
      return;
    }
    targetPeer.signal(plainCandidate);
  };
  var handleAnswer2 = async (ctx, relayId, peerId, answer, offerId, peer) => {
    var _a;
    let plainAnswer;
    try {
      plainAnswer = await ctx.toPlain({
        type: "answer",
        sdp: answer
      });
    } catch {
      (_a = ctx.onJoinError) == null ? void 0 : _a.call(ctx, {
        error: "incorrect room password when decrypting answer",
        appId: ctx.appId,
        peerId,
        roomId: ctx.roomId
      });
      return;
    }
    if (peer) {
      ctx.offerPool.claimLeased(peer);
      peer.setHandlers({
        connect: () => ctx.connectPeer(peer, peerId, relayId),
        close: () => ctx.disconnectPeer(peer, peerId)
      });
      peer.signal(plainAnswer);
    } else {
      const state = ctx.peerStates[peerId];
      if (!state || !state.offerPeer || state.offerAnswered || offerId && state.offerId && offerId !== state.offerId || state.offerPeer.isDead) return;
      state.offerAnswered = true;
      scheduleOfferExpiry2(ctx, state, peerId, offerPostAnswerTtlMs2);
      state.offerPeer.signal(plainAnswer);
    }
  };
  var prunePendingOffer2 = (ctx, peerId, relayId) => {
    const state = ctx.peerStates[peerId];
    if (!state || state.connectedPeer) return;
    if (state.offerRelays[relayId]) {
      clearOfferRelay2(state, relayId);
      ctx.checkDeactivate();
    }
  };
  var createSignalHandler2 = (ctx) => (relayId) => async (topic, msg, signalPeer) => {
    var _a;
    if (ctx.isLeaving()) return;
    const payload = toPayload2(msg);
    if (!payload || hasInvalidSignalField2(payload)) return;
    const peerId = getString2(payload, "peerId") ?? "";
    const offer = getString2(payload, "offer");
    const answer = getString2(payload, "answer");
    const candidate = getString2(payload, "candidate");
    const offerId = getString2(payload, "offerId");
    const peer = payload["peer"];
    const hasOutgoingOfferHint = payload["hasOutgoingOffer"] === true;
    const remoteIsPassive = payload["passive"] === true;
    if (!peerId || peerId === selfId2) return;
    const [rootTopic, selfTopic] = await all2([ctx.rootTopicP, ctx.selfTopicP]);
    if (ctx.isLeaving()) return;
    if (topic !== rootTopic && topic !== selfTopic) return;
    if (ctx.isPassive && remoteIsPassive) return;
    if (ctx.isPassive && !ctx.isActive && !answer && !candidate) {
      ctx.isActive = true;
      (_a = ctx.requeueAnnounce) == null ? void 0 : _a.call(ctx);
    }
    if (ctx.isPassive && !ctx.isActive) return;
    const state = ctx.peerStates[peerId];
    const connectedPeer = state == null ? void 0 : state.connectedPeer;
    if (connectedPeer && state) {
      const health = getConnectedPeerHealth2(connectedPeer);
      if (health === "live") {
        state.connectedPeerUnhealthySinceMs = null;
        return;
      }
      if (health === "stale") clearConnectedPeer2(state, peerId, "message-from-stale-peer");
      else {
        const nowMs = Date.now();
        const unhealthySinceMs = state.connectedPeerUnhealthySinceMs ?? nowMs;
        state.connectedPeerUnhealthySinceMs = unhealthySinceMs;
        if (nowMs - unhealthySinceMs < disconnectedPeerGraceMs2) return;
        clearConnectedPeer2(state, peerId, "message-from-prolonged-disconnect");
      }
    }
    let shared = ctx.sharedPeers.get(ctx.appId, peerId);
    if (shared && ctx.sharedPeers.getHealth(shared.peer) === "stale") {
      ctx.sharedPeers.clear(ctx.appId, peerId, { destroyPeer: true });
      shared = void 0;
    }
    const isAnnouncement = Boolean(peerId && !offer && !answer && !candidate);
    if (isAnnouncement && !shared) {
      const announcePeerState = getState2(ctx.peerStates, peerId);
      const shouldLeadOffer = selfId2 < peerId;
      if (announcePeerState.answeringPeer || announcePeerState.connectedPeer || announcePeerState.offerAnswered) return;
      if (!shouldLeadOffer && !announcePeerState.offerPeer) {
        const peerSelfTopic = await sha12(topicPath2(ctx.rootTopicPlaintext, peerId));
        if (!ctx.isLeaving() && !announcePeerState.connectedPeer) signalPeer(peerSelfTopic, toJson2({ peerId: selfId2 }));
        return;
      }
      if (announcePeerState.offerRelays[relayId]) return;
      announcePeerState.offerRelays[relayId] = offerRelayPlaceholder2;
      updateStatus2(announcePeerState);
    }
    if (shared && (offer || answer || candidate)) {
      if (shared.bindings[ctx.roomId]) return;
      ctx.attachSharedPeerToRoom(peerId, shared);
      return;
    }
    if (isAnnouncement) return handleAnnouncement2(ctx, relayId, peerId, shared, signalPeer);
    if (offer) return handleOffer2(ctx, relayId, peerId, offer, offerId, hasOutgoingOfferHint, signalPeer);
    if (candidate) return handleCandidate2(ctx, peerId, candidate, offerId, peer);
    if (answer) return handleAnswer2(ctx, relayId, peerId, answer, offerId, peer);
  };

  // ../../../../node_modules/@trystero-p2p/nostr/node_modules/@trystero-p2p/core/dist/strategy.mjs
  var announceIntervalMs2 = 5333;
  var announceWarmupIntervalsMs2 = [
    233,
    533,
    1333
  ];
  var passiveActivationGraceMs2 = 7533;
  var sharedPeerIdleMsDefault2 = 123333;
  var strategy_default2 = ({ init, subscribe, announce, deactivate }) => {
    const occupiedRooms = {};
    const roomRegistrations = {};
    const roomIdsByToken = {};
    const roomPresenceHandlerCleanups = {};
    const sharedPeers = new SharedPeerManager2();
    const hasActiveRooms = () => values2(occupiedRooms).some((rooms) => keys2(rooms).length > 0);
    const getRoomRegistrations = (appId) => roomRegistrations[appId] ?? (roomRegistrations[appId] = {});
    const getRoomIdsByToken = (appId) => roomIdsByToken[appId] ?? (roomIdsByToken[appId] = {});
    const advertiseRoomPresence = (shared, roomToken, isPresent) => {
      if (sharedPeers.getHealth(shared.peer) === "live") sharedPeers.sendRoomPresence(shared, roomToken, isPresent);
    };
    const advertiseKnownRoomsToShared = (appId, shared) => {
      entries2(roomRegistrations[appId] ?? {}).forEach(([roomId, registration]) => {
        if (!registration.shouldAdvertise()) return;
        const { roomToken, roomTokenPromise } = registration;
        if (roomToken) {
          advertiseRoomPresence(shared, roomToken, true);
          return;
        }
        roomTokenPromise.then((token) => {
          var _a;
          if (((_a = roomRegistrations[appId]) == null ? void 0 : _a[roomId]) !== registration) return;
          if (registration.roomToken !== token) return;
          if (sharedPeers.get(appId, shared.peerId) !== shared || shared.isClosing) return;
          if (!registration.shouldAdvertise()) return;
          advertiseRoomPresence(shared, token, true);
        });
      });
    };
    const advertiseRoomPresenceToAll = (appId, roomToken, isPresent) => values2(sharedPeers.getMap(appId)).forEach((shared) => advertiseRoomPresence(shared, roomToken, isPresent));
    const ensureRoomPresenceHandler = (appId) => {
      if (roomPresenceHandlerCleanups[appId]) return;
      roomPresenceHandlerCleanups[appId] = sharedPeers.setRoomPresenceHandler(appId, (peerId, roomToken, isPresent) => {
        var _a, _b, _c;
        if (!isPresent) return;
        const shared = sharedPeers.get(appId, peerId);
        const roomId = (_a = roomIdsByToken[appId]) == null ? void 0 : _a[roomToken];
        if (!shared || !roomId) return;
        (_c = (_b = roomRegistrations[appId]) == null ? void 0 : _b[roomId]) == null ? void 0 : _c.attachSharedPeerToRoom(peerId, shared);
      });
    };
    const cleanupRoomPresenceHandler = (appId) => {
      var _a;
      if (occupiedRooms[appId] && keys2(occupiedRooms[appId]).length > 0) return;
      (_a = roomPresenceHandlerCleanups[appId]) == null ? void 0 : _a.call(roomPresenceHandlerCleanups);
      delete roomPresenceHandlerCleanups[appId];
      delete roomRegistrations[appId];
      delete roomIdsByToken[appId];
    };
    let didInit = false;
    let initPromises = [];
    let offerPool = null;
    let cleanupWatchOnline = noOp2;
    return (config, roomId, callbacks) => {
      var _a, _b;
      if (!config) throw mkErr2("requires a config map as the first argument");
      if (callbacks && typeof callbacks !== "object") throw mkErr2("third argument must be a callbacks object");
      const { appId } = config;
      const onJoinError = callbacks == null ? void 0 : callbacks.onJoinError;
      const onPeerHandshake = callbacks == null ? void 0 : callbacks.onPeerHandshake;
      const handshakeTimeoutMs = callbacks == null ? void 0 : callbacks.handshakeTimeoutMs;
      if (!appId) throw mkErr2("config map is missing appId field");
      if (!roomId) throw mkErr2("roomId argument required");
      if (handshakeTimeoutMs !== void 0 && (!Number.isFinite(handshakeTimeoutMs) || handshakeTimeoutMs <= 0)) throw mkErr2("handshakeTimeoutMs must be a positive number");
      if ((_a = occupiedRooms[appId]) == null ? void 0 : _a[roomId]) return occupiedRooms[appId][roomId];
      ensureRoomPresenceHandler(appId);
      const rootTopicPlaintext = topicPath2(libName2, appId, roomId);
      const rootTopicP = sha12(rootTopicPlaintext);
      const selfTopicP = sha12(topicPath2(rootTopicPlaintext, selfId2));
      const key = genKey2(config.password ?? "", appId, roomId);
      const roomNamespacePromise = deriveRoomNamespace2(appId, roomId);
      const sharedPeerIdleMs = config._test_only_sharedPeerIdleMs ?? sharedPeerIdleMsDefault2;
      let didLeaveRoom = false;
      const withKey = (f) => async (signal) => ({
        type: signal.type,
        sdp: await f(key, signal.sdp)
      });
      const toPlain = withKey(decrypt2);
      const toCipher = withKey(encrypt2);
      const sharedPeerMap = sharedPeers.getMap(appId);
      const makeOffer = () => peer_default2(true, config);
      let reannounceOnDisconnect = false;
      offerPool || (offerPool = new OfferPool2(makeOffer));
      const pool = offerPool;
      const encryptOffer = async (peer) => {
        const plainOffer = await peer.getOffer(Date.now() - peer.created > offerTtl2);
        if (!plainOffer || plainOffer.type !== "offer") throw mkErr2("failed to get offer for peer");
        return (await toCipher(plainOffer)).sdp;
      };
      const attachSharedPeerToRoom = (peerId, shared) => {
        const state = getState2(ctx.peerStates, peerId);
        state.answeringExpiryTimer = resetTimer2(state.answeringExpiryTimer);
        state.answeringPeer = null;
        const { proxy, isNew } = sharedPeers.bind(roomId, roomNamespacePromise, shared, { onDetach: () => {
          const current = ctx.peerStates[peerId];
          if ((current == null ? void 0 : current.connectedPeer) === shared.peer) {
            current.connectedPeer = null;
            current.connectedPeerUnhealthySinceMs = null;
            updateStatus2(current);
          }
        } });
        state.connectedPeer = shared.peer;
        state.connectedPeerUnhealthySinceMs = null;
        updateStatus2(state);
        if (isNew) onPeerConnect(proxy, peerId);
        resetOfferState2(state, pool);
      };
      const connectPeer = (peer, peerId, _relayId) => {
        if (didLeaveRoom) {
          peer.destroy();
          return;
        }
        const state = getState2(ctx.peerStates, peerId);
        if (state.connectedPeer) {
          const shared2 = sharedPeerMap[peerId];
          if (shared2 && state.connectedPeer === shared2.peer && shared2.bindings[roomId]) return;
          if (state.connectedPeer !== peer && !peer.isDead) peer.destroy();
          return;
        }
        let shared = sharedPeerMap[peerId];
        if (shared && sharedPeers.getHealth(shared.peer) === "stale") {
          sharedPeers.clear(appId, peerId, { destroyPeer: true });
          shared = void 0;
        }
        if (shared && shared.peer !== peer) {
          if (!peer.isDead) peer.destroy();
          attachSharedPeerToRoom(peerId, shared);
          return;
        }
        const isNewShared = !shared;
        shared || (shared = sharedPeers.register(appId, peerId, peer, sharedPeerIdleMs));
        attachSharedPeerToRoom(peerId, shared);
        if (isNewShared) advertiseKnownRoomsToShared(appId, shared);
      };
      const disconnectPeer = (peer, peerId) => {
        var _a2;
        if (didLeaveRoom) return;
        const state = ctx.peerStates[peerId];
        if ((state == null ? void 0 : state.connectedPeer) === peer) {
          clearConnectedPeer2(state, peerId, "close-event");
          checkDeactivate();
          if (!isPassive && reannounceOnDisconnect) (_a2 = ctx.requeueAnnounce) == null ? void 0 : _a2.call(ctx);
        }
      };
      const isPassive = Boolean(config.passive);
      let roomRegistration = null;
      let passiveActivationTimeout;
      let deactivateRelayAnnouncements = noOp2;
      const checkDeactivate = () => {
        if (!isPassive || !ctx.isActive) return;
        let hasActiveWork = false;
        entries2(ctx.peerStates).forEach(([peerId, state]) => {
          if (state.connectedPeer || state.answeringPeer || state.offerInitPromise || state.offerPeer || state.offerRelays.some(Boolean)) hasActiveWork = true;
          else if (state.status === "idle") delete ctx.peerStates[peerId];
        });
        if (!hasActiveWork) {
          ctx.isActive = false;
          passiveActivationTimeout = resetTimer2(passiveActivationTimeout);
          announceTimeouts.forEach(resetTimer2);
          announceTimeouts.length = 0;
          deactivateRelayAnnouncements();
          if (roomRegistration == null ? void 0 : roomRegistration.roomToken) advertiseRoomPresenceToAll(appId, roomRegistration.roomToken, false);
        }
      };
      const ctx = {
        appId,
        roomId,
        config,
        peerStates: {},
        rootTopicPlaintext,
        rootTopicP,
        selfTopicP,
        toPlain,
        toCipher,
        isLeaving: () => didLeaveRoom,
        isPassive,
        isActive: !isPassive,
        onJoinError,
        sharedPeers,
        offerPool: pool,
        encryptOffer,
        initPeer: peer_default2,
        connectPeer,
        disconnectPeer,
        attachSharedPeerToRoom,
        checkDeactivate,
        announceIntervals: [],
        announceIntervalMs: announceIntervalMs2
      };
      const strategyContext = {
        config,
        appId,
        roomId,
        isPassive
      };
      const handleMessage = createSignalHandler2(ctx);
      if (!didInit) {
        const initRes = init(config);
        initPromises = (Array.isArray(initRes) ? initRes : [initRes]).map((value) => Promise.resolve(value));
        didInit = true;
        cleanupWatchOnline = ((_b = config.relayConfig) == null ? void 0 : _b.manualReconnection) ? noOp2 : watchOnline2();
      }
      if (!isPassive && !pool.isActive) pool.warmup();
      ctx.announceIntervals = initPromises.map(() => announceIntervalMs2);
      const announceScheduleIntervals = initPromises.map(() => announceIntervalMs2);
      const announceAttemptCounts = initPromises.map(() => 0);
      const announceErrorStreaks = initPromises.map(() => 0);
      const announceTimeouts = [];
      const unsubFns = initPromises.map(async (relayP, i) => subscribe(await relayP, await rootTopicP, await selfTopicP, handleMessage(i), (n) => pool.getOffers(n, encryptOffer), strategyContext));
      all2([rootTopicP, selfTopicP]).then(([rootTopic, selfTopic]) => {
        if (didLeaveRoom) return;
        const queueAnnounce = async (relay, i) => {
          var _a2;
          if (didLeaveRoom) return;
          if (isPassive && !ctx.isActive) return;
          const extra = isPassive ? { passive: true } : void 0;
          let announceResult = void 0;
          try {
            announceResult = await announce(relay, rootTopic, selfTopic, extra, strategyContext);
            announceErrorStreaks[i] = 0;
          } catch (error) {
            const errorStreak = announceErrorStreaks[i] ?? 0;
            if (errorStreak === 0 && ((_a2 = config.relayConfig) == null ? void 0 : _a2.warnOnRelayFailure) !== false) console.warn(`${libName2}: announce failed - ${toErrorMessage2(error, "")}`);
            announceErrorStreaks[i] = errorStreak + 1;
          }
          if (didLeaveRoom || isPassive && !ctx.isActive) return;
          if (announceResult && typeof announceResult !== "number" && "stopAnnouncing" in announceResult) return;
          if (typeof announceResult === "number") {
            ctx.announceIntervals[i] = announceResult;
            announceScheduleIntervals[i] = announceResult;
          } else if (announceResult) {
            announceScheduleIntervals[i] = announceResult.nextAnnounceMs;
            reannounceOnDisconnect || (reannounceOnDisconnect = announceResult.reannounceOnDisconnect === true);
          }
          const announceAttempt = announceAttemptCounts[i] ?? 0;
          announceAttemptCounts[i] = announceAttempt + 1;
          const currentInterval = announceScheduleIntervals[i] ?? announceIntervalMs2;
          const warmupDelay = announceWarmupIntervalsMs2[announceAttempt];
          announceTimeouts[i] = setTimeout(() => {
            queueAnnounce(relay, i);
          }, typeof warmupDelay === "number" ? Math.min(currentInterval, warmupDelay) : currentInterval);
        };
        deactivateRelayAnnouncements = () => {
          if (!deactivate) return;
          initPromises.forEach(async (relayP) => {
            const relay = await relayP;
            if (!didLeaveRoom) deactivate(relay, rootTopic, selfTopic, strategyContext);
          });
        };
        ctx.requeueAnnounce = () => {
          announceTimeouts.forEach(resetTimer2);
          announceTimeouts.length = 0;
          passiveActivationTimeout = resetTimer2(passiveActivationTimeout);
          if (!pool.isActive) pool.warmup();
          if (roomRegistration == null ? void 0 : roomRegistration.roomToken) advertiseRoomPresenceToAll(appId, roomRegistration.roomToken, true);
          passiveActivationTimeout = setTimeout(checkDeactivate, passiveActivationGraceMs2);
          initPromises.forEach(async (relayP, i) => {
            const relay = await relayP;
            if (relay && !didLeaveRoom) {
              announceAttemptCounts[i] = 0;
              queueAnnounce(relay, i);
            }
          });
        };
        unsubFns.forEach(async (didSub, i) => {
          await didSub;
          if (didLeaveRoom) return;
          const relay = await initPromises[i];
          if (relay && !didLeaveRoom && (!isPassive || ctx.isActive)) queueAnnounce(relay, i);
        });
      });
      let onPeerConnect = noOp2;
      const { compose } = createPasswordHandshake2(config.password ?? "", appId, roomId);
      const composedPeerHandshake = compose(onPeerHandshake);
      const roomOptions = {
        ...composedPeerHandshake ? { onPeerHandshake: composedPeerHandshake } : {},
        ...handshakeTimeoutMs === void 0 ? {} : { handshakeTimeoutMs },
        isPassive,
        onHandshakeError: (peerId, error) => onJoinError == null ? void 0 : onJoinError({
          error: error.replace(/^handshake failed: /, ""),
          appId,
          peerId,
          roomId
        })
      };
      occupiedRooms[appId] ?? (occupiedRooms[appId] = {});
      const appRoomRegistrations = getRoomRegistrations(appId);
      const joinedRoom = room_default2((f) => onPeerConnect = f, (id) => {
        if (didLeaveRoom) return;
        const state = ctx.peerStates[id];
        if (state == null ? void 0 : state.connectedPeer) {
          state.connectedPeer = null;
          updateStatus2(state);
          checkDeactivate();
        }
      }, () => {
        var _a2, _b2;
        didLeaveRoom = true;
        onPeerConnect = noOp2;
        const registration = (_a2 = roomRegistrations[appId]) == null ? void 0 : _a2[roomId];
        if (registration == null ? void 0 : registration.roomToken) {
          advertiseRoomPresenceToAll(appId, registration.roomToken, false);
          (_b2 = roomIdsByToken[appId]) == null ? true : delete _b2[registration.roomToken];
          if (roomIdsByToken[appId] && !keys2(roomIdsByToken[appId]).length) delete roomIdsByToken[appId];
        }
        if (roomRegistrations[appId]) {
          delete roomRegistrations[appId][roomId];
          if (!keys2(roomRegistrations[appId]).length) delete roomRegistrations[appId];
        }
        entries2(ctx.peerStates).forEach(([peerId, state]) => {
          state.answeringExpiryTimer = resetTimer2(state.answeringExpiryTimer);
          if (state.connectedPeer && !state.connectedPeer.isDead) {
            const shared = sharedPeerMap[peerId];
            if (!shared || shared.peer !== state.connectedPeer) state.connectedPeer.destroy();
          }
          if (state.answeringPeer && !state.answeringPeer.isDead) state.answeringPeer.destroy();
          resetOfferState2(state, pool);
          state.connectedPeer = null;
          state.answeringPeer = null;
          updateStatus2(state);
        });
        if (occupiedRooms[appId]) {
          delete occupiedRooms[appId][roomId];
          if (keys2(occupiedRooms[appId]).length === 0) delete occupiedRooms[appId];
        }
        announceTimeouts.forEach(resetTimer2);
        passiveActivationTimeout = resetTimer2(passiveActivationTimeout);
        unsubFns.forEach(async (f) => {
          (await f)();
        });
        if (hasActiveRooms()) return;
        didInit = false;
        pool.destroy();
        offerPool = null;
        cleanupWatchOnline();
        cleanupRoomPresenceHandler(appId);
      }, roomOptions);
      roomRegistration = {
        roomToken: null,
        roomTokenPromise: roomNamespacePromise,
        attachSharedPeerToRoom,
        shouldAdvertise: () => !isPassive || ctx.isActive
      };
      appRoomRegistrations[roomId] = roomRegistration;
      roomNamespacePromise.then((roomToken) => {
        var _a2;
        const registration = roomRegistration;
        if (!registration || didLeaveRoom || ((_a2 = roomRegistrations[appId]) == null ? void 0 : _a2[roomId]) !== registration) return;
        registration.roomToken = roomToken;
        getRoomIdsByToken(appId)[roomToken] = roomId;
        values2(sharedPeerMap).forEach((shared) => {
          if (shared.remoteRoomTokens.has(roomToken)) attachSharedPeerToRoom(shared.peerId, shared);
        });
        if (!isPassive || ctx.isActive) advertiseRoomPresenceToAll(appId, roomToken, true);
      });
      return occupiedRooms[appId][roomId] = joinedRoom;
    };
  };

  // ../../../../node_modules/@trystero-p2p/nostr/node_modules/@trystero-p2p/core/dist/topic-strategy.mjs
  var signalKeys3 = [
    "offer",
    "answer",
    "candidate"
  ];
  var defaultSteadyAnnounceIntervalMs = 6e4;
  var toPayload3 = (msg) => {
    if (typeof msg === "string") try {
      const parsed = fromJson2(msg);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
    return msg;
  };
  var getString3 = (payload, key) => typeof payload[key] === "string" && payload[key] ? payload[key] : void 0;
  var hasInvalidSignalField3 = (payload) => signalKeys3.some((key) => key in payload && (typeof payload[key] !== "string" || payload[key] === ""));
  var shouldActivatePassiveRoom = (msg) => {
    const payload = toPayload3(msg);
    if (!payload || hasInvalidSignalField3(payload)) return false;
    const peerId = getString3(payload, "peerId");
    return Boolean(peerId && peerId !== selfId2 && payload["passive"] !== true && !getString3(payload, "answer") && !getString3(payload, "candidate"));
  };
  var requireContext = (context) => {
    if (!context) throw mkErr2("topic strategy missing room context");
    return context;
  };
  var subscriptionContext = (context, kind, rootTopic, selfTopic) => ({
    kind,
    appId: context.appId,
    roomId: context.roomId,
    rootTopic,
    selfTopic
  });
  var publishContext = (context, kind, rootTopic, selfTopic) => ({
    kind,
    appId: context.appId,
    roomId: context.roomId,
    rootTopic,
    selfTopic
  });
  var topic_strategy_default2 = ({ steadyAnnounceIntervalMs: steadyAnnounceIntervalMs2 = defaultSteadyAnnounceIntervalMs, reannounceOnDisconnect = true, init, subscribeTopic, publishTopic, unpublishTopic }) => strategy_default2({
    init,
    subscribe: async (relay, rootTopic, selfTopic, onMessage, _getOffers, rawContext) => {
      const context = requireContext(rawContext);
      const signalPeer = (peerTopic, signal) => void publishTopic(relay, peerTopic, signal, publishContext(context, "signal", rootTopic, selfTopic));
      let selfCleanup = null;
      let selfCleanupDone = false;
      let selfSubscriptionP = null;
      let didCleanup = false;
      const cleanupSelf = (cleanup) => {
        if (selfCleanupDone) return;
        selfCleanupDone = true;
        cleanup();
      };
      const ensureSelfSubscription = () => {
        if (!selfSubscriptionP) selfSubscriptionP = Promise.resolve(subscribeTopic(relay, selfTopic, (topic, msg) => {
          if (!didCleanup) onMessage(topic, msg, signalPeer);
        }, subscriptionContext(context, "self", rootTopic, selfTopic))).then((cleanup) => {
          selfCleanup = cleanup;
          if (didCleanup) cleanupSelf(cleanup);
        });
        return selfSubscriptionP;
      };
      if (!context.isPassive) await ensureSelfSubscription();
      const rootCleanup = await subscribeTopic(relay, rootTopic, async (topic, msg) => {
        if (didCleanup) return;
        if (context.isPassive && shouldActivatePassiveRoom(msg)) await ensureSelfSubscription();
        if (!didCleanup) await onMessage(topic, msg, signalPeer);
      }, subscriptionContext(context, "root", rootTopic, selfTopic));
      return () => {
        didCleanup = true;
        if (selfCleanup) cleanupSelf(selfCleanup);
        rootCleanup();
      };
    },
    announce: async (relay, rootTopic, selfTopic, extraPayload, rawContext) => {
      const context = requireContext(rawContext);
      const result = await publishTopic(relay, rootTopic, toJson2({
        peerId: selfId2,
        ...extraPayload
      }), publishContext(context, "announce", rootTopic, selfTopic));
      return typeof result === "number" || result !== void 0 && "stopAnnouncing" in result ? result : {
        nextAnnounceMs: (result == null ? void 0 : result.nextAnnounceMs) ?? steadyAnnounceIntervalMs2,
        reannounceOnDisconnect: (result == null ? void 0 : result.reannounceOnDisconnect) ?? reannounceOnDisconnect
      };
    },
    ...unpublishTopic ? { deactivate: (relay, rootTopic, selfTopic, rawContext) => {
      const context = requireContext(rawContext);
      return unpublishTopic(relay, rootTopic, publishContext(context, "announce", rootTopic, selfTopic));
    } } : {}
  });

  // ../../../../node_modules/@trystero-p2p/nostr/dist/index.mjs
  var relayManager2 = createRelayManager2((client) => client.socket);
  var defaultRedundancy2 = 5;
  var tag = "x";
  var eventMsgType = "EVENT";
  var { secretKey, publicKey } = schnorr.keygen();
  var pubkey = toHex2(publicKey);
  var subIdToTopic = {};
  var msgHandlers2 = {};
  var kindCache = {};
  var maxTopicsPerSubscription = 250;
  var steadyAnnounceIntervalMs = 6e4;
  var maxRelayBackoffMs = 15 * 6e4;
  var relayAckTimeoutMs = 5333;
  var relayBackoffs = /* @__PURE__ */ new WeakMap();
  var retiredRelays = /* @__PURE__ */ new WeakSet();
  var pendingAnnouncementAcks = /* @__PURE__ */ new WeakMap();
  var backoffRelay = (client) => {
    const previous = relayBackoffs.get(client);
    const delayMs = Math.min((previous == null ? void 0 : previous.delayMs) ? Math.max(steadyAnnounceIntervalMs, previous.delayMs * 2) : steadyAnnounceIntervalMs, maxRelayBackoffMs);
    relayBackoffs.set(client, {
      delayMs,
      untilMs: Date.now() + delayMs
    });
    return delayMs;
  };
  var getRelayBackoffMs = (client) => {
    const state = relayBackoffs.get(client);
    if (!state) return 0;
    const remainingMs = state.untilMs - Date.now();
    if (remainingMs > 0) return remainingMs;
    return 0;
  };
  var nextAnnounce = (nextAnnounceMs) => ({ nextAnnounceMs });
  var stopAnnouncing = { stopAnnouncing: true };
  var retireRelay = (client) => {
    var _a;
    if (retiredRelays.has(client)) return false;
    const pending = pendingAnnouncementAcks.get(client);
    if (pending) {
      clearTimeout(pending.timer);
      pendingAnnouncementAcks.delete(client);
    }
    retiredRelays.add(client);
    relayBackoffs.delete(client);
    (_a = client.close) == null ? void 0 : _a.call(client);
    return true;
  };
  var trackAnnouncementAck = (client, eventId) => {
    const pending = pendingAnnouncementAcks.get(client);
    if (pending) {
      clearTimeout(pending.timer);
      pending.eventIds.add(eventId);
    }
    const eventIds = (pending == null ? void 0 : pending.eventIds) ?? /* @__PURE__ */ new Set([eventId]);
    const timer = setTimeout(() => {
      pendingAnnouncementAcks.delete(client);
    }, relayAckTimeoutMs);
    pendingAnnouncementAcks.set(client, {
      eventIds,
      timer
    });
  };
  var acknowledgeEvent = (client, eventId) => {
    const pending = pendingAnnouncementAcks.get(client);
    if (!(pending == null ? void 0 : pending.eventIds.has(eventId))) return false;
    clearTimeout(pending.timer);
    pendingAnnouncementAcks.delete(client);
    return true;
  };
  var now = () => Math.floor(Date.now() / 1e3);
  var topicToKind = (topic) => kindCache[topic] ?? (kindCache[topic] = strToNum2(topic, 1e4) + 2e4);
  var createEvent = async (topic, content) => {
    const payload = {
      kind: topicToKind(topic),
      tags: [[tag, topic]],
      created_at: now(),
      content,
      pubkey
    };
    const id = await hashWith2("SHA-256", toJson2([
      0,
      payload.pubkey,
      payload.created_at,
      payload.kind,
      payload.tags,
      payload.content
    ]));
    return toJson2([eventMsgType, {
      ...payload,
      id: toHex2(id),
      sig: toHex2(await schnorr.signAsync(id, secretKey))
    }]);
  };
  var batchers = {};
  var resolveBatchFlush = (batcher) => {
    batcher.flushWaiters.forEach((resolve) => resolve());
    batcher.flushWaiters.clear();
  };
  var batchAdd = (client, topic, handler) => {
    var _a;
    const batcher = batchers[_a = client.url] ?? (batchers[_a] = {
      subIds: [],
      topics: /* @__PURE__ */ new Map(),
      updateTimer: null,
      flushWaiters: /* @__PURE__ */ new Set()
    });
    batcher.topics.set(topic, handler);
    scheduleBatchFlush(client, batcher);
  };
  var batchRemove = (client, topic) => {
    const batcher = batchers[client.url];
    if (!batcher) return;
    batcher.topics.delete(topic);
    if (batcher.topics.size === 0) {
      if (batcher.updateTimer !== null) {
        clearTimeout(batcher.updateTimer);
        batcher.updateTimer = null;
      }
      resolveBatchFlush(batcher);
      batcher.subIds.forEach((subId) => client.send(toJson2(["CLOSE", subId])));
      delete batchers[client.url];
    } else scheduleBatchFlush(client, batcher);
  };
  var scheduleBatchFlush = (client, batcher) => {
    if (batcher.updateTimer !== null) return;
    batcher.updateTimer = setTimeout(() => {
      batcher.updateTimer = null;
      try {
        flushBatch(client);
      } finally {
        resolveBatchFlush(batcher);
      }
    }, 0);
  };
  var waitForBatchFlush = (client) => {
    const batcher = batchers[client.url];
    if (!batcher || batcher.updateTimer === null) return Promise.resolve();
    return new Promise((resolve) => batcher.flushWaiters.add(resolve));
  };
  var flushBatch = (client) => {
    const batcher = batchers[client.url];
    if (!batcher || batcher.topics.size === 0) return;
    const topics = [...batcher.topics.keys()];
    const chunks = [];
    const since = now();
    for (let i = 0; i < topics.length; i += maxTopicsPerSubscription) chunks.push(topics.slice(i, i + maxTopicsPerSubscription));
    while (batcher.subIds.length > chunks.length) {
      const subId = batcher.subIds.pop();
      if (subId) client.send(toJson2(["CLOSE", subId]));
    }
    chunks.forEach((chunk, i) => {
      var _a;
      const subId = (_a = batcher.subIds)[i] ?? (_a[i] = genId2(64));
      client.send(toJson2([
        "REQ",
        subId,
        {
          kinds: [...new Set(chunk.map(topicToKind))],
          since,
          ["#x"]: chunk
        }
      ]));
    });
  };
  var resubscribeOnReconnect = (client) => {
    const batcher = batchers[client.url];
    if (batcher && batcher.topics.size > 0) flushBatch(client);
  };
  var joinRoom2 = topic_strategy_default2({
    init: (config) => getRelays2(config, defaultRelayUrls2, defaultRedundancy2, true).map((url) => {
      const client = relayManager2.register(url, () => makeSocket2(url, (data) => {
        var _a, _b;
        const [msgType, subId, payload, relayMsg] = fromJson2(data);
        if (msgType !== eventMsgType) {
          const prefix = `${libName2}: relay failure from ${client.url} - `;
          const rejectionReason = msgType === "CLOSED" && typeof payload === "string" ? payload : relayMsg;
          const didRejectEvent = msgType === "OK" && payload === false;
          const isRateLimited = didRejectEvent && (rejectionReason == null ? void 0 : rejectionReason.startsWith("rate-limited:"));
          const isDuplicate = didRejectEvent && (rejectionReason == null ? void 0 : rejectionReason.startsWith("duplicate:"));
          const isTerminalRejection = msgType === "CLOSED" || didRejectEvent && !isRateLimited && !isDuplicate;
          const didAcknowledgeAnnouncement = msgType === "OK" && acknowledgeEvent(client, subId);
          if (isTerminalRejection && !retireRelay(client)) return;
          if (isRateLimited) backoffRelay(client);
          else if (didAcknowledgeAnnouncement) relayBackoffs.delete(client);
          if (!isDuplicate && ((_a = config.relayConfig) == null ? void 0 : _a.warnOnRelayFailure) !== false) {
            if (msgType === "NOTICE") console.warn(prefix + subId);
            else if (didRejectEvent || msgType === "CLOSED") console.warn(prefix + rejectionReason);
          }
          return;
        }
        if (payload && typeof payload === "object" && "content" in payload) {
          const { content } = payload;
          const handler = msgHandlers2[subId];
          if (handler) {
            handler(subIdToTopic[subId] ?? "", content);
            return;
          }
          const batcher = batchers[client.url];
          if ((batcher == null ? void 0 : batcher.subIds.includes(subId)) && payload.tags) {
            const topicTag = payload.tags.find((t) => t[0] === tag);
            if (topicTag == null ? void 0 : topicTag[1]) (_b = batcher.topics.get(topicTag[1])) == null ? void 0 : _b(topicTag[1], content);
          }
        }
      }, () => resubscribeOnReconnect(client)));
      return client.ready;
    }),
    subscribeTopic: (client, topic, onMessage, context) => {
      const handler = (topic2, data) => void onMessage(topic2, data);
      batchAdd(client, topic, handler);
      const cleanup = () => {
        batchRemove(client, topic);
      };
      return context.kind === "root" ? waitForBatchFlush(client).then(() => cleanup) : cleanup;
    },
    publishTopic: async (client, topic, msg, context) => {
      if (retiredRelays.has(client) || client.isClosed) return context.kind === "announce" ? stopAnnouncing : void 0;
      if (context.kind === "announce") {
        const remainingBackoffMs = getRelayBackoffMs(client);
        if (remainingBackoffMs > 0) return nextAnnounce(Math.max(steadyAnnounceIntervalMs, remainingBackoffMs));
      }
      const event = await createEvent(topic, typeof msg === "string" ? msg : toJson2(msg));
      const didSend = client.socket.readyState === 1;
      client.send(event);
      if (context.kind !== "announce") return;
      if (!didSend) return nextAnnounce(backoffRelay(client));
      const eventId = fromJson2(event)[1].id;
      trackAnnouncementAck(client, eventId);
      return nextAnnounce(steadyAnnounceIntervalMs);
    }
  });
  var getRelaySockets2 = relayManager2.getSockets;
  var defaultRelayUrls2 = [
    "basspistol.org",
    "bucket.coracle.social",
    "chorus.pjv.me",
    "koru.bitcointxoko.org",
    "nos.lol",
    "nostr-01.uid.ovh",
    "nostr-01.yakihonne.com",
    "nostr-relay.corb.net",
    "nostr.data.haus",
    "nostr.islandarea.net",
    "nostr.sathoarder.com",
    "nostr.tegila.com.br",
    "nostr.vulpem.com",
    "purplerelay.com",
    "relay-can.zombi.cloudrodion.com",
    "relay-rpi.edufeed.org",
    "relay.agorist.space",
    "relay.artio.inf.unibe.ch",
    "relay.mostr.pub",
    "relay.mostro.network",
    "relay.sigit.io",
    "relay02.lnfi.network",
    "schnorr.me",
    "social.amanah.eblessing.co",
    "staging.yabu.me",
    "strfry.shock.network",
    "top.testrelay.top",
    "yabu.me/v2"
  ].map((url) => "wss://" + url);

  // src/ORPNostrSession.ts
  var ORPNostrSession = class _ORPNostrSession {
    constructor() {
      this.sendActions = [];
      this.messageListeners = /* @__PURE__ */ new Set();
      this.closeListeners = /* @__PURE__ */ new Set();
      this.errorListeners = /* @__PURE__ */ new Set();
      this.openListeners = /* @__PURE__ */ new Set();
      this.readyState = 0;
      this.peerIdMap = /* @__PURE__ */ new Map();
      // 0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED
      this.rooms = [];
    }
    /** Create a session racing WebTorrent (dynamic) */
    static async create(roomCode, iceServers) {
      console.log(`[ORP] Initializing P2P Signaling Race for room: ${roomCode}`);
      const session = new _ORPNostrSession();
      const config = { appId: "orp-v2" };
      if (iceServers && iceServers.length > 0) {
        config.rtcConfig = { iceServers };
      }
      (async () => {
        try {
          console.log(`[ORP] Fetching latest live torrent trackers...`);
          const res = await fetch("https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_all_ws.txt");
          const text = await res.text();
          let torrentTrackers = text.split("\n").map((t) => t.trim()).filter((t) => t.startsWith("wss://"));
          if (torrentTrackers.length > 0) {
            torrentTrackers = torrentTrackers.sort(() => 0.5 - Math.random()).slice(0, 4);
            console.log(`[ORP] Successfully loaded ${torrentTrackers.length} live trackers.`);
            const torrentRoom = joinRoom({ ...config, relayConfig: { urls: torrentTrackers } }, roomCode);
            session.attachRoom(torrentRoom, "Torrent");
          }
        } catch (e) {
          console.warn(`[ORP] Failed to fetch dynamic trackers, Torrent strategy skipped.`);
        }
      })();
      try {
        console.log(`[ORP] Initializing Nostr Relay fallback...`);
        const nostrRelays = [
          "wss://relay.damus.io",
          "wss://nos.lol",
          "wss://relay.nostr.band",
          "wss://relay.snort.social"
        ];
        const nostrRoom = joinRoom2({ ...config, relayConfig: { urls: nostrRelays } }, roomCode);
        session.attachRoom(nostrRoom, "Nostr");
      } catch (e) {
        console.warn(`[ORP] Nostr strategy failed.`);
      }
      return session;
    }
    attachRoom(room, name) {
      this.rooms.push(room);
      const action = room.makeAction("orp-signal");
      this.sendActions.push((msg, peerId) => {
        try {
          console.log(`[ORP] \u{1F680} Sending msg via ${name} to ${peerId || "broadcast"}`);
          if (peerId) action.send(msg, { target: peerId });
          else action.send(msg);
        } catch (e) {
          console.warn(`[ORP] Failed to send via ${name}:`, e);
        }
      });
      room.onPeerJoin = (peerId) => {
        console.log(`[ORP] \u{1F7E2} Peer ${peerId} discovered via ${name}!`);
        if (this.readyState === 0) {
          this.readyState = 1;
          this.openListeners.forEach((fn) => fn());
        }
      };
      action.onMessage = (data, meta) => {
        if (data && data.senderId) {
          this.peerIdMap.set(data.senderId, meta.peerId);
        }
        console.log(`[ORP] \u{1F4E9} Received msg from ${meta.peerId} via ${name}`);
        const rawData = typeof data === "string" ? data : JSON.stringify(data);
        const ev = new MessageEvent("message", { data: rawData });
        this.messageListeners.forEach((fn) => fn(ev));
      };
      room.onPeerLeave = (peerId) => {
        console.log(`[ORP] \u{1F534} Peer ${peerId} left via ${name}!`);
        this.closeListeners.forEach((fn) => fn());
      };
    }
    // Mock WebSocket API
    addEventListener(type, listener) {
      if (type === "message") this.messageListeners.add(listener);
      if (type === "close") this.closeListeners.add(listener);
      if (type === "error") this.errorListeners.add(listener);
      if (type === "open") this.openListeners.add(listener);
    }
    removeEventListener(type, listener) {
      if (type === "message") this.messageListeners.delete(listener);
      if (type === "close") this.closeListeners.delete(listener);
      if (type === "error") this.errorListeners.delete(listener);
      if (type === "open") this.openListeners.delete(listener);
    }
    // Setters for direct assignment (ws.onmessage = ...)
    set onmessage(fn) {
      this.messageListeners.add(fn);
    }
    set onclose(fn) {
      this.closeListeners.add(fn);
    }
    set onerror(fn) {
      this.errorListeners.add(fn);
    }
    set onopen(fn) {
      this.openListeners.add(fn);
      if (this.readyState === 1) fn();
    }
    send(data) {
      const parsed = typeof data === "string" ? JSON.parse(data) : data;
      let target = parsed.target || parsed.to_peer_id || parsed.to;
      if (target && this.peerIdMap.has(target)) {
        target = this.peerIdMap.get(target);
      }
      this.sendActions.forEach((send2) => {
        try {
          if (target) {
            console.log(`[ORP] \u{1F680} Sending msg to mapped target: ${target}`);
            send2(parsed, target);
          } else {
            console.log(`[ORP] \u{1F680} Sending msg to broadcast`);
            send2(parsed);
          }
        } catch (e) {
        }
      });
    }
    close() {
      this.readyState = 3;
      this.rooms.forEach((r) => {
        try {
          r.leave();
        } catch (e) {
        }
      });
      this.closeListeners.forEach((fn) => fn());
    }
  };

  // src/ORPMqttSession.ts
  var ORPMqttSession = class _ORPMqttSession {
    constructor(topic) {
      this.messageListeners = /* @__PURE__ */ new Set();
      this.closeListeners = /* @__PURE__ */ new Set();
      this.errorListeners = /* @__PURE__ */ new Set();
      this.openListeners = /* @__PURE__ */ new Set();
      this.readyState = 0;
      // 0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED
      this.ws = null;
      this.topic = topic;
      this.clientId = "orp-v2-" + Math.random().toString(36).slice(2);
    }
    static async create(roomCode, _iceServers) {
      console.log(`[ORP] Initializing pure MQTT strategy for room: ${roomCode}`);
      const session = new _ORPMqttSession(`orp-v2-${roomCode}`);
      session.ws = new WebSocket("wss://test.mosquitto.org:8081", "mqtt");
      session.ws.binaryType = "arraybuffer";
      session.ws.onopen = () => {
        session.ws.send(session.createConnect());
      };
      session.ws.onmessage = (ev) => {
        if (session.readyState === 3) return;
        const buffer = new Uint8Array(ev.data);
        const type = buffer[0] >> 4;
        if (type === 2) {
          session.ws.send(session.createSubscribe());
        } else if (type === 9) {
          session.readyState = 1;
          session.openListeners.forEach((fn) => fn());
        } else if (type === 3) {
          const decoded = session.decodePublish(buffer);
          if (decoded) {
            try {
              const parsed = JSON.parse(decoded);
              const msgEv = new MessageEvent("message", { data: decoded });
              session.messageListeners.forEach((fn) => fn(msgEv));
            } catch (e) {
            }
          }
        }
      };
      session.ws.onerror = (e) => {
        session.errorListeners.forEach((fn) => fn(e));
      };
      session.ws.onclose = () => {
        session.readyState = 3;
        session.closeListeners.forEach((fn) => fn());
      };
      return session;
    }
    // MQTT Encoding / Decoding
    encodeLength(len) {
      const bytes = [];
      do {
        let digit = len % 128;
        len = Math.floor(len / 128);
        if (len > 0) digit |= 128;
        bytes.push(digit);
      } while (len > 0);
      return bytes;
    }
    decodeLength(buffer, offset) {
      let multiplier = 1;
      let value = 0;
      let byte;
      let i = offset;
      do {
        if (i >= buffer.length) break;
        byte = buffer[i++];
        value += (byte & 127) * multiplier;
        multiplier *= 128;
      } while ((byte & 128) !== 0);
      return { value, lengthBytes: i - offset };
    }
    encodeString(str) {
      const encoder3 = new TextEncoder();
      const bytes = encoder3.encode(str);
      return [bytes.length >> 8 & 255, bytes.length & 255, ...Array.from(bytes)];
    }
    createConnect() {
      const payload = [
        ...this.encodeString("MQTT"),
        4,
        2,
        0,
        60,
        ...this.encodeString(this.clientId)
      ];
      return new Uint8Array([16, ...this.encodeLength(payload.length), ...payload]);
    }
    createSubscribe() {
      const payload = [
        0,
        1,
        // Packet ID
        ...this.encodeString(this.topic),
        0
        // QoS 0
      ];
      return new Uint8Array([130, ...this.encodeLength(payload.length), ...payload]);
    }
    createPublish(message) {
      const encoder3 = new TextEncoder();
      const msgBytes = Array.from(encoder3.encode(message));
      const payload = [
        ...this.encodeString(this.topic),
        ...msgBytes
      ];
      return new Uint8Array([48, ...this.encodeLength(payload.length), ...payload]);
    }
    decodePublish(buffer) {
      try {
        const { value, lengthBytes } = this.decodeLength(buffer, 1);
        const topicLen = buffer[1 + lengthBytes] << 8 | buffer[2 + lengthBytes];
        const msgOffset = 1 + lengthBytes + 2 + topicLen;
        const msgBuffer = buffer.slice(msgOffset, 1 + lengthBytes + value);
        return new TextDecoder().decode(msgBuffer);
      } catch (e) {
        return null;
      }
    }
    // Mock WebSocket API
    addEventListener(type, listener) {
      if (type === "message") this.messageListeners.add(listener);
      if (type === "close") this.closeListeners.add(listener);
      if (type === "error") this.errorListeners.add(listener);
      if (type === "open") this.openListeners.add(listener);
    }
    removeEventListener(type, listener) {
      if (type === "message") this.messageListeners.delete(listener);
      if (type === "close") this.closeListeners.delete(listener);
      if (type === "error") this.errorListeners.delete(listener);
      if (type === "open") this.openListeners.delete(listener);
    }
    set onmessage(fn) {
      this.messageListeners.add(fn);
    }
    set onclose(fn) {
      this.closeListeners.add(fn);
    }
    set onerror(fn) {
      this.errorListeners.add(fn);
    }
    set onopen(fn) {
      this.openListeners.add(fn);
      if (this.readyState === 1) fn();
    }
    send(data) {
      if (this.readyState !== 1) return;
      const parsed = typeof data === "string" ? data : JSON.stringify(data);
      this.ws.send(this.createPublish(parsed));
    }
    close() {
      var _a;
      this.readyState = 3;
      try {
        (_a = this.ws) == null ? void 0 : _a.close();
      } catch (e) {
      }
      this.closeListeners.forEach((fn) => fn());
    }
  };
  return __toCommonJS(index_exports);
})();
/*! Bundled license information:

@noble/secp256k1/index.js:
  (*! noble-secp256k1 - MIT License (c) 2019 Paul Miller (paulmillr.com) *)
*/
//# sourceMappingURL=orp-client.iife.js.map
