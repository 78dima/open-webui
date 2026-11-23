// ai-dvokat: отметка значения с листа в разделах, которые берут данные своей ручкой (паспорт, сроки, копии): загрузчик
// раздела подменён — он сразу отдаёт заданный ответ сервиса, разметка — серверной отрисовкой Svelte (без DOM).
// Прежний сервис полей не присылает — отметок нет и ошибок нет.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { readable } from 'svelte/store';
import { render } from 'svelte/server';

let answer: unknown = null;
vi.mock('$lib/custom/case/loader', async (load) => {
	const real = await load<typeof import('./loader')>();
	return {
		...real,
		createLoader: (fn: () => Promise<unknown>, options?: object) => {
			const l = real.createLoader(fn, options);
			l.set(answer);
			return l;
		}
	};
});
const { default: Passport } = await import('../../components/custom/case/Passport.svelte');
const { default: Deadlines } = await import('../../components/custom/case/Deadlines.svelte');
const { default: Copies } = await import('../../components/custom/case/Copies.svelte');

const fixture = (name: string) =>
	JSON.parse(
		readFileSync(new URL(`../../../../tests/custom/fixtures/case/${name}.json`, import.meta.url), 'utf8')
	);
const S = fixture('strings');
const whole = [{ code: 'blurred', reason: 'размыто — переснимите' }];
const ids = (body: string) => [...body.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]);
const MARK_IDS = /own-value|own-person|sheet-check/;
const marks = (body: string) => ids(body).filter((x) => MARK_IDS.test(x));
const state = {
	boot: readable(fixture('case-boot')),
	data: readable(null),
	stale: readable(null),
	api: { get: async () => ({}), url: (p: string) => `/legal-tools/${p}` },
	folderId: 'x',
	refresh: async () => {}
} as any;
const show = (C: any, data: unknown, props: object = {}) => {
	answer = data;
	return render(C, { props: { state, S, hrefOf: (s: string) => `/case/x/${s}`, ...props } }).body;
};

describe('Паспорт', () => {
	const base = fixture('passport');
	it('прежний сервис — без отметок', () => {
		expect(marks(show(Passport, base))).toEqual([]);
	});
	it('номер дела, участник (имя только в одном прочтении), ключевая дата — плашка и строка у своего значения', () => {
		const p = structuredClone(base);
		const field = (k: string) => p.fields.find((f: any) => f.key === k);
		Object.assign(field('case_number').items[0], {
			own_value: [{ a: 'А40-1/2025', b: 'А40-7/2025', url: '/c' }],
			sheet_checks: []
		});
		Object.assign(field('parties').items[0], {
			own_value: [],
			own_person: [{ a: 'ООО «Альфа»', b: '', url: '/q' }],
			sheet_checks: whole
		});
		const body = show(Passport, p);
		expect(marks(body)).toEqual([
			'case-own-value',
			'case-own-value-why',
			'case-own-value-open',
			'case-own-value',
			'case-sheet-check',
			'case-own-person-why',
			'case-own-value-open',
			'case-sheet-check-why'
		]);
		expect(body).toContain('Номер дела прочитан на листе по-разному: «А40-1/2025» / «А40-7/2025».');
		expect(body).toContain('Имя участника есть только в одном прочтении листа: «ООО «Альфа»».');
		expect(body).toContain('Лист записи стоит в «Проверьте листы»: размыто — переснимите.');
	});
});

describe('Сроки', () => {
	const base = fixture('deadlines');
	it('прежний сервис — без отметок', () => {
		expect(marks(show(Deadlines, base))).toEqual([]);
	});
	it('вид прежний: плашка, строка, плашка листа, строка листа — подряд в основании', () => {
		const d = structuredClone(base);
		Object.assign(d.deadlines[0].basis, {
			own_value: [{ a: '11.04.2025', b: '17.04.2025', url: '/legal-tools/case/x/p/9?v=3&hl=1-9&pick=1' }],
			sheet_checks: whole,
			quote_marks: []
		});
		const body = show(Deadlines, d);
		expect(marks(body)).toEqual([
			'case-own-value',
			'case-own-value-why',
			'case-own-value-open',
			'case-sheet-check',
			'case-sheet-check-why'
		]);
		expect(body).toContain('class="pill t w as"');
		expect(body).toContain('Дата срока прочитана на листе-основании по-разному: «11.04.2025» / «17.04.2025».');
	});
});

describe('Копии', () => {
	const base = fixture('copies');
	it('прежний сервис — без отметок', () => {
		expect(marks(show(Copies, base))).toEqual([]);
	});
	it('у обоих документов пары — своя плашка и строки с подписью листа', () => {
		const c = structuredClone(base);
		const pair = c.copies.find((x: any) => x.a && x.b);
		Object.assign(pair.a, { own_value: [{ a: '07.04.2025', b: '01.04.2025', field: 'date', url: '/a' }], sheet_checks: [] });
		Object.assign(pair.b, { own_value: [], sheet_checks: whole });
		const body = show(Copies, c);
		expect(marks(body)).toEqual([
			'case-own-value',
			'case-sheet-check',
			'case-own-value-why',
			'case-own-value-open',
			'case-sheet-check-why'
		]);
		expect(body).toContain(
			`Дата документа (${pair.a.label}) прочитана на его первом листе по-разному: «07.04.2025» / «01.04.2025».`
		);
		expect(body).toContain(`Первый лист документа (${pair.b.label}) стоит в «Проверьте листы»: размыто — переснимите.`);
	});
});
