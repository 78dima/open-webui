// ai-dvokat: исправления по независимому ревью 20.11 (номера — как в отчёте ревью) на стенде компонентов: настоящие
// компоненты и стили, ручки сервиса подменены выдуманными данными. Каждая проверка держит своё исправление, чтобы оно
// не вернулось.
import { expect, test } from '@playwright/test';
import { F, S, dialog, fixture, noSideScroll, openSection, refresh, writes } from './casekit';

const ok = (r: any) => r.fulfill({ json: {} });
const fmt = (t: string, v: Record<string, unknown>) =>
	t.replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? String(v[k]) : m));
// FIX_SHOTS=<каталог> — снимки исправленных мест для просмотра глазами
const snap = async (page: any, name: string) => {
	if (process.env.FIX_SHOTS)
		await page.screenshot({ path: `${process.env.FIX_SHOTS}/${name}.png` });
};
const nav = (page: any, slug: string) =>
	page.locator(`nav.nav [data-testid="case-nav-${slug}"]`).first();

test.describe('ревью 20.11', () => {
	test.use({ viewport: { width: 1280, height: 900 } });

	test('1, 7: отказ без фразы сервиса — причина словами и «Повторить»; сбой перечитывания при прежних данных — сказано', async ({
		page
	}) => {
		let mode: 'html' | 'down' | 'ok' = 'html';
		await openSection(page, {
			section: 'amounts',
			routes: {
				amounts: (r: any) =>
					mode === 'html'
						? r.fulfill({ status: 502, contentType: 'text/html', body: '<html>Bad Gateway</html>' })
						: mode === 'down'
							? r.abort('internetdisconnected')
							: r.fulfill({ json: fixture('amounts') })
			}
		});
		// ответ не от сервиса (502 прокси, не JSON): раздел не висит на «Загрузка…», причина названа
		const error = page.getByTestId('case-amounts-error');
		await expect(error).toContainText(
			fmt(S.section_error, { detail: fmt(S.error_status, { status: 502 }) })
		);
		mode = 'down';
		await error.getByRole('button', { name: S.retry }).click();
		await expect(error).toContainText(fmt(S.section_error, { detail: S.error_no_link }));
		await snap(page, 'section-error');
		mode = 'ok';
		await error.getByRole('button', { name: S.retry }).click();
		await expect(page.getByTestId('case-amounts')).toBeVisible();
		await expect(page.getByTestId('case-stale')).toHaveCount(0);
		// 17: «Обновить» в шапке «Сумм»; 7: сбой перечитывания не проходит молча — прежние данные помечены
		mode = 'down';
		await page.getByTestId('case-map-refresh').click();
		const stale = page.getByTestId('case-stale');
		await expect(stale).toHaveText(
			new RegExp(fmt(S.section_stale, { detail: S.error_no_link }).slice(0, 40))
		);
		await expect(page.getByTestId('case-amounts')).toBeVisible();
		await snap(page, 'stale-note');
		mode = 'ok';
		await stale.getByRole('button', { name: S.retry }).click();
		await expect(stale).toHaveCount(0);
	});

	test('1: «История правок» при обрыве связи — причина и «Повторить», а не вечная «Загрузка…»; сообщение действия — с причиной', async ({
		page
	}) => {
		let down = true;
		await openSection(page, {
			section: 'volumes',
			routes: {
				'edits?**': (r: any) =>
					down ? r.abort('internetdisconnected') : r.fulfill({ json: { edits: [] } }),
				'volumes/*': (r: any) => r.abort('internetdisconnected')
			}
		});
		const v = page.getByTestId('case-volume').first();
		await v.getByRole('button', { name: S.history }).first().click();
		const dlg = dialog(page);
		await expect(dlg.getByRole('alert')).toHaveText(
			fmt(S.section_error, { detail: S.error_no_link })
		);
		down = false;
		await dlg.getByRole('button', { name: S.retry }).click();
		await expect(dlg.getByTestId('case-history-empty')).toBeVisible();
		await dlg.getByRole('button', { name: S.close }).click();
		// 26: пустой номер тома — понятный отказ про номер; обрыв связи при сохранении — причина в окне
		await v.getByRole('button', { name: S.volume_edit_label_g }).click();
		await dialog(page).getByRole('textbox').fill('  ');
		await dialog(page).getByRole('button', { name: S.save }).click();
		await expect(dialog(page).getByTestId('case-dialog-error')).toHaveText(
			fmt(S.error_generic, { detail: S.volume_number_needed })
		);
		await dialog(page).getByRole('textbox').fill('7');
		await dialog(page).getByRole('button', { name: S.save }).click();
		await expect(dialog(page).getByTestId('case-dialog-error')).toHaveText(
			fmt(S.error_generic, { detail: S.error_no_link })
		);
	});

	test('3: окно не закрывается нажатием на затемнение и протяжкой из поля — введённое остаётся', async ({
		page
	}) => {
		await openSection(page, {
			section: 'deadlines',
			routes: { 'deadlines**': fixture('deadlines') }
		});
		await page.getByTestId('case-deadline-add').click();
		const dlg = dialog(page);
		const title = dlg.getByRole('textbox').first();
		await title.fill('Отзыв на жалобу');
		await page.mouse.click(8, 8); // затемнение, мимо окна
		await expect(dlg).toHaveCount(1);
		// протяжка мыши из поля за край окна (выделение текста)
		const box = (await title.boundingBox())!;
		await page.mouse.move(box.x + 20, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(6, 6, { steps: 4 });
		await page.mouse.up();
		await expect(dlg).toHaveCount(1);
		await expect(title).toHaveValue('Отзыв на жалобу');
		// 24: обязательные поля проверяет браузер — пустая форма запросом не уходит; «Расчёт словами» — многострочный
		const sent: string[] = [];
		page.on('request', (r) => r.method() === 'POST' && sent.push(r.url()));
		await dlg.getByRole('button', { name: S.save }).click();
		await expect(dlg).toHaveCount(1);
		expect(sent).toEqual([]);
		expect(await dlg.locator('input:invalid, textarea:invalid').count()).toBe(2); // лист-основание и цитата
		expect(
			await dlg.getByPlaceholder(S.deadline_calc_placeholder).evaluate((el) => el.tagName)
		).toBe('TEXTAREA');
		await page.keyboard.press('Escape');
		await expect(dlg).toHaveCount(0);
	});

	test('25: «Убрать», «Вернуть», «Подтвердить» срок — обзор (счётчик меню) переспрашивается сразу', async ({
		page
	}) => {
		const kit = await openSection(page, {
			section: 'deadlines',
			routes: { 'deadlines**': fixture('deadlines') }
		});
		await page.getByTestId('case-deadline').first().waitFor();
		const before = kit.overviewCalls();
		await page
			.getByTestId('case-deadline')
			.first()
			.getByRole('button', { name: S.map_deadline_confirm })
			.click();
		await expect.poll(() => kit.overviewCalls()).toBeGreaterThan(before);
		expect(writes(kit.calls)).toEqual(['PATCH /deadlines/1']);
	});

	test('2, 29, 32: «Разделить» у документа из одного листа; отмеченное и отбор описи живут при уходе в другой раздел; порции без повторов', async ({
		page
	}) => {
		const docs = fixture('case-documents');
		// первый документ — из одного листа (лист 629 есть в листах тома); остальные — его подобия со своими номерами
		const all = Array.from({ length: 14 }, (_, n) => ({
			...docs.documents[0],
			id: 68 + n,
			...(n ? { first_page_id: 9000 + n, last_page_id: 9000 + n } : {})
		}));
		const first = { ...docs, documents: all.slice(0, 8), total: 14, end: false, next_page: 1 };
		// вторая порция повторяет две последние строки первой (состав сдвинулся) и даёт новые
		const second = { ...docs, documents: all.slice(6, 14), total: 14, end: true, next_page: null };
		const kit = await openSection(page, {
			section: 'inventory',
			routes: {
				'documents?**': (r: any, c: any) =>
					r.fulfill({ json: /page=1/.test(c.path) ? second : first }),
				'pages?**': fixture('case-pages'),
				facts: fixture('facts'),
				'facts?**': fixture('facts')
			}
		});
		const rows = page.getByTestId('case-doc');
		await expect(rows).toHaveCount(8);
		// 2: документ из одного листа (в счёте листов — 1): кнопка есть; делить нечем — так и сказано
		await expect(rows.first().getByRole('button', { name: S.doc_split })).toHaveCount(1);
		await rows.first().getByRole('button', { name: S.doc_split }).click();
		await expect(page.getByText(S.doc_split_at).last()).toBeVisible();
		// 32: «Показать ещё» — без повторов строк
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(String(e)));
		await page.getByRole('button', { name: /Показать ещё/ }).click();
		await expect(rows).toHaveCount(14);
		expect(
			new Set(await rows.evaluateAll((list) => list.map((x) => (x as HTMLElement).dataset.doc)))
				.size
		).toBe(14);
		// 29: отметки и показанные порции остаются, пока открыта страница дела
		await rows.nth(1).getByRole('checkbox').check();
		await rows.nth(2).getByRole('checkbox').check();
		const asked = kit.calls.filter((c) => c.path.startsWith('/documents')).length;
		await nav(page, 'chronology').click();
		await page.getByTestId('case-facts').waitFor();
		await nav(page, 'inventory').click();
		await expect(rows).toHaveCount(14);
		await expect(rows.nth(1).getByRole('checkbox')).toBeChecked();
		await expect(rows.nth(2).getByRole('checkbox')).toBeChecked();
		await expect(page.getByRole('button', { name: fmt(S.doc_merge_n, { n: 2 }) })).toBeVisible();
		expect(kit.calls.filter((c) => c.path.startsWith('/documents')).length).toBe(asked); // опись не перечитывалась
		expect(errors).toEqual([]);
	});

	test('13, 29, 32: хронология — период и «с убранными» держат блок раскрытым; отбор живёт при уходе; порции без повторов', async ({
		page
	}) => {
		const facts = fixture('facts');
		const more = {
			...facts,
			facts: [facts.facts[3], { ...facts.facts[0], id: 9001 }],
			next_page: null
		};
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(String(e)));
		const kit = await openSection(page, {
			section: 'chronology',
			routes: {
				facts: facts,
				'facts?**': (r: any, c: any) => r.fulfill({ json: /page=1/.test(c.path) ? more : facts }),
				amounts: fixture('amounts')
			}
		});
		const period = page.getByTestId('case-facts-period');
		await expect(period).toHaveCount(0);
		const toggle = page.getByRole('button', { name: S.map_filter_more });
		await toggle.click();
		await period.getByLabel(S.map_filter_from).fill('2025-01-01');
		await period.getByRole('checkbox').check();
		await page.getByRole('button', { name: S.map_find }).click();
		await expect
			.poll(() =>
				kit.calls.some((c) => /date_from=2025-01-01/.test(c.path) && /hidden=true/.test(c.path))
			)
			.toBe(true);
		// 13: свернуть нельзя, пока отбор действует, — признак остаётся на экране
		await toggle.click();
		await expect(period).toBeVisible();
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
		// 32: порция повторяет уже показанную запись — в списке она одна
		await page.getByTestId('case-facts-more').click();
		await expect(page.getByTestId('case-fact')).toHaveCount(5);
		expect(errors).toEqual([]);
		// 29: отбор остаётся при уходе в другой раздел и возвращении
		await page.getByPlaceholder(S.map_filter_words_g).fill('оплата');
		await page.getByRole('button', { name: S.map_find }).click();
		await nav(page, 'amounts').click();
		await page.getByTestId('case-amounts').waitFor();
		await nav(page, 'chronology').click();
		await expect(page.getByPlaceholder(S.map_filter_words_g)).toHaveValue('оплата');
		await expect(page.getByTestId('case-facts-period')).toBeVisible();
		await expect(page.getByTestId('case-facts-period').getByLabel(S.map_filter_from)).toHaveValue(
			'2025-01-01'
		);
		await expect
			.poll(() => kit.calls.filter((c) => /words=/.test(c.path)).length)
			.toBeGreaterThan(1); // вернулись с тем же отбором
	});

	test('4, 29: «Запустить» не нажимается, пока идёт оценка нового выбора; оценка не пришла — окно «оценки нет»; выбор живёт при уходе', async ({
		page
	}) => {
		let release: (() => void) | null = null;
		let failScope = false;
		const scope = (usd: number) => ({ ...fixture('tables-scope'), estimate_usd: usd });
		const kit = await openSection(page, {
			section: 'tables',
			routes: {
				tables: (r: any) =>
					r.request().method() === 'POST'
						? r.fulfill({ status: 201, json: {} })
						: r.fulfill({ json: fixture('tables-list') }),
				'tables/scope?**': async (r: any, c: any) => {
					if (failScope) return r.fulfill({ status: 503, contentType: 'text/html', body: 'нет' });
					if (/preset=positions/.test(c.path)) await new Promise<void>((res) => (release = res));
					return r.fulfill({ json: scope(/preset=positions/.test(c.path) ? 3.7 : 0.02) });
				},
				amounts: fixture('amounts')
			}
		});
		const form = page.getByTestId('case-tables-new');
		const start = page.getByTestId('case-tables-start');
		await expect(start).toHaveText(/около 0,02 USD/);
		// новый выбор: оценка ещё идёт — прежней цены на кнопке нет, кнопка не нажимается
		await form.getByRole('radio', { name: 'Позиции сторон' }).check();
		await expect(start).toBeDisabled();
		await expect(start).toHaveText(S.tables_start);
		expect(writes(kit.calls)).toEqual([]);
		await expect.poll(() => !!release).toBe(true);
		release!();
		await expect(start).toHaveText(/около 3,70 USD/);
		await expect(start).toBeEnabled();
		// 29: набор остаётся выбранным при уходе в другой раздел
		await nav(page, 'amounts').click();
		await page.getByTestId('case-amounts').waitFor();
		release = null;
		await nav(page, 'tables').click();
		await expect(form.getByRole('radio', { name: 'Позиции сторон' })).toBeChecked();
		await expect.poll(() => !!release).toBe(true);
		release!();
		// оценка не пришла: цена неизвестна — перед запуском своё окно с честной строкой, запуск — только из него
		failScope = true;
		await form.getByRole('radio', { name: 'Извещения' }).check();
		await expect(start).toBeEnabled();
		await expect(start).toHaveText(S.tables_start);
		await start.click();
		const dlg = dialog(page);
		await expect(dlg.getByTestId('case-tables-confirm-price')).toHaveText(S.runs_confirm_no_price);
		await snap(page, 'confirm-no-price');
		expect(writes(kit.calls)).toEqual([]);
		await dlg.getByRole('button', { name: S.cancel }).click();
		expect(writes(kit.calls)).toEqual([]);
		await start.click();
		await dialog(page).getByRole('button', { name: S.runs_start_no_price }).click();
		await expect.poll(() => writes(kit.calls)).toEqual(['POST /tables']);
	});

	test('14, 27, 19: «Дочитать по изменившимся листам» — окно с «оценки нет» и своим заголовком; у перечитывания — свой заголовок; цитата с переносами', async ({
		page
	}) => {
		const open = fixture('table-open');
		const stale = { ...open, sweep: { ...open.sweep, stale: true, finished: true, rest: null } };
		const kit = await openSection(page, {
			section: 'tables',
			item: stale.sweep.id,
			routes: {
				'tables/*?**': stale,
				'tables/*/catch-up**': (r: any) => r.fulfill({ status: 201, json: {} }),
				tables: fixture('tables-list'),
				'tables/scope?**': fixture('tables-scope')
			}
		});
		const action = page.getByTestId('case-table-action').filter({ hasText: S.tables_catch_up });
		await action.click();
		const dlg = dialog(page);
		await expect(dlg.getByRole('heading')).toHaveText(S.runs_confirm_catch_up_title);
		await expect(dlg.getByTestId('case-table-confirm-price')).toHaveText(S.runs_confirm_no_price);
		expect(writes(kit.calls)).toEqual([]); // без подтверждения платное действие не уходит
		await dlg.getByRole('button', { name: S.cancel }).click();
		expect(writes(kit.calls)).toEqual([]);
		// 19: цитата ячейки сохраняет переносы строк листа
		const cell = page
			.getByTestId('case-table-cell')
			.filter({ has: page.getByRole('button', { name: S.quote_toggle }) })
			.first();
		await cell.getByRole('button', { name: S.quote_toggle }).first().click();
		expect(
			await cell
				.locator('.q')
				.first()
				.evaluate((el) => getComputedStyle(el).whiteSpace)
		).toBe('pre-wrap');
	});

	test('27: дорогое перечитывание — окно «Перечитать таблицу?», дорогое дочитывание — «Дочитать таблицу?»', async ({
		page
	}) => {
		const base = fixture('table-reader-stale');
		let view: any = {
			...base,
			sweep: { ...base.sweep, reread: { ...base.sweep.reread, estimate_usd: 2.4 } }
		};
		await openSection(page, {
			section: 'tables',
			item: base.sweep.id,
			routes: {
				'tables/*?**': (r: any) => r.fulfill({ json: view }),
				tables: fixture('tables-list'),
				'tables/scope?**': fixture('tables-scope')
			}
		});
		await page.getByTestId('case-table-action').first().click();
		await expect(dialog(page).getByRole('heading')).toHaveText(S.runs_confirm_reread_title);
		await expect(dialog(page).getByTestId('case-table-confirm-price')).toHaveText(
			fmt(S.runs_confirm_price, { usd: '2,40' })
		);
		await dialog(page).getByRole('button', { name: S.cancel }).click();
		view = {
			...base,
			sweep: {
				...base.sweep,
				reader_stale: false,
				reread: null,
				status: 'partial',
				rest: {
					windows: 7,
					pages: 41,
					estimate_usd: 1.9,
					raise_to_usd: null,
					limit_usd: 3,
					spent_usd: 0.5
				}
			}
		};
		await page.reload();
		await page.evaluate(() => (window as any).setConfig({ custom_ui: { case: true } }));
		await page.getByTestId('case-table-action').first().click();
		await expect(dialog(page).getByRole('heading')).toHaveText(S.runs_confirm_resume_title);
	});

	test('16, 20: «История» у пустой «Роли клиента»; пауза обработки названа в «Загрузить материалы», «Томах» и «Таблицах»', async ({
		page
	}) => {
		const paused = () => ({
			...fixture('case-overview'),
			paused: { reason: 'budget', since: '2026-11-20T08:00:00Z', until: null }
		});
		await openSection(page, {
			section: 'passport',
			data: paused,
			routes: {
				tables: fixture('tables-list'),
				'tables/scope?**': fixture('tables-scope'),
				'edits?**': { edits: [] }
			}
		});
		const role = page.getByTestId('case-passport-about').locator('[data-field="client_role"]');
		await role.getByRole('button', { name: S.map_history }).click();
		await expect(dialog(page).getByRole('heading')).toHaveText(S.history_title);
		await dialog(page).getByRole('button', { name: S.close }).click();
		const words = fmt(S.paused_budget, { time: '' }).slice(1, 24);
		for (const slug of ['upload', 'volumes', 'tables']) {
			await nav(page, slug).click();
			await expect(page.getByTestId('case-paused-note')).toContainText(words);
			await snap(page, `pause-${slug}`);
		}
	});

	test('21: один заблокированный файл электронного дела не делает «не обработанной» всю строку «Электронное дело»', async ({
		page
	}) => {
		const data = () => {
			const d = fixture('case-overview');
			d.overview.e_case = [
				{ file_id: 9900, label: 'ecase-kad.pdf', pages: 48, court_inventory: null },
				{ file_id: 9901, label: 'ecase-otzyv.pdf', pages: 3, court_inventory: null }
			];
			d.files = {
				...d.files,
				'9900': { status: 'indexed', pages: 48, pages_indexed: 48 },
				'9901': { status: 'blocked', pages: 3 }
			};
			return d;
		};
		await openSection(page, { data });
		const row = page.getByTestId('case-comp-ecase');
		await expect(row.locator('.pill')).toHaveText(S.ecase_state_ready);
		await expect(row).toContainText(S.overview_comp_blocked_forms[0].replace('{n}', '1'));
		await expect(row).not.toContainText(S.status_failed);
	});

	test('23, И-1: после «Добавить в дело» файл сначала «добавляется», затем уходит без перезагрузки', async ({
		page
	}) => {
		let phase: 'idle' | 'adding' | 'done' = 'idle';
		const first = fixture('folder-files').files[0];
		await page.route(`**/legal-tools/api/cases/${F}/folder-files/*/add`, (r) => {
			phase = 'adding';
			return r.fulfill({ json: {} });
		});
		await openSection(page, {
			section: 'folder-files',
			data: () => ({
				...fixture('case-overview'),
				uploads:
					phase === 'adding'
						? [{ id: 'up-ff', filename: first.name, size: 100, received: 100, status: 'received', phase: 'intake' }]
						: []
			})
		});
		await page.unroute(`**/legal-tools/api/cases/${F}/folder-files`);
		await page.route(`**/legal-tools/api/cases/${F}/folder-files`, (r) =>
			r.fulfill({
				json: {
					files:
						phase === 'idle' ? [first] : phase === 'adding' ? [{ ...first, adding: true }] : []
				}
			})
		);
		await page.reload();
		await page.evaluate(() => (window as any).setConfig({ custom_ui: { case: true } }));
		await expect(nav(page, 'folder-files')).toHaveCount(1);
		await page.getByRole('button', { name: S.folder_file_add }).first().click();
		await expect(page.getByTestId('case-folder-file')).toContainText(S.folder_file_adding);
		phase = 'done';
		await refresh(page);
		await expect(nav(page, 'folder-files')).toHaveCount(0);
	});

	test('И-4: сбой GET /folder-files оставляет пункт меню и показывает ошибку с «Повторить»', async ({
		page
	}) => {
		let fail = true;
		await openSection(page, { section: 'folder-files' });
		await page.unroute(`**/legal-tools/api/cases/${F}/folder-files`);
		await page.route(`**/legal-tools/api/cases/${F}/folder-files`, (r) =>
			fail
				? r.fulfill({ status: 500, json: { detail: 'сбой папки' } })
				: r.fulfill({ json: fixture('folder-files') })
		);
		await page.reload();
		await page.evaluate(() => (window as any).setConfig({ custom_ui: { case: true } }));
		await expect(nav(page, 'folder-files')).toHaveCount(1);
		await expect(page.getByTestId('case-folder-files-error')).toContainText('сбой папки');
		fail = false;
		await page.getByTestId('case-folder-files-error').getByRole('button', { name: S.retry }).click();
		await expect(page.getByTestId('case-folder-files')).toBeVisible();
	});

	test('И-2: два действия «Убрать» в «Суммах» сразу обновляют счётчик в меню', async ({ page }) => {
		const am = fixture('amounts');
		let shown = am.amounts.map((x: any) => ({ ...x, hidden: false }));
		await openSection(page, {
			section: 'amounts',
			data: () => ({
				...fixture('case-overview'),
				counts: { ...fixture('case-overview').counts, amounts: shown.filter((x: any) => !x.hidden).length }
			}),
			routes: {
				'amounts**': (r: any) => {
					if (r.request().method() === 'PATCH') {
						const id = Number(r.request().url().split('/').pop());
						shown = shown.map((x: any) => (x.id === id ? { ...x, hidden: true } : x));
						return r.fulfill({ json: {} });
					}
					return r.fulfill({ json: { ...am, amounts: shown.filter((x: any) => !x.hidden) } });
				}
			}
		});
		const startCount = shown.length;
		await expect(nav(page, 'amounts').locator('.n')).toHaveText(String(startCount));
		await page.getByTestId('case-amount').first().getByRole('button', { name: S.map_hide }).click();
		await expect(nav(page, 'amounts').locator('.n')).toHaveText(String(startCount - 1));
		await page.getByTestId('case-amount').first().getByRole('button', { name: S.map_hide }).click();
		await expect(nav(page, 'amounts').locator('.n')).toHaveText(String(startCount - 2));
	});

	test('28: обзор ответил «не найдено» во время работы — страница сменяется на «Не найдено», прежних данных на экране нет', async ({
		page
	}) => {
		let gone = false;
		await openSection(page, { data: () => fixture('case-overview') });
		await page.getByTestId('case-summary').waitFor();
		await page.route(`**/legal-tools/api/cases/${F}`, (r) =>
			gone ? r.fulfill({ status: 404, json: { detail: S.not_found } }) : r.fallback()
		);
		gone = true;
		await refresh(page);
		await expect(page.getByTestId('case-boot-error')).toContainText(S.not_found);
		await expect(page.getByTestId('case-summary')).toHaveCount(0);
		await expect(nav(page, 'volumes')).toHaveCount(0);
	});

	test('5: поле «Лист» — обычная клавиатура: «11а», «45 об.», «л.д. 45» набираются и на телефоне', async ({
		page
	}) => {
		await openSection(page);
		const field = page
			.getByTestId('case-goto')
			.filter({ visible: true })
			.locator('input[name="l"]');
		expect(await field.getAttribute('inputmode')).toBeNull();
		await field.fill('11а');
		await expect(field).toHaveValue('11а');
	});

	test('Г-2, Ж-2: на 360 px заголовок дела во всю ширину, кнопка «В чат дела» ниже, слово не рвётся', async ({
		page
	}) => {
		await page.setViewportSize({ width: 360, height: 780 });
		await openSection(page, {
			boot: { title: 'Показательное уголовное дело — Дорогомиловский район' }
		});
		await page.getByTestId('case-summary').waitFor();
		const geom = await page.evaluate(() => {
			const h1 = document.querySelector('.head h1')!.getBoundingClientRect();
			const btn = document.querySelector('.head a.btn.p')!.getBoundingClientRect();
			return { h1W: Math.round(h1.width), h1Bottom: Math.round(h1.bottom), btnTop: Math.round(btn.top) };
		});
		expect(geom.h1W).toBeGreaterThanOrEqual(300);
		expect(geom.btnTop).toBeGreaterThanOrEqual(geom.h1Bottom);
		await noSideScroll(page);
		await snap(page, 'g2-overview-360');
	});

	test('Г-4, Г-5: цвет ссылок на лист (.ref, .chipl) из --link; в тёмной схеме контраст .btn.dp и .toast.s', async ({
		page
	}) => {
		await openSection(page, { section: 'check' });
		await page.getByTestId('case-check').waitFor();
		const lightRef = await page.locator('a.ref').first().evaluate((el) => getComputedStyle(el).color);
		expect(lightRef).toBe('rgb(75, 71, 168)'); // --link #4b47a8
		await page.evaluate(() => document.documentElement.classList.add('dark'));
		const darkRef = await page.locator('a.ref').first().evaluate((el) => getComputedStyle(el).color);
		expect(darkRef).toBe('rgb(179, 176, 245)'); // --link #b3b0f5
		await snap(page, 'g4-check-dark');

		// Г-5: кнопка удаления (.btn.dp) и красное сообщение (.toast.s) в тёмной схеме имеют тёмный текст --stop-fg
		await nav(page, 'danger').click();
		await page.getByTestId('case-danger').getByRole('button', { name: S.delete_case }).click();
		const dpColor = await dialog(page).locator('button.btn.dp').evaluate((el) => getComputedStyle(el).color);
		expect(dpColor).toBe('rgb(21, 21, 29)'); // --stop-fg #15151d
		await snap(page, 'g5-danger-dark');
		await dialog(page).getByRole('button', { name: S.cancel }).click();

		// «Разделить» у документа из одного листа называет причину (doc_split_single) и проверяет .toast.s в dark
		const docs = fixture('case-documents');
		const single = { ...docs.documents[0], first_page_id: 101, last_page_id: 101, sheets: 1 };
		await openSection(page, {
			section: 'inventory',
			routes: {
				'documents**': { ...docs, documents: [single] },
				'pages**': { pages: [{ id: 101, label: 'т. 1, л.д. 1' }] }
			}
		});
		await page.evaluate(() => document.documentElement.classList.add('dark'));
		await page.getByRole('button', { name: S.doc_split }).first().click();
		const toast = page.getByTestId('case-toast');
		await expect(toast).toContainText(S.doc_split_single);
		const toastColor = await toast.evaluate((el) => getComputedStyle(el).color);
		expect(toastColor).toBe('rgb(21, 21, 29)');
		await snap(page, 'g5-toast-dark');
	});
});

