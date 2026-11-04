import { test, expect } from '@playwright/test';
import { jobIdFromMessage, stripJobMarker, stripJobMarkerFromOutput } from '../../src/lib/custom/jobs';
// R4: the U1 marker stays in the stored message but is never shown or copied.
const jobId = '33333333-3333-4333-8333-333333333333';
const otherId = '44444444-4444-4444-8444-444444444444';
const marker = `<!-- legal-tools:job=${jobId} -->`;
const answer = '## Итог\n\nСинтетический разбор.\n\n---\nРасход: 0.1234 USD';

test('strip removes only the exact terminal marker and the blank lines before it', () => {
	expect(stripJobMarker(`${answer}\n\n${marker}`)).toBe(answer);
	expect(stripJobMarker(`${answer}\r\n\r\n${marker}\r\n`)).toBe(answer);
	expect(stripJobMarker(marker)).toBe('');
	const two = `${answer}\n\n<!-- legal-tools:job=${otherId} -->\n\nДальше\n\n${marker}`;
	expect(stripJobMarker(two)).toBe(`${answer}\n\n<!-- legal-tools:job=${otherId} -->\n\nДальше`);
	expect(stripJobMarker(answer)).toBe(answer);
	expect(stripJobMarker('')).toBe('');
	for (const value of [undefined, null, 42, { text: marker }]) expect(stripJobMarker(value)).toBe(value);
	for (const value of [
		`${marker}\nтекст`,
		`Ответ ${jobId}`,
		`${answer}\n\n<!-- legal-tools:job=not-a-uuid -->`,
		`${answer}\n\n<!-- job=${jobId} -->`,
		`${answer}\n\n<!-- другой комментарий -->`,
		`\`\`\`\n${marker}\n\`\`\``
	])
		expect(stripJobMarker(value)).toBe(value);
	// B2 keeps reading the stored text: whatever is removed is exactly what identifies the job.
	expect(jobIdFromMessage(`${answer}\n\n${marker}`)).toBe(jobId);
	expect(jobIdFromMessage(stripJobMarker(`${answer}\n\n${marker}`))).toBeUndefined();
});

test('structured output loses the marker only in the last message text', () => {
	const output = [
		{ type: 'message', id: 'a', content: [{ type: 'output_text', text: 'Первая часть' }] },
		{ type: 'message', id: 'b', content: [
			{ type: 'output_text', text: `${answer}\n\n<!-- legal-tools:` },
			{ type: 'output_text', text: `job=${jobId} -->` }
		] },
		{ type: 'message', id: 'c', content: [{ type: 'output_text', text: '  ' }] }
	];
	const stripped = stripJobMarkerFromOutput(output);
	expect(stripped[0]).toBe(output[0]);
	expect(stripped[1].content.map((p: any) => p.text).join('')).toBe(answer);
	expect(stripped[2]).toBe(output[2]);
	expect(output[1].content[1].text).toBe(`job=${jobId} -->`);
	const plain = [{ type: 'message', content: [{ type: 'output_text', text: answer }] }];
	expect(stripJobMarkerFromOutput(plain)).toBe(plain);
	for (const value of [undefined, null, 'текст', []]) expect(stripJobMarkerFromOutput(value)).toEqual(value);
});

const stored = (withOutput: boolean, text = `${answer}\n\n${marker}`) => ({
	content: text,
	output: withOutput ? [{ type: 'message', id: 'm', status: 'completed', role: 'assistant',
		content: [{ type: 'output_text', text }] }] : [],
	model: { id: 'legal_workflows.contract_review' },
	done: true,
	sources: []
});

for (const card of [false, true])
	for (const withOutput of [false, true])
		test(`real renderer hides the marker: result_card ${card}, ${withOutput ? 'output' : 'content'}`, async ({ page }) => {
			const jobRequests: string[] = [];
			await page.route('**/legal-tools/**', (route) => {
				jobRequests.push(new URL(route.request().url()).pathname);
				return route.fulfill({ status: 403, body: '' });
			});
			await page.goto('/?renderer');
			await page.waitForFunction(() => typeof (window as any).setMessage === 'function');
			await page.evaluate(({ message, card }) => {
				localStorage.setItem('token', 'synthetic-session-token');
				(window as any).setConfig({ custom_ui: { result_card: card } });
				(window as any).setMessage(message);
			}, { message: stored(withOutput), card });
			const prose = page.locator('div.markdown-prose');
			await expect(prose.first()).toContainText('Синтетический разбор.');
			await expect(prose.first()).toContainText('Расход: 0.1234 USD');
			expect(await page.locator('[data-testid="renderer"]').innerHTML()).not.toContain('legal-tools:job');
			await expect(page.getByTestId('custom-result')).toHaveCount(card ? 1 : 0);
			// B2 still finds the job by the stored marker.
			if (card) await expect.poll(() => jobRequests).toContain(`/legal-tools/api/jobs/${jobId}`);
			else expect(jobRequests).toEqual([]);
		});

test('real renderer keeps a marker that is not the exact terminal U1 marker', async ({ page }) => {
	await page.goto('/?renderer');
	await page.waitForFunction(() => typeof (window as any).setMessage === 'function');
	const middle = `Начало\n\n${marker}\n\nКонец`;
	await page.evaluate((message) => (window as any).setMessage(message), stored(true, middle));
	await expect(page.locator('div.markdown-prose').first()).toContainText('Конец');
	expect(await page.locator('[data-testid="renderer"]').innerHTML()).toContain(`legal-tools:job=${jobId}`);
	const loose = `${answer}\n\n<!-- legal-tools:job=not-a-uuid -->`;
	await page.evaluate((message) => (window as any).setMessage(message), stored(true, loose));
	await expect(page.locator('div.markdown-prose').first()).toContainText('Расход');
	expect(await page.locator('[data-testid="renderer"]').innerHTML()).toContain('legal-tools:job=not-a-uuid');
});

for (const withOutput of [false, true])
	test(`copy and insert-to-note take the answer without the marker (${withOutput ? 'output' : 'content'})`, async ({ page, context }) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await page.goto('/?response');
		await page.waitForFunction(() => typeof (window as any).setMessage === 'function');
		await page.evaluate((message) => (window as any).setMessage(message), stored(withOutput));
		await expect(page.locator('div.markdown-prose').first()).toContainText('Расход: 0.1234 USD');
		await page.getByRole('button', { name: 'Copy', exact: true }).click();
		await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(answer);
		await page.getByRole('button', { name: 'Insert into note' }).click();
		await expect(page.getByTestId('inserted')).toHaveText(answer);
		expect(await page.locator('body').innerHTML()).not.toContain('legal-tools:job');
	});
