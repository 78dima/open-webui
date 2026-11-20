// ai-dvokat: раздел «Опись» на стенде компонентов (макеты K-inventory, K-dialogs; опись § 2.7).
import { test, expect } from '@playwright/test';
import { F, S, dialog, fixture, noSideScroll, openSection, writes } from './casekit';

/** Опись выдуманного дела: строки примера сервиса и строки с пометками проверки (их в примере нет). */
export function documents(page = 0) {
	const d = fixture('case-documents');
	const [a, b, c, e] = d.documents;
	const rows = [
		a,
		{ ...b, number: '3935', author: 'Представитель истца по доверенности Тихонов А. И.' },
		{ ...c, unchecked: ['title'] },
		{ ...e, edited: true, date_value: '2025-04-07', date_as_written: null },
		{ ...e, id: 901, label: 'т. 4, л.д. 145–147', first_page_id: 9011, last_page_id: 9013, sheets: 3, unchecked: ['date'], date_as_written: '«05» 02 2025 г.' },
		{ ...e, id: 902, label: 'т. 4, л.д. 161–162', first_page_id: 9021, last_page_id: 9022, sheets: 2, title: null, doc_type: null, uncovered: true },
		{ ...e, id: 903, label: 'т. 4, л.д. 163–186', first_page_id: 9031, last_page_id: 9054, sheets: 24, title: 'Заключение эксперта', doc_type: 'заключение', overlap: [{ label: '«Счёт на оплату»' }] },
		{ ...e, id: 904, volume_id: 5, volume_label: '5/1', label: 'т. 5/1, л.д. 1–3', first_page_id: 9041, last_page_id: 9043, sheets: 3, title: 'Отзыв на иск', doc_type: 'отзыв' }
	];
	if (page === 1) return { documents: [{ ...e, id: 950, label: 'т. 4, л.д. 187–190', title: 'Ходатайство', sheets: 4 }], total: 22, page: 1, next_page: null, end: true };
	return { documents: rows, total: 22, page: 0, next_page: 1, end: false };
}
const pages = () => ({ pages: Array.from({ length: 6 }, (_, n) => ({ id: 631 + n, label: `т. 4, л.д. ${n + 1}`, side: 'face', document_id: 69 })) });
const docsRoute = (r: any, c: any) => r.fulfill({ json: documents(Number(new URLSearchParams(c.path.split('?')[1]).get('page') ?? 0)) });
const ok = (r: any) => r.fulfill({ json: { ok: true } });

