export class ORPMqttSession {
    private messageListeners: Set<(ev: MessageEvent) => void> = new Set();
    private closeListeners: Set<() => void> = new Set();
    private errorListeners: Set<(err: Event) => void> = new Set();
    private openListeners: Set<() => void> = new Set();
    
    public readyState: number = 0; // 0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED
    private ws: WebSocket | null = null;
    private topic: string;
    private clientId: string;

    private constructor(topic: string) {
        this.topic = topic;
        this.clientId = 'orp-v2-' + Math.random().toString(36).slice(2);
    }

    static async create(roomCode: string, _iceServers?: any[]): Promise<ORPMqttSession> {
        console.log(`[ORP] Initializing pure MQTT strategy for room: ${roomCode}`);
        const session = new ORPMqttSession(`orp-v2-${roomCode}`);
        
        session.ws = new WebSocket('wss://test.mosquitto.org:8081', 'mqtt');
        session.ws.binaryType = 'arraybuffer';
        
        session.ws.onopen = () => {
            session.ws!.send(session.createConnect());
        };
        
        session.ws.onmessage = (ev) => {
            if (session.readyState === 3) return;
            const buffer = new Uint8Array(ev.data);
            const type = buffer[0] >> 4;
            
            if (type === 2) {
                // CONNACK
                session.ws!.send(session.createSubscribe());
            } else if (type === 9) {
                // SUBACK
                session.readyState = 1;
                session.openListeners.forEach(fn => fn());
            } else if (type === 3) {
                // PUBLISH
                const decoded = session.decodePublish(buffer);
                if (decoded) {
                    try {
                        const parsed = JSON.parse(decoded);
                        // Filter out echoes of our own messages if senderId is missing or somehow matches (though usually we don't know our senderId here, the caller handles it)
                        const msgEv = new MessageEvent('message', { data: decoded });
                        session.messageListeners.forEach(fn => fn(msgEv));
                    } catch (e) {}
                }
            }
        };
        
        session.ws.onerror = (e) => {
            session.errorListeners.forEach(fn => fn(e));
        };
        
        session.ws.onclose = () => {
            session.readyState = 3;
            session.closeListeners.forEach(fn => fn());
        };
        
        return session;
    }

    // MQTT Encoding / Decoding
    private encodeLength(len: number): number[] {
        const bytes = [];
        do {
            let digit = len % 128;
            len = Math.floor(len / 128);
            if (len > 0) digit |= 128;
            bytes.push(digit);
        } while (len > 0);
        return bytes;
    }

    private decodeLength(buffer: Uint8Array, offset: number): { value: number, lengthBytes: number } {
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

    private encodeString(str: string): number[] {
        const encoder = new TextEncoder();
        const bytes = encoder.encode(str);
        return [(bytes.length >> 8) & 0xff, bytes.length & 0xff, ...Array.from(bytes)];
    }

    private createConnect(): Uint8Array {
        const payload = [
            ...this.encodeString("MQTT"),
            4, 2, 0, 60,
            ...this.encodeString(this.clientId)
        ];
        return new Uint8Array([0x10, ...this.encodeLength(payload.length), ...payload]);
    }

    private createSubscribe(): Uint8Array {
        const payload = [
            0, 1, // Packet ID
            ...this.encodeString(this.topic),
            0 // QoS 0
        ];
        return new Uint8Array([0x82, ...this.encodeLength(payload.length), ...payload]);
    }

    private createPublish(message: string): Uint8Array {
        const encoder = new TextEncoder();
        const msgBytes = Array.from(encoder.encode(message));
        const payload = [
            ...this.encodeString(this.topic),
            ...msgBytes
        ];
        return new Uint8Array([0x30, ...this.encodeLength(payload.length), ...payload]);
    }

    private decodePublish(buffer: Uint8Array): string | null {
        try {
            const { value, lengthBytes } = this.decodeLength(buffer, 1);
            const topicLen = (buffer[1 + lengthBytes] << 8) | buffer[2 + lengthBytes];
            const msgOffset = 1 + lengthBytes + 2 + topicLen;
            const msgBuffer = buffer.slice(msgOffset, 1 + lengthBytes + value);
            return new TextDecoder().decode(msgBuffer);
        } catch (e) {
            return null;
        }
    }

    // Mock WebSocket API
    addEventListener(type: string, listener: any) {
        if (type === 'message') this.messageListeners.add(listener);
        if (type === 'close') this.closeListeners.add(listener);
        if (type === 'error') this.errorListeners.add(listener);
        if (type === 'open') this.openListeners.add(listener);
    }
    
    removeEventListener(type: string, listener: any) {
        if (type === 'message') this.messageListeners.delete(listener);
        if (type === 'close') this.closeListeners.delete(listener);
        if (type === 'error') this.errorListeners.delete(listener);
        if (type === 'open') this.openListeners.delete(listener);
    }

    set onmessage(fn: (ev: MessageEvent) => void) { this.messageListeners.add(fn); }
    set onclose(fn: () => void) { this.closeListeners.add(fn); }
    set onerror(fn: (err: Event) => void) { this.errorListeners.add(fn); }
    set onopen(fn: () => void) { 
        this.openListeners.add(fn); 
        if (this.readyState === 1) fn(); 
    }

    send(data: string | object) {
        if (this.readyState !== 1) return;
        const parsed = typeof data === 'string' ? data : JSON.stringify(data);
        this.ws!.send(this.createPublish(parsed));
    }

    close() {
        this.readyState = 3;
        try { this.ws?.close(); } catch (e) {}
        this.closeListeners.forEach(fn => fn());
    }
}
