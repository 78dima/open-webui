// ai-dvokat: проверки просмотрщика листа (`SheetView`), разрешения ссылки (`/ref`, `RefResolve`, `GotoForm`)
// и сохранения `<CasePage>` при SPA-переходе «раздел с идущей загрузкой → лист → назад».
import { test, expect, type Page, type Route } from '@playwright/test';
import { API, F, S, dialog, fixture, openSection, processing } from './casekit';

const PNG_1X1 = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=',
	'base64'
);

type SheetMock = Record<string, any>;

function makeSheet(overrides: SheetMock = {}): SheetMock {
	return {
		page_id: 645,
		label: 'т. 4, л.д. 16',
		volume_id: 4,
		volume_label: '4',
		file_id: 10,
		filename: 'tom-4.pdf',
		page_no: 16,
		removed: false,
		read_id: 42,
		accepted_read_id: 42,
		text: '📄 Первая строка\r\nДоговор 😀 № 817 от 12.03.2025',
		// В кодовых точках нормализованного текста:
		// '📄 Первая строка\n' = 16 cp ('📄'=1, ' Первая строка\n'=15)
		// 'Договор' = [16, 23]
		// ' 😀 ' = 3 cp -> 26
		// '№ 817' = [26, 31]
		hl: [26, 31],
		edited_spans: [[16, 23]],
		number_as_written: '16',
		side: 'face',
		doc_title: 'Договор поставки № 817',
		prev: 644,
		next: 646,
		boxes: [[0.1, 0.2, 0.5, 0.3]],
		text_editable: true,
		places: [
			{ start: 26, end: 31, a: '№ 817', b: '№ 811', shown: [26, 31] }
		],
		can_write: true,
		case_title: 'Северный ветер — поставка',
		volumes: ['4', '5/1'],
		...overrides
	};
}

async function openStandalone(
	page: Page,
	url: string,
	routes: Record<string, unknown | ((route: Route) => unknown)> = {}
) {
	await page.addInitScript(() => {
		localStorage.setItem('token', 'session-token');
		(window as any).__copied = [];
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: {
				writeText: async (text: string) => {
					(window as any).__copied.push(text);
				}
			}
		});
	});
	await page.route('**/legal-tools/api/cases/ui.json', (r) => r.fulfill({ json: { strings: S } }));
	await page.route(`**${API}/pages/*/image*`, (r) =>
		r.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 })
	);
	for (const [pattern, answer] of Object.entries(routes)) {
		await page.route(`**${API}/${pattern}`, (r) =>
			typeof answer === 'function' ? (answer as (route: Route) => unknown)(r) : r.fulfill({ json: answer })
		);
	}
	await page.goto(url);
	await page.waitForFunction(() => typeof (window as any).setConfig === 'function');
	await page.evaluate(() => (window as any).setConfig({ custom_ui: { case: true } }));
}

