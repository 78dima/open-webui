// ai-dvokat: новое поведение пакета Б захода 22.11 на стенде компонентов (ревью Бп-10): группы строк таблиц в
// хронологии — раскрытие порциями до конца теми же строками с действиями, счёт записей, принятие на месте; «только
// чтение» без новых действий; «взять из другого дела» — оценка и окно подтверждения; отметка строки и столбца таблицы.
import { test, expect } from '@playwright/test';
import { F, S, dialog, fixture, noSideScroll, openSection } from './casekit';

const RO = { can_write: false, is_owner: false };
const OPEN = fixture('table-open').sweep.id;
const base = () => fixture('facts').facts[0];
const row = (id: number, extra: Record<string, unknown> = {}) => ({
	...base(),
	id,
	summary: `Строка таблицы ${id}`,
	in_table: true,
	document_id: 7,
	...extra
});
const group = {
	group: true,
	document_id: 7,
	document: 'Выписка по счёту',
	n: 3,
	date_from: '2024-01-02',
	date_to: '2024-03-04',
	page_id: 1,
	label: 'т. 1, л.д. 5'
};

/** Лента: одна запись и группа из 3 записей; записи группы — порциями по 2 (page=0, page=1). */
function feed(canWrite = true) {
	return (r: any, c: any) => {
		const d = fixture('facts');
		if (c.method === 'PATCH')
			return r.fulfill({
				json: {
					fact: row(Number(c.path.split('/facts/')[1]), {
						accepted: true,
						accepted_at: '2026-11-22T10:00:00Z',
						accepted_name: 'Анна'
					}),
					edit_ids: [1]
				}
			});
		if (c.path.includes('table_group=true')) {
			const p = c.path.includes('page=1') ? 1 : 0;
			return r.fulfill({
				json: {
					...d,
					facts: p ? [row(103)] : [row(101), row(102)],
					total: 3,
					next_page: p ? null : 1,
					end: !!p,
					can_write: canWrite
				}
			});
		}
		return r.fulfill({
			json: {
				...d,
				facts: [d.facts[0], group],
				total: 2,
				total_records: 4,
				next_page: null,
				end: true,
				can_write: canWrite
			}
		});
	};
}

