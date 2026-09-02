/**
 * ORP v2 UMD bundle builder.
 * Run after tsc: `node build-bundle.mjs`
 * Output: dist/orp-client.bundle.js — browser-ready IIFE global `ORP`
 */
import { build } from 'esbuild';

await build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'ORP',
    outfile: 'dist/orp-client.bundle.js',
    target: ['es2020', 'chrome90', 'firefox90', 'safari15'],
    minify: false,
    sourcemap: true,
    tsconfig: './tsconfig.json',
    // Mark Node built-ins as external. The Node `crypto` path is dead code in
    // browsers (guarded by `typeof crypto !== 'undefined' && crypto.subtle`),
    // but esbuild still resolves statically. By marking it external, the
    // generated bundle does `require('crypto')` which is overridden by the
    // banner shim below to return a no-op.
    external: ['crypto'],
    banner: {
        js: `/* OpenRemotePlay (ORP) v2 — MIT License — https://github.com/TheRealFame/OpenRemotePlay */
// Shim Node's require() for dead-code Node-only fallback paths in browser bundle
var require = typeof require !== 'undefined' ? require : function(id) {
  if (id === 'crypto') return {}; // SubtleCrypto branch always wins in modern browsers
  throw new Error('[ORP] require() is not supported in browser: ' + id);
};`
    },
});

console.log('[ORP] Bundle written to dist/orp-client.bundle.js');
