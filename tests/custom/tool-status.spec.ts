import { test, expect, type Page } from '@playwright/test';
import {
	TOOL_NAMES,
	plainToolStatus,
	toolGroupText,
	toolKey,
	toolState,
	toolStatusLabel
} from '../../src/lib/custom/toolStatus';

// legal-tools MCP (tools/src/legal_tools/mcp/server.py, 2026-11-08).
const LEGAL_TOOLS = [
	'kplus_search', 'kplus_suggest', 'kplus_outline', 'kplus_read', 'kplus_editions',
	'kplus_edition_on_date', 'kplus_related', 'kplus_positions', 'kplus_reopen',
	'kplus_document_card', 'kplus_contract_materials', 'kplus_updates', 'kplus_changes',
	'kplus_search_card', 'kplus_reference_value', 'days_between', 'make_xlsx'
];
const on = { hide: { tool_details: true } };
const STATES = ['active', 'done', 'error', 'rejected', 'approval'] as const;

test('plain tool status is user-only and requires an explicit boolean flag', () => {
	expect(plainToolStatus(on, 'user')).toBe(true);
	for (const role of ['admin', 'pending', undefined]) expect(plainToolStatus(on, role)).toBe(false);
	for (const raw of [{}, { hide: { tool_details: 'true' } }, { hide: { tool_details: false } }, undefined])
		expect(plainToolStatus(raw, 'user')).toBe(false);
});

test('every legal-tools MCP tool has its own Russian labels without technical names', () => {
	expect([...TOOL_NAMES].sort()).toEqual([...LEGAL_TOOLS].sort());
	const generic = STATES.map((state) => toolStatusLabel('unknown', state));
	for (const tool of LEGAL_TOOLS) {
		expect(toolKey(`legal-tools_${tool}`)).toBe(tool);
		expect(toolKey(tool)).toBe(tool);
		for (const [i, state] of STATES.entries()) {
			const label = toolStatusLabel(`legal-tools_${tool}`, state);
			expect(label).toMatch(/[А-Яа-яЁё]/);
			// Only the XLSX file format may appear in Latin letters.
			expect(label.replace('XLSX', '')).not.toMatch(/[A-Za-z_]/);
			expect(label).not.toBe(generic[i]);
		}
	}
	expect(toolKey('legal-tools_kplus_search_card')).toBe('kplus_search_card');
	expect(toolKey('legal-tools_kplus_edition_on_date')).toBe('kplus_edition_on_date');
	expect(toolStatusLabel('legal-tools_kplus_search', 'active')).toBe('Поиск в КонсультантПлюс…');
	expect(toolStatusLabel('legal-tools_kplus_search', 'done')).toBe('Найдено в КонсультантПлюс');
	expect(toolStatusLabel('legal-tools_kplus_read', 'active')).toBe('Чтение документа КонсультантПлюс…');
	expect(toolStatusLabel('legal-tools_kplus_outline', 'active')).toBe('Оглавление документа…');
	expect(toolStatusLabel('legal-tools_kplus_outline', 'error')).toBe('Не выполнено: оглавление документа');
});

test('unknown tools get a generic label, never the raw name', () => {
	for (const name of ['other_secret_tool', 'kplus', 'search', '', undefined, null, 42]) {
		expect(toolKey(name)).toBeUndefined();
		expect(toolStatusLabel(name, 'active')).toBe('Обращение к инструменту…');
		expect(toolStatusLabel(name, 'done')).toBe('Обращение к инструменту выполнено');
		expect(toolStatusLabel(name, 'rejected')).toBe('Отклонено: обращение к инструменту');
	}
});

test('state precedence follows the upstream display and keeps errors visible', () => {
	expect(toolState({})).toBe('active');
	expect(toolState({ approval: true })).toBe('approval');
	expect(toolState({ input: true, approval: true })).toBe('input');
	expect(toolState({ done: true, input: true })).toBe('done');
	expect(toolState({ done: true, error: true })).toBe('error');
	expect(toolState({ rejected: true, error: true, done: true })).toBe('rejected');
});

test('group summary counts by meaning and names no tools', () => {
	const names = ['legal-tools_kplus_search', 'legal-tools_kplus_search', 'legal-tools_kplus_outline', 'x', 'y'];
	expect(toolGroupText(names, false)).toEqual({
		prefix: 'Выполнено:',
		detail: 'поиск в КонсультантПлюс (2), оглавление документа, обращение к инструменту (2)'
	});
	expect(toolGroupText(names, true).prefix).toBe('Выполняется:');
	expect(toolGroupText(names, false, true).prefix).toBe('Завершено с ошибкой:');
});

const technical = /legal-tools|kplus_|other-server|secret_tool|make_xlsx|View Result|Input|Output|синтетический запрос|Синтетический результат/;

async function open(page: Page, role: string, custom_ui: unknown = on) {
	await page.goto('/?tool-status');
	await page.waitForFunction(() => typeof (window as any).setUser === 'function');
	await page.evaluate(({ role, custom_ui }) => {
		(window as any).setConfig({ custom_ui });
		(window as any).setUser({ role });
	}, { role, custom_ui });
}

test('user sees Russian status lines only; embeds, files and approval buttons stay', async ({ page }) => {
	await open(page, 'user');
	const single = page.getByTestId('single');
	await expect(page.locator('#done')).toContainText('Документ КонсультантПлюс прочитан');
	await expect(page.locator('#active')).toContainText('Поиск в КонсультантПлюс…');
	await expect(page.locator('#failed')).toContainText('Не выполнено: оглавление документа');
	await expect(page.locator('#unknown')).toContainText('Обращение к инструменту выполнено');
	await expect(page.locator('#pending')).toContainText('Разрешить: таблица расчёта XLSX?');
	// Clicking the status does not reveal arguments or results.
	await page.locator('#done [role=button]').click();
	await expect(page.locator('#done pre')).toHaveCount(0);
	await expect(single).not.toContainText(technical);
	await expect(page.getByTestId('group')).not.toContainText(technical);
	// Upstream extras remain available.
	await expect(page.locator('#embed iframe')).toHaveCount(1);
	await expect(page.locator('#embed')).toContainText('Документ КонсультантПлюс прочитан');
	await expect(page.locator('#files img')).toHaveCount(1);
	await page.locator('#pending').getByRole('button', { name: 'Allow', exact: true }).click();
	await expect(page.getByTestId('resolved')).toHaveText('true');
	// Group summary and expanded group.
	const group = page.getByTestId('group');
	await expect(group).toContainText('Выполнено:');
	await expect(group).toContainText('поиск в КонсультантПлюс (2), оглавление документа');
	await group.getByRole('button', { name: 'Toggle details' }).click();
	await expect(page.locator('#grouped-0')).toContainText('Найдено в КонсультантПлюс');
	await expect(page.locator('#grouped-2')).toContainText('Оглавление документа получено');
	await expect(group).not.toContainText(technical);
});

test('admin and disabled flag keep the upstream tool block with names and results', async ({ page }) => {
	for (const [role, custom_ui] of [['admin', on], ['user', {}]] as const) {
		await open(page, role, custom_ui);
		await expect(page.locator('#done')).toContainText('View Result from legal-tools_kplus_read');
		await expect(page.locator('#unknown')).toContainText('other-server_secret_tool');
		await page.locator('#done [role=button]').first().click();
		await expect(page.locator('#done')).toContainText('Output');
		await expect(page.locator('#done')).toContainText('Синтетический результат');
		await expect(page.getByTestId('group')).toContainText('2 legal-tools_kplus_search, legal-tools_kplus_outline');
	}
});
