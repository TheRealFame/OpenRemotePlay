# Open Remote Play (ORP)

This repository serves as the reference implementation and specification for **Open Remote Play (ORP)**, an open WebRTC-based interactive streaming protocol. 

The goal of this project is to allow developers to build their own independent remote-play clients (e.g. mobile apps, alternative web viewers, or custom desktop software) that natively interoperate with compliant ORP hosts like [Nearcade](https://github.com/cutefame/Nearcade).

## Features
- **Client Agnostic:** Any client that implements this standard can connect to any host.
- **Deep Linking:** Uses `openremoteplay://join?url=<host_url>` so users can instantly open their preferred client.
- **Data Channels:** Specifies strict JSON payload structures for 16-bit Gamepad states, KBM events, and Haptic feedback.

## License
This specification and the included example templates are released under the permissive [MIT License](LICENSE), explicitly allowing you to embed, fork, or modify this logic in your own commercial or open-source clients without restriction.

## Local Testing Environment
This package includes a minimal testing server and a highly optimized **WebCodecs-based** HTML client. We intentionally omitted any GPL-licensed code so you can safely use this as a boilerplate for your own projects.

1. Run `npm install`
2. Run `npm start`
3. Open `http://localhost:3001` in your browser. (Append `?host=ws://localhost:3000/ws/signaling` to connect to a local Nearcade host).

The `example-client.html` uses the `VideoDecoder` API to parse and render low-latency binary chunks directly from the WebRTC DataChannel.

## Building a Host?
If you are building an ORP host rather than a client, you can leverage the **Nearcade uinput backend**, which has been released as a standalone npm package. This allows your Node.js server to seamlessly translate the incoming 16-bit ORP telemetry directly into Linux kernel controller events.
