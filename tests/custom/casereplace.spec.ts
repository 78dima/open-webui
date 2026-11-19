// ai-dvokat: разделы «Замена тома» и «Выписка листов» на стенде компонентов (макеты K-replace, K-extract; опись § 2.12).
import { test, expect } from '@playwright/test';
import { F, S, dialog, fixture, noSideScroll, openSection, refresh, writes } from './casekit';

const deltas = () => fixture('deltas');

test.describe('«Замена тома», 1280', () => {
	test.use({ viewport: { width: 1280, height: 1100 } });

	test('чем новый файл отличается от прежнего: плитки счёта, листы ссылками, места расхождений, «возможно, распознавание» свёрнуто', async ({ page }) => {
		const { calls } = await openSection(page, { section: 'replace', routes: { deltas: deltas() } });
		await expect(page.getByText(S.replace_hint)).toBeVisible();
		const d = page.getByTestId('case-delta');
		await expect(d.getByRole('heading', { level: 2 })).toHaveText('Том 4: новый файл вместо прежнего');
		await expect(d).toContainText('tom-4-pereskan.pdf против прежнего tom-4.pdf');
		await expect(d).toContainText('тех же листов: 201; в прежнем файле 209, в новом 212');
		const src = deltas().deltas[0];
		await expect(d.getByTestId('case-delta-tiles').locator('.v')).toHaveText(
			[src.same, src.added.length, src.removed.length, src.changed.length, src.unsure.length + src.blind.length].map(String)
		);
		await expect(d.getByTestId('case-delta-added').getByRole('heading')).toHaveText(`Добавлены: ${src.added.length}`);
		await expect(d.getByTestId('case-delta-added').getByRole('link').first()).toHaveAttribute('href', `/legal-tools/case/${F}/p/${src.added[0].page_id}`);
		await expect(d.getByTestId('case-delta-removed')).toContainText(S.replace_removed_note);
		const changed = d.getByTestId('case-delta-changed');
		await expect(changed).toContainText(S.replace_changed_note);
		await expect(changed).toContainText('мест: 1, из них в числах: 1; возможно, распознавание: 0');
		await expect(changed.getByRole('link', { name: 'место 1' })).toHaveAttribute('href', /\/p\/\d+\?hl=\d+-\d+$/);
		await expect(d.getByTestId('case-delta-blind').locator('.pill')).toHaveText(S.replace_blind_pill);
		const noise = d.getByTestId('case-delta-noise');
		await expect(noise.getByRole('heading')).toHaveText('Возможно, распознавание: 4 листа');
		await expect(noise.getByRole('link')).toHaveCount(0);
		await noise.getByRole('button', { name: S.expand }).click();
		await expect(noise.getByRole('link')).toHaveCount(src.noisy.length);
		// раздел перечитывается вместе с обзором; раскрытое при этом остаётся
		const before = calls.filter((c) => c.path === '/deltas').length;
		await refresh(page);
		await expect.poll(() => calls.filter((c) => c.path === '/deltas').length).toBeGreaterThan(before);
		await expect(noise.getByRole('link')).toHaveCount(src.noisy.length);
		await expect(d).toContainText('у 3 листов одно прочтение');
	});

	test('«Заменить файл тома» — своё окно с фактами сверки; отказ сервиса — в окне; после замены — сообщение и перечитывание', async ({ page }) => {
		let refuse = true;
		let replaced = false;
		const { calls } = await openSection(page, {
			section: 'replace',
			routes: {
				deltas: (r: any) => {
					const d = deltas();
					if (replaced) Object.assign(d.deltas[0], { replaced_at: '2025-12-07T09:41:00Z', replaced_by_name: 'Лебедева А. В.' });
					return r.fulfill({ json: d });
				},
				'deltas/1/replace': (r: any) => {
					if (refuse) return r.fulfill({ status: 409, json: { detail: S.whatsnew_err_changed ?? 'файлы сверки изменились — обновите страницу дела' } });
					replaced = true;
					return r.fulfill({ json: { ok: true } });
				}
			}
		});
		let asked = 0;
		page.on('dialog', (d) => { asked += 1; void d.dismiss(); });
		await page.getByTestId('case-replace').click();
		const dlg = dialog(page);
		await expect(dlg.getByRole('heading')).toHaveText(S.replace_confirm_title);
		await expect(dlg).toContainText('Файл «tom-4-pereskan.pdf» встанет на место «tom-4.pdf» в томе.');
		await expect(dlg).toContainText('Совпали по тексту: 201; изменены: 1; не сверены (второго прочтения нет): 1.');
		await expect(dlg).toContainText('Листы прежнего файла, не найденные в новом: 1 (т. 4, файл «tom-4.pdf», стр. 117). После замены их в деле не будет.');
		await expect(dlg).toContainText('тот ли это лист — не подтверждено: 1');
		await expect(dlg).toContainText('В описи прежнего файла есть ваши правки: 2.');
		await page.keyboard.press('Escape');
		await expect(dlg).toHaveCount(0);
		expect(writes(calls)).toEqual([]);
		await page.getByTestId('case-replace').click();
		await dlg.getByRole('button', { name: S.whatsnew_replace }).click();
		await expect(dlg.getByTestId('case-dialog-error')).toContainText('Не получилось: файлы сверки изменились');
		refuse = false;
		await dlg.getByRole('button', { name: S.whatsnew_replace }).click();
		await expect(dlg).toHaveCount(0);
		await expect(page.getByText(S.whatsnew_replace_done)).toBeVisible();
		await expect(page.getByTestId('case-delta-replaced')).toContainText(/Заменён 07\.12\.2025, \d\d:41 Лебедева А\. В\./);
		await expect(page.getByTestId('case-replace')).toHaveCount(0);
		// у заменённого прежние листы — без ссылок (их в деле уже нет)
		await expect(page.getByTestId('case-delta-removed').getByRole('link')).toHaveCount(0);
		expect(writes(calls)).toEqual(['POST /deltas/1/replace', 'POST /deltas/1/replace']);
		expect(asked).toBe(0);
	});

	test('заменить нельзя — сказано почему; «только чтение» кнопки не видит; пусто; ошибка и «Повторить»', async ({ page }) => {
		let mode: 'not_same' | 'empty' | 'fail' = 'not_same';
		await openSection(page, {
			section: 'replace',
			boot: { can_write: false, is_owner: false },
			routes: {
				deltas: (r: any) => {
					if (mode === 'fail') return r.fulfill({ status: 500, json: { detail: 'сбой сервиса' } });
					if (mode === 'empty') return r.fulfill({ json: fixture('deltas-empty') });
					const d = deltas();
					d.deltas.push({ ...d.deltas[0], id: 2, replaceable: false });
					return r.fulfill({ json: d });
				}
			}
		});
		await expect(page.getByTestId('case-delta')).toHaveCount(2);
		await expect(page.getByTestId('case-replace')).toHaveCount(0); // право «только чтение»
		await expect(page.getByTestId('case-delta').nth(1).getByTestId('case-delta-not-same')).toHaveText(S.whatsnew_not_same);
		mode = 'empty';
		await refresh(page);
		await expect(page.getByTestId('case-replace-empty')).toHaveText(S.whatsnew_empty);
	});

	test('раздел не пришёл: ошибка фразой сервиса и «Повторить»', async ({ page }) => {
		let fail = true;
		await openSection(page, { section: 'replace', routes: { deltas: (r: any) => (fail ? r.fulfill({ status: 500, json: { detail: 'сбой сервиса' } }) : r.fulfill({ json: deltas() })) } });
		await expect(page.getByTestId('case-replace-error')).toContainText('Не получилось: сбой сервиса');
		fail = false;
		await page.getByTestId('case-replace-error').getByRole('button', { name: S.retry }).click();
		await expect(page.getByTestId('case-delta')).toHaveCount(1);
	});
});