test.describe('пакет Б 22.11, 1280', () => {
	test.use({ viewport: { width: 1280, height: 1100 } });

	test('хронология: группа строк таблицы раскрывается порциями до конца теми же строками; счёт — записи; принятие — на месте', async ({
		page
	}) => {
		const { calls } = await openSection(page, {
			section: 'chronology',
			routes: { 'facts**': feed() }
		});
		await expect(page.getByTestId('case-facts')).toContainText('Записей: 4'); // записи, а не 2 строки ленты
		const g = page.getByTestId('case-fact-group');
		await expect(g).toContainText(
			'Строки таблицы в документе «Выписка по счёту»: записей 3, с 02.01.2024 по 04.03.2024'
		);
		await g.getByTestId('case-fact-group-open').click();
		const rows = g.getByTestId('case-fact-group-rows').getByTestId('case-fact');
		await expect(rows).toHaveCount(2);
		await expect(g.getByTestId('case-fact-group-more')).toContainText('2 из 3');
		await g.getByTestId('case-fact-group-more').click();
		await expect(rows).toHaveCount(3);
		await expect(g.getByTestId('case-fact-group-more')).toHaveCount(0);
		const asked = calls
			.filter((c) => c.method === 'GET' && c.path.includes('table_group=true'))
			.map((c) => c.path);
		expect(asked.length).toBe(2);
		expect(asked.every((p) => p.includes('document=7'))).toBe(true);
		expect(asked.map((p) => new URLSearchParams(p.split('?')[1]).get('page'))).toEqual(['0', '1']);
		for (const name of [S.map_fact_accept, S.map_edit, S.map_hide, S.map_history])
			await expect(rows.nth(0).getByRole('button', { name })).toBeVisible();
		await expect(rows.nth(0).getByTestId('case-fact-in-table')).toHaveText(S.map_fact_in_table);
		await rows.nth(1).getByRole('button', { name: S.map_fact_accept }).click();
		await expect(rows.nth(1).getByTestId('case-fact-accepted')).toContainText('Анна');
		await expect(rows).toHaveCount(3); // группа открыта, место то же
		expect(
			calls.some(
				(c) => c.method === 'PATCH' && c.path === '/facts/102' && c.body?.accepted === true
			)
		).toBe(true);
	});

	test('«только чтение»: у раскрытых строк нет «Принять», «Править», «Убрать»', async ({
		page
	}) => {
		await openSection(page, {
			section: 'chronology',
			boot: RO,
			routes: { 'facts**': feed(false) }
		});
		const g = page.getByTestId('case-fact-group');
		await g.getByTestId('case-fact-group-open').click();
		const rows = g.getByTestId('case-fact-group-rows').getByTestId('case-fact');
		await expect(rows).toHaveCount(2);
		await expect(rows.nth(0).getByRole('button', { name: S.map_history })).toBeVisible();
		for (const name of [S.map_fact_accept, S.map_edit, S.map_hide])
			await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
	});

	for (const [usd, confirm] of [
		[0.04, false],
		[1.6, true]
	] as const) {
		test(`таблица из другого дела: оценка охвата до запуска, ${confirm ? 'больше 1 USD — окно подтверждения' : 'до 1 USD — запуск по кнопке'}`, async ({
			page
		}) => {
			const other = fixture('my-cases').own.find((c: any) => c.folder_id !== F).folder_id;
			await page.route('**/legal-tools/api/cases', (r) => r.fulfill({ json: fixture('my-cases') }));
			const { calls } = await openSection(page, {
				section: 'tables',
				routes: {
					tables: { tables: [], presets: fixture('tables-list').presets },
					'tables/scope?**': { ...fixture('tables-scope'), estimate_usd: 0.02 },
					[`tables/from/${other}`]: {
						tables: [
							{ id: 'sw-1', question: 'Что заявлено', columns: [{ key: 'a', title: 'Требование' }] }
						]
					},
					[`tables/from/${other}/sw-1/scope**`]: {
						label: 'всё дело',
						pages: 40,
						documents: 6,
						windows: 12,
						estimate_usd: usd,
						limit_usd: 3
					},
					[`tables/from/${other}/sw-1`]: (r: any) =>
						r.fulfill({ status: 201, json: { cached: false } })
				}
			});
			const box = page.getByTestId('case-tables-other');
			await box.getByRole('button', { name: S.tables_from_other }).click();
			await box.locator('select').first().selectOption(other);
			await box.locator('select').nth(1).selectOption('sw-1');
			const start = page.getByTestId('case-tables-other-start');
			await expect(start).toContainText('USD');
			expect(
				calls.some(
					(c) => c.method === 'GET' && c.path.startsWith(`/tables/from/${other}/sw-1/scope`)
				)
			).toBe(true);
			expect(calls.some((c) => c.method === 'POST')).toBe(false); // оценка ничего не запускает
			await start.click();
			if (confirm) {
				await expect(dialog(page)).toContainText('предел прохода — 3,00 USD');
				expect(calls.some((c) => c.method === 'POST')).toBe(false);
				await dialog(page).getByRole('button', { name: /USD/ }).click();
			}
			await expect
				.poll(() =>
					calls.some((c) => c.method === 'POST' && c.path === `/tables/from/${other}/sw-1`)
				)
				.toBe(true);
		});
	}

	test('открытая таблица: «отметить строку» и «отметить столбец» — одним запросом на всю строку или столбец', async ({
		page
	}) => {
		const { calls } = await openSection(page, {
			section: 'tables',
			item: OPEN,
			routes: {
				'tables/*?**': fixture('table-open'),
				'tables/*/checks/bulk': (r: any) => r.fulfill({ json: { set: 3, skipped: 1 } })
			}
		});
		await page.getByTestId('case-table-check-row').first().click();
		await expect(
			page.getByText('Отмечено ячеек: 3; пропущено (проверять нечего): 1')
		).toBeVisible();
		await page.getByTestId('case-table-check-column').first().click();
		const bulk = calls
			.filter((c) => c.method === 'PUT' && c.path.endsWith('/checks/bulk'))
			.map((c) => c.body);
		await expect.poll(() => calls.filter((c) => c.method === 'PUT').length).toBe(2);
		expect(bulk[0]).toMatchObject({ checked: true });
		expect('document_id' in bulk[0] || 'column_key' in bulk[0]).toBe(true);
	});
});

test('таблица из другого дела на телефоне 360 и с длинным вопросом: без прокрутки вбок', async ({
	page
}) => {
	await page.setViewportSize({ width: 360, height: 800 });
	const other = fixture('my-cases').own.find((c: any) => c.folder_id !== F).folder_id;
	await page.route('**/legal-tools/api/cases', (r) => r.fulfill({ json: fixture('my-cases') }));
	await openSection(page, {
		section: 'tables',
		routes: {
			tables: { tables: [], presets: fixture('tables-list').presets },
			'tables/scope?**': { ...fixture('tables-scope'), estimate_usd: 0.02 },
			[`tables/from/${other}`]: {
				tables: [{ id: 'sw-1', question: 'Очень длинный вопрос таблицы '.repeat(12), columns: [] }]
			},
			[`tables/from/${other}/sw-1/scope**`]: {
				label: 'всё дело',
				pages: 4,
				documents: 1,
				windows: 2,
				estimate_usd: 0.01,
				limit_usd: 3
			}
		}
	});
	const box = page.getByTestId('case-tables-other');
	await box.getByRole('button', { name: S.tables_from_other }).click();
	await box.locator('select').first().selectOption(other);
	await box.locator('select').nth(1).selectOption('sw-1');
	await expect(page.getByTestId('case-tables-other-start')).toContainText('USD');
	await noSideScroll(page);
});
