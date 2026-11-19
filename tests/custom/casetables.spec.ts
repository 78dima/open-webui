// ai-dvokat: «Таблицы и проходы» и открытая таблица на стенде компонентов (макеты K-tables, K-table-open; опись § 2.13).
import { test, expect } from '@playwright/test';
import { F, S, dialog, fixture, noSideScroll, openSection, refresh, writes } from './casekit';

const list = () => fixture('tables-list');
const scope = (usd: number) => ({ ...fixture('tables-scope'), estimate_usd: usd });
const OPEN = fixture('table-open').sweep.id;
const RO = { can_write: false, is_owner: false };

test.describe('«Таблицы и проходы», 1280', () => {
	test.use({ viewport: { width: 1280, height: 1100 } });

	test('перечень проходов: вид, состояние, охват, пометки; открытие — по адресу таблицы; «Потрачено по делу» — здесь', async ({ page }) => {
		const d = list();
		d.tables[0] = { ...d.tables[0], status: 'running', finished: false, windows_done: 12, windows_total: 29 };
		d.tables[2] = { ...d.tables[2], stale: true, status: 'partial', not_read: 41, not_read_reasons: { limit: 41 }, stop: 'limit', pages_read: 168 };
		await openSection(page, { section: 'tables', routes: { tables: d, 'tables/scope?**': scope(0.02) } });
		await expect(page.getByText(S.runs_intro)).toBeVisible();
		const rows = page.getByTestId('case-table-row');
		await expect(rows).toHaveCount(3);
		await expect(rows.nth(0).locator('.pill')).toHaveText([S.tables_kind_table, 'идёт: прочитано частей документов 12 из 29', S.tables_parent]);
		await expect(rows.nth(0).locator('.bar')).toBeVisible();
		await expect(rows.nth(0)).toContainText('Вопрос: Что это за документ как доказательство');
		await expect(rows.nth(0)).toContainText('Охват: всё дело. Прочитано страниц: 209 из 209.');
		await expect(rows.nth(1)).toContainText(S.tables_reader_stale);
		await expect(rows.nth(2).locator('.pill')).toHaveText([S.tables_kind_findings, S.tables_status_partial]);
		await expect(rows.nth(2)).toContainText('Прочитано страниц: 168 из 209. Не прочитано страниц: 41. (предел расходов прохода: 41) Проход остановлен пределом трат.');
		await expect(rows.nth(2)).toContainText(S.tables_stale);
		await expect(rows.nth(0).getByTestId('case-table-open')).toHaveAttribute('href', new RegExp(`tables/${d.tables[0].id}$`));
		// главная «Открыть» и название-ссылка — только у готового прохода на нынешнем составе дела и версии чтения
		await expect(rows.nth(0).getByTestId('case-table-open')).not.toHaveClass(/\bp\b/);
		await expect(rows.nth(1).getByTestId('case-table-open')).not.toHaveClass(/\bp\b/);
		// длинное название — не больше двух строк, целиком — в подсказке
		const name = rows.nth(2).locator('.name');
		expect(await name.evaluate((e) => Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)))).toBeLessThanOrEqual(2);
		await expect(name).toHaveAttribute('title', d.tables[2].question);
		const spent = fixture('case-overview').spent;
		await expect(page.getByTestId('case-spent')).toHaveText(`Потрачено по делу: обработка ${String(spent.processing).replace('.', ',')} USD, работа ${String(spent.work).replace('.', ',')} USD`);
	});

	test('запуск набора: наборы страницы, охват по томам, факты охвата, цена на кнопке; до 1 USD — без подтверждения', async ({ page }) => {
		let cached = false;
		const { calls } = await openSection(page, {
			section: 'tables',
			data: () => fixture('case-overview-processing'),
			routes: { tables: (r: any, c: any) => (c.method === 'POST' ? r.fulfill({ status: 201, json: { cached } }) : r.fulfill({ json: list() })), 'tables/scope?**': scope(0.0202048) }
		});
		const form = page.getByTestId('case-tables-new');
		await expect(form.getByRole('heading')).toHaveText(S.tables_new);
		await expect(form.getByRole('radio')).toHaveCount(4); // только наборы для страницы
		await expect(form.getByRole('radio', { name: 'Извещения' })).toBeChecked();
		await expect(form).toContainText('Набор рассчитан на:');
		await expect(page.getByTestId('case-tables-scope')).toHaveText('В охвате: документов — 22, страниц — 209, частей документов к чтению — 29.');
		await expect(page.getByTestId('case-tables-start')).toHaveText('Запустить — около 0,02 USD');
		await form.getByRole('radio', { name: 'Реестр доказательств' }).check();
		await form.getByRole('checkbox', { name: 'т. 5/1' }).check();
		await expect.poll(() => calls.filter((c) => c.path.startsWith('/tables/scope')).at(-1)!.path).toBe(`/tables/scope?preset=evidence&volumes=${encodeURIComponent('5/1')}`);
		await refresh(page);
		await page.waitForTimeout(300);
		await expect(form.getByRole('radio', { name: 'Реестр доказательств' })).toBeChecked(); // выбранное не сброшено обновлением
		await expect(form.getByRole('checkbox', { name: 'т. 5/1' })).toBeChecked();
		await page.getByTestId('case-tables-start').click();
		await expect(page.getByText(S.tables_started)).toBeVisible();
		await expect(dialog(page)).toHaveCount(0);
		expect(calls.find((c) => c.method === 'POST')).toMatchObject({ path: '/tables', body: { preset: 'evidence', params: null, volumes: ['5/1'] } });
		cached = true;
		await page.getByTestId('case-tables-start').click();
		await expect(page.getByText(S.tables_cached)).toBeVisible();
	});

	test('цена больше 1 USD — своё окно подтверждения с охватом и ценой; отказ сервиса — в окне', async ({ page }) => {
		let refuse = true;
		const { calls } = await openSection(page, {
			section: 'tables',
			routes: {
				tables: (r: any, c: any) => (c.method !== 'POST' ? r.fulfill({ json: list() }) : refuse ? r.fulfill({ status: 409, json: { detail: S.tables_err_paused ?? 'Проход сейчас не запустить' } }) : r.fulfill({ status: 201, json: {} })),
				'tables/scope?**': { ...scope(1.84), documents: 264, pages: 3120 }
			}
		});
		await expect(page.getByTestId('case-tables-start')).toHaveText('Запустить — около 1,84 USD');
		await page.getByTestId('case-tables-start').click();
		const dlg = dialog(page);
		await expect(dlg.getByRole('heading')).toHaveText(S.runs_confirm_title);
		await expect(dlg).toContainText('«Извещения», охват — всё дело: документов — 264, страниц — 3120.');
		await expect(dlg).toContainText('Оценка цены прохода: около 1,84 USD.');
		expect(writes(calls)).toEqual([]);
		await dlg.getByRole('button', { name: S.cancel }).click();
		expect(writes(calls)).toEqual([]);
		await page.getByTestId('case-tables-start').click();
		await dlg.getByRole('button', { name: 'Запустить — около 1,84 USD' }).click();
		await expect(dlg.getByTestId('case-dialog-error')).toContainText('Не получилось: ');
		refuse = false;
		await dlg.getByRole('button', { name: 'Запустить — около 1,84 USD' }).click();
		await expect(dlg).toHaveCount(0);
		await expect(page.getByText(S.tables_started)).toBeVisible();
	});

	test('«только чтение»: перечень есть, запуска нет; проходов нет — сказано; в охвате нет листов — цены нет', async ({ page }) => {
		const { calls } = await openSection(page, { section: 'tables', boot: RO, routes: { tables: { tables: [], presets: list().presets } } });
		await expect(page.getByTestId('case-tables-empty')).toHaveText(S.tables_empty);
		await expect(page.getByTestId('case-tables-new')).toHaveCount(0);
		expect(calls.some((c) => c.path.startsWith('/tables/scope'))).toBe(false);
		expect(writes(calls)).toEqual([]);
	});
});

