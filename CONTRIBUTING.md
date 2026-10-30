# Contributing to Open Remote Play (ORP)

Thank you for your interest in contributing to Open Remote Play (ORP). ORP is an open, vendor-neutral standard for low-latency peer-to-peer remote play and controller virtualization.

We welcome pull requests from developers building clients, hosts, game engine adapters, or protocol extensions.

---

## 1. Guiding Principles

1. **Backwards Compatibility:** Changes to the protocol MUST NOT break existing compliant clients or hosts. Core message modifications require a major version bump (`v: 3`).
2. **Extensibility via Namespaces:** New features and non-universal capabilities MUST be proposed as optional extensions (`ext:*`), allowing older implementations to safely ignore them without disconnecting.
3. **Machine-Readable Schemas:** Every new payload or envelope field MUST be backed by a formal JSON Schema in `spec/schemas/` and accompanied by automated tests in `test/schemas.test.mjs`.
4. **Performance & Low Latency:** ORP is designed for real-time interactive game streaming. Proposals that add significant packet serialization overhead or require heavy centralized infrastructure are discouraged.

---

## 2. How to Propose a Protocol Extension (RFC Process)

If you want to add a new capability (e.g. pressure-sensitive buttons, VR tracking, analog triggers, voice chat):

1. **Copy the RFC Template:**
   Copy [`spec/rfcs/0000-template.md`](spec/rfcs/0000-template.md) to `spec/rfcs/000X-[feature-name].md`.
2. **Draft the Specification:**
   - Define the capability tag (e.g. `ext:my-feature`).
   - Define the exact JSON wire format and direction (Host $\to$ Viewer or Viewer $\to$ Host).
   - Document error and fallback handling for peers that do not support the extension.
3. **Create the JSON Schema:**
   Add a new schema file in `spec/schemas/[feature-name].schema.json` following JSON Schema Draft 2020-12.
4. **Add Test Vectors:**
   Add valid and invalid test fixtures to [`test/schemas.test.mjs`](test/schemas.test.mjs).
5. **Open a Pull Request:**
   Submit your PR with the title `rfc: [Extension Name]`. Discussion and review will take place on GitHub.

---

## 3. Developing and Testing Locally

### Prerequisites
- Node.js v18 or later
- npm v9 or later

### Setup
```bash
git clone https://github.com/TheRealFame/OpenRemotePlay.git
cd OpenRemotePlay
npm install
```

### Running Tests
Before submitting any pull request, ensure all test suites pass:

```bash
# Run both the signaling smoke tests and the schema validation suite
npm test

# Run individual test suites
npm run test:smoke
npm run test:schemas
```

### Building the TypeScript Client
If you modified files in `packages/orp-client/`:
```bash
npm run build
```

---

## 4. Pull Request Checklist

Before submitting your PR, verify:
- [ ] Schema files in `spec/schemas/` validate cleanly with `npm run test:schemas`.
- [ ] All smoke tests pass (`npm run test:smoke`).
- [ ] TypeScript builds without errors or warnings (`npm run build`).
- [ ] No proprietary, copyrighted, or GPL-licensed code has been introduced (ORP is strictly MIT-licensed).
- [ ] Commit titles follow the standard format: `feat(...)`, `fix(...)`, `docs(...)`, or `rfc(...)`.
- [ ] No emojis are used in code, comments, or documentation.
