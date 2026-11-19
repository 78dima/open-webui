// ai-dvokat: карта дела на стенде компонентов — «Паспорт», «Суммы», «Хронология», «Сроки»
// (макеты K-passport, K-amounts, K-chronology, K-deadlines, K-dialogs; опись § 2.8–2.10).
import { test, expect, type Page } from '@playwright/test';
import { F, S, dialog, fixture, noSideScroll, openSection, refresh, writes } from './casekit';

const ok = (r: any) => r.fulfill({ json: { ok: true } });
const RO = { can_write: false, is_owner: false };
const readonly = (name: string) => ({ ...fixture(name), can_write: false });
/** Время страницы вперёд: раздел карты дела перечитывается не чаще раза в 20 с. */
async function clock(page: Page) {
	await page.evaluate(() => {
		const now = Date.now.bind(Date);
		(window as any).__ahead = 0;
		Date.now = () => now() + (window as any).__ahead;
	});
	return (ms: number) => page.evaluate((x) => ((window as any).__ahead += x), ms);
}
const count = (calls: { path: string; method: string }[], path: string) => calls.filter((c) => c.method === 'GET' && c.path.startsWith(path)).length;

test.describe('«Паспорт», 1280', () => {
	test.use({ viewport: { width: 1280, height: 1100 } });

	test('блоки и записи: значение, «в документах», лист, пометки, цитата под «Цитата», «ещё на листах»; состояние карты', async ({ page }) => {
		await openSection(page, { section: 'passport' });
		await expect(page.getByTestId('case-passport-note')).toContainText(S.map_passport_pointer);
		await expect(page.getByTestId('case-passport-note')).toContainText('Построен по карточкам 22 из 22 документов.');
		await expect(page.getByTestId('case-passport-note')).not.toContainText('gpt'); // названия модели нет (решение владельца)
		await expect(page.locator('.head h1')).toHaveText(S.section_passport);
		await expect(page.locator('.head').getByTestId('case-map-refresh')).toBeVisible(); // «Обновить» — в шапке раздела
		const about = page.getByTestId('case-passport-about');
		await expect(about.getByRole('heading', { level: 2 })).toHaveText(S.passport_group_case);
		const number = about.locator('[data-field="case_number"]');
		await expect(number.locator('dt .b')).toHaveText(S.map_pfc_case_number);
		const item = number.getByTestId('case-passport-item').first();
		await expect(item).toContainText('А42-668824/3518');
		await expect(item).toContainText('в документах: 13');
		await expect(item.getByRole('link').first()).toHaveAttribute('href', new RegExp(`/legal-tools/case/${F}/p/631`));
		await expect(item.locator('.pill')).toHaveText('от руки — 2 из 13 записей');
		await expect(item.locator('.q')).toHaveCount(0);
		await item.getByRole('button', { name: S.quote_toggle }).click();
		await expect(item.locator('.q')).toContainText('Свидетель Лебедева А. В. пояснила');
		await refresh(page);
		await page.waitForTimeout(300);
		await expect(item.locator('.q')).toBeVisible(); // раскрытая цитата переживает обновление обзора
		await expect(item).toContainText(S.map_passport_also);
		// роль клиента задаёт юрист; пустое поле — «не заполнено»
		const role = about.locator('[data-field="client_role"]');
		await expect(role).toContainText(S.map_passport_client_hint);
		// «Править» у пустой роли нет (его заменяет «Указать роль»), «История» есть — иначе очистку не откатить
		await expect(role.getByRole('button')).toHaveText([S.map_history, S.client_role_set]);
		await expect(about.locator('[data-field="instance"]')).toContainText(S.map_field_empty);
		await expect(page.locator('[data-field="key_amounts"]').getByRole('link', { name: S.passport_all_amounts })).toHaveAttribute('href', /amounts$/);
		await expect(page.getByTestId('case-map-state')).toHaveText(['Документов без записей хронологии: 1 из 22. Записи извлечены моделью при загрузке — полнота не гарантирована.']);
	});

	test('участники: первые четыре и «Показать ещё», роли — «ещё N», поиск по написанию', async ({ page }) => {
		const p = fixture('passport');
		const parties = p.fields.find((f: any) => f.key === 'parties');
		parties.items.push({ ...parties.items[0], value: 'Тихонов А. И.', roles: [] }, { ...parties.items[1], value: 'ООО «Вектор»' });
		await openSection(page, { section: 'passport' });
		await page.unroute(`**/legal-tools/api/cases/${F}/passport`);
		await page.route(`**/legal-tools/api/cases/${F}/passport`, (r) => r.fulfill({ json: p }));
		await page.getByTestId('case-map-refresh').click();
		const box = page.getByTestId('case-passport-parties');
		await expect(box.locator('.cnt')).toHaveText('6');
		await expect(box).toContainText(S.map_passport_parties_hint);
		const rows = box.getByTestId('case-party');
		await expect(rows).toHaveCount(4);
		await expect(box).toContainText('показано 4 из 6');
		const first = rows.first();
		// свёрнуто — первая роль и «ещё N» в одну строку; раскрыто — все роли перечнем
		await expect(first.getByTestId('case-party-roles').locator('> span.aw')).toHaveCount(1);
		await first.getByRole('button', { name: 'ещё 3' }).click();
		await expect(first.getByTestId('case-party-roles').locator('> span.aw')).toHaveCount(4);
		await box.getByRole('searchbox', { name: S.parties_search_label }).fill('вектор');
		await expect(rows).toHaveCount(1);
		await expect(rows.first()).toContainText('ООО «Вектор»');
		await box.getByRole('searchbox').fill('нет такого');
		await expect(box).toContainText(S.parties_none_found);
		await box.getByRole('searchbox').fill('');
		await box.getByRole('button', { name: 'Показать ещё 2' }).click();
		await expect(rows).toHaveCount(6);
	});

	test('«Править» поле: значения с новой строки; «История» — слова по значениям записи; откат перечитывает паспорт', async ({ page }) => {
		const EDITS = {
			edits: [
				{ id: 7, entity: 'passport', entity_id: 'stage', field: 'value', field_text: '', before_text: '', after_text: '', who: 'вы', at: '2025-12-07T09:41:00Z', before: [{ value: 'первая инстанция' }], after: [{ value: 'апелляция' }, { value: 'кассация' }], can_revert: true },
				{ id: 6, entity: 'passport', entity_id: 'stage', field: 'value', who: 'модель', at: '2025-12-01T10:00:00Z', before: [], after: [{ value: 'первая инстанция' }] }
			]
		};
		const { calls } = await openSection(page, { section: 'passport', routes: { 'edits?**': EDITS, 'edits/*/revert': ok } });
		await page.route(`**/legal-tools/api/cases/${F}/passport`, (r) => (r.request().method() === 'PATCH' ? r.fulfill({ json: { ok: true } }) : r.fallback()));
		const stage = page.locator('[data-field="stage"]');
		await stage.getByRole('button', { name: S.map_edit }).click();
		const dlg = dialog(page);
		await expect(dlg.getByRole('heading')).toHaveText(`Поле паспорта: ${S.map_pf_stage}`);
		await expect(dlg).toContainText(S.map_passport_edit_hint);
		await dlg.getByRole('textbox').fill('апелляция\n\n  кассация  \n');
		await dlg.getByRole('button', { name: S.save }).click();
		await expect(dlg).toHaveCount(0);
		expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ path: '/passport', body: { key: 'stage', values: ['апелляция', 'кассация'] } });
		await stage.getByRole('button', { name: S.map_history }).click();
		expect(calls.some((c) => c.path === '/edits?entity=passport&id=stage')).toBe(true);
		const rows = dlg.getByTestId('case-history-row');
		await expect(rows.nth(0)).toContainText(S.map_pf_stage);
		await expect(rows.nth(0)).toContainText('было «первая инстанция», стало «апелляция; кассация»');
		await expect(rows.nth(1)).toContainText('было «пусто», стало «первая инстанция»');
		const before = count(calls, '/passport');
		await dlg.getByRole('button', { name: S.revert }).click();
		await expect(page.getByText(S.revert_done)).toBeVisible();
		await expect.poll(() => count(calls, '/passport')).toBe(before + 1);
		expect(writes(calls)).toEqual(['PATCH /passport', 'POST /edits/7/revert']);
	});

	test('перечитывание: вместе с обзором, но не чаще раза в 20 с и не пока открыто окно; «Обновить» — сразу', async ({ page }) => {
		const { calls } = await openSection(page, { section: 'passport', routes: { 'edits?**': { edits: [] } } });
		await expect(page.getByTestId('case-passport-about')).toBeVisible();
		const ahead = await clock(page);
		const n0 = count(calls, '/passport');
		await refresh(page);
		await page.waitForTimeout(300);
		expect(count(calls, '/passport')).toBe(n0); // 20 с не прошло
		await ahead(21000);
		await refresh(page);
		await expect.poll(() => count(calls, '/passport')).toBe(n0 + 1);
		await page.locator('[data-field="stage"]').getByRole('button', { name: S.map_history }).click();
		await ahead(21000);
		await refresh(page);
		await page.waitForTimeout(300);
		expect(count(calls, '/passport')).toBe(n0 + 1); // окно открыто — раздел не трогается
		await dialog(page).getByRole('button', { name: S.close }).click();
		await page.getByTestId('case-map-refresh').click();
		await expect.poll(() => count(calls, '/passport')).toBe(n0 + 2);
	});

	test('«только чтение»: «Править» и «Указать роль» нет, «История» есть; паспорт не построен — сказано', async ({ page }) => {
		const { calls } = await openSection(page, { section: 'passport', boot: RO });
		await page.unroute(`**/legal-tools/api/cases/${F}/passport`);
		let built = true;
		await page.route(`**/legal-tools/api/cases/${F}/passport`, (r) =>
			r.fulfill({ json: built ? readonly('passport') : { fields: [], built: null, state: { documents: 22, cards: 3, no_facts: 0, pending: 19, partial: 0, failed: 0 }, can_write: false } })
		);
		await page.getByTestId('case-map-refresh').click();
		await expect(page.getByRole('button', { name: S.map_edit })).toHaveCount(0);
		await expect(page.getByRole('button', { name: S.client_role_set })).toHaveCount(0);
		expect(await page.getByRole('button', { name: S.map_history }).count()).toBeGreaterThan(3);
		built = false;
		await page.getByTestId('case-map-refresh').click();
		await expect(page.getByTestId('case-passport-note')).toContainText(S.map_passport_building);
		await expect(page.getByTestId('case-map-state').nth(1)).toHaveText('Документы ещё разбираются: 19 — их записей пока нет.');
		expect(writes(calls)).toEqual([]);
	});
});

