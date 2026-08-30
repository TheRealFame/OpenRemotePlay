export interface ORPClientOptions {
    signalingUrl: string;
    displayName: string;
    color?: string;
    viewerId?: string;
}
export interface GamepadPayload {
    type: 'gamepad';
    viewerId: string;
    pad_id: string;
    padIndex: number;
    axes: number[];
    buttons: {
        pressed: boolean;
        value: number;
    }[];
}
export interface KeyboardPayload {
    type: 'keyboard';
    viewerId: string;
    event: 'keydown' | 'keyup' | 'mousemove' | 'mousedown' | 'mouseup';
    key?: string;
    dx?: number;
    dy?: number;
    button?: number;
}
export interface WebHIDPayload {
    type: 'webhid';
    vid: number;
    pid: number;
    buffer: string;
}
