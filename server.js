const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = 3001;

app.use(express.static(path.join(__dirname, 'public')));

// Very basic signaling logic: broadcast every message to everyone else.
// In a real production environment, you would use session IDs.
wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(message.toString());
            }
        });
    });
});

server.listen(PORT, () => {
    console.log(`[ORP WebCodecs Demo] Running on http://localhost:${PORT}`);
    console.log(`Open http://localhost:3001/host.html to start the stream.`);
    console.log(`Open http://localhost:3001/viewer.html to watch it.`);
});
