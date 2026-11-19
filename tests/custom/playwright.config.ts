import { defineConfig } from '@playwright/test';
// CUSTOM_TEST_PORT — свой порт стенда, когда 5174 занят другой рабочей копией (иначе проверки пошли бы по чужому коду).
const port = Number(process.env.CUSTOM_TEST_PORT ?? 5174);
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  use: { baseURL: `http://127.0.0.1:${port}`, headless: true, launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } },
  webServer: {
    command: 'node ../../node_modules/vite/bin/vite.js --config vite.config.ts',
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI && !process.env.CUSTOM_TEST_PORT
  }
});
