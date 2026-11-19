// ai-dvokat: живая проверка страницы листа и «нескольких листов» в дизайне «Г» (сдача 4) — настоящий браузер, своя
// среда (run.sh), то же дело, что у live-case.mjs. Путь юриста: с новой страницы дела на лист (из «Проверьте листы», из
// описи, через «Открыть лист»); подсветка цитаты по ссылке с `hl`; прежняя версия текста по `v`; листание; правка
// номера, история, откат; обе кнопки копирования и сверка скопированной строки со строкой прежней страницы; «несколько
// листов»; «только чтение»; 360 px; схема как в чате и как в системе; страница без скрипта; страница ошибки.
// Прежняя страница листа — сервис прежнего образа по адресу /legal-tools-old (run.sh, LIVE_TOOLS_OLD_IMAGE): нет его —
// сверка со строкой прежней страницы названа непроверенной. Подмен в браузере нет.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (name) => {
	const i = process.argv.indexOf(`--${name}`);
	return i > 0 ? process.argv[i + 1] : undefined;
};
const state = JSON.parse(readFileSync(arg('state'), 'utf8'));
const { folder } = JSON.parse(readFileSync(arg('case'), 'utf8'));
const out = arg('out');
const hasOld = arg('old') === '1';
if (out) mkdirSync(out, { recursive: true });
const base = state.base;
const CASE = `/case/${folder}`;
const SHEETS = `/legal-tools/case/${folder}`;
let fails = 0;
let skipped = 0;
const ok = (cond, what) => {
	console.log(`${cond ? 'OK  ' : 'FAIL'} ${what}`);
	if (!cond) fails += 1;
	return !!cond;
};
const cannot = (what) => {
	console.log(`НЕТ  не проверено: ${what}`);
	skipped += 1;
};
const one = (s) =>
	String(s ?? '')
		.replace(/\s+/g, ' ')
		.trim();
