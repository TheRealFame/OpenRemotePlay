// ==UserScript==
// @name         OpenRemotePlay Identity Persist
// @namespace    https://github.com/OpenRemotePlay
// @version      1.0.0
// @description  A minimal boilerplate script for persisting client settings (name, controller binds, deadzones) across different host websites using the OpenRemotePlay protocol.
// @author       OpenRemotePlay Community
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_registerMenuCommand
// @run-at       document-start
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // Set a custom prefix for your application's localStorage keys
    const PREFIX = 'orp_';

    function isAppKey(key) {
        return key && key.startsWith(PREFIX);
    }

    // 1. Memory cache to detect which side actually changed
    const memoryCache = {};

    // 2. On page load, immediately inject all saved settings from Tampermonkey into the site's localStorage
    try {
        const savedKeys = GM_listValues();
        for (const key of savedKeys) {
            if (isAppKey(key)) {
                const val = GM_getValue(key);
                localStorage.setItem(key, val);
                memoryCache[key] = val;
            }
        }
    } catch (e) { }

    // 3. Bidirectional sync loop: Keep Tampermonkey storage and LocalStorage in sync
    setInterval(() => {
        try {
            // A. Check if Tampermonkey storage was updated by ANOTHER tab/origin
            const savedKeys = GM_listValues();
            for (const key of savedKeys) {
                if (isAppKey(key)) {
                    const gmVal = GM_getValue(key);
                    if (memoryCache[key] !== gmVal) {
                        localStorage.setItem(key, gmVal);
                        memoryCache[key] = gmVal;
                    }
                }
            }

            // B. Check if THIS tab's localStorage was updated by the user interacting with the UI
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (isAppKey(key)) {
                    const lsVal = localStorage.getItem(key);
                    if (memoryCache[key] !== lsVal) {
                        GM_setValue(key, lsVal);
                        memoryCache[key] = lsVal;
                    }
                }
            }
        } catch (e) { }
    }, 250);

    // ── NATIVE EXTENSION UI ──
    // Minimal UI to allow users to configure global settings from anywhere.
    if (typeof GM_registerMenuCommand !== 'undefined') {
        GM_registerMenuCommand("Configure OpenRemotePlay", openSettingsModal);
    }

    function openSettingsModal() {
        if (document.getElementById('orp-settings-modal')) return;

        const style = document.createElement('style');
        style.textContent = `
            #orp-settings-modal {
                position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                background: rgba(0,0,0,0.8); z-index: 2147483647;
                display: flex; justify-content: center; align-items: center;
                font-family: sans-serif;
            }
            .orp-box {
                background: #111; color: #fff; width: 320px;
                border-radius: 8px; padding: 20px; border: 1px solid #333;
            }
            .orp-group { margin-bottom: 15px; display: flex; flex-direction: column; gap: 5px; }
            .orp-group label { font-size: 13px; color: #ccc; }
            .orp-group input {
                background: #222; border: 1px solid #444; color: #fff;
                padding: 8px; border-radius: 4px;
            }
            .orp-btn {
                background: #4ade80; color: #000; border: none; width: 100%;
                padding: 10px; border-radius: 4px; font-weight: bold; cursor: pointer;
            }
        `;
        document.head.appendChild(style);

        const modal = document.createElement('div');
        modal.id = 'orp-settings-modal';
        
        const getV = (k, def) => GM_getValue(PREFIX + k, def);

        modal.innerHTML = `
            <div class="orp-box">
                <h3 style="margin: 0 0 15px 0;">Global Settings</h3>
                
                <div class="orp-group">
                    <label>Display Name</label>
                    <input type="text" id="orp_name" value="${getV('name', '')}" placeholder="Player 1">
                </div>
                
                <div class="orp-group">
                    <label>Stick Deadzone</label>
                    <input type="number" id="orp_dz" step="0.01" min="0" max="0.5" value="${getV('deadzone', '0.05')}">
                </div>

                <button class="orp-btn" id="orp_close">Save & Close</button>
            </div>
        `;

        document.body.appendChild(modal);

        document.getElementById('orp_close').addEventListener('click', () => {
            const save = (id, key) => {
                const val = document.getElementById(id).value;
                GM_setValue(PREFIX + key, val);
                localStorage.setItem(PREFIX + key, val);
                memoryCache[PREFIX + key] = val;
            };
            
            save('orp_name', 'name');
            save('orp_dz', 'deadzone');

            document.body.removeChild(modal);
            document.head.removeChild(style);
        });
    }

})();
