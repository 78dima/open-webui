import { describe, expect, it } from 'vitest';
import {
	buildTextSegments,
	caseRefHref,
	codePointsToUtf16,
	copyLine,
	currentSheetHref,
	isBackSide,
	isSpaCaseHref,
	normalizeSheetText,
	sheetPageHref,
	utf16ToCodePoints
} from './sheet';

describe('утилиты просмотрщика листа и /ref', () => {
	it('copyLine сохраняет точный формат ссылки и цитаты из sheetg.js', () => {
		expect(copyLine('т. 4, л.д. 16', 'https://chat.example/case/f-1/p/645', 42, null)).toBe(
			'т. 4, л.д. 16 https://chat.example/case/f-1/p/645'
		);
		expect(
			copyLine('т. 4, л.д. 16', 'https://chat.example/case/f-1/p/645', 42, {
				a: 10,
				b: 25,
				text: 'Договор № 12'
			})
		).toBe('«Договор № 12» (т. 4, л.д. 16) https://chat.example/case/f-1/p/645?v=42&hl=10-25');
		// без readId — обычная ссылка без цитаты
		expect(
			copyLine('т. 4, л.д. 16', 'https://chat.example/case/f-1/p/645', null, {
				a: 0,
				b: 5,
				text: 'Текст'
			})
		).toBe('т. 4, л.д. 16 https://chat.example/case/f-1/p/645');
	});

	it('buildTextSegments корректно размечает hl и edited_spans, включая пересечения', () => {
		const segs = buildTextSegments('Договор № 817 от 12.03.2025', [0, 13], [[10, 13]]);
		expect(segs).toEqual([
			{ text: 'Договор № ', hl: true, edited: false },
			{ text: '817', hl: true, edited: true },
			{ text: ' от 12.03.2025', hl: false, edited: false }
		]);
		// выход за границы текста игнорируется
		expect(buildTextSegments('abc', [0, 99], [[5, 10]])).toEqual([
			{ text: 'abc', hl: false, edited: false }
		]);
		expect(buildTextSegments('', [0, 1], [])).toEqual([]);
	});

	it('isSpaCaseHref отличает внутренние маршруты /case/... от /legal-tools/... и внешних URL', () => {
		expect(isSpaCaseHref('/case/f1/p/12')).toBe(true);
		expect(isSpaCaseHref('/case/f1/ref?t=1&l=5')).toBe(true);
		expect(isSpaCaseHref('/case')).toBe(true);
		expect(isSpaCaseHref('/legal-tools/case/f1/p/12')).toBe(false);
		expect(isSpaCaseHref('https://example.com/case/f1/p/12')).toBe(false);
		expect(isSpaCaseHref(null)).toBe(false);
	});

	it('sheetPageHref, caseRefHref и currentSheetHref собирают чистые SPA-адреса', () => {
		expect(sheetPageHref('f 1', 42, { v: 7, hl: '1-5', pick: true })).toBe(
			'/case/f%201/p/42?v=7&hl=1-5&pick=1'
		);
		expect(caseRefHref('f1', { t: '5/1', l: '45', side: 'back' })).toBe(
			'/case/f1/ref?t=5%2F1&l=45&side=back'
		);
		expect(
			currentSheetHref(new URL('https://chat.example/case/f1/p/42?v=7&hl=1-5&pick=1&x=2'))
		).toBe('/case/f1/p/42?x=2');
	});

	it('перевод смещений UTF-16 ↔ кодовые точки учитывает суррогатные пары', () => {
		const whole = 'А😀БВ';
		// 'А' (1 u16, 1 cp), '😀' (2 u16, 1 cp), 'Б' (1 u16, 1 cp)
		expect(utf16ToCodePoints(whole, 3)).toBe(2);
		expect(codePointsToUtf16(whole, 2)).toBe(3);
	});

	it('normalizeSheetText и buildTextSegments нормализуют \\r\\n и одиночный \\r в \\n в кодовых точках сервера', () => {
		const raw = 'Строка 1\r\nСтрока 2\rДоговор';
		const norm = normalizeSheetText(raw);
		expect(norm).toBe('Строка 1\nСтрока 2\nДоговор');
		// 'Строка 1\n' (9) + 'Строка 2\n' (9) = 18; 'Договор' = [18, 25]
		const start = utf16ToCodePoints(norm, norm.indexOf('Договор'));
		const end = utf16ToCodePoints(norm, norm.indexOf('Договор') + 'Договор'.length);
		expect([start, end]).toEqual([18, 25]);
		expect(buildTextSegments(raw, [start, end], [[9, 17]])).toEqual([
			{ text: 'Строка 1\n', hl: false, edited: false },
			{ text: 'Строка 2', hl: false, edited: true },
			{ text: '\n', hl: false, edited: false },
			{ text: 'Договор', hl: true, edited: false }
		]);
		expect(normalizeSheetText(null)).toBe('');
		expect(normalizeSheetText(undefined)).toBe('');
	});

	it('buildTextSegments переводит hl и edited_spans из кодовых точек при суррогатных парах (эмодзи) до среза', () => {
		// '📄 ' — 2 cp (3 u16), 'Договор ' — 8 cp, '😀 ' — 2 cp (3 u16), '№ 817' — 5 cp
		const text = '📄 Договор 😀 № 817';
		// кодовые точки: 'Договор' = [2, 9], '№ 817' = [12, 17]
		expect(buildTextSegments(text, [12, 17], [[2, 9]])).toEqual([
			{ text: '📄 ', hl: false, edited: false },
			{ text: 'Договор', hl: false, edited: true },
			{ text: ' 😀 ', hl: false, edited: false },
			{ text: '№ 817', hl: true, edited: false }
		]);
		// выход за пределы числа кодовых точек (даже если <= text.length в UTF-16) игнорируется
		expect(buildTextSegments('📄А', [0, 3], [[1, 3]])).toEqual([
			{ text: '📄А', hl: false, edited: false }
		]);
	});

	it('isBackSide распознаёт back и русские варианты оборота', () => {
		expect(isBackSide('back')).toBe(true);
		expect(isBackSide('об.')).toBe(true);
		expect(isBackSide('оборот')).toBe(true);
		expect(isBackSide('face')).toBe(false);
		expect(isBackSide(null)).toBe(false);
	});
});
