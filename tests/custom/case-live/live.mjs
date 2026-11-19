// ai-dvokat: живая проверка «Моих дел» в настоящем браузере на своей среде (run.sh): вход настоящей формой, список —
// от настоящего legal-tools через настоящий Open WebUI и Caddy с правилами сервера, «Завести дело» заводит дело.
// Подмен нет ни одной. Печатает OK / FAIL по шагам; код выхода 1 — есть FAIL.
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (name) => {
	const i = process.argv.indexOf(`--${name}`);
	return i > 0 ? process.argv[i + 1] : undefined;
};
const state = JSON.parse(readFileSync(arg('state'), 'utf8'));
const out = arg('out');
if (out) mkdirSync(out, { recursive: true });
const base = state.base;
// прежние страницы сервиса: по своему адресу, а при включённой переадресации — у сервиса прежнего образа рядом
const OLD_BASE = process.env.LIVE_OLD_BASE || '/legal-tools';
let fails = 0;
const ok = (cond, what) => {
	console.log(`${cond ? 'OK  ' : 'FAIL'} ${what}`);
	if (!cond) fails += 1;
};
const texts = (locator) => locator.allTextContents().then((list) => list.map((t) => t.replace(/\s+/g, ' ').trim()));
const shot = async (page, name) => {
	if (!out) return;
	const full = await page.evaluate(() => document.querySelector('.cg-view')?.scrollHeight ?? 0);
	const size = page.viewportSize();
	if (full > size.height) await page.setViewportSize({ width: size.width, height: full });
	await page.screenshot({ path: join(out, `${name}.png`) });
	await page.setViewportSize(size);
};
const sideScroll = (page) =>
	page.evaluate(() => {
		const view = document.querySelector('.cg-view');
		return (view ? view.scrollWidth - view.clientWidth : 0) + (document.documentElement.scrollWidth - window.innerWidth);
	});
const visible = (page, testid) => page.getByTestId(testid).filter({ visible: true });
const ready = (page) => page.waitForSelector('[data-testid="my-cases"][data-phase="ready"]', { timeout: 30000 });

async function signIn(page, who, target) {
	await page.goto(base + target);
	await page.waitForURL((url) => url.pathname === '/auth', { timeout: 30000 });
	const asked = new URL(page.url()).searchParams.get('redirect');
	await page.locator('input[type="email"]').fill(state.emails[who]);
	await page.locator('input[type="password"]').fill(state.password);
	await page.locator('button[type="submit"]').click();
	await page.waitForURL((url) => url.pathname === target, { timeout: 30000 });
	return asked;
}

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });

