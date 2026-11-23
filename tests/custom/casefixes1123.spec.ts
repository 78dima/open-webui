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
