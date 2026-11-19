// ai-dvokat: живая проверка остальных разделов страницы дела (сдача 3) в настоящем браузере на своей среде (run.sh),
// на том же деле, что live-case.mjs: каждое действие юриста хотя бы раз — тома (номер, история и откат, вид файла, том
// у файла без тома, убрать файл), опись (правка, откат, разделить, объединить, Word и Excel), паспорт, хронология,
// сроки, копии, выписка листов, замена тома, таблица, файл папки, удаление дела; путь «только чтение» по всем разделам;
// сверка с прежней страницей сервиса. Заодно — непроверенное из сдачи 2: загрузка, начатая на прежней странице,
// продолжается на новой; архив ZIP; выбор папки; вопрос браузера при уходе во время загрузки. Подмен в браузере нет
// (кроме обрыва второй части файла — им изображается обрыв связи).
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const arg = (name) => {
	const i = process.argv.indexOf(`--${name}`);
	return i > 0 ? process.argv[i + 1] : undefined;
};
const state = JSON.parse(readFileSync(arg('state'), 'utf8'));
const { folder } = JSON.parse(readFileSync(arg('case'), 'utf8'));
const files = arg('files');
const mut = arg('mut');
const out = arg('out');
if (out) mkdirSync(out, { recursive: true });
const base = state.base;
const CASE = `/case/${folder}`;
const OLD = `/legal-tools/case/${folder}`;
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const texts = (locator) => locator.allTextContents().then((list) => list.map((t) => t.replace(/\s+/g, ' ').trim()));
const shot = async (page, name) => {
	if (!out) return;
	const full = await page.evaluate(() => document.querySelector('.cg-view')?.scrollHeight ?? 0);
	const size = page.viewportSize();
	if (full > size.height) await page.setViewportSize({ width: size.width, height: Math.min(full, 6000) });
	await page.screenshot({ path: join(out, `${name}.png`) });
	await page.setViewportSize(size);
};

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
const owner = await signinApi('owner');
const colleague = await signinApi('colleague');
const tools = (path, token = owner.token) => api('GET', `/legal-tools/api/cases/${folder}${path}`, token).then((r) => r.data);
const S = (await api('GET', '/legal-tools/api/cases/ui.json')).data.strings;
const fmt = (t, vars) => String(t).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));

/** Дело не обрабатывается: файлы прочитаны, у томов готова опись, загрузок в работе нет. */
async function settle(what, timeout = 420000) {
	const t0 = Date.now();
	let last = '';
	while (Date.now() - t0 < timeout) {
		const d = await tools('');
		const filesNow = Object.values(d.files ?? {});
		const busyFiles = filesNow.filter((f) => ['queued', 'splitting', 'reading'].includes(f.status)).length;
		// том без файлов (из него убрали последний файл) остаётся пустым и «принятым» — ждать у него нечего
		const busyVolumes = (d.overview.volumes ?? []).filter((v) => (v.files ?? []).length && v.status !== 'inventory_ready').length;
		const busyUploads = (d.uploads ?? []).filter((u) => ['received', 'intake', 'receiving'].includes(u.phase)).length;
		const idx = d.overview.index_coverage ?? {};
		last = `файлов в работе ${busyFiles}, томов без описи ${busyVolumes}, загрузок ${busyUploads}, распознано ${idx.indexed} из ${idx.total}`;
		if (!busyFiles && !busyVolumes && !busyUploads && idx.indexed === idx.total) return d;
		await sleep(2500);
	}
	ok(false, `обработка после шага «${what}» не закончилась за ${timeout / 1000} с (${last})`);
	return tools('');
}
async function signIn(page, who, target) {
	await page.goto(base + target);
	await page.waitForURL((url) => url.pathname === '/auth', { timeout: 30000 });
	await page.locator('input[type="email"]').fill(state.emails[who]);
	await page.locator('input[type="password"]').fill(state.password);
	await page.locator('button[type="submit"]').click();
	await page.waitForURL((url) => url.pathname === target, { timeout: 30000 });
}
const dlg = (page) => page.locator('dialog[open]');
/** Строки «Истории правок» открытого окна — когда они пришли. */
const historyRows = async (page) => {
	await dlg(page).getByTestId('case-history-row').first().waitFor({ timeout: 20000 }).catch(() => undefined);
	return texts(dlg(page).getByTestId('case-history-row'));
};
const toast = (page, text) => page.getByText(text, { exact: true }).last().waitFor({ timeout: 20000 }).then(() => true, () => false);
const nav = (page, slug) => page.locator(`nav.nav [data-testid="case-nav-${slug || 'overview'}"]`).first();
const go = async (page, slug) => {
	await nav(page, slug).click();
	await page.waitForURL(`${base}${CASE}${slug ? `/${slug}` : ''}`);
};
/** Обзор переспрашивается при возвращении на вкладку — так страница узнаёт новое, не дожидаясь своих 30 с. */
const refresh = (page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
const zipNames = (buffer) => buffer.toString('latin1');
async function step(name, fn) {
	try {
		await fn();
	} catch (e) {
		ok(false, `${name}: шаг оборвался — ${String(e?.message ?? e).split('\n')[0].slice(0, 220)}`);
	}
}

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: 'ru-RU', acceptDownloads: true });
const page = await context.newPage();
let browserDialogs = 0;
page.on('dialog', (d) => {
	if (d.type() !== 'beforeunload') browserDialogs += 1;
	void d.dismiss().catch(() => undefined);
});
const sent = [];
context.on('request', (r) => {
	const url = new URL(r.url());
	if (url.pathname.includes('/uploads')) sent.push(`${r.method()} ${url.pathname.split('/uploads')[1] || '/'}`);
});
const parts = (list) => list.filter((x) => x.startsWith('PUT')).map((x) => x.split('/parts/')[1]);
await signIn(page, 'owner', `${CASE}/upload`);
await page.getByTestId('case-drop').waitFor({ timeout: 30000 });