// ---------------------------------------------------------------- юрист из группы выпуска, компьютер
{
	const context = await browser.newContext({ viewport: { width: 1280, height: 1020 }, locale: 'ru-RU' });
	const page = await context.newPage();
	const seen = [];
	page.on('response', (r) => {
		const url = new URL(r.url());
		seen.push({ origin: url.origin, path: url.pathname, status: r.status(), auth: r.request().headers().authorization ?? '' });
	});
	const external = [];
	page.on('request', (r) => {
		if (!r.url().startsWith(base) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url());
	});

	const asked = await signIn(page, 'owner', '/case');
	ok(asked === '/case', `без входа /case ведёт на страницу входа с возвратом (redirect=${asked}), после входа — обратно`);
	await ready(page);
	ok((await page.locator('h1').textContent()) === 'Мои дела', 'страница «Мои дела» открыта по адресу /case, слова — из строк сервиса');
	ok((await page.title()).startsWith('Мои дела'), `заголовок вкладки: «${await page.title()}»`);

	const rowTitles = await texts(visible(page, 'case-row').locator('.title'));
	ok(
		JSON.stringify([...rowTitles].sort()) ===
			JSON.stringify(['А40-123456/2025', 'Бета-Логистик (апелляция)', 'Миронов Д. П. — наследство', 'Северный ветер — поставка']),
		`дела пришли от legal-tools: ${rowTitles.join(' | ')}`
	);
	const pills = await texts(visible(page, 'case-row').locator('.mc-pill'));
	ok(JSON.stringify([...pills].sort()) === JSON.stringify(['моё', 'моё', 'общее', 'только чтение']), `пометки доступа: ${pills.join(', ')}`);
	const a40 = visible(page, 'case-row').filter({ hasText: 'А40-123456/2025' });
	ok((await a40.locator('.path').textContent()) === 'Арбитраж / 2025', 'путь вложенной папки: «Арбитраж / 2025»');
	ok((await a40.locator('.vol').textContent()) === 'томов пока нет', 'дело без томов: «томов пока нет»');
	const scopes = await texts(page.locator('[data-testid^="case-scope-"]'));
	ok(JSON.stringify(scopes) === JSON.stringify(['Все дела 4', 'Мои 2', 'Общие со мной 2']), `счётчики меню: ${scopes.join(' · ')}`);
	const sections = await texts(page.getByTestId('case-section'));
	ok(JSON.stringify(sections) === JSON.stringify(['Арбитраж', '2025']), `разделы из чата по дереву папок Open WebUI: ${sections.join(' → ')}`);
	const free = await texts(visible(page, 'case-folder').locator('.title'));
	ok(
		JSON.stringify([...free].sort()) === JSON.stringify(['2025', 'Арбитраж', 'Гусева М. О. — раздел имущества', 'Тихонов — трудовой спор']),
		`папки без дела: ${free.join(' | ')}`
	);
	const tikhonov = visible(page, 'case-folder').filter({ hasText: 'Тихонов — трудовой спор' });
	ok(
		(await tikhonov.getByRole('button').count()) === 0 && (await tikhonov.locator('.mc-pill').textContent())?.trim() === 'только чтение',
		'общая папка «только чтение»: кнопки «Завести дело» нет, пометка есть'
	);
	ok((await visible(page, 'case-folder').getByRole('button', { name: 'Завести дело' }).count()) === 3, '«Завести дело» — у трёх папок с правом записи');
	const tiles = await texts(page.locator('[data-testid^="case-tile-"] .col'));
	ok(tiles[0] === 'Дела 4из них 2 общих' || tiles[0] === 'Дела 4 из них 2 общих', `плитки: ${tiles.join(' · ')}`);

	const strings = seen.filter((r) => r.path === '/legal-tools/api/cases/ui.json');
	const listing = seen.filter((r) => r.path === '/legal-tools/api/cases');
	ok(strings.length === 1 && strings[0].status === 200 && strings[0].auth === '', 'строки — ручкой сервиса через Caddy (200, без токена)');
	ok(listing.length === 1 && listing[0].status === 200 && listing[0].auth.startsWith('Bearer '), 'список — GET /legal-tools/api/cases с токеном сессии (200)');
	const fonts = seen.filter((r) => /\/_app\/immutable\/assets\/geologica-.*\.woff2$/.test(r.path));
	ok(fonts.length >= 2 && fonts.every((r) => r.status === 200 && r.origin === base), `шрифт Geologica — свои файлы сборки (${fonts.length} шт., 200)`);
	ok(await page.evaluate(() => document.fonts.check('500 15px Geologica', 'Дело')), 'шрифт Geologica применён');
	ok(external.length === 0, `внешних запросов со страницы нет${external.length ? ': ' + external.slice(0, 3).join(', ') : ''}`);
	ok((await sideScroll(page)) === 0, '1280 px: прокрутки вбок нет');
	await shot(page, 'live-1280-light');

	// отбор на настоящих данных
	await page.getByTestId('case-scope-shared').click();
	ok((await visible(page, 'case-row').count()) === 2 && (await visible(page, 'case-folder').count()) === 1, '«Общие со мной»: 2 дела и 1 папка без дела');
	await page.getByTestId('case-scope-all').click();
	await page.getByTestId('case-section').first().click();
	ok(
		JSON.stringify(await texts(visible(page, 'case-row').locator('.title'))) === JSON.stringify(['А40-123456/2025']) &&
			JSON.stringify(await texts(visible(page, 'case-folder').locator('.title'))) === JSON.stringify(['2025']),
		'раздел «Арбитраж»: дело из вложенной папки и папка «2025»'
	);
	await page.getByTestId('case-section').first().click();

	// тёмная схема — темой чата
	await page.evaluate(() => localStorage.setItem('theme', 'dark'));
	await page.reload();
	await ready(page);
	const dark = await page.evaluate(() => ({
		html: document.documentElement.classList.contains('dark'),
		card: getComputedStyle(document.querySelector('[data-testid="case-list"]')).backgroundColor
	}));
	ok(dark.html && dark.card === 'rgb(30, 30, 40)', `тема чата «тёмная» → страница тёмная (карточка ${dark.card})`);
	await shot(page, 'live-1280-dark');
	await page.setViewportSize({ width: 360, height: 800 });
	await page.waitForTimeout(200);
	ok((await sideScroll(page)) === 0, '360 px, тёмная: прокрутки вбок нет');
	await shot(page, 'live-360-dark');
	await page.evaluate(() => localStorage.setItem('theme', 'light'));
	await page.reload();
	await ready(page);
	ok((await sideScroll(page)) === 0 && (await visible(page, 'case-row').count()) === 0 && (await page.locator('a.mc-line').filter({ visible: true }).count()) === 4,
		'360 px, светлая: прокрутки вбок нет, дела — строками-ссылками');
	await shot(page, 'live-360-light');
	await page.setViewportSize({ width: 1280, height: 1020 });

	// «Завести дело» — настоящая запись
	const guseva = state.folders.guseva;
	const post = page.waitForResponse((r) => r.url().endsWith(`/legal-tools/api/cases/${guseva}`) && r.request().method() === 'POST');
	await visible(page, 'case-folder').filter({ hasText: 'Гусева М. О. — раздел имущества' }).getByRole('button').click();
	const created = await post;
	const sent = await created.request().allHeaders(); // Origin ставит браузер: он виден только в полном наборе
	ok(created.status() === 201 && sent['x-ai-case'] === '1' && sent.origin === base,
		`«Завести дело»: POST → ${created.status()}, X-Ai-Case: 1, Origin ${sent.origin} принят сервисом`);
	await page.waitForURL(`${base}/case/${guseva}`, { timeout: 30000 });
	await page.waitForSelector('[data-testid="case-summary"][data-state="empty"]', { timeout: 30000 });
	ok((await page.locator('.head h1').textContent()) === 'Гусева М. О. — раздел имущества',
		`после заведения открыта страница дела форка /case/<папка>: «${await page.title()}»`);
	await page.goto(base + '/case');
	await ready(page);
	ok((await visible(page, 'case-row').filter({ hasText: 'Гусева М. О. — раздел имущества' }).count()) === 1 &&
		(await texts(page.locator('[data-testid^="case-scope-"]')))[0] === 'Все дела 5', 'дело заведено: в «Моих делах» теперь 5 дел, папка ушла из «Папок без дела»');
	const open = visible(page, 'case-row').filter({ hasText: 'Гусева М. О. — раздел имущества' }).getByRole('link', { name: 'Открыть дело' });
	ok((await open.getAttribute('href')) === `/case/${guseva}`, '«Открыть дело» ведёт на страницу дела форка');
	// прежняя страница дела сервиса жива по своему адресу
	const oldCase = await page.goto(`${base}${OLD_BASE}/case/${guseva}`);
	await page.waitForSelector('body[data-page="case"]');
	ok(oldCase.status() === 200 && (await page.title()).includes('Гусева'), `прежняя страница дела /legal-tools/case/<папка> работает: «${await page.title()}»`);

	// прежняя страница «Мои дела» сервиса жива (старый адрес)
	const old = await page.goto(`${base}${OLD_BASE}/case/`);
	await page.waitForSelector('table');
	ok(old.status() === 200 && (await page.locator('h1').textContent()) === 'Мои дела' && (await page.locator('tbody tr').count()) === 8,
		'прежняя страница /legal-tools/case/ работает как была (8 папок таблицей)');

	// чат: пункт «Дела» в левой панели, переход без перезагрузки и обратно; стили «Г» в чат не попадают
	await page.goto(base + '/');
	const link = visible(page, 'custom-cases-link').first();
	await link.waitFor({ timeout: 30000 });
	const chatFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
	await page.evaluate(() => (window.__sameDocument = true));
	await page.keyboard.press('Escape');
	await link.click({ timeout: 15000 });
	await page.waitForURL(base + '/case');
	await ready(page);
	ok(await page.evaluate(() => window.__sameDocument === true), 'пункт «Дела» в панели чата открывает /case без перезагрузки приложения');
	ok((await page.locator('#sidebar').count()) === 0 && (await page.locator('nav[aria-label="Какие дела показывать"]').count()) === 1,
		'на странице «Дел» левой панели чата нет: своё меню');
	await page.locator('a.mc-chat').filter({ visible: true }).click();
	await page.waitForURL(base + '/');
	await visible(page, 'custom-cases-link').first().waitFor();
	const after = await page.evaluate(() => ({
		same: window.__sameDocument === true,
		font: getComputedStyle(document.body).fontFamily,
		cg: document.querySelectorAll('.cg').length,
		select: getComputedStyle(document.querySelector('select') ?? document.body).appearance
	}));
	ok(after.same && after.cg === 0 && after.font === chatFont && !/Geologica/.test(after.font),
		'«Перейти в чат» возвращает в чат без перезагрузки; шрифт и стили чата те же, что до захода в «Дела»');
	await context.close();
}

