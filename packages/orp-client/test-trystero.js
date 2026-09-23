const { joinRoom } = require('trystero/nostr');

const relays = [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.nostr.band',
    'wss://relay.snort.social',
    'wss://purplepag.es',
    'wss://relay.primal.net',
    'wss://relay.nostr.bg'
];

const config = { appId: 'orp-test-123', relayConfig: { urls: relays } };
console.log("Joining room...");
const room = joinRoom(config, 'test-room-123');

room.onPeerJoin = (peerId) => {
    console.log("Peer joined:", peerId);
};

console.log("Room joined. Waiting 5s for connections...");
setTimeout(() => {
    console.log("Done.");
    process.exit(0);
}, 5000);
