import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  publicDir: '../../static',
  define: { APP_VERSION: JSON.stringify('test'), APP_BUILD_HASH: JSON.stringify('test'), APP_BUILD_CHANNEL: JSON.stringify('test') },
  plugins: [svelte({ configFile: false })],
  resolve: { alias: [
    { find: /^\$lib\/stores$/, replacement: fileURLToPath(new URL('./stores.ts', import.meta.url)) },
    { find: '$app/navigation', replacement: fileURLToPath(new URL('./stubs/app-navigation.ts', import.meta.url)) },
    { find: '$app/environment', replacement: fileURLToPath(new URL('./stubs/app-environment.ts', import.meta.url)) },
    { find: '$app/stores', replacement: fileURLToPath(new URL('./stubs/app-stores.ts', import.meta.url)) },
    { find: '$lib', replacement: fileURLToPath(new URL('../../src/lib', import.meta.url)) }
  ] },
  server: { host: '127.0.0.1', port: 5174, strictPort: true, fs: { allow: ['../..'] } }
});
