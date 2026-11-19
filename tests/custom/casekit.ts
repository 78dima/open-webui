// ai-dvokat: общее для проверок разделов страницы дела на стенде компонентов: открыть раздел с подменёнными ручками
// сервиса (выдуманные данные формы настоящих ответов — fixtures/case), собрать запросы страницы к сервису.
import { expect, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const fixture = (name: string) =>
	JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/case/${name}.json`, import.meta.url)), 'utf8'));
export const S = fixture('strings');
export const BOOT = fixture('case-boot');
export const F = BOOT.folder_id;
export const API = `/legal-tools/api/cases/${F}`;

export type Call = { method: string; path: string; headers: Record<string, string>; body: any };
export type Scene = {
	section?: string;
	/** Хвост адреса после раздела: `/case/<папка>/tables/<номер>`. */
	item?: string;
	boot?: Record<string, unknown>;
	data?: () => unknown;
	/** Ручки раздела: хвост адреса после `…/cases/<папка>/` (шаблон Playwright) → ответ или обработчик. */
	routes?: Record<string, unknown | ((route: Route, call: Call) => unknown)>;
	dark?: boolean;
};

export async function openSection(page: Page, scene: Scene = {}) {
	const calls: Call[] = [];
	page.on('request', (r) => {
		const url = new URL(r.url());
		if (!url.pathname.startsWith('/legal-tools/')) return;
		let body: any = null;
		try {
			body = r.postDataJSON();
		} catch {
			body = r.postData();
		}
		calls.push({ method: r.method(), path: url.pathname.replace(API, '') + url.search, headers: r.headers(), body });
	});
	await page.addInitScript(() => localStorage.setItem('token', 'session-token'));
	await page.route('**/legal-tools/api/cases/ui.json', (r) => r.fulfill({ json: { strings: S } }));
	await page.route(`**${API}/boot`, (r) => r.fulfill({ json: { ...BOOT, ...(scene.boot ?? {}) } }));
	await page.route(`**${API}/passport`, (r) => r.fulfill({ json: fixture('passport') }));
	await page.route(`**${API}/folder-files`, (r) => r.fulfill({ json: fixture('folder-files') }));
	let overviewCalls = 0;
	await page.route(`**${API}`, (r) => {
		if (r.request().method() !== 'GET') return r.fallback();
		overviewCalls += 1;
		return r.fulfill({ json: scene.data ? scene.data() : fixture('case-overview') });
	});
	for (const [tail, answer] of Object.entries(scene.routes ?? {})) {
		await page.route(`**${API}/${tail}`, (r) => {
			if (typeof answer !== 'function') return r.fulfill({ json: answer });
			const url = new URL(r.request().url());
			let body: any = null;
			try {
				body = r.request().postDataJSON();
			} catch {
				body = null;
			}
			return (answer as (route: Route, call: Call) => unknown)(r, {
				method: r.request().method(),
				path: url.pathname.replace(API, '') + url.search,
				headers: r.request().headers(),
				body
			});
		});
	}
	const q = scene.section ? `&s=${scene.section}${scene.item ? `/${scene.item}` : ''}` : '';
	await page.goto(`/?casepage=${F}${q}`);
	await page.waitForFunction(() => typeof (window as any).setConfig === 'function');
	if (scene.dark) await page.evaluate(() => document.documentElement.classList.add('dark'));
	await page.evaluate(() => (window as any).setConfig({ custom_ui: { case: true } }));
	await page.waitForSelector('[data-testid="case-page"], [data-testid="case-menu"]');
	return { calls, overviewCalls: () => overviewCalls };
}

export const processing = () => ({ ...fixture('case-overview-processing'), paused: null });
/** Оборот обзора: страница переспрашивает его при возвращении на вкладку. */
export const refresh = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
export const noSideScroll = async (page: Page) =>
	expect(
		await page.evaluate(() => {
			const view = document.querySelector('.cg-view')!;
			return [view.scrollWidth - view.clientWidth, document.documentElement.scrollWidth - window.innerWidth];
		})
	).toEqual([0, 0]);
/** Запросы записи раздела: метод и адрес от папки дела. */
export const writes = (calls: Call[]) =>
	calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`);
/** Окно страницы «Дел»: родной <dialog>, открытый поверх. */
export const dialog = (page: Page) => page.locator('dialog[open]');
/** Нажимаемое, которым юрист пишет в дело: кнопки записи раздела (для прохода «только чтение»). */
export const writeButtons = (page: Page, names: string[]) =>
	page.getByRole('button', { name: new RegExp(`^(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`) });
