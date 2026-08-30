import { ORPClientOptions, GamepadPayload, KeyboardPayload, WebHIDPayload } from './types';

// Very basic UUID v4 generator for browsers/node
function uuidv4(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

type EventHandler = (...args: any[]) => void;

export class ORPClient {
    private options: ORPClientOptions;
    private ws: WebSocket | null = null;
    private pc: RTCPeerConnection | null = null;
    private dc: RTCDataChannel | null = null;
    private events: Record<string, EventHandler[]> = {};

    public viewerId: string;

    constructor(options: ORPClientOptions) {
        this.options = options;
        this.viewerId = options.viewerId || uuidv4();
    }

    public on(event: string, handler: EventHandler) {
        if (!this.events[event]) this.events[event] = [];
        this.events[event].push(handler);
    }

    private emit(event: string, ...args: any[]) {
        if (this.events[event]) {
            this.events[event].forEach(handler => handler(...args));
        }
    }

    public connect() {
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
            } else if (msg.type === 'ice-candidate') {
                if (this.pc) {
                    await this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
                }
            } else if (msg.type === 'system-chat') {
                this.emit('chat', msg);
            }
        };

        this.ws.onclose = () => this.emit('disconnected');
        this.ws.onerror = (err) => this.emit('error', err);
    }

    private async handleOffer(sdp: string) {
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

    public sendInput(payload: Partial<GamepadPayload | KeyboardPayload | WebHIDPayload>) {
        if (this.dc && this.dc.readyState === 'open') {
            this.dc.send(JSON.stringify(payload));
        }
    }

    // High level helpers
    private gamepads: Record<string, boolean> = {};

    public sendGamepadState(padIndex: number, axes: number[], buttons: { pressed: boolean, value: number }[]) {
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
    
    public releaseGamepad(padId: string) {
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
