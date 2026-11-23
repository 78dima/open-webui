// ai-dvokat: признаки хода процесса на страницах «Дел» (пакет 23.11) — стенд компонентов. Признак — факт сервиса
// (поле `work` обзора, статус прохода, идущий запрос кнопки): когда работы нет — признаков нет; прежний сервис
// (без поля `work` и без новых строк) — страницы прежние.
import { test, expect, type Route } from '@playwright/test';
import { API, S, fixture, openSection } from './casekit';

const work = (groups: Record<string, number>, sweeps = 0, extra: Record<string, unknown> = {}) => ({
	busy: Object.keys(groups).length > 0 || sweeps > 0,
	groups,
	running: {},
	sweeps,
	stalled: false,
	...extra
});
const overview = (w: unknown, extra: Record<string, unknown> = {}) => ({ ...fixture('case-overview'), work: w, ...extra });
const note = (page: any) => page.getByTestId('case-work-note');
const noteText = (page: any) => note(page).locator('p');
/** Ответ ручки с задержкой: пока он в пути, видно состояние «занято». */
const slow = (ms: number, json: unknown) => async (r: Route) => {
	await new Promise((ok) => setTimeout(ok, ms));
	return r.fulfill({ json });
};

test.describe('работа по делу идёт', () => {
	test.use({ viewport: { width: 1280, height: 1100 } });

	test('обзор: пока карточки и паспорт в очереди — «Идёт обработка» и что именно идёт; работы нет — «Готово к работе»', async ({ page }) => {
		let w: unknown = work({ cards: 3, passport: 1 });
		await openSection(page, { data: () => overview(w), routes: { work: (r: Route) => r.fulfill({ json: { work: w, paused: null } }) } });
		const sum = page.getByTestId('case-summary');
		await expect(sum).toHaveAttribute('data-state', 'processing');
		await expect(sum).toContainText(S.overview_state_processing);
		await expect(sum).not.toContainText(S.overview_state_ready);
		await expect(page.getByTestId('case-work-line')).toHaveText(
			S.overview_work_line.replace('{parts}', `${S.work_part_cards.replace('{n}', '3')}, ${S.work_part_passport}`)
		);
		// признак у пунктов меню — только у разделов, чьи данные зависят от этой работы (Н-3: разбор документов пишет
		// в строки описи название, дату и автора — у «Описи» и «Копий» тоже)
		for (const slug of ['passport', 'amounts', 'chronology', 'deadlines', 'inventory', 'copies'])
			await expect(page.getByTestId(`case-nav-${slug}`).getByTestId('case-nav-work')).toHaveCount(1);
		for (const slug of ['tables', 'volumes', 'check'])
			await expect(page.getByTestId(`case-nav-${slug}`).getByTestId('case-nav-work')).toHaveCount(0);
		// работа закончилась: страница сама (опрос 5 с) приходит к «Готово к работе», признаков не остаётся
		w = work({});
		await expect(sum).toHaveAttribute('data-state', 'ready', { timeout: 9000 });
		await expect(page.getByTestId('case-work-line')).toHaveCount(0);
		await expect(page.getByTestId('case-nav-work')).toHaveCount(0);
	});

	test('раздел: строка хода вверху, счёт тикает лёгкой ручкой, по окончании раздел перечитывается сам', async ({ page }) => {
		let w: any = work({ cards: 2 });
		const facts = fixture('facts');
		let asked = 0;
		const { calls, overviewCalls } = await openSection(page, {
			section: 'chronology',
			data: () => overview(w),
			routes: {
				work: (r: Route) => r.fulfill({ json: { work: w, paused: null } }),
				'facts?**': (r: Route) => {
					asked += 1;
					return r.fulfill({ json: facts });
				}
			}
		});
		await expect(noteText(page)).toHaveText(new RegExp('^Разбираются документы — 2\\. '));
		await expect(note(page)).toHaveAttribute('data-work', 'runs');
		await expect(page.getByTestId('case-nav-chronology').getByTestId('case-nav-work')).toHaveCount(1);
		const before = asked;
		const full = overviewCalls();
		w = work({ cards: 1 });
		await expect(noteText(page)).toHaveText(new RegExp('^Разбираются документы — 1\\. '), { timeout: 9000 });
		expect(overviewCalls()).toBe(full); // счёт пришёл лёгкой ручкой, обзор целиком не собирался
		expect(calls.some((c) => c.path === '/work')).toBe(true);
		// карточки кончились (идёт паспорт — хронологии он не касается): строки нет, раздел перечитан сразу
		w = work({ passport: 1 });
		await expect(note(page)).toHaveCount(0, { timeout: 9000 });
		await expect.poll(() => asked).toBeGreaterThan(before);
		await expect(page.getByTestId('case-nav-chronology').getByTestId('case-nav-work')).toHaveCount(0);
		await expect(page.getByTestId('case-nav-passport').getByTestId('case-nav-work')).toHaveCount(1);
	});

	test('обработка на паузе или обработчик молчит — «ждут», а не «идёт»; работы нет — строки нет', async ({ page }) => {
		let d: unknown = overview(work({ cards: 4 }), { paused: { reason: 'budget', since: '2026-11-23T10:00:00+00:00', until: null } });
		await openSection(page, { section: 'passport', data: () => d });
		await expect(note(page)).toHaveAttribute('data-work', 'waits');
		await expect(note(page)).toContainText(S.work_note_paused.split('{parts}')[0].trim());
		d = overview(work({ cards: 4 }, 0, { stalled: true }));
		await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
		await expect(note(page)).toContainText(S.work_note_stalled.split('{parts}')[0].trim());
		await expect(note(page)).toHaveAttribute('data-work', 'waits');
		d = overview(work({}));
		await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
		await expect(note(page)).toHaveCount(0);
	});

	test('строк хода у страницы нет (прежний файл строк): строки хода и признака меню нет, «Обновить» прежняя', async ({ page }) => {
		const old = Object.fromEntries(Object.entries(S).filter(([k]) => !/^(work_|busy_|refreshed|overview_work_line|replace_reading|my_cases_busy)/.test(k)));
		// сервис отдаёт поле work, а строк у страницы нет (прежний файл строк) — страница о работе молчит
		await openSection(page, { section: 'chronology', strings: old, data: () => overview(work({ cards: 2 })), routes: { 'facts?**': fixture('facts') } });
		await expect(page.getByTestId('case-fact').first()).toBeVisible();
		await expect(note(page)).toHaveCount(0);
		await expect(page.getByTestId('case-nav-work')).toHaveCount(0);
		// «Обновить» при прежнем сервисе — прежняя кнопка
		await expect(page.getByTestId('case-map-refresh')).toHaveText(S.map_refresh);
	});

	test('новый сервис, строк ещё нет в снимке страницы (нет слов группы) — строка молчит, а не показывает пустоту', async ({ page }) => {
		const partial = Object.fromEntries(Object.entries(S).filter(([k]) => !k.startsWith('work_part_')));
		await openSection(page, { section: 'chronology', strings: partial, data: () => overview(work({ cards: 2 })), routes: { 'facts?**': fixture('facts') } });
		await expect(page.getByTestId('case-fact').first()).toBeVisible();
		await expect(note(page)).toHaveCount(0);
	});
});