test.describe('открытая таблица, 1280', () => {
	test.use({ viewport: { width: 1280, height: 1100 } });

	test('ячейки: ответ, лист с местом, цитата под «Цитата», счёт столбца; листы, прочитанные не полностью, — перечнем', async ({ page }) => {
		const { calls } = await openSection(page, { section: 'tables', item: OPEN, routes: { 'tables/*?**': fixture('table-open') } });
		const head = page.getByTestId('case-table-head');
		await expect(head.getByRole('heading', { level: 1 })).toHaveText('Реестр доказательств');
		await expect(head.locator('.pill')).toHaveText([S.tables_status_done, S.tables_parent]);
		await expect(head.getByRole('link', { name: S.runs_back })).toHaveAttribute('href', /s=tables$/);
		await expect(head.getByTestId('case-goto')).toBeVisible(); // «Открыть лист» — и в шапке открытой таблицы
		expect(calls.some((c) => c.path === `/tables/${OPEN}?page=0`)).toBe(true);
		const facts = page.getByTestId('case-table-facts');
		await expect(facts).toContainText('Охват: всё дело. Прочитано страниц: 209 из 209.');
		await expect(facts).toContainText('Из них прочитаны не полностью: 18');
		await expect(facts.getByRole('link')).toHaveCount(8);
		const table = page.getByTestId('case-table');
		await expect(table.locator('.hc')).toHaveCount(5);
		await expect(table.locator('.hc').nth(1)).toContainText('ответ есть: 22');
		await expect(page.getByTestId('case-table-doc')).toHaveCount(4);
		await expect(page.getByTestId('case-table-doc').first().getByRole('link').first()).toHaveAttribute('href', `/legal-tools/case/${F}/p/629`);
		await expect(page.getByTestId('case-table-doc').first().locator('.fn')).toHaveText('tom-2-chast-1.pdf'); // листы документа — ссылкой, имя файла мелко
		const cell = page.getByTestId('case-table-cell').first();
		await expect(cell.getByRole('link').first()).toHaveAttribute('href', /\/p\/\d+\?v=\d+&hl=\d+-\d+$/);
		await expect(cell.locator('.q')).toHaveCount(0);
		await cell.getByRole('button', { name: S.quote_toggle }).click();
		await expect(cell.locator('.q')).toContainText('Суд определил назначить');
		await expect(page.getByTestId('case-table-cell').nth(2)).toContainText(S.tables_state_not_here);
		await expect(page.getByTestId('case-table-cell').nth(3)).toContainText(S.tables_copies_none);
		// открытая таблица при переспрашивании обзора не перечитывается и не перерисовывается
		const before = calls.filter((c) => c.path.startsWith('/tables/')).length;
		await refresh(page);
		await page.waitForTimeout(400);
		expect(calls.filter((c) => c.path.startsWith('/tables/')).length).toBe(before);
		await expect(cell.locator('.q')).toBeVisible();
	});

	test('отметка «проверено» и примечание: ячейка обновляется ответом сервиса; отказ — отметка возвращается', async ({ page }) => {
		let refuse = false;
		const { calls } = await openSection(page, {
			section: 'tables',
			item: OPEN,
			routes: {
				'tables/*?**': fixture('table-open'),
				'tables/*/checks': (r: any, c: any) =>
					refuse
						? r.fulfill({ status: 409, json: { detail: S.tables_err_running ?? 'Проход ещё идёт' } })
						: r.fulfill({ json: { check: c.body.checked ? { stands: true, by_name: 'Лебедева А. В.', at: '2026-11-14T10:00:00Z', note: c.body.note } : null } })
			}
		});
		const cell = page.getByTestId('case-table-cell').first();
		const box = cell.getByRole('checkbox', { name: S.tables_check });
		await box.check();
		await expect(cell).toContainText('Лебедева А. В., 14.11.2026');
		expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ path: `/tables/${OPEN}/checks`, body: { document_id: 68, column_key: 'what', checked: true, note: null } });
		await cell.getByRole('button', { name: S.tables_note_edit }).click();
		const dlg = dialog(page);
		await expect(dlg.getByRole('heading')).toHaveText(S.tables_check_note);
		await dlg.getByRole('textbox').fill('сверено с оригиналом');
		await dlg.getByRole('button', { name: S.save }).click();
		await expect(dlg).toHaveCount(0);
		await expect(cell).toContainText('Лебедева А. В., 14.11.2026 — сверено с оригиналом');
		expect(calls.filter((c) => c.method === 'PUT').at(-1)!.body).toMatchObject({ checked: true, note: 'сверено с оригиналом' });
		refuse = true;
		await box.uncheck();
		await expect(page.getByText(/Не получилось: /)).toBeVisible();
		await expect(box).toBeChecked();
		// «копий не найдено» отметить можно, пустую ячейку кода без права — нет
		await expect(page.getByTestId('case-table-cell').nth(3).getByRole('checkbox')).toHaveCount(1);
	});

	test('«Перечитать таблицу» и «Дочитать»: цена на кнопке; до 1 USD — сразу, больше — окно; после запуска — к перечню', async ({ page }) => {
		const stale = fixture('table-reader-stale');
		let view: any = stale;
		const { calls } = await openSection(page, {
			section: 'tables',
			item: stale.sweep.id,
			routes: { 'tables/*?**': (r: any) => r.fulfill({ json: view }), 'tables/*/catch-up**': (r: any) => r.fulfill({ status: 201, json: {} }), tables: list(), 'tables/scope?**': scope(0.02) }
		});
		const action = page.getByTestId('case-table-action');
		await expect(action).toHaveText(['Перечитать таблицу — около 0,02 USD']);
		await expect(page.getByTestId('case-table-facts')).toContainText('Перечитать: частей 29, страниц 209, оценка 0,02.');
		await action.click();
		await expect(page.getByText(S.tables_started)).toBeVisible();
		await expect(page.getByTestId('case-tables')).toBeVisible(); // вернулись к перечню
		expect(calls.filter((c) => c.method === 'POST').at(-1)!.path).toBe(`/tables/${stale.sweep.id}/catch-up`);
		// остановлен пределом трат: дочитать с новым пределом — через окно (цена больше 1 USD)
		view = { ...fixture('table-open'), sweep: { ...fixture('table-open').sweep, status: 'partial', stop: 'limit', rest: { windows: 7, pages: 41, estimate_usd: 1.2, raise_to_usd: 3, spent_usd: 1.5, limit_usd: 1.5 } } };
		await page.getByTestId('case-table-open').first().click();
		await expect(action).toHaveText(['Дочитать с новым пределом — около 1,20 USD']);
		await expect(page.getByTestId('case-table-facts').getByTestId('case-table-action')).toHaveCount(1); // кнопка — у своего пояснения
		await expect(page.getByTestId('case-table-facts')).toContainText('Потрачено 1,50 USD из предела прохода 1,50 USD.');
		await action.click();
		const dlg = dialog(page);
		await expect(dlg).toContainText('Оценка цены прохода: около 1,20 USD.');
		await dlg.getByRole('button', { name: 'Дочитать с новым пределом — около 1,20 USD' }).click();
		await expect(dlg).toHaveCount(0);
		expect(calls.filter((c) => c.method === 'POST').at(-1)!.path).toBe(`/tables/${OPEN}/catch-up?raise_limit=true`);
	});

	test('находки: место с цитатой целиком, листы, на которые ссылается место; «В Excel»; порции; «только чтение»', async ({ page }) => {
		const f = fixture('table-findings');
		f.findings[0] = { ...f.findings[0], also: [{ page_id: 700, label: 'т. 4, л.д. 70' }], refs: [{ state: 'partial', raw: 'л.д. 12–14', missing: [13], sheets: [{ page_id: 641, label: 'т. 4, л.д. 12', how: 'duplicate' }] }], refs_unparsed: 2 };
		const { calls } = await openSection(page, {
			section: 'tables',
			item: f.sweep.id,
			boot: RO,
			routes: {
				'tables/*?**': (r: any, c: any) => r.fulfill({ json: c.path.includes('page=1') ? { ...f, findings: [{ ...f.findings[1], quote: 'следующая порция' }], end: true, next_page: null } : { ...f, end: false, next_page: 1 } }),
				'tables/*/export.xlsx': (r: any) => r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('Таблица — проход.xlsx')}` }, body: 'PK' })
			}
		});
		const rows = page.getByTestId('case-finding');
		await expect(rows).toHaveCount(4);
		await expect(page.getByTestId('case-findings')).toContainText('Мест найдено: 31');
		await expect(rows.first().locator('.q')).toHaveText('Претензия направлена ответчику');
		await expect(rows.first()).toContainText(S.tables_also_copies);
		await expect(rows.first()).toContainText('л.д. 12–14 — найдена часть диапазона: т. 4, л.д. 12 (номер стоит на нескольких листах); листа с номером 13 не найдено');
		await expect(rows.first()).toContainText('в месте есть ссылки на листы, которые не удалось разобрать: 2');
		await page.getByTestId('case-table-more').click();
		await expect(rows).toHaveCount(5);
		await expect(page.getByTestId('case-table-more')).toHaveCount(0);
		const download = page.waitForEvent('download');
		await page.getByRole('button', { name: S.tables_export }).click();
		expect((await download).suggestedFilename()).toBe('Таблица — проход.xlsx');
		await expect(page.getByTestId('case-table-action')).toHaveCount(0); // «только чтение»: перечитать нельзя
		expect(writes(calls)).toEqual([]);
	});

	test('«только чтение» в таблице: отметок «проверено» нет; таблица не открылась — ошибка и «Повторить»', async ({ page }) => {
		let fail = true;
		await openSection(page, { section: 'tables', item: OPEN, boot: RO, routes: { 'tables/*?**': (r: any) => (fail ? r.fulfill({ status: 404, json: { detail: 'такого прохода нет' } }) : r.fulfill({ json: fixture('table-open') })) } });
		await expect(page.getByTestId('case-table-error')).toContainText('Не получилось: такого прохода нет');
		fail = false;
		await page.getByTestId('case-table-error').getByRole('button', { name: S.retry }).click();
		await expect(page.getByTestId('case-table-doc')).toHaveCount(4);
		await expect(page.getByRole('checkbox', { name: S.tables_check })).toHaveCount(0);
	});
});

test('«Таблицы и проходы» и открытая таблица на телефоне 360: строки карточками, без прокрутки вбок', async ({ page }) => {
	await page.setViewportSize({ width: 360, height: 800 });
	await openSection(page, { section: 'tables', dark: true, routes: { tables: list(), 'tables/scope?**': scope(0.02), 'tables/*?**': fixture('table-open') } });
	await expect(page.getByTestId('case-table-row')).toHaveCount(3);
	await noSideScroll(page);
	await page.getByTestId('case-table-open').first().click();
	await expect(page.getByTestId('case-table-doc')).toHaveCount(4);
	await noSideScroll(page);
	const label = await page.getByTestId('case-table-cell').first().evaluate((e) => getComputedStyle(e, '::before').content);
	expect(label).toContain('Что это и что подтверждает');
	await expect(page.getByTestId('case-table').locator('.hc').first()).toBeHidden();
});