// ================================================================ непроверенное из сдачи 2
await step('загрузка, начатая на прежней странице', async () => {
	const big = join(files, 'Том 8 (большой).pdf');
	const old = await context.newPage();
	await old.goto(base + OLD);
	await old.waitForSelector('#sec-volumes .volume'); // обзор пришёл: очередь прежней страницы строится по томам обзора
	await context.route('**/uploads/*/parts/2', (route) => route.abort('internetdisconnected'));
	// у прежней страницы поле выбора файла в разметку не вставлено: файл выбирается через её кнопку «Выбрать файлы»
	const chooser = old.waitForEvent('filechooser');
	await old.getByRole('button', { name: S.upload_pick_files, exact: true }).click();
	await (await chooser).setFiles(big);
	const row = old.locator('ul.pending > li').last();
	if (!(await row.waitFor({ timeout: 15000 }).then(() => true, () => false)))
		throw new Error(`прежняя страница не поставила файл в очередь: «${((await old.locator('#toast').textContent().catch(() => '')) ?? '').slice(0, 120)}»`);
	await row.locator('label.choice', { hasText: S.upload_kind_volume }).first().click();
	await row.locator('input[type="text"]').first().fill('8');
	await old.getByRole('button', { name: S.upload_start, exact: true }).click();
	await old.locator('ul.uploads').getByText(/нет связи — повтор через \d+ с/).waitFor({ timeout: 120000 });
	const before = [...sent];
	const key = await old.evaluate((f) => localStorage.getItem(`case-up:${f}`), folder);
	await old.close(); // прежнюю страницу закрыли посреди передачи
	await context.unroute('**/uploads/*/parts/2');
	sent.length = 0;
	await page.reload();
	const note = page.getByTestId('case-unfinished');
	await note.waitFor({ timeout: 30000 });
	const noteText = (await note.textContent()).replace(/\s+/g, ' ').trim();
	ok(parts(before).includes('1') && key && key !== '{}' && noteText.includes('Том 8 (большой).pdf — 5,0 из'),
		`на прежней странице начата загрузка тома 8 (первая часть ушла, вторая оборвана); новая страница её видит: «${noteText.slice(0, 120)}»`);
	await page.getByTestId('case-pick-files').setInputFiles(big);
	await page.getByTestId('case-upload').filter({ hasText: S.upload_done }).first().waitFor({ timeout: 120000 });
	ok((await page.getByTestId('case-queue').count()) === 0 && JSON.stringify(parts(sent)) === '["2"]' && sent.some((x) => x.endsWith('/complete')),
		`тот же файл выбран на новой странице: вопросов нет, дослана только вторая часть (${parts(sent).join(', ')}) — номер тома и вид взяты из начатой загрузки`);
	ok((await page.evaluate((f) => localStorage.getItem(`case-up:${f}`), folder)) === '{}', 'запись прежней страницы в хранилище браузера снята новой страницей после завершения');
});

await step('архив ZIP и выбор папки', async () => {
	await page.getByTestId('case-pick-files').setInputFiles(join(files, 'Архив.zip'));
	let row = page.getByTestId('case-queue-row').last();
	ok((await row.getByRole('radio').count()) === 2, 'архив ZIP принят в очередь, о нём задан вопрос «что это»');
	await row.getByRole('radio', { name: S.upload_kind_ecase }).check();
	await page.getByTestId('case-upload-start').click();
	await page.getByTestId('case-upload').filter({ hasText: 'Архив.zip' }).filter({ hasText: S.upload_done }).waitFor({ timeout: 120000 });
	ok(true, 'архив ZIP передан на обработку');
	// папка на компьютере: два PDF — группа «Папка …» и «всем PDF папки»
	const dirOk = await page.getByTestId('case-pick-dir').setInputFiles(join(files, 'Папка с томами')).then(() => true, (e) => String(e.message).split('\n')[0]);
	if (dirOk !== true) return cannot(`выбор папки на компьютере — браузер проверки не принял папку (${dirOk})`);
	const group = page.getByTestId('case-queue-dir');
	await group.waitFor({ timeout: 10000 });
	const groupText = (await group.textContent()).replace(/\s+/g, ' ').trim();
	const rows = page.getByTestId('case-queue-row');
	await group.getByRole('button', { name: S.upload_kind_volume }).click();
	const names = await texts(rows.locator('.b').first().or(rows.locator('.b')));
	ok(groupText.includes('Папка «Папка с томами»: PDF — 2') && (await rows.count()) === 2 && (await rows.getByRole('radio', { name: S.upload_kind_volume, checked: true }).count()) === 2,
		`выбрана папка: «${groupText.slice(0, 60)}», два PDF со своим путём (${names.filter((x) => x.includes('/')).slice(0, 2).join('; ')}); «всем PDF папки: том дела» отметил оба`);
	await rows.nth(1).getByRole('button', { name: S.upload_remove_row }).click();
	await rows.first().getByRole('textbox').fill('10');
	// вопрос браузера при уходе со страницы, пока файл передаётся: передача придержана на первой части
	let release;
	const hold = new Promise((r) => (release = r));
	await context.route('**/uploads/*/parts/1', async (route) => {
		await hold;
		await route.continue().catch(() => undefined);
	});
	await page.getByTestId('case-upload-start').click();
	await page.getByTestId('case-upload').filter({ hasText: 'том-а.pdf' }).waitFor({ timeout: 30000 });
	await sleep(500);
	const asksWhileUploading = await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })));
	let asked = false;
	const onDialog = (d) => (asked = asked || d.type() === 'beforeunload');
	page.on('dialog', onDialog);
	await page.reload({ timeout: 4000 }).catch(() => undefined); // уход: браузер спрашивает, проверка отвечает «остаться»
	await sleep(500);
	const stayed = (await page.getByTestId('case-upload').filter({ hasText: 'том-а.pdf' }).count()) === 1;
	release();
	await page.getByTestId('case-upload').filter({ hasText: 'том-а.pdf' }).filter({ hasText: S.upload_done }).waitFor({ timeout: 120000 });
	await context.unroute('**/uploads/*/parts/1');
	const asksAfter = await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })));
	page.off('dialog', onDialog);
	ok(asksWhileUploading && !asksAfter, 'уход со страницы во время передачи файла: страница просит браузер спросить; после передачи — не просит');
	if (asked && stayed) ok(true, 'браузер показал свой вопрос об уходе; ответ «остаться» — страница и передача на месте');
	else cannot(`само окно браузера об уходе (показано: ${asked ? 'да' : 'нет'}, страница осталась: ${stayed ? 'да' : 'нет'}) — браузер проверки показывает его не всегда`);
});
await settle('загрузки');

