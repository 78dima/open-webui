// ai-dvokat: отметка значения с листа (пакет 23.11, общий приём А) — слова и адреса из полей сервиса (`marks.ts`),
// общий компонент `ReadingMark` и разделы, которые показывают его без запросов (строки хронологии и сумм, «Проверьте
// листы», «Ближайшие сроки» обзора). Разметка — серверной отрисовкой Svelte (без DOM). Прежний сервис полей не
// присылает — отметок нет и ошибок нет.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readable } from 'svelte/store';
import { render } from 'svelte/server';
import { MARKS, PAIRS_SHOWN, markView, pairPlaces, pairsText, passportMarks, placeUrl } from './marks';
import { checkGroups } from './casepage';
import ReadingMark from '../../components/custom/case/ReadingMark.svelte';
import FactRow from '../../components/custom/case/FactRow.svelte';
import AmountRow from '../../components/custom/case/AmountRow.svelte';
import CheckSheets from '../../components/custom/case/CheckSheets.svelte';
import Overview from '../../components/custom/case/Overview.svelte';

const fixture = (name: string) =>
	JSON.parse(
		readFileSync(new URL(`../../../../tests/custom/fixtures/case/${name}.json`, import.meta.url), 'utf8')
	);
const S = fixture('strings');
const whole = [{ code: 'blurred', reason: 'размыто — переснимите' }];
const P = '/legal-tools/case/x/p/7?v=3';
/** разметка без служебных комментариев Svelte и без меток областей стилей */
const html = (body: string) => body.replace(/<!--[^>]*-->/g, '').replace(/ ?svelte-[a-z0-9]+/g, '');
const ids = (body: string) => [...body.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]);
const MARK_IDS = /own-value|own-person|sheet-check|pair-place/;

describe('placeUrl и pairPlaces: адрес места', () => {
	it('готовый url пары важнее; иначе place_base + hl + pick=1; нет ничего — без адреса', () => {
		expect(placeUrl({ url: '/a', hl: '1-2' }, P)).toBe('/a');
		expect(placeUrl({ hl: '4-9' }, P)).toBe(`${P}&hl=4-9&pick=1`);
		expect(placeUrl({ hl: '4-9' }, null)).toBeUndefined();
		expect(placeUrl({}, P)).toBeUndefined();
	});
	it('пары «Проверьте листы» с местом — ссылки; без place_base мест нет', () => {
		const parts = {
			pair_places: [
				{ a: '300', b: '500', start: 4, end: 7, hl: '4-7' },
				{ a: '12', b: '13', start: 20, end: 22, hl: '20-22' }
			],
			place_base: P
		};
		expect(pairPlaces(parts)).toEqual([
			{ text: '«300» / «500»', url: `${P}&hl=4-7&pick=1` },
			{ text: '«12» / «13»', url: `${P}&hl=20-22&pick=1` }
		]);
		expect(pairPlaces({ pair_places: parts.pair_places })).toEqual([]);
		expect(pairPlaces(undefined)).toEqual([]);
	});
});

