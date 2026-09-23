export declare class ORPMqttSession {
    private messageListeners;
    private closeListeners;
    private errorListeners;
    private openListeners;
    readyState: number;
    private ws;
    private topic;
    private clientId;
    private constructor();
    static create(roomCode: string, _iceServers?: any[]): Promise<ORPMqttSession>;
    private encodeLength;
    private decodeLength;
    private encodeString;
    private createConnect;
    private createSubscribe;
    private createPublish;
    private decodePublish;
    addEventListener(type: string, listener: any): void;
    removeEventListener(type: string, listener: any): void;
    set onmessage(fn: (ev: MessageEvent) => void);
    set onclose(fn: () => void);
    set onerror(fn: (err: Event) => void);
    set onopen(fn: () => void);
    send(data: string | object): void;
    close(): void;
}