test.describe('перечитывание раздела не сбрасывает место юриста', () => {
	test.use({ viewport: { width: 1280, height: 1100 } });

	test('хронология: догруженные «Показать ещё» порции остаются, пока ответ не изменился; изменился — лента с начала', async ({ page }) => {
		const facts = fixture('facts');
		const mk = (from: number, n: number) => facts.facts.filter((x: any) => !x.group).slice(0, 1).flatMap((f: any) => Array.from({ length: n }, (_, i) => ({ ...f, id: 9000 + from + i, summary: `Запись ${from + i}` })));
		let total = 6;
		let w: any = work({ cards: 2 });
		let asked = 0;
		await openSection(page, {
			section: 'chronology',
			data: () => overview(w),
			routes: {
				work: (r: Route) => r.fulfill({ json: { work: w, paused: null } }),
				'facts?**': (r: Route, c: any) => {
					const p = Number(new URL('http://x' + c.path).searchParams.get('page') ?? 0);
					if (!p) asked += 1;
					return r.fulfill({ json: { ...facts, facts: mk(p * 2, 2), total, total_records: total, next_page: p < 2 ? p + 1 : null } });
				}
			}
		});
		const rows = page.getByTestId('case-fact');
		await expect(rows).toHaveCount(2);
		await page.getByTestId('case-facts-more').click();
		await expect(rows).toHaveCount(4);
		await page.getByTestId('case-facts-more').click();
		await expect(rows).toHaveCount(6); // дочитано до третьей порции
		const first = asked;
		// работа по делу идёт и кончается: раздел перечитывается (счёт тикает, затем конец работы), ответ тот же
		w = work({ cards: 1 });
		await page.waitForTimeout(5500);
		w = work({});
		await expect(page.getByTestId('case-work-note')).toHaveCount(0, { timeout: 9000 });
		await expect.poll(() => asked).toBeGreaterThan(first); // перечитывание было
		await expect(rows).toHaveCount(6); // а место юриста — на месте
		await expect(rows.nth(5)).toContainText('Запись 5');
		// записи изменились (общий счёт другой) — лента честно с начала
		total = 7;
		await page.getByTestId('case-map-refresh').click();
		await expect(rows).toHaveCount(2);
	});
});

