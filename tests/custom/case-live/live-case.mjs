// ai-dvokat: живая проверка страницы дела в настоящем браузере на своей среде (run.sh): завести дело, загрузить
// настоящие PDF и фото выдуманного дела частями, оборвать передачу и продолжить после закрытия страницы, дождаться
// обработки, глядя на ход, «Проверьте листы» и переход на лист, «Открыть лист» по номеру, тот же путь глазами юриста
// с правом «только чтение», сверка с прежней страницей сервиса на этом же деле. Подмен в браузере нет.
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const arg = (name) => {
	const i = process.argv.indexOf(`--${name}`);
	return i > 0 ? process.argv[i + 1] : undefined;
};
const state = JSON.parse(readFileSync(arg('state'), 'utf8'));
const corpus = arg('corpus');
const big = arg('big');
const out = arg('out');
if (out) mkdirSync(out, { recursive: true });
const base = state.base;
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

async function api(method, path, token, body, headers = {}) {
	const r = await fetch(base + path, {
		method,
		headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
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
const signinApi = async (who) => (await api('POST', '/api/v1/auths/signin', null, { email: state.emails[who], password: state.password })).data;

async function signIn(page, who, target) {
	await page.goto(base + target);
	await page.waitForURL((url) => url.pathname === '/auth', { timeout: 30000 });
	await page.locator('input[type="email"]').fill(state.emails[who]);
	await page.locator('input[type="password"]').fill(state.password);
	await page.locator('button[type="submit"]').click();
	await page.waitForURL((url) => url.pathname === target, { timeout: 30000 });
}

// ---- папка для дела: её заводит юрист в чате; коллеге — доступ «только чтение» ----
const owner = await signinApi('owner');
const colleague = await signinApi('colleague');
const folder = (await api('POST', '/api/v1/folders/', owner.token, { name: 'Живая проверка — тома дела' })).data.id;
await api('POST', `/api/v1/folders/${folder}/access/update`, owner.token, {
	access_grants: [{ principal_type: 'user', principal_id: colleague.id, permission: 'read' }],
	share_mode: 'continue'
});
const CASE = `/case/${folder}`;
const OLD = `/legal-tools/case/${folder}`;
const overviewApi = async (token = owner.token) => (await api('GET', `/legal-tools/api/cases/${folder}`, token)).data;

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });

// ---------------------------------------------------------------- юрист с правом записи (владелец папки)
{
	const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: 'ru-RU' });
	const page = await context.newPage();
	const sent = [];
	page.on('request', (r) => {
		const url = new URL(r.url());
		if (url.pathname.includes('/uploads')) sent.push(`${r.method()} ${url.pathname.split('/uploads')[1] || '/'}`);
	});
	const posted = []; // тела запросов «начать загрузку»
	page.on('request', (r) => {
		if (r.method() === 'POST' && new URL(r.url()).pathname.endsWith('/uploads')) posted.push(r.postData());
	});
	const external = [];
	page.on('request', (r) => {
		if (!r.url().startsWith(base) && !/^(data|blob|about):/.test(r.url())) external.push(r.url());
	});

	// --- дела нет → завести
	await signIn(page, 'owner', CASE);
	await page.waitForSelector('[data-testid="case-none"]', { timeout: 30000 });
	ok((await page.getByTestId('case-none').getByRole('heading').textContent()) === 'Для этой папки дело ещё не заведено',
		'папка без дела по прямой ссылке /case/<папка>: «Для этой папки дело ещё не заведено» и «Завести дело»');
	await page.getByTestId('case-none').getByRole('button', { name: 'Завести дело' }).click();
	await page.waitForSelector('[data-testid="case-summary"][data-state="empty"]', { timeout: 30000 });
	ok((await page.getByTestId('case-summary').getByRole('heading').textContent()) === 'В деле пока нет материалов',
		'дело заведено со страницы; обзор: «В деле пока нет материалов»');
	ok((await page.title()).startsWith('Дело «Живая проверка — тома дела»'), `заголовок вкладки: «${await page.title()}»`);
	await shot(page, 'live-case-empty-1280');

	// --- загрузка: большой том двумя частями, обрыв связи, закрытие страницы, продолжение
	await page.getByTestId('case-nav-upload').click();
	await page.waitForURL(`${base}${CASE}/upload`);
	ok(true, 'раздел «Загрузить материалы» открыт из меню, адрес раздела — /case/<папка>/upload');
	const bigSize = statSync(big).size;
	const parts = (list) => list.filter((x) => x.startsWith('PUT')).map((x) => x.split('/parts/')[1]);
	// обрыв связи посреди файла: вторая часть не уходит (соединение рвётся на уровне браузера), затем сеть пропадает совсем
	await context.route('**/uploads/*/parts/2', (route) => route.abort('internetdisconnected'));
	await page.getByTestId('case-pick-files').setInputFiles(big);
	const row = page.getByTestId('case-queue-row');
	await row.getByRole('radio', { name: 'том дела' }).check();
	await row.getByRole('textbox').fill('7');
	await page.getByTestId('case-upload-start').click();
	const item = page.getByTestId('case-upload');
	await item.filter({ hasText: /нет связи — повтор через \d+ с/ }).waitFor({ timeout: 120000 });
	await context.setOffline(true);
	const total = (bigSize / 1048576).toFixed(1).replace('.', ',');
	ok(parts(sent).includes('1'), `первая часть (5 МБ из ${total}) передана, на второй связь оборвалась — «нет связи — повтор через N с»`);
	await shot(page, 'live-case-upload-retry-1280');
	const before = [...sent];
	await page.goto('about:blank').catch(() => undefined); // страницу закрыли посреди передачи
	await context.unroute('**/uploads/*/parts/2');
	await context.setOffline(false);
	await page.goto(base + CASE + '/upload');
	const note = page.getByTestId('case-unfinished');
	await note.waitFor({ timeout: 30000 });
	const noteText = (await note.textContent()).replace(/\s+/g, ' ').trim();
	ok(noteText.includes('Загрузка не закончена.') && noteText.includes(`Том 7 (большой).pdf — 5,0 из ${total} МБ`),
		`страница открыта заново: «${noteText.slice(0, 150)}»`);
	sent.length = 0;
	await page.getByTestId('case-pick-files').setInputFiles(big);
	await item.filter({ hasText: 'передан на обработку' }).waitFor({ timeout: 120000 });
	const again = [...sent];
	ok((await page.getByTestId('case-queue').count()) === 0 && JSON.stringify(parts(again)) === '["2"]' && again.some((x) => x.endsWith('/complete')),
		`тот же файл выбран снова: вопросов «что это» нет, дослана только вторая часть (запросы частей до обрыва: ${[...new Set(parts(before))].join(', ')} — вторая оборвана; после: ${parts(again).join(', ')}), файл передан на обработку`);
	ok((await page.evaluate((f) => localStorage.getItem(`case-up:${f}`), folder)) === '{}', 'запись «файл → загрузка» в хранилище браузера снята после завершения (ключ тот же, что у прежней страницы)');

	// --- остальные материалы выдуманного дела: тома, электронное дело, фото; продолжение тома 2 — отдельно, вторым шагом
	const VOLUMES = ['Том 1.pdf', 'Том 2.pdf', 'tom5.pdf'];
	const CONT = 'Том 2 (продолжение).pdf';
	const files = readdirSync(corpus).sort().filter((f) => f !== CONT);
	await page.getByTestId('case-pick-files').setInputFiles(files.map((f) => join(corpus, f)));
	const rows = page.getByTestId('case-queue-row');
	await rows.first().waitFor();
	const n = await rows.count();
	for (let i = 0; i < n; i++) {
		const r = rows.nth(i);
		const name = (await r.locator('.b').first().textContent()).trim();
		if (name.startsWith('Фото:')) await r.getByRole('textbox').fill('3');
		else await r.getByRole('radio', { name: VOLUMES.includes(name) ? 'том дела' : 'электронное дело' }).check();
		if (name === 'Том 2.pdf') await r.getByRole('textbox').fill('2');
	}
	const photoRow = await texts(rows.filter({ hasText: 'Фото:' }).locator('.b'));
	ok(n === 8 && photoRow[0] === 'Фото: 8 шт.', `к загрузке: ${n} строк — 7 PDF по строке и «${photoRow[0]}» одной строкой; указано, что это, тому 2 и фото — номер тома`);
	await shot(page, 'live-case-upload-queue-1280');
	await page.getByTestId('case-upload-start').click();
	await page.waitForFunction(() => {
		const list = [...document.querySelectorAll('[data-testid="case-upload"]')];
		return list.length >= 16 && list.every((e) => e.dataset.state === 'done');
	}, null, { timeout: 180000 });
	ok(true, '15 файлов переданы (по два одновременно), у каждого — «передан на обработку»');
	// продолжение тома: юрист выбирает том из списка — он появляется в списке, как только том заведён (обзор переспрашивается)
	await page.getByTestId('case-pick-files').setInputFiles(join(corpus, CONT));
	const contRow = page.getByTestId('case-queue-row');
	await contRow.getByRole('radio', { name: 'том дела' }).check();
	const contSelect = contRow.locator('select');
	await contSelect.locator('option', { hasText: 'продолжение тома 2' }).waitFor({ state: 'attached', timeout: 180000 });
	ok((await contRow.getByRole('radio', { name: 'том дела' }).isChecked()), 'том 2 появился в списке «продолжение» без перезагрузки; выбранное в строке очереди при этом не сброшено');
	await contSelect.selectOption({ label: 'продолжение тома 2' });
	await page.getByTestId('case-upload-start').click();
	await page.waitForFunction(() => {
		const list = [...document.querySelectorAll('[data-testid="case-upload"]')];
		return list.length >= 17 && list.every((e) => e.dataset.state === 'done');
	}, null, { timeout: 180000 });
	const sentCont = JSON.parse(posted.at(-1) ?? '{}');
	ok(typeof sentCont.continues_volume_id === 'number' && sentCont.volume_hint == null && sentCont.input_kind === 'volume',
		`«${CONT}» передан как продолжение тома 2 (в запросе — continues_volume_id, номера тома нет)`);
	ok(external.length === 0, 'внешних запросов со страницы нет');

	// --- обработка: смотреть на ход на «Обзоре». Подсказок «продолжение тома» быть не должно: том указан при загрузке
	// (кнопка подтверждения подсказки — в разделе «Тома», сдача 3)
	await page.getByTestId('case-nav-overview').click();
	const summary = page.getByTestId('case-summary');
	await page.evaluate(() => (window.__sameDocument = true));
	const seen = new Set();
	const confirmed = new Set();
	const t0 = Date.now();
	let ready = false;
	while (Date.now() - t0 < 600000) {
		const stateNow = await summary.getAttribute('data-state');
		const head = stateNow === 'loading' ? '' : ((await summary.getByRole('heading').count()) ? (await summary.getByRole('heading').first().textContent()).trim() : '');
		const pill = (await summary.locator('.pill').count()) ? (await summary.locator('.pill').first().textContent()).trim() : '';
		seen.add(`${pill}|${head}`);
		const ov = await overviewApi();
		for (const f of ov.overview.files_without_volume ?? []) {
			if (f.input_kind === 'volume' && f.suggest?.volume_id && !confirmed.has(f.id)) {
				const r = await api('PATCH', `/legal-tools/api/cases/${folder}/files/${f.id}`, owner.token, { confirm_suggest: true }, { 'X-Ai-Case': '1', Origin: base });
				confirmed.add(f.id);
				ok(false, `подсказки «продолжение тома» быть не должно — том указан при загрузке: ${f.filename} (${r.status})`);
			}
		}
		const files = Object.values(ov.files ?? {});
		const idx = ov.overview.index_coverage ?? {};
		const done =
			files.length >= 17 && files.every((f) => f.status === 'indexed') && idx.total > 0 && idx.indexed === idx.total &&
			(ov.overview.volumes ?? []).every((v) => v.status === 'inventory_ready') &&
			!(ov.overview.files_without_volume ?? []).some((f) => f.input_kind === 'volume');
		if (done && stateNow === 'ready') {
			ready = true;
			break;
		}
		await page.waitForTimeout(2000);
	}
	const progress = [...seen].filter((x) => /Распознано \d+ из \d+ страниц/.test(x));
	ok(ready, `обработка закончена за ${Math.round((Date.now() - t0) / 1000)} с: «Готово к работе»`);
	ok([...seen].some((x) => x.startsWith('Идёт обработка')) && (await page.evaluate(() => window.__sameDocument === true)),
		`ход был виден без перезагрузки страницы: ${progress.length ? progress.map((x) => x.split('|')[1]).slice(0, 4).join(' → ') : [...seen].join(' / ')}`);
	await page.waitForTimeout(6000); // ещё один оборот обзора — счётчики меню и состав дела
	await shot(page, 'live-case-overview-1280-light');

	// --- сверка с прежней страницей сервиса на этом же деле
	const d = await overviewApi();
	const comp = await texts(page.getByTestId('case-comp-volume'));
	const newVolumes = comp.map((t) => {
		const m = /^Том (\S+) (.+?) (\d+) страниц\S*(?: · л\.д\. (\S+?)–(\S+))? К тому/.exec(t);
		return m ? { label: m[1], state: m[2], pages: Number(m[3]), first: m[4] ?? null, last: m[5] ?? null } : { raw: t };
	});
	const newChecks = Number((await page.getByTestId('case-nav-check').locator('.n').textContent()) ?? 0);
	const newTiles = await texts(page.getByTestId('case-tiles').locator('.tile .v'));
	const newEcase = await texts(page.getByTestId('case-comp-ecase'));
	const old = await context.newPage();
	await old.goto(base + OLD);
	await old.waitForSelector('#sec-volumes .volume');
	await old.waitForSelector('#sec-check h2');
	const oldVolumes = await old.evaluate(() =>
		[...document.querySelectorAll('#sec-volumes .volume')].filter((v) => v.querySelector('.volume-head')).map((v) => {
			const head = v.querySelector('.volume-head');
			const t = head.textContent;
			return {
				label: head.querySelector('h3').textContent.replace('Том ', ''),
				stage: head.querySelector('.badge').textContent,
				pages: Number((/страниц: (\d+)/.exec(t) ?? [])[1]),
				first: (/л\.д\. (\S+?)–(\S+)/.exec(t) ?? [])[1] ?? null,
				last: (/л\.д\. (\S+?)–(\S+?)(?=Метка|История|$)/.exec(t) ?? [])[2] ?? null,
				files: v.querySelectorAll('ul.files > li').length
			};
		})
	);
	const oldChecks = Number(await old.locator('#sec-check h2 .badge').textContent().catch(() => '0'));
	const oldCheckRows = await old.locator('#sec-check ul.list > li').count();
	const oldSummary = (await old.locator('section.summary').textContent()).replace(/\s+/g, ' ');
	const oldEcase = await old.evaluate(() => {
		const box = [...document.querySelectorAll('#sec-volumes .volume')].find((v) => !v.querySelector('.volume-head') && v.querySelector('h3')?.textContent === 'Электронное дело');
		return box ? box.querySelectorAll('ul.files > li').length : 0;
	});
	const oldLoose = await old.evaluate(() => {
		const box = [...document.querySelectorAll('#sec-volumes .volume')].find((v) => v.querySelector('h3')?.textContent === 'Файлы без тома');
		return box ? box.querySelectorAll('ul.files > li').length : 0;
	});
	const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
	ok(same(newVolumes.map((v) => [v.label, v.pages, v.first, v.last]), oldVolumes.map((v) => [v.label, v.pages, v.first, v.last])) && newVolumes.length === d.overview.volumes.length,
		`тома совпадают с прежней страницей (метка, страниц, первый и последний лист): ${newVolumes.map((v) => `т. ${v.label} — ${v.pages} стр., л.д. ${v.first}–${v.last}`).join('; ')}`);
	ok(newVolumes.every((v) => v.state === 'готов') && oldVolumes.every((v) => v.stage === 'опись готова'),
		`состояние томов: на новой странице «готов», на прежней — «${[...new Set(oldVolumes.map((v) => v.stage))].join(', ')}» (те же тома, новое слово — решение владельца)`);
	ok(newChecks === oldChecks && newChecks === d.check_total && Number(newTiles[0]) === oldChecks,
		`«Проверьте листы»: ${newChecks} на новой странице (меню и плитка), ${oldChecks} на прежней, ${d.check_total} в ответе сервиса; строк на прежней — ${oldCheckRows}`);
	ok(Number(newTiles[1]) === oldLoose && oldLoose === (d.overview.files_without_volume ?? []).length, `файлов без тома: ${newTiles[1]} и ${oldLoose}`);
	ok(/(\d+) файл/.test(newEcase[0] ?? '') && Number(/(\d+) файл/.exec(newEcase[0])[1]) === oldEcase && /прочитано/.test(newEcase[0]),
		`электронное дело: ${oldEcase} файлов на обеих страницах, на новой — «прочитано»`);
	ok(!/распознаётся/.test(oldSummary) && Number(newTiles[2]) === (d.uploads ?? []).length,
		`сводка: обработка закончена на обеих страницах; загрузок в работе — ${newTiles[2]}`);
	await old.close();

	// --- «Проверьте листы»: группы и переход на лист
	await page.getByTestId('case-nav-check').click();
	await page.getByTestId('case-check').waitFor();
	const groups = page.getByTestId('case-check-group');
	const heads = await texts(groups.locator('h3'));
	const firstRef = groups.locator('a.ref, a.chipl').first();
	const refText = (await firstRef.textContent()).replace(/\s+/g, ' ').trim();
	const href = await firstRef.getAttribute('href');
	ok(heads.length > 0 && Number(await page.locator('.head .cnt').textContent()) === newChecks && /^\/legal-tools\/case\/.+\/p\/\d+/.test(href),
		`«Проверьте листы»: ${newChecks} замечаний, группы — ${heads.join(' · ')}; у листа своя ссылка (${refText} → ${href.replace(folder, '<папка>')})`);
	await shot(page, 'live-case-check-1280-light');
	await firstRef.click();
	await page.waitForURL((url) => /\/legal-tools\/case\/.+\/p\/\d+/.test(url.pathname), { timeout: 30000 });
	await page.waitForSelector('body[data-page="sheet"]');
	ok(true, `из замечания открыт лист (страница листа сервиса): «${(await page.title()).slice(0, 60)}»`);
	await page.goBack();
	await page.getByTestId('case-check').waitFor({ timeout: 30000 });
	ok(new URL(page.url()).pathname === `${CASE}/check`, '«назад» возвращает в раздел «Проверьте листы»');

	// --- «Открыть лист» по номеру
	await page.getByTestId('case-nav-overview').click();
	const form = page.getByTestId('case-goto').filter({ visible: true });
	await form.locator('select[name="t"] option').first().waitFor({ state: 'attached' });
	const options = await texts(form.locator('select[name="t"] option'));
	ok((await form.locator('select[name="t"]').inputValue()) === '1', `«Открыть лист»: тома по порядку (${options.join(', ')}), выбран первый`);
	await form.locator('select[name="t"]').selectOption('2');
	await page.waitForTimeout(6000); // оборот обзора: выбранный том и введённое остаются
	await form.locator('input[name="l"]').fill('л.д. 5');
	ok((await form.locator('select[name="t"]').inputValue()) === '2', 'выбранный том не сброшен переспрашиванием обзора');
	await form.locator('select[name="t"]').selectOption('1');
	await form.locator('input[name="l"]').fill('л.д. 5');
	await form.getByRole('button', { name: 'Открыть' }).click();
	await page.waitForURL((url) => url.pathname.startsWith(`${OLD}/`), { timeout: 30000 });
	await page.waitForSelector('body[data-page="sheet"], body[data-page="ref"], main');
	ok(/\/p\/\d+|\/ref/.test(new URL(page.url()).pathname), `«Открыть лист»: «т. 1, л.д. 5» → ${new URL(page.url()).pathname.replace(folder, '<папка>')}${new URL(page.url()).search} («${(await page.title()).slice(0, 50)}»)`);

	// --- телефон и тёмная тема на настоящих данных
	await page.goto(base + CASE);
	await page.getByTestId('case-summary').waitFor();
	await page.setViewportSize({ width: 360, height: 800 });
	await page.waitForTimeout(300);
	ok((await sideScroll(page)) === 0, '360 px, обзор: прокрутки вбок нет');
	await shot(page, 'live-case-overview-360-light');
	await page.getByTestId('case-menu-open').click();
	await page.getByTestId('case-menu').getByTestId('case-nav-check').click();
	await page.getByTestId('case-check').waitFor();
	ok((await sideScroll(page)) === 0 && new URL(page.url()).pathname === `${CASE}/check`, '360 px: раздел выбран в меню вверху, «Проверьте листы» без прокрутки вбок');
	await page.evaluate(() => localStorage.setItem('theme', 'dark'));
	await page.reload();
	await page.getByTestId('case-check-group').first().waitFor();
	ok((await page.getByTestId('case-check-row').count()) > 0, '360 px, тёмная тема: раздел открыт заново по своему адресу, замечания на месте');
	await shot(page, 'live-case-check-360-dark');
	await page.setViewportSize({ width: 1280, height: 1000 });
	await page.goto(base + CASE);
	await page.getByTestId('case-composition').waitFor();
	ok((await page.evaluate(() => getComputedStyle(document.querySelector('.card')).backgroundColor)) === 'rgb(30, 30, 40)', 'тёмная тема чата → страница дела тёмная');
	await shot(page, 'live-case-overview-1280-dark');
	await page.evaluate(() => localStorage.setItem('theme', 'light'));

	// --- «Мои дела» → дело без перезагрузки приложения; «В чат дела»
	await page.goto(base + '/case');
	await page.waitForSelector('[data-testid="my-cases"][data-phase="ready"]');
	await page.evaluate(() => (window.__sameDocument = true));
	await page.getByTestId('case-row').filter({ visible: true, hasText: 'Живая проверка — тома дела' }).getByRole('link', { name: 'Открыть дело' }).click();
	await page.waitForURL(base + CASE);
	await page.getByTestId('case-summary').waitFor();
	const chat = page.getByRole('link', { name: 'В чат дела' });
	ok((await page.evaluate(() => window.__sameDocument === true)) && (await chat.getAttribute('href')) === `/folders/${folder}`,
		'«Открыть дело» из «Моих дел» открывает страницу дела без перезагрузки; «В чат дела» ведёт в чат папки /folders/<папка>');
	await chat.click();
	await page.waitForURL(`${base}/folders/${folder}`);
	await page.locator('#sidebar-new-chat-button').filter({ visible: true }).first().waitFor({ timeout: 30000 });
	ok((await page.locator('.cg').count()) === 0, 'чат папки открыт; стили страницы дела в чат не попали');
	await context.close();
}