// ---------------------------------------------------------------- юрист вне группы выпуска
{
	const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'ru-RU' });
	const page = await context.newPage();
	await signIn(page, 'outsider', '/case');
	await page.waitForSelector('[data-testid="my-cases"][data-phase="error"]', { timeout: 30000 });
	const title = await page.getByTestId('case-error').getByRole('heading').textContent();
	ok(title === 'Не найдено' && (await page.getByTestId('case-retry').count()) === 1, `юрист вне группы выпуска: «${title}» и «Повторить»`);
	await shot(page, 'live-1280-outsider');
	await page.goto(base + '/');
	const asked = [];
	page.on('response', (r) => r.url().endsWith('/legal-tools/api/cases/access') && asked.push(r.status()));
	await page.locator('#sidebar-new-chat-button').filter({ visible: true }).first().waitFor({ timeout: 30000 });
	await page.waitForTimeout(1500);
	ok((await visible(page, 'custom-cases-link').count()) === 0 && asked.length >= 1 && asked.every((x) => x === 404),
		`юрист вне группы: чат открыт, пункта «Дела» в панели нет (сервис ответил 404, как на всех путях дела; запросов: ${asked.length})`);
	await context.close();
}

await browser.close();
console.log(fails ? `ИТОГ: FAIL — ${fails}` : 'ИТОГ: все проверки OK');
process.exit(fails ? 1 : 0);
