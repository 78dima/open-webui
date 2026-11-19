// ai-dvokat: раздел «Копии и расхождения» на стенде компонентов (макет K-copies; опись § 2.11).
import { test, expect } from '@playwright/test';
import { F, S, fixture, noSideScroll, openSection, refresh, writes } from './casekit';

const copies = () => {
	const d = fixture('copies');
	// пример сервиса — только похожие документы; добавлены настоящая копия, пара с ушедшим документом и пятая пара
	d.copies.push({ ...d.copies[0], id: 90, same_document: true, a: { ...d.copies[0].a, title: 'Договор поставки' }, b: null });
	d.copies.push({ ...d.copies[1], id: 91 });
	return d;
};

test.describe('«Копии и расхождения», 1280', () => {
	test.use({ viewport: { width: 1280, height: 1100 } });

	test('два блока; пара свёрнута, по раскрытию — расхождения с местом на листах; «Показать ещё»; раскрытое переживает перечитывание', async ({ page }) => {
		const { calls } = await openSection(page, { section: 'copies', routes: { copies: copies() } });
		await expect(page.getByTestId('case-copies-hint')).toHaveText(S.copies_hint);
		const real = page.getByTestId('case-copies-real');
		await expect(real.getByRole('heading')).toHaveText(S.pairs_real_title);
		await expect(real.locator('.cnt')).toHaveText('1');
		await expect(real.getByTestId('case-copy')).toContainText(S.copies_doc_gone);
		const other = page.getByTestId('case-copies-other');
		await expect(other.getByRole('heading')).toHaveText(S.pairs_similar_title);
		await expect(other).toContainText(S.pairs_similar_note);
		await expect(other.locator('.cnt')).toHaveText('5');
		const pairs = other.getByTestId('case-copy');
		await expect(pairs).toHaveCount(4);
		await other.getByRole('button', { name: 'Показать ещё 1' }).click();
		await expect(pairs).toHaveCount(5);
		const first = pairs.first();
		await expect(first).toContainText('Счёт на оплату — т. 4, л.д. 145, 07.04.2025');
		await expect(first).toContainText('сходство текста 94 %; расхождений:');
		await expect(first.getByRole('link').first()).toHaveAttribute('href', `/legal-tools/case/${F}/p/772`);
		await expect(first.getByTestId('case-copy-diffs')).toHaveCount(0); // свёрнута
		await first.getByRole('button', { name: S.expand }).click();
		const diffs = first.getByTestId('case-copy-diffs').first();
		await expect(diffs.locator('> .row')).toHaveCount(3);
		await expect(diffs.locator('> .row').first()).toContainText('«Согласно»');
		await expect(diffs.locator('> .row').first().getByRole('link').first()).toHaveAttribute('href', /\/p\/772\?hl=35-45$/);
		await expect(diffs.locator('> .row').first().getByRole('link').first()).toHaveAttribute('target', '_blank');
		await expect(diffs.locator('> .row').first().locator('.pill')).toHaveText(S.copies_note_ocr);
		const src = copies().copies[0].differences.filter((x: any) => x.shown).length;
		await first.getByRole('button', { name: new RegExp(`^Показать ещё ${src - 3} расхождени`) }).click();
		await expect(diffs.locator('> .row')).toHaveCount(src);
		const before = calls.filter((c) => c.path === '/copies').length;
		await refresh(page);
		await expect.poll(() => calls.filter((c) => c.path === '/copies').length).toBeGreaterThan(before);
		await expect(diffs.locator('> .row')).toHaveCount(src);
		expect(writes(calls)).toEqual([]);
	});

	test('копий нет — сказано; раздел не пришёл — ошибка и «Повторить»', async ({ page }) => {
		let fail = true;
		await openSection(page, { section: 'copies', boot: { can_write: false, is_owner: false }, routes: { copies: (r: any) => (fail ? r.fulfill({ status: 500, json: { detail: 'сбой сервиса' } }) : r.fulfill({ json: fixture('copies') })) } });
		await expect(page.getByTestId('case-copies-error')).toContainText('Не получилось: сбой сервиса');
		fail = false;
		await page.getByTestId('case-copies-error').getByRole('button', { name: S.retry }).click();
		await expect(page.getByTestId('case-copies-real')).toContainText(S.copies_empty);
		await expect(page.getByTestId('case-copies-other').locator('.cnt')).toHaveText('4');
	});
});

test('«Копии и расхождения» на телефоне 360: без прокрутки вбок, тёмная схема', async ({ page }) => {
	await page.setViewportSize({ width: 360, height: 800 });
	await openSection(page, { section: 'copies', dark: true, routes: { copies: copies() } });
	await page.getByTestId('case-copy').nth(1).getByRole('button', { name: S.expand }).click();
	await noSideScroll(page);
});
