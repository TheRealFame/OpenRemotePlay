/**
 * ORP v2 UMD bundle builder.
 * Run after tsc: `node build-bundle.mjs`
 * Output: dist/orp-client.bundle.js — browser-ready IIFE global `ORP`
 */
import { build } from 'esbuild';

// ESM Bundle for Nearcade Native Import
await build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    outfile: 'dist/orp-client.bundle.js',
    target: ['es2020', 'chrome90', 'firefox90', 'safari15'],
    minify: false,
    sourcemap: true,
    tsconfig: './tsconfig.json',
    external: ['crypto'],
    banner: {
        js: `/* OpenRemotePlay (ORP) v2 — MIT License — ESM Bundle */
var require = typeof require !== 'undefined' ? require : function(id) {
  if (id === 'crypto') return {};
  throw new Error('[ORP] require() is not supported in browser: ' + id);
};`
    },
});

// IIFE Bundle for ORP Standalone Test UI
await build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'ORP',
    outfile: 'dist/orp-client.iife.js',
    target: ['es2020', 'chrome90', 'firefox90', 'safari15'],
    minify: false,
    sourcemap: true,
    tsconfig: './tsconfig.json',
    external: ['crypto'],
    banner: {
        js: `/* OpenRemotePlay (ORP) v2 — MIT License — IIFE Bundle */
var require = typeof require !== 'undefined' ? require : function(id) {
  if (id === 'crypto') return {};
  throw new Error('[ORP] require() is not supported in browser: ' + id);
};`
    },
});

console.log('[ORP] Bundles written to dist/orp-client.bundle.js and dist/orp-client.iife.js');