test.describe('таблицы и проходы обновляются сами', () => {
	test.use({ viewport: { width: 1280, height: 1100 } });

	test('перечень: ход идущего прохода и «готово» приходят без нажатий', async ({ page }) => {
		const d = fixture('tables-list');
		d.tables[0] = { ...d.tables[0], status: 'running', finished: false, windows_done: 3, windows_total: 29 };
		let w: unknown = work({}, 1);
		await openSection(page, {
			section: 'tables',
			data: () => overview(w),
			routes: { tables: (r: Route) => r.fulfill({ json: d }), 'tables/scope?**': fixture('tables-scope'), work: (r: Route) => r.fulfill({ json: { work: w, paused: null } }) }
		});
		const row = page.getByTestId('case-table-row').nth(0);
		await expect(row).toContainText('3 из 29');
		await expect(noteText(page)).toHaveText(/^Идут проходы — 1\. /);
		d.tables[0].windows_done = 17;
		await expect(row).toContainText('17 из 29', { timeout: 9000 });
		d.tables[0] = { ...d.tables[0], status: 'done', finished: true, windows_done: 29 };
		w = work({});
		await expect(row.locator('.bar')).toHaveCount(0, { timeout: 9000 });
		await expect(note(page)).toHaveCount(0, { timeout: 9000 });
	});

	test('открытая таблица идущего прохода перечитывает себя до конца прохода и потом перестаёт', async ({ page }) => {
		const t = fixture('table-open');
		const id = t.sweep.id;
		let asked = 0;
		Object.assign(t.sweep, { status: 'running', finished: false, windows_done: 5 });
		await openSection(page, {
			section: 'tables',
			item: id,
			routes: {
				[`tables/${id}?**`]: (r: Route) => {
					asked += 1;
					return r.fulfill({ json: t });
				}
			}
		});
		const head = page.getByTestId('case-table-head');
		await expect(head).toContainText('5 из 29');
		Object.assign(t.sweep, { windows_done: 21 });
		await expect(head).toContainText('21 из 29', { timeout: 9000 });
		Object.assign(t.sweep, { status: 'done', finished: true, windows_done: 29 });
		await expect(head).not.toContainText('из 29', { timeout: 9000 });
		const settled = asked;
		await page.waitForTimeout(6000);
		expect(asked).toBe(settled); // проход закончен — таблица больше не спрашивает
	});
});

