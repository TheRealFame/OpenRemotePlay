import re

with open("packages/orp-client/src/ORPNostrSession.ts", "r") as f:
    code = f.read()

patch = """
            const nostrRelays = [
                'wss://relay.damus.io',
                'wss://nos.lol',
                'wss://relay.nostr.band',
                'wss://relay.snort.social',
                'wss://relay.primal.net',
                'wss://nostr.mom',
                'wss://nostr.wine',
                'wss://relay.nostr.bg',
                'wss://nostr-pub.wellorder.net',
                'wss://nostr.bitcoiner.social'
            ];
"""

code = re.sub(
    r'const nostrRelays = \[\n\s*\'wss://relay\.damus\.io\',\n\s*\'wss://nos\.lol\',\n\s*\'wss://relay\.nostr\.band\',\n\s*\'wss://relay\.snort\.social\'\n\s*\];',
    patch.strip(),
    code
)

with open("packages/orp-client/src/ORPNostrSession.ts", "w") as f:
    f.write(code)

