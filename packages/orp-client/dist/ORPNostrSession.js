"use strict";
/**
 * OpenRemotePlay (ORP) Protocol v2 — Nostr / BitTorrent / MQTT Signaling
 *
 * Spec reference: spec/ORP_SPEC.md §1.1
 *
 * This file wraps Trystero to provide a multi-protocol racing signaling channel.
 * It exposes a mock WebSocket interface that ORPClient and ORPHostSession can use.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ORPNostrSession = void 0;
// @ts-ignore
const torrent_1 = require("@trystero-p2p/torrent");
// @ts-ignore
const nostr_1 = require("@trystero-p2p/nostr");
const mqtt_1 = require("@trystero-p2p/mqtt");
class ORPNostrSession {
    constructor() {
        this.sendActions = [];
        this.messageListeners = new Set();
        this.closeListeners = new Set();
        this.errorListeners = new Set();
        this.openListeners = new Set();
        this.readyState = 0;
        this.peerIdMap = new Map(); // 0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED
        this.rooms = [];
    }
    /** Create a session racing WebTorrent (dynamic) */
    static async create(roomCode, iceServers) {
        console.log(`[ORP] Initializing P2P Signaling Race for room: ${roomCode}`);
        const session = new ORPNostrSession();
        const config = { appId: 'orp-v2' };
        if (iceServers && iceServers.length > 0) {
            config.rtcConfig = { iceServers };
        }
        // 1. Setup WebTorrent (Dynamic from ngosang, async so it doesn't block MQTT)
        (async () => {
            try {
                console.log(`[ORP] Fetching latest live torrent trackers...`);
                const res = await fetch('https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_all_ws.txt');
                const text = await res.text();
                let torrentTrackers = text.split('\n')
                    .map(t => t.trim())
                    .filter(t => t.startsWith('wss://'));
                if (torrentTrackers.length > 0) {
                    // Randomize and pick top 4
                    torrentTrackers = torrentTrackers.sort(() => 0.5 - Math.random()).slice(0, 4);
                    console.log(`[ORP] Successfully loaded ${torrentTrackers.length} live trackers.`);
                    const torrentRoom = (0, torrent_1.joinRoom)({ ...config, relayConfig: { urls: torrentTrackers } }, roomCode);
                    session.attachRoom(torrentRoom, 'Torrent');
                }
            }
            catch (e) {
                console.warn(`[ORP] Failed to fetch dynamic trackers, Torrent strategy skipped.`);
            }
        })();
        // 2. Setup MQTT Racing (Ultra-fast WebSocket Broker)
        try {
            console.log(`[ORP] Initializing MQTT Broker fallback...`);
            const mqttRoom = (0, mqtt_1.joinRoom)({ ...config, brokerUrls: [
                    'wss://test.mosquitto.org:8081',
                    'wss://broker.emqx.io:8083/mqtt'
                ] }, roomCode);
            session.attachRoom(mqttRoom, 'MQTT');
        }
        catch (e) {
            console.warn(`[ORP] MQTT strategy failed.`);
        }
        // 3. Setup Nostr Racing (Decentralized Relays)
        try {
            console.log(`[ORP] Initializing Nostr Relay fallback...`);
            const nostrRelays = [
                'wss://relay.damus.io',
                'wss://nos.lol',
                'wss://relay.nostr.band',
                'wss://relay.snort.social',
                'wss://relay.primal.net',
                'wss://nostr.mom',
                'wss://nostr-pub.wellorder.net',
                'wss://nostr.bitcoiner.social',
                'wss://nos.lol',
                'wss://relay.current.fyi',
                'wss://nostr.zebedee.cloud',
                'wss://relay.nostr.info',
                'wss://nostr.oxtr.dev',
                'wss://nostr.fmt.wiz.biz'
            ];
            const nostrRoom = (0, nostr_1.joinRoom)({ ...config, relayConfig: { urls: nostrRelays } }, roomCode);
            session.attachRoom(nostrRoom, 'Nostr');
        }
        catch (e) {
            console.warn(`[ORP] Nostr strategy failed.`);
        }
        return session;
    }
    attachRoom(room, name) {
        this.rooms.push(room);
        const action = room.makeAction('orp-signal');
        this.sendActions.push((msg, peerId) => {
            try {
                console.log(`[ORP] 🚀 Sending msg via ${name} to ${peerId || 'broadcast'}`);
                if (peerId)
                    action.send(msg, { target: peerId });
                else
                    action.send(msg); // broadcast
            }
            catch (e) {
                console.warn(`[ORP] Failed to send via ${name}:`, e);
            }
        });
        room.onPeerJoin = (peerId) => {
            console.log(`[ORP] 🟢 Peer ${peerId} discovered via ${name}!`);
            if (this.readyState === 0) {
                this.readyState = 1;
                this.openListeners.forEach(fn => fn());
            }
        };
        action.onMessage = (data, meta) => {
            if (data && data.senderId) {
                this.peerIdMap.set(data.senderId, meta.peerId);
            }
            console.log(`[ORP] 📩 Received msg from ${meta.peerId} via ${name}`);
            const rawData = typeof data === 'string' ? data : JSON.stringify(data);
            const ev = new MessageEvent('message', { data: rawData });
            this.messageListeners.forEach(fn => fn(ev));
        };
        room.onPeerLeave = (peerId) => {
            console.log(`[ORP] 🔴 Peer ${peerId} left via ${name}!`);
            this.closeListeners.forEach(fn => fn());
        };
    }
    // Mock WebSocket API
    addEventListener(type, listener) {
        if (type === 'message')
            this.messageListeners.add(listener);
        if (type === 'close')
            this.closeListeners.add(listener);
        if (type === 'error')
            this.errorListeners.add(listener);
        if (type === 'open')
            this.openListeners.add(listener);
    }
    removeEventListener(type, listener) {
        if (type === 'message')
            this.messageListeners.delete(listener);
        if (type === 'close')
            this.closeListeners.delete(listener);
        if (type === 'error')
            this.errorListeners.delete(listener);
        if (type === 'open')
            this.openListeners.delete(listener);
    }
    // Setters for direct assignment (ws.onmessage = ...)
    set onmessage(fn) { this.messageListeners.add(fn); }
    set onclose(fn) { this.closeListeners.add(fn); }
    set onerror(fn) { this.errorListeners.add(fn); }
    set onopen(fn) {
        this.openListeners.add(fn);
        if (this.readyState === 1)
            fn();
    }
    send(data) {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        let target = parsed.target || parsed.to_peer_id || parsed.to;
        if (target && this.peerIdMap.has(target)) {
            target = this.peerIdMap.get(target);
        }
        this.sendActions.forEach(send => {
            try {
                if (target) {
                    console.log(`[ORP] 🚀 Sending msg to mapped target: ${target}`);
                    send(parsed, target);
                }
                else {
                    console.log(`[ORP] 🚀 Sending msg to broadcast`);
                    send(parsed);
                }
            }
            catch (e) { }
        });
    }
    close() {
        this.readyState = 3;
        this.rooms.forEach(r => {
            try {
                r.leave();
            }
            catch (e) { }
        });
        this.closeListeners.forEach(fn => fn());
    }
}
exports.ORPNostrSession = ORPNostrSession;
