// ai-dvokat: страница «Мои дела» (вариант «Г») — настоящие компоненты и стили на стенде компонентов. Подменены только
// ответы ручек (выдуманные данные из fixtures/case — формы настоящих ответов) и хранилища приложения. Живой путь
// (настоящий вход, legal-tools и Open WebUI) проверяется отдельно: tests/custom/case-live.
import { test, expect, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixture = (name: string) =>
	JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/case/${name}.json`, import.meta.url)), 'utf8'));
const S = fixture('strings');
const id = (n: number) =>
	`5a1c${String(n).padStart(4, '0')}-0000-4000-a000-${String(n).padStart(12, '0')}`;

type Scene = {
	listing?: string | ((route: Route) => unknown);
	tree?: boolean;
	strings?: (route: Route) => unknown;
	create?: (route: Route) => unknown;
	config?: unknown;
	token?: string | null;
	dark?: boolean;
};

async function open(page: Page, scene: Scene = {}) {
	const calls: { method: string; path: string; headers: Record<string, string> }[] = [];
	page.on('request', (r) => {
		const url = new URL(r.url());
		if (url.pathname.startsWith('/legal-tools/') || url.pathname.startsWith('/api/v1/'))
			calls.push({ method: r.method(), path: url.pathname, headers: r.headers() });
	});
	const external: string[] = [];
	page.on('request', (r) => {
		if (!r.url().startsWith('http://127.0.0.1') && !r.url().startsWith('data:')) external.push(r.url());
	});
	if (scene.token !== null)
		await page.addInitScript((t) => localStorage.setItem('token', t), scene.token ?? 'session-token');
	await page.route('**/legal-tools/api/cases/ui.json', (r) =>
		scene.strings ? scene.strings(r) : r.fulfill({ json: { strings: S } })
	);
	await page.route('**/api/v1/folders/', (r) =>
		scene.tree === false ? r.fulfill({ status: 403, json: { detail: 'no' } }) : r.fulfill({ json: fixture('folders') })
	);
	await page.route('**/api/v1/folders/shared', (r) =>
		scene.tree === false ? r.fulfill({ status: 403, json: { detail: 'no' } }) : r.fulfill({ json: fixture('folders-shared') })
	);
	await page.route('**/legal-tools/api/cases', (r) =>
		typeof scene.listing === 'function'
			? scene.listing(r)
			: r.fulfill({ json: fixture(scene.listing ?? 'my-cases') })
	);
	await page.route(/\/legal-tools\/api\/cases\/[0-9a-f-]{36}$/, (r) =>
		scene.create ? scene.create(r) : r.fulfill({ status: 500, json: { detail: 'не ждали' } })
	);
	await page.goto('/?case');
	await page.waitForFunction(() => typeof (window as any).setConfig === 'function');
	if (scene.dark) await page.evaluate(() => document.documentElement.classList.add('dark'));
	await page.evaluate(
		(config) => (window as any).setConfig(config),
		scene.config === undefined
			? { custom_ui: { case: true }, features: { enable_folders: true } }
			: scene.config
	);
	return { calls, external };
}

const root = (page: Page) => page.getByTestId('my-cases');
const ready = (page: Page) => expect(root(page)).toHaveAttribute('data-phase', 'ready');
// «видимые» — фильтром, а не приставкой в строке отбора: Tailwind читает исходники и принял бы её за свой класс
const rows = (page: Page) => page.getByTestId('case-row').filter({ visible: true });
const folders = (page: Page) => page.getByTestId('case-folder').filter({ visible: true });
const noSideScroll = async (page: Page) =>
	expect(
		await page.evaluate(() => {
			const view = document.querySelector('.cg-view')!;
			return [view.scrollWidth - view.clientWidth, document.documentElement.scrollWidth - window.innerWidth];
		})
	).toEqual([0, 0]);

test.describe('компьютер, 1280', () => {
	test.use({ viewport: { width: 1280, height: 1020 } });

	test('список: меню со счётчиками, плитки, дела по порядку, папки без дела; запросы — с токеном и без признака записи', async ({
		page
	}) => {
		const { calls, external } = await open(page);
		await ready(page);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(S.my_cases_title);
		const nav = page.getByRole('navigation', { name: S.my_cases_nav_label });
		await expect(nav).toContainText(S.brand_name);
		await expect(page.getByTestId('case-scope-all')).toHaveText(/Все дела\s*4/);
		await expect(page.getByTestId('case-scope-own')).toHaveText(/Мои\s*2/);
		await expect(page.getByTestId('case-scope-shared')).toHaveText(/Общие со мной\s*2/);
		await expect(page.getByTestId('case-scope-all')).toHaveAttribute('aria-pressed', 'true');
		await expect(nav).toContainText(S.my_cases_sections);
		await expect(page.getByTestId('case-section')).toHaveText(['Арбитраж', '2025']);

		await expect(page.getByTestId('case-tile-cases')).toContainText(/Дела\s*4\s*из них 2 общих/);
		await expect(page.getByTestId('case-tile-volumes')).toContainText(/Тома\s*14\s*в 4 делах/);
		await expect(page.getByTestId('case-tile-folders')).toContainText(/Папки без дела\s*4\s*в 3 можно завести дело/);

		await expect(page.getByRole('columnheader')).toHaveText([...S.my_cases_columns_g, '']);
		await expect(rows(page).locator('.title')).toHaveText([
			'Северный ветер — поставка',
			'А40-123456/2025',
			'Бета-Логистик (апелляция)',
			'Миронов Д. П. — наследство'
		]);
		await expect(rows(page).locator('.vol')).toHaveText(['4 тома', '1 том', '7 томов', '2 тома']);
		await expect(rows(page).locator('.date')).toHaveText([/^\d\d\.11\.2025$/, /^\d\d\.11\.2025$/, /^\d\d\.10\.2025$/, /^\d\d\.09\.2025$/]);
		await expect(rows(page).locator('.mc-pill')).toHaveText(['моё', 'моё', 'общее', 'только чтение']);
		await expect(rows(page).nth(1).locator('.path')).toHaveText('Арбитраж / 2025');
		// «Открыть дело» — у каждого дела, и у коллеги с правом «только чтение» тоже; ведёт на страницу дела сервиса
		await expect(rows(page).getByRole('link', { name: S.open_case })).toHaveCount(4);
		await expect(rows(page).first().getByRole('link', { name: S.open_case })).toHaveAttribute(
			'href',
			`/legal-tools/case/${id(1)}`
		);
		await expect(rows(page).first().locator('.title')).toHaveAttribute('href', `/legal-tools/case/${id(1)}`);

		await expect(folders(page).locator('.title')).toHaveText([
			'Гусева М. О. — раздел имущества',
			'Арбитраж',
			'2025',
			'Тихонов — трудовой спор'
		]);
		await expect(page.getByText(S.folders_without_case_note)).toBeVisible();
		// «Создать папку» — кнопка с окном на этой же странице (пакет 23.11, Д-4), ссылка «в чат» — прежняя
		await expect(page.getByTestId('case-new-folder').locator('visible=true')).toHaveText(S.create_folder);
		await expect(page.locator('a:visible', { hasText: S.create_folder_in_chat })).toHaveCount(0);
		await expect(page.locator('a:visible', { hasText: S.go_to_chat })).toHaveAttribute('href', '/');

		const listing = calls.filter((c) => c.path === '/legal-tools/api/cases');
		expect(listing).toHaveLength(1);
		expect(listing[0].headers.authorization).toBe('Bearer session-token');
		expect(listing[0].headers['x-ai-case']).toBeUndefined();
		expect(calls.map((c) => c.method)).toEqual(Array(calls.length).fill('GET'));
		expect(external).toEqual([]); // шрифт и всё остальное — свои файлы, внешних запросов нет
		await noSideScroll(page);
	});

	test('права: «только чтение» не видит «Завести дело», право записи — видит', async ({ page }) => {
		await open(page);
		await ready(page);
		const readonly = folders(page).filter({ hasText: 'Тихонов — трудовой спор' });
		await expect(readonly.getByRole('button')).toHaveCount(0);
		await expect(readonly.locator('.mc-pill')).toHaveText(S.access_readonly);
		await expect(folders(page).getByRole('button', { name: S.create_case })).toHaveCount(3);
	});

	test('отбор и поиск действуют на оба списка, плитки и счётчики меню показывают общий итог', async ({ page }) => {
		await open(page);
		await ready(page);
		await page.getByTestId('case-scope-own').click();
		await expect(rows(page)).toHaveCount(2);
		await expect(folders(page)).toHaveCount(3);
		await page.getByTestId('case-scope-shared').click();
		await expect(rows(page).locator('.title')).toHaveText(['Бета-Логистик (апелляция)', 'Миронов Д. П. — наследство']);
		await expect(folders(page).locator('.title')).toHaveText(['Тихонов — трудовой спор']);
		await expect(page.getByTestId('case-tile-cases')).toContainText('4');
		await expect(page.getByTestId('case-scope-all')).toHaveText(/4/);

		await page.getByTestId('case-scope-all').click();
		const [arbitrage, year] = [page.getByTestId('case-section').nth(0), page.getByTestId('case-section').nth(1)];
		await arbitrage.click();
		await expect(arbitrage).toHaveAttribute('aria-pressed', 'true');
		await expect(rows(page).locator('.title')).toHaveText(['А40-123456/2025']);
		// сама папка-раздел входит в свой отбор (у неё может быть своё дело) — вместе с тем, что внутри неё
		await expect(folders(page)).toHaveCount(2);
		expect((await folders(page).locator('.title').allTextContents()).map((t) => t.trim()).sort()).toEqual(['2025', 'Арбитраж']);
		await year.click();
		await expect(rows(page)).toHaveCount(1);
		await expect(folders(page).locator('.title')).toHaveText(['2025']);
		await expect(page.getByTestId('case-new-folder').locator('visible=true')).toHaveCount(1);
		await year.click(); // повторное нажатие снимает отбор
		await expect(rows(page)).toHaveCount(4);

		// стрелка сворачивает вложенные разделы и не трогает отбор
		await page.getByRole('button', { name: S.collapse }).click();
		await expect(page.getByTestId('case-section')).toHaveText(['Арбитраж']);
		await expect(rows(page)).toHaveCount(4);
		await page.getByRole('button', { name: S.expand }).click();
		await expect(page.getByTestId('case-section')).toHaveCount(2);

		const search = page.getByRole('searchbox', { name: S.my_cases_search_label });
		await expect(search).toHaveAttribute('placeholder', S.my_cases_search);
		await search.fill('гусева');
		await expect(folders(page).locator('.title')).toHaveText(['Гусева М. О. — раздел имущества']);
		await expect(page.getByTestId('case-list')).toContainText('По запросу «гусева» ничего не найдено');
		await search.fill('мироненко');
		await expect(rows(page)).toHaveCount(0);
		await expect(folders(page)).toHaveCount(0);
		await page.getByRole('button', { name: S.my_cases_search_reset }).click();
		await expect(search).toHaveValue('');
		await expect(rows(page)).toHaveCount(4);
	});

	test('порядок относится к «Делам»: сначала недавние, по названию', async ({ page }) => {
		await open(page);
		await ready(page);
		const order = page.getByLabel(S.my_cases_sort);
		await expect(order.locator('option')).toHaveText([S.my_cases_sort_recent, S.my_cases_sort_name]);
		await order.selectOption({ label: S.my_cases_sort_name });
		await expect(rows(page).locator('.title')).toHaveText([
			'А40-123456/2025',
			'Бета-Логистик (апелляция)',
			'Миронов Д. П. — наследство',
			'Северный ветер — поставка'
		]);
		await expect(folders(page).locator('.title').first()).toHaveText('Гусева М. О. — раздел имущества');
	});

	test('«Завести дело»: запись с X-Ai-Case и токеном, «Заводим…», затем страница дела', async ({ page }) => {
		let release: () => void = () => {};
		const gate = new Promise<void>((r) => (release = r));
		const posts: Record<string, string>[] = [];
		await page.route('**/legal-tools/case/*', (r) =>
			r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<title>страница дела</title><h1>страница дела</h1>' })
		);
		await open(page, {
			create: async (r) => {
				posts.push({ method: r.request().method(), url: r.request().url(), ...r.request().headers() });
				await gate;
				return r.fulfill({ status: 201, json: { case_id: 'c-1', folder_id: id(3), created: true } });
			}
		});
		await ready(page);
		const row = folders(page).filter({ hasText: 'Гусева М. О. — раздел имущества' });
		await row.getByRole('button', { name: S.create_case }).click();
		await expect(row.getByRole('button')).toHaveText(S.create_case_busy);
		await expect(row.getByRole('button')).toBeDisabled();
		await expect(folders(page).getByRole('button', { name: S.create_case }).first()).toBeDisabled();
		release();
		await page.waitForURL(`**/legal-tools/case/${id(3)}`);
		expect(posts).toHaveLength(1);
		expect(posts[0].method).toBe('POST');
		expect(new URL(posts[0].url).pathname).toBe(`/legal-tools/api/cases/${id(3)}`);
		expect(posts[0]['x-ai-case']).toBe('1');
		expect(posts[0].authorization).toBe('Bearer session-token');
	});

	test('дело завести не удалось: красное сообщение с фразой сервиса, кнопка возвращается', async ({ page }) => {
		let fail: 'server' | 'network' = 'server';
		await open(page, {
			create: (r) =>
				fail === 'server'
					? r.fulfill({ status: 500, json: { detail: 'внутренняя ошибка — повторите позже' } })
					: r.abort('internetdisconnected')
		});
		await ready(page);
		const button = folders(page).first().getByRole('button');
		await button.click();
		const toast = page.getByTestId('case-toast');
		await expect(toast).toHaveText('Не получилось: внутренняя ошибка — повторите позже');
		await expect(toast).toHaveAttribute('role', 'alert');
		await expect(button).toHaveText(S.create_case);
		await expect(button).toBeEnabled();
		expect(page.url()).toContain('/?case');
		fail = 'network';
		await button.click();
		await expect(page.getByTestId('case-toast').filter({ hasText: S.my_cases_error_network_title })).toHaveText(
			`Не получилось: ${S.my_cases_error_network_title}`
		);
	});

	test('загрузка: заготовка без счётчиков и «Загрузка…»', async ({ page }) => {
		let release: () => void = () => {};
		const gate = new Promise<void>((r) => (release = r));
		await open(page, {
			listing: async (r) => {
				await gate;
				return r.fulfill({ json: fixture('my-cases') });
			}
		});
		await expect(root(page)).toHaveAttribute('data-phase', 'loading');
		await expect(page.getByRole('status')).toHaveText(S.loading);
		await expect(page.getByTestId('case-scope-all')).toHaveText(S.my_cases_filter_all);
		await expect(page.getByRole('searchbox')).toHaveCount(0);
		await expect(page.locator('.mc-skel-row')).toHaveCount(3);
		release();
		await ready(page);
		await expect(rows(page)).toHaveCount(4);
	});

	test('папок нет: карточка «Папок пока нет» и «Создать папку»', async ({ page }) => {
		await open(page, { listing: 'my-cases-empty' });
		await ready(page);
		const card = page.getByTestId('case-empty');
		await expect(card.getByRole('heading')).toHaveText(S.my_cases_empty_title);
		await expect(card).toContainText(S.my_cases_empty);
		await expect(card.getByRole('button', { name: S.create_folder })).toBeVisible();
		await expect(page.getByTestId('case-scope-all')).toHaveText(/0/);
		await expect(page.getByRole('searchbox')).toHaveCount(0);
		await expect(page.getByTestId('case-list')).toHaveCount(0);
	});

	test('папки есть, а дел ещё нет; папка без названия и без томов; длинное название', async ({ page }) => {
		await open(page, { listing: 'my-cases-no-cases' });
		await ready(page);
		await expect(page.getByTestId('case-list')).toContainText(S.my_cases_no_cases);
		await expect(page.getByTestId('case-list').locator('.mc-cnt')).toHaveText('0');
		await expect(page.getByLabel(S.my_cases_sort)).toHaveCount(0);
		await expect(folders(page)).toHaveCount(4);

		await open(page, { listing: 'my-cases-edge' });
		await ready(page);
		await expect(rows(page).first().locator('.title')).toHaveText(S.folder_untitled);
		await expect(rows(page).first().locator('.vol')).toHaveText(S.volumes_none);
		await expect(rows(page).nth(2).locator('.path')).toHaveText('Арбитраж / 2025 / Апелляция / Девятый ААС');
		await expect(page.getByTestId('case-folders').getByTestId('case-new-folder').locator('visible=true')).toHaveText(S.create_folder);
		await noSideScroll(page);
		// отбор, под который ничего не попало: своя фраза, а не «заведите дело ниже»
		await page.getByTestId('case-scope-own').click();
		await expect(rows(page)).toHaveCount(1);
		await open(page, { listing: 'my-cases-no-cases' });
		await ready(page);
		await page.getByTestId('case-section').first().click();
		await expect(page.getByTestId('case-list')).toContainText(S.my_cases_no_cases);
		await page.getByTestId('case-scope-shared').click();
		await expect(page.getByTestId('case-list')).toContainText(S.my_cases_none_here);
	});

	test('Г-6: «Общие со мной» при двузначном счётчике не переносится; длинный раздел в дереве не раздувает меню', async ({ page }) => {
		const base = fixture('my-cases');
		const shared = Array.from({ length: 12 }, (_, i) => ({
			...base.shared[0],
			folder_id: `sh-${i}`,
			title: `Общее дело ${i + 1}`
		}));
		const longSec = { id: 'sec-long', name: 'Очень длинное название раздела из чата которое должно переноситься внутри меню', parent_id: null };
		const child = { id: base.own[0].folder_id, name: base.own[0].title, parent_id: 'sec-long' };
		await open(page, {
			listing: (r) => r.fulfill({ json: { own: base.own, shared } }),
			folders: [longSec, child],
			shared: []
		});
		await ready(page);
		const metrics = await page.evaluate(() => {
			const nav = document.querySelector('.mc-nav')!.getBoundingClientRect();
			const btn = document.querySelector('[data-testid="case-scope-shared"]')!;
			const label = btn.querySelector('.grow')!;
			const range = document.createRange();
			range.selectNodeContents(label);
			return {
				navW: Math.round(nav.width),
				btnW: Math.round(btn.getBoundingClientRect().width),
				labelLines: range.getClientRects().length
			};
		});
		console.log('G6_METRICS', JSON.stringify(metrics));
		expect(metrics.navW).toBeGreaterThanOrEqual(232);
		expect(metrics.navW).toBeLessThan(320);
		expect(metrics.labelLines).toBe(1);
		await noSideScroll(page);
	});

	for (const [name, answer, title, text] of [
		['чат не отвечает (503)', { status: 503, detail: 'Open WebUI временно не отвечает — список папок не получить' }, S.my_cases_error_title, S.my_cases_error_chat],
		['нет связи', null, S.my_cases_error_network_title, S.my_cases_error_network],
		['не найдено (404)', { status: 404, detail: 'Не найдено' }, S.not_found, ''],
		['вход истёк (401)', { status: 401, detail: S.login_needed }, S.login_needed, ''],
		['прочее (500)', { status: 500, detail: 'внутренняя ошибка — повторите позже' }, S.my_cases_error_title, 'внутренняя ошибка — повторите позже']
	] as const) {
		test(`ошибка списка: ${name} — карточка и «Повторить»`, async ({ page }) => {
			let broken = true;
			const { calls } = await open(page, {
				listing: (r) =>
					!broken
						? r.fulfill({ json: fixture('my-cases') })
						: answer
							? r.fulfill({ status: answer.status, json: { detail: answer.detail } })
							: r.abort('internetdisconnected')
			});
			await expect(root(page)).toHaveAttribute('data-phase', 'error');
			const card = page.getByTestId('case-error');
			await expect(card.getByRole('heading')).toHaveText(title);
			if (text) await expect(card.locator('p')).toHaveText(text);
			else await expect(card.locator('p')).toHaveCount(0);
			// фраза сервиса о чате в карточку не попадает: у страницы свои слова
			if (answer?.status === 503) await expect(card).not.toContainText('Open WebUI');
			await expect(page.getByTestId('case-scope-all')).toHaveText(S.my_cases_filter_all);
			await expect(page.locator('a.mc-chat:visible')).toHaveClass(/ghost/);
			await page.waitForTimeout(400); // сама страница не повторяет
			expect(calls.filter((c) => c.path === '/legal-tools/api/cases')).toHaveLength(1);
			broken = false;
			await page.getByTestId('case-retry').click();
			await ready(page);
			await expect(rows(page)).toHaveCount(4);
		});
	}

	test('дерево папок чата не пришло: страница работает без «Разделов из чата»', async ({ page }) => {
		await open(page, { tree: false });
		await ready(page);
		await expect(rows(page)).toHaveCount(4);
		await expect(page.getByTestId('case-section')).toHaveCount(0);
		await expect(page.getByText(S.my_cases_sections)).toHaveCount(0);
	});

	test('строки не пришли или «Дела» выключены: короткая карточка, без запросов списка', async ({ page }) => {
		let broken = true;
		const first = await open(page, {
			strings: (r) => (broken ? r.fulfill({ status: 503, json: { detail: 'x' } }) : r.fulfill({ json: { strings: S } }))
		});
		const card = page.getByTestId('case-fallback');
		await expect(card.getByRole('heading')).toHaveText('Страница сейчас недоступна');
		await expect(card.getByRole('link', { name: 'Перейти в чат' })).toHaveAttribute('href', '/');
		expect(first.calls.filter((c) => c.path === '/legal-tools/api/cases')).toHaveLength(0);
		broken = false;
		await card.getByRole('button', { name: 'Повторить' }).click();
		await ready(page);

		const released = await open(page, { strings: (r) => r.fulfill({ status: 404, json: { detail: 'Не найдено' } }) });
		await expect(page.getByTestId('case-fallback').getByRole('heading')).toHaveText('Не найдено');
		await expect(page.getByTestId('case-fallback').getByRole('button')).toHaveCount(0);
		expect(released.calls.filter((c) => c.path === '/legal-tools/api/cases')).toHaveLength(0);

		for (const config of [{}, { custom_ui: {} }, { custom_ui: { case: 'true' } }, { custom_ui: { case: false } }]) {
			const off = await open(page, { config });
			await expect(page.getByTestId('case-fallback').getByRole('heading')).toHaveText('Не найдено');
			await page.waitForTimeout(100);
			expect(off.calls.filter((c) => c.path.startsWith('/legal-tools/'))).toEqual([]);
		}
	});

	test('схема — по теме чата (класс dark на html), шрифт Geologica — свой файл', async ({ page }) => {
		await open(page);
		await ready(page);
		const colors = () =>
			page.evaluate(() => ({
				card: getComputedStyle(document.querySelector('[data-testid="case-list"]')!).backgroundColor,
				text: getComputedStyle(document.querySelector('.cg')!).color,
				font: getComputedStyle(document.querySelector('.cg h1')!).fontFamily,
				scheme: getComputedStyle(document.querySelector('.cg')!).colorScheme
			}));
		expect(await colors()).toMatchObject({ card: 'rgb(255, 255, 255)', text: 'rgb(27, 27, 41)', scheme: 'light' });
		expect((await colors()).font).toMatch(/^"?Geologica/);
		expect(await page.evaluate(() => document.fonts.ready.then(() => document.fonts.check('500 15px Geologica', 'Дело')))).toBe(true);
		await page.evaluate(() => document.documentElement.classList.add('dark'));
		expect(await colors()).toMatchObject({ card: 'rgb(30, 30, 40)', text: 'rgb(236, 236, 243)', scheme: 'dark' });
		// тема системы сама по себе схему не меняет: решает класс, который ставит чат
		await page.evaluate(() => document.documentElement.classList.remove('dark'));
		await page.emulateMedia({ colorScheme: 'dark' });
		expect((await colors()).card).toBe('rgb(255, 255, 255)');
	});
});

test.describe('телефон, 360', () => {
	test.use({ viewport: { width: 360, height: 760 } });

	for (const dark of [false, true]) {
		test(`список без прокрутки вбок, ${dark ? 'тёмная' : 'светлая'} схема: шапка, плитки, отбор, строки-ссылки`, async ({
			page
		}) => {
			await open(page, { dark });
			await ready(page);
			await expect(page.getByRole('navigation')).toHaveCount(0); // меню — «таблетками» и списком
			await expect(page.locator('.mc-top')).toContainText(S.brand_name);
			await expect(page.locator('.mc-top a')).toHaveText(S.go_to_chat_short);
			await expect(page.getByTestId('case-tile-cases')).toHaveText(/4\s*дела/);
			await expect(page.getByTestId('case-tile-volumes')).toHaveText(/14\s*томов/);
			await expect(page.getByTestId('case-tile-folders')).toHaveText(/4\s*папки без дела/);
			const pills = page.getByRole('group', { name: S.my_cases_nav_label }).getByRole('button');
			await expect(pills).toHaveText([/Все\s*4/, /Мои\s*2/, /Общие\s*2/]);
			const lines = page.locator('a.mc-line:visible');
			await expect(lines).toHaveCount(4);
			await expect(lines.first()).toHaveAttribute('href', `/legal-tools/case/${id(1)}`);
			await expect(lines.first().locator('.meta')).toHaveText(/^4 тома · изменено \d\d\.11\.2025$/);
			await expect(lines.nth(3).locator('.mc-pill')).toHaveText(S.access_readonly);
			await expect(rows(page)).toHaveCount(0);
			await noSideScroll(page);

			const section = page.getByLabel(S.my_cases_section_label);
			await expect(section.locator('option')).toHaveText([S.my_cases_sections_all, 'Арбитраж', 'Арбитраж / 2025']);
			await section.selectOption({ label: 'Арбитраж' });
			await expect(lines).toHaveCount(1);
			await expect(folders(page)).toHaveCount(2); // раздел «Арбитраж» сам и папка «2025» внутри него
			await section.selectOption({ label: S.my_cases_sections_all });
			await pills.nth(2).click();
			await expect(lines).toHaveCount(2);
			await expect(folders(page)).toHaveCount(1);
			await expect(folders(page).getByRole('button')).toHaveCount(0);
			await noSideScroll(page);

			// поля ввода — не меньше 16 px (иначе телефон увеличивает страницу), нажимаемое — не ниже 44 px
			const sizes = await page.evaluate(() => ({
				fields: [...document.querySelectorAll('.cg input, .cg select')]
					.filter((e) => (e as HTMLElement).offsetParent)
					.map((e) => parseFloat(getComputedStyle(e).fontSize)),
				targets: [...document.querySelectorAll('.cg a, .cg button, .cg select, .cg input')]
					.filter((e) => (e as HTMLElement).offsetParent)
					.map((e) => Math.round(e.getBoundingClientRect().height))
			}));
			expect(Math.min(...sizes.fields)).toBeGreaterThanOrEqual(16);
			expect(Math.min(...sizes.targets)).toBeGreaterThanOrEqual(44);
		});
	}

	test('состояния на телефоне без прокрутки вбок: пусто, ошибка, особые строки, сообщение об ошибке', async ({ page }) => {
		await open(page, { listing: 'my-cases-empty' });
		await ready(page);
		await expect(page.getByTestId('case-empty')).toBeVisible();
		await noSideScroll(page);

		await open(page, { listing: (r) => r.abort('internetdisconnected') });
		await expect(page.getByTestId('case-error').getByRole('heading')).toHaveText(S.my_cases_error_network_title);
		await expect(page.locator('.mc-top a')).toHaveClass(/ghost/);
		await noSideScroll(page);

		await open(page, { listing: 'my-cases-edge' });
		await ready(page);
		await noSideScroll(page);

		await open(page, {
			listing: 'my-cases-no-cases',
			create: (r) => r.fulfill({ status: 409, json: { detail: 'прежнее дело этой папки ещё удаляется — повторите через несколько минут' } })
		});
		await ready(page);
		await folders(page).first().getByRole('button').click();
		await expect(page.getByTestId('case-toast')).toContainText('прежнее дело этой папки ещё удаляется');
		const box = await page.getByTestId('case-toast').boundingBox();
		expect(box!.x).toBeGreaterThanOrEqual(0);
		expect(box!.x + box!.width).toBeLessThanOrEqual(360);
		await noSideScroll(page);
	});
});

test('пункт «Дела» в левой панели чата: выключатель включён и сервис подтвердил доступ; сервис не ответил — пункта нет', async ({
	page
}) => {
	let answer: 'yes' | 'no' | 'down' | 'html' | '404' | '401' | '503' = 'yes';
	const asked: Record<string, string>[] = [];
	await page.addInitScript(() => localStorage.setItem('token', 'session-token'));
	await page.route('**/legal-tools/api/cases/access', (r) => {
		asked.push(r.request().headers());
		if (answer === 'down') return r.abort('internetdisconnected');
		if (answer === 'html') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><html></html>' });
		// отказы сервиса — как на всех путях дела: вне группы выпуска — 404, токен не принят — 401, чат не отвечает — 503
		if (/^\d+$/.test(answer)) return r.fulfill({ status: Number(answer), json: { detail: 'Не найдено' } });
		return r.fulfill({ json: { case: answer === 'yes' } });
	});
	const open = async (config: unknown, user: unknown = { id: 'u-1', role: 'user' }) => {
		await page.goto('/?cases-link');
		await page.waitForFunction(() => typeof (window as any).setConfig === 'function');
		await page.evaluate(([c, u]) => {
			(window as any).setUser(u);
			(window as any).setConfig(c);
		}, [config, user]);
	};
	const link = page.getByTestId('custom-cases-link');
	// выключатель снят или не строгое true — сервис даже не спрашивается
	for (const config of [undefined, {}, { custom_ui: {} }, { custom_ui: { case: 'true' } }, { custom_ui: { case: false } }]) {
		await open(config);
		await page.waitForTimeout(100);
		await expect(link).toHaveCount(0);
	}
	expect(asked).toEqual([]);
	await open({ custom_ui: { case: true } });
	await expect(link).toHaveText('Дела');
	await expect(link).toHaveAttribute('href', '/case');
	expect(asked).toHaveLength(1);
	expect(asked[0].authorization).toBe('Bearer session-token');
	// один вопрос за сеанс: повторное появление панели сервис не спрашивает
	await page.evaluate(() => (window as any).setConfig({ custom_ui: { case: true, brand: {} } }));
	await expect(link).toHaveCount(1);
	expect(asked).toHaveLength(1);
	// вне группы выпуска, сервис не ответил, по пути сервиса ответил не он, нет входа — пункта нет
	for (const next of ['no', 'down', 'html', '404', '401', '503'] as const) {
		answer = next;
		await open({ custom_ui: { case: true } });
		await page.waitForTimeout(300);
		await expect(link).toHaveCount(0);
	}
	answer = 'yes';
	await open({ custom_ui: { case: true } }, null);
	await page.waitForTimeout(200);
	await expect(link).toHaveCount(0);
});
