const express = require('express');
const path = require('path');

const app = express();
const PORT = 3001;

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
    console.log(`[ORP Reference Client] Running on http://localhost:${PORT}`);
    console.log(`Open http://localhost:3001/?host=ws://localhost:3000/ws/signaling in your browser.`);
});
