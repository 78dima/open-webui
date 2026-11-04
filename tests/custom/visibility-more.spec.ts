import { test, expect } from '@playwright/test';
import { HIDE_KEYS, hideFor, hideMenuItem, hideSearchResults } from '../../src/lib/custom/visibility';
import { readCustomUI } from '../../src/lib/custom/config';
import { isControlVisible } from '../../src/lib/utils/ui-visibility';
// B5+: notes, channels and automations are hidden for the user role only (owner, 05.11).
const extra = ['notes', 'channels', 'automations'] as const;
const all = Object.fromEntries(HIDE_KEYS.map((key) => [key, true]));

test('notes, channels and automations flags are strict booleans for the user role only', () => {
	for (const key of extra) {
		expect(HIDE_KEYS).toContain(key);
		expect(readCustomUI({ hide: { [key]: 'true' } })).toEqual({ hide: {} });
		expect(readCustomUI({ hide: { [key]: true } })).toEqual({ hide: { [key]: true } });
		expect(hideFor({ hide: { [key]: true } }, 'user', key)).toBe(true);
		for (const role of ['admin', 'pending', undefined]) expect(hideFor({ hide: all }, role, key)).toBe(false);
		expect(hideFor({ hide: { [key]: false } }, 'user', key)).toBe(false);
		expect(hideFor({}, 'user', key)).toBe(false);
	}
});

test('sidebar menu hides notes and automations, nothing else', () => {
	expect(hideMenuItem('notes', { hide: all }, 'user')).toBe(true);
	expect(hideMenuItem('automations', { hide: all }, 'user')).toBe(true);
	for (const id of ['workspace', 'calendar', 'playground', 'channels', undefined])
		expect(hideMenuItem(id, { hide: all }, 'user')).toBe(false);
	expect(hideMenuItem('notes', { hide: all }, 'admin')).toBe(false);
	expect(hideMenuItem('notes', { hide: { automations: true } }, 'user')).toBe(false);
});

test('upstream isControlVisible hides Attach Notes for users when notes are hidden', () => {
	const config = (hide: Record<string, boolean>): any => ({ custom_ui: { hide } });
	expect(isControlVisible('chat.attach_notes', { user: { role: 'user' }, config: config({ notes: true }) })).toBe(false);
	expect(isControlVisible('chat.attach_notes', { user: { role: 'admin' }, config: config({ notes: true }) })).toBe(true);
	expect(isControlVisible('chat.attach_notes', { user: { role: 'user' }, config: config({}) })).toBe(true);
	expect(isControlVisible('chat.attach_files', { user: { role: 'user' }, config: config({ notes: true }) })).toBe(true);
	// The admin's own visibility setting still applies.
	expect(isControlVisible('chat.attach_notes', { user: { role: 'user' }, config: { ui: { visibility: { 'chat.attach_notes': false } } } })).toBe(false);
});

test('global search drops notes and channel messages for users', () => {
	const response = () => ({
		items: [{ kind: 'chat' }, { kind: 'note' }, { kind: 'message' }],
		kinds: ['chat', 'message', 'note'],
		scopes: [{ kind: 'folder' }, { kind: 'channel' }],
		has_more: false
	});
	expect(hideSearchResults(response(), { hide: { notes: true } }, 'user')).toEqual({
		items: [{ kind: 'chat' }, { kind: 'message' }], kinds: ['chat', 'message'],
		scopes: [{ kind: 'folder' }, { kind: 'channel' }], has_more: false
	});
	expect(hideSearchResults(response(), { hide: { channels: true } }, 'user')).toEqual({
		items: [{ kind: 'chat' }, { kind: 'note' }], kinds: ['chat', 'note'], scopes: [{ kind: 'folder' }], has_more: false
	});
	expect(hideSearchResults(response(), { hide: all }, 'admin')).toEqual(response());
	expect(hideSearchResults(response(), {}, 'user')).toEqual(response());
});