describe('markView: что показать по полям сервиса', () => {
	const pair = { a: '12.05.2025', b: '12.05.2026', url: `${P}&hl=10-20&pick=1` };
	it('прежний сервис (полей нет) и пустые поля — ничего', () => {
		for (const m of [undefined, null, {}, { own_value: [], own_person: [], sheet_checks: [] }])
			expect(markView(m, S, MARKS.fact)).toEqual({ own: null, sheet: null, lines: [] });
	});
	it('дата записи хронологии — те же слова, что до общего компонента', () => {
		const v = markView({ own_value: [pair] }, S, MARKS.fact);
		expect(v.own).toEqual({ text: S.map_own_value_pill, url: pair.url, title: '«12.05.2025» / «12.05.2026»' });
		expect(v.lines).toEqual([
			{
				kind: 'own',
				text: 'Дата этой записи прочитана на листе по-разному: «12.05.2025» / «12.05.2026».',
				url: pair.url
			}
		]);
	});
	it('имя лица: пара — одной строкой, «только в одном прочтении» (b пусто) — своей; плашка ведёт к имени', () => {
		const v = markView(
			{
				own_person: [
					{ a: 'Иванов И. И.', b: 'Иванов Н. И.', url: '/p1' },
					{ a: 'Петров П. П.', b: '', url: '/p2' }
				]
			},
			S,
			MARKS.fact
		);
		expect(v.own?.url).toBe('/p1');
		expect(v.lines.map((l) => [l.kind, l.text, l.url])).toEqual([
			['person', 'Имя лица этой записи прочитано на листе по-разному: «Иванов И. И.» / «Иванов Н. И.».', '/p1'],
			['person', 'Имя лица этой записи есть только в одном прочтении листа: «Петров П. П.».', '/p2']
		]);
	});
	it('сумма, срок, второй лист записи — свои слова', () => {
		const one = { own_value: [{ a: '1 250 000', b: '1 250 800', url: '/s' }], sheet_checks: whole };
		expect(markView(one, S, MARKS.amount).lines.map((l) => l.text)).toEqual([
			'Значение этой записи прочитано на листе по-разному: «1 250 000» / «1 250 800».',
			'Лист суммы стоит в «Проверьте листы»: размыто — переснимите.'
		]);
		expect(markView(one, S, MARKS.deadline).lines.map((l) => l.text)).toEqual([
			'Дата срока прочитана на листе-основании по-разному: «1 250 000» / «1 250 800».',
			'Лист-основание стоит в «Проверьте листы»: размыто — переснимите.'
		]);
		expect(
			markView({ ...one, own_person: [{ a: 'Сидоров', b: '', url: '/n' }] }, S, MARKS.factMore).lines.map(
				(l) => l.text
			)
		).toEqual([
			'На втором листе записи дата прочитана по-разному: «1 250 000» / «1 250 800».',
			'На втором листе записи имя лица есть только в одном прочтении: «Сидоров».',
			'Второй лист записи стоит в «Проверьте листы»: размыто — переснимите.'
		]);
	});
	it('паспорт: номер дела, дата, сумма, участник; лист записи', () => {
		const own = { own_value: [{ a: 'А40-1/2025', b: 'А40-7/2025', url: '/c' }] };
		expect(markView(own, S, passportMarks('case_number')).lines[0].text).toBe(
			'Номер дела прочитан на листе по-разному: «А40-1/2025» / «А40-7/2025».'
		);
		expect(markView(own, S, passportMarks('key_dates')).lines[0].text).toMatch(/^Дата прочитана/);
		expect(markView(own, S, passportMarks('key_amounts')).lines[0].text).toMatch(/^Сумма прочитана/);
		expect(markView(own, S, passportMarks('court')).lines[0].text).toMatch(/^Значение прочитано/);
		expect(passportMarks('parties')).toBe(MARKS.party);
		const party = markView(
			{ own_person: [{ a: 'ООО «Альфа»', b: '', url: '/q' }], sheet_checks: whole },
			S,
			MARKS.party
		);
		expect(party.lines.map((l) => l.text)).toEqual([
			'Имя участника есть только в одном прочтении листа: «ООО «Альфа»».',
			'Лист записи стоит в «Проверьте листы»: размыто — переснимите.'
		]);
	});
	it('опись и копии: дата и номер — по полю пары, отдельными строками; у копии — подпись листа', () => {
		const d = {
			own_value: [
				{ a: '12.03.25', b: '13.03.25', field: 'date', url: '/d' },
				{ a: '145', b: '146', field: 'number', url: '/n' }
			],
			sheet_checks: whole
		};
		expect(markView(d, S, MARKS.doc).lines.map((l) => [l.text, l.url])).toEqual([
			['Дата документа прочитана на его первом листе по-разному: «12.03.25» / «13.03.25».', '/d'],
			['Номер документа прочитан на его первом листе по-разному: «145» / «146».', '/n'],
			['Первый лист документа стоит в «Проверьте листы»: размыто — переснимите.', undefined]
		]);
		expect(markView(d, S, MARKS.copy, { label: 'т. 1, л.д. 3' }).lines.map((l) => l.text)).toEqual([
			'Дата документа (т. 1, л.д. 3) прочитана на его первом листе по-разному: «12.03.25» / «13.03.25».',
			'Номер документа (т. 1, л.д. 3) прочитан на его первом листе по-разному: «145» / «146».',
			'Первый лист документа (т. 1, л.д. 3) стоит в «Проверьте листы»: размыто — переснимите.'
		]);
	});
	it('таблицы и проходы: ответ, место, повтор места с подписью листа', () => {
		const a = { own_value: [{ a: '250 000', b: '250 800', url: '/t' }], sheet_checks: whole };
		expect(markView(a, S, MARKS.cell).lines.map((l) => l.text)).toEqual([
			'Значение в ответе прочитано на листе по-разному: «250 000» / «250 800».',
			'Лист ответа стоит в «Проверьте листы»: размыто — переснимите.'
		]);
		expect(markView({ sheet_checks: whole }, S, MARKS.finding).lines[0].text).toBe(
			'Лист этого места стоит в «Проверьте листы»: размыто — переснимите.'
		);
		expect(markView({ sheet_checks: whole }, S, MARKS.findingAlso, { label: 'т. 2, л.д. 4' }).lines[0].text).toBe(
			'Лист т. 2, л.д. 4 стоит в «Проверьте листы»: размыто — переснимите.'
		);
	});
	it('нет строки у сервиса — нет элемента', () => {
		const m = { own_value: [pair], own_person: [{ a: 'x', b: 'y' }], sheet_checks: whole };
		const none = markView(m, {}, MARKS.fact);
		expect(none).toEqual({ own: null, sheet: null, lines: [] });
		const noOwn = markView(m, { ...S, map_own_date: undefined }, MARKS.fact);
		expect(noOwn.lines.map((l) => l.kind)).toEqual(['person', 'sheet']);
	});
	it('пары — одной функцией и пределом списка «Проверьте листы»: сверх трёх — «и ещё N» (уборка ревью пакета 2)', () => {
		const four = ['1', '2', '3', '4'].map((x) => ({ a: x, b: x + '0' }));
		expect(PAIRS_SHOWN).toBe(3);
		expect(pairsText(four, S)).toBe('«1» / «10»; «2» / «20»; «3» / «30»' + S.text_disagree_more.replace('{n}', '1'));
		const v = markView({ own_value: four.map((p) => ({ ...p, url: P })) }, S, MARKS.fact);
		expect(v.lines[0].text).toContain(pairsText(four, S));
		expect(v.own?.title).toBe(pairsText(four, S));
	});
	it('у пары без url адрес собирается из place_base и места', () => {
		const v = markView({ own_value: [{ a: '1', b: '2', hl: '3-4' }], place_base: P }, S, MARKS.amount);
		expect(v.own?.url).toBe(`${P}&hl=3-4&pick=1`);
		expect(v.lines[0].url).toBe(`${P}&hl=3-4&pick=1`);
	});
});

