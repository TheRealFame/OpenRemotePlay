"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ORPClient = void 0;
// Very basic UUID v4 generator for browsers/node
function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}
class ORPClient {
    constructor(options) {
        this.ws = null;
        this.pc = null;
        this.dc = null;
        this.events = {};
        // High level helpers
        this.gamepads = {};
        this.options = options;
        this.viewerId = options.viewerId || uuidv4();
    }
    on(event, handler) {
        if (!this.events[event])
            this.events[event] = [];
        this.events[event].push(handler);
    }
    emit(event, ...args) {
        if (this.events[event]) {
            this.events[event].forEach(handler => handler(...args));
        }
    }
    connect() {
        this.ws = new WebSocket(this.options.signalingUrl);
        this.ws.onopen = () => {
            this.emit('connected');
            this.ws?.send(JSON.stringify({
                type: 'join-host',
                viewerId: this.viewerId,
                displayName: this.options.displayName,
                color: this.options.color || '#00ff00'
            }));
        };
        this.ws.onmessage = async (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'offer') {
                await this.handleOffer(msg.sdp);
            }
            else if (msg.type === 'ice-candidate') {
                if (this.pc) {
                    await this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
                }
            }
            else if (msg.type === 'system-chat') {
                this.emit('chat', msg);
            }
        };
        this.ws.onclose = () => this.emit('disconnected');
        this.ws.onerror = (err) => this.emit('error', err);
    }
    async handleOffer(sdp) {
        this.pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        this.pc.onicecandidate = (event) => {
            if (event.candidate && this.ws) {
                this.ws.send(JSON.stringify({
                    type: 'ice-candidate',
                    candidate: event.candidate,
                    target: 'host'
                }));
            }
        };
        this.pc.ontrack = (event) => {
            if (event.streams && event.streams[0]) {
                this.emit('stream-added', event.streams[0]);
            }
        };
        this.pc.ondatachannel = (event) => {
            if (event.channel.label === 'fast-lane-input' || event.channel.label === 'orp-input') {
                this.dc = event.channel;
                this.dc.onopen = () => this.emit('ready');
                this.dc.onclose = () => Object.keys(this.gamepads).forEach(k => this.releaseGamepad(k));
            }
        };
        await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.ws?.send(JSON.stringify({
            type: 'answer',
            sdp: answer.sdp,
            target: 'host',
            sender: this.viewerId
        }));
    }
    sendInput(payload) {
        if (this.dc && this.dc.readyState === 'open') {
            this.dc.send(JSON.stringify(payload));
        }
    }
    sendGamepadState(padIndex, axes, buttons) {
        const padId = `${this.viewerId}_${padIndex}`;
        this.gamepads[padId] = true;
        this.sendInput({
            type: 'gamepad',
            viewerId: this.viewerId,
            pad_id: padId,
            padIndex: padIndex,
            axes: axes,
            buttons: buttons
        });
    }
    releaseGamepad(padId) {
        this.sendInput({
            type: 'gamepad',
            viewerId: this.viewerId,
            pad_id: padId,
            padIndex: 0,
            axes: [0, 0, 0, 0],
            buttons: Array(17).fill({ pressed: false, value: 0 })
        });
        delete this.gamepads[padId];
    }
}
exports.ORPClient = ORPClient;