test.describe('«Выписка листов»', () => {
	test.use({ viewport: { width: 1280, height: 900 } });

	test('записи через точку с запятой уходят отдельными ref; файл скачивается под именем сервиса', async ({ page }) => {
		const { calls } = await openSection(page, {
			section: 'extract',
			routes: {
				'extract.pdf?**': (r: any) =>
					r.fulfill({
						status: 200,
						contentType: 'application/pdf',
						headers: { 'Content-Disposition': `attachment; filename="extract.pdf"; filename*=UTF-8''${encodeURIComponent('Выписка т. 4, л.д. 148–160.pdf')}` },
						body: '%PDF-1.4 выписка'
					})
			}
		});
		const box = page.getByTestId('case-extract');
		await expect(box).toContainText(S.extract_hint);
		await expect(box).toContainText(S.extract_examples);
		await box.getByRole('textbox', { name: S.extract_label }).fill('т. 4, л.д. 148–160; т. 4, л.д. 16 об. ;');
		const download = page.waitForEvent('download');
		await box.getByRole('button', { name: S.extract_submit }).click();
		expect((await download).suggestedFilename()).toBe('Выписка т. 4, л.д. 148–160.pdf');
		const call = calls.find((c) => c.path.startsWith('/extract.pdf'))!;
		expect(new URLSearchParams(call.path.split('?')[1]).getAll('ref')).toEqual(['т. 4, л.д. 148–160', 'т. 4, л.д. 16 об.']);
		expect(call.headers.authorization).toBe('Bearer session-token');
		await expect(page.getByTestId('case-extract-error')).toHaveCount(0);
	});

	test('отказ сервиса — его фразой под полем, поле помечено; правка поля убирает ошибку; пустое поле — подсказка', async ({ page }) => {
		const { calls } = await openSection(page, {
			section: 'extract',
			routes: { 'extract.pdf?**': (r: any) => r.fulfill({ status: 404, json: { detail: 'Листов по записи «т. 4, л.д. 612» в деле нет.' } }) }
		});
		const box = page.getByTestId('case-extract');
		const field = box.getByRole('textbox', { name: S.extract_label });
		await box.getByRole('button', { name: S.extract_submit }).click();
		await expect(page.getByTestId('case-extract-error')).toHaveText(S.extract_empty);
		expect(calls.filter((c) => c.path.startsWith('/extract.pdf'))).toHaveLength(0);
		await field.fill('т. 4, л.д. 612');
		await expect(page.getByTestId('case-extract-error')).toHaveCount(0);
		await page.keyboard.press('Enter');
		await expect(page.getByTestId('case-extract-error')).toHaveText('Листов по записи «т. 4, л.д. 612» в деле нет.');
		await expect(field).toHaveClass(/bad/);
		await expect(page.locator('.cg-toast, [data-sonner-toast]')).toHaveCount(0); // всплывающего сообщения нет
	});

	test('телефон 360: без прокрутки вбок, поле не меньше 16 px; «только чтение» выписку делает', async ({ page }) => {
		await page.setViewportSize({ width: 360, height: 800 });
		await openSection(page, { section: 'extract', boot: { can_write: false, is_owner: false }, dark: true });
		await noSideScroll(page);
		const field = page.getByTestId('case-extract').getByRole('textbox');
		expect(await field.evaluate((e) => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
		await expect(page.getByTestId('case-extract').getByRole('button', { name: S.extract_submit })).toBeEnabled();
	});
});

test('«Замена тома» на телефоне 360: без прокрутки вбок, тёмная схема', async ({ page }) => {
	await page.setViewportSize({ width: 360, height: 800 });
	await openSection(page, { section: 'replace', routes: { deltas: deltas() }, dark: true });
	await expect(page.getByTestId('case-delta')).toHaveCount(1);
	await noSideScroll(page);
	await page.getByTestId('case-replace').click();
	await expect(dialog(page)).toBeVisible();
	await noSideScroll(page);
});
