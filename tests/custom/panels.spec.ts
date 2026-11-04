import { test, expect } from '@playwright/test';
import {
	normalizeJob,
	normalizeReceipt,
	normalizeCaseJobs,
	normalizeJobArtifacts,
	folderItems
} from '../../src/lib/custom/jobs';
// B2 on U5 v1, B3 on U2, B4 on U3/U4. Field shapes follow the stand's answers on 05.11.2026; values are synthetic.
const jobId = '11111111-1111-4111-8111-111111111111';
const receiptId = '66666666-6666-4666-8666-666666666666';
const foreignReceipt = '77777777-7777-4777-8777-777777777777';
const artifactId = '22222222-2222-4222-8222-222222222222';
const folderId = '55555555-5555-4555-8555-555555555555';
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
const receipt = {
	id: receiptId, endpoint: 'main', base: 'LAW', nd: 5142, dst: 1001, edition_nd: 1, edition_date: '01.03.2025',
	edition_status: 'Недействующая редакция', para_from: 2, para_to: 4, canonical_text: 'Синтетический текст статьи',
	citation_label: 'ст. 333 ГК РФ', doc_title: 'Гражданский кодекс', citation: 'ст. 333 ГК РФ (ред. 01.03.2025), абз. 2–4',
	kplus_url: 'https://kplus.example/doc?nd=5142', fetched_at: '2026-11-05T10:01:00+00:00', base_updated_on: '2026-11-01',
	verify_status: null
};

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

test('U2-U4 responses are validated without trusting extra fields', () => {
	expect(normalizeReceipt(receipt, receiptId)).toMatchObject({ edition_status: 'Недействующая редакция', para_to: 4 });
	expect(normalizeReceipt({ ...receipt, kplus_url: 'javascript:alert(1)' }, receiptId).kplus_url).toBeUndefined();
	expect(() => normalizeReceipt({ ...receipt, id: foreignReceipt }, receiptId)).toThrow();
	expect(normalizeCaseJobs({ items: [{ id: jobId, kind: 'echo', status: 'completed', artifacts: [{ id: 'x' }] }, { id: '../x' }], next_cursor: 'abc_-1' }))
		.toEqual({ items: [{ id: jobId, kind: 'echo', status: 'completed', created_at: undefined, finished_at: undefined, spent_usd: undefined, artifacts: [] }], next_cursor: 'abc_-1' });
	expect(normalizeCaseJobs({ items: [], next_cursor: 'a&b' }).next_cursor).toBeUndefined();
	expect(() => normalizeCaseJobs([])).toThrow();
	expect(normalizeJobArtifacts([{ id: artifactId, filename: 'a.docx', size: 1, sha256: 'h', mime: 'm', owui_file_id: null }]))
		.toEqual([{ id: artifactId, kind: undefined, name: 'a.docx', size: 1, sha256: 'h', mime: 'm', owui_file_id: undefined }]);
	expect(folderItems({ data: { files: [{ type: 'note', id: 'n1', name: 'Карта дела' }, { type: 'file', id: '../bad' }] } }))
		.toEqual([{ id: 'n1', type: 'note', name: 'Карта дела' }]);
});