test('user menu rows for notes and automations are hidden for users and back for admin', async ({ page }) => {
	await page.goto('/?visibility');
	await page.waitForFunction(() => typeof (window as any).setUser === 'function');
	await page.evaluate((hide) => {
		(window as any).setConfig({ custom_ui: { hide } });
		(window as any).setUser({ role: 'user' });
	}, all);
	for (const name of ['Notes', 'Pin notes', 'Automations', 'Pin automations'])
		await expect(page.getByText(name, { exact: true })).toBeHidden();
	await expect(page.getByRole('menuitem', { name: 'Workspace' })).toBeVisible();
	await page.evaluate(() => (window as any).setUser({ role: 'admin' }));
	for (const name of ['Notes', 'Pin notes', 'Automations', 'Pin automations'])
		await expect(page.getByText(name, { exact: true })).toBeVisible();
	await page.evaluate(() => {
		(window as any).setUser({ role: 'user' });
		(window as any).setConfig({ custom_ui: { hide: { notes: false } } });
	});
	await expect(page.getByRole('menuitem', { name: 'Notes' })).toBeVisible();
	await expect(page.getByRole('menuitem', { name: 'Automations' })).toBeVisible();
});

for (const [role, flag, visible] of [['user', true, false], ['admin', true, true], ['user', false, true]] as const)
	test(`real answer: insert into note ${visible ? 'shown' : 'hidden'} for ${role} with notes flag ${flag}`, async ({ page }) => {
		await page.goto('/?response');
		await page.waitForFunction(() => typeof (window as any).setMessage === 'function');
		await page.evaluate(({ role, flag }) => {
			(window as any).setConfig({ features: {}, custom_ui: { hide: { notes: flag } } });
			(window as any).setUser({ role });
			(window as any).setMessage({ content: 'Ответ', model: { id: 'jurist-rf' }, done: true, sources: [] });
		}, { role, flag });
		await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Insert into note' })).toHaveCount(visible ? 1 : 0);
	});

for (const role of ['user', 'admin'] as const)
	test(`real search: notes and channel messages ${role === 'user' ? 'hidden' : 'shown'} for ${role}`, async ({ page }) => {
		await page.route('**/api/v1/search?**', (route) => route.fulfill({ json: {
			items: [
				{ id: 'c1', kind: 'chat', title: 'Чат о договоре', context: 'Personal chat', snippet: '', preview: '', url: '/c/c1', updated_at: 1, shared: false, pinned: false },
				{ id: 'n1', kind: 'note', title: 'Заметка о договоре', context: 'Personal note', snippet: '', preview: '', url: '/notes/n1', updated_at: 1, shared: false, pinned: false },
				{ id: 'm1', kind: 'message', title: 'Сообщение канала о договоре', context: 'general', snippet: '', preview: '', url: '/channels/x', updated_at: 1, shared: false, pinned: false }
			],
			has_more: false, scopes: [{ id: 'x', name: 'general', kind: 'channel' }], kinds: ['chat', 'message', 'note']
		} }));
		await page.goto('/?search');
		await page.waitForFunction(() => typeof (window as any).setUser === 'function');
		await page.evaluate((role) => {
			localStorage.setItem('token', 'synthetic-session-token');
			(window as any).setConfig({ features: {}, custom_ui: { hide: { notes: true, channels: true } } });
			(window as any).setUser({ role });
		}, role);
		await page.getByRole('combobox', { name: 'Search your workspace' }).fill('договор');
		await expect(page.getByRole('option', { name: /Чат о договоре/ })).toBeVisible();
		await expect(page.getByRole('option', { name: /Заметка о договоре/ })).toHaveCount(role === 'user' ? 0 : 1);
		await expect(page.getByRole('option', { name: /Сообщение канала о договоре/ })).toHaveCount(role === 'user' ? 0 : 1);
	});