describe('ReadingMark: разметка', () => {
	const m = {
		own_value: [{ a: '11.04.2025', b: '17.04.2025', url: '/o' }],
		own_person: [{ a: 'Иванов', b: '', url: '/i' }],
		sheet_checks: whole
	};
	it('all: плашка и её строка подряд, затем лист целиком (порядок прежнего срока)', () => {
		const body = render(ReadingMark, { props: { m, S, keys: MARKS.fact } }).body;
		expect(ids(body)).toEqual([
			'case-own-value',
			'case-own-value-why',
			'case-own-value-open',
			'case-own-person-why',
			'case-own-value-open',
			'case-sheet-check',
			'case-sheet-check-why'
		]);
		expect(html(body)).toContain(
			'<a class="pill t w " href="/o" target="_blank" rel="noopener" data-testid="case-own-value">прочитано по-разному</a>'
		);
	});
	it('pills / lines, значок, свой testid, подсказка', () => {
		const pills = render(ReadingMark, { props: { m, S, part: 'pills', icon: true, tip: true } }).body;
		expect(ids(pills)).toEqual(['case-own-value', 'case-sheet-check']);
		expect(pills).toContain('title="«11.04.2025» / «17.04.2025»; «Иванов»"');
		expect(pills).toContain('title="размыто — переснимите"');
		expect(pills).toContain('use href="#cg-i-al"');
		const lines = render(ReadingMark, {
			props: { m, S, keys: MARKS.factMore, part: 'lines', testid: 'case-more', lineClass: 'why' }
		}).body;
		expect(ids(lines)).toEqual([
			'case-more-own-value-why',
			'case-more-own-value-open',
			'case-more-own-person-why',
			'case-more-own-value-open',
			'case-more-sheet-check-why'
		]);
		expect(lines).toContain('class="sm c-warn why"');
	});
	it('без адреса — плашка без ссылки и строка без «Открыть лист»', () => {
		const body = render(ReadingMark, { props: { m: { own_value: [{ a: '1', b: '2' }] }, S } }).body;
		expect(ids(body)).toEqual(['case-own-value', 'case-own-value-why']);
		expect(html(body)).toContain('<span class="pill t w " data-testid="case-own-value">');
	});
	it('прежний сервис — пусто', () => {
		expect(ids(render(ReadingMark, { props: { m: {}, S } }).body)).toEqual([]);
		expect(ids(render(ReadingMark, { props: { m: undefined, S } }).body)).toEqual([]);
	});
});