test.describe('просмотрщик листа (SheetView)', () => {
	test.use({ viewport: { width: 1280, height: 1000 } });

	test('подсветка #hl и .ed с \\r\\n и эмодзи, вкладки Текст/Изображение, стрелки prev/next и клавиатура, копирование ссылки и цитаты', async ({
		page
	}) => {
		const pages: Record<string, SheetMock> = {
			'645': makeSheet(),
			'644': makeSheet({ page_id: 644, label: 'т. 4, л.д. 15', prev: null, next: 645, text: 'Предыдущий лист', hl: null, edited_spans: [] }),
			'646': makeSheet({ page_id: 646, label: 'т. 4, л.д. 17', prev: 645, next: null, text: 'Следующий лист', hl: null, edited_spans: [] })
		};
		await openStandalone(page, `/?casesheet=${F}&p=645`, {
			'pages/*': (r: Route) => {
				const pid = new URL(r.request().url()).pathname.split('/').pop()!;
				return r.fulfill({ json: pages[pid] ?? makeSheet({ page_id: Number(pid) }) });
			}
		});

		await expect(page.getByTestId('case-sheet')).toBeVisible();
		await expect(page.locator('#sheet-label')).toHaveText('т. 4, л.д. 16');

		// Нормализация \r\n и перевод кодовых точек при эмодзи 📄 и 😀
		await expect(page.locator('#sheet-text #hl')).toHaveText('№ 817');
		await expect(page.locator('#sheet-text mark.ed')).toHaveText('Договор');
		expect(await page.locator('#sheet-text').evaluate((el) => el.textContent)).toBe(
			'📄 Первая строка\nДоговор 😀 № 817 от 12.03.2025'
		);

		// Переключение вкладок Текст / Изображение (видимы на узком экране <= 720px)
		await page.setViewportSize({ width: 360, height: 800 });
		const tabImg = page.getByRole('button', { name: S.sheet_tab_image });
		const tabText = page.getByRole('button', { name: S.sheet_tab_text });
		await tabImg.click();
		await expect(tabImg).toHaveAttribute('aria-pressed', 'true');
		await expect(page.getByTestId('case-sheet')).toHaveClass(/\bt-img\b/);
		await tabText.click();
		await expect(tabText).toHaveAttribute('aria-pressed', 'true');
		await expect(page.getByTestId('case-sheet')).toHaveClass(/\bt-text\b/);
		await page.setViewportSize({ width: 1280, height: 1000 });

		// Копирование ссылки на лист (без выделения)
		await page.getByTestId('sheet-copy').click();
		await expect.poll(() => page.evaluate(() => (window as any).__copied.length)).toBe(1);
		const linkCopy: string = await page.evaluate(() => (window as any).__copied[0]);
		expect(linkCopy).toContain(`т. 4, л.д. 16 `);
		expect(linkCopy).toContain(`/case/${F}/p/645`);
		expect(linkCopy).not.toContain('hl=');

		// Выделение текста и копирование цитаты со ссылкой
		await page.evaluate(() => {
			const tn = document.querySelector('#sheet-text #hl')!.firstChild as Text;
			const range = document.createRange();
			range.setStart(tn, 0);
			range.setEnd(tn, tn.data.length);
			const sel = window.getSelection()!;
			sel.removeAllRanges();
			sel.addRange(range);
			document.dispatchEvent(new Event('selectionchange'));
		});
		await expect(page.getByTestId('sheet-copy')).toHaveText(S.sheet_copy_quote);
		await page.getByTestId('sheet-copy').click();
		await expect.poll(() => page.evaluate(() => (window as any).__copied.length)).toBe(2);
		const quoteCopy: string = await page.evaluate(() => (window as any).__copied[1]);
		expect(quoteCopy).toContain('«№ 817» (т. 4, л.д. 16)');
		expect(quoteCopy).toContain(`/case/${F}/p/645?v=42&hl=`);

		// Стрелки prev/next и клавиатура ArrowRight / ArrowLeft
		await expect(page.locator('.head a[rel="prev"]')).toHaveAttribute('href', `/case/${F}/p/644`);
		await expect(page.locator('.head a[rel="next"]')).toHaveAttribute('href', `/case/${F}/p/646`);
		await page.keyboard.press('ArrowRight');
		await expect(page.locator('#sheet-label')).toHaveText('т. 4, л.д. 17');
		await page.keyboard.press('ArrowLeft');
		await expect(page.locator('#sheet-label')).toHaveText('т. 4, л.д. 16');
		await page.locator('.head a[rel="prev"]').click();
		await expect(page.locator('#sheet-label')).toHaveText('т. 4, л.д. 15');
	});

	test('pick=1, maxlength=2000, сохранение правки текста и номера листа, откат через HistoryDialog с ровно одним тостом «Откачено»', async ({
		page
	}) => {
		let sheetData = makeSheet();
		const textEdits: any[] = [];
		const numberEdits: any[] = [];
		const reverts: string[] = [];

		await openStandalone(page, `/?casesheet=${F}&p=645&v=42&hl=26-31&pick=1`, {
			'pages/645**': (r: Route) => {
				const m = r.request().method();
				const pathname = new URL(r.request().url()).pathname;
				if (pathname.endsWith('/image')) {
					return r.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 });
				}
				if (m === 'POST' && pathname.endsWith('/text')) {
					const body = r.request().postDataJSON();
					textEdits.push(body);
					sheetData = makeSheet({
						text: '📄 Первая строка\nДоговор 😀 № 811 от 12.03.2025',
						hl: null,
						edited_spans: [[26, 31]],
						places: []
					});
					return r.fulfill({ json: { ok: true } });
				}
				if (m === 'PATCH') {
					const body = r.request().postDataJSON();
					numberEdits.push(body);
					sheetData = { ...sheetData, number_as_written: body.number_as_written, side: body.side, label: `т. 4, л.д. ${body.number_as_written}` };
					return r.fulfill({ json: { ok: true } });
				}
				return r.fulfill({ json: sheetData });
			},
			'edits?*': {
				edits: [
					{
						id: 77,
						entity: 'page',
						entity_id: 645,
						field: 'text',
						field_text: 'Текст листа',
						before_text: '№ 817',
						after_text: '№ 811',
						who: 'вы',
						at: '2026-11-26T10:00:00Z',
						can_revert: true
					}
				]
			},
			'edits/*/revert': (r: Route) => {
				reverts.push(new URL(r.request().url()).pathname);
				return r.fulfill({ json: { ok: true } });
			}
		});

		// pick=1 раскрывает форму правки текста и помечает место расхождения #sheet-text-pick
		await expect(page.locator('#sheet-text-edit')).toHaveAttribute('open', '');
		await expect(page.locator('#sheet-text-pick')).toBeVisible();
		await expect(page.locator('#sheet-text-edit textarea[name="text"]')).toHaveAttribute('maxlength', '2000');

		// Клик по месту расхождения выделяет фрагмент в тексте листа
		await page.locator('#sheet-text-pick .place-btn').click();
		const selectedText = await page.evaluate(() => window.getSelection()?.toString() ?? '');
		expect(selectedText).toBe('№ 817');

		// Сохранение правки текста (POST .../text)
		await page.locator('#sheet-text-pick').getByRole('button', { name: 'Верно «№ 811»' }).click();
		await expect.poll(() => textEdits.length).toBe(1);
		expect(textEdits[0]).toMatchObject({ start: 26, end: 31, before: '№ 817', after: '№ 811', how: 'choice', read_id: 42 });
		await expect(page.locator('#sheet-text')).toContainText('№ 811');

		// Сохранение номера листа (PATCH .../pages/645)
		await page.locator('#sheet-edit input[name="number"]').fill('16а');
		await page.locator('#sheet-edit select[name="side"]').selectOption('back');
		await page.locator('#sheet-edit button[type="submit"]').click();
		await expect.poll(() => numberEdits.length).toBe(1);
		expect(numberEdits[0]).toEqual({ number_as_written: '16а', side: 'back' });
		await expect(page.locator('#sheet-label')).toHaveText('т. 4, л.д. 16а');

		// Откат через HistoryDialog — ровно один тост «Откачено»
		await page.locator('#sheet-edit').getByRole('button', { name: S.history }).click();
		const hist = dialog(page);
		await expect(hist.getByTestId('case-history-row')).toHaveCount(1);
		await hist.getByTestId('case-history-revert').click();
		await expect.poll(() => reverts.length).toBe(1);
		await expect(hist).toHaveCount(0);
		await expect(page.locator('[data-sonner-toast]', { hasText: S.revert_done })).toHaveCount(1);
	});

	test('состояние удалённого листа со ссылкой на заменяющий лист', async ({ page }) => {
		await openStandalone(page, `/?casesheet=${F}&p=645`, {
			'pages/645*': makeSheet({
				removed: true,
				removed_text: 'Лист убран из дела',
				removed_facts: {
					by: 'replaced',
					label: 'т. 4, л.д. 16',
					filename: 'tom-4-old.pdf',
					new_filename: 'tom-4-new.pdf',
					same: [{ page_id: 901, label: 'т. 4, л.д. 16', filename: 'tom-4-new.pdf' }]
				}
			})
		});

		const removed = page.getByTestId('sheet-removed');
		await expect(removed).toBeVisible();
		await expect(removed).toContainText('Лист убран из дела');
		await expect(removed.locator('a[data-same-sheet]')).toHaveAttribute('href', `/case/${F}/p/901`);
	});
});