test.describe('«Опись», 1280', () => {
	test.use({ viewport: { width: 1280, height: 1100 } });

	test('строки: листы ссылкой, номер и автор второй строкой, пометки, «исправлено юристом»; «Показать ещё» порцией сервиса', async ({ page }) => {
		const { calls } = await openSection(page, { section: 'inventory', routes: { 'documents?**': docsRoute } });
		await expect(page.getByTestId('case-inventory-note')).toHaveText(S.inventory_note_g);
		await expect(page.locator('.head .cnt')).toHaveText('22 документа');
		const rows = page.getByTestId('case-doc');
		await expect(rows).toHaveCount(8);
		await expect(rows.nth(0).getByRole('link')).toHaveAttribute('href', `/legal-tools/case/${F}/p/629`);
		await expect(rows.nth(0).locator('.fn')).toHaveText('tom-2-chast-1.pdf'); // лист без номера: имя файла мелко
		await expect(rows.nth(1)).toContainText('№ 3935 · Представитель истца по доверенности Тихонов А. И.');
		await expect(rows.nth(2).locator('.pill')).toHaveText(S.inventory_unchecked);
		await expect(rows.nth(3).getByTestId('case-doc-edited')).toHaveText(S.inventory_edited);
		await expect(rows.nth(3)).toContainText('07.04.2025');
		await expect(rows.nth(4).locator('.pill')).toHaveText(S.inventory_date_unchecked);
		await expect(rows.nth(5).locator('.pill')).toHaveText(S.inventory_uncovered);
		await expect(rows.nth(6).locator('.pill')).toHaveText('пересекается с документом «Счёт на оплату»');
		// «Разделить» — у каждого документа, как на прежней странице: делится ли он, решают страницы внутри него
		// (лист с оборотом — две страницы при одном листе в счёте), а не счёт листов
		await expect(rows.nth(0).getByRole('button')).toHaveText([S.doc_edit, S.doc_split]);
		await expect(rows.nth(1).getByRole('button')).toHaveText([S.doc_edit, S.doc_split]);
		await expect(page.getByTestId('case-inventory')).toContainText('показано 8 из 22');
		await page.getByTestId('case-inventory-more').click();
		await expect(rows).toHaveCount(9);
		await expect(page.getByTestId('case-inventory-more')).toHaveCount(0);
		expect(calls.filter((c) => c.path.startsWith('/documents')).map((c) => c.path)).toEqual(['/documents?page=0', '/documents?page=1']);
	});

	test('отбор по тому и выгрузка в Word и Excel с учётом тома; файл скачивается под именем сервиса', async ({ page }) => {
		const { calls } = await openSection(page, {
			section: 'inventory',
			routes: {
				'documents?**': docsRoute,
				'export/inventory.*': (r: any, c: any) =>
					r.fulfill({
						status: 200,
						contentType: 'application/octet-stream',
						headers: { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(c.path.includes('docx') ? 'Опись — Северный ветер.docx' : 'Опись — Северный ветер.xlsx')}` },
						body: 'PK'
					})
			}
		});
		const select = page.getByTestId('case-inventory-volume');
		await expect(select.locator('option')).toHaveText([S.inventory_filter_all, 'Том 4']);
		await page.getByTestId('case-doc').first().getByRole('checkbox').check();
		await select.selectOption({ label: 'Том 4' });
		await expect.poll(() => calls.filter((c) => c.path.startsWith('/documents')).at(-1)!.path).toBe('/documents?page=0&volume=4');
		await expect(page.getByTestId('case-doc').first().getByRole('checkbox')).not.toBeChecked(); // отмеченное снято
		for (const [name, file, path] of [
			[S.export_docx, 'Опись — Северный ветер.docx', '/export/inventory.docx?volume=4'],
			[S.export_xlsx, 'Опись — Северный ветер.xlsx', '/export/inventory.xlsx?volume=4']
		]) {
			const download = page.waitForEvent('download');
			await page.getByRole('button', { name }).click();
			expect((await download).suggestedFilename()).toBe(file);
			expect(calls.some((c) => c.path === path && c.headers.authorization === 'Bearer session-token')).toBe(true);
		}
	});

	test('«Изменить»: уходят только изменённые поля; отказ сервиса — под полями; «История» — из этого окна', async ({ page }) => {
		let refuse = true;
		const { calls } = await openSection(page, {
			section: 'inventory',
			routes: {
				'documents?**': docsRoute,
				'pages?**': pages(),
				'documents/*': (r: any) => (refuse ? r.fulfill({ status: 422, json: { detail: 'первый лист документа стоит после последнего' } }) : ok(r)),
				'edits?**': fixture('case-edits'),
				'edits/*/revert': ok
			}
		});
		const row = page.getByTestId('case-doc').nth(1);
		await row.getByRole('button', { name: S.doc_edit }).click();
		const dlg = dialog(page);
		await expect(dlg.getByRole('heading')).toHaveText(S.doc_edit_title);
		expect(calls.some((c) => c.path === '/pages?volume=4')).toBe(true);
		await expect(dlg.getByLabel(S.doc_field_title)).toHaveValue('Товарная накладная');
		await expect(dlg.getByLabel(S.doc_field_title)).toBeFocused();
		await expect(dlg.getByLabel(S.doc_field_number)).toHaveValue('3935');
		// ничего не менялось — запроса нет, окно закрывается
		await dlg.getByRole('button', { name: S.save }).click();
		await expect(dlg).toHaveCount(0);
		expect(writes(calls)).toEqual([]);
		await row.getByRole('button', { name: S.doc_edit }).click();
		await dlg.getByLabel(S.doc_field_type).fill('товарная накладная');
		await dlg.getByLabel(S.doc_field_date_value).fill('2025-02-05');
		await dlg.getByLabel(S.doc_field_author).fill('');
		await dlg.getByLabel(S.doc_field_last).selectOption({ label: 'т. 4, л.д. 3' });
		await dlg.getByRole('button', { name: S.save }).click();
		await expect(dlg.getByTestId('case-dialog-error')).toHaveText('Не получилось: первый лист документа стоит после последнего');
		refuse = false;
		await dlg.getByRole('button', { name: S.save }).click();
		await expect(dlg).toHaveCount(0);
		await expect(page.getByText(S.saved)).toBeVisible();
		const patch = calls.filter((c) => c.method === 'PATCH').at(-1)!;
		expect(patch.path).toBe('/documents/69');
		expect(patch.body).toEqual({ doc_type: 'товарная накладная', date_value: '2025-02-05', author: null, last_page_id: 633 });
		// «История» строки — в окне «Изменить»; откат перечитывает опись
		await row.getByRole('button', { name: S.doc_edit }).click();
		await dlg.getByRole('button', { name: S.history }).click();
		await expect(dlg.getByRole('heading')).toHaveText(S.history_title);
		expect(calls.some((c) => c.path === '/edits?entity=document&id=69')).toBe(true);
		const before = calls.filter((c) => c.path.startsWith('/documents?')).length;
		await dlg.getByRole('button', { name: S.revert }).first().click();
		await expect(page.getByText(S.revert_done)).toBeVisible();
		await expect.poll(() => calls.filter((c) => c.path.startsWith('/documents?')).length).toBe(before + 1);
	});

	test('«Разделить»: новый документ начинается с листа внутри документа; «Объединить отмеченные: N»', async ({ page }) => {
		const { calls } = await openSection(page, {
			section: 'inventory',
			routes: { 'documents?**': docsRoute, 'pages?**': pages(), 'documents/*/split': ok, 'documents/merge': ok }
		});
		const rows = page.getByTestId('case-doc');
		// в примере документ 69 — листы 630…: границы подставляем под выдуманный перечень листов
		await page.unroute(`**/legal-tools/api/cases/${F}/documents?**`);
		await page.route(`**/legal-tools/api/cases/${F}/documents?**`, (r) => {
			const d = documents();
			d.documents[1] = { ...d.documents[1], first_page_id: 631, last_page_id: 634 };
			return r.fulfill({ json: d });
		});
		await page.getByTestId('case-inventory-volume').selectOption({ label: 'Том 4' });
		await page.getByTestId('case-inventory-volume').selectOption({ label: S.inventory_filter_all });
		await rows.nth(1).getByRole('button', { name: S.doc_split }).click();
		const dlg = dialog(page);
		await expect(dlg.getByRole('heading')).toHaveText(S.doc_split_title);
		await expect(dlg).toContainText('Товарная накладная · т. 4, л.д. 1–115');
		await expect(dlg.locator('select option')).toHaveText(['т. 4, л.д. 2', 'т. 4, л.д. 3', 'т. 4, л.д. 4']);
		await dlg.locator('select').selectOption({ label: 'т. 4, л.д. 3' });
		await dlg.getByRole('button', { name: S.doc_split }).click();
		await expect(dlg).toHaveCount(0);
		expect(calls.filter((c) => c.method === 'POST').at(-1)).toMatchObject({ path: '/documents/69/split', body: { at_page_id: 633 } });
		// объединить: меньше двух и разные тома — сообщение, запроса нет
		const merge = page.getByTestId('case-inventory-merge');
		await expect(merge).toHaveText(S.doc_merge);
		await merge.click();
		await expect(page.getByText(S.doc_merge_need_two)).toBeVisible();
		await rows.nth(1).getByRole('checkbox').check();
		await rows.nth(7).getByRole('checkbox').check(); // другой том
		await expect(merge).toHaveText('Объединить отмеченные: 2');
		await merge.click();
		expect(writes(calls).filter((x) => x.includes('merge'))).toEqual([]);
		await rows.nth(7).getByRole('checkbox').uncheck();
		await rows.nth(2).getByRole('checkbox').check();
		await merge.click();
		await expect.poll(() => calls.filter((c) => c.path === '/documents/merge').at(-1)?.body).toEqual({ document_ids: [69, 70] });
		await expect(merge).toHaveText(S.doc_merge); // после объединения отметки сняты
	});

	test('«только чтение»: отметок, «Изменить», «Разделить», «Объединить» нет; «История» и выгрузка есть', async ({ page }) => {
		const { calls } = await openSection(page, {
			section: 'inventory',
			boot: { can_write: false, is_owner: false },
			routes: { 'documents?**': docsRoute, 'edits?**': { edits: [] } }
		});
		await expect(page.getByTestId('case-doc')).toHaveCount(8);
		await expect(page.getByRole('checkbox', { name: S.doc_select })).toHaveCount(0);
		const names = (await page.locator('main button:visible').allTextContents()).map((n) => n.trim());
		expect([...new Set(names)].sort()).toEqual([S.history, S.export_docx, S.export_xlsx, S.goto_open, 'Показать ещё 14'].sort());
		await page.getByTestId('case-doc').first().getByRole('button', { name: S.history }).click();
		await expect(dialog(page).getByTestId('case-history-empty')).toBeVisible();
		expect(writes(calls)).toEqual([]);
	});

	test('версия дела сменилась — опись перечитывается с начала; описи нет; опись не пришла', async ({ page }) => {
		let version = 6;
		let mode: 'rows' | 'empty' | 'fail' = 'fail';
		const { calls } = await openSection(page, {
			section: 'inventory',
			data: () => ({ ...fixture('case-overview'), version }),
			routes: {
				'documents?**': (r: any, c: any) =>
					mode === 'fail' ? r.fulfill({ status: 500, json: { detail: 'сбой сервиса' } }) : mode === 'empty' ? r.fulfill({ json: { documents: [], total: 0, end: true } }) : docsRoute(r, c)
			}
		});
		await expect(page.getByTestId('case-inventory-error')).toContainText('Не получилось: сбой сервиса');
		mode = 'rows';
		await page.getByTestId('case-inventory-error').getByRole('button', { name: S.retry }).click();
		await expect(page.getByTestId('case-doc')).toHaveCount(8);
		const before = calls.filter((c) => c.path.startsWith('/documents?')).length;
		await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
		await page.waitForTimeout(400);
		expect(calls.filter((c) => c.path.startsWith('/documents?')).length).toBe(before); // версия та же — опись не трогается
		version = 7;
		mode = 'empty';
		await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
		await expect(page.getByTestId('case-inventory-empty')).toHaveText(S.inventory_empty);
	});
});

test('«Опись» на телефоне 360: строки карточками с подписями, без прокрутки вбок, окно правки по ширине', async ({ page }) => {
	await page.setViewportSize({ width: 360, height: 800 });
	await openSection(page, { section: 'inventory', dark: true, routes: { 'documents?**': docsRoute, 'pages?**': pages() } });
	await expect(page.getByTestId('case-doc')).toHaveCount(8);
	await noSideScroll(page);
	const before = await page.getByTestId('case-doc').nth(1).locator('[data-l]').first().evaluate((e) => getComputedStyle(e, '::before').content);
	expect(before).toContain(S.inventory_col_sheets);
	await page.getByTestId('case-doc').nth(1).getByRole('button', { name: S.doc_edit }).click();
	await expect(dialog(page)).toBeVisible();
	await noSideScroll(page);
	for (const field of await dialog(page).locator('input, select').all())
		expect(await field.evaluate((e) => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
});

test('запасное название документа описи (title_inventory): три состояния и правка юристом без случайного сохранения', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	const base = fixture('case-documents');
	const docs = [
		{ ...base.documents[0], title: 'Исковое заявление (сверенное)' },
		{ ...base.documents[1], title: null, title_inventory: 'Протокол осмотра от 04.06.2026' },
		{ ...base.documents[2], title: null, title_inventory: null }
	];
	let savedTitle: string | null = null;
	const { calls } = await openSection(page, {
		section: 'inventory',
		routes: {
			'documents?**': (r: any) =>
				r.fulfill({
					json: {
						documents: docs.map((d, i) =>
							i === 1 && savedTitle ? { ...d, title: savedTitle, title_inventory: null, edited: true } : d
						),
						total: 3,
						end: true
					}
				}),
			'documents/*': (r: any, c: any) => {
				savedTitle = c.body.title_as_written ?? null;
				return r.fulfill({ json: { ok: true } });
			},
			'pages?**': pages()
		}
	});
	const rows = page.getByTestId('case-doc');
	await expect(rows).toHaveCount(3);
	// 1) сверенное название — обычное жирное, без подписи «не сверено»
	await expect(rows.nth(0).locator('.b')).toHaveText('Исковое заявление (сверенное)');
	await expect(rows.nth(0).getByTestId('case-doc-title-unverified')).toHaveCount(0);
	// 2) только запасное — приглушённо с подписью происхождения
	await expect(rows.nth(1).getByTestId('case-doc-title-fallback')).toHaveText('Протокол осмотра от 04.06.2026');
	await expect(rows.nth(1).getByTestId('case-doc-title-unverified')).toHaveText(S.inventory_title_unverified);
	// 3) нет ни того ни другого — прочерк «—»
	await expect(rows.nth(2)).toContainText('—');
	await expect(rows.nth(2).getByTestId('case-doc-title-unverified')).toHaveCount(0);

	// окно «Изменить» для документа с запасным названием: поле пустое, запасное — подсказкой под ним
	await rows.nth(1).getByRole('button', { name: S.doc_edit }).click();
	const dlg = dialog(page);
	const input = dlg.getByLabel(S.doc_field_title);
	await expect(input).toHaveValue('');
	await expect(dlg.getByTestId('case-doc-edit-title-hint')).toContainText('Протокол осмотра от 04.06.2026');
	await expect(dlg.getByTestId('case-doc-edit-title-hint')).toContainText(S.inventory_title_unverified);
	// сохранение без ввода не отправляет запасное название как правку юриста
	await dlg.getByRole('button', { name: S.save }).click();
	await expect(dlg).toHaveCount(0);
	expect(writes(calls)).toEqual([]);

	// ввод своего названия юристом: сохраняется как обычный title, подпись «не сверено» исчезает
	await rows.nth(1).getByRole('button', { name: S.doc_edit }).click();
	await dialog(page).getByLabel(S.doc_field_title).fill('Протокол осмотра места происшествия');
	await dialog(page).getByRole('button', { name: S.save }).click();
	await expect(page.getByText(S.saved)).toBeVisible();
	await expect(rows.nth(1).locator('.b')).toHaveText('Протокол осмотра места происшествия');
	await expect(rows.nth(1).getByTestId('case-doc-title-unverified')).toHaveCount(0);
	expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({
		title_as_written: 'Протокол осмотра места происшествия'
	});
});
