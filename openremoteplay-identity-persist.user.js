// ==UserScript==
// @name         OpenRemotePlay Identity Persist
// @namespace    https://github.com/TheRealFame/OpenRemotePlay
// @version      2.0.0
// @description  Persists ORP identity (ECDSA keypair, display name, controller binds, deadzones) across all ORP-compatible host websites. Also registers the web+orp:// protocol handler.
// @updateURL    https://github.com/TheRealFame/OpenRemotePlay/raw/refs/heads/main/openremoteplay-identity-persist.user.js
// @downloadURL  https://github.com/TheRealFame/OpenRemotePlay/raw/refs/heads/main/openremoteplay-identity-persist.user.js
// @author       OpenRemotePlay Community
// @match        *://*/*
// @icon         https://github.com/TheRealFame.png
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @run-at       document-start
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    const PREFIX = 'orp_';
    const ORP_VERSION = 2;

    // ── Storage helpers ───────────────────────────────────────────────────────

    function orpGet(key, def = null) {
        return GM_getValue(PREFIX + key, def);
    }

    function orpSet(key, val) {
        GM_setValue(PREFIX + key, val);
        try { localStorage.setItem(PREFIX + key, typeof val === 'object' ? JSON.stringify(val) : val); } catch (_) {}
    }

    function orpDel(key) {
        GM_deleteValue(PREFIX + key);
        try { localStorage.removeItem(PREFIX + key); } catch (_) {}
    }

    // ── Cryptographic Identity (ORP-SPEC §7) ──────────────────────────────────
    //
    // On first launch, generate an ECDSA P-256 keypair.
    // The viewerId is derived as the first 32 chars of SHA-256(publicKeyJWK).
    // The private key is stored in GM storage (persisted across origins).
    // The identity is injected into window.ORP_IDENTITY for host pages to read.

    async function initIdentity() {
        let pubJwk  = orpGet('pub_jwk');
        let privJwk = orpGet('priv_jwk');
        let viewerId = orpGet('viewer_id');

        if (!pubJwk || !privJwk || !viewerId) {
            try {
                const keyPair = await crypto.subtle.generateKey(
                    { name: 'ECDSA', namedCurve: 'P-256' },
                    true, // extractable
                    ['sign', 'verify']
                );
                const pub  = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
                const priv = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

                // Derive viewerId from hash of public key
                const pubStr = JSON.stringify(pub, Object.keys(pub).sort());
                const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pubStr));
                const hashHex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,'0')).join('');
                viewerId = hashHex.slice(0, 32);

                orpSet('pub_jwk',   JSON.stringify(pub));
                orpSet('priv_jwk',  JSON.stringify(priv));
                orpSet('viewer_id', viewerId);
                pubJwk  = JSON.stringify(pub);
                privJwk = JSON.stringify(priv);
            } catch (e) {
                console.warn('[ORP] Failed to generate ECDSA keypair:', e);
                // Fallback: UUID-based (no cryptographic guarantees)
                viewerId = orpGet('viewer_id') || crypto.randomUUID().replace(/-/g, '').slice(0, 32);
                orpSet('viewer_id', viewerId);
            }
        }

        // Expose identity to host page (read-only, injected before page scripts run)
        const identity = {
            viewerId,
            displayName: orpGet('name', 'Player'),
            version: ORP_VERSION,
            publicKey: pubJwk ? JSON.parse(pubJwk) : null,
        };
        Object.defineProperty(window, 'ORP_IDENTITY', { value: identity, writable: false, configurable: false });

        return { viewerId, pubJwk, privJwk };
    }

    // ── Sign a handshake token (for host-page use) ────────────────────────────

    async function signToken(token, privJwkStr) {
        if (!privJwkStr) return null;
        try {
            const privJwk = JSON.parse(privJwkStr);
            const privKey = await crypto.subtle.importKey('jwk', privJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
            const sigBuf  = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privKey, new TextEncoder().encode(token));
            return btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
        } catch (e) {
            console.warn('[ORP] signToken failed:', e);
            return null;
        }
    }

    // Expose sign function to host page
    window.ORP_SIGN = signToken;

    // ── web+orp:// Protocol Handler Registration ───────────────────────────────
    //
    // ORP-SPEC §8: web clients must register web+orp:// so links open the client.
    // We register pointing back to the current page (or the ORP web client URL).

    function registerProtocolHandler() {
        try {
            const orpClientUrl = orpGet('protocol_handler_url', '%s');
            if (navigator.registerProtocolHandler) {
                navigator.registerProtocolHandler('web+orp', orpClientUrl, 'OpenRemotePlay');
                console.log('[ORP] Registered web+orp:// protocol handler →', orpClientUrl);
            }
        } catch (e) {
            // Silently ignore — browsers may restrict to specific origins
        }
    }

    // ── LocalStorage ↔ GM Storage sync ───────────────────────────────────────

    const memCache = {};

    function syncToPage() {
        const savedKeys = GM_listValues();
        for (const key of savedKeys) {
            const val = GM_getValue(key);
            if (memCache[key] !== val) {
                try { localStorage.setItem(key, val); } catch (_) {}
                memCache[key] = val;
            }
        }
    }

    function syncFromPage() {
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(PREFIX)) {
                    const val = localStorage.getItem(key);
                    if (memCache[key] !== val) {
                        GM_setValue(key, val);
                        memCache[key] = val;
                    }
                }
            }
        } catch (_) {}
    }

    // ── Settings Modal ────────────────────────────────────────────────────────

    if (typeof GM_registerMenuCommand !== 'undefined') {
        GM_registerMenuCommand('⚙️ Configure OpenRemotePlay', openSettingsModal);
        GM_registerMenuCommand('🔑 Show My ORP Identity', showIdentityModal);
        GM_registerMenuCommand('🗑️ Reset ORP Identity', async () => {
            if (confirm('Reset your ORP cryptographic identity? This cannot be undone.')) {
                orpDel('pub_jwk');
                orpDel('priv_jwk');
                orpDel('viewer_id');
                GM_notification({ title: 'ORP Identity Reset', text: 'Reload the page to generate a new identity.', timeout: 4000 });
            }
        });
    }

    function getV(k, def) { return orpGet(k, def); }

    function openSettingsModal() {
        if (document.getElementById('orp-settings-modal')) return;

        const style = document.createElement('style');
        style.textContent = `
            #orp-settings-modal {
                position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                background: rgba(0,0,0,0.85); z-index: 2147483647;
                display: flex; justify-content: center; align-items: center;
                font-family: 'Segoe UI', system-ui, sans-serif; backdrop-filter: blur(4px);
            }
            .orp-box {
                background: #0f0f13; color: #e8e8f0; width: 380px;
                border-radius: 16px; padding: 24px;
                border: 1px solid rgba(168,85,247,0.3);
                box-shadow: 0 0 40px rgba(168,85,247,0.15);
            }
            .orp-box h3 { margin: 0 0 20px 0; font-size: 16px; color: #c084fc; letter-spacing: 0.05em; }
            .orp-group { margin-bottom: 14px; display: flex; flex-direction: column; gap: 5px; }
            .orp-group label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.08em; }
            .orp-group input, .orp-group select {
                background: #1a1a23; border: 1px solid #333; color: #e8e8f0;
                padding: 9px 12px; border-radius: 8px; font-size: 14px; outline: none;
                transition: border-color 0.2s;
            }
            .orp-group input:focus, .orp-group select:focus { border-color: #c084fc; }
            .orp-row { display: flex; gap: 10px; }
            .orp-row .orp-group { flex: 1; }
            .orp-divider { border: none; border-top: 1px solid #222; margin: 16px 0; }
            .orp-btn {
                background: linear-gradient(135deg, #7c3aed, #c084fc);
                color: #fff; border: none; width: 100%;
                padding: 12px; border-radius: 10px; font-weight: 600;
                font-size: 14px; cursor: pointer; letter-spacing: 0.05em;
                transition: opacity 0.2s;
            }
            .orp-btn:hover { opacity: 0.85; }
            .orp-version { font-size: 11px; color: #444; text-align: center; margin-top: 12px; }
        `;
        document.head.appendChild(style);

        const modal = document.createElement('div');
        modal.id = 'orp-settings-modal';
        modal.innerHTML = `
            <div class="orp-box">
                <h3>⚡ OpenRemotePlay Settings</h3>

                <div class="orp-group">
                    <label>Display Name</label>
                    <input type="text" id="orp_name" value="${getV('name', '')}" placeholder="Player 1">
                </div>

                <div class="orp-row">
                    <div class="orp-group">
                        <label>Deadzone</label>
                        <input type="number" id="orp_dz" step="0.01" min="0" max="0.5" value="${getV('deadzone', '0.05')}">
                    </div>
                    <div class="orp-group">
                        <label>Input Mode</label>
                        <select id="orp_mode">
                            <option value="gamepad" ${getV('input_mode', 'gamepad') === 'gamepad' ? 'selected' : ''}>Controller</option>
                            <option value="kbm_emulated" ${getV('input_mode', '') === 'kbm_emulated' ? 'selected' : ''}>KBM Emulated</option>
                            <option value="hybrid" ${getV('input_mode', '') === 'hybrid' ? 'selected' : ''}>Hybrid</option>
                        </select>
                    </div>
                </div>

                <hr class="orp-divider">
                <div class="orp-group">
                    <label>web+orp:// Handler URL (leave blank for default)</label>
                    <input type="text" id="orp_handler_url" value="${getV('protocol_handler_url', '')}" placeholder="https://.../?target=%s">
                </div>

                <button class="orp-btn" id="orp_save">Save & Close</button>
                <div class="orp-version">ORP v${ORP_VERSION} Identity Persist</div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

        document.getElementById('orp_save').addEventListener('click', () => {
            const name = document.getElementById('orp_name').value.trim();
            const dz   = document.getElementById('orp_dz').value;
            const mode = document.getElementById('orp_mode').value;
            const handlerUrl = document.getElementById('orp_handler_url').value.trim();

            orpSet('name', name);
            orpSet('deadzone', dz);
            orpSet('input_mode', mode);
            if (handlerUrl) orpSet('protocol_handler_url', handlerUrl);

            // Update exposed identity
            if (window.ORP_IDENTITY) window.ORP_IDENTITY.displayName = name;

            registerProtocolHandler();
            closeModal();
        });

        function closeModal() {
            modal.remove();
            style.remove();
        }
    }

    function showIdentityModal() {
        const id = orpGet('viewer_id', 'Not generated yet');
        const pubJwk = orpGet('pub_jwk');
        let pubSummary = '—';
        if (pubJwk) {
            try { const j = JSON.parse(pubJwk); pubSummary = `${j.crv}: x=${j.x?.slice(0,8)}...`; } catch (_) {}
        }
        const msg = `ViewerID: ${id}\nPublic Key: ${pubSummary}\nDisplay Name: ${orpGet('name', '(not set)')}`;
        alert(msg);
    }

    // ── Bootstrap ─────────────────────────────────────────────────────────────

    async function boot() {
        // Inject identity before page scripts load
        const { privJwk } = await initIdentity();

        // Allow host pages to call ORP_SIGN(token) → base64 signature
        window.ORP_SIGN = (token) => signToken(token, privJwk);

        // Register web+orp:// protocol handler (safe to call silently)
        window.addEventListener('DOMContentLoaded', () => {
            registerProtocolHandler();
            syncToPage();
        }, { once: true });

        // Bidirectional sync every 250ms
        setInterval(() => {
            syncToPage();
            syncFromPage();
        }, 250);
    }

    boot().catch(e => console.warn('[ORP Identity Persist] boot error:', e));

})();
