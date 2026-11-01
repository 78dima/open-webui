import { test, expect } from '@playwright/test';

test('hello is opt-in, reacts to configuration and disappears without leftover markup', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof (window as any).setConfig === 'function');
  const hello = page.getByTestId('custom-hello');
  for (const config of [undefined, {}, { custom_ui: {} }, { custom_ui: { hello: false } }, { custom_ui: { hello: 'true' } }]) {
    await page.evaluate(value => (window as any).setConfig(value), config);
    await expect(hello).toHaveCount(0);
  }
  await page.evaluate(() => (window as any).setConfig({ custom_ui: { hello: true } }));
  await expect(hello).toBeVisible();
  await expect(hello).toHaveText('Пример компонента ai-dvokat');
  await page.evaluate(() => (window as any).setConfig({ custom_ui: { hello: false } }));
  await expect(hello).toHaveCount(0);
});