describe('Хронология и суммы на общем компоненте', () => {
	const facts = fixture('facts').facts;
	const amounts = fixture('amounts').amounts;
	it('прежний сервис: строки без отметок и без ошибок', () => {
		for (const f of facts) expect(ids(render(FactRow, { props: { f, S } }).body).filter((x) => MARK_IDS.test(x))).toEqual([]);
		for (const a of amounts) expect(ids(render(AmountRow, { props: { a, S } }).body).filter((x) => MARK_IDS.test(x))).toEqual([]);
	});
	it('запись: дата, имя лица, второй лист — отдельными строками; плашки — в строке пометок', () => {
		const f = {
			...facts[0],
			own_value: [{ a: '12.05.2025', b: '12.05.2026', url: '/d' }],
			own_person: [{ a: 'Иванов', b: '', url: '/i' }],
			sheet_checks: [],
			more: {
				label: 'т. 4, л.д. 113',
				url: '/m',
				own_value: [{ a: '01.02.2025', b: '07.02.2025', url: '/m1' }],
				own_person: [],
				sheet_checks: whole,
				quote_marks: [],
				place_base: null
			}
		};
		const body = render(FactRow, { props: { f, S } }).body;
		expect(ids(body).filter((x) => MARK_IDS.test(x))).toEqual([
			'case-own-value',
			'case-own-value-why',
			'case-own-value-open',
			'case-own-person-why',
			'case-own-value-open',
			'case-more-own-value-why',
			'case-more-own-value-open',
			'case-more-sheet-check-why'
		]);
		expect(body).toContain('Имя лица этой записи есть только в одном прочтении листа: «Иванов».');
		expect(body).toContain('На втором листе записи дата прочитана по-разному: «01.02.2025» / «07.02.2025».');
		expect(body).toContain('Второй лист записи стоит в «Проверьте листы»: размыто — переснимите.');
		expect(body).toContain('href="/m1"');
	});
	it('сумма: плашки со значком, строки — во всю ширину строки таблицы (класс why)', () => {
		const a = { ...amounts[0], own_value: [{ a: '1 250 000', b: '1 250 800', url: '/s' }], sheet_checks: whole };
		const body = html(render(AmountRow, { props: { a, S } }).body);
		expect(ids(body).filter((x) => MARK_IDS.test(x))).toEqual([
			'case-own-value',
			'case-sheet-check',
			'case-own-value-why',
			'case-own-value-open',
			'case-sheet-check-why'
		]);
		expect(body).toContain('<p class="sm c-warn why" data-testid="case-own-value-why">');
		expect(body).toContain('<use href="#cg-i-al">');
	});
});