test.describe('«Суммы», 1280', () => {
	test.use({ viewport: { width: 1280, height: 1000 } });

	test('таблица: как написано и числом, что это и документ, лист, пометки, цитата; «показать убранные»; правка; «Убрать»', async ({ page }) => {
		const a = fixture('amounts');
		a.amounts[0] = { ...a.amounts[0], value_num: '1597806.6', unchecked: true, edited: true };
		const { calls } = await openSection(page, { section: 'amounts', routes: { 'amounts**': (r: any, c: any) => (c.method === 'GET' ? r.fulfill({ json: a }) : ok(r)), 'edits?**': { edits: [] } } });
		await expect(page.getByTestId('case-amounts-note')).toHaveText(S.map_amounts_hint);
		await expect(page.locator('.head h1')).toHaveText(S.map_amounts_title); // заголовок раздела — как в макете
		await expect(page.getByTestId('case-map-state')).toContainText('Документов без записей хронологии');
		const rows = page.getByTestId('case-amount');
		await expect(rows).toHaveCount(4);
		await expect(rows.nth(0)).toContainText('числом: 1 597 806,60 руб.');
		await expect(rows.nth(1)).toContainText(S.map_amount_no_value);
		await expect(rows.nth(0).locator('.pill')).toHaveText([S.map_amount_unchecked, S.map_amount_edited]);
		await expect(rows.nth(3).locator('.pill')).toHaveText([S.map_amount_unit_elsewhere]);
		await expect(rows.nth(0).getByRole('link')).toHaveAttribute('href', /\/p\/\d+/);
		await rows.nth(0).getByRole('button', { name: S.quote_toggle }).click();
		await expect(rows.nth(0).locator('.q')).toBeVisible();
		expect(calls.find((c) => c.path.startsWith('/amounts'))!.path).toBe('/amounts');
		await page.getByRole('checkbox', { name: S.map_amounts_hidden }).check();
		await expect.poll(() => calls.filter((c) => c.path.startsWith('/amounts')).at(-1)!.path).toBe('/amounts?hidden=true');
		await rows.nth(0).getByRole('button', { name: S.map_edit }).click();
		const dlg = dialog(page);
		await expect(dlg.getByRole('heading')).toHaveText(S.map_amount_edit_title);
		await expect(dlg.getByLabel(S.map_a_value_num)).toHaveValue('1 597 806,60');
		await dlg.getByLabel(S.map_a_what).fill('');
		await dlg.getByLabel(S.map_a_value_num).fill('1597806,6');
		await dlg.getByRole('button', { name: S.save }).click();
		await expect(dlg).toHaveCount(0);
		expect(calls.filter((c) => c.method === 'PATCH').at(-1)).toMatchObject({ path: '/amounts/39', body: { value_as_written: 'не менее 3 898 056,54 рублей', what: null, value_num: '1597806,6' } });
		await rows.nth(1).getByRole('button', { name: S.map_hide }).click();
		await expect.poll(() => calls.filter((c) => c.method === 'PATCH').at(-1)).toMatchObject({ path: '/amounts/3', body: { hidden: true } });
		await rows.nth(1).getByRole('button', { name: S.map_history }).click();
		expect(calls.some((c) => c.path === '/edits?entity=amount&id=3')).toBe(true);
	});

	test('сумм больше порции: «показано n из total» и «Показать ещё N»', async ({ page }) => {
		const a = fixture('amounts');
		a.amounts = Array.from({ length: 43 }, (_, n) => ({ ...a.amounts[n % 4], id: 1000 + n }));
		await openSection(page, { section: 'amounts', routes: { 'amounts**': a } });
		await expect(page.getByTestId('case-amount')).toHaveCount(30);
		await expect(page.getByTestId('case-amounts')).toContainText('показано 30 из 43');
		await page.getByRole('button', { name: 'Показать ещё 13' }).click();
		await expect(page.getByTestId('case-amount')).toHaveCount(43);
	});

	test('«только чтение» видит суммы и «Историю», без «Править» и «Убрать»; сумм нет — сказано', async ({ page }) => {
		let empty = false;
		const { calls } = await openSection(page, { section: 'amounts', boot: RO, routes: { 'amounts**': (r: any) => r.fulfill({ json: empty ? { amounts: [], can_write: false } : readonly('amounts') }) } });
		await expect(page.getByTestId('case-amount')).toHaveCount(4);
		await expect(page.getByTestId('case-amounts').getByRole('button')).toHaveText(Array(4).fill([S.quote_toggle, S.map_history]).flat());
		empty = true;
		await page.getByRole('checkbox', { name: S.map_amounts_hidden }).check();
		await expect(page.getByTestId('case-amounts-empty')).toHaveText(S.map_amounts_empty);
		expect(writes(calls)).toEqual([]);
	});
});

