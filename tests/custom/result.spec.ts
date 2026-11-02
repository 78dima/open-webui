import { test, expect } from '@playwright/test';
import { jobIdFromMessage, normalizeJob, safeSourceURL } from '../../src/lib/custom/jobs';
const jobId = '11111111-1111-4111-8111-111111111111';
const artifactId = '22222222-2222-4222-8222-222222222222';
const marker = `<!-- legal-tools:job=${jobId} -->`;
const fixture = () => ({
	id: jobId,
	status: 'completed',
	spent_usd: 0.125,
	unknown_usage: true,
	created_at: '2026-01-01T00:00:00Z',
	finished_at: '2026-01-01T00:00:12Z',
	result: {
		report: { summary: 'Синтетический итог' },
		findings: [{ claim: 'Проверьте срок', severity: 'high', element_ids: ['p:3'] }],
		edits: [
			{
				element_id: 'p:3',
				before: 'До правки',
				after: 'После правки',
				rationale: 'Основание правки'
			}
		],
		sources: [
			{
				citation_label: 'Тестовый источник',
				receipt_id: 'receipt-example',
				edition_date: '2026-01-01',
				canonical_text: 'Синтетический фрагмент',
				kplus_url: 'javascript:alert(1)'
			}
		],
		gaps: ['Практика не проверена']
	},
	artifacts: [
		{
			id: artifactId,
			name: 'synthetic.docx',
			size: 4,
			download_url: 'https://untrusted.example/file'
		}
	]
});
async function setup(page: any, content = `Исходный ответ\n${marker}`.replace('\\n', '\n')) {
	await page.goto('/?result');
	await page.waitForFunction(() => typeof (window as any).setMessage === 'function');
	await page.evaluate((content: string) => {
		localStorage.setItem('token', 'synthetic-session-token');
		(window as any).setMessage({
			content,
			model: { id: 'legal_workflows.contract_review' },
			done: true,
			sources: []
		});
		(window as any).setConfig({ custom_ui: { result_card: true } });
	}, content);
}
test('job markers are exact; old timeout is supported; arbitrary UUIDs are ignored', () => {
	expect(jobIdFromMessage(`Ответ\n${marker}`)).toBe(jobId);
	expect(jobIdFromMessage(marker)).toBe(jobId);
	expect(jobIdFromMessage(`Ответ ${marker}`)).toBe(jobId);
	expect(
		jobIdFromMessage(
			`Задание ${jobId} ещё выполняется. Результат появится в этом чате после завершения (обновите страницу).`
		)
	).toBe(jobId);
	for (const value of [
		`Произвольный ${jobId}`,
		`\`\`\`\n${marker}\n\`\`\``,
		`${marker}\nтекст`,
		'<!-- legal-tools:job=../secret -->'
	])
		expect(jobIdFromMessage(value)).toBeUndefined();
	expect(safeSourceURL('javascript:alert(1)')).toBeUndefined();
	expect(() => normalizeJob({ id: 'wrong', status: 'completed' }, jobId)).toThrow();
});
test('saved review without U1 uses original answer and saved sources without a job request', async ({
	page
}) => {
	let requests = 0;
	await page.route('**/legal-tools/**', (route) => {
		requests++;
		return route.abort();
	});
	await setup(page, 'Сохранённый разбор без идентификатора');
	await expect(page.getByTestId('custom-result')).toBeVisible();
	await expect(page.getByTestId('original-answer')).toBeVisible();
	await expect(page.getByTestId('custom-result')).toContainText('без идентификатора');
	await page.evaluate(() =>
		(window as any).setMessage({
			content: 'Сохранённый разбор',
			model: { id: 'legal_workflows.contract_review' },
			done: true,
			sources: [
				{
					source: { name: 'Сохранённый источник' },
					document: ['Текст из сохранённого ответа'],
					metadata: [{ receipt_id: 'receipt-saved' }]
				}
			]
		})
	);
	await page.getByRole('button', { name: 'Источники', exact: true }).click();
	await page.getByText('Показать сохранённый фрагмент').click();
	await expect(page.getByText('Текст из сохранённого ответа', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Правки', exact: true }).click();
	await expect(page.getByTestId('custom-result')).toContainText('Эти данные не переданы');
	expect(requests).toBe(0);
	await page.evaluate(() => (window as any).setConfig({ custom_ui: { result_card: false } }));
	await expect(page.getByTestId('custom-result')).toHaveCount(0);
	await expect(page.getByTestId('original-answer')).toBeVisible();
});
test('job tabs, sources, usage and authenticated artifact download', async ({ page }) => {
	const requests: string[] = [];
	await page.route('**/legal-tools/**', async (route) => {
		requests.push(route.request().url());
		expect(route.request().headers().authorization).toBe('Bearer synthetic-session-token');
		if (route.request().url().endsWith(`/artifacts/${artifactId}`))
			await route.fulfill({
				body: 'PK-test',
				contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
			});
		else await route.fulfill({ json: fixture() });
	});
	await setup(page, `Исходный ответ\n${marker}`);
	await expect(page.getByText('Синтетический итог', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Находки', exact: true }).click();
	await expect(page.getByText('Проверьте срок', { exact: true })).toBeVisible();
	await expect(page.getByText('Высокий', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Правки', exact: true }).click();
	await expect(page.getByText('После правки', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Источники', exact: true }).click();
	await expect(page.getByText('Редакция: 2026-01-01', { exact: true })).toBeVisible();
	await page.getByText('Показать сохранённый фрагмент').click();
	await expect(page.getByText('Синтетический фрагмент', { exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Открыть источник' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Расход и время', exact: true }).click();
	await expect(page.getByText('0.125', { exact: true })).toBeVisible();
	await expect(page.getByText('12', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Файлы', exact: true }).click();
	const download = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Скачать', exact: true }).click();
	expect((await download).suggestedFilename()).toBe('synthetic.docx');
	expect(requests).toHaveLength(2);
	expect(
		requests.every((url) => url.startsWith('http://127.0.0.1:5174/legal-tools/'))
	).toBeTruthy();
});
for (const status of [401, 403, 500])
	test(`HTTP ${status} preserves original content and can retry`, async ({ page }) => {
		await page.route('**/legal-tools/**', (route) =>
			route.fulfill({ status, body: 'private error details' })
		);
		await setup(page, `Ответ\n${marker}`);
		await expect(page.getByRole('alert')).toBeVisible();
		await expect(page.getByTestId('original-answer')).toBeVisible();
		await expect(page.getByTestId('custom-result')).not.toContainText('private error details');
		await page.unroute('**/legal-tools/**');
		await page.route('**/legal-tools/**', (route) => route.fulfill({ json: fixture() }));
		await page.getByRole('button', { name: 'Обновить', exact: true }).click();
		await expect(page.getByText('Синтетический итог', { exact: true })).toBeVisible();
	});
test('late responses and wrong model cannot resurrect a disabled card', async ({ page }) => {
	await page.route('**/legal-tools/**', async (route) => {
		await new Promise((resolve) => setTimeout(resolve, 300));
		await route.fulfill({ json: fixture() }).catch(() => {});
	});
	await setup(page, `Ответ\n${marker}`);
	await expect(page.getByRole('status')).toBeVisible();
	await page.evaluate(() => (window as any).setConfig({ custom_ui: { result_card: false } }));
	await page.waitForTimeout(400);
	await expect(page.getByTestId('custom-result')).toHaveCount(0);
	await expect(page.getByTestId('original-answer')).toBeVisible();
	await page.evaluate((content) => {
		(window as any).setMessage({ content, model: { id: 'jurist-rf' }, done: true });
		(window as any).setConfig({ custom_ui: { result_card: true } });
	}, marker);
	await expect(page.getByTestId('custom-result')).toHaveCount(0);
});

for (const response of [
	{
		id: jobId,
		status: 'completed',
		schema_version: 'unknown-v99',
		result: { summary: 'Do not render' }
	},
	{ id: jobId, status: 'completed', result: { edits: [{ element_id: 'p:1' }] } }
])
	test(`unsupported or incomplete results preserve the saved answer: ${'schema_version' in response ? 'version' : 'legacy'}`, async ({
		page
	}) => {
		await page.route('**/legal-tools/**', (route) => route.fulfill({ json: response }));
		await setup(page, `Ответ\n${marker}`);
		await expect(page.getByTestId('original-answer')).toBeVisible();
		if ('schema_version' in response) {
			await expect(page.getByRole('alert')).toContainText('Формат результата не поддерживается');
			await expect(page.getByText('Do not render', { exact: true })).toHaveCount(0);
		} else {
			await expect(page.getByRole('button', { name: 'Обновить', exact: true })).toBeEnabled();
			await page.getByRole('button', { name: 'Правки', exact: true }).click();
			await expect(page.getByTestId('custom-result')).toContainText('Эти данные не переданы');
		}
	});

test('running job is polled until completion and string flags never enable the card', async ({
	page
}) => {
	let calls = 0;
	await page.route('**/legal-tools/**', (route) =>
		route.fulfill({
			json: ++calls === 1 ? { ...fixture(), status: 'running', result: {} } : fixture()
		})
	);
	await setup(page, `Ответ\n${marker}`);
	await expect(page.getByText('Выполняется', { exact: true })).toBeVisible();
	await expect(page.getByText('Синтетический итог', { exact: true })).toBeVisible({
		timeout: 6000
	});
	expect(calls).toBe(2);
	await page.evaluate(() => (window as any).setConfig({ custom_ui: { result_card: 'true' } }));
	await expect(page.getByTestId('custom-result')).toHaveCount(0);
});