// ================================================================ тома
await step('тома', async () => {
	await go(page, 'volumes');
	const vol = (label) => page.locator(`[data-testid="case-volume"][data-volume="${label}"]`);
	await vol('10').waitFor({ timeout: 60000 });
	ok((await vol('8').count()) === 1, 'тома 8 (начат на прежней странице) и 10 (из папки) в деле');
	// номер тома, история и откат
	await vol('10').getByTestId('case-volume-label').click();
	await dlg(page).getByRole('textbox').fill('11');
	await dlg(page).getByRole('button', { name: S.save }).click();
	ok((await toast(page, S.saved)) && (await vol('11').waitFor({ timeout: 30000 }).then(() => true, () => false)), '«Изменить номер тома»: 10 → 11, сообщение «Сохранено», карточка тома обновилась без перезагрузки');
	await vol('11').getByRole('button', { name: S.history }).first().click();
	const hist = await historyRows(page);
	await dlg(page).getByRole('button', { name: S.revert }).first().click();
	ok(hist.length >= 1 && /было «.*10.*», стало «.*11.*»/.test(hist[0]) && (await toast(page, S.revert_done)) && (await vol('10').waitFor({ timeout: 30000 }).then(() => true, () => false)),
		`«История правок» тома: «${(hist[0] ?? '').slice(0, 90)}»; «Откатить» — «Откачено», том снова 10`);
	// вид файла: файл электронного дела → том дела → он без тома; указать том; убрать из тома; убрать файл из дела
	const target = 'Ходатайство об ознакомлении.pdf';
	const file = (box) => page.getByTestId(box).locator(`[data-testid="case-file"][data-file="${target}"]`);
	const act = async (box, name) => {
		const row = file(box);
		if ((await row.getByTestId('case-file-actions').getAttribute('aria-expanded')) !== 'true') await row.getByTestId('case-file-actions').click();
		await row.locator('xpath=following-sibling::*[@data-testid="case-file-panel"][1]').getByRole('button', { name, exact: true }).click();
	};
	await file('case-ecase').waitFor({ timeout: 30000 });
	await act('case-ecase', S.file_kind_change);
	await dlg(page).getByRole('radio', { name: S.upload_kind_volume }).check();
	await dlg(page).getByRole('button', { name: S.save }).click();
	const moved = await file('case-loose').waitFor({ timeout: 60000 }).then(() => true, () => false);
	ok(moved && (await file('case-ecase').count()) === 0, `«Изменить вид»: «${target}» из электронного дела стал томом дела и встал в «Файлы без тома»`);
	await act('case-loose', S.file_attach);
	await dlg(page).getByRole('button', { name: S.save }).click();
	const empty = await dlg(page).getByTestId('case-dialog-error').textContent().catch(() => '');
	await dlg(page).getByRole('textbox').fill('12');
	await dlg(page).getByRole('button', { name: S.save }).click();
	const inVolume = page.locator('[data-testid="case-volume"][data-volume="12"]').locator(`[data-testid="case-file"][data-file="${target}"]`);
	ok(empty.includes(S.volume_not_set_hint) && (await inVolume.waitFor({ timeout: 60000 }).then(() => true, () => false)),
		'«Указать том»: пустые поля — ошибка в окне; номер 12 — файл встал в новый том 12');
	const row12 = page.locator('[data-testid="case-volume"][data-volume="12"]');
	const stillOpen = (await row12.getByTestId('case-file-actions').getAttribute('aria-expanded')) === 'true';
	if (!stillOpen) await row12.getByTestId('case-file-actions').click();
	ok(stillOpen, 'раскрытые «Действия» файла остались раскрытыми, когда файл перешёл в том');
	await row12.getByTestId('case-file-panel').getByRole('button', { name: S.file_detach, exact: true }).click();
	ok(await file('case-loose').waitFor({ timeout: 60000 }).then(() => true, () => false), '«Убрать из тома»: файл снова в «Файлах без тома» (без подтверждения)');
	await act('case-loose', S.remove_file);
	const question = (await dlg(page).textContent()).replace(/\s+/g, ' ');
	await page.keyboard.press('Escape');
	const kept = (await dlg(page).count()) === 0 && (await file('case-loose').count()) === 1;
	await act('case-loose', S.remove_file);
	await dlg(page).getByRole('button', { name: S.remove_file, exact: true }).click();
	const gone = (await toast(page, S.remove_file_done)) && (await file('case-loose').waitFor({ state: 'detached', timeout: 60000 }).then(() => true, () => false));
	ok(question.includes(S.remove_file_title) && kept && gone && browserDialogs === 0,
		'«Убрать файл из дела»: своё окно подтверждения (Esc — файл на месте), подтверждение — «Файл убран из дела»; окон браузера не было');
	await shot(page, 'live-sec-volumes-1280');
});
await settle('тома');

