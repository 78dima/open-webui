// ai-dvokat: раздел «Тома» страницы дела на стенде компонентов (макет K-volumes; опись § 2.5, § 0.3, § 0.4).
import { test, expect } from '@playwright/test';
import { API, S, dialog, fixture, noSideScroll, openSection, processing, refresh, writes } from './casekit';

const EDITS = {
	edits: [
		{ id: 31, field_text: 'Том файла', who: 'вы', at: '2025-12-07T09:41:00Z', before_text: 'т. 5/1', after_text: '', can_revert: true },
		{ id: 30, field_text: 'Том файла', who: 'модель', at: '2025-12-02T18:24:00Z', before_text: '', after_text: 'т. 5/1', reverted_by: 31 },
		{ id: 29, field_text: 'Том файла', who: 'Лебедева А. В.', at: '2025-12-02T18:20:00Z', before_text: 'т. 4', after_text: '', revert_of: 28 }
	]
};
const ok = (r: any) => r.fulfill({ json: { ok: true } });

test.describe('«Тома», 1280', () => {
	test.use({ viewport: { width: 1280, height: 1100 } });

	test('карточка тома: состояние, страницы и листы, откуда номер, замечания по нумерации, сверка с описью, файлы', async ({ page }) => {
		await openSection(page, { section: 'volumes', data: processing });
		const vols = page.getByTestId('case-volume');
		await expect(vols).toHaveCount(2);
		const v4 = vols.nth(0);
		await expect(v4.getByRole('heading', { level: 2 })).toHaveText('Том 4');
		await expect(v4).toContainText('209 страниц · л.д. 1–210');
		await expect(v4.locator('.pill').first()).toHaveText(S.volume_state_ready);
		await expect(v4.getByTestId('case-volume-source')).toContainText(S.label_source_lawyer_g);
		await expect(v4.getByTestId('case-volume-source').getByRole('link')).toHaveAttribute('href', `/legal-tools/case/${fixture('case-boot').folder_id}/p/629`);
		// ссылка в «Проверьте листы»: число и состав — из тех же замечаний, что в разделе проверки
		const link = v4.getByTestId('case-volume-checks');
		await expect(link).toHaveAttribute('href', /check$/);
		await expect(link).toContainText('По нумерации тома 6 замечаний:');
		await expect(link).toContainText(S.volume_check_open);
		// сверка с внутренней описью: числа и расхождения словами сервиса; четыре расхождения раскрыты, сворачиваются
		const court = v4.getByTestId('case-court');
		await expect(court).toContainText('в ней 23, в описи дела 21');
		await expect(court).toContainText('Расхождения с внутренней описью тома: 4');
		await expect(court).toContainText('в томе нет листа с номером 116');
		await court.getByRole('button', { name: S.collapse }).click();
		await expect(court).not.toContainText('в томе нет листа с номером 116');
		await refresh(page);
		await page.waitForTimeout(300);
		await expect(court).not.toContainText('в томе нет листа с номером 116'); // обновление обзора не раскрывает
		// том в работе: ход, «пока л.д.», факты нумерации — повтор номера и расхождение прочтений ссылками
		const v5 = vols.nth(1);
		await expect(v5).toContainText('312 страниц · пока л.д. 1–140');
		await expect(v5.locator('.pill').first()).toHaveText('распознаётся: 140 из 312');
		await expect(v5.getByTestId('case-volume-source')).toContainText(S.label_source_cover_g);
		const facts = v5.getByTestId('case-volume-facts');
		await expect(facts.locator('li')).toHaveCount(3);
		await expect(facts.getByRole('link').nth(0)).toHaveAttribute('href', /\/ref\?t=5%2F1&l=88$/);
		await expect(facts.getByRole('link').nth(1)).toHaveAttribute('href', /\/p\/\d+$/);
		await expect(v5.getByTestId('case-file')).toContainText('312 страниц · цифровой текст у 12 из 312 страниц');
	});

	test('файлы без тома: подсказка «продолжение» с подтверждением, «укажите том», заблокированный; электронное дело', async ({ page }) => {
		const { calls } = await openSection(page, { section: 'volumes', data: processing, routes: { 'files/*': ok } });
		const loose = page.getByTestId('case-loose');
		await expect(loose.getByRole('heading', { level: 2 })).toHaveText(S.files_without_volume);
		await expect(loose).toContainText(S.files_without_volume_hint);
		const sug = loose.getByTestId('case-suggest');
		await expect(sug).toHaveCount(2);
		await expect(sug.nth(0)).toContainText('Похоже на продолжение т. 5/1: последний лист 312, этот файл начинается с 313. Подтвердить?');
		await expect(sug.nth(1)).toContainText('Похоже на продолжение одного из томов: Том 4, Том 5/1 — укажите том');
		await expect(sug.nth(1).getByRole('button', { name: S.file_confirm })).toHaveCount(0);
		await expect(loose).toContainText('заблокирован: файл больше предела антивируса — разделите том');
		await sug.nth(0).getByRole('button', { name: S.file_confirm }).click();
		await expect.poll(() => writes(calls)).toEqual(['PATCH /files/22']);
		expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ confirm_suggest: true });
		expect(calls.find((c) => c.method === 'PATCH')!.headers['x-ai-case']).toBe('1');
		// «Указать другой том» и «Указать том» открывают то же окно
		await sug.nth(1).getByRole('button', { name: S.file_attach }).click();
		await expect(dialog(page).getByRole('heading')).toHaveText(S.file_attach);
		await dialog(page).getByRole('button', { name: S.cancel }).click();
		const ecase = page.getByTestId('case-ecase');
		await expect(ecase.getByTestId('case-file')).toContainText('48 страниц · у всех страниц цифровой текст');
		await expect(ecase.locator('.pill')).toHaveText(S.ecase_state_ready);
	});

	test('«Действия» у файла: раскрытое не сбрасывается обновлением; указать том, изменить вид, убрать из тома', async ({ page }) => {
		const { calls } = await openSection(page, { section: 'volumes', data: processing, routes: { 'files/*': ok } });
		const file = page.getByTestId('case-volume').nth(0).getByTestId('case-file').first();
		await expect(page.getByTestId('case-file-panel')).toHaveCount(0);
		await file.getByTestId('case-file-actions').click();
		const panel = page.getByTestId('case-file-panel');
		await expect(panel.getByRole('button')).toHaveText([S.file_attach, S.file_kind_change, S.file_detach, S.history, S.remove_file]);
		await refresh(page);
		await page.waitForTimeout(300);
		await expect(panel).toBeVisible();
		// «Указать том»: пусто в обоих полях — ошибка под полями, окно остаётся
		await panel.getByRole('button', { name: S.file_attach }).click();
		const dlg = dialog(page);
		await dlg.getByRole('button', { name: S.save }).click();
		await expect(dlg.getByTestId('case-dialog-error')).toHaveText(`Не получилось: ${S.volume_not_set_hint}`);
		expect(writes(calls)).toEqual([]);
		await expect(dlg.locator('select option')).toHaveText([S.upload_continues_none, 'Том 4', 'Том 5/1']);
		await dlg.locator('select').selectOption({ label: 'Том 5/1' });
		await dlg.getByRole('button', { name: S.save }).click();
		await expect(dlg).toHaveCount(0);
		await expect(page.getByText(S.saved)).toBeVisible();
		expect(calls.filter((c) => c.method === 'PATCH').at(-1)!.body).toEqual({ continues_volume_id: 5 });
		// номер тома важнее продолжения
		await panel.getByRole('button', { name: S.file_attach }).click();
		await dlg.getByRole('textbox').fill(' 7 ');
		await dlg.locator('select').selectOption({ label: 'Том 4' });
		await dlg.getByRole('button', { name: S.save }).click();
		await expect(dlg).toHaveCount(0);
		expect(calls.filter((c) => c.method === 'PATCH').at(-1)!.body).toEqual({ label: '7' });
		// «Изменить вид»: стоит нынешний вид
		await panel.getByRole('button', { name: S.file_kind_change }).click();
		await expect(dlg.getByRole('radio', { name: S.upload_kind_volume })).toBeChecked();
		await dlg.getByRole('radio', { name: S.upload_kind_ecase }).check();
		await dlg.getByRole('button', { name: S.save }).click();
		await expect(dlg).toHaveCount(0);
		expect(calls.filter((c) => c.method === 'PATCH').at(-1)!.body).toEqual({ input_kind: 'e_case' });
		// «Убрать из тома» — без подтверждения
		await panel.getByRole('button', { name: S.file_detach }).click();
		await expect.poll(() => calls.filter((c) => c.method === 'PATCH').at(-1)!.body).toEqual({ detach: true });
	});

	test('«Убрать файл из дела» — своё окно подтверждения: Esc и «Отмена» ничего не делают, красная кнопка убирает', async ({ page }) => {
		const { calls } = await openSection(page, { section: 'volumes', data: processing, routes: { 'files/*': ok } });
		await page.getByTestId('case-file-actions').first().click();
		let asked = 0;
		page.on('dialog', (d) => { asked += 1; void d.dismiss(); });
		const remove = page.getByTestId('case-file-panel').getByRole('button', { name: S.remove_file });
		await remove.click();
		const dlg = dialog(page);
		await expect(dlg).toContainText('и его листы уберутся из поиска и описи');
		await page.keyboard.press('Escape');
		await expect(dlg).toHaveCount(0);
		await expect(remove).toBeFocused(); // фокус возвращается на кнопку, открывшую окно
		await remove.click();
		await dlg.getByRole('button', { name: S.cancel }).click();
		await expect(dlg).toHaveCount(0);
		expect(writes(calls)).toEqual([]);
		await remove.click();
		await dlg.getByRole('button', { name: S.remove_file }).click();
		await expect(dlg).toHaveCount(0);
		await expect(page.getByText(S.remove_file_done)).toBeVisible();
		expect(writes(calls)).toEqual(['DELETE /files/10']);
		expect(asked).toBe(0); // окон браузера нет
	});

	test('«Изменить номер тома»: пустой номер — ошибка в окне; отказ сервиса — его фразой; сохранение', async ({ page }) => {
		let refuse = true;
		const { calls } = await openSection(page, {
			section: 'volumes',
			data: processing,
			routes: { 'volumes/*': (r: any) => (refuse ? r.fulfill({ status: 409, json: { detail: 'том с таким номером уже есть' } }) : ok(r)) }
		});
		await page.getByTestId('case-volume-label').first().click();
		const dlg = dialog(page);
		await expect(dlg.getByRole('heading')).toHaveText(S.volume_edit_label_g);
		await expect(dlg.getByRole('textbox')).toHaveValue('4');
		await expect(dlg.getByRole('textbox')).toBeFocused();
		await dlg.getByRole('textbox').fill('');
		await dlg.getByRole('button', { name: S.save }).click();
		await expect(dlg.getByTestId('case-dialog-error')).toBeVisible();
		expect(writes(calls)).toEqual([]);
		await dlg.getByRole('textbox').fill('5/1');
		await page.keyboard.press('Enter');
		await expect(dlg.getByTestId('case-dialog-error')).toHaveText('Не получилось: том с таким номером уже есть');
		refuse = false;
		await dlg.getByRole('textbox').fill('6');
		await page.keyboard.press('Enter');
		await expect(dlg).toHaveCount(0);
		await expect(page.getByText(S.saved)).toBeVisible();
		expect(calls.filter((c) => c.method === 'PATCH').at(-1)).toMatchObject({ path: '/volumes/4', body: { label: '6' } });
	});

	test('«История правок»: строки словами сервиса, пометки, «Откатить» у последней правки; пусто; ошибка', async ({ page }) => {
		let mode: 'rows' | 'empty' | 'fail' = 'rows';
		const { calls } = await openSection(page, {
			section: 'volumes',
			data: processing,
			routes: {
				'edits?**': (r: any) => (mode === 'fail' ? r.fulfill({ status: 500, json: { detail: 'сбой сервиса' } }) : r.fulfill({ json: mode === 'rows' ? EDITS : { edits: [] } })),
				'edits/*/revert': ok
			}
		});
		const v = page.getByTestId('case-volume').nth(0);
		await v.getByRole('button', { name: S.history }).first().click();
		const dlg = dialog(page);
		await expect(dlg.getByRole('heading')).toHaveText(S.history_title);
		const rows = dlg.getByTestId('case-history-row');
		await expect(rows).toHaveCount(3);
		await expect(rows.nth(0)).toContainText('Том файла');
		await expect(rows.nth(0)).toContainText(/вы, 07\.12\.2025, \d\d:41: было «т\. 5\/1», стало «пусто»/);
		await expect(rows.nth(1).locator('.pill')).toHaveText(S.history_reverted);
		await expect(rows.nth(2).locator('.pill')).toHaveText(S.history_revert_of);
		await expect(dlg.getByRole('button', { name: S.revert })).toHaveCount(1);
		await expect(dlg.getByRole('button', { name: S.save })).toHaveCount(0);
		expect(calls.some((c) => c.path === '/edits?entity=volume&id=4')).toBe(true);
		await dlg.getByRole('button', { name: S.revert }).click();
		await expect(dlg).toHaveCount(0);
		await expect(page.getByText(S.revert_done)).toBeVisible();
		expect(writes(calls)).toEqual(['POST /edits/31/revert']);
		mode = 'empty';
		await page.getByTestId('case-file-actions').first().click();
		await page.getByTestId('case-file-panel').getByRole('button', { name: S.history }).click();
		await expect(dlg.getByTestId('case-history-empty')).toHaveText(S.history_empty);
		expect(calls.some((c) => c.path === '/edits?entity=file&id=10')).toBe(true);
		await dlg.getByRole('button', { name: S.close }).click();
		mode = 'fail';
		await v.getByRole('button', { name: S.history }).first().click();
		await expect(dlg.getByRole('alert')).toHaveText('сбой сервиса');
	});

	test('«только чтение»: ни одной кнопки записи — только «История»', async ({ page }) => {
		const { calls } = await openSection(page, { section: 'volumes', data: processing, boot: { can_write: false, is_owner: false } });
		await expect(page.getByTestId('case-volume')).toHaveCount(2);
		for (const b of await page.getByTestId('case-file-actions').all()) await b.click();
		const names = await page.locator('main button:visible').allTextContents();
		const allowed = new Set([S.history, S.file_actions, S.goto_open]);
		expect(names.map((n) => n.trim()).filter((n) => n && !allowed.has(n))).toEqual([]);
		await expect(page.getByTestId('case-suggest').getByRole('button')).toHaveCount(0);
		expect(writes(calls)).toEqual([]);
	});

	test('томов и файлов нет: «Томов пока нет» и ссылка в «Загрузить материалы»', async ({ page }) => {
		const d = fixture('case-overview');
		await openSection(page, { section: 'volumes', data: () => ({ ...d, overview: { ...d.overview, volumes: [], files_without_volume: [], e_case: [] }, files: {} }) });
		await expect(page.getByTestId('case-volumes-empty')).toContainText(S.volumes_empty_g);
		await expect(page.getByTestId('case-volumes-empty').getByRole('link')).toHaveAttribute('href', /s=upload|\/upload$/);
	});
});

test.describe('«Тома», телефон 360', () => {
	test.use({ viewport: { width: 360, height: 800 } });

	test('без прокрутки вбок, окно по ширине экрана, нажимаемое не ниже 44 px', async ({ page }) => {
		await openSection(page, { section: 'volumes', data: processing, dark: true });
		await page.getByTestId('case-file-actions').first().click();
		await noSideScroll(page);
		const low = await page.locator('main button:visible, main a.btn:visible').evaluateAll((list) =>
			list.map((e) => [e.textContent!.trim(), Math.round(e.getBoundingClientRect().height)] as const).filter(([, h]) => h < 44)
		);
		expect(low).toEqual([]);
		await page.getByTestId('case-volume-label').first().click();
		const box = await dialog(page).boundingBox();
		expect(box!.width).toBeGreaterThanOrEqual(330);
		expect(await dialog(page).getByRole('textbox').evaluate((e) => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
		await page.keyboard.press('Escape');
		await expect(dialog(page)).toHaveCount(0);
		await noSideScroll(page);
	});
});
