import { test, expect } from '@playwright/test';
import {
	HIDE_KEYS,
	LEGAL_MODELS,
	hideFor,
	hideSetting,
	modelVisible
} from '../../src/lib/custom/visibility';
const hide = Object.fromEntries(HIDE_KEYS.map((key) => [key, true]));
test('visibility is user-only, strict and per-feature; Arena independent of the legal allowlist', () => {
	for (const role of ['admin', 'pending', undefined])
		expect(hideFor({ hide }, role, 'models')).toBe(false);
	expect(hideFor({ hide: { models: 'true' } }, 'user', 'models')).toBe(false);
	expect(modelVisible({ id: 'other' }, { hide: { arena: true } }, 'user')).toBe(true);
	expect(modelVisible({ id: 'random', owned_by: 'arena' }, { hide: { arena: true } }, 'user')).toBe(
		false
	);
	expect(
		hideSetting('settings.personal.interface.temporaryChatByDefault.label', { hide }, 'user')
	).toBe(true);
	expect(
		hideSetting('settings.personal.interface.temporaryChatByDefault.label', { hide }, 'admin')
	).toBe(false);
});
test('user sees seven legal models and relevant workspace only; admin and disabled flags restore controls', async ({
	page
}) => {
	await page.goto('/?visibility');
	await page.waitForFunction(() => typeof (window as any).setUser === 'function');
	await page.evaluate(
		({ hide, ids }) => {
			(window as any).setModels([
				...ids.map((id) => ({ id })),
				{ id: 'unrelated' },
				{ id: 'random', owned_by: 'arena' }
			]);
			(window as any).setConfig({ custom_ui: { hide } });
			(window as any).setUser({ role: 'user' });
		},
		{ hide, ids: [...LEGAL_MODELS] }
	);
	for (const name of ['Tools', 'Functions', 'Prompts'])
		await expect(page.getByRole('link', { name, exact: true })).toBeHidden();
	for (const name of ['Knowledge', 'Skills'])
		await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
	for (const name of ['Temporary chat', 'Audio settings', 'Images', 'Interpreter'])
		await expect(page.getByRole('button', { name, exact: true })).toBeHidden();
	await expect(page.getByRole('listitem')).toHaveText([...LEGAL_MODELS]);
	await page.evaluate(() => (window as any).setUser({ role: 'admin' }));
	for (const name of ['Tools', 'Functions', 'Prompts'])
		await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
	for (const name of ['Temporary chat', 'Audio settings', 'Images', 'Interpreter'])
		await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
	await expect(page.getByRole('listitem')).toHaveCount(9);
	await page.evaluate(() => {
		(window as any).setUser({ role: 'user' });
		(window as any).setConfig({ custom_ui: {} });
	});
	await expect(page.getByRole('link', { name: 'Tools', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Audio settings' })).toBeVisible();
	await expect(page.getByRole('listitem')).toHaveCount(9);
});