// ---------------------------------------------------------------- коллега с правом «только чтение»
{
	const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: 'ru-RU' });
	const page = await context.newPage();
	await signIn(page, 'colleague', CASE);
	await page.waitForSelector('[data-testid="case-summary"][data-state="ready"]', { timeout: 30000 });
	const pills = await texts(page.getByTestId('case-summary').locator('.pill'));
	const items = await texts(page.locator('nav.nav a[data-testid^="case-nav-"]'));
	ok(pills.includes('только чтение') && !items.some((x) => /Загрузить материалы|Удаление дела/.test(x)) && items.some((x) => x.startsWith('Проверьте листы')),
		`«только чтение»: пометка рядом с состоянием (${pills.join(', ')}); в меню нет «Загрузить материалы» и «Удаления дела»`);
	ok((await page.getByTestId('case-tiles').locator('.tile').count()) === 2 && (await page.getByText('Вы видите все материалы и разделы дела.').count()) === 1,
		'«только чтение»: все данные обзора видны, плитки «Загрузки» и кнопок загрузки нет');
	await shot(page, 'live-case-overview-1280-readonly');
	await page.goto(base + CASE + '/upload');
	await page.waitForSelector('[data-testid="case-section-none"]');
	ok((await page.getByTestId('case-drop').count()) === 0, '«только чтение»: прямой адрес раздела загрузки — «Не найдено»');
	await page.goto(base + CASE + '/check');
	await page.getByTestId('case-check').waitFor();
	const count = Number(await page.locator('.head .cnt').textContent());
	const denied = await api('POST', `/legal-tools/api/cases/${folder}/uploads`, colleague.token, { filename: 'x.pdf', size: 10, input_kind: 'volume' }, { 'X-Ai-Case': '1', Origin: base });
	ok(count === (await overviewApi(colleague.token)).check_total && denied.status === 404,
		`«только чтение»: «Проверьте листы» те же (${count}); запись сервис не принимает (загрузка → ${denied.status})`);
	const form = page.getByTestId('case-goto').filter({ visible: true });
	ok((await form.count()) === 1, '«только чтение»: «Открыть лист» доступно');
	await context.close();
}

await browser.close();
console.log(fails ? `ИТОГ (страница дела): FAIL — ${fails}` : 'ИТОГ (страница дела): все проверки OK');
process.exit(fails ? 1 : 0);
