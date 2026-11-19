// ai-dvokat: ПЛАТНАЯ живая проверка страниц «Дел» — только по слову владельца и только с `--confirm-paid`.
// Своя среда (run.sh с LIVE_ENV_ONLY и настоящим провайдером: LIVE_OPENROUTER_URL, LIVE_OPENROUTER_KEY), данные —
// выдуманный том из репозитория (corpus/case-v1). Путь юриста там, где подставная модель его не даёт пройти:
//   1) настоящее распознавание небольшого тома: ход обработки, замечания в «Проверьте листы», лист с настоящим
//      текстом и цитатой по ссылке, паспорт и хронология, построенные настоящей моделью;
//   2) проход таблицы настоящей моделью с малым пределом прохода: «готово не полностью» → «Дочитать с новым пределом»
//      → дочитано; открытая таблица с настоящими цитатами и переход на лист с местом цитаты;
//   3) окно подтверждения при цене больше 1 USD — без траты: цены среды завышаются, окно открывается, «Отмена».
// Предохранители: предел расходов дела в среде (LIVE_BUDGET_USD, не выше 1,5), оценка каждого шага до запуска — шаг
// дороже `--step-usd` (1 USD) не запускается. Факт трат — журнал расходов сервиса (usage_ledger) и счёт ключа у
// провайдера до и после. Ключ не печатается.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const arg = (name) => {
	const i = process.argv.indexOf(`--${name}`);
	return i > 0 ? process.argv[i + 1] : undefined;
};
if (!process.argv.includes('--confirm-paid')) {
	console.error('платная проверка: нужен --confirm-paid (и слово владельца)');
	process.exit(2);
}
const state = JSON.parse(readFileSync(arg('state'), 'utf8'));
const volume = arg('volume');
const out = arg('out');
const STEP_USD = Number(arg('step-usd') ?? 1);
const compose = (arg('compose') ?? '').split(' ').filter(Boolean); // «docker compose -p … -f …» своей среды
if (out) mkdirSync(out, { recursive: true });
const base = state.base;
let fails = 0;
let skipped = 0;
const found = []; // что платная проверка нашла (для отчёта)
const ok = (cond, what) => {
	console.log(`${cond ? 'OK  ' : 'FAIL'} ${what}`);
	if (!cond) fails += 1;
	return !!cond;
};
const cannot = (what) => {
	console.log(`НЕТ  не проверено: ${what}`);
	skipped += 1;
};
const note = (what) => {
	console.log(`     ${what}`);
	found.push(what);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const one = (s) =>
	String(s ?? '')
		.replace(/\s+/g, ' ')
		.trim();
const texts = (locator) => locator.allTextContents().then((list) => list.map(one));
const shot = async (page, name) => {
	if (!out) return;
	const full = await page.evaluate(() => document.querySelector('.cg-view')?.scrollHeight ?? 0);
	const size = page.viewportSize();
	if (full > size.height)
		await page.setViewportSize({ width: size.width, height: Math.min(full, 6000) });
	await page.screenshot({ path: join(out, `${name}.png`), fullPage: !full });
	await page.setViewportSize(size);
};
async function api(method, path, token, body, headers = {}) {
	const r = await fetch(base + path, {
		method,
		headers: {
			Accept: 'application/json',
			...(body ? { 'Content-Type': 'application/json' } : {}),
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...headers
		},
		body: body ? JSON.stringify(body) : undefined
	});
	const text = await r.text();
	let data = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = text.slice(0, 200);
	}
	return { status: r.status, data };
}
const sql = (q) =>
	execFileSync(
		compose[0],
		[
			...compose.slice(1),
			'exec',
			'-T',
			'pg',
			'psql',
			'-U',
			'postgres',
			'-d',
			'legal_tools',
			'-Atc',
			q
		],
		{ encoding: 'utf8' }
	).trim();
/** Потрачено по журналу расходов сервиса (единственный источник денег у сервиса), USD. */
const ledger = () => Number(sql('SELECT coalesce(sum(usd), 0) FROM usage_ledger') || 0);
/** Счёт ключа у провайдера (usage, USD) — чтобы сверить журнал сервиса с фактом провайдера. */
async function providerUsage() {
	const key = process.env.LIVE_OPENROUTER_KEY;
	if (!key) return null;
	try {
		const r = await fetch('https://openrouter.ai/api/v1/key', {
			headers: { Authorization: `Bearer ${key}` }
		});
		const d = (await r.json()).data ?? {};
		return typeof d.usage === 'number' ? d.usage : null;
	} catch {
		return null;
	}
}
const owner = (
	await api('POST', '/api/v1/auths/signin', null, {
		email: state.emails.owner,
		password: state.password
	})
).data;
const S = (await api('GET', '/legal-tools/api/cases/ui.json')).data.strings;
const folder = (
	await api('POST', '/api/v1/folders/', owner.token, { name: 'Платная проверка — Северный ветер' })
).data.id;
const CASE = `/case/${folder}`;
const tools = (path) =>
	api('GET', `/legal-tools/api/cases/${folder}${path}`, owner.token).then((r) => r.data);
