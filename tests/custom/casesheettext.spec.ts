// ai-dvokat: правка текста листа юристом (22.11): запись хронологии, сумма, основание срока и ответ ячейки таблицы,
// чья цитата после правки текста листа дословно не стоит на листе, получают пометку «цитата изменилась — проверьте»
// (факт сервиса `quote_changed`); без факта пометки нет. Сама правка — на странице листа сервиса, не здесь.
import { test, expect } from '@playwright/test';
import { S, fixture, noSideScroll, openSection } from './casekit';

const OPEN = fixture('table-open').sweep.id;

function facts(r: any) {
	const d = fixture('facts');
	return r.fulfill({
		json: { ...d, facts: d.facts.map((f: any, i: number) => ({ ...f, quote_changed: i === 0 })) }
	});
}

function amounts(r: any) {
	const d = fixture('amounts');
	return r.fulfill({
		json: { ...d, amounts: d.amounts.map((a: any, i: number) => ({ ...a, quote_changed: i === 0 })) }
	});
}

function deadlines(r: any) {
	const d = fixture('deadlines');
	return r.fulfill({
		json: {
			...d,
			deadlines: d.deadlines.map((x: any, i: number) => ({
				...x,
				basis: { ...x.basis, quote_changed: i === 0 }
			}))
		}
	});
}

function tableView() {
	const d = fixture('table-open');
	return {
		...d,
		rows: d.rows.map((row: any, ri: number) =>
			ri !== 0
				? row
				: {
						...row,
						cells: {
							...row.cells,
							what: {
								...row.cells.what,
								answers: row.cells.what.answers.map((a: any, ai: number) =>
									ai === 0 ? { ...a, quote_changed: true } : a
								)
							}
						}
					}
		)
	};
}

for (const width of [1280, 360]) {
	test.describe(`«цитата изменилась», ${width}`, () => {
		test.use({ viewport: { width, height: 1100 } });

		test('хронология: пометка у записи с фактом сервиса, у прочих — нет', async ({ page }) => {
			await openSection(page, { section: 'chronology', routes: { 'facts**': facts } });
			const rows = page.getByTestId('case-fact');
			await expect(rows.nth(0).getByTestId('case-quote-changed')).toHaveText(S.quote_changed);
			await expect(rows.nth(1).getByTestId('case-quote-changed')).toHaveCount(0);
			await noSideScroll(page);
		});

		test('суммы: пометка у суммы с фактом сервиса', async ({ page }) => {
			await openSection(page, { section: 'amounts', routes: { 'amounts**': amounts } });
			await expect(page.getByTestId('case-quote-changed')).toHaveCount(1);
			await expect(page.getByTestId('case-quote-changed')).toContainText(S.quote_changed);
		});

		test('сроки: пометка у основания срока', async ({ page }) => {
			await openSection(page, { section: 'deadlines', routes: { 'deadlines**': deadlines } });
			await expect(page.getByTestId('case-quote-changed')).toHaveCount(1);
			await expect(page.getByTestId('case-quote-changed')).toContainText(S.quote_changed);
		});

		test('открытая таблица: пометка у ответа ячейки', async ({ page }) => {
			await openSection(page, {
				section: 'tables',
				item: OPEN,
				routes: { 'tables/*?**': tableView(), tables: fixture('tables-list') }
			});
			await expect(page.getByTestId('case-quote-changed')).toHaveCount(1);
			await expect(page.getByTestId('case-quote-changed')).toHaveText(S.quote_changed);
		});
	});
}
