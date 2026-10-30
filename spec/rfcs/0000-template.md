# ORP RFC: [Title of Proposed Extension or Feature]

- **RFC Number:** [Assigned upon PR approval, e.g. 0001]
- **Author(s):** [Your Name or GitHub Handle]
- **Status:** Draft <!-- Draft | In Review | Accepted | Final | Superseded -->
- **Protocol Version:** ORP v2
- **Created:** YYYY-MM-DD
- **Target Capability Tag:** `ext:[name]` (e.g. `ext:rumble`, `ext:analog-triggers`)

---

## 1. Summary

Provide a short 2–3 paragraph explanation of the feature or protocol extension. What capability does it add, and why should it be standardized across all ORP hosts and clients?

---

## 2. Motivation

Explain the problem this RFC solves:
- What use case cannot currently be achieved with the existing ORP v2 specification?
- Which platforms, game engines, or input devices benefit from this?
- What are the consequences of not adopting this standard (e.g. fragmented custom client implementations)?

---

## 3. Wire Format Specification

Define the exact wire format for messages transmitted over the signaling channel or `orp-input` / `orp-video` data channels.

### 3.1 Message Schema

```json
{
  "type": "my-extension-type",
  "viewerId": "uuid-string",
  "padIndex": 0,
  "exampleField": 123
}
```

### 3.2 JSON Schema Reference

Every new payload MUST provide a corresponding JSON Schema in `spec/schemas/[name].schema.json`.

---

## 4. Capability Negotiation

Explain how peers negotiate support for this extension during the connection handshake:
- **Manifest Declaration:** How is the capability listed in `features` (e.g. `ext:my-feature`)?
- **Handshake Behavior:** What happens if the host supports this extension but the viewer does not (and vice-versa)?
- **Fallback / Graceful Degradation:** How do older or non-supporting peers handle encountering this message type? (Standard rule: unrecognized `ext:*` messages must be silently discarded).

---

## 5. Security & Trust Considerations

Analyze potential abuse vectors per `spec/ORP_TRUST_MODEL.md`:
- Can this payload be used to trigger memory bloat, CPU starvation, or injection on the host?
- Does it leak private peer information or cross origin boundaries?
- Are all numeric inputs bounded with explicit minimum and maximum constraints?

---

## 6. Reference Implementation & Test Vectors

Provide concrete test vectors that will be added to `test/schemas.test.mjs` and the conformance suite:

### Valid Example:
```json
{
  "type": "my-extension-type",
  "viewerId": "test-viewer",
  "padIndex": 0
}
```

### Invalid Example (Must be rejected):
```json
{
  "type": "my-extension-type",
  "padIndex": -1
}
```

---

## 7. Drawbacks & Alternatives

- What are the costs of implementing this (code complexity, packet overhead)?
- What alternative designs were considered? Why were they rejected?
- Does this require any breaking changes to existing `core:*` messages?