test.describe('«Хронология», 1280', () => {
	test.use({ viewport: { width: 1280, height: 1100 } });

	test('записи: дата слева, статус и линия, лист и документ, цитата; фильтр в одну строку, период по кнопке; порции', async ({ page }) => {
		const { calls } = await openSection(page, {
			section: 'chronology',
			routes: {
				'facts**': (r: any, c: any) => {
					const d = fixture('facts');
					if (c.path.includes('page=1')) return r.fulfill({ json: { ...d, facts: [{ ...d.facts[0], id: 999, summary: 'Следующая порция' }], next_page: null, end: true } });
					return r.fulfill({ json: d });
				}
			}
		});
		await expect(page.getByTestId('case-facts-note')).toContainText(S.map_model_reading);
		const rows = page.getByTestId('case-fact');
		await expect(rows).toHaveCount(4);
		await expect(page.getByTestId('case-facts')).toContainText('Записей: 155');
		await expect(rows.nth(0).locator('.date')).toHaveText('22 декабря 2025 года (25.08.2025)'); // значение рядом, если запись его не повторяет
		await expect(rows.nth(0).locator('.pill')).toHaveText([S.map_status_evidenced, S.map_line_dispute]);
		await rows.nth(0).getByRole('button', { name: S.quote_toggle }).click();
		await expect(rows.nth(0).locator('.q')).toBeVisible();
		// фильтр: слова и лицо уходят по «Найти» (и по Enter), линия — сразу
		const filter = page.getByTestId('case-facts-filter');
		await filter.getByRole('searchbox', { name: S.map_filter_words }).fill(' накладная ');
		await filter.getByRole('searchbox', { name: S.map_filter_person }).fill('Карпов');
		expect(calls.filter((c) => c.path.startsWith('/facts')).map((c) => c.path)).toEqual(['/facts']);
		await page.keyboard.press('Enter');
		await expect.poll(() => calls.filter((c) => c.path.startsWith('/facts')).at(-1)!.path).toBe(`/facts?person=${encodeURIComponent('Карпов')}&words=${encodeURIComponent('накладная')}`);
		await filter.getByRole('button', { name: S.map_line_process }).click();
		await expect.poll(() => new URLSearchParams(calls.filter((c) => c.path.startsWith('/facts')).at(-1)!.path.split('?')[1]).get('chronology')).toBe('process');
		await expect(page.getByTestId('case-facts-period')).toHaveCount(0);
		await filter.getByRole('button', { name: S.map_filter_more }).click();
		const period = page.getByTestId('case-facts-period');
		await period.getByLabel(S.map_filter_from).fill('2025-01-01');
		await period.getByLabel(S.map_filter_to).fill('2025-12-31');
		await period.getByRole('checkbox', { name: S.map_filter_hidden }).check();
		await filter.getByRole('button', { name: S.map_find }).click();
		await expect.poll(() => Object.fromEntries(new URLSearchParams(calls.filter((c) => c.path.startsWith('/facts')).at(-1)!.path.split('?')[1]))).toEqual({
			chronology: 'process', person: 'Карпов', words: 'накладная', date_from: '2025-01-01', date_to: '2025-12-31', hidden: 'true'
		});
		await page.getByTestId('case-facts-more').click();
		await expect(rows).toHaveCount(5);
		await expect(page.getByTestId('case-facts-more')).toHaveCount(0);
		expect(new URLSearchParams(calls.filter((c) => c.path.startsWith('/facts')).at(-1)!.path.split('?')[1]).get('page')).toBe('1');
	});

	test('пометки записи: дата не подтверждена, копия документа, продолжение на следующем листе, «без даты», убранная', async ({ page }) => {
		const d = fixture('facts');
		d.facts[0] = { ...d.facts[0], date_note: 'unchecked', copies: [{ label: 'т. 4, л.д. 157', url: null }] };
		d.facts[1] = { ...d.facts[1], date_note: 'document', more: { label: 'т. 4, л.д. 113', url: `/legal-tools/case/${F}/p/700`, quote: 'продолжение цитаты' }, edited: true };
		d.facts[2] = { ...d.facts[2], date_as_written: null, date_value: null, cut: true, hidden: true, edited: true };
		await openSection(page, { section: 'chronology', routes: { 'facts**': d } });
		const rows = page.getByTestId('case-fact');
		await expect(rows.nth(0)).toContainText(S.map_date_unchecked);
		await expect(rows.nth(0)).toContainText('Документ этой записи есть в деле ещё раз: т. 4, л.д. 157. Одно ли это событие — сверьте по листам.');
		await expect(rows.nth(1)).toContainText(S.map_date_document);
		await expect(rows.nth(1)).toContainText('Продолжение — т. 4, л.д. 113');
		await expect(rows.nth(1).locator('.pill').nth(2)).toHaveText(S.map_fact_edited);
		await expect(rows.nth(2).locator('.date')).toHaveText(S.map_date_none);
		await expect(rows.nth(2)).toContainText(S.map_cut);
		await expect(rows.nth(2)).toHaveClass(/hid/);
		await expect(rows.nth(2).locator('.pill').nth(2)).toHaveText(S.map_fact_hidden);
		await expect(rows.nth(2).getByRole('button', { name: S.map_unhide })).toBeVisible();
	});

	test('правка записи: все поля уходят как на прежней странице; «Убрать»; «История»; «только чтение»', async ({ page }) => {
		const { calls } = await openSection(page, { section: 'chronology', routes: { 'facts**': fixture('facts'), 'facts/*': ok, 'edits?**': { edits: [{ id: 1, entity: 'fact', entity_id: 168, field: 'status', field_text: '', before_text: 'claimed', after_text: 'established', who: 'вы', at: '2025-12-07T09:41:00Z', before: 'claimed', after: 'established' }, { id: 2, entity: 'fact', entity_id: 168, field: 'hidden', who: 'вы', at: '2025-12-07T09:40:00Z', before: false, after: true }] } } });
		const row = page.getByTestId('case-fact').first();
		await row.getByRole('button', { name: S.map_edit }).click();
		const dlg = dialog(page);
		await expect(dlg.getByRole('heading')).toHaveText(S.map_fact_edit_title);
		await expect(dlg.getByLabel(S.map_f_status)).toHaveValue('evidenced');
		await dlg.getByLabel(S.map_f_summary).fill(' Груз принят ');
		await dlg.getByLabel(S.map_f_chronology).selectOption({ label: S.map_line_process });
		await dlg.getByLabel(S.map_f_status).selectOption({ label: S.map_status_established });
		await dlg.getByLabel(S.map_f_kind).fill('');
		await dlg.getByLabel(S.map_f_date_value).fill('2025-12-22');
		await dlg.getByLabel(S.map_f_persons).fill('Карпов И. С. ,  Гусева М. О.,');
		await dlg.getByRole('button', { name: S.save }).click();
		await expect(dlg).toHaveCount(0);
		expect(calls.filter((c) => c.method === 'PATCH').at(-1)).toMatchObject({
			path: '/facts/168',
			body: { summary: 'Груз принят', chronology: 'process', status: 'established', kind: null, date_as_written: '22 декабря 2025 года', date_value: '2025-12-22', persons: ['Карпов И. С.', 'Гусева М. О.'] }
		});
		await row.getByRole('button', { name: S.map_hide }).click();
		await expect.poll(() => calls.filter((c) => c.method === 'PATCH').at(-1)!.body).toEqual({ hidden: true });
		await row.getByRole('button', { name: S.map_history }).click();
		const rows = dlg.getByTestId('case-history-row');
		await expect(rows.nth(0)).toContainText(S.map_f_status);
		await expect(rows.nth(0)).toContainText(`было «${S.map_status_claimed}», стало «${S.map_status_established}»`);
		await expect(rows.nth(1)).toContainText(`было «${S.map_no}», стало «${S.map_yes}»`);
	});

	test('«только чтение»: записи и «История» есть, «Править» и «Убрать» нет; записей нет — сказано', async ({ page }) => {
		let empty = false;
		const { calls } = await openSection(page, { section: 'chronology', boot: RO, routes: { 'facts**': (r: any) => r.fulfill({ json: empty ? { facts: [], total: 0, next_page: null, can_write: false } : readonly('facts') }) } });
		await expect(page.getByTestId('case-fact')).toHaveCount(4);
		await expect(page.getByTestId('case-fact').first().getByRole('button')).toHaveText([S.quote_toggle, S.map_history]);
		empty = true;
		await page.getByTestId('case-map-refresh').click();
		await expect(page.getByTestId('case-facts-empty')).toHaveText(S.map_facts_empty);
		expect(writes(calls)).toEqual([]);
	});
});

