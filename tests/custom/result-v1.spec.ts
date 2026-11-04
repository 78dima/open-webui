import { test, expect } from '@playwright/test';
import { normalizeJob } from '../../src/lib/custom/jobs';
// B2 on U5 structured v1. Field shapes follow the stand's answer on 05.11.2026; values are synthetic.
const jobId = '11111111-1111-4111-8111-111111111111';
const receiptId = '66666666-6666-4666-8666-666666666666';
const foreignReceipt = '77777777-7777-4777-8777-777777777777';
const artifactId = '22222222-2222-4222-8222-222222222222';
const marker = `<!-- legal-tools:job=${jobId} -->`;
const v1 = (patch: Record<string, unknown> = {}) => ({
	id: jobId, kind: 'contract_review', status: 'completed', step: 'done', attempts: 1,
	spent_usd: 0.5, budget_usd: 3, unknown_usage: false, error_code: null, error_text: null,
	created_at: '2026-11-05T10:00:00+00:00', finished_at: '2026-11-05T10:06:00+00:00',
	result: { report_markdown: 'Старый формат', sources: [] }, events: [],
	structured: {
		schema_version: 1, job_id: jobId, kind: 'contract_review', status: 'completed',
		report: { summary: 'Итог по схеме v1' }, report_markdown: '# Отчёт',
		findings: [{ part: 'risks', claim: 'Неустойка без предела', kind: 'legal', severity: 'high', for_side: true,
			locations: [{ element_id: 'p:12', doc: 'договор.docx', page: 3 }], legal_question: null }],
		edits: [{ element_id: 'p:12', op: 'replace', before: 'Было v1', after: 'Стало v1', rationale: 'Основание v1',
			evidence: [receiptId], status: 'proposed', failure_code: null, goal_related: true }],
		sources: [
			{ receipt_id: receiptId, name: 'ст. 333 ГК РФ', url: 'https://kplus.example/doc', excerpt: 'Начало фрагмента' },
			{ receipt_id: foreignReceipt, name: 'Чужой источник', url: null, excerpt: null }
		],
		gaps: ['Практика не найдена'], partial_reason: null,
		usage: { spent_usd: 0.4567, unknown: true, steps: [] },
		...patch
	},
	artifacts: [{ id: artifactId, kind: 'report_docx', name: 'отчёт.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		size: 4, owui_file_id: 'f', gaps: '', download_url: 'https://untrusted.example/dl' }]
});

test('U5 v1 is read from structured; unknown versions and other jobs are refused', () => {
	const job = normalizeJob(v1(), jobId);
	expect(job.schema_version).toBe('1');
	expect(job.summary).toBe('Итог по схеме v1');
	expect(job.findings?.[0]).toMatchObject({ severity: 'high', element_ids: ['p:12'], locations: [{ doc: 'договор.docx', page: 3 }] });
	expect(job.edits?.[0]).toMatchObject({ before: 'Было v1', status: 'proposed' });
	expect(job.sources.map((s) => s.receipt_id)).toEqual([receiptId, foreignReceipt]);
	expect(job.spent_usd).toBe(0.4567);
	expect(job.unknown_usage).toBe(true);
	expect(job.artifacts).toEqual([{ id: artifactId, name: 'отчёт.docx', size: 4 }]);
	expect(() => normalizeJob(v1({ schema_version: 2 }), jobId)).toThrow('unsupported');
	expect(() => normalizeJob(v1({ job_id: artifactId }), jobId)).toThrow('unsupported');
	// A running job has no structured result yet: the older fields still drive the status.
	expect(normalizeJob({ ...v1(), structured: undefined, status: 'running', result: {} }, jobId).status).toBe('running');
});

test('B2 card shows U5 v1: summary, located findings, edit status, saved source fragments, usage', async ({ page }) => {
	const requests: string[] = [];
	await page.route('**/legal-tools/**', (route) => {
		const url = new URL(route.request().url());
		requests.push(url.pathname);
		expect(route.request().headers().authorization).toBe('Bearer synthetic-session-token');
		return route.fulfill({ json: v1() });
	});
	await page.goto('/?result');
	await page.waitForFunction(() => typeof (window as any).setMessage === 'function');
	await page.evaluate((content) => {
		localStorage.setItem('token', 'synthetic-session-token');
		(window as any).setMessage({ content, model: { id: 'legal_workflows.contract_review' }, done: true, sources: [] });
		(window as any).setConfig({ custom_ui: { result_card: true, receipt_panel: true } });
	}, `Ответ\n\n${marker}`);
	const card = page.getByTestId('custom-result');
	await expect(page.getByText('Итог по схеме v1', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Находки', exact: true }).click();
	await expect(page.getByText('p:12, договор.docx, с. 3', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Правки', exact: true }).click();
	await expect(page.getByText('предложена', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Источники', exact: true }).click();
	await expect(card.getByRole('heading', { name: 'ст. 333 ГК РФ' })).toBeVisible();
	await expect(card).toContainText(`Источник: ${receiptId}`);
	await card.getByText('Показать сохранённый фрагмент').first().click();
	await expect(card.getByText('Начало фрагмента', { exact: true })).toBeVisible();
	await expect(card.getByRole('link', { name: 'Открыть источник' }).first()).toHaveAttribute('href', 'https://kplus.example/doc');
	// No receipt panel any more (B3 reverted 05.11): a stray flag changes nothing.
	await expect(page.getByRole('button', { name: 'Открыть панель источника' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Расход и время', exact: true }).click();
	await expect(card).toContainText('0.4567');
	await expect(card).toContainText('Часть расхода не учтена.');
	expect(requests).toEqual([`/legal-tools/api/jobs/${jobId}`]);
});