describe('«Проверьте листы» и «Ближайшие сроки» обзора', () => {
	const ov = fixture('case-overview');
	const boot = fixture('case-boot');
	const stateOf = (data: unknown) =>
		({
			boot: readable(boot),
			data: readable(data),
			stale: readable(null),
			api: { get: async () => ({}) },
			folderId: 'x',
			refresh: async () => {}
		}) as any;
	const withPlaces = () => {
		const d = structuredClone(ov);
		const r = d.overview.check_sheets.find((x: any) => x.code === 'text_disagree');
		r.parts.pair_places = [{ a: '066328', b: '698105', start: 10, end: 16, hl: '10-16' }];
		r.parts.place_base = '/legal-tools/case/x/p/645?v=9';
		return d;
	};
	it('у пары с местом — ссылка к месту; состав и порядок групп и строк прежние', () => {
		const before = checkGroups(ov.overview.check_sheets, ov.overview.volumes, S);
		const after = checkGroups(withPlaces().overview.check_sheets, ov.overview.volumes, S);
		const shape = (g: typeof before) => g.map((x) => [x.id, x.rows.map((r) => [r.key, r.detail, r.sheets])]);
		expect(shape(after)).toEqual(shape(before));
		const row = after.flatMap((g) => g.rows).find((r) => r.code === 'text_disagree')!;
		expect(row.places).toEqual([
			{ text: '«066328» / «698105»', url: '/legal-tools/case/x/p/645?v=9&hl=10-16&pick=1' }
		]);
		expect(before.flatMap((g) => g.rows).every((r) => r.places.length === 0)).toBe(true);
		const body = render(CheckSheets, { props: { state: stateOf(withPlaces()), S } }).body;
		expect(body).toContain('href="/legal-tools/case/x/p/645?v=9&amp;hl=10-16&amp;pick=1"');
		expect(body).toContain(S.map_pair_places);
		// ссылка на лист в начале строки остаётся
		expect(body).toContain('href="/legal-tools/case/ccfd097b-11c7-498d-a1e7-bf4ed19a30ff/p/645"');
	});
	it('прежний сервис (без pair_places) — ссылок к месту нет', () => {
		const body = render(CheckSheets, { props: { state: stateOf(ov), S } }).body;
		expect(ids(body).filter((x) => x.startsWith('case-check-pair'))).toEqual([]);
	});
	it('ближайший срок с расходящейся датой — та же отметка, что в «Сроках»; без полей — без отметки', () => {
		const d = structuredClone(ov);
		Object.assign(d.deadlines_next[0].basis, {
			own_value: [{ a: '11.12.2026', b: '17.12.2026', url: '/legal-tools/case/x/p/640?v=1&hl=1-9&pick=1' }],
			sheet_checks: whole
		});
		const hrefOf = (s: string) => `/case/x/${s}`;
		const body = render(Overview, { props: { state: stateOf(d), S, hrefOf } }).body;
		const box = body.slice(body.indexOf('data-testid="case-deadlines"'), body.indexOf('data-testid="case-composition"'));
		expect(ids(box).filter((x) => MARK_IDS.test(x))).toEqual([
			'case-own-value',
			'case-own-value-why',
			'case-own-value-open',
			'case-sheet-check',
			'case-sheet-check-why'
		]);
		expect(box).toContain('Дата срока прочитана на листе-основании по-разному: «11.12.2026» / «17.12.2026».');
		const plain = render(Overview, { props: { state: stateOf(ov), S, hrefOf } }).body;
		expect(ids(plain).filter((x) => MARK_IDS.test(x))).toEqual([]);
	});
	it('пауза шага (Н-4): у плашки обзора нет «Пауза с» без времени — «Обработка на паузе»; общая пауза — со временем', () => {
		const hrefOf = (s: string) => `/case/x/${s}`;
		const view = { kind: 'paused', reason: 'step', since: null, reasons: [], sweeps: 0 };
		const work = { busy: true, groups: { cards: 1 }, running: {}, sweeps: 0, stalled: false, paused_groups: ['cards'], view };
		const pill = (d: unknown) => {
			const body = render(Overview, { props: { state: stateOf(d), S, hrefOf } }).body;
			const at = body.indexOf('data-testid="case-state-paused"');
			return at < 0 ? null : body.slice(at, body.indexOf('</span>', at)).replace(/<[^>]+>/g, '').replace(/^[^>]*>/, '').trim();
		};
		const step = pill({ ...structuredClone(ov), work, paused: null });
		expect(step).toBe(S.my_cases_paused[0].toLocaleUpperCase('ru-RU') + S.my_cases_paused.slice(1));
		expect(step).not.toContain(S.overview_state_paused.replace(' {time}', ''));
		const since = '2026-11-23T15:00:00+00:00';
		const manual = pill({
			...structuredClone(ov),
			work: { ...work, paused_groups: ['cards'], view: { ...view, reason: 'daily', since } },
			paused: { reason: 'daily', since, groups: null }
		});
		expect(manual?.startsWith(S.overview_state_paused.replace(' {time}', ''))).toBe(true);
		expect(manual).not.toBe(S.overview_state_paused.replace(' {time}', ''));
	});
});