test('B2 card shows U5 v1 and B3 opens the real receipt, foreign receipts fail closed', async ({ page }) => {
	const requests: string[] = [];
	await page.route('**/legal-tools/**', (route) => {
		const url = new URL(route.request().url());
		requests.push(url.pathname);
		expect(route.request().headers().authorization).toBe('Bearer synthetic-session-token');
		if (url.pathname === `/legal-tools/api/jobs/${jobId}`) return route.fulfill({ json: v1() });
		if (url.pathname === `/legal-tools/api/receipts/${receiptId}`) return route.fulfill({ json: receipt });
		return route.fulfill({ status: 403, json: { detail: 'forbidden' } });
	});
	await page.goto('/?result');
	await page.waitForFunction(() => typeof (window as any).setMessage === 'function');
	await page.evaluate((content) => {
		localStorage.setItem('token', 'synthetic-session-token');
		(window as any).setMessage({ content, model: { id: 'legal_workflows.contract_review' }, done: true, sources: [] });
		(window as any).setConfig({ custom_ui: { result_card: true, receipt_panel: true } });
	}, `Ответ\n\n${marker}`);
	await expect(page.getByText('Итог по схеме v1', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Находки', exact: true }).click();
	await expect(page.getByText('p:12, договор.docx, с. 3', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Правки', exact: true }).click();
	await expect(page.getByText('предложена', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Источники', exact: true }).click();
	await page.getByRole('button', { name: 'Открыть панель источника' }).first().click();
	const panel = page.getByTestId('custom-receipt-panel');
	await expect(panel.getByTestId('custom-receipt-text')).toHaveText('Синтетический текст статьи');
	await expect(panel).toContainText('ст. 333 ГК РФ (ред. 01.03.2025), абз. 2–4');
	await expect(panel).toContainText('01.03.2025, Недействующая редакция');
	await expect(panel).toContainText('2–4');
	await expect(panel).toContainText('Метка сверки');
	await expect(panel).toContainText('не передана');
	await expect(panel.getByRole('link', { name: 'Открыть в КонсультантПлюс' })).toHaveAttribute('href', 'https://kplus.example/doc?nd=5142');
	await page.getByRole('button', { name: 'Открыть панель источника' }).nth(1).click();
	await expect(panel.getByRole('alert')).toHaveText('Источник недоступен для этого аккаунта.');
	await expect(panel.getByTestId('custom-receipt-text')).toHaveCount(0);
	await page.getByRole('button', { name: 'Закрыть панель' }).click();
	await expect(panel).toHaveCount(0);
	expect(requests).toEqual([`/legal-tools/api/jobs/${jobId}`, `/legal-tools/api/receipts/${receiptId}`, `/legal-tools/api/receipts/${foreignReceipt}`]);
});

test('receipt panel needs a strict flag and closes when the flag goes off', async ({ page }) => {
	const requests: string[] = [];
	await page.route('**/legal-tools/**', (route) => {
		requests.push(new URL(route.request().url()).pathname);
		return route.fulfill({ json: receipt });
	});
	await page.goto('/?result');
	await page.waitForFunction(() => typeof (window as any).setMessage === 'function');
	await page.evaluate((receiptId) => {
		localStorage.setItem('token', 'synthetic-session-token');
		(window as any).setConfig({ custom_ui: { result_card: true, receipt_panel: 'true' } });
		(window as any).setMessage({ content: 'Сохранённый ответ', model: { id: 'legal_workflows.contract_review' }, done: true,
			sources: [{ label: 'Тестовый источник', receipt_id: receiptId }] });
	}, receiptId);
	await page.getByRole('button', { name: 'Источники', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Открыть панель источника' })).toHaveCount(0);
	await page.evaluate(() => (window as any).setConfig({ custom_ui: { result_card: true, receipt_panel: true } }));
	await page.getByRole('button', { name: 'Открыть панель источника' }).click();
	await expect(page.getByTestId('custom-receipt-text')).toBeVisible();
	await page.evaluate(() => (window as any).setConfig({ custom_ui: { result_card: true, receipt_panel: false } }));
	await expect(page.getByTestId('custom-receipt-panel')).toHaveCount(0);
	expect(requests).toEqual([`/legal-tools/api/receipts/${receiptId}`]);
});

const jobsPage = (n: number, next: string | null) => ({
	items: [{ id: n === 1 ? jobId : '33333333-3333-4333-8333-333333333333', kind: n === 1 ? 'contract_review' : 'draft_document',
		status: n === 1 ? 'completed' : 'failed', created_at: '2026-11-05T10:00:00+00:00', finished_at: null, spent_usd: 0.25,
		artifacts: n === 1 ? [{ id: artifactId, kind: 'report_docx', filename: 'отчёт.docx', size: 7 }] : [] }],
	next_cursor: next
});

test('case panel: materials, case map, jobs with paging, files on demand and download', async ({ page }) => {
	const requests: string[] = [];
	await page.route('**/api/v1/folders/**', (route) => {
		requests.push(new URL(route.request().url()).pathname);
		return route.fulfill({ json: { id: folderId, name: 'Дело Альфа', data: { files: [
			{ type: 'note', id: 'note-1', name: 'Карта дела' },
			{ type: 'file', id: 'file-1', name: 'договор.docx' },
			{ type: 'collection', id: 'kb-1', name: 'Судебная практика' }
		] } } });
	});
	await page.route('**/legal-tools/**', (route) => {
		const url = new URL(route.request().url());
		requests.push(url.pathname + url.search);
		expect(route.request().headers().authorization).toBe('Bearer synthetic-session-token');
		if (url.pathname === '/legal-tools/api/jobs')
			return route.fulfill({ json: url.searchParams.get('cursor') ? jobsPage(2, null) : jobsPage(1, 'page2') });
		if (url.pathname === `/legal-tools/api/jobs/${jobId}/artifacts`)
			return route.fulfill({ json: [{ id: artifactId, kind: 'report_docx', filename: 'отчёт.docx', size: 7, sha256: 'h', owui_file_id: null, mime: 'x' }] });
		if (url.pathname === `/legal-tools/api/jobs/${jobId}/artifacts/${artifactId}`)
			return route.fulfill({ body: 'PK-test', contentType: 'application/octet-stream' });
		return route.fulfill({ status: 404, body: '' });
	});
	await page.goto('/?pending');
	await page.waitForFunction(() => typeof (window as any).setConfig === 'function');
	await expect(page.getByTestId('custom-case')).toHaveCount(0);
	await expect(page.getByTestId('custom-case-menu')).toHaveCount(0);
	await page.evaluate(() => {
		localStorage.setItem('token', 'synthetic-session-token');
		(window as any).setConfig({ custom_ui: { case: 'true' } });
	});
	await expect(page.getByTestId('custom-case')).toHaveCount(0);
	expect(requests).toEqual([]);
	await page.evaluate(() => (window as any).setConfig({ custom_ui: { case: true } }));
	await expect(page.getByTestId('custom-case-menu')).toHaveCount(1);
	const panel = page.getByTestId('custom-case');
	await expect(panel.getByRole('heading', { level: 1 })).toHaveText('Панель дела: Дело Альфа');
	await expect(page.getByTestId('custom-case-note')).toContainText('Карта дела');
	await expect(page.getByTestId('custom-case-note').getByRole('link', { name: 'Открыть' })).toHaveAttribute('href', '/notes/note-1');
	await expect(page.getByTestId('custom-case-material')).toHaveText(['договор.docx', 'Судебная практика (база знаний)']);
	await expect(page.getByTestId('custom-case-job')).toHaveCount(1);
	await expect(page.getByTestId('custom-case-job').first()).toContainText('Разбор договора — Готово');
	await page.getByRole('button', { name: 'Показать ещё' }).click();
	await expect(page.getByTestId('custom-case-job')).toHaveCount(2);
	await expect(page.getByTestId('custom-case-job').nth(1)).toContainText('Документ по шаблону — Ошибка');
	await expect(page.getByRole('button', { name: 'Показать ещё' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Показать файлы' }).click();
	await expect(page.getByTestId('custom-case-file')).toContainText('отчёт.docx');
	const download = page.waitForEvent('download');
	await page.getByTestId('custom-case-file').getByRole('button', { name: 'Скачать' }).click();
	expect((await download).suggestedFilename()).toBe('отчёт.docx');
	expect(requests).toEqual([
		`/api/v1/folders/${folderId}`,
		`/legal-tools/api/jobs?folder_id=${folderId}&limit=50`,
		`/legal-tools/api/jobs?folder_id=${folderId}&limit=50&cursor=page2`,
		`/legal-tools/api/jobs/${jobId}/artifacts`,
		`/legal-tools/api/jobs/${jobId}/artifacts/${artifactId}`
	]);
	await page.evaluate(() => (window as any).setConfig({ custom_ui: { case: false } }));
	await expect(panel).toHaveCount(0);
	await expect(page.getByTestId('custom-case-disabled')).toBeVisible();
});

test('case panel reports errors without inventing data', async ({ page }) => {
	await page.route('**/api/v1/folders/**', (route) => route.fulfill({ status: 401, json: { detail: 'no' } }));
	await page.route('**/legal-tools/**', (route) => route.fulfill({ status: 403, body: 'private details' }));
	await page.goto('/?pending');
	await page.waitForFunction(() => typeof (window as any).setConfig === 'function');
	await page.evaluate(() => {
		localStorage.setItem('token', 'synthetic-session-token');
		(window as any).setConfig({ custom_ui: { case: true } });
	});
	const panel = page.getByTestId('custom-case');
	await expect(panel.getByRole('alert')).toHaveText(['Не удалось загрузить папку.', 'Папка недоступна для этого аккаунта.']);
	await expect(panel).not.toContainText('private details');
	await expect(panel).not.toContainText('Заданий в этой папке нет.');
	await expect(page.getByTestId('custom-case-job')).toHaveCount(0);
});
