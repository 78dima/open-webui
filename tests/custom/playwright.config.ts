import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'hello.spec.ts',
  use: { baseURL: 'http://127.0.0.1:5174', headless: true, launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } },
  webServer: {
    command: 'node ../../node_modules/vite/bin/vite.js --config vite.config.ts',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: !process.env.CI
  }
});
