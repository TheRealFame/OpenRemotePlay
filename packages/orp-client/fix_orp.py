import re

# 1. Fix ORPClient.ts (Remove PoW)
with open("src/ORPClient.ts", "r") as f:
    client_code = f.read()

# Strip out the pow-challenge block
client_code = re.sub(r'if \(\(msg as any\)\.type === \'pow-challenge\'\) \{.*?(if \(\(msg as any\)\.type === \'error\'\))', r'\1', client_code, flags=re.DOTALL)
with open("src/ORPClient.ts", "w") as f:
    f.write(client_code)


# 2. Fix ORPHostSession.ts (Remove PoW, add _ws, add renegotiate, add target to offer)
with open("src/ORPHostSession.ts", "r") as f:
    host_code = f.read()

# Add _ws
host_code = host_code.replace("private viewers: Map<string, ORPViewer> = new Map();", "private viewers: Map<string, ORPViewer> = new Map();\n    private _ws?: WebSocket;")
host_code = host_code.replace("handleSignalingSocket(ws: WebSocket): void {", "handleSignalingSocket(ws: WebSocket): void {\n        this._ws = ws;")

# Strip out the broken PoW challenge logic
host_code = re.sub(r'let powVerified = false;.*?const processMessage', 'const processMessage', host_code, flags=re.DOTALL)
host_code = re.sub(r'ws\.addEventListener\(\'message\', \(ev\) => \{.*?if \(\!powVerified\) \{.*?\} else \{.*?(processMessage\(msg\);)\s*\}\s*\}\);', r"ws.addEventListener('message', async (ev) => {\n            let msg: any;\n            try { msg = JSON.parse(ev.data as string); } catch { return; }\n            \1\n        });", host_code, flags=re.DOTALL)

# Add renegotiate method
reneg_method = """
    public async renegotiate(senderId: string): Promise<void> {
        const viewer = this.viewers.get(senderId);
        if (!viewer || !this._ws) return;
        const offer = await viewer.pc.createOffer();
        await viewer.pc.setLocalDescription(offer);
        const offerEnv = await signEnvelope({
            v: 2, type: 'offer', senderId: 'host', sdp: offer.sdp!, ts: Date.now(), topology: 'mesh', target: senderId
        } as any, this.pin);
        this._ws.send(JSON.stringify(offerEnv));
    }
"""
host_code = host_code.replace("private _removeViewer(senderId: string): void {", reneg_method.strip() + "\n\n    private _removeViewer(senderId: string): void {")

# Ensure initial offer targets senderId
host_code = re.sub(
    r'v: 2, type: \'offer\', senderId: \'host\', sdp: offer\.sdp!, ts: Date\.now\(\), topology: \'mesh\',',
    r'v: 2, type: \'offer\', senderId: \'host\', target: senderId, sdp: offer.sdp!, ts: Date.now(), topology: \'mesh\',',
    host_code
)
# We cast to any in signEnvelope so TS doesn't complain about 'target'
host_code = host_code.replace("}, this.pin);", "} as any, this.pin);")

with open("src/ORPHostSession.ts", "w") as f:
    f.write(host_code)