test.describe('разрешение ссылки (/ref, RefResolve и GotoForm)', () => {
	test.use({ viewport: { width: 1280, height: 900 } });

	test('not_found (0) и GotoForm с пробелами «5 / 1» находит канонический том «5/1»', async ({ page }) => {
		await openStandalone(page, `/?caseref=${F}&t=${encodeURIComponent('5 / 1')}&l=99`, {
			'ref*': {
				status: 'not_found',
				case_title: 'Северный ветер — поставка',
				asked: 'т. 5 / 1, л.д. 99',
				why: 'В томе 5/1 нет листа 99.',
				links: [{ page_id: 645, label: 'т. 4, л.д. 16' }],
				volumes: ['4', '5/1']
			}
		});

		await expect(page.getByTestId('ref-not-found')).toContainText('В томе 5/1 нет листа 99.');
		await expect(page.getByTestId('ref-not-found').getByRole('link')).toHaveAttribute('href', `/case/${F}/p/645`);
		// GotoForm сопоставил "5 / 1" с каноническим "5/1", а не сбросил в volumes[0] ("4")
		await expect(page.getByTestId('case-goto').locator('select[name="t"]')).toHaveValue('5/1');
	});

	test('many (>1): список вариантов со ссылками на листы', async ({ page }) => {
		await openStandalone(page, `/?caseref=${F}&t=4&l=16`, {
			'ref*': {
				status: 'many',
				case_title: 'Северный ветер — поставка',
				asked: 'т. 4, л.д. 16',
				variants: [
					{ page_id: 645, label: 'т. 4, л.д. 16', how: 'duplicate', page_no: 16, filename: 'tom-4.pdf' },
					{ page_id: 649, label: 'т. 4, л.д. 16', how: 'back', page_no: 17, filename: 'tom-4.pdf' }
				],
				volumes: ['4', '5/1']
			}
		});

		await expect(page.getByTestId('ref-many')).toHaveText(S.ref_many_g);
		const variants = page.getByTestId('ref-variant');
		await expect(variants).toHaveCount(2);
		await expect(variants.nth(0)).toHaveAttribute('href', `/case/${F}/p/645`);
		await expect(variants.nth(1)).toHaveAttribute('href', `/case/${F}/p/649`);
	});

	test('found (1): одиночный переход вызывает goto на лист', async ({ page }) => {
		await openStandalone(page, `/?caseref=${F}&t=4&l=16`, {
			'ref*': { status: 'found', page_id: 645 },
			'pages/645*': makeSheet()
		});

		await expect.poll(() => page.evaluate(() => (window as any).__goto)).toContain(`/case/${F}/p/645`);
		await expect(page.getByTestId('case-sheet')).toBeVisible();
		await expect(page.locator('#sheet-label')).toHaveText('т. 4, л.д. 16');
	});
});

