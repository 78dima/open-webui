import { test, expect } from '@playwright/test';
test('receipt stub opens from saved sources, closes, and never pretends the REST API exists', async ({
	page
}) => {
	const calls: string[] = [];
	page.on('request', (r) => {
		if (new URL(r.url()).pathname.startsWith('/legal-tools/')) calls.push(r.url());
	});
	await page.goto('/?result');
	await page.waitForFunction(() => typeof (window as any).setMessage === 'function');
	await page.evaluate(() => {
		(window as any).setConfig({ custom_ui: { result_card: true, receipt_panel: 'true' } });
		(window as any).setMessage({
			content: 'Синтетический сохранённый ответ',
			model: { id: 'legal_workflows.contract_review' },
			done: true,
			sources: [{ label: 'Тестовый источник', receipt_id: '11111111-1111-4111-8111-111111111111' }]
		});
	});
	await page.getByRole('button', { name: 'Источники', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Открыть панель источника' })).toHaveCount(0);
	await page.evaluate(() =>
		(window as any).setConfig({ custom_ui: { result_card: true, receipt_panel: true } })
	);
	await page.getByRole('button', { name: 'Открыть панель источника' }).click();
	await expect(page.getByTestId('custom-receipt-panel')).toContainText(
		'API источников ещё не реализован продуктом.'
	);
	await expect(page.getByTestId('custom-receipt-panel')).toContainText('Данные не запрашивались.');
	await page.getByRole('button', { name: 'Закрыть панель' }).click();
	await expect(page.getByTestId('custom-receipt-panel')).toHaveCount(0);
	await page.getByRole('button', { name: 'Открыть панель источника' }).click();
	await page.evaluate(() =>
		(window as any).setConfig({ custom_ui: { result_card: true, receipt_panel: false } })
	);
	await expect(page.getByTestId('custom-receipt-panel')).toHaveCount(0);
	expect(calls).toEqual([]);
});
