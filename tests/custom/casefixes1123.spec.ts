// ai-dvokat: пакет исправлений по живому прогону 23.11.2026 — проверки страниц «Дел» на стенде компонентов.
import { test, expect } from '@playwright/test';
import { S, dialog, fixture, openSection } from './casekit';

test.describe('Д-2: срок без даты окончания', () => {
	test.use({ viewport: { width: 1280, height: 1100 } });

	test('у черновика без даты окончания — «Указать даты» вместо «Подтвердить»; дата появилась — «Подтвердить»', async ({ page }) => {
		const d = fixture('deadlines');
		Object.assign(d.deadlines[0], { start_date: null, end_date: null }); // как у 32 сроков проверочного дела
		const { calls } = await openSection(page, {
			section: 'deadlines',
			routes: {
				'deadlines**': (r: any, c: any) => {
					if (c.method === 'PATCH') {
						const x = d.deadlines.find((q: any) => `/deadlines/${q.id}` === c.path);
						if ('end_date' in c.body) Object.assign(x, { start_date: c.body.start_date, end_date: c.body.end_date });
						if (c.body.confirmed != null) x.state = c.body.confirmed ? 'confirmed' : 'draft';
					}
					return r.fulfill({ json: d });
				}
			}
		});
		const draft = page.getByTestId('case-deadline').nth(0);
		await expect(draft.getByRole('button')).toHaveText([S.map_deadline_set_dates, S.map_edit, S.map_hide, S.map_history]);
		await expect(draft.getByRole('button', { name: S.map_deadline_confirm })).toHaveCount(0);
		// «Указать даты» открывает правку срока, запроса подтверждения не уходит
		await draft.getByTestId('case-deadline-set-dates').click();
		const dlg = dialog(page);
		await expect(dlg).toBeVisible();
		expect(calls.filter((c) => c.method === 'PATCH')).toEqual([]);
		await dlg.locator('input[type="date"]').nth(1).fill('2025-04-11');
		await dlg.locator('button[type="submit"]').click();
		await expect.poll(() => calls.filter((c) => c.method === 'PATCH').at(-1)?.body).toMatchObject({ end_date: '2025-04-11' });
		await expect(draft.getByRole('button')).toHaveText([S.map_deadline_confirm, S.map_edit, S.map_hide, S.map_history]);
		await draft.getByRole('button', { name: S.map_deadline_confirm }).click();
		await expect.poll(() => calls.filter((c) => c.method === 'PATCH').at(-1)?.body).toEqual({ confirmed: true });
	});
});

// ---- Д-4: «Создать папку» на «Мои дела» ----
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