test.describe('«Сроки», 1280', () => {
	test.use({ viewport: { width: 1280, height: 1100 } });

	test('черновик, подтверждённый, убранный: даты, основание с цитатой, расчёт, норма; действия по состоянию', async ({ page }) => {
		const { calls } = await openSection(page, {
			section: 'deadlines',
			routes: {
				'deadlines**': (r: any, c: any) => {
					const d = fixture('deadlines');
					if (c.method === 'PATCH') {
						const x = d.deadlines.find((q: any) => `/deadlines/${q.id}` === c.path);
						if (c.body.confirmed != null) Object.assign(x, { state: c.body.confirmed ? 'confirmed' : 'draft', confirmed_name: 'Лебедева Анна Викторовна', confirmed_at: '2025-11-02T10:00:00Z' });
						if (c.body.hidden != null) x.hidden = c.body.hidden;
					}
					return r.fulfill({ json: d });
				},
				'edits?**': { edits: [] }
			}
		});
		await expect(page.getByTestId('case-deadlines-note')).toContainText(S.map_deadlines_hint);
		await expect(page.locator('.head').getByTestId('case-deadline-add')).toBeVisible(); // «Добавить срок» и «Обновить» — в шапке
		await expect(page.locator('.head').getByTestId('case-map-refresh')).toBeVisible();
		const cards = page.getByTestId('case-deadline');
		await expect(cards).toHaveCount(3);
		expect(calls.find((c) => c.path.startsWith('/deadlines'))!.path).toBe('/deadlines?hidden=true');
		const draft = cards.nth(0);
		await expect(draft).toContainText('с 13.03.2025 по 11.04.2025');
		await expect(draft.locator('.pill')).toHaveText(S.map_deadline_draft);
		await expect(draft).toContainText(S.map_deadline_via_chat);
		await expect(draft.locator('dl')).toContainText('месяц со дня принятия решения; последний день — 11.04.2025');
		await expect(draft.locator('dl')).toContainText('ст. 259 АПК РФ; ');
		await expect(draft.locator('.q')).toBeVisible();
		await expect(draft.getByRole('button')).toHaveText([S.map_deadline_confirm, S.map_edit, S.map_hide, S.map_history]);
		const done = cards.nth(1);
		await expect(done).toContainText('до 20.05.2025');
		await expect(done.locator('.pill')).toContainText('подтверждён: ');
		await expect(done.locator('dl')).toContainText(S.deadline_norm_none);
		await expect(done.getByRole('button')).toHaveText([S.map_deadline_unconfirm, S.map_edit, S.map_hide, S.map_history]);
		const gone = cards.nth(2);
		await expect(gone).toContainText(S.map_deadline_no_dates);
		await expect(gone.locator('.pill')).toHaveText(S.deadline_hidden);
		await expect(gone.getByRole('button')).toHaveText([S.map_unhide, S.map_history]);
		// подтвердить: ответ правки — новый перечень, раздел перерисован без отдельного запроса
		const gets = count(calls, '/deadlines');
		await draft.getByRole('button', { name: S.map_deadline_confirm }).click();
		await expect(draft.locator('.pill')).toContainText('подтверждён: Лебедева Анна Викторовна');
		expect(calls.filter((c) => c.method === 'PATCH').at(-1)).toMatchObject({ path: '/deadlines/1', body: { confirmed: true } });
		expect(count(calls, '/deadlines')).toBe(gets);
		await gone.getByRole('button', { name: S.map_unhide }).click();
		await expect.poll(() => calls.filter((c) => c.method === 'PATCH').at(-1)).toMatchObject({ path: '/deadlines/3', body: { hidden: false } });
		await done.getByRole('button', { name: S.map_history }).click();
		expect(calls.some((c) => c.path === '/edits?entity=deadline&id=2')).toBe(true);
	});

	test('«Править» срок и «Добавить срок»: отказ сервиса — в окне его фразой', async ({ page }) => {
		let refuse = true;
		const { calls } = await openSection(page, {
			section: 'deadlines',
			routes: {
				'deadlines**': (r: any, c: any) => {
					if (c.method === 'POST') return refuse ? r.fulfill({ status: 422, json: { detail: 'такого листа в деле нет' } }) : r.fulfill({ status: 201, json: { ok: true } });
					return r.fulfill({ json: fixture('deadlines') });
				}
			}
		});
		const card = page.getByTestId('case-deadline').first();
		await card.getByRole('button', { name: S.map_edit }).click();
		const dlg = dialog(page);
		await expect(dlg.getByRole('heading')).toHaveText('Апелляционная жалоба на решение от 12.03.2025');
		await expect(dlg.getByLabel(S.map_d_ref)).toHaveCount(0);
		await dlg.getByLabel(S.map_d_end_date).fill('2025-04-14');
		await dlg.getByRole('button', { name: S.save }).click();
		await expect(dlg).toHaveCount(0);
		expect(calls.filter((c) => c.method === 'PATCH').at(-1)).toMatchObject({ path: '/deadlines/1', body: { title: 'Апелляционная жалоба на решение от 12.03.2025', start_date: '2025-03-13', end_date: '2025-04-14' } });
		await page.getByTestId('case-deadline-add').click();
		await expect(dlg.getByRole('heading')).toHaveText(S.map_deadline_add);
		await dlg.getByLabel(S.map_d_title).fill('Возражения на заключение эксперта');
		await dlg.getByLabel(S.map_d_ref).fill('т. 4, л.д. 612');
		await dlg.getByLabel(S.map_d_quote).fill('Сторонам представить возражения в срок до 15 декабря 2026 года.');
		await dlg.getByLabel(S.map_d_end_date).fill('2026-12-15');
		await dlg.getByRole('button', { name: S.save }).click();
		await expect(dlg.getByTestId('case-dialog-error')).toHaveText('Не получилось: такого листа в деле нет');
		refuse = false;
		await dlg.getByLabel(S.map_d_ref).fill('т. 4, л.д. 61');
		await dlg.getByRole('button', { name: S.save }).click();
		await expect(dlg).toHaveCount(0);
		expect(calls.filter((c) => c.method === 'POST').at(-1)).toMatchObject({
			path: '/deadlines',
			body: { title: 'Возражения на заключение эксперта', ref: 'т. 4, л.д. 61', quote: 'Сторонам представить возражения в срок до 15 декабря 2026 года.', start_date: null, end_date: '2026-12-15', calc: null }
		});
	});

	test('«только чтение»: сроки и «История», без кнопок записи и «Добавить срок»; сроков нет — сказано', async ({ page }) => {
		let empty = false;
		const { calls } = await openSection(page, { section: 'deadlines', boot: RO, routes: { 'deadlines**': (r: any) => r.fulfill({ json: empty ? { deadlines: [], can_write: false } : readonly('deadlines') }) } });
		await expect(page.getByTestId('case-deadline')).toHaveCount(3);
		await expect(page.getByTestId('case-deadline-add')).toHaveCount(0);
		await expect(page.getByTestId('case-deadline').getByRole('button')).toHaveText([S.map_history, S.map_history, S.map_history]);
		empty = true;
		await page.getByTestId('case-map-refresh').click();
		await expect(page.getByTestId('case-deadlines-empty')).toHaveText(S.map_deadlines_empty);
		expect(writes(calls)).toEqual([]);
	});
});

