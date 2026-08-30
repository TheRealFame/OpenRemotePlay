import { ORPClientOptions, GamepadPayload, KeyboardPayload, WebHIDPayload } from './types';
type EventHandler = (...args: any[]) => void;
export declare class ORPClient {
    private options;
    private ws;
    private pc;
    private dc;
    private events;
    viewerId: string;
    constructor(options: ORPClientOptions);
    on(event: string, handler: EventHandler): void;
    private emit;
    connect(): void;
    private handleOffer;
    sendInput(payload: Partial<GamepadPayload | KeyboardPayload | WebHIDPayload>): void;
    private gamepads;
    sendGamepadState(padIndex: number, axes: number[], buttons: {
        pressed: boolean;
        value: number;
    }[]): void;
    releaseGamepad(padId: string): void;
}
export {};