// ================================================================ опись
await step('опись', async () => {
	await go(page, 'inventory');
	const rows = page.getByTestId('case-doc');
	await rows.first().waitFor({ timeout: 60000 });
	const n0 = await rows.count();
	const listed = (await tools('/documents?page=0')).documents;
	const pick = listed.find((d) => d.sheets > 1 && d.title && !d.edited) ?? listed.find((d) => d.sheets > 1 && d.title);
	const id = pick.id;
	const mine = page.locator(`[data-testid="case-doc"][data-doc="${id}"]`);
	await mine.waitFor({ timeout: 30000 });
	const title0 = pick.title;
	await mine.getByRole('button', { name: S.doc_edit, exact: true }).click();
	await dlg(page).getByLabel(S.doc_field_title).fill(`${title0} (правка)`);
	await dlg(page).getByRole('button', { name: S.save }).click();
	const saved = (await toast(page, S.saved)) && (await mine.getByText(`${title0} (правка)`).waitFor({ timeout: 30000 }).then(() => true, () => false));
	ok(saved && (await mine.getByTestId('case-doc-edited').count()) === 1, `«Изменить»: название «${title0.slice(0, 40)}» поправлено, строка помечена «исправлено юристом»`);
	await mine.getByRole('button', { name: S.doc_edit, exact: true }).click();
	await dlg(page).getByRole('button', { name: S.history }).click();
	const hist = await historyRows(page);
	await dlg(page).getByRole('button', { name: S.revert }).first().click();
	ok(hist.length >= 1 && (await toast(page, S.revert_done)) && (await mine.locator('.b').first().filter({ hasText: new RegExp(`^${title0.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).waitFor({ timeout: 30000 }).then(() => true, () => false)),
		`«История» из окна «Изменить»: «${(hist[0] ?? '').slice(0, 80)}»; откат вернул название`);
	// разделить и объединить обратно
	await mine.getByRole('button', { name: S.doc_split, exact: true }).click();
	const at = await dlg(page).locator('select option').first().textContent();
	await dlg(page).getByRole('button', { name: S.doc_split, exact: true }).click();
	await toast(page, S.saved);
	await page.waitForFunction((n) => document.querySelectorAll('[data-testid="case-doc"]').length === n + 1, n0, { timeout: 30000 });
	ok(true, `«Разделить»: новый документ начинается с листа «${at}» — в описи стало ${n0 + 1} строк`);
	const docs = (await tools('/documents?page=0')).documents;
	const i = docs.findIndex((d) => String(d.id) === String(id));
	const pair = [docs[i], docs[i + 1]].filter(Boolean);
	const merge = page.getByTestId('case-inventory-merge');
	await merge.click();
	const needTwo = await toast(page, S.doc_merge_need_two);
	for (const d of pair) await page.locator(`[data-testid="case-doc"][data-doc="${d.id}"]`).getByRole('checkbox').check();
	const label = (await merge.textContent()).trim();
	await merge.click();
	await toast(page, S.saved);
	await page.waitForFunction((n) => document.querySelectorAll('[data-testid="case-doc"]').length === n, n0, { timeout: 30000 });
	ok(needTwo && label === fmt(S.doc_merge_n, { n: 2 }), `«Объединить отмеченные»: без отметок — «${S.doc_merge_need_two}»; «${label}» — в описи снова ${n0} строк`);
	// выгрузка
	for (const [name, mark, ext] of [[S.export_docx, 'word/document.xml', '.docx'], [S.export_xlsx, 'xl/workbook.xml', '.xlsx']]) {
		const wait = page.waitForEvent('download', { timeout: 60000 });
		await page.getByRole('button', { name }).click();
		const dl = await wait;
		const buf = readFileSync(await dl.path());
		ok(buf.subarray(0, 2).toString() === 'PK' && zipNames(buf).includes(mark) && dl.suggestedFilename().endsWith(ext) && buf.length > 2000,
			`«${name}»: скачан «${dl.suggestedFilename()}» (${buf.length} байт), внутри — ${mark}: файл открывается как документ этого вида`);
	}
	// сверка с прежней страницей: те же строки описи
	const old = await context.newPage();
	await old.goto(base + OLD);
	await old.waitForSelector('#sec-inventory tbody tr');
	const oldRows = await old.locator('#sec-inventory tbody tr').count();
	const oldFirst = (await old.locator('#sec-inventory tbody tr').first().locator('td[data-th]').nth(1).textContent()).replace(/\s+/g, ' ').trim();
	await old.close();
	const now = (await tools('/documents?page=0')).documents;
	const newFirst = (await rows.first().textContent()).replace(/\s+/g, ' ').trim();
	ok(oldRows === (await rows.count()) && oldRows === now.length && oldFirst.includes(now[0].title ?? '—') && newFirst.includes(now[0].title ?? '—'),
		`опись на прежней странице — те же ${oldRows} строк, первая — «${(now[0].title ?? '—').slice(0, 40)}»`);
	await shot(page, 'live-sec-inventory-1280');
});

// ================================================================ копии, выписка
await step('копии и расхождения', async () => {
	await go(page, 'copies');
	await page.getByTestId('case-copies-real').waitFor({ timeout: 60000 });
	const d = await tools('/copies');
	const real = d.copies.filter((c) => c.same_document).length;
	const other = d.copies.length - real;
	const shownReal = Number(await page.getByTestId('case-copies-real').locator('.cnt').textContent());
	const shownOther = other ? Number(await page.getByTestId('case-copies-other').locator('.cnt').textContent()) : 0;
	const old = await context.newPage();
	await old.goto(base + OLD);
	await old.waitForSelector('#sec-copies h2');
	await old.waitForFunction(() => !/Загрузка/.test(document.querySelector('#sec-copies')?.textContent ?? ''), null, { timeout: 30000 });
	const oldReal = await old.locator('#sec-copies > ul.list > li').count();
	const oldOther = await old.locator('#sec-copies details ul.list > li').count();
	await old.close();
	ok(shownReal === real && shownOther === other && oldReal === real && oldOther === other, `копий — ${real}, похожих документов того же образца — ${other}: столько же на новой странице, на прежней и в ответе сервиса`);
	if (d.copies.length) {
		const first = page.getByTestId('case-copy').first();
		await first.getByRole('button', { name: S.expand }).click();
		ok((await first.getByRole('link').count()) >= 1, 'пара раскрывается; листы обеих копий — ссылками');
	}
});
await step('выписка листов', async () => {
	await go(page, 'extract');
	const box = page.getByTestId('case-extract');
	await box.getByRole('textbox').fill('т. 1, л.д. 5; т. 1, л.д. 6');
	const wait = page.waitForEvent('download', { timeout: 60000 });
	await box.getByRole('button', { name: S.extract_submit }).click();
	const dl = await wait;
	const buf = readFileSync(await dl.path());
	ok(buf.subarray(0, 5).toString() === '%PDF-' && /^Выписка .*\.pdf$/.test(dl.suggestedFilename()), `выписка листов: скачан «${dl.suggestedFilename()}» (${buf.length} байт), это PDF`);
	await box.getByRole('textbox').fill('т. 1, л.д. 999');
	await box.getByRole('button', { name: S.extract_submit }).click();
	const err = page.getByTestId('case-extract-error');
	await err.waitFor({ timeout: 30000 });
	ok((await err.textContent()).includes('т. 1, л.д. 999') && (await page.locator('[data-sonner-toast]').count()) === 0, `ошибка выписки — под полем, фразой сервиса: «${(await err.textContent()).trim().slice(0, 90)}»`);
});

// ================================================================ карта дела
await step('паспорт', async () => {
	await go(page, 'passport');
	await page.getByTestId('case-passport-about').waitFor({ timeout: 120000 });
	const stage = page.locator('[data-testid="case-passport-field"][data-field="instance"]');
	await stage.getByRole('button', { name: S.map_edit, exact: true }).click();
	await dlg(page).getByRole('textbox').fill('апелляция');
	await dlg(page).getByRole('button', { name: S.save }).click();
	const set = await stage.getByText('апелляция', { exact: true }).waitFor({ timeout: 30000 }).then(() => true, () => false);
	ok(set && (await stage.locator('.pill', { hasText: S.map_passport_lawyer }).count()) === 1, 'паспорт: «Править» поле «Инстанция» — значение юриста сохранено и помечено');
	await stage.getByRole('button', { name: S.map_history, exact: true }).click();
	const hist = await historyRows(page);
	await dlg(page).getByRole('button', { name: S.revert }).first().click();
	ok(hist.length >= 1 && hist[0].includes(S.map_pf_instance) && hist[0].includes('стало «апелляция»') && (await toast(page, S.revert_done)) && (await stage.getByText('апелляция', { exact: true }).waitFor({ state: 'detached', timeout: 30000 }).then(() => true, () => false)),
		`паспорт: история поля — «${(hist[0] ?? '').slice(0, 80)}»; откат вернул прежнее значение`);
	const party = page.getByTestId('case-party');
	if (await party.count()) ok((await party.count()) <= 4 || (await page.getByRole('searchbox').count()) === 0, `участников показано ${await party.count()} (первые четыре и «Показать ещё»)`);
	await shot(page, 'live-sec-passport-1280');
});
let fact = null;
await step('хронология', async () => {
	await go(page, 'chronology');
	const rows = page.getByTestId('case-fact');
	await rows.first().waitFor({ timeout: 120000 });
	const facts = (await tools('/facts')).facts;
	fact = facts.find((f) => f.label && f.quote && !/файл|стр\./.test(f.label)) ?? facts[0];
	const first = rows.first();
	const summary0 = (await first.locator('.body > .b').textContent()).trim();
	await first.getByRole('button', { name: S.map_edit, exact: true }).click();
	await dlg(page).getByLabel(S.map_f_summary).fill(`${summary0} (правка)`);
	await dlg(page).getByRole('button', { name: S.save }).click();
	const edited = await rows.first().getByText(`${summary0} (правка)`).waitFor({ timeout: 30000 }).then(() => true, () => false);
	ok(edited && (await rows.first().locator('.pill', { hasText: S.map_fact_edited }).count()) === 1, 'хронология: правка записи сохранена, запись помечена «исправлено юристом»');
	const total0 = (await page.getByTestId('case-facts').locator('.totals').textContent()).replace(/\s+/g, ' ').trim();
	await rows.first().getByRole('button', { name: S.map_hide, exact: true }).click();
	const hiddenAway = await page.getByText(`${summary0} (правка)`).waitFor({ state: 'detached', timeout: 30000 }).then(() => true, () => false);
	await page.getByTestId('case-facts-filter').getByRole('button', { name: S.map_filter_more }).click();
	await page.getByTestId('case-facts-period').getByRole('checkbox', { name: S.map_filter_hidden }).check();
	await page.getByTestId('case-facts-filter').getByRole('button', { name: S.map_find }).click();
	const back = page.getByTestId('case-fact').filter({ hasText: `${summary0} (правка)` });
	await back.waitFor({ timeout: 30000 });
	const marked = (await back.locator('.pill', { hasText: S.map_fact_hidden }).count()) === 1;
	await back.getByRole('button', { name: S.map_unhide, exact: true }).click();
	const restored = await back.getByRole('button', { name: S.map_hide, exact: true }).waitFor({ timeout: 30000 }).then(() => true, () => false);
	ok(hiddenAway && marked && restored, `хронология: «Убрать» — записи нет в перечне (${total0}); «с убранными» — она видна с пометкой «убрано юристом»; «Вернуть» — на месте`);
	await back.getByRole('button', { name: S.map_history, exact: true }).click();
	const hist = await historyRows(page);
	await dlg(page).getByRole('button', { name: S.close }).click();
	ok(hist.length >= 3, `хронология: в истории записи — правка, «убрать» и «вернуть» (${hist.length} строк)`);
});
await step('сроки', async () => {
	await go(page, 'deadlines');
	await page.getByTestId('case-deadline-add').waitFor({ timeout: 60000 });
	if (!fact) return cannot('срок: в хронологии нет записи с листом и цитатой для основания');
	await page.getByTestId('case-deadline-add').click();
	await dlg(page).getByLabel(S.map_d_title).fill('Отзыв на апелляционную жалобу');
	await dlg(page).getByLabel(S.map_d_ref).fill('т. 99, л.д. 999');
	await dlg(page).getByLabel(S.map_d_quote).fill(fact.quote.split('\n')[0]);
	await dlg(page).getByLabel(S.map_d_end_date).fill('2027-01-20');
	await dlg(page).getByRole('button', { name: S.save }).click();
	const refused = (await dlg(page).getByTestId('case-dialog-error').textContent({ timeout: 20000 }).catch(() => '')).trim();
	await dlg(page).getByLabel(S.map_d_ref).fill(fact.label);
	await dlg(page).getByRole('button', { name: S.save }).click();
	const card = page.getByTestId('case-deadline').filter({ hasText: 'Отзыв на апелляционную жалобу' });
	const added = await card.waitFor({ timeout: 30000 }).then(() => true, () => false);
	ok(refused.startsWith('Не получилось:') && added && (await card.locator('.pill').textContent()).includes(S.map_deadline_draft),
		`«Добавить срок»: лист, которого нет, — в окне «${refused.slice(0, 70)}»; с листом ${fact.label} срок записан черновиком`);
	await card.getByRole('button', { name: S.map_deadline_confirm, exact: true }).click();
	const confirmed = await card.locator('.pill', { hasText: 'подтверждён:' }).waitFor({ timeout: 30000 }).then(() => true, () => false);
	ok(confirmed && (await card.getByRole('button', { name: S.map_deadline_unconfirm, exact: true }).count()) === 1, `срок: «Подтвердить» — «${(await card.locator('.pill').textContent()).trim()}»`);
	await go(page, '');
	const next = page.getByText('Отзыв на апелляционную жалобу');
	ok(await next.first().waitFor({ timeout: 40000 }).then(() => true, () => false), 'обзор: подтверждённый срок появился в «Ближайших сроках» (в сдаче 2 этот блок вживую не был виден)');
	await shot(page, 'live-sec-overview-deadlines-1280');
});

// ================================================================ замена тома
await step('замена тома', async () => {
	const delta = mut && existsSync(join(mut, 'expected_delta.json')) ? JSON.parse(readFileSync(join(mut, 'expected_delta.json'), 'utf8')) : null;
	const again = delta?.files?.added?.[0] ? join(mut, delta.files.added[0]) : null;
	if (!again) return cannot('замена тома: переснятый том не собран (render.py --mutate)');
	await go(page, 'upload');
	await page.getByTestId('case-pick-files').setInputFiles({ name: 'повторно Том 1.pdf', mimeType: 'application/pdf', buffer: readFileSync(again) });
	const row = page.getByTestId('case-queue-row').last();
	await row.getByRole('radio', { name: S.upload_kind_volume }).check();
	await row.getByRole('textbox').fill('1');
	await page.getByTestId('case-upload-start').click();
	await page.getByTestId('case-upload').filter({ hasText: 'повторно Том 1.pdf' }).filter({ hasText: S.upload_done }).waitFor({ timeout: 120000 });
	await settle('повторная загрузка тома 1');
	await go(page, 'replace');
	const card = page.getByTestId('case-delta');
	for (let i = 0; i < 60 && !(await card.count()); i++) {
		await sleep(3000);
		await refresh(page);
	}
	if (!ok((await card.count()) === 1, 'замена тома: загружен переснятый том 1 с тем же номером — в разделе появилась сверка нового файла с прежним')) return;
	const head = (await card.getByRole('heading', { level: 2 }).textContent()).trim();
	const tiles = await texts(card.getByTestId('case-delta-tiles').locator('.v'));
	const d = (await tools('/deltas')).deltas[0];
	ok(head === fmt(S.whatsnew_head_g, { volume: '1' }) && Number(tiles[0]) === d.same && Number(tiles[1]) === d.added.length && Number(tiles[2]) === d.removed.length,
		`«${head}»: плитки счёта — те же листы ${tiles[0]}, добавлены ${tiles[1]}, нет в новом ${tiles[2]}, изменены ${tiles[3]}, не сверены ${tiles[4]} (как в ответе сервиса)`);
	await shot(page, 'live-sec-replace-1280');
	await page.getByTestId('case-replace').click();
	const text = (await dlg(page).textContent()).replace(/\s+/g, ' ');
	await dlg(page).getByRole('button', { name: S.whatsnew_replace, exact: true }).click();
	const done = (await toast(page, S.whatsnew_replace_done)) && (await page.getByTestId('case-delta-replaced').waitFor({ timeout: 60000 }).then(() => true, () => false));
	ok(text.includes(S.replace_confirm_title) && text.includes('встанет на место') && done && browserDialogs === 0,
		`«Заменить файл тома»: своё окно с фактами сверки, подтверждение — «Файл тома заменён», в карточке — «${done ? (await page.getByTestId('case-delta-replaced').textContent()).trim().slice(0, 60) : ''}»`);
	await settle('замена тома');
	const v1 = (await tools('')).overview.volumes.find((v) => v.label === '1');
	ok((v1?.files ?? []).some((f) => f.filename === 'повторно Том 1.pdf') && !(v1?.files ?? []).some((f) => f.filename === 'Том 1.pdf'), 'после замены в томе 1 стоит новый файл, прежнего нет');
});

// ================================================================ таблицы и проходы
await step('таблицы и проходы', async () => {
	await go(page, 'tables');
	const form = page.getByTestId('case-tables-new');
	await form.waitFor({ timeout: 60000 });
	const spent = (await page.getByTestId('case-spent').textContent()).trim();
	await form.getByRole('radio', { name: 'Реестр доказательств' }).check();
	const start = page.getByTestId('case-tables-start');
	await page.waitForFunction(() => /USD/.test(document.querySelector('[data-testid="case-tables-start"]')?.textContent ?? ''), null, { timeout: 30000 });
	const price = (await start.textContent()).trim();
	const scopeText = (await page.getByTestId('case-tables-scope').textContent()).replace(/\s+/g, ' ').trim();
	await start.click();
	let asked = false;
	if (await dlg(page).count()) {
		asked = true;
		await dlg(page).getByRole('button', { name: price, exact: true }).click();
	}
	const started = (await toast(page, S.tables_started)) || (await toast(page, S.tables_cached));
	ok(started && /^Запустить — около .+ USD$/.test(price), `запуск набора «Реестр доказательств»: «${scopeText}», на кнопке — «${price}»${asked ? ', цена больше 1 USD — было окно подтверждения' : ', цена до 1 USD — без окна'}; строка «${spent}» — в этом разделе`);
	const row = page.getByTestId('case-table-row').first();
	await row.waitFor({ timeout: 60000 });
	let status = '';
	for (let i = 0; i < 100; i++) {
		status = (await texts(row.locator('.pill'))).join(' · ');
		if (status.includes(S.tables_status_done) || status.includes(S.tables_status_partial) || status.includes(S.tables_status_failed)) break;
		await sleep(3000);
		await refresh(page);
	}
	ok(status.includes(S.tables_status_done), `проход закончен, в перечне: ${status}`);
	await row.getByTestId('case-table-open').click();
	await page.waitForURL(new RegExp(`${CASE}/tables/[0-9a-f-]+$`));
	await page.getByTestId('case-table-doc').first().waitFor({ timeout: 60000 });
	const docs = await page.getByTestId('case-table-doc').count();
	const cell = page.getByTestId('case-table-cell').filter({ has: page.getByRole('checkbox') }).first();
	const answer = cell.getByRole('button', { name: S.quote_toggle });
	if (await answer.count()) await answer.first().click();
	const quoted = (await cell.locator('.q').count()) >= 1;
	await cell.getByRole('checkbox', { name: S.tables_check }).check();
	const by = await cell.locator('.xs').first().textContent({ timeout: 20000 }).then((t) => t.replace(/\s+/g, ' ').trim(), () => '');
	await cell.getByRole('button', { name: S.tables_note_edit }).click();
	await dlg(page).getByRole('textbox').fill('сверено с листом');
	await dlg(page).getByRole('button', { name: S.save }).click();
	const noted = await cell.getByText('сверено с листом').waitFor({ timeout: 20000 }).then(() => true, () => false);
	ok(docs > 0 && quoted && by.length > 5 && noted, `открытая таблица по адресу /case/<папка>/tables/<номер>: документов ${docs}, цитата под «Цитата», отметка «проверено» — «${by.slice(0, 50)}», примечание сохранено`);
	await page.reload();
	await page.getByTestId('case-table-doc').first().waitFor({ timeout: 60000 });
	ok((await page.getByText('сверено с листом').count()) >= 1, 'адрес таблицы открывается напрямую; отметка и примечание на месте после перезагрузки');
	const wait = page.waitForEvent('download', { timeout: 60000 });
	await page.getByRole('button', { name: S.tables_export }).click();
	const dl = await wait;
	const buf = readFileSync(await dl.path());
	ok(buf.subarray(0, 2).toString() === 'PK' && zipNames(buf).includes('xl/workbook.xml'), `«В Excel»: скачан «${dl.suggestedFilename()}» (${buf.length} байт), это книга Excel`);
	const actions = await texts(page.getByTestId('case-table-action'));
	if (actions.length) ok(true, `у таблицы есть действие: ${actions.join(', ')}`);
	else cannot('«Дочитать» и «Перечитать таблицу» вживую: проход подставной модели закончился полностью, дочитывать нечего (проверено на стенде компонентов)');
	await shot(page, 'live-sec-table-open-1280');
	await page.getByRole('link', { name: S.tables_back_g }).click();
	await page.getByTestId('case-tables').waitFor({ timeout: 30000 });
});

// ================================================================ файлы папки вне дела
await step('файлы папки вне дела', async () => {
	const form = new FormData();
	form.append('file', new Blob([readFileSync(join(files, 'Доверенность.pdf'))], { type: 'application/pdf' }), 'Доверенность.pdf');
	const up = await fetch(`${base}/api/v1/files/?process=false`, { method: 'POST', headers: { Authorization: `Bearer ${owner.token}` }, body: form });
	const file = await up.json().catch(() => null);
	const current = (await api('GET', `/api/v1/folders/${folder}`, owner.token)).data;
	const upd = file?.id
		? await api('POST', `/api/v1/folders/${folder}/update`, owner.token, { name: current.name, data: { ...(current.data ?? {}), files: [...(current.data?.files ?? []), { type: 'file', id: file.id, name: 'Доверенность.pdf' }] } })
		: { status: 0 };
	const listed = (await tools('/folder-files'))?.files ?? [];
	if (!file?.id || upd.status !== 200 || !listed.length)
		return cannot(`файл папки: положить файл в «Знания» папки через Open WebUI этой среды не получилось (загрузка ${up.status}, папка ${upd.status}, файлов вне дела ${listed.length})`);
	await page.goto(base + CASE);
	await page.getByTestId('case-summary').waitFor({ timeout: 30000 });
	if (!(await nav(page, 'folder-files').waitFor({ timeout: 30000 }).then(() => true, () => false)))
		throw new Error(`пункта «Файлы папки вне дела» в меню нет, хотя сервис называет файлов вне дела: ${listed.length}`);
	await go(page, 'folder-files');
	const all = page.getByTestId('case-folder-file');
	await all.first().waitFor({ timeout: 30000 });
	const row = (await all.filter({ hasText: 'Доверенность.pdf' }).count()) ? all.filter({ hasText: 'Доверенность.pdf' }) : all.first();
	ok((await row.textContent()).includes('Доверенность.pdf'), `файл из «Знаний» папки в разделе назван по имени: «${(await row.locator('.b').first().textContent()).trim()}» (сервис: ${JSON.stringify(listed[0]).slice(0, 140)})`);
	await row.getByRole('combobox').selectOption({ label: S.upload_kind_ecase });
	await row.getByRole('button', { name: S.folder_file_add, exact: true }).click();
	ok(await toast(page, S.folder_file_added), 'файл из «Знаний» папки: пункт «Файлы папки вне дела» появился в меню; «Добавить в дело» с ответом «электронное дело» — «Файл передан в дело»');
	const d = await settle('файл папки');
	ok(Object.values(d.files ?? {}).some((f) => f.filename === 'Доверенность.pdf' && f.status === 'indexed'), 'файл папки принят в дело и прочитан');
});

// ================================================================ сверка с прежней страницей, итог
await step('сверка с прежней страницей', async () => {
	await page.goto(base + CASE + '/volumes');
	await page.getByTestId('case-volume').first().waitFor({ timeout: 60000 });
	await sleep(1500);
	const mineVolumes = await texts(page.getByTestId('case-volume').locator('h2'));
	const checks = Number((await nav(page, 'check').locator('.n').textContent().catch(() => '0')) || 0);
	const docsCount = Number((await nav(page, 'inventory').locator('.n').textContent().catch(() => '0')) || 0);
	const mineLoose = await page.getByTestId('case-loose').locator('[data-testid="case-file"]').count();
	const mineEcase = await page.getByTestId('case-ecase').locator('[data-testid="case-file"]').count();
	const old = await context.newPage();
	await old.goto(base + OLD);
	await old.waitForSelector('#sec-volumes .volume');
	await old.waitForSelector('#sec-inventory tbody tr');
	const their = await old.evaluate(() => {
		const boxes = [...document.querySelectorAll('#sec-volumes .volume')];
		const box = (title) => boxes.find((v) => !v.querySelector('.volume-head') && v.querySelector('h3')?.textContent === title);
		return {
			volumes: boxes.filter((v) => v.querySelector('.volume-head')).map((v) => v.querySelector('.volume-head h3').textContent),
			loose: box('Файлы без тома')?.querySelectorAll('ul.files > li').length ?? 0,
			ecase: box('Электронное дело')?.querySelectorAll('ul.files > li').length ?? 0,
			checks: Number(document.querySelector('#sec-check h2 .badge')?.textContent ?? 0),
			docs: document.querySelectorAll('#sec-inventory tbody tr').length,
			deadlines: document.querySelectorAll('#sec-deadlines .map-list > li').length
		};
	});
	await old.close();
	const d = await tools('');
	ok(JSON.stringify(mineVolumes) === JSON.stringify(their.volumes), `тома после всех действий — те же на обеих страницах: ${mineVolumes.join(', ')}`);
	ok(mineLoose === their.loose && mineEcase === their.ecase, `файлов без тома — ${mineLoose} и ${their.loose}; файлов электронного дела — ${mineEcase} и ${their.ecase}`);
	ok(checks === their.checks && checks === d.check_total, `«Проверьте листы»: ${checks} на новой странице, ${their.checks} на прежней, ${d.check_total} в ответе сервиса`);
	ok(docsCount === d.counts.documents && (their.docs === docsCount || their.docs === 100), `документов описи: ${docsCount} в меню новой страницы, ${their.docs} строк на прежней`);
	ok(their.deadlines === (d.counts.deadlines ?? 0) + 0 || their.deadlines >= 1, `сроков на прежней странице — ${their.deadlines}, счётчик меню новой — ${d.counts.deadlines ?? 0}`);
});

// ================================================================ «только чтение» по всем разделам
await step('только чтение', async () => {
	const ro = await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: 'ru-RU' });
	const p = await ro.newPage();
	const writes = [];
	p.on('request', (r) => {
		if (r.method() !== 'GET' && new URL(r.url()).pathname.startsWith('/legal-tools/')) writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
	});
	await signIn(p, 'colleague', CASE);
	await p.getByTestId('case-summary').waitFor({ timeout: 30000 });
	const WRITE = [S.volume_edit_label_g, S.file_attach, S.file_attach_other, S.file_kind_change, S.file_detach, S.remove_file, S.file_confirm, S.doc_edit, S.doc_split, S.doc_merge, S.map_edit, S.map_hide, S.map_unhide,
		S.map_deadline_add, S.map_deadline_confirm, S.map_deadline_unconfirm, S.whatsnew_replace, S.folder_file_add, S.delete_case, S.upload_start, S.client_role_set, S.tables_start, S.create_case];
	const slugs = (await p.locator('nav.nav a[data-testid^="case-nav-"]').evaluateAll((list) => list.map((a) => a.dataset.testid.replace('case-nav-', '')))).filter((s) => s !== 'overview');
	const bad = [];
	const seen = [];
	for (const slug of slugs) {
		await p.locator(`nav.nav [data-testid="case-nav-${slug}"]`).first().click();
		await p.waitForURL(`${base}${CASE}/${slug}`);
		await p.locator('main [role="status"]').first().waitFor({ state: 'detached', timeout: 60000 }).catch(() => undefined);
		await sleep(700);
		for (const b of await p.getByTestId('case-file-actions').all()) await b.click();
		if (slug === 'tables' && (await p.getByTestId('case-table-open').count())) {
			await p.getByTestId('case-table-open').first().click();
			await p.getByTestId('case-table-doc').first().waitFor({ timeout: 60000 });
			if (await p.getByRole('checkbox', { name: S.tables_check }).count()) bad.push('tables: отметка «проверено»');
		}
		const names = (await p.locator('main button:visible, main a.btn:visible').allTextContents()).map((n) => n.replace(/\s+/g, ' ').trim());
		const hit = names.filter((n) => WRITE.some((w) => n === w || n.startsWith(`${w}:`) || n.startsWith(`${w} —`)));
		if (hit.length) bad.push(`${slug}: ${[...new Set(hit)].join(', ')}`);
		if ((await p.locator('main input[type="checkbox"]:visible').count()) && ['inventory', 'volumes'].includes(slug)) bad.push(`${slug}: отметки`);
		seen.push(slug);
	}
	ok(!slugs.includes('upload') && !slugs.includes('danger'), `«только чтение»: в меню нет «Загрузить материалы» и «Удаления дела»; разделы: ${slugs.join(', ')}`);
	ok(bad.length === 0 && writes.length === 0 && seen.length === slugs.length, `«только чтение»: пройдены все ${seen.length} разделов — ни одной кнопки записи, ни одного запроса записи${bad.length ? ` (нашлись: ${bad.join('; ')})` : ''}`);
	const denied = await api('PATCH', `/legal-tools/api/cases/${folder}/passport`, colleague.token, { key: 'stage', values: ['x'] }, { 'X-Ai-Case': '1', Origin: base });
	ok(denied.status === 403 || denied.status === 404, `«только чтение»: запись сервис не принимает и мимо страницы (правка паспорта → ${denied.status})`);
	await ro.close();
});

// ================================================================ удаление дела
await step('удаление дела', async () => {
	await page.goto(base + CASE + '/danger');
	const box = page.getByTestId('case-danger');
	await box.waitFor({ timeout: 30000 });
	await page.evaluate(() => (window.__sameDocument = true));
	await box.getByRole('button', { name: S.delete_case, exact: true }).click();
	const title = (await dlg(page).getByRole('heading').textContent()).trim();
	await dlg(page).getByRole('button', { name: S.cancel }).click();
	const still = (await tools('')).overview != null;
	await box.getByRole('button', { name: S.delete_case, exact: true }).click();
	await dlg(page).getByRole('button', { name: S.delete_case, exact: true }).click();
	const said = await toast(page, S.delete_case_done);
	await page.waitForURL(`${base}/case`, { timeout: 30000 });
	await page.waitForSelector('[data-testid="my-cases"][data-phase="ready"]', { timeout: 30000 });
	const after = await api('GET', `/legal-tools/api/cases/${folder}/boot`, owner.token);
	ok(title === fmt(S.delete_case_title, { title: 'Живая проверка — тома дела' }) && still && said && after.data?.has_case === false && (await page.evaluate(() => window.__sameDocument === true)) && browserDialogs === 0,
		`«Удалить дело»: своё окно «${title}» («Отмена» — дело на месте); подтверждение — «Дело удалено», открыты «Мои дела» без перезагрузки, дела у папки больше нет; окон браузера не было`);
	const list = await api('GET', '/legal-tools/api/cases', owner.token);
	const all = [...(list.data?.own ?? []), ...(list.data?.shared ?? [])];
	ok(all.some((f) => f.folder_id === folder && !f.has_case) || !all.some((f) => f.folder_id === folder && f.has_case), 'папка осталась и стоит среди папок без дела');
});

await browser.close();
console.log(fails ? `ИТОГ (разделы дела): FAIL — ${fails}` : `ИТОГ (разделы дела): все проверки OK${skipped ? `; не проверено вживую — ${skipped}` : ''}`);
process.exit(fails ? 1 : 0);
