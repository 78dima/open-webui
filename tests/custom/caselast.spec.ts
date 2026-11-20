// ai-dvokat: «Файлы папки вне дела», «Удаление дела», «Потрачено по делу» на стенде компонентов
// (макеты K-files, K-danger; опись § 2.14, § 2.15, § 2.3).
import { test, expect } from '@playwright/test';
import { BOOT, S, dialog, fixture, noSideScroll, openSection, writes } from './casekit';

test.describe('«Файлы папки вне дела»', () => {
	test.use({ viewport: { width: 1280, height: 900 } });

	test('строки по состоянию файла; «Добавить в дело» с ответом «что это» у PDF и архива, у фото — без него', async ({ page }) => {
		const { calls } = await openSection(page, { section: 'folder-files', routes: { 'folder-files/*/add': (r: any) => r.fulfill({ status: 201, json: { ok: true } }) } });
		await expect(page.getByText(S.folder_files_hint_g)).toBeVisible();
		const rows = page.getByTestId('case-folder-file');
		const files = fixture('folder-files').files;
		await expect(rows).toHaveCount(files.length);
		const pdf = rows.filter({ has: page.getByRole('combobox') }).first();
		await expect(pdf.getByRole('combobox').locator('option')).toHaveText([S.upload_kind_volume, S.upload_kind_ecase]);
		await expect(page.getByTestId('case-folder-files')).toContainText(S.folder_file_unreadable);
		await expect(page.getByTestId('case-folder-files')).toContainText(S.folder_file_adding);
		await expect(page.getByTestId('case-folder-files')).toContainText(S.folder_file_bad_format);
		await expect(page.locator('.head .cnt')).toHaveText(String(files.length)); // число файлов — в шапке раздела
		await pdf.getByRole('combobox').selectOption({ label: S.upload_kind_ecase });
		await pdf.getByRole('button', { name: S.folder_file_add }).click();
		await expect(page.getByText(S.folder_file_added)).toBeVisible();
		const post = calls.find((c) => c.method === 'POST')!;
		expect(post.path).toMatch(/^\/folder-files\/[^/]+\/add$/);
		expect(post.body).toEqual({ input_kind: 'e_case' });
		const photo = rows.filter({ hasNot: page.getByRole('combobox') }).filter({ has: page.getByRole('button', { name: S.folder_file_add }) }).first();
		await photo.getByRole('button', { name: S.folder_file_add }).click();
		await expect.poll(() => calls.filter((c) => c.method === 'POST').at(-1)!.body).toEqual({ input_kind: null });
	});

	test('«только чтение»: файлы видны, кнопок «Добавить в дело» нет; телефон 360 без прокрутки вбок', async ({ page }) => {
		await page.setViewportSize({ width: 360, height: 800 });
		const { calls } = await openSection(page, { section: 'folder-files', boot: { can_write: false, is_owner: false }, dark: true });
		await expect(page.getByTestId('case-folder-file').first()).toBeVisible();
		await expect(page.getByRole('button', { name: S.folder_file_add })).toHaveCount(0);
		await expect(page.getByTestId('case-folder-files').getByRole('combobox')).toHaveCount(0);
		await noSideScroll(page);
		expect(writes(calls)).toEqual([]);
	});
});

