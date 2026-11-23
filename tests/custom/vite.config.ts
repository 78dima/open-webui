import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  publicDir: '../../static',
  plugins: [svelte({ configFile: false })],
  // Build-time globals of the real app config, needed by $lib/constants in the tool status harness.
  define: { APP_VERSION: '"test"', APP_BUILD_HASH: '"test"', APP_BUILD_CHANNEL: '"test"' },
  resolve: { alias: [
    { find: '$lib/stores', replacement: fileURLToPath(new URL('./stores.ts', import.meta.url)) },
    { find: '$app/navigation', replacement: fileURLToPath(new URL('./app-navigation.ts', import.meta.url)) },
    { find: '$app/environment', replacement: fileURLToPath(new URL('./app-environment.ts', import.meta.url)) },
    { find: '$lib', replacement: fileURLToPath(new URL('../../src/lib', import.meta.url)) }
  ] },
  server: { host: '127.0.0.1', port: Number(process.env.CUSTOM_TEST_PORT ?? 5174), strictPort: true, fs: { allow: ['../..'] } }
});