for (const [section, routes, wait] of [
	['passport', {}, 'case-passport-about'],
	['amounts', { 'amounts**': fixture('amounts') }, 'case-amount'],
	['chronology', { 'facts**': fixture('facts') }, 'case-fact'],
	['deadlines', { 'deadlines**': fixture('deadlines') }, 'case-deadline']
] as const) {
	test(`карта дела на телефоне 360, тёмная схема — «${section}»: без прокрутки вбок`, async ({ page }) => {
		await page.setViewportSize({ width: 360, height: 800 });
		await openSection(page, { section, dark: true, routes: routes as any });
		await expect(page.getByTestId(wait).first()).toBeVisible();
		await noSideScroll(page);
		// в хронологии на телефоне действия записи свёрнуты под «Действия»
		if (section === 'chronology') {
			await expect(page.getByRole('button', { name: S.map_edit }).first()).toBeHidden();
			await page.getByTestId('case-fact').first().getByRole('button', { name: S.file_actions }).click();
		}
		const first = page.getByRole('button', { name: S.map_edit }).first();
		await first.click();
		await expect(dialog(page)).toBeVisible();
		await noSideScroll(page);
		for (const field of await dialog(page).locator('input, select, textarea').all())
			expect(await field.evaluate((e) => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
	});
}