test.describe('«Удаление дела»', () => {
	test.use({ viewport: { width: 1280, height: 900 } });

	test('своё окно подтверждения: Esc и «Отмена» ничего не удаляют; отказ — в окне; удаление — сообщение и «Мои дела»', async ({ page }) => {
		let refuse = true;
		const { calls } = await openSection(page, { section: 'danger' });
		await page.route(`**/legal-tools/api/cases/${BOOT.folder_id}?confirm=**`, (r) =>
			r.request().method() !== 'DELETE' ? r.fallback() : refuse ? r.fulfill({ status: 409, json: { detail: 'идёт обработка — повторите позже' } }) : r.fulfill({ json: { ok: true } })
		);
		let asked = 0;
		page.on('dialog', (d) => { asked += 1; void d.dismiss(); });
		const box = page.getByTestId('case-danger');
		await expect(box).toContainText(`${S.delete_case_confirm_g} ${S.delete_case_owner_note}`);
		await box.getByRole('button', { name: S.delete_case }).click();
		const dlg = dialog(page);
		await expect(dlg.getByRole('heading')).toHaveText(`Удалить дело «${BOOT.title}»?`);
		await expect(dlg).toContainText(S.delete_case_confirm_g);
		await page.keyboard.press('Escape');
		await expect(dlg).toHaveCount(0);
		await box.getByRole('button', { name: S.delete_case }).click();
		await dlg.getByRole('button', { name: S.cancel }).click();
		expect(writes(calls)).toEqual([]);
		await box.getByRole('button', { name: S.delete_case }).click();
		await dlg.getByRole('button', { name: S.delete_case }).click();
		await expect(dlg.getByTestId('case-dialog-error')).toHaveText('Не получилось: идёт обработка — повторите позже');
		refuse = false;
		await dlg.getByRole('button', { name: S.delete_case }).click();
		// после удаления — сообщение «Дело удалено» и переход на «Мои дела» (на стенде это уход со страницы стенда,
		// сообщение вместе с ним; его видно в живой проверке)
		await page.waitForURL((url) => url.pathname === '/case');
		expect(calls.filter((c) => c.method === 'DELETE').at(-1)!.path).toBe(`?confirm=${encodeURIComponent(BOOT.case_id)}`);
		expect(asked).toBe(0);
	});

	test('не владелец: пункта и раздела нет — «Не найдено»', async ({ page }) => {
		await openSection(page, { section: 'danger', boot: { is_owner: false } });
		await expect(page.getByTestId('case-section-none')).toBeVisible();
		await expect(page.getByTestId('case-danger')).toHaveCount(0);
	});
});

test('Г-1: оценка распознавания и «Потрачено» (при выключенных таблицах) видны в «Обзоре» и роли «только чтение»; в «Загрузить» их нет', async ({ page }) => {
	const ov = fixture('case-overview');
	const spent = ov.spent;
	const line = `Потрачено по делу: обработка ${String(spent.processing).replace('.', ',')} USD, работа ${String(spent.work).replace('.', ',')} USD`;
	// только чтение, таблицы выключены — в «Обзоре» видны и оценка, и «Потрачено»
	await openSection(page, {
		boot: { can_write: false, sections: BOOT.sections.filter((s: string) => s !== 'tables') }
	});
	await expect(page.getByTestId('case-upload-estimate')).toContainText(S.upload_estimate_hint);
	await expect(page.getByTestId('case-spent')).toHaveText(line);
	// таблицы включены — в «Обзоре» оценка есть, «Потрачено» нет (оно в «Таблицах»)
	await openSection(page, { boot: { can_write: false } });
	await expect(page.getByTestId('case-upload-estimate')).toContainText(S.upload_estimate_hint);
	await expect(page.getByTestId('case-spent')).toHaveCount(0);
	// в «Загрузить материалы» ни оценки, ни «Потрачено» нет
	await openSection(page, {
		section: 'upload',
		boot: { sections: BOOT.sections.filter((s: string) => s !== 'tables') }
	});
	await expect(page.getByTestId('case-drop')).toBeVisible();
	await expect(page.getByTestId('case-upload-estimate')).toHaveCount(0);
	await expect(page.getByTestId('case-spent')).toHaveCount(0);
});

test('ни один раздел меню не ведёт на прежнюю страницу сервиса: у каждого пункта свой раздел', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 1000 });
	await openSection(page, {
		data: () => fixture('case-overview-processing'),
		routes: { deltas: fixture('deltas'), 'documents?**': fixture('case-documents'), copies: fixture('copies'), 'amounts**': fixture('amounts'), 'facts**': fixture('facts'), 'deadlines**': fixture('deadlines'), tables: fixture('tables-list'), 'tables/scope?**': fixture('tables-scope') }
	});
	const links = page.locator('nav.nav a[data-testid^="case-nav-"]');
	const n = await links.count();
	expect(n).toBe(15);
	for (let i = 0; i < n; i++) {
		await links.nth(i).click();
		await expect(page.getByTestId('case-section-later')).toHaveCount(0);
		await expect(page.getByTestId('case-section-none')).toHaveCount(0);
		await expect(page.locator('main [role="status"]')).toHaveCount(0); // раздел дорисовался
		await expect(page.locator('main .pill.s', { hasText: 'Не получилось' })).toHaveCount(0);
	}
});