const usage0 = await providerUsage();
const ledger0 = ledger();
const stamp = (t0) => `${Math.round((Date.now() - t0) / 1000)} с`;
async function step(name, fn) {
	try {
		await fn();
	} catch (e) {
		// что было на экране, когда шаг оборвался
		await shot(page, `paid-fail-${name.replace(/[^a-zа-яё0-9]+/gi, '-')}`).catch(() => undefined);
		const seen = await page
			.evaluate(() =>
				(document.querySelector('.cg-view') ?? document.body).innerText
					.replace(/\s+/g, ' ')
					.slice(0, 500)
			)
			.catch(() => '');
		console.log(
			`     при обрыве шага «${name}» на странице ${page.url().replace(base, '')}: ${seen}`
		);
		ok(
			false,
			`${name}: шаг оборвался — ${String(e?.message ?? e)
				.split('\n')[0]
				.slice(0, 240)}`
		);
	}
}

const browser = await chromium.launch({
	executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
});
const context = await browser.newContext({
	viewport: { width: 1280, height: 1000 },
	locale: 'ru-RU',
	acceptDownloads: true
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
const dlg = () => page.locator('dialog[open]');
const refresh = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
const go = async (slug) => {
	await page
		.locator(`nav.nav [data-testid="case-nav-${slug || 'overview'}"]`)
		.first()
		.click();
	await page.waitForURL(`${base}${CASE}${slug ? `/${slug}` : ''}`);
};
/** Предел трат одного прохода в настройках своей среды: сервис перезапускается с новым значением. */
async function sweepMax(value) {
	if (!compose.length) return;
	execFileSync(
		compose[0],
		[...compose.slice(1), 'up', '-d', '--pull', 'never', 'tools', 'jobs-worker'],
		{
			env: { ...process.env, LIVE_SWEEP_MAX_USD: value },
			stdio: 'ignore'
		}
	);
	await healthy();
}
async function healthy() {
	for (let i = 0; i < 90; i++) {
		await sleep(2000);
		if ((await api('GET', '/legal-tools/health').catch(() => ({ status: 0 }))).status === 200)
			return;
	}
}
const toast = (text) =>
	page
		.getByText(text, { exact: true })
		.last()
		.waitFor({ timeout: 20000 })
		.then(
			() => true,
			() => false
		);

// ================================================================ 1. настоящее распознавание тома
let pagesTotal = 0;
await step('распознавание', async () => {
	await page.goto(base + CASE);
	await page.waitForURL((url) => url.pathname === '/auth', { timeout: 30000 });
	await page.locator('input[type="email"]').fill(state.emails.owner);
	await page.locator('input[type="password"]').fill(state.password);
	await page.locator('button[type="submit"]').click();
	await page.waitForURL((url) => url.pathname === CASE, { timeout: 30000 });
	await page.getByTestId('case-none').getByRole('button', { name: S.create_case }).click();
	await page.waitForSelector('[data-testid="case-summary"][data-state="empty"]', {
		timeout: 30000
	});
	await go('upload');
	await page.getByTestId('case-pick-files').setInputFiles(volume);
	const row = page.getByTestId('case-queue-row');
	await row.getByRole('radio', { name: 'том дела' }).check();
	await row.getByRole('textbox').fill('1');
	const t0 = Date.now();
	await page.getByTestId('case-upload-start').click();
	// оценка сервиса появляется, когда файл принят и страницы посчитаны; обработка идёт под пределом расходов дела
	let estimate = '';
	let progress = [];
	let last = '';
	let d = null;
	for (let i = 0; i < 400; i++) {
		d = await tools('');
		const est = d?.estimate;
		if (est?.usd != null && !estimate) {
			estimate = `${est.usd} USD на ${est.pages} стр.`;
			pagesTotal = Number(est.pages) || 0;
			console.log(`     оценка сервиса на обработку: ${estimate}`);
			if (Number(est.usd) > STEP_USD) {
				ok(
					false,
					`оценка обработки ${est.usd} USD больше ${STEP_USD} USD — по правилу проверки нужно слово координатора; обработку держит предел расходов дела среды`
				);
				throw new Error('шаг дороже предела');
			}
		}
		const idx = d?.overview?.index_coverage ?? {};
		const now = `${idx.indexed ?? 0}/${idx.total ?? 0}`;
		if (now !== last) {
			progress.push(now);
			last = now;
		}
		const files = Object.values(d?.files ?? {});
		const vols = d?.overview?.volumes ?? [];
		const paused = d?.paused;
		if (paused) {
			ok(false, `обработка встала на паузу: ${JSON.stringify(paused).slice(0, 200)}`);
			throw new Error('пауза');
		}
		if (
			files.length &&
			files.every((f) => f.status === 'indexed') &&
			vols.length &&
			vols.every((v) => v.status === 'inventory_ready') &&
			idx.total &&
			idx.indexed === idx.total
		)
			break;
		if (i === 4) {
			await go('');
			await shot(page, 'paid-overview-processing');
		}
		await sleep(4000);
	}
	const vols = d?.overview?.volumes ?? [];
	ok(
		vols.length === 1 && vols[0].status === 'inventory_ready',
		`том «${basename(volume)}» распознан настоящей моделью за ${stamp(t0)}: ход «распознано/всего» — ${progress.slice(0, 12).join(' → ')}${progress.length > 12 ? ' …' : ''}; оценка сервиса — ${estimate || 'не показана'}`
	);
	await go('');
	await refresh();
	await page.waitForSelector('[data-testid="case-summary"]');
	await shot(page, 'paid-overview-ready');
});

// ================================================================ «Проверьте листы», лист, паспорт, хронология
let sheetWithText = null;
await step('что построила модель', async () => {
	const d = await tools('');
	const checks = d.overview.check_sheets ?? [];
	await go('check');
	await page.getByTestId('case-check').waitFor({ timeout: 30000 });
	const heads = await texts(page.getByTestId('case-check-group').locator('h3'));
	ok(
		true,
		`«Проверьте листы» после настоящего распознавания: замечаний ${d.overview.check_total ?? checks.length}; группы — ${heads.join(' · ') || 'нет'}`
	);
	for (const c of checks.slice(0, 6))
		note(`замечание: ${one(c.label)} — ${one(c.text ?? c.reason ?? '').slice(0, 140)}`);
	await shot(page, 'paid-check');
	// лист с настоящим текстом и цитатой по ссылке
	const vol = d.overview.volumes[0];
	const pages = (await tools(`/pages?volume=${vol.id}`)).pages ?? [];
	for (const p of pages) {
		const sh = await tools(`/pages/${p.id}`);
		if ((sh.text ?? '').length > 300) {
			sheetWithText = sh;
			break;
		}
	}
	if (!sheetWithText) {
		ok(false, 'ни у одного листа тома нет текста длиннее 300 знаков');
		return;
	}
	const T = sheetWithText;
	const a = T.text.indexOf(' ', 60) + 1;
	const b = Math.min(T.text.length, a + 70);
	await page.goto(`${base}/legal-tools/case/${folder}/p/${T.page_id}?v=${T.read_id}&hl=${a}-${b}`);
	await page.waitForSelector('body.g[data-page="sheet"]');
	const mark = await page.locator('#hl').textContent();
	const img = await page.locator('#sheet-img').evaluate((el) => el.naturalWidth);
	const checksOnSheet = await texts(page.locator('#sheet-checks li'));
	ok(
		mark === T.text.slice(a, b) && img > 0,
		`лист «${one(T.label)}» с настоящим текстом (${T.text.length} знаков): цитата по ссылке выделена («${one(mark).slice(0, 50)}…»), изображение ${img} px; о номере — «${one(T.number_note_page ?? '')}»; сверьте — ${checksOnSheet.length ? checksOnSheet.map((x) => `«${x.slice(0, 60)}»`).join('; ') : 'нет'}`
	);
	note(`начало настоящего текста листа: «${one(T.text).slice(0, 160)}…»`);
	await shot(page, 'paid-sheet-hl');
	await page.goto(base + CASE);
	await page.getByTestId('case-summary').waitFor({ timeout: 30000 });
	// паспорт и хронология строятся после описи — ждём, пока появятся
	// паспорт и хронология строятся после описи: сначала разбираются документы («Паспорт строится…»), потом паспорт
	let facts = null;
	let building = '';
	const t1 = Date.now();
	for (let i = 0; i < 150; i++) {
		facts = await tools('/facts');
		const p = await tools('/passport');
		if (p?.built && p?.state && !p.state.pending) break;
		if (i === 1) {
			await go('passport');
			building = one(
				await page
					.getByTestId('case-passport-note')
					.textContent()
					.catch(() => '')
			);
			await shot(page, 'paid-passport-building');
		}
		await sleep(5000);
	}
	if (building)
		note(
			`пока карта дела строится, раздел говорит: «${building.slice(-70)}» (построена через ${stamp(t1)})`
		);
	await page.goto(base + CASE);
	await page.getByTestId('case-summary').waitFor({ timeout: 30000 });
	await go('passport');
	await page.getByTestId('case-passport-about').waitFor({ timeout: 90000 });
	const items = await texts(page.getByTestId('case-passport-item'));
	const parties = await texts(page.getByTestId('case-party'));
	ok(
		items.length > 0,
		`паспорт дела построен настоящей моделью: значений ${items.length}, участников ${parties.length}`
	);
	for (const x of items.slice(0, 5)) note(`паспорт: ${x.slice(0, 160)}`);
	for (const x of parties.slice(0, 3)) note(`участник: ${x.slice(0, 160)}`);
	await shot(page, 'paid-passport');
	await go('chronology');
	await page.getByTestId('case-facts').waitFor({ timeout: 60000 });
	const first = await texts(page.getByTestId('case-fact'));
	ok(
		first.length > 0 && (facts?.total ?? 0) > 0,
		`хронология построена настоящей моделью: записей ${facts?.total ?? 0}; первая — «${(first[0] ?? '').slice(0, 160)}»`
	);
	for (const x of first.slice(1, 4)) note(`хронология: ${x.slice(0, 160)}`);
	await shot(page, 'paid-chronology');
});

// ================================================================ 2. проход таблицы с малым пределом прохода
await step('проход таблицы', async () => {
	await go('tables');
	const form = page.getByTestId('case-tables-new');
	await form.waitFor({ timeout: 60000 });
	const spentBefore = one(await page.getByTestId('case-spent').textContent());
	await form.getByRole('radio', { name: 'Реестр доказательств' }).check();
	const start = page.getByTestId('case-tables-start');
	await page.waitForFunction(
		() =>
			/USD/.test(document.querySelector('[data-testid="case-tables-start"]')?.textContent ?? ''),
		null,
		{ timeout: 60000 }
	);
	const price = one(await start.textContent());
	const usd = Number((price.match(/около (?:< )?([\d,]+) USD/) ?? [])[1]?.replace(',', '.') ?? NaN);
	if (!(usd <= STEP_USD)) {
		ok(
			false,
			`оценка прохода «${price}» больше ${STEP_USD} USD или неизвестна — проход не запускаю`
		);
		return;
	}
	// предел трат прохода в среде — меньше оценки, чтобы проход остановился на нём (как у большого дела при обычном пределе)
	const small = Math.max(0.002, Number((usd * 0.2).toFixed(4)));
	await sweepMax(String(small));
	await page.reload();
	await form.waitFor({ timeout: 60000 });
	await form.getByRole('radio', { name: 'Реестр доказательств' }).check();
	await page.waitForFunction(
		() =>
			/USD/.test(document.querySelector('[data-testid="case-tables-start"]')?.textContent ?? ''),
		null,
		{ timeout: 60000 }
	);
	console.log(`     предел трат прохода в среде: ${small} USD при оценке ${usd} USD`);
	const t0 = Date.now();
	await start.click();
	ok(
		!(await dlg().count()) && ((await toast(S.tables_started)) || (await toast(S.tables_cached))),
		`запуск «Реестр доказательств»: на кнопке «${price}», цена до 1 USD — без окна; до запуска: «${spentBefore}»`
	);
	const row = page.getByTestId('case-table-row').first();
	await row.waitFor({ timeout: 60000 });
	const waitStatus = async () => {
		let status = '';
		for (let i = 0; i < 160; i++) {
			status = (await texts(row.locator('.pill'))).join(' · ');
			if (
				[S.tables_status_done, S.tables_status_partial, S.tables_status_failed].some((x) =>
					status.includes(x)
				)
			)
				break;
			await sleep(3000);
			await refresh();
		}
		return status;
	};
	let status = await waitStatus();
	ok(
		status.includes(S.tables_status_partial),
		`проход остановился на пределе трат прохода: в перечне «${status}» (${stamp(t0)})`
	);
	await shot(page, 'paid-tables-partial');
	await row.getByTestId('case-table-open').click();
	await page.waitForURL(new RegExp(`${CASE}/tables/[0-9a-f-]+$`));
	await page.getByTestId('case-table-head').waitFor({ timeout: 60000 });
	const factsText = one(await page.getByTestId('case-table-facts').textContent());
	note(`открытая таблица, готово не полностью: ${factsText.slice(0, 260)}`);
	await shot(page, 'paid-table-partial');
	// предел прохода поднимает юрист; надбавку сервис считает от обычного предела прохода (3 USD) — он возвращается в среду
	await sweepMax('3');
	await page.reload();
	await page.getByTestId('case-table-head').waitFor({ timeout: 60000 });
	const action = page.getByTestId('case-table-action').filter({ hasText: 'пределом' });
	await action.first().waitFor({ timeout: 30000 });
	const resume = one(await action.first().textContent());
	const usd2 = Number(
		(resume.match(/около (?:< )?([\d,]+) USD/) ?? [])[1]?.replace(',', '.') ?? NaN
	);
	if (!(usd2 <= STEP_USD)) {
		ok(false, `оценка дочитывания «${resume}» больше ${STEP_USD} USD или неизвестна — не запускаю`);
		return;
	}
	await action.first().click();
	if (await dlg().count()) await dlg().getByRole('button', { name: resume, exact: true }).click();
	// после «Дочитать» страница возвращается к перечню проходов (как прежняя): проход дочитывается там
	await page.waitForURL(`${base}${CASE}/tables`, { timeout: 30000 });
	const started = (await toast(S.tables_started)) || (await toast(S.tables_cached));
	let done = false;
	let cur = null;
	const t2 = Date.now();
	for (let i = 0; i < 160; i++) {
		cur = ((await tools('/tables'))?.tables ?? [])[0];
		if (cur && ['done', 'failed'].includes(cur.status)) {
			done = cur.status === 'done';
			break;
		}
		if (cur && cur.status === 'partial' && i > 60) break; // снова остановился
		await sleep(3000);
	}
	console.log(
		`     после «Дочитать»: сообщение о запуске — ${started ? 'есть' : 'нет'}; проход за ${stamp(t2)}: ${cur?.status}, прочитано страниц ${cur?.pages_read} из ${cur?.pages_scope}, не прочитано ${cur?.not_read} (${JSON.stringify(cur?.not_read_reasons ?? {})})`
	);
	await refresh();
	await page.getByTestId('case-table-row').first().getByTestId('case-table-open').click();
	await page.waitForURL(new RegExp(`${CASE}/tables/[0-9a-f-]+$`));
	await page.getByTestId('case-table-doc').first().waitFor({ timeout: 60000 });
	const head = one(await page.getByTestId('case-table-head').textContent());
	ok(
		done && head.includes(S.tables_status_done),
		`«${resume}» → проход дочитан: «${head.slice(0, 120)}»`
	);
	// настоящие цитаты и переход на лист с местом цитаты
	const docs = await page.getByTestId('case-table-doc').count();
	const cell = page
		.getByTestId('case-table-cell')
		.filter({ has: page.getByRole('button', { name: S.quote_toggle }) })
		.first();
	const answer = one(await cell.textContent()).slice(0, 200);
	await cell.getByRole('button', { name: S.quote_toggle }).first().click();
	const quote = one(await cell.locator('.q').first().textContent());
	const link = cell.locator('a.ref').first();
	const href = await link.getAttribute('href');
	ok(
		docs > 0 && quote.length > 10 && /\/p\/\d+\?v=\d+&hl=\d+-\d+/.test(href ?? ''),
		`открытая таблица настоящей модели: документов ${docs}; ответ ячейки — «${answer.slice(0, 120)}»; цитата — «${quote.slice(0, 120)}»; ссылка на лист несёт место цитаты`
	);
	await shot(page, 'paid-table-done');
	await link.click();
	await page.waitForSelector('body.g[data-page="sheet"]');
	const mark = one(
		await page
			.locator('#hl')
			.textContent()
			.catch(() => '')
	);
	const same =
		mark.length > 0 &&
		(one(quote).includes(mark.slice(0, 30)) ||
			mark.includes(
				one(quote)
					.replace(/^[«"]|[»"]$/g, '')
					.slice(0, 30)
			));
	ok(
		mark.length > 0,
		`переход из ячейки на лист: место цитаты выделено в тексте — «${mark.slice(0, 100)}»${same ? ' (совпадает с цитатой ячейки)' : ''}`
	);
	if (!same)
		note(
			`выделенное на листе место и цитата ячейки различаются: лист «${mark.slice(0, 80)}», ячейка «${quote.slice(0, 80)}»`
		);
	await shot(page, 'paid-table-sheet-hl');
	await page.goBack();
	cannot(
		'проход-«находки»: со страницы он не запускается (наборы страницы — таблицы), а чат дела в своей среде без модели чата'
	);
});

// ================================================================ 3. окно подтверждения при цене больше 1 USD — без траты
await step('окно подтверждения', async () => {
	const override = arg('prices-override');
	if (!compose.length || !override) {
		cannot(
			'окно подтверждения при цене больше 1 USD: нет команды среды (--compose, --prices-override)'
		);
		return;
	}
	const before = ledger();
	// цены среды завышаются (только оценка: ничего не запускается) — сервис страницы перезапускается с ними
	execFileSync(
		compose[0],
		[...compose.slice(1), '-f', override, 'up', '-d', '--pull', 'never', 'tools'],
		{ env: { ...process.env, LIVE_SWEEP_MAX_USD: '3' }, stdio: 'ignore' }
	);
	await healthy();
	await page.goto(`${base}${CASE}/tables`);
	const form = page.getByTestId('case-tables-new');
	await form.waitFor({ timeout: 60000 });
	const radios = form.getByRole('radio');
	const names = await texts(form.locator('label'));
	await radios.nth(1).check();
	const start = page.getByTestId('case-tables-start');
	await page.waitForFunction(
		() =>
			/USD/.test(document.querySelector('[data-testid="case-tables-start"]')?.textContent ?? ''),
		null,
		{ timeout: 60000 }
	);
	const price = one(await start.textContent());
	const rows = await page.getByTestId('case-table-row').count();
	await start.click();
	const seen = await dlg()
		.waitFor({ timeout: 15000 })
		.then(
			() => true,
			() => false
		);
	const title = seen ? one(await dlg().locator('h2').textContent()) : '';
	const bodyText = seen ? one(await dlg().textContent()).slice(0, 220) : '';
	if (seen) await shot(page, 'paid-confirm-over-1usd');
	if (seen) await dlg().getByRole('button', { name: S.cancel }).click();
	await sleep(3000);
	await refresh();
	const after = ledger();
	ok(
		seen && (await page.getByTestId('case-table-row').count()) === rows && after === before,
		`цена больше 1 USD («${price}», набор «${names[1] ?? ''}»): своё окно «${title}» — ${bodyText}; «${S.cancel}» — проход не запущен, трат нет (журнал ${before.toFixed(4)} → ${after.toFixed(4)} USD)`
	);
});

// ================================================================ деньги
const ledger1 = ledger();
await sleep(8000); // счёт ключа у провайдера обновляется с задержкой
const usage1 = await providerUsage();
const spent = (await tools('')).spent ?? {};
const byKind = sql(
	"SELECT coalesce(step, '—') || ' (' || model || '): ' || round(sum(usd)::numeric, 4) || ', вызовов ' || count(*) FROM usage_ledger GROUP BY step, model ORDER BY sum(usd) DESC NULLS LAST"
)
	.split('\n')
	.join('; ');
console.log(
	`ДЕНЬГИ журнал расходов сервиса: ${(ledger1 - ledger0).toFixed(4)} USD (${byKind}); страница — обработка «${spent.processing}», работа «${spent.work}»; счёт ключа у провайдера: ${usage0 != null && usage1 != null ? `${(usage1 - usage0).toFixed(4)} USD` : 'не получен'}`
);
ok(
	errors.length === 0,
	`ошибок страницы нет${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`
);
if (out)
	writeFileSync(
		join(out, 'paid-result.json'),
		JSON.stringify(
			{
				ledger_usd: Number((ledger1 - ledger0).toFixed(4)),
				provider_usd:
					usage0 != null && usage1 != null ? Number((usage1 - usage0).toFixed(4)) : null,
				pages: pagesTotal,
				fails,
				skipped,
				found
			},
			null,
			1
		)
	);
await browser.close();
console.log(
	`платная проверка: ${fails ? `FAIL — не прошло ${fails}` : 'все проверки OK'}${skipped ? `; не проверено: ${skipped}` : ''}`
);
process.exit(fails ? 1 : 0);
