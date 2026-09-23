import re

with open("packages/orp-client/src/ORPNostrSession.ts", "r") as f:
    code = f.read()

target = """                'wss://relay.primal.net',
                'wss://nostr.mom',
                'wss://nostr.wine',
                'wss://relay.nostr.bg',
                'wss://nostr-pub.wellorder.net',
                'wss://nostr.bitcoiner.social'"""

replacement = """                'wss://relay.primal.net',
                'wss://nostr.mom',
                'wss://nostr-pub.wellorder.net',
                'wss://nostr.bitcoiner.social',
                'wss://nos.lol',
                'wss://relay.current.fyi',
                'wss://nostr.zebedee.cloud',
                'wss://relay.nostr.info',
                'wss://nostr.oxtr.dev',
                'wss://nostr.fmt.wiz.biz'"""

if target in code:
    code = code.replace(target, replacement)
    with open("packages/orp-client/src/ORPNostrSession.ts", "w") as f:
        f.write(code)
    print("Success")
else:
    print("Failed")
