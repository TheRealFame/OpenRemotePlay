/**
 * OpenRemotePlay (ORP) Protocol v2 — Nostr / BitTorrent / MQTT Signaling
 *
 * Spec reference: spec/ORP_SPEC.md §1.1
 *
 * This file wraps Trystero to provide a multi-protocol racing signaling channel.
 * It exposes a mock WebSocket interface that ORPClient and ORPHostSession can use.
 */
export declare class ORPNostrSession {
    private sendActions;
    private messageListeners;
    private closeListeners;
    private errorListeners;
    private openListeners;
    readyState: number;
    peerIdMap: Map<string, string>;
    private rooms;
    private constructor();
    /** Create a session racing WebTorrent (dynamic) */
    static create(roomCode: string, iceServers?: any[]): Promise<ORPNostrSession>;
    private attachRoom;
    addEventListener(type: string, listener: any): void;
    removeEventListener(type: string, listener: any): void;
    set onmessage(fn: (ev: MessageEvent) => void);
    set onclose(fn: () => void);
    set onerror(fn: (err: Event) => void);
    set onopen(fn: () => void);
    send(data: string | object): void;
    close(): void;
}