test.describe('переход с идущей загрузкой тома → лист → назад', () => {
	test.use({ viewport: { width: 1280, height: 1000 } });

	test('скрытый CasePage не размонтируется, не сбивается на overview и завершает загрузку без обрыва', async ({
		page
	}) => {
		let releasePart2: (() => void) | null = null;
		let uploadCompleted = false;
		const uploadLog: string[] = [];

		const { overviewCalls } = await openSection(page, {
			section: 'upload',
			data: processing,
			routes: {
				'pages/629*': makeSheet({ page_id: 629, label: 'т. 4, л.д. 1', text: 'Первый лист тома 4', hl: null, edited_spans: [] }),
				'pages/*/image*': (r: Route) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 }),
				'uploads**': async (r: Route) => {
					const url = new URL(r.request().url());
					const method = r.request().method();
					const tail = url.pathname.split('/uploads')[1] ?? '';
					uploadLog.push(`${method} ${tail}`);
					if (method === 'POST' && !tail) {
						const b = r.request().postDataJSON();
						return r.fulfill({
							status: 201,
							json: {
								upload: {
									id: b.filename,
									filename: b.filename,
									size: b.size,
									received: 0,
									part_size: 400,
									parts: [],
									status: 'receiving',
									phase: 'receiving'
								}
							}
						});
					}
					if (method === 'PUT' && tail.includes('/parts/2')) {
						await new Promise<void>((resolve) => {
							releasePart2 = resolve;
						});
					}
					if (method === 'POST' && tail.endsWith('/complete')) {
						uploadCompleted = true;
					}
					return r.fulfill({ json: { ok: true } });
				}
			}
		});

		// Запускаем медленную загрузку файла и удерживаем part 2 в полёте
		await page
			.getByTestId('case-pick-files')
			.setInputFiles([{ name: 'slow.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(1000) }]);
		await page.getByTestId('case-upload-start').click();
		await expect(page.getByTestId('case-upload').first()).toHaveAttribute('data-state', 'running');
		await expect.poll(() => releasePart2 !== null).toBe(true);

		// Переходим в раздел «Тома» (там есть SPA-ссылка на лист /case/<F>/p/629)
		await page.getByTestId('case-nav-volumes').click();
		await expect(page.getByTestId('case-volume')).toHaveCount(2);
		await expect(page.getByTestId('case-nav-volumes')).toHaveAttribute('aria-current', 'page');
		const overviewBeforeSheet = overviewCalls();

		// Помечаем DOM-узел CasePage, чтобы убедиться, что он не пересоздался при уходе на лист и обратно
		await page.evaluate(() => {
			(document.querySelector('[data-testid="case-page"]') as any).__keepAliveMarker = 'alive-1';
		});

		// Переходим на лист по SPA-ссылке из раздела Тома
		await page.getByTestId('case-volume-source').first().getByRole('link').click();
		await expect(page.getByTestId('case-sheet')).toBeVisible();
		await expect(page.locator('#sheet-label')).toHaveText('т. 4, л.д. 1');

		// Скрытый CasePage остался смонтированным и не сбросился на overview
		await expect(page.getByTestId('harness-case-wrap')).toHaveAttribute('hidden', '');
		expect(
			await page.evaluate(() => (document.querySelector('[data-testid="case-page"]') as any)?.__keepAliveMarker)
		).toBe('alive-1');
		await expect(page.getByTestId('case-nav-volumes')).toHaveAttribute('aria-current', 'page');
		expect(overviewCalls()).toBe(overviewBeforeSheet);

		// Отпускаем удерживаемый upload-запрос прямо пока открыт лист — загрузка завершается в фоне
		releasePart2!();
		await expect.poll(() => uploadCompleted).toBe(true);
		expect(uploadLog.some((x) => x.startsWith('POST /slow.jpg/complete'))).toBe(true);

		// Возвращаемся назад по истории браузера: снова видим «Тома» и тот же экземпляр CasePage
		await page.goBack();
		await expect(page.getByTestId('case-sheet')).toHaveCount(0);
		await expect(page.getByTestId('case-volume').first()).toBeVisible();
		await expect(page.getByTestId('case-nav-volumes')).toHaveAttribute('aria-current', 'page');
		expect(
			await page.evaluate(() => (document.querySelector('[data-testid="case-page"]') as any)?.__keepAliveMarker)
		).toBe('alive-1');

		// Открываем «Загрузить материалы» — файл успешно дошёл до состояния «Загружено»
		await page.getByTestId('case-nav-upload').click();
		await expect(page.getByTestId('case-upload').filter({ hasText: 'slow.jpg' })).toContainText(S.upload_done);
	});
});