test('6: открытая таблица на 360 px с длинным действием «Дочитать таблицу по изменившимся листам» — без прокрутки вбок', async ({
	page
}) => {
	await page.setViewportSize({ width: 360, height: 780 });
	const open = fixture('table-open');
	const stale = { ...open, sweep: { ...open.sweep, stale: true, finished: true, rest: null } };
	await openSection(page, {
		section: 'tables',
		item: stale.sweep.id,
		routes: { 'tables/*?**': stale, tables: fixture('tables-list') }
	});
	await expect(
		page.getByTestId('case-table-action').filter({ hasText: S.tables_catch_up })
	).toBeVisible();
	await noSideScroll(page);
});

test('22: пункт «Дела» не меняет состояние панели чата; на телефоне после перехода панель закрыта', async ({
	page
}) => {
	await page.addInitScript(() => localStorage.setItem('token', 'session-token'));
	await page.route('**/legal-tools/api/cases/access', (r) => r.fulfill({ json: { case: true } }));
	const open = async (query: string) => {
		await page.goto(`/${query}`);
		await page.waitForFunction(() => typeof (window as any).setConfig === 'function');
		await page.evaluate(() => {
			(window as any).setUser({ id: 'u-1', role: 'user' });
			(window as any).setConfig({ custom_ui: { case: true } });
		});
	};
	// свёрнутая панель: нажатие не доходит до полосы, которая разворачивает панель (как у соседних пунктов)
	await open('?cases-link=rail');
	await page.getByTestId('custom-cases-link').waitFor();
	await page.evaluate(() => {
		(window as any).bubbled = 0;
		document.querySelector('#app')!.addEventListener('click', () => ((window as any).bubbled += 1));
	});
	await page.getByTestId('custom-cases-link').click();
	expect(await page.evaluate(() => [(window as any).bubbled, (window as any).__goto])).toEqual([
		0,
		['/case']
	]);
	expect(await page.evaluate(() => (window as any).sidebar.state())).toEqual({
		shown: true,
		chat: ''
	});
	// развёрнутая панель на телефоне: после перехода закрыта, не лежит поверх страницы
	await open('?cases-link');
	await page.getByTestId('custom-cases-link').waitFor();
	await page.evaluate(() => {
		(window as any).sidebar.mobile(true);
		document
			.querySelector('[data-testid="custom-cases-link"]')!
			.addEventListener('click', (e) => e.preventDefault());
	});
	await page.getByTestId('custom-cases-link').click();
	expect(await page.evaluate(() => (window as any).sidebar.state())).toEqual({
		shown: false,
		chat: ''
	});
	// на компьютере панель остаётся как была
	await open('?cases-link');
	await page.getByTestId('custom-cases-link').waitFor();
	await page.evaluate(() =>
		document
			.querySelector('[data-testid="custom-cases-link"]')!
			.addEventListener('click', (e) => e.preventDefault())
	);
	await page.getByTestId('custom-cases-link').click();
	expect(await page.evaluate(() => (window as any).sidebar.state().shown)).toBe(true);
});
