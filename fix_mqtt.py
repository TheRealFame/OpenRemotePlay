import re

with open("packages/orp-client/src/ORPNostrSession.ts", "r") as f:
    code = f.read()

# Add import
import_target = "import { joinRoom as joinNostr } from '@trystero-p2p/nostr';"
import_replacement = """import { joinRoom as joinNostr } from '@trystero-p2p/nostr';
import { joinRoom as joinMQTT } from '@trystero-p2p/mqtt';"""

if import_target in code:
    code = code.replace(import_target, import_replacement)

# Add MQTT strategy
mqtt_target = """        // 2. Setup Nostr Racing (Decentralized Relays)"""
mqtt_replacement = """        // 2. Setup MQTT Racing (Ultra-fast WebSocket Broker)
        try {
            console.log(`[ORP] Initializing MQTT Broker fallback...`);
            const mqttRoom = joinMQTT({ ...config, brokerUrls: [
                'wss://test.mosquitto.org:8081',
                'wss://broker.emqx.io:8083/mqtt'
            ] }, roomCode);
            session.attachRoom(mqttRoom, 'MQTT');
        } catch (e) {
            console.warn(`[ORP] MQTT strategy failed.`);
        }

        // 3. Setup Nostr Racing (Decentralized Relays)"""

if mqtt_target in code:
    code = code.replace(mqtt_target, mqtt_replacement)

with open("packages/orp-client/src/ORPNostrSession.ts", "w") as f:
    f.write(code)
print("Success")