test.describe('кнопка занята', () => {
	test.use({ viewport: { width: 1280, height: 1100 } });

	test('«Обновить»: занята, пока идёт запрос; ответ без изменений — «Обновлено»', async ({ page }) => {
		const facts = fixture('facts');
		let delay = 0;
		await openSection(page, {
			section: 'chronology',
			routes: { 'facts?**': async (r: Route) => { await new Promise((ok) => setTimeout(ok, delay)); return r.fulfill({ json: facts }); } }
		});
		const btn = page.getByTestId('case-map-refresh');
		await expect(btn).toHaveText(S.map_refresh);
		delay = 1200;
		await btn.click();
		await expect(btn).toBeDisabled();
		await expect(btn).toHaveText(S.busy_refresh);
		await expect(btn).toBeEnabled({ timeout: 5000 });
		await expect(btn).toHaveText(S.map_refresh);
		await expect(page.getByText(S.refreshed, { exact: true })).toBeVisible();
	});

	test('раскрытая группа хронологии до первой порции — «Загрузка…», а не пустое место', async ({ page }) => {
		const facts = fixture('facts');
		const g = { group: true, document_id: 77, document: 'Выписка по счёту', n: 6, date_from: '2024-01-01', date_to: '2024-02-01' };
		const list = { ...facts, facts: [g, ...facts.facts] };
		await openSection(page, {
			section: 'chronology',
			routes: {
				'facts?**': async (r: Route, c: any) => {
					if (!c.path.includes('table_group')) return r.fulfill({ json: list });
					await new Promise((ok) => setTimeout(ok, 1200));
					return r.fulfill({ json: { ...facts, facts: facts.facts.slice(0, 2), next_page: null } });
				}
			}
		});
		await page.getByTestId('case-fact-group-open').click();
		await expect(page.getByTestId('case-fact-group-loading')).toHaveText(S.loading);
		await expect(page.getByTestId('case-fact-group-loading')).toHaveCount(0, { timeout: 5000 });
		await expect(page.getByTestId('case-fact-group-rows').getByTestId('case-fact')).toHaveCount(2);
	});

	test('выгрузка описи и главная кнопка окна: значок часов и подпись, пока действие идёт', async ({ page }) => {
		await openSection(page, {
			section: 'inventory',
			routes: {
				'documents?**': fixture('case-documents'),
				'export/inventory.docx**': async (r: Route) => {
					await new Promise((ok) => setTimeout(ok, 1200));
					return r.fulfill({ status: 200, body: 'x', headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="inventory.docx"' } });
				}
			}
		});
		const docx = page.getByTestId('case-inventory-docx');
		await docx.click();
		await expect(docx).toBeDisabled();
		await expect(docx).toHaveText(S.busy_file);
		await expect(docx.locator('svg')).toHaveCount(1);
		await expect(docx).toHaveText(S.export_docx, { timeout: 5000 });
		await expect(page.getByTestId('case-inventory-xlsx')).toHaveText(S.export_xlsx);
	});
});

test.describe('«Замена тома» и «Мои дела»', () => {
	test.use({ viewport: { width: 1280, height: 1100 } });

	test('пока второй файл тома обрабатывается — так и сказано, «Повторно загруженных томов нет» не пишется', async ({ page }) => {
		const base = fixture('case-overview');
		const v = base.overview.volumes[0];
		const two = { ...v, status: 'reading', files: [...(v.files ?? []), { id: 9001, filename: 'Том (пересъёмка).pdf', status: 'reading', pages: 8, pages_indexed: 2 }] };
		let d: any = { ...base, overview: { ...base.overview, volumes: [two, ...base.overview.volumes.slice(1)] }, work: work({ read: 12 }) };
		// том с новым файлом в чтении — факт сервиса `pending_volumes` ответа …/deltas (Р-4, Н-11), а не догадка страницы
		let pending: any[] = [{ volume_id: v.id, label: v.label }];
		const deltas = (r: Route) => r.fulfill({ json: { ...fixture('deltas-empty'), pending_volumes: pending, pending_unassigned: 0 } });
		await openSection(page, { section: 'replace', data: () => d, routes: { deltas, work: (r: Route) => r.fulfill({ json: { work: d.work, paused: null } }) } });
		await expect(page.getByTestId('case-replace-reading')).toBeVisible();
		await expect(page.getByTestId('case-replace-empty')).toHaveCount(0);
		// файл прочитан, сверка посчитана и записи нет (это было продолжение тома) — обычное «томов нет»
		d = { ...base, overview: { ...base.overview, volumes: [{ ...two, status: 'inventory_ready' }, ...base.overview.volumes.slice(1)] }, work: work({}) };
		pending = [];
		await expect(page.getByTestId('case-replace-reading')).toHaveCount(0, { timeout: 9000 });
		await expect(page.getByTestId('case-replace-empty')).toHaveText(S.whatsnew_empty);
	});
});
