// ai-dvokat: страница дела (вариант «Г») на стенде компонентов — настоящие компоненты и стили; ручки сервиса
// подменены выдуманными данными формы настоящих ответов (fixtures/case). Живой путь — tests/custom/case-live.
import { test, expect, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixture = (name: string) =>
	JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/case/${name}.json`, import.meta.url)), 'utf8'));
const S = fixture('strings');
const BOOT = fixture('case-boot');
const F = BOOT.folder_id;
const API = `/legal-tools/api/cases/${F}`;
const BLURRED = 'плохо снято (размыто, темно, обрезано или блики) — переснимите'; // фраза сервиса, приходит в ответе

type Scene = {
	section?: string;
	boot?: Record<string, unknown> | ((route: Route) => unknown);
	data?: () => unknown;
	overview?: (route: Route, n: number) => unknown;
	uploads?: (route: Route) => unknown;
	dark?: boolean;
};

async function open(page: Page, scene: Scene = {}) {
	const calls: { method: string; path: string; headers: Record<string, string>; body: string | null }[] = [];
	page.on('request', (r) => {
		const url = new URL(r.url());
		if (url.pathname.startsWith('/legal-tools/'))
			calls.push({ method: r.method(), path: url.pathname + url.search, headers: r.headers(), body: r.postData() });
	});
	await page.addInitScript(() => localStorage.setItem('token', 'session-token'));
	await page.route('**/legal-tools/api/cases/ui.json', (r) => r.fulfill({ json: { strings: S } }));
	await page.route(`**${API}/boot`, (r) =>
		typeof scene.boot === 'function' ? scene.boot(r) : r.fulfill({ json: { ...BOOT, ...(scene.boot ?? {}) } })
	);
	await page.route(`**${API}/passport`, (r) => r.fulfill({ json: fixture('passport') }));
	await page.route(`**${API}/folder-files`, (r) => r.fulfill({ json: fixture('folder-files') }));
	let n = 0;
	await page.route(`**${API}`, (r) => {
		if (r.request().method() !== 'GET') return r.fallback();
		n += 1;
		if (scene.overview) return scene.overview(r, n);
		return r.fulfill({ json: scene.data ? scene.data() : fixture('case-overview') });
	});
	if (scene.uploads) await page.route(`**${API}/uploads**`, scene.uploads);
	await page.goto(`/?casepage=${F}${scene.section ? `&s=${scene.section}` : ''}`);
	await page.waitForFunction(() => typeof (window as any).setConfig === 'function');
	if (scene.dark) await page.evaluate(() => document.documentElement.classList.add('dark'));
	await page.evaluate(() => (window as any).setConfig({ custom_ui: { case: true } }));
	await page.waitForSelector('[data-testid="case-page"], [data-testid="case-menu"]');
	return { calls, overviewCalls: () => n };
}
const processing = () => ({ ...fixture('case-overview-processing'), paused: null });
const summary = (page: Page) => page.getByTestId('case-summary');
const nav = (page: Page) => page.getByRole('navigation', { name: S.nav_title });
const refresh = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
const noSideScroll = async (page: Page) =>
	expect(
		await page.evaluate(() => {
			const view = document.querySelector('.cg-view')!;
			return [view.scrollWidth - view.clientWidth, document.documentElement.scrollWidth - window.innerWidth];
		})
	).toEqual([0, 0]);
const pdf = (name: string, size = 1000) => ({ name, mimeType: 'application/pdf', buffer: Buffer.alloc(size) });

test.describe('каркас, 1280', () => {
	test.use({ viewport: { width: 1280, height: 1100 } });

	test('меню разделов с группами и счётчиками, шапка, «В чат дела», «Открыть лист»; запросы — с токеном', async ({ page }) => {
		const { calls } = await open(page, { data: processing });
		await expect(summary(page)).toHaveAttribute('data-state', 'processing');
		await expect(nav(page)).toContainText(S.brand_name);
		await expect(nav(page).getByRole('link', { name: S.back_to_cases })).toHaveAttribute('href', '/case');
		await expect(nav(page).locator('.cap')).toHaveText([S.nav_group_materials, S.nav_group_documents, S.nav_group_map, S.nav_group_work]);
		await expect(nav(page).locator('a[data-testid^="case-nav-"]')).toHaveText([
			'Обзор', 'Загрузить материалы', 'Тома2', 'Замена тома', 'Проверьте листы31', 'Опись22', 'Копии и расхождения5',
			'Паспорт', 'Суммы43', 'Хронология155', 'Сроки2', 'Таблицы и проходы5', 'Выписка листов', 'Файлы папки вне дела', 'Удаление дела'
		]);
		await expect(page.getByTestId('case-nav-overview')).toHaveAttribute('aria-current', 'page');
		await expect(page.getByTestId('case-nav-check').locator('.n')).toHaveClass(/\bw\b/);
		await expect(page.locator('.head .eyebrow')).toHaveText(S.case_caption);
		await expect(page.locator('.head h1')).toHaveText('Северный ветер — поставка');
		await expect(page).toHaveTitle('Дело «Северный ветер — поставка»');
		await expect(page.getByRole('link', { name: S.chat_of_case })).toHaveAttribute('href', `/folders/${F}`);

		const form = page.getByTestId('case-goto').filter({ visible: true });
		await expect(form).toHaveAttribute('action', `/legal-tools/case/${F}/ref`);
		await expect(form).toHaveAttribute('method', 'get');
		await expect(form.locator('select[name="t"] option')).toHaveText(['т. 4', 'т. 5/1']);
		await expect(form.locator('select[name="t"] option').first()).toHaveAttribute('value', '4');
		await expect(form.locator('input[name="l"]')).toHaveAttribute('required', '');
		await expect(form.locator('input[name="side"]')).toHaveAttribute('value', 'back');

		const mine = calls.filter((c) => c.path.startsWith(API));
		expect(mine.map((c) => c.path.slice(API.length)).sort()).toEqual(['', '/boot', '/folder-files', '/passport']);
		expect(mine.every((c) => c.method === 'GET' && c.headers.authorization === 'Bearer session-token' && !c.headers['x-ai-case'])).toBe(true);
		await noSideScroll(page);
	});

	test('раздел открывается по прямой ссылке; переход между разделами не перезагружает страницу дела; назад и вперёд работают', async ({ page }) => {
		const { calls } = await open(page, { section: 'check' });
		await expect(page.getByTestId('case-page')).toHaveAttribute('data-section', 'check');
		await expect(page.locator('.head h1')).toHaveText(S.section_check);
		await expect(page.locator('.head .eyebrow')).toHaveText('Северный ветер — поставка');
		await expect(page.locator('.head .cnt')).toHaveText('31');
		await expect(page).toHaveTitle('Проверьте листы — Северный ветер — поставка');
		await expect(page.getByTestId('case-nav-check')).toHaveAttribute('aria-current', 'page');
		await page.getByTestId('case-nav-upload').click();
		await expect(page.getByTestId('case-drop')).toBeVisible();
		await page.getByTestId('case-nav-overview').click();
		await expect(summary(page)).toBeVisible();
		await page.goBack();
		await expect(page.getByTestId('case-drop')).toBeVisible();
		await page.goBack();
		await expect(page.getByTestId('case-check')).toBeVisible();
		await page.goForward();
		await expect(page.getByTestId('case-drop')).toBeVisible();
		expect(calls.filter((c) => c.path === `${API}/boot`)).toHaveLength(1); // страница дела та же
	});

	test('состав меню следует настройке разделов сервиса; выключенный и незнакомый раздел — «Не найдено»', async ({ page }) => {
		await open(page, { boot: { sections: ['volumes', 'check', 'inventory'], stage: 1 } });
		await expect(nav(page).locator('a[data-testid^="case-nav-"]')).toHaveText([
			'Обзор', 'Загрузить материалы', 'Тома1', 'Проверьте листы31', 'Опись22', 'Файлы папки вне дела', 'Удаление дела'
		]);
		await expect(nav(page).locator('.cap')).toHaveText([S.nav_group_materials, S.nav_group_documents]);
		for (const section of ['deadlines', 'nosuch']) {
			await open(page, { boot: { sections: ['volumes', 'check', 'inventory'], stage: 1 }, section });
			await expect(page.getByTestId('case-section-none').getByRole('heading')).toHaveText(S.not_found);
		}
	});

	test('права: «только чтение» не видит загрузки и удаления, пометка стоит рядом с состоянием', async ({ page }) => {
		await open(page, { boot: { can_write: false, is_owner: false }, data: () => ({ ...processing(), uploads: [] }) });
		await expect(summary(page).locator('.pill')).toHaveText([S.overview_state_processing, S.access_readonly]);
		await expect(summary(page)).toContainText(S.overview_readonly_text);
		await expect(page.getByTestId('case-nav-upload')).toHaveCount(0);
		await expect(page.getByTestId('case-nav-danger')).toHaveCount(0);
		await expect(page.locator('a', { hasText: S.section_upload })).toHaveCount(0);
		await expect(page.getByTestId('case-tiles').locator('.tile')).toHaveCount(2);
		await open(page, { boot: { can_write: false, is_owner: false }, section: 'upload' });
		await expect(page.getByTestId('case-section-none')).toBeVisible();
		await expect(page.getByTestId('case-drop')).toHaveCount(0);
		// право записи без владения: загрузка есть, удаления нет
		await open(page, { boot: { is_owner: false } });
		await expect(page.getByTestId('case-nav-upload')).toHaveCount(1);
		await expect(page.getByTestId('case-nav-danger')).toHaveCount(0);
	});

	test('дела нет: «Завести дело» заводит и открывает дело; отказы — карточкой', async ({ page }) => {
		let created = false;
		const posts: Record<string, string>[] = [];
		await page.route(`**${API}`, (r) => {
			if (r.request().method() !== 'POST') return r.fallback();
			posts.push(r.request().headers());
			created = true;
			return r.fulfill({ status: 201, json: { case_id: 'c-1', folder_id: F, created: true } });
		});
		await open(page, { boot: (r) => r.fulfill({ json: created ? BOOT : { ...BOOT, has_case: false, case_id: null } }) });
		const card = page.getByTestId('case-none');
		await expect(card.getByRole('heading')).toHaveText(S.case_no_g);
		await expect(card).toContainText(S.folders_without_case_note);
		await expect(nav(page).locator('a[data-testid^="case-nav-"]')).toHaveCount(0);
		await card.getByRole('button', { name: S.create_case }).click();
		await expect(page.getByTestId('case-toast')).toHaveText(S.case_created);
		await expect(summary(page)).toHaveAttribute('data-state', 'ready');
		expect(posts).toHaveLength(1);
		expect(posts[0]['x-ai-case']).toBe('1');

		for (const [status, detail, title] of [
			[404, 'Не найдено', S.not_found],
			[401, S.login_needed, S.login_needed],
			[503, 'Open WebUI временно не отвечает — права на папку не проверить', 'Не получилось: Open WebUI временно не отвечает — права на папку не проверить']
		] as const) {
			await open(page, { boot: (r) => r.fulfill({ status, json: { detail } }) });
			await expect(page.getByTestId('case-boot-error').getByRole('heading')).toHaveText(title);
		}
	});
});

test.describe('«Обзор», 1280', () => {
	test.use({ viewport: { width: 1280, height: 1100 } });

	test('дело в работе: ход распознавания, плитки, ближайшие сроки, состав дела, шапка из паспорта; денег нет', async ({ page }) => {
		await open(page, { data: processing });
		await expect(summary(page).locator('.pill')).toHaveText([S.overview_state_processing]);
		await expect(summary(page).getByRole('heading')).toHaveText('Распознано 363 из 669 страниц');
		await expect(summary(page)).toContainText(S.overview_can_close);
		expect(await summary(page).locator('.bar i').evaluate((e) => (e as HTMLElement).style.width)).toBe('54%');
		await expect(summary(page).getByRole('link', { name: S.section_upload })).toHaveAttribute('href', new RegExp('s=upload$'));

		await expect(page.getByTestId('case-tiles').locator('.tile')).toHaveText([
			/Проверьте листы\s*31\s*замечание к листам/, /Файлы без тома\s*3\s*укажите том/, /Загрузки\s*5\s*1 не принята/
		]);
		const deadlines = page.getByTestId('case-deadlines').locator('.li');
		await expect(deadlines).toHaveCount(2);
		await expect(deadlines.nth(0)).toContainText('до 11.12.2026');
		await expect(deadlines.nth(0)).toContainText('Основание: т. 4, л.д. 151');
		await expect(deadlines.nth(0).locator('.pill')).toHaveText(S.map_deadline_draft);
		await expect(deadlines.nth(1).locator('.pill')).toHaveText('подтверждён: Лебедева Анна Викторовна, 02.11.2026');
		await expect(deadlines.nth(1).locator('a.ref')).toHaveText('т. 4, стр. 46 tom-2-chast-1.pdf');
		await expect(deadlines.nth(1).locator('a.ref')).toHaveAttribute('title', 'т. 4, файл «tom-2-chast-1.pdf», стр. 46');

		const comp = page.getByTestId('case-composition');
		await expect(comp.getByTestId('case-comp-volume')).toHaveText([
			/Том 4\s*готов\s*209 страниц · л\.д\. 1–210\s*К тому →/,
			/Том 5\/1\s*распознаётся: 140 из 312\s*312 страниц · пока л\.д\. 1–140/
		]);
		await expect(comp.getByTestId('case-comp-loose')).toHaveText(/Файлы без тома\s*укажите том\s*3 файла — без тома их листы не попадут в опись; 1 заблокирован/);
		await expect(comp.getByTestId('case-comp-ecase')).toHaveText(/Электронное дело\s*прочитано\s*1 файл · 48 страниц/);
		await expect(comp.getByTestId('case-comp-inventory')).toHaveText(/Опись\s*22 документа; тома в обработке добавятся позже/);
		await expect(page.getByTestId('case-engine-note')).toHaveText(S.case_engine_note);

		const head = page.getByTestId('case-head');
		await expect(head).toContainText('А42-668824/3518');
		await expect(head).toContainText('от руки — 2 из 13 записей');
		await expect(head).toContainText('ещё 3 номера');
		await expect(head).toContainText('Арбитражный суд города Москвы');
		await expect(head).toContainText(S.overview_head_note);
		await expect(head.locator('a.ref').first()).toHaveAttribute('href', /\/legal-tools\/case\/.+\/p\/\d+/);
		// денег в обзоре нет
		await expect(page.locator('.main')).not.toContainText('USD');
	});

	test('шапка из паспорта перечитывается с обзором, не чаще раза в 20 с: паспорт, построенный после открытия страницы, появляется сам', async ({ page }) => {
		let built = false;
		let asked = 0;
		await open(page, { data: processing });
		await page.unroute(`**${API}/passport`);
		await page.route(`**${API}/passport`, (r) => {
			asked += 1;
			return r.fulfill({ json: built ? fixture('passport') : { fields: [], can_write: true } });
		});
		await page.evaluate(() => {
			const now = Date.now.bind(Date);
			(window as any).__ahead = 0;
			Date.now = () => now() + (window as any).__ahead;
		});
		const ahead = (ms: number) => page.evaluate((x) => ((window as any).__ahead += x), ms);
		await ahead(21000);
		await refresh(page);
		await expect.poll(() => asked).toBe(1);
		await expect(page.getByTestId('case-head')).toHaveCount(0); // паспорта ещё нет — шапки нет
		built = true;
		await refresh(page);
		await page.waitForTimeout(300);
		expect(asked).toBe(1); // 20 с не прошло — паспорт не переспрашивается
		await ahead(21000);
		await refresh(page);
		await expect(page.getByTestId('case-head')).toBeVisible();
		await expect(page.getByTestId('case-head')).toContainText(S.map_pf_court);
		expect(asked).toBe(2);
	});

	test('состояния сводки: готово, пауза сама пройдёт, остановлено, пусто', async ({ page }) => {
		await open(page);
		await expect(summary(page)).toHaveAttribute('data-state', 'ready');
		await expect(summary(page).locator('.pill')).toHaveText([S.overview_state_ready]);
		await expect(summary(page).getByRole('heading')).toHaveText('Все 209 страниц распознаны');
		await expect(summary(page)).toContainText('1 том, 22 документа в описи. Прежде чем опираться на цитаты, просмотрите 31 замечание к листам.');
		await expect(summary(page).getByRole('link')).toHaveText([S.overview_check_btn, S.overview_upload_more]);
		await expect(page.getByTestId('case-comp-inventory')).toHaveText(/22 документа\s*К описи/);

		const now = new Date();
		now.setHours(10, 2, 0, 0);
		await open(page, { data: () => ({ ...processing(), paused: { reason: 'fuse', since: now.toISOString(), until: null } }) });
		await expect(summary(page).locator('.pill').first()).toHaveText('Пауза с 10:02');
		await expect(summary(page).locator('.pill').first()).toHaveClass(/\bw\b/);
		await expect(summary(page)).toContainText('Обработка приостановлена с');
		await expect(summary(page)).toContainText('много ошибок у моделей — пауза на несколько минут, продолжится сама');
		await expect(summary(page).locator('.bar i')).toHaveClass(/off/);

		await open(page, { data: () => fixture('case-overview-processing') });
		await expect(summary(page).locator('.pill').first()).toHaveText(S.overview_state_stopped);
		await expect(summary(page).locator('.pill').first()).toHaveClass(/\bs\b/);
		await expect(summary(page)).toContainText('Обработка приостановлена: исчерпан предел расходов на обработку дел — сообщите администратору');

		const d = fixture('case-overview');
		await open(page, {
			data: () => ({
				...d,
				overview: { ...d.overview, volumes: [], files_without_volume: [], e_case: [], check_sheets: [], index_coverage: { indexed: 0, total: 0 } },
				uploads: [], check_total: 0, files: {}
			})
		});
		await expect(summary(page)).toHaveAttribute('data-state', 'empty');
		await expect(summary(page).getByRole('heading')).toHaveText(S.overview_empty_title);
		await expect(summary(page).getByRole('link', { name: S.section_upload })).toBeVisible();
		await expect(page.getByTestId('case-tiles')).toHaveCount(0);
		await expect(page.getByTestId('case-composition')).toHaveCount(0);
	});

	test('переспрашивание: при возвращении на вкладку; нет связи — прежние сведения и «Повторить сейчас»; введённое и выбранное не сбрасываются', async ({ page }) => {
		let mode: 'ok' | 'down' | 'changed' = 'ok';
		const { overviewCalls } = await open(page, {
			overview: (r) => {
				if (mode === 'down') return r.abort('internetdisconnected');
				const d = processing();
				if (mode === 'changed') d.overview.index_coverage.indexed = 500;
				return r.fulfill({ json: d });
			}
		});
		await expect(summary(page).getByRole('heading')).toHaveText('Распознано 363 из 669 страниц');
		const form = page.getByTestId('case-goto').filter({ visible: true });
		await form.locator('select[name="t"]').selectOption('5/1');
		await form.locator('input[name="l"]').fill('45 об.');
		await form.locator('input[name="side"]').check();
		const before = overviewCalls();
		mode = 'changed';
		await refresh(page);
		await expect(summary(page).getByRole('heading')).toHaveText('Распознано 500 из 669 страниц');
		expect(overviewCalls()).toBe(before + 1);
		await expect(form.locator('select[name="t"]')).toHaveValue('5/1');
		await expect(form.locator('input[name="l"]')).toHaveValue('45 об.');
		await expect(form.locator('input[name="side"]')).toBeChecked();

		mode = 'down';
		await refresh(page);
		const offline = page.getByTestId('case-offline');
		await expect(offline.locator('.pill')).toHaveText(S.overview_state_offline);
		await expect(offline.getByRole('heading')).toHaveText(S.overview_offline_title);
		await expect(summary(page).getByRole('heading')).toHaveText('Распознано 500 из 669 страниц'); // прежние сведения
		await expect(form.locator('input[name="l"]')).toHaveValue('45 об.');
		mode = 'ok';
		await offline.getByRole('button', { name: S.overview_retry_now }).click();
		await expect(offline).toHaveCount(0);
		await expect(summary(page).getByRole('heading')).toHaveText('Распознано 363 из 669 страниц');
	});

	test('«Открыть лист»: пока юрист не выбрал том, стоит первый по порядку — и когда в деле появляются новые тома', async ({ page }) => {
		let both = false;
		const one = processing();
		await open(page, {
			overview: (r) => {
				const d = processing();
				if (!both) d.overview.volumes = d.overview.volumes.filter((v: any) => v.label === '5/1');
				return r.fulfill({ json: d });
			}
		});
		expect(one.overview.volumes.map((v: any) => v.label)).toEqual(['4', '5/1']);
		const select = page.getByTestId('case-goto').filter({ visible: true }).locator('select[name="t"]');
		await expect(select).toHaveValue('5/1');
		both = true;
		await refresh(page);
		await expect(select.locator('option')).toHaveText(['т. 4', 'т. 5/1']);
		await expect(select).toHaveValue('4');
	});

	test('обзор не пришёл с первого раза: ошибка с фразой сервиса и «Повторить»', async ({ page }) => {
		let broken = true;
		await open(page, {
			overview: (r) => (broken ? r.fulfill({ status: 500, json: { detail: 'внутренняя ошибка — повторите позже' } }) : r.fulfill({ json: fixture('case-overview') }))
		});
		await expect(summary(page)).toHaveAttribute('data-state', 'error');
		await expect(summary(page).locator('.pill')).toHaveText('Не получилось: внутренняя ошибка — повторите позже');
		broken = false;
		await summary(page).getByRole('button', { name: S.retry }).click();
		await expect(summary(page)).toHaveAttribute('data-state', 'ready');
	});
});

test.describe('«Проверьте листы», 1280', () => {
	test.use({ viewport: { width: 1280, height: 1100 } });

	test('группы по виду замечания; у каждого листа своя ссылка; части фразы без общих слов', async ({ page }) => {
		await open(page, { section: 'check' });
		await expect(page.getByTestId('case-check')).toContainText(S.check_hint);
		const groups = page.getByTestId('case-check-group');
		await expect(groups.locator('h3')).toHaveText([
			S.check_group_numbers, S.check_group_text, S.check_group_number_check, S.check_group_number_unset, S.check_group_gap, S.check_group_volume
		]);
		await expect(groups.locator('.cnt')).toHaveText(['1', '18 листов', '4 листа', '1', '1', '1']);
		const numbers = groups.nth(0);
		await expect(numbers.getByTestId('case-check-row')).toHaveText(/т\. 4, л\.д\. 16\s*«066328» \/ «698105»/);
		await expect(numbers.locator('a.ref')).toHaveAttribute('href', `/legal-tools/case/${F}/p/645`);
		await expect(numbers).toContainText(S.check_group_numbers_hint);
		const text = groups.nth(1);
		await expect(text.locator('p.mut').first()).toHaveText(/^На листе есть текст, который одно из распознаваний не переписало/);
		await expect(text.locator('a.chipl')).toHaveCount(12);
		await expect(text.locator('a.chipl').nth(1)).toHaveText('л.д. 15');
		await expect(text.locator('a.chipl').nth(1)).toHaveAttribute('href', new RegExp(`/legal-tools/case/${F}/p/\\d+$`));
		await text.getByRole('button', { name: 'ещё 6' }).click();
		await expect(text.locator('a.chipl')).toHaveCount(18);
		const unset = groups.nth(3);
		await expect(unset.getByTestId('case-check-row')).toHaveText(/т\. 4, стр\. 120\s*tom-2-chast-1\.pdf\s*прочитано «55», «32», «56»; между л\. 120 и л\. 122/);
		const gap = groups.nth(4);
		await expect(gap.getByTestId('case-check-row')).toContainText('не хватает не меньше 2 листов');
		await expect(gap.getByTestId('case-check-row').locator('.sm.mut')).toHaveText(/^по внутренней описи тома здесь:/);
		await expect(groups.nth(5)).toHaveText(/Том 4\s*в томе чёрно-белые 43 страницы из 209/);
		await expect(groups.nth(5).getByRole('button')).toHaveCount(0);
		await expect(page.locator('.main')).toContainText('показаны первые 7 из 31');
		await expect(groups.getByRole('checkbox')).toHaveCount(0); // отметки «проверено» нет — второй этап
		await noSideScroll(page);
	});

	test('сворачивание, «Показать ещё» и выбор тома не сбрасываются обновлением обзора', async ({ page }) => {
		const base = fixture('case-overview');
		const many = Array.from({ length: 20 }, (_, n) => ({
			page_id: 900 + n, volume_id: 4, label: `т. 4, л.д. ${20 + n}`, code: 'text_disagree', url: `/legal-tools/case/${F}/p/${900 + n}`,
			reason: `числа на листе прочитаны по-разному: «${1000 + n}» / «${2000 + n}» — сверьте с изображением листа`,
			parts: { pairs: [[String(1000 + n), String(2000 + n)]], values: `«${1000 + n}» / «${2000 + n}»` }
		}));
		const other = { page_id: 990, volume_id: 5, label: 'т. 5/1, л.д. 3', code: 'blurred', url: `/legal-tools/case/${F}/p/990`, reason: BLURRED };
		let extra = 0;
		await open(page, {
			section: 'check',
			data: () => ({
				...base,
				check_total: 22 + extra,
				overview: {
					...base.overview,
					volumes: [...base.overview.volumes, { id: 5, label: '5/1', status: 'reading', stage: '', pages: 10, files: [] }],
					check_sheets: [...many, other, base.overview.check_sheets[2], ...(extra ? [{ ...other, page_id: 991, label: 'т. 5/1, л.д. 4' }] : [])]
				}
			})
		});
		const groups = page.getByTestId('case-check-group');
		const numbers = groups.filter({ hasText: S.check_group_numbers });
		await expect(numbers.locator('.cnt')).toHaveText('20');
		await expect(numbers.getByTestId('case-check-row')).toHaveCount(5);
		await numbers.getByRole('button', { name: 'Показать ещё 15' }).click();
		await expect(numbers.getByTestId('case-check-row')).toHaveCount(20);
		const text = groups.filter({ hasText: S.check_group_text });
		await text.getByRole('button', { name: S.collapse }).click();
		await expect(text.locator('.chipl')).toHaveCount(0);
		await expect(text.getByRole('button', { name: S.expand })).toHaveAttribute('aria-expanded', 'false');
		await expect(groups.filter({ hasText: S.check_group_other })).toContainText(BLURRED);
		const volume = page.getByTestId('case-check-volume');
		await expect(volume.locator('option')).toHaveText([S.check_filter_all, 'том 4', 'том 5/1']);

		extra = 1;
		await refresh(page);
		await expect(groups.filter({ hasText: S.check_group_other }).getByTestId('case-check-row')).toHaveCount(2); // данные обновились
		await expect(numbers.getByTestId('case-check-row')).toHaveCount(20); // раскрытое осталось раскрытым
		await expect(text.locator('.chipl')).toHaveCount(0); // свёрнутое — свёрнутым

		await volume.selectOption({ label: 'том 5/1' });
		await expect(groups.locator('h3')).toHaveText([S.check_group_other]);
		extra = 0;
		await refresh(page);
		await expect(groups.filter({ hasText: S.check_group_other }).getByTestId('case-check-row')).toHaveCount(1);
		await expect(volume).toHaveValue(/.+/); // выбранный том остался
		await expect(groups.locator('h3')).toHaveText([S.check_group_other]);
	});

	test('пока обзор не пришёл — «Загрузка…», а не «Замечаний нет»; обзор не пришёл — ошибка и «Повторить»', async ({ page }) => {
		let mode: 'hold' | 'fail' | 'ok' = 'hold';
		const held: (() => void)[] = [];
		await open(page, {
			section: 'check',
			overview: async (r) => {
				if (mode === 'hold') await new Promise<void>((done) => held.push(done));
				if (mode === 'fail') return r.fulfill({ status: 503, json: { detail: 'сервис занят' } });
				return r.fulfill({ json: fixture('case-overview') });
			}
		});
		await expect(page.getByTestId('case-check-wait')).toHaveText(S.loading);
		await expect(page.getByTestId('case-check-none')).toHaveCount(0);
		mode = 'fail';
		held.splice(0).forEach((done) => done());
		await expect(page.getByTestId('case-check-wait').getByRole('button', { name: S.retry })).toBeVisible();
		await expect(page.getByTestId('case-check-none')).toHaveCount(0);
		mode = 'ok';
		await page.getByTestId('case-check-wait').getByRole('button', { name: S.retry }).click();
		await expect(page.getByTestId('case-check-group').first()).toBeVisible();
	});

	test('замечаний нет', async ({ page }) => {
		const d = fixture('case-overview');
		await open(page, { section: 'check', data: () => ({ ...d, check_total: 0, overview: { ...d.overview, check_sheets: [] } }) });
		await expect(page.locator('.main .pill')).toHaveText(S.check_empty);
		await expect(page.locator('.head .cnt')).toHaveCount(0);
	});
});

test.describe('«Загрузить материалы», 1280', () => {
	test.use({ viewport: { width: 1280, height: 1100 } });

	test('очередь: «что это» обязательно, том — номер или продолжение, папка, фото; отказы при выборе', async ({ page }) => {
		const posts: any[] = [];
		await open(page, {
			section: 'upload',
			data: processing,
			uploads: (r) => {
				if (r.request().method() === 'POST' && r.request().url().endsWith('/uploads')) {
					const b = r.request().postDataJSON();
					posts.push({ ...b, 'x-ai-case': r.request().headers()['x-ai-case'] });
					return r.fulfill({ status: 201, json: { upload: { id: `u-${posts.length}`, filename: b.filename, size: b.size, received: 0, part_size: 16777216, parts: [], status: 'receiving', phase: 'receiving' } } });
				}
				return r.fulfill({ json: { ok: true } });
			}
		});
		await expect(page.getByTestId('case-drop')).toContainText('Один файл — до 2000 МБ.');
		await expect(page.getByTestId('case-drop').getByRole('button')).toHaveText([S.upload_pick_files, S.upload_pick_folder_g]);
		await page.getByTestId('case-pick-files').setInputFiles([
			pdf('tom-11.pdf'), pdf('arbitr-otzyv.pdf'), pdf('письмо.docx'),
			{ name: 'a.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(10) }, { name: 'b.png', mimeType: 'image/png', buffer: Buffer.alloc(10) }
		]);
		await expect(page.getByTestId('case-toast')).toHaveText('«письмо.docx»: этот формат не принимается');
		const queue = page.getByTestId('case-queue');
		await expect(queue.locator('.cnt')).toHaveText('3');
		await expect(queue).toContainText(S.upload_kind_hint);
		const rows = queue.getByTestId('case-queue-row');
		await expect(rows).toHaveText([/tom-11\.pdf · 1 КБ/, /arbitr-otzyv\.pdf/, /Фото: 2 шт\. · 1 КБ/]);
		await expect(rows.nth(2).getByRole('radio')).toHaveCount(0); // у фото вида не спрашивают
		await expect(rows.nth(0).locator('legend')).toHaveText([S.upload_kind_question_g, S.upload_volume_legend]);
		await expect(rows.nth(0).getByRole('combobox').locator('option')).toHaveText([S.upload_continues_none, 'продолжение тома 4', 'продолжение тома 5/1']);

		await page.getByTestId('case-upload-start').click();
		await expect(queue.getByRole('alert')).toHaveText(S.upload_kind_required);
		await expect(rows.nth(0).locator('legend').first()).toHaveText(S.upload_kind_pick);
		expect(posts).toEqual([]);

		await rows.nth(0).getByRole('radio', { name: S.upload_kind_volume }).check();
		await rows.nth(0).getByRole('textbox').fill('11');
		await expect(rows.nth(0).getByRole('combobox')).toBeDisabled(); // номер заполнен — продолжение не учитывается
		await rows.nth(1).getByRole('radio', { name: S.upload_kind_ecase }).check();
		await rows.nth(2).getByRole('combobox').selectOption({ label: 'продолжение тома 5/1' });
		await expect(queue.getByRole('alert')).toHaveCount(0);

		// введённое в очереди не сбрасывается обновлением обзора и уходом в другой раздел
		await refresh(page);
		await page.getByTestId('case-nav-overview').click();
		await page.getByTestId('case-nav-upload').click();
		await expect(rows.nth(0).getByRole('textbox')).toHaveValue('11');
		await expect(rows.nth(1).getByRole('radio', { name: S.upload_kind_ecase })).toBeChecked();

		await page.getByTestId('case-upload-start').click();
		await expect(page.getByTestId('case-upload')).toHaveCount(4);
		await expect(queue).toHaveCount(0);
		await expect.poll(() => posts.length).toBe(4); // одновременно идут два, остальные — следом
		expect(posts.map((p) => [p.filename, p.input_kind, p.volume_hint, p.continues_volume_id, p['x-ai-case']])).toEqual([
			['tom-11.pdf', 'volume', '11', null, '1'],
			['arbitr-otzyv.pdf', 'e_case', null, null, '1'],
			['a.jpg', 'photo', null, 5, '1'],
			['b.png', 'photo', null, 5, '1']
		]);
		expect(new Set(posts.slice(2).map((p) => p.batch_id)).size).toBe(1);
		await expect(page.getByTestId('case-upload').first()).toContainText(S.upload_done);
	});

	test('список загрузок: передача, пауза и продолжение, отмена, очередь из двух; приём на сервере и оценка — у принятых', async ({ page }) => {
		const gates: Record<string, () => void> = {};
		const log: string[] = [];
		await open(page, {
			section: 'upload',
			data: processing,
			uploads: async (r) => {
				const url = new URL(r.request().url());
				const method = r.request().method();
				const tail = url.pathname.split('/uploads')[1] ?? '';
				log.push(`${method} ${tail}`);
				if (method === 'POST' && !tail) {
					const b = r.request().postDataJSON();
					return r.fulfill({ status: 201, json: { upload: { id: b.filename, filename: b.filename, size: b.size, received: 0, part_size: 400, parts: [], status: 'receiving', phase: 'receiving' } } });
				}
				if (method === 'GET') {
					const id = decodeURIComponent(tail.slice(1));
					return r.fulfill({ json: { id, filename: id, size: 1000, received: 400, part_size: 400, parts: [{ n: 1, size: 400 }], status: 'receiving', phase: 'receiving' } });
				}
				if (method === 'PUT' && tail.includes('/parts/2')) await new Promise<void>((resolve) => (gates[decodeURIComponent(tail.split('/')[1])] = resolve));
				return r.fulfill({ json: { ok: true } });
			}
		});
		// что прислал сервер: незавершённая чужая, идущий приём, отказ, повтор
		await expect(page.getByTestId('case-unfinished')).toContainText(S.upload_unfinished_title);
		await expect(page.getByTestId('case-unfinished')).toContainText('tom-7.pdf — 40 из 150 МБ');
		await expect(page.getByTestId('case-upload-server').locator('.pill')).toHaveText([
			S.upload_status_intake, S.upload_status_received, 'не принят: архив больше пределов распаковки — разделите его на части', S.upload_status_done_nofile_g
		]);
		await expect(page.getByTestId('case-uploads')).toContainText('Оценка распознавания принятых файлов: около 1,84 USD за 669 страниц.');
		await expect(page.getByTestId('case-upload-estimate')).toContainText(S.upload_estimate_hint);
		await expect(page.getByTestId('case-uploads').getByRole('link', { name: S.upload_goes_to_volumes_link })).toHaveAttribute('href', /s=volumes$/);

		await page.getByTestId('case-pick-files').setInputFiles(['1.jpg', '2.jpg', '3.jpg'].map((name) => ({ name, mimeType: 'image/jpeg', buffer: Buffer.alloc(1000) })));
		await page.getByTestId('case-upload-start').click();
		const items = page.getByTestId('case-upload');
		await expect(items).toHaveCount(3);
		await expect(items.nth(2)).toContainText(S.upload_waiting); // третий ждёт очереди
		await expect(items.nth(2).getByRole('button')).toHaveText([S.upload_cancel]);
		await expect(items.nth(0)).toHaveAttribute('data-state', 'running');
		await expect(items.nth(0)).toContainText('передаётся: 0,0 из 0,0 МБ');
		await expect(items.nth(0).getByRole('button')).toHaveText([S.upload_pause, S.upload_cancel]);
		await expect.poll(() => Object.keys(gates).sort()).toEqual(['1.jpg', '2.jpg']);
		expect(await items.nth(0).locator('.bar i').evaluate((e) => (e as HTMLElement).style.width)).toBe('40%');

		await items.nth(0).getByRole('button', { name: S.upload_pause }).click();
		await expect(items.nth(0)).toContainText('пауза: 0,0 из 0,0 МБ');
		await expect(items.nth(0).locator('.bar i')).toHaveClass(/off/);
		gates['1.jpg']();
		await expect(items.nth(2)).toHaveAttribute('data-state', 'running'); // место освободилось — пошёл третий
		await items.nth(0).getByRole('button', { name: S.upload_resume }).click();
		await expect(items.nth(0)).toContainText(S.upload_waiting);

		page.once('dialog', (d) => d.dismiss());
		await items.nth(1).getByRole('button', { name: S.upload_cancel }).click();
		await expect(items).toHaveCount(2);
		await expect.poll(() => log.filter((l) => l.startsWith('DELETE'))).toEqual(['DELETE /2.jpg']);
		gates['2.jpg']?.();
		await expect.poll(() => Object.keys(gates).includes('3.jpg')).toBe(true);
		gates['3.jpg']();
		await expect(items.filter({ hasText: '3.jpg' })).toContainText(S.upload_done);
		await expect(items.filter({ hasText: '3.jpg' }).getByRole('button')).toHaveCount(0);
		await expect.poll(() => log.filter((l) => l === 'GET /1.jpg').length).toBe(1); // продолжение спросило, что уже передано
	});

	test('оценки ещё нет: пояснение к ней («Она появляется…») без самой оценки не показывается', async ({ page }) => {
		const d = processing();
		await open(page, { section: 'upload', data: () => ({ ...d, estimate: { usd: null, pages: 0 } }) });
		await expect(page.getByTestId('case-uploads')).toBeVisible();
		await expect(page.getByTestId('case-upload-estimate')).toHaveCount(0);
		await expect(page.getByTestId('case-uploads')).not.toContainText(S.upload_estimate_hint);
	});

	test('продолжение после перезагрузки страницы: тот же файл досылает недостающие части; отмена незавершённой', async ({ page }) => {
		const puts: string[] = [];
		const deleted: string[] = [];
		const unfinished = { id: 'u-old', filename: 'tom-3.pdf', size: 1000, received: 800, part_size: 400, parts_total: 3, parts: [{ n: 1, size: 400 }, { n: 2, size: 400 }], missing: [3], status: 'receiving', phase: 'receiving', intake: 'none' };
		const scene: Scene = {
			section: 'upload',
			data: () => ({ ...fixture('case-overview'), uploads: deleted.length ? [] : [unfinished] }),
			uploads: (r) => {
				const tail = new URL(r.request().url()).pathname.split('/uploads')[1] ?? '';
				const method = r.request().method();
				if (method === 'GET') return r.fulfill({ json: unfinished });
				if (method === 'PUT') puts.push(tail);
				if (method === 'DELETE') deleted.push(tail);
				return r.fulfill({ json: { ok: true } });
			}
		};
		await open(page, scene);
		await expect(page.getByTestId('case-unfinished')).toContainText('tom-3.pdf — 0,0 из 0,0 МБ');
		// прежняя страница сервиса записала соответствие «файл → загрузка» под тем же ключом
		const file = { name: 'tom-3.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(1000) };
		await page.getByTestId('case-pick-files').setInputFiles([file]);
		await expect(page.getByTestId('case-queue')).toHaveCount(0); // вопросов нет: загрузка уже начата
		await expect(page.getByTestId('case-upload')).toContainText(S.upload_done);
		expect(puts).toEqual(['/u-old/parts/3']);
		expect(await page.evaluate((f) => localStorage.getItem(`case-up:${f}`), F)).toBe('{}');
		await expect(page.getByTestId('case-unfinished')).toHaveCount(0);

		// отмена незавершённой загрузки, которую страница не ведёт
		puts.length = 0;
		await open(page, scene);
		await page.getByTestId('case-unfinished').getByRole('button', { name: S.upload_cancel }).click();
		await expect(page.getByTestId('case-unfinished')).toHaveCount(0);
		expect(deleted).toEqual(['/u-old']);
	});
});

test.describe('телефон, 360', () => {
	test.use({ viewport: { width: 360, height: 760 } });

	for (const dark of [false, true]) {
		test(`каркас и обзор без прокрутки вбок, ${dark ? 'тёмная' : 'светлая'} схема: выбор раздела вверху, «Лист №» открывает окно`, async ({ page }) => {
			await open(page, { data: processing, dark });
			await expect(page.getByRole('navigation')).toHaveCount(0);
			await expect(page.locator('.top .rb')).toHaveAttribute('aria-label', S.nav_to_cases);
			await expect(page.getByTestId('case-menu-open')).toHaveText(S.nav_overview);
			await expect(page.getByTestId('case-goto').filter({ visible: true })).toHaveCount(0);
			await noSideScroll(page);
			if (dark) expect(await page.evaluate(() => getComputedStyle(document.querySelector('.card')!).backgroundColor)).toBe('rgb(30, 30, 40)');

			await page.getByTestId('case-goto-open').click();
			const dialog = page.getByRole('dialog');
			await expect(dialog.getByRole('heading')).toHaveText(S.goto_title_g);
			await expect(dialog.getByTestId('case-goto')).toHaveAttribute('action', `/legal-tools/case/${F}/ref`);
			await expect(dialog.locator('label')).toHaveText(S.goto_back_long);
			expect(await dialog.locator('input[name="l"]').evaluate((e) => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
			await page.keyboard.press('Escape');
			await expect(dialog).toHaveCount(0);

			await page.getByTestId('case-menu-open').click();
			const menu = page.getByTestId('case-menu');
			await expect(menu.getByRole('heading')).toHaveText(S.nav_title);
			await expect(menu.locator('a[data-testid^="case-nav-"]')).toHaveCount(15);
			await expect(menu.getByRole('link', { name: S.back_to_cases })).toHaveAttribute('href', '/case');
			await noSideScroll(page);
			await menu.getByTestId('case-nav-check').click();
			await expect(page.getByTestId('case-menu')).toHaveCount(0);
			await expect(page.getByTestId('case-menu-open')).toHaveText(S.section_check);
			await expect(page.getByTestId('case-check')).toBeVisible();
			await noSideScroll(page);
			await page.getByTestId('case-menu-open').click();
			await page.getByRole('button', { name: S.nav_close }).click();
			await expect(page.getByTestId('case-check')).toBeVisible();
		});
	}

	test('«Загрузить материалы» на телефоне: без прокрутки вбок, поля не меньше 16 px, нажимаемое не ниже 44 px', async ({ page }) => {
		await open(page, { section: 'upload', data: processing, uploads: () => {} });
		await page.getByTestId('case-pick-files').setInputFiles([pdf('Очень длинное название тома для проверки переноса строки — часть первая.pdf'), { name: 'a.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(10) }]);
		await expect(page.getByTestId('case-queue-row')).toHaveCount(2);
		await expect(page.getByTestId('case-drop').getByRole('button').filter({ visible: true })).toHaveText([S.upload_pick_files]);
		await noSideScroll(page);
		const sizes = await page.evaluate(() => ({
			fields: [...document.querySelectorAll('.cg input[type="text"], .cg select')].filter((e) => (e as HTMLElement).offsetParent).map((e) => parseFloat(getComputedStyle(e).fontSize)),
			targets: [...document.querySelectorAll('.cg .main button, .cg .main select, .cg .main input[type="text"], .cg .main .opt')].filter((e) => (e as HTMLElement).offsetParent).map((e) => Math.round(e.getBoundingClientRect().height))
		}));
		expect(Math.min(...sizes.fields)).toBeGreaterThanOrEqual(16);
		expect(Math.min(...sizes.targets)).toBeGreaterThanOrEqual(44);
	});
});
