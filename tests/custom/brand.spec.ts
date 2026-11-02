import { test, expect } from '@playwright/test';
import { brandName, brandTranslations, brandLocale, brandConfig } from '../../src/lib/custom/brand';

test('brand name and locale overrides preserve upstream defaults', () => {
 expect(brandName(undefined, 'Original (Open WebUI)')).toBe('Original (Open WebUI)');
 expect(brandName({brand: {suffix: false}}, 'Original (Open WebUI)')).toBe('Original');
 expect(brandName({brand: {name: 'Ai - dvokat'}})).toBe('Ai - dvokat');
 const originals = {'ru-RU': {'Open WebUI version': 'Оригинал', unrelated: 'Без изменений'}};
 expect(brandTranslations({}, originals)).toBe(originals);
 expect(brandTranslations({brand:{name:'Ai - dvokat'}}, originals)['ru-RU']).toMatchObject({
  'Open WebUI version': 'Версия Ai - dvokat', unrelated: 'Без изменений'
 });
 expect(originals['ru-RU']['Open WebUI version']).toBe('Оригинал');
});

test('brand metadata, icon, About and community links opt in and restore', async ({ page }) => {
 await page.goto('/?brand');
 await page.waitForFunction(() => typeof (window as any).setConfig === 'function');
 await expect(page.getByTestId('upstream-about')).toBeVisible();
 await expect(page.getByRole('link', {name:'Community'})).toBeVisible();
 await page.evaluate(() => (window as any).setConfig({name:'Open WebUI', custom_ui:{brand:{name:'Ai - dvokat',about:true,community:false}}}));
 await expect(page).toHaveTitle('Ai - dvokat');
 await expect(page.getByTestId('brand-logo')).toHaveAttribute('src','/custom/logo.png');
 await expect(page.getByTestId('custom-about')).not.toContainText(/Open\s*WebUI/i);
 await expect(page.getByRole('link',{name:'Лицензии и уведомления об авторских правах'})).toBeVisible();
 await expect(page.getByRole('link', {name:'Community'})).toBeHidden();
 const manifest = await page.evaluate(async () => (await fetch(document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!.href)).json());
 expect(manifest.name).toBe('Ai - dvokat');
 expect(manifest.icons[0].src).toContain('/custom/logo.png');
 await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href','/custom/logo.png');
 expect((await page.request.get('/custom/logo.png')).ok()).toBeTruthy();
 await page.evaluate(() => (window as any).setConfig({name:'Open WebUI',custom_ui:{}}));
 await expect(page).toHaveTitle('Open WebUI');
 await expect(page.getByTestId('custom-about')).toHaveCount(0);
 await expect(page.getByRole('link', {name:'Community'})).toBeVisible();
 await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href','/manifest.json');
 await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href','/static/favicon.png');
});

 test('all loaded locales use the configured brand and promotion stays disabled', () => {
  brandTranslations({brand:{name:'Ai - dvokat'}});
  expect(brandLocale({one:'Open WebUI',two:'OpenWebUI',three:'Настройка Open WebUI'})).toEqual({one:'Ai - dvokat',two:'Ai - dvokat',three:'Настройка Ai - dvokat'});
  const raw={name:'Original',custom_ui:{brand:{name:'Ai - dvokat',community:false}},features:{enable_community_sharing:true,enable_version_update_check:true}};
  expect(brandConfig(raw)).toMatchObject({name:'Ai - dvokat',features:{enable_community_sharing:false,enable_version_update_check:false}});
  expect(raw.name).toBe('Original');
  brandTranslations({});
  expect(brandLocale({one:'Open WebUI'})).toEqual({one:'Open WebUI'});
 });
 test('packaged manifest and search metadata carry only the new product name', async ({page}) => {
  for (const path of ['/static/site.webmanifest','/custom/manifest.webmanifest','/custom/opensearch.xml']) {
   const response=await page.request.get(path);expect(response.ok()).toBeTruthy();
   const body=await response.text();expect(body).toContain('Ai - dvokat');expect(body).not.toMatch(/Open\s*WebUI/i);
  }
 });