const fx = (name: string) =>
	JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/case/${name}.json`, import.meta.url)), 'utf8'));

async function myCases(page: Page, opt: { config?: unknown; strings?: Record<string, unknown>; fail?: string } = {}) {
	const posted: any[] = [];
	const own = fx('folders');
	const listing = fx('my-cases-empty');
	await page.addInitScript(() => localStorage.setItem('token', 'session-token'));
	await page.route('**/legal-tools/api/cases/ui.json', (r) => r.fulfill({ json: { strings: opt.strings ?? S } }));
	await page.route('**/api/v1/folders/shared', (r) => r.fulfill({ json: [] }));
	await page.route('**/api/v1/folders/', (r) => {
		if (r.request().method() !== 'POST') return r.fulfill({ json: own });
		const body = r.request().postDataJSON();
		posted.push(body);
		if (opt.fail) return r.fulfill({ status: 400, json: { detail: opt.fail } });
		const made = { id: `new-${posted.length}`, name: body.name, parent_id: null, updated_at: 1 };
		own.push(made);
		listing.own = [...(listing.own ?? []), { folder_id: made.id, title: made.name, path: "", write: true, owner: true, shared: false, case: null }];
		return r.fulfill({ json: made });
	});
	await page.route('**/legal-tools/api/cases', (r) => r.fulfill({ json: listing }));
	await page.goto('/?case');
	await page.waitForFunction(() => typeof (window as any).setConfig === 'function');
	await page.evaluate(
		(config) => (window as any).setConfig(config),
		opt.config ?? { custom_ui: { case: true }, features: { enable_folders: true } }
	);
	await page.waitForSelector('[data-testid="my-cases"][data-phase="ready"]');
	return { posted, own };
}

test.describe('Д-4: «Создать папку» на «Мои дела»', () => {
	test.use({ viewport: { width: 1280, height: 900 } });

	test('одно нажатие — окно; папка создаётся штатным запросом, появляется в «Папках без дела» и в хранилище панели чата', async ({ page }) => {
		const { posted, own } = await myCases(page);
		await page.getByTestId('case-new-folder').locator('visible=true').first().click();
		const dlg = dialog(page);
		await expect(dlg).toBeVisible();
		await expect(dlg.getByRole('heading')).toHaveText(S.new_folder_title);
		// пустое название запросом не уходит
		await dlg.locator('button[type="submit"]').click();
		await dlg.locator('input').fill('   ');
		await dlg.locator('button[type="submit"]').click();
		await expect(dlg).toContainText(S.new_folder_empty);
		expect(posted).toEqual([]);
		// повтор названия среди папок верхнего уровня — номер в конце, как у штатного окна
		const taken = own.find((f: any) => f.parent_id == null).name;
		await dlg.locator('input').fill(taken);
		await dlg.locator('button[type="submit"]').click();
		await expect(dlg).toHaveCount(0);
		expect(posted).toEqual([{ name: `${taken} 1` }]);
		await expect(page.getByTestId('case-folder').filter({ hasText: `${taken} 1` })).toBeVisible();
		await expect(page.getByTestId('case-folder').filter({ hasText: `${taken} 1` }).getByRole('button')).toHaveText(S.create_case);
	});

	test('отказ сервера виден в окне; нет права на папки — кнопки нет; прежний сервис без строк окна — прежняя ссылка в чат', async ({ page }) => {
		await myCases(page, { fail: 'Folder already exists' });
		await page.getByTestId('case-new-folder').locator('visible=true').first().click();
		await dialog(page).locator('input').fill('Новое дело');
		await dialog(page).locator('button[type="submit"]').click();
		await expect(dialog(page)).toContainText('Folder already exists');

		await myCases(page, { config: { custom_ui: { case: true }, features: { enable_folders: false } } });
		await expect(page.getByTestId('case-new-folder')).toHaveCount(0);
		await expect(page.locator('a', { hasText: S.create_folder_in_chat })).toHaveCount(0);

		const old = { ...S };
		for (const k of ['create_folder', 'new_folder_title', 'new_folder_name', 'new_folder_hint', 'new_folder_empty', 'new_folder_done']) delete old[k];
		await myCases(page, { strings: old });
		await expect(page.getByTestId('case-new-folder')).toHaveCount(0);
		await expect(page.locator('a:visible', { hasText: S.create_folder_in_chat })).toHaveAttribute('href', '/');
	});
});

// ---- Д-9: отметка «лист в „Проверьте листы“» у записи хронологии и суммы ----
test.describe('Д-9: лист записи стоит в «Проверьте листы»', () => {
	test.use({ viewport: { width: 1280, height: 1100 } });
	const checks = [{ code: 'text_disagree', reason: 'числа на листе прочитаны по-разному: «500» / «800»' }, { code: 'blurred', reason: 'размыто — переснимите' }];

	test('хронология: отметка и причины словами списка у записи с такого листа; у прочих и при прежнем сервисе — нет; счёт на группе', async ({ page }) => {
		const d = fixture('facts');
		d.facts[0].sheet_checks = checks;
		d.facts[1].sheet_checks = [];
		delete d.facts[2].sheet_checks; // прежний сервис поля не присылает
		d.facts.push({ group: true, document_id: 5, document: 'Выписка', n: 12, date_from: '2025-04-01', date_to: '2025-05-31', page_id: 1, label: 'т. 2, л.д. 5', on_check: 4 });
		await openSection(page, { section: 'chronology', routes: { 'facts**': d } });
		const rows = page.getByTestId('case-fact');
		await expect(rows.nth(0).getByTestId('case-sheet-check')).toHaveText(S.map_sheet_check_pill);
		await expect(rows.nth(0).getByTestId('case-sheet-check-why')).toHaveText(
			'Лист записи стоит в «Проверьте листы»: числа на листе прочитаны по-разному: «500» / «800»; размыто — переснимите. Сверьте запись с листом.'
		);
		await expect(rows.nth(1).getByTestId('case-sheet-check')).toHaveCount(0);
		await expect(rows.nth(2).getByTestId('case-sheet-check')).toHaveCount(0);
		await expect(page.getByTestId('case-sheet-check')).toHaveCount(1);
		await expect(page.getByTestId('case-fact-group').getByTestId('case-group-on-check')).toHaveText('с листов из «Проверьте листы»: 4');
	});

	test('суммы: отметка и причины у суммы с такого листа; счёт на группе', async ({ page }) => {
		const d = fixture('amounts');
		d.amounts[0].sheet_checks = checks.slice(1);
		d.amounts.push({ group: true, document_id: 5, document: 'Выписка', n: 7, page_id: 1, label: 'т. 2, л.д. 5', on_check: 2 }, { group: true, document_id: 6, document: 'Акт', n: 3, page_id: 2, label: 'т. 2, л.д. 6', on_check: 0 });
		await openSection(page, { section: 'amounts', routes: { 'amounts**': d } });
		const first = page.getByTestId('case-amount').first();
		await expect(first.getByTestId('case-sheet-check')).toHaveText(S.map_sheet_check_pill);
		await expect(first.getByTestId('case-sheet-check-why')).toHaveText('Лист суммы стоит в «Проверьте листы»: размыто — переснимите. Сверьте сумму с листом.');
		await expect(page.getByTestId('case-sheet-check')).toHaveCount(1);
		await expect(page.getByTestId('case-group-on-check')).toHaveText(['с листов из «Проверьте листы»: 2']);
	});
});

// ---- Д-6: вложение чата, из которого не извлечён текст ----
test.describe('Д-6: знак «не прочитан» у вложения чата', () => {
	const src = (p: string) => readFileSync(fileURLToPath(new URL(`../../src/lib/components/${p}`, import.meta.url)), 'utf8');
	const ru = JSON.parse(readFileSync(fileURLToPath(new URL('../../src/lib/custom/locales/ru-RU.json', import.meta.url)), 'utf8'));

	test('знак виден постоянно, пока у вложения есть ошибка разбора; без ошибки знака нет', async ({ page }) => {
		await page.goto('/?file-unread');
		const mark = page.getByTestId('file-item-error');
		await expect(mark).toHaveText(ru.file_unread.mark);
		await page.waitForTimeout(6000); // всплывающее сообщение штатного интерфейса за это время уже исчезает
		await expect(mark).toBeVisible();
		await page.goto('/?file-unread=ok');
		await expect(page.getByTestId('file-item-error')).toHaveCount(0);
	});

	test('точки подключения в штатных файлах: ошибка остаётся у вложения, вложение её показывает', async () => {
		const input = src('chat/MessageInput.svelte');
		expect(input).toContain('fileItem.error = `${uploadedFile.error}`;');
		expect(input).toContain("toast.warning(customRu.file_unread.toast.replace('{name}', fileItem.name));");
		expect(input).not.toContain('toast.warning(uploadedFile.error);');
		const item = src('common/FileItem.svelte');
		expect(item.match(/<CustomFileUnread error=\{item\?\.error\} \/>/g)?.length).toBe(2); // оба вида вложения
	});
});