const shot = async (page, name) => {
	if (out) await page.screenshot({ path: join(out, `${name}.png`), fullPage: true });
};
async function api(method, path, token, body, headers = {}) {
	const r = await fetch(base + path, {
		method,
		redirect: 'manual',
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
	return { status: r.status, data, location: r.headers.get('location') };
}
const signinApi = async (who) =>
	(
		await api('POST', '/api/v1/auths/signin', null, {
			email: state.emails[who],
			password: state.password
		})
	).data;
const owner = await signinApi('owner');
const colleague = await signinApi('colleague');
const tools = (path, token = owner.token) =>
	api('GET', `/legal-tools/api/cases/${folder}${path}`, token).then((r) => r.data);
const S = (await api('GET', '/legal-tools/api/cases/ui.json')).data.strings;
const fmt = (t, vars) =>
	String(t).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
/** Запрос к базе своей среды (не стенда): прочтения листа для проверки прежней версии текста. */
const sql = (q) =>
	execFileSync(
		'docker',
		[
			'compose',
			'-p',
			process.env.LIVE_NAME,
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
async function signIn(page, who, target) {
	await page.goto(base + target);
	await page.waitForURL((url) => url.pathname === '/auth', { timeout: 30000 });
	await page.locator('input[type="email"]').fill(state.emails[who]);
	await page.locator('input[type="password"]').fill(state.password);
	await page.locator('button[type="submit"]').click();
	await page.waitForURL((url) => url.pathname === target, { timeout: 30000 });
}
async function step(name, fn) {
	try {
		await fn();
	} catch (e) {
		ok(
			false,
			`${name}: шаг оборвался — ${String(e?.message ?? e)
				.split('\n')[0]
				.slice(0, 240)}`
		);
	}
}
const sheetReady = (page) => page.waitForSelector('body.g[data-page="sheet"]', { timeout: 30000 });
const label = (page) => page.locator('#sheet-label').textContent().then(one);
const sideScroll = (page) =>
	page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/** Выделить в тексте листа отрезок [a, b) — так же, как это делает мышь: по смещениям в тексте версии. */
const select = (page, a, b) =>
	page.evaluate(
		([from, to]) => {
			const box = document.getElementById('sheet-text');
			const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT, null);
			const range = document.createRange();
			let pos = 0;
			let n;
			let started = false;
			while ((n = walker.nextNode())) {
				const end = pos + n.nodeValue.length;
				if (!started && from < end) {
					range.setStart(n, from - pos);
					started = true;
				}
				if (started && to <= end) {
					range.setEnd(n, to - pos);
					break;
				}
				pos = end;
			}
			const s = getSelection();
			s.removeAllRanges();
			s.addRange(range);
			document.dispatchEvent(new Event('selectionchange'));
		},
		[a, b]
	);
const clipboard = (page) => page.evaluate(() => navigator.clipboard.readText());
const copyBy = async (page, button) => {
	await page.evaluate(() => navigator.clipboard.writeText(''));
	await button.click();
	await page.waitForFunction(() => navigator.clipboard.readText().then((t) => t.length > 0), null, {
		timeout: 10000
	});
	return clipboard(page);
};

const d0 = await tools('');
const volumes = d0.overview.volumes ?? [];
const docs = (await tools('/documents')).documents ?? [];
// лист с текстом из тома: первый лист первого документа описи, у которого есть сосед с обеих сторон
let target = null;
for (const v of volumes) {
	const pages = (await tools(`/pages?volume=${v.id}`)).pages ?? [];
	for (const p of pages.slice(1, -1)) {
		const sh = await tools(`/pages/${p.id}`);
		if (
			(sh.text ?? '').length > 200 &&
			sh.number_as_written &&
			sh.side !== 'back' &&
			sh.prev &&
			sh.next
		) {
			const next = await tools(`/pages/${sh.next}`);
			if (!next.number_as_written || next.side === 'back') continue;
			target = { sheet: sh, volume: v, pages };
			break;
		}
	}
	if (target) break;
}
if (!target) {
	ok(false, 'в деле нет листа с текстом, номером и соседями — проверять страницу листа не на чем');
	process.exit(1);
}
const T = target.sheet;
const PID = T.page_id;
const URL_T = `${SHEETS}/p/${PID}`;

const browser = await chromium.launch({
	executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
});
const context = await browser.newContext({
	viewport: { width: 1280, height: 1000 },
	locale: 'ru-RU',
	permissions: ['clipboard-read', 'clipboard-write']
});
const page = await context.newPage();
const errors = [];
const outside = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
// отказ сервиса на негодный номер листа (400) браузер пишет в консоль сам — он вызван проверкой нарочно
page.on(
	'console',
	(m) =>
		m.type() === 'error' && !/status of 400/.test(m.text()) && errors.push(m.text().slice(0, 200))
);
page.on('request', (r) => {
	const u = new URL(r.url());
	if (u.origin !== base && !['data:', 'blob:', 'about:'].includes(u.protocol))
		outside.push(r.url().slice(0, 120));
});
await signIn(page, 'owner', CASE);
await page.getByTestId('case-summary').waitFor({ timeout: 30000 });

// ================================================================ с новой страницы дела — на лист
await step('переходы на лист', async () => {
	// из «Проверьте листы»
	await page.getByTestId('case-nav-check').click();
	await page.getByTestId('case-check').waitFor();
	const ref = page.getByTestId('case-check-group').locator('a.ref, a.chipl').first();
	const title = await ref.getAttribute('title');
	await ref.click();
	await sheetReady(page);
	const fromCheck = await label(page);
	const sheet1 = await tools(`/pages/${new URL(page.url()).pathname.split('/').pop()}`);
	ok(
		/\/legal-tools\/case\/.+\/p\/\d+$/.test(new URL(page.url()).pathname) &&
			(await page.title()) === sheet1.label &&
			(!title || title === sheet1.label),
		`из «Проверьте листы» открыт лист в новом виде: «${fromCheck}» (заголовок окна — подпись листа «${sheet1.label}»)`
	);
	const head = await page.locator('.head a.ref.only-w').first();
	const name = (await api('GET', `/api/v1/folders/${folder}`, owner.token)).data?.name ?? '';
	ok(
		one(await head.textContent()) === fmt(S.back_to_case_g, { title: name }) &&
			(await head.getAttribute('href')) === `../../${folder}`,
		`в шапке листа — ссылка на дело «${one(await head.textContent())}» (адрес дела — прежний, ../../<папка>)`
	);
	ok(
		(await page.locator('nav.nav').count()) === 0,
		'меню разделов дела на странице листа не показывается'
	);
	await page.goBack();
	await page.getByTestId('case-check').waitFor({ timeout: 30000 });
	// из описи
	await page.getByTestId('case-nav-inventory').click();
	await page.getByTestId('case-inventory').waitFor({ timeout: 30000 });
	const docRef = page.getByTestId('case-inventory').locator('a.ref').first();
	await docRef.waitFor({ timeout: 30000 });
	const docHref = await docRef.getAttribute('href');
	await docRef.click();
	await sheetReady(page);
	const fromDoc = await tools(`/pages/${new URL(page.url()).pathname.split('/').pop()}`);
	ok(
		new URL(page.url()).pathname === docHref &&
			(await label(page)).startsWith(one(fromDoc.label).slice(0, 6)),
		`из описи открыт первый лист документа: «${await label(page)}»${fromDoc.doc_title ? `, документ «${fromDoc.doc_title.slice(0, 50)}»` : ''}`
	);
	if (fromDoc.doc_title)
		ok(
			(await page.locator('.head .md.fg2').first().textContent()) === fromDoc.doc_title,
			'под подписью листа — название документа описи'
		);
	await page.goBack();
	// через «Открыть лист» страницы дела
	await page.getByTestId('case-nav-overview').click();
	const form = page.getByTestId('case-goto').filter({ visible: true });
	await form.locator('select[name="t"] option').first().waitFor({ state: 'attached' });
	await form.locator('select[name="t"]').selectOption(String(T.volume_label));
	await form.locator('input[name="l"]').fill(String(T.number_as_written));
	if (T.side === 'back') await form.locator('input[name="side"]').check();
	await form.locator('button[type="submit"]').click();
	await sheetReady(page);
	ok(
		new URL(page.url()).pathname === URL_T && (await label(page)) === one(T.label),
		`«Открыть лист» страницы дела (т. ${T.volume_label}, л. ${T.number_as_written}) открыл «${await label(page)}»`
	);
});

// ================================================================ вид, блоки, изображение
await step('вид листа', async () => {
	await page.goto(base + URL_T);
	await sheetReady(page);
	const facts = await page.evaluate(() => {
		const seen = (sel) =>
			[...document.querySelectorAll(sel)].some((el) => el.offsetParent !== null);
		const img = document.getElementById('sheet-img');
		const box = (sel) => document.querySelector(sel)?.getBoundingClientRect();
		return {
			font: getComputedStyle(document.body).fontFamily.split(',')[0].replace(/['"]/g, ''),
			loaded: [...document.fonts]
				.filter((f) => f.status === 'loaded')
				.map((f) => f.family.replace(/['"]/g, '')),
			img: img ? img.naturalWidth : 0,
			twoCols: box('#image') && box('#text') ? box('#image').right <= box('#text').left + 1 : false,
			tabs: seen('.tabs'),
			stick: seen('.stick'),
			top: seen('.top'),
			edit: document.getElementById('sheet-edit')?.open ?? null,
			copy: [...document.querySelectorAll('[data-copy]')].filter((b) => b.offsetParent !== null)
				.length,
			text: document.getElementById('sheet-text')?.textContent ?? ''
		};
	});
	await page.evaluate(() => document.fonts.ready);
	const fonts = await page.evaluate(() =>
		[...document.fonts]
			.filter((f) => f.status === 'loaded')
			.map((f) => f.family.replace(/['"]/g, ''))
	);
	ok(
		facts.font === 'Geologica' && fonts.includes('Geologica'),
		`шрифт страницы — ${facts.font}, загружен своим файлом сервиса (${[...new Set(fonts)].join(', ') || 'нет'})`
	);
	ok(
		facts.img > 0 && facts.twoCols && !facts.tabs && !facts.stick && !facts.top,
		`компьютер: изображение листа загружено (${facts.img} px), изображение и текст — двумя колонками; переключателя и нижней полосы нет`
	);
	ok(
		facts.text === T.text,
		`текст листа на странице — текст принятого прочтения (${T.text.length} знаков)`
	);
	ok(
		facts.edit === true && facts.copy === 1,
		'правка номера на компьютере раскрыта; кнопка копирования — в шапке'
	);
	const checks = await page.locator('#sheet-checks li').allTextContents();
	const wantChecks = [
		...(T.flags ?? []).map((f) => f.text),
		...(T.reading_note_page === S.reading_model_g ? [S.reading_model_g] : [])
	];
	ok(
		JSON.stringify(checks.map(one)) === JSON.stringify(wantChecks.map(one)),
		`«${S.sheet_flags_g}»: ${checks.length ? checks.map((c) => `«${one(c).slice(0, 70)}»`).join('; ') : 'блока нет — сверять нечего'}`
	);
	const note = (await page.locator('#sheet-number-note').count())
		? one(await page.locator('#sheet-number-note').textContent())
		: '';
	ok(
		note === one(T.number_note_page ?? ''),
		`строка о номере листа: «${note}» (для модели та же запись — «${T.number_note ?? ''}»)`
	);
	// «Открыть крупно» — изображение наибольшего размера
	const zoom = await page.locator('#image a.btn').getAttribute('href');
	const big = await context.request.get(new URL(zoom, page.url()).toString());
	ok(
		/image\?w=2400$/.test(zoom) && big.ok() && /^image\//.test(big.headers()['content-type'] ?? ''),
		`«${S.sheet_zoom}» ведёт на изображение наибольшего размера (${zoom.split('/').pop()}, ${big.headers()['content-type']}, ${(await big.body()).length} байт)`
	);
	await shot(page, 'live-sheet-1280-light');
});

// ================================================================ подсветка цитаты и прежняя версия текста
await step('цитата', async () => {
	const at = T.text.indexOf(' ', 40) + 1;
	const a = at;
	const b = Math.min(T.text.length, at + 60);
	await page.goto(`${base}${URL_T}?v=${T.read_id}&hl=${a}-${b}`);
	await sheetReady(page);
	const mark = await page.locator('#hl').textContent();
	const inView = await page.locator('#hl').evaluate((el) => {
		const r = el.getBoundingClientRect();
		return r.top >= 0 && r.bottom <= innerHeight;
	});
	const api1 = await tools(`/pages/${PID}?v=${T.read_id}&hl=${a}-${b}`);
	const rects = await page.locator('#sheet-frames rect').count();
	ok(
		mark === T.text.slice(a, b) && inView,
		`ссылка с hl=${a}-${b}: в тексте выделено «${one(mark).slice(0, 50)}…», место прокручено в окно`
	);
	ok(
		rects === (api1.boxes ?? []).length,
		`рамки цитаты на изображении: ${rects} (сервис дал рамок слов: ${(api1.boxes ?? []).length}${rects ? '' : ' — распознавание среды не даёт мест слов, подсказки о рамках и «Место на изображении» нет'})`
	);
	ok(
		(await page.getByText(S.sheet_image_hint, { exact: true }).count()) > 0 === rects > 0,
		'подсказка «Жёлтые рамки — место цитаты» показана только при рамках'
	);
	await shot(page, 'live-sheet-hl-1280-light');
	// прежняя версия текста: другое прочтение этого же листа
	let other = '';
	try {
		other = sql(
			`SELECT r.id FROM case_page p JOIN blob_read r ON r.sha256 = p.sha256 AND r.page_no = p.page_no AND r.area = p.area WHERE p.id = ${Number(PID)} AND r.id <> ${Number(T.read_id)} AND r.status = 'ok' AND coalesce(r.text, '') <> '' ORDER BY r.id LIMIT 1`
		);
	} catch (e) {
		other = '';
	}
	if (!other) {
		cannot('прежняя версия текста по `v`: у листа в среде одно прочтение с текстом');
	} else {
		await page.goto(`${base}${URL_T}?v=${other}`);
		await sheetReady(page);
		const oldApi = await tools(`/pages/${PID}?v=${other}`);
		const noteSeen = await page.getByText(S.sheet_version_old, { exact: true }).count();
		const shown = await page.locator('#sheet-text').textContent();
		ok(
			noteSeen === 1 && oldApi.old_version && shown === oldApi.text,
			`прежняя версия текста (v=${other}): пометка «${S.sheet_version_old}», текст — этого прочтения (${shown.length} знаков)`
		);
		await page.getByRole('link', { name: S.sheet_version_current }).click();
		await sheetReady(page);
		ok(
			new URL(page.url()).pathname === URL_T &&
				!new URL(page.url()).search &&
				(await page.getByText(S.sheet_version_old, { exact: true }).count()) === 0,
			`«${S.sheet_version_current}» возвращает принятый текст`
		);
	}
});

// ================================================================ листание
await step('листание', async () => {
	await page.goto(base + URL_T);
	await sheetReady(page);
	await page.locator('.head a[rel="next"]').click();
	await page.waitForURL(`${base}${SHEETS}/p/${T.next}`);
	await sheetReady(page);
	const next = await label(page);
	await page.keyboard.press('ArrowLeft');
	await page.waitForURL(base + URL_T);
	await sheetReady(page);
	await page.keyboard.press('ArrowLeft');
	await page.waitForURL(`${base}${SHEETS}/p/${T.prev}`);
	ok(
		true,
		`«${S.sheet_next}» открыл «${next}»; стрелка ← на клавиатуре вернула «${one(T.label)}» и открыла предыдущий лист`
	);
	// первый лист тома: «Предыдущий» не нажимается
	const first = target.pages[0];
	await page.goto(`${base}${SHEETS}/p/${first.id}`);
	await sheetReady(page);
	ok(
		(await page.locator('.head .pager button[disabled]').count()) === 1 &&
			(await page.locator('.head a[rel="prev"]').count()) === 0,
		`у первого листа тома («${await label(page)}») «${S.sheet_prev}» не нажимается`
	);
});

// ================================================================ копирование и сверка с прежней страницей
const copied = {};
await step('копирование', async () => {
	const a = T.text.indexOf(' ', 20) + 1;
	const b = Math.min(T.text.length, a + 80);
	await page.goto(base + URL_T);
	await sheetReady(page);
	const btn = page.locator('.head [data-copy]');
	ok(one(await btn.textContent()) === S.sheet_copy_g, `без выделения кнопка — «${S.sheet_copy_g}»`);
	copied.plain = await copyBy(page, btn);
	ok(
		copied.plain === `${T.label} ${base}${URL_T}`,
		`без выделения в буфер уходит «${copied.plain}»`
	);
	ok(
		await page.locator('#toast .toast').filter({ hasText: S.sheet_copied }).count(),
		`сообщение «${S.sheet_copied}»`
	);
	await select(page, a, b);
	ok(
		one(await btn.textContent()) === S.sheet_copy_quote,
		`с выделением кнопка — «${S.sheet_copy_quote}»`
	);
	copied.quote = await copyBy(page, btn);
	const want = `«${one(T.text.slice(a, b))}» (${T.label}) ${base}${URL_T}?v=${T.read_id}&hl=${a}-${b}`;
	ok(
		copied.quote === want,
		`с выделением в буфер уходит цитата со ссылкой на это место: «${copied.quote.slice(0, 60)}… ${copied.quote.slice(-34)}»`
	);
	// ссылка из буфера открывает то же место
	await page.goto(copied.quote.slice(copied.quote.lastIndexOf(' ') + 1));
	await sheetReady(page);
	ok(
		(await page.locator('#hl').textContent()) === T.text.slice(a, b),
		'ссылка из скопированной строки открывает лист с этим местом, выделенным в тексте'
	);
	if (!hasOld) {
		cannot(
			'сверка скопированной строки со строкой прежней страницы листа: сервиса прежнего образа в среде нет (LIVE_TOOLS_OLD_IMAGE)'
		);
		return;
	}
	// прежняя страница листа — сервис прежнего образа на той же базе; адрес отличается только началом /legal-tools-old
	const old = await context.newPage();
	await old.goto(`${base}${URL_T.replace('/legal-tools/', '/legal-tools-old/')}`);
	await old.waitForSelector('body[data-page="sheet"] [data-copy]');
	const oldBtn = old.locator('[data-copy]').first();
	const oldPlain = (await copyBy(old, oldBtn)).replace('/legal-tools-old/', '/legal-tools/');
	await select(old, a, b);
	const oldQuote = (await copyBy(old, oldBtn)).replace('/legal-tools-old/', '/legal-tools/');
	ok(
		oldPlain === copied.plain && oldQuote === copied.quote,
		`скопированные строки новой и прежней страницы листа совпадают знак в знак (без выделения и с выделением ${a}-${b})${oldPlain === copied.plain && oldQuote === copied.quote ? '' : `: прежняя «${oldPlain}» / «${oldQuote}»`}`
	);
	ok(
		one(await oldBtn.textContent()) === 'Копировать со ссылкой' &&
			!(await old.locator('body.g').count()),
		'прежняя страница — действительно прежняя (кнопка «Копировать со ссылкой», прежний вид)'
	);
	await old.close();
});

// ================================================================ правка номера, история, откат; «несколько листов»
await step('номер листа', async () => {
	await page.goto(base + URL_T);
	await sheetReady(page);
	const form = page.locator('#sheet-number-form');
	const before = await label(page);
	// ошибка сервиса — строкой под формой
	await form.locator('input[name="number"]').fill('!!');
	await form.locator('button[type="submit"]').click();
	const err = page.locator('#sheet-number-error');
	await err.waitFor({ state: 'visible', timeout: 15000 });
	ok(
		one(await err.textContent()) === fmt(S.error_generic, { detail: S.err_sheet_number }),
		`негодный номер: «${one(await err.textContent())}», лист не изменён`
	);
	// номер соседнего листа: под одной записью станет два листа
	const neighbour = await tools(`/pages/${T.next}`);
	await form.locator('input[name="number"]').fill(String(neighbour.number_as_written));
	await form.locator('select[name="side"]').selectOption(neighbour.side ?? 'face');
	await Promise.all([page.waitForEvent('load'), form.locator('button[type="submit"]').click()]);
	await sheetReady(page);
	const after = await tools(`/pages/${PID}`);
	ok(
		(await label(page)) === one(after.label) &&
			after.number_as_written === String(neighbour.number_as_written) &&
			one(await page.locator('#sheet-number-note').textContent()) === S.number_source_lawyer_g,
		`номер листа исправлен: «${before}» → «${await label(page)}», строка о номере — «${S.number_source_lawyer_g}»`
	);
	// «несколько листов»
	const q = `t=${encodeURIComponent(T.volume_label)}&l=${encodeURIComponent(neighbour.number_as_written)}${neighbour.side === 'back' ? '&side=back' : ''}`;
	await page.goto(`${base}${SHEETS}/ref?${q}`);
	await page.waitForSelector('body.g[data-page="ref"]');
	const cards = page.locator('a.variant');
	const hrefs = await cards.evaluateAll((list) => list.map((a) => a.getAttribute('href')));
	const pills = (await cards.locator('.pill').allTextContents()).map(one);
	ok(
		(await page.locator('h1').textContent()) === S.ref_many_g &&
			hrefs.length === 2 &&
			hrefs.includes(`p/${PID}`) &&
			hrefs.includes(`p/${T.next}`) &&
			pills.every((p) => p === S.ref_how_duplicate),
		`«${S.ref_many_g}»: ${hrefs.length} карточки (${(await cards.locator('.ref.lg').allTextContents()).map(one).join(' · ')}), причина пометкой — «${pills[0]}», под подписью — ${(await cards.locator('.sm.fg2').allTextContents()).map(one).join(' и ')}`
	);
	ok(
		one(await page.locator('.sm.mut').first().textContent()) ===
			fmt(S.ref_opened, { ref: after.label }),
		`«${fmt(S.ref_opened, { ref: after.label })}» и «${S.ref_choose}»`
	);
	ok((await sideScroll(page)) <= 0, '«несколько листов», 1280: без прокрутки вбок');
	await shot(page, 'live-ref-1280-light');
	// форма «Открыть другой лист» с введённым; открыть другой лист
	const other = page.locator('form[data-goto]');
	ok(
		(await other.locator('input[name="l"]').inputValue()) === String(neighbour.number_as_written) &&
			(await other.locator('select[name="t"]').inputValue()) === String(T.volume_label),
		`«${S.ref_other}»: том и лист — как открывали`
	);
	await cards
		.filter({ has: page.locator(`[href="p/${PID}"]`) })
		.or(page.locator(`a.variant[href="p/${PID}"]`))
		.first()
		.click();
	await sheetReady(page);
	ok(new URL(page.url()).pathname === URL_T, 'карточка варианта открывает свой лист');
	// ответы «листа нет» и «тома нет»
	const none = await context.request.get(
		`${base}${SHEETS}/ref?t=${encodeURIComponent(T.volume_label)}&l=99999`
	);
	const noVol = await context.request.get(`${base}${SHEETS}/ref?t=999&l=1`);
	ok(
		none.status() === 404 &&
			(await none.text()).includes(S.goto_not_in_volume) &&
			noVol.status() === 404 &&
			(await noVol.text()).includes(fmt(S.goto_no_volume, { v: '999' }).replace(/"/g, '&quot;')),
		'«несколько листов»: листа нет и тома нет — причина словами и форма «Открыть другой лист»'
	);
	// история и откат
	await page.locator('[data-history]:visible').first().click();
	const dlg = page.locator('dialog[open]');
	await dlg.locator('.li').first().waitFor({ timeout: 15000 });
	const rows = (await dlg.locator('.li').allTextContents()).map(one);
	ok(
		(await dlg.locator('h2').textContent()) === S.history_title &&
			rows.length >= 1 &&
			rows[0].includes(String(neighbour.number_as_written)),
		`«${S.history_title}»: ${rows.length} — «${rows[0].slice(0, 110)}»`
	);
	await shot(page, 'live-sheet-history-1280-light');
	await Promise.all([
		page.waitForEvent('load'),
		dlg.getByRole('button', { name: S.revert }).first().click()
	]);
	await sheetReady(page);
	const back = await tools(`/pages/${PID}`);
	ok(
		(await label(page)) === before && back.number_as_written === T.number_as_written,
		`«${S.revert}» вернул номер: «${await label(page)}»`
	);
	const again = await api('GET', `${SHEETS}/ref?${q}`, owner.token);
	ok(
		again.status === 303 && again.location === `p/${T.next}`,
		'после отката под записью снова один лист — открывается сразу'
	);
});

// ================================================================ телефон, 360 px
await step('телефон', async () => {
	await page.setViewportSize({ width: 360, height: 780 });
	const a = T.text.indexOf(' ', 40) + 1;
	const b = Math.min(T.text.length, a + 60);
	await page.goto(`${base}${URL_T}?v=${T.read_id}&hl=${a}-${b}`);
	await sheetReady(page);
	const f = await page.evaluate(() => {
		const seen = (sel) =>
			[...document.querySelectorAll(sel)].some((el) => el.offsetParent !== null);
		const stick = document.querySelector('.stick').getBoundingClientRect();
		return {
			text: seen('#sheet-text'),
			image: seen('#sheet-img'),
			tabs: [...document.querySelectorAll('.tabs a')].map(
				(x) => `${x.textContent}${x.classList.contains('on') ? '*' : ''}`
			),
			stickAtBottom: Math.abs(stick.bottom - innerHeight) < 2,
			edit: document.getElementById('sheet-edit')?.open,
			goto: seen('.head .goto'),
			small: [...document.querySelectorAll('input:not([type=checkbox]),select')].filter(
				(el) => el.offsetParent && parseFloat(getComputedStyle(el).fontSize) < 16
			).length
		};
	});
	ok(
		f.text &&
			!f.image &&
			f.tabs.join('|') === `${S.sheet_tab_text}*|${S.sheet_tab_image}` &&
			f.stickAtBottom,
		`телефон: переключатель «${f.tabs.join(' / ')}», по умолчанию текст с цитатой; листание и копирование прибиты к низу экрана`
	);
	ok(
		f.edit === false && !f.goto && f.small === 0 && (await sideScroll(page)) <= 0,
		'телефон: правка номера свёрнута, поля не меньше 16 px, прокрутки вбок нет'
	);
	await shot(page, 'live-sheet-360-text');
	await page.locator('.tabs a').nth(1).click();
	const g = await page.evaluate(() => ({
		text: document.getElementById('sheet-text').offsetParent !== null,
		image: document.getElementById('sheet-img').offsetParent !== null
	}));
	ok(
		!g.text && g.image && (await sideScroll(page)) <= 0,
		`вкладка «${S.sheet_tab_image}»: изображение вместо текста`
	);
	await shot(page, 'live-sheet-360-image');
	await page.locator('.tabs a').nth(0).click();
	// нижняя кнопка копирования — та же строка
	const phone = await copyBy(page, page.locator('.stick [data-copy]'));
	ok(
		phone === copied.plain,
		'нижняя кнопка копирования на телефоне кладёт в буфер ту же строку, что кнопка в шапке'
	);
	// правка номера раскрывается; «Лист №» открывает форму
	await page.locator('#sheet-edit summary').click();
	ok(
		await page.locator('#sheet-number-form').isVisible(),
		`«${S.sheet_number_title}» раскрывается нажатием`
	);
	await page.locator('.top a[href="#goto"]').click();
	const card = page.locator('#goto');
	ok(await card.isVisible(), `«${S.goto_short}» открывает форму «${S.goto_title_g}»`);
	await card.locator('input[name="l"]').fill(String(T.number_as_written));
	await Promise.all([page.waitForURL(base + URL_T), card.locator('button[type="submit"]').click()]);
	ok(true, 'форма на телефоне открывает лист по номеру');
	await page.setViewportSize({ width: 1280, height: 1000 });
});

// ================================================================ схема: как в чате и как в системе
await step('схема', async () => {
	const bg = (p) =>
		p.evaluate(() => getComputedStyle(document.body).getPropertyValue('--card').trim());
	const dark = await browser.newContext({
		viewport: { width: 360, height: 780 },
		colorScheme: 'dark',
		locale: 'ru-RU'
	});
	await dark.addCookies([{ name: 'token', value: owner.token, url: base }]);
	const p = await dark.newPage();
	await p.goto(base + URL_T);
	await sheetReady(p);
	const system = await bg(p);
	await shot(p, 'live-sheet-360-dark');
	// выбор в чате сильнее системы: светлая тема чата при тёмной системе
	await p.evaluate(() => localStorage.setItem('theme', 'light'));
	await p.reload();
	await sheetReady(p);
	const chatLight = await bg(p);
	await dark.close();
	await page.evaluate(() => localStorage.setItem('theme', 'dark'));
	await page.goto(base + URL_T);
	await sheetReady(page);
	const chatDark = await bg(page);
	await shot(page, 'live-sheet-1280-dark');
	await page.evaluate(() => localStorage.setItem('theme', 'system'));
	await page.reload();
	await sheetReady(page);
	const light = await bg(page);
	ok(
		system === '#1e1e28' &&
			chatLight === '#ffffff' &&
			chatDark === '#1e1e28' &&
			light === '#ffffff',
		`схема: тёмная система → тёмная (${system}); тема чата «светлая» при тёмной системе → светлая (${chatLight}); тема чата «тёмная» при светлой системе → тёмная (${chatDark}); «как в системе» → светлая (${light})`
	);
});

// ================================================================ «только чтение»
await step('только чтение', async () => {
	const ro = await browser.newContext({
		viewport: { width: 1280, height: 1000 },
		locale: 'ru-RU',
		permissions: ['clipboard-read', 'clipboard-write']
	});
	await ro.addCookies([{ name: 'token', value: colleague.token, url: base }]);
	const p = await ro.newPage();
	const writes = [];
	p.on(
		'request',
		(r) => r.method() !== 'GET' && writes.push(`${r.method()} ${new URL(r.url()).pathname}`)
	);
	await p.goto(base + URL_T);
	await sheetReady(p);
	const f = await p.evaluate(() => ({
		form: !!document.getElementById('sheet-number-form'),
		save: [...document.querySelectorAll('button')].map((b) => b.textContent.trim())
	}));
	ok(
		!f.form && !f.save.includes(S.save) && !f.save.includes(S.sheet_number_title),
		'«только чтение»: правки номера нет'
	);
	const line = one(await p.locator('#sheet-number p').textContent());
	ok(line.startsWith(`${T.number_as_written}, `), `«только чтение»: номер словами — «${line}»`);
	await p.locator('[data-history]').click();
	const dlg = p.locator('dialog[open]');
	await dlg.locator('.li').first().waitFor({ timeout: 15000 });
	ok(
		(await dlg.getByRole('button', { name: S.revert }).count()) === 0 &&
			(await dlg.locator('.li').count()) >= 2,
		`«только чтение»: история видна (${await dlg.locator('.li').count()} правки), «${S.revert}» нет`
	);
	await dlg.getByRole('button', { name: S.close }).click();
	const line2 = await copyBy(p, p.locator('.head [data-copy]'));
	const denied = await api(
		'PATCH',
		`/legal-tools/api/cases/${folder}/pages/${PID}`,
		colleague.token,
		{ number_as_written: '1', side: 'face' },
		{ 'X-Ai-Case': '1', Origin: base }
	);
	ok(
		line2 === copied.plain && writes.length === 0 && denied.status === 404,
		`«только чтение»: копирование работает, запросов записи со страницы нет, запись мимо страницы сервис не принимает (${denied.status})`
	);
	await shot(p, 'live-sheet-readonly-1280');
	await ro.close();
});

// ================================================================ без скрипта и страница ошибки
await step('без скрипта', async () => {
	const nojs = await browser.newContext({
		viewport: { width: 360, height: 780 },
		javaScriptEnabled: false,
		locale: 'ru-RU'
	});
	await nojs.addCookies([{ name: 'token', value: owner.token, url: base }]);
	const p = await nojs.newPage();
	const a = T.text.indexOf(' ', 40) + 1;
	await p.goto(`${base}${URL_T}?v=${T.read_id}&hl=${a}-${a + 40}`);
	const vis = async (sel) =>
		(await p.locator(sel).count()) > 0 && (await p.locator(sel).first().isVisible());
	const text = await p.locator('#sheet-text').textContent();
	const img = await p
		.locator('#sheet-img')
		.evaluate((el) => el.naturalWidth)
		.catch(() => -1);
	ok(
		text === T.text &&
			(await p.locator('#hl').textContent()) === T.text.slice(a, a + 40) &&
			(await vis('#sheet-img')) &&
			(await vis('#sheet-text')),
		`без скрипта: лист открыт, текст и изображение идут подряд (изображение ${img > 0 ? `${img} px` : 'загружено'}), цитата выделена`
	);
	ok(
		!(await vis('[data-copy]')) && !(await vis('#sheet-edit')) && !(await vis('.tabs')),
		'без скрипта не показано то, чему нужен скрипт: копирование, правка номера, переключатель'
	);
	await p.locator('.stick a[rel="next"]').click();
	await p.waitForURL(`${base}${SHEETS}/p/${T.next}`);
	const nextText = await p.locator('#sheet-text').textContent();
	await p.locator('.top a[href="#goto"]').click();
	await p.locator('#goto input[name="l"]').fill(String(T.number_as_written));
	await p.locator('#goto select[name="t"]').selectOption(String(T.volume_label));
	await Promise.all([p.waitForURL(base + URL_T), p.locator('#goto button[type="submit"]').click()]);
	ok(
		nextText.length > 0,
		`без скрипта листается («${S.sheet_next_long}» открыл следующий лист с текстом) и открывает лист по номеру через «${S.goto_short}»`
	);
	await shot(p, 'live-sheet-noscript-360');
	await nojs.close();
});
await step('страница ошибки', async () => {
	const anon = await browser.newContext({
		viewport: { width: 1280, height: 800 },
		locale: 'ru-RU'
	});
	const p = await anon.newPage();
	const r = await p.goto(base + URL_T);
	ok(
		r.status() === 401 &&
			one(await p.locator('h1').textContent()) === S.login_needed &&
			(await p.locator('body.g').count()) === 1 &&
			one(await p.locator('a.ref').textContent()) === S.back_to_cases,
		`без входа: ${r.status()}, «${S.login_needed}», ссылка «${S.back_to_cases}» — в том же виде`
	);
	await shot(p, 'live-sheet-error-login');
	const outsider = await signinApi('outsider');
	await anon.addCookies([{ name: 'token', value: outsider.token, url: base }]);
	const r2 = await p.goto(base + URL_T);
	const r3 = await p.goto(`${base}${SHEETS}/ref?t=1&l=1`);
	ok(
		r2.status() === 404 &&
			r3.status() === 404 &&
			one(await p.locator('h1').textContent()) === S.not_found,
		`чужой: лист и «несколько листов» — ${r2.status()}, «${S.not_found}»`
	);
	await anon.close();
});

ok(
	errors.length === 0,
	`ошибок в консоли страницы листа нет${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`
);
ok(
	outside.length === 0,
	`внешних запросов со страниц нет (шрифт — свой файл)${outside.length ? `: ${outside.slice(0, 3).join(' | ')}` : ''}`
);
await browser.close();
console.log(
	`лист: ${fails ? `FAIL — не прошло ${fails}` : 'все проверки OK'}${skipped ? `; не проверено: ${skipped}` : ''}`
);
process.exit(fails ? 1 : 0);
