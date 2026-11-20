// ai-dvokat: ядро разделов страницы дела без DOM — файлы и тома, карта дела, таблицы, перечитывание раздела.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { get } from 'svelte/store';
import { fileName } from './api';
import { createLoader } from './loader';
import { fmt } from './strings';
import {
	dateNote,
	dateParts,
	deadlineDates,
	editField,
	editValue,
	lines,
	passportName,
	rub,
	stateLines
} from './mapcore';
import {
	blockKey,
	docNotes,
	errorText,
	factText,
	fileFacts,
	fileLine,
	fileStatus,
	labelSource,
	numberingChecks,
	query,
	reasonText,
	suggestText
} from './sections';
import {
	canCheck,
	copyText,
	coverage,
	needsConfirm,
	placeQuery,
	refParts,
	restText,
	scopeQuery,
	stateText,
	statusWord,
	summaryText,
	usd,
	type Sweep
} from './tablescore';

const fixture = (name: string) =>
	JSON.parse(
		readFileSync(
			new URL(`../../../../tests/custom/fixtures/case/${name}.json`, import.meta.url),
			'utf8'
		)
	);
const S = fixture('strings');

describe('файлы и тома', () => {
	it('факты файла: свои факты страницы поверх строки обзора', () => {
		const f = fileFacts(
			{ id: 1, filename: 'a.pdf', status: 'queued', pages: null },
			{ status: 'reading', pages: 10, pages_indexed: 4, estimate_usd: '0.05' }
		);
		expect(f).toMatchObject({
			filename: 'a.pdf',
			status: 'reading',
			pages: 10,
			pages_indexed: 4,
			estimate_usd: '0.05'
		});
		expect(fileStatus(f, S)).toEqual({ text: 'распознаётся: 4 из 10', tone: 'info' });
		expect(fileStatus({ status: 'blocked', block_reason: 'av_limit' }, S).text).toBe(
			`заблокирован: ${S.block_av_limit}`
		);
		expect(fileStatus({ status: 'что-то новое' }, S).text).toBe('что-то новое');
		expect(blockKey('нет такого', S)).toBe('block_other');
	});
	it('факт входа: цифровой текст у всех, сканы — только если все, иначе числом', () => {
		expect(factText({ layer_all: true }, S)).toBe(S.upload_fact_layer);
		expect(factText({ pages: 5, image_pages: 5, layer_pages: 0 }, S)).toBe(S.upload_fact_scan);
		expect(factText({ pages: 312, layer_pages: 12, image_pages: 300 }, S)).toBe(
			'цифровой текст у 12 из 312 страниц'
		);
		expect(factText({ photo: true }, S)).toBe('');
		expect(
			fileLine({ pages: 14, input_kind: 'photo', input_fact: { photo: true } }, 'volume', S)
		).toBe('14 страниц · фото');
		expect(fileLine({ pages: 1, input_kind: 'volume' }, 'ecase', S)).toBe('1 страница');
	});
	it('подсказка «продолжение тома»: по номерам, по описи, несколько томов — без подтверждения', () => {
		const label = () => '5/1';
		expect(
			suggestText({ volume_id: 5, basis: 'sequence', last: '312', first: '313' }, S, label)
		).toBe(
			'Похоже на продолжение т. 5/1: последний лист 312, этот файл начинается с 313. Подтвердить?'
		);
		expect(suggestText({ volume_id: 5, basis: 'inventory', first: '40' }, S, label)).toContain(
			'внутренняя опись т. 5/1 называет л. 40'
		);
		expect(
			suggestText({ volume_id: null, candidates: [{ label: '4' }, { label: '5/1' }] }, S, label)
		).toBe('Похоже на продолжение одного из томов: Том 4, Том 5/1 — укажите том');
		expect(suggestText({ volume_id: null, candidates: [] }, S, label)).toBe('');
		expect(suggestText(null, S, label)).toBe('');
	});
	it('откуда номер тома и замечания тома по нумерации', () => {
		const v = { id: 4, label: '4', status: 'inventory_ready' };
		expect(
			labelSource(v, { label_source: 'cover', label_page_id: 7, label_checked: false }, S)
		).toEqual({
			text: S.label_source_cover_g,
			pageId: 7,
			sheet: '',
			unchecked: true
		});
		expect(labelSource(v, { label_source: 'lawyer', label_checked: false }, S)?.unchecked).toBe(
			false
		);
		expect(labelSource(v, {}, S)).toBeNull();
		const d = fixture('case-overview-processing');
		const c = numberingChecks(d, 4);
		expect(c.total).toBeGreaterThan(0);
		expect(c.groups.reduce((n, g) => n + g.n, 0)).toBe(c.total);
		expect(c.groups.every((g) => S[g.key])).toBe(true);
		expect(numberingChecks(d, 999)).toEqual({ total: 0, groups: [] });
	});
	it('пометки строки описи и строка запроса', () => {
		expect(
			docNotes(
				{
					id: 1,
					label: '',
					first_page_id: 1,
					last_page_id: 1,
					sheets: 1,
					unchecked: ['title', 'date'],
					overlap: [{ label: '«Счёт»' }, null],
					uncovered: true
				},
				S
			)
		).toEqual([
			S.inventory_unchecked,
			S.inventory_date_unchecked,
			'пересекается с документом «Счёт»',
			S.inventory_uncovered
		]);
		expect(query({ page: '0', volume: '', hidden: false, q: 'т. 4' })).toBe('?page=0&q=%D1%82.+4');
		expect(query({})).toBe('');
		expect(
			fileName(
				`attachment; filename="a.pdf"; filename*=UTF-8''${encodeURIComponent('Выписка т. 4.pdf')}`
			)
		).toBe('Выписка т. 4.pdf');
		expect(fileName('attachment; filename="a.pdf"')).toBe('a.pdf');
		expect(fileName(null)).toBe('');
	});
});

describe('карта дела', () => {
	it('дата записи, пометка даты, даты срока, сумма числом', () => {
		expect(dateParts({ date_as_written: '«05» 02 2025 г.', date_value: '2025-02-05' }, S)).toEqual({
			text: '«05» 02 2025 г.',
			value: '05.02.2025',
			none: false
		});
		expect(dateParts({ date_as_written: '05.02.2025', date_value: '2025-02-05' }, S).value).toBe(
			''
		);
		expect(dateParts({ date_value: '2025-02-05' }, S).text).toBe('05.02.2025');
		expect(dateParts({}, S)).toEqual({ text: S.map_date_none, value: '', none: true });
		expect(dateNote({ date_note: 'unchecked' }, S)).toBe(S.map_date_unchecked);
		expect(deadlineDates({ start_date: '2026-11-13', end_date: '2026-12-11' }, S).text).toBe(
			'с 13.11.2026 по 11.12.2026'
		);
		expect(deadlineDates({ end_date: '2027-01-20' }, S).text).toBe('до 20.01.2027');
		expect(deadlineDates({}, S)).toEqual({ text: S.map_deadline_no_dates, none: true });
		expect(rub('1597806.6')).toBe('1 597 806,60');
		expect(rub(6931)).toBe('6 931,00');
		expect(rub('не число')).toBe('не число');
		expect(lines(' а \n\n б ')).toEqual(['а', 'б']);
	});
	it('слова правки для истории и подписи полей; строки состояния', () => {
		expect(passportName(S, 'court')).toBe(S.map_pfc_court);
		expect(passportName(S, 'stage')).toBe(S.map_pf_stage);
		expect(passportName(S, 'новое_поле')).toBe('новое_поле');
		expect(editField('fact', 'status', 1, S)).toBe(S.map_f_status);
		expect(editField('deadline', 'confirmed', 1, S)).toBe(S.map_d_confirmed);
		expect(editField('passport', 'value', 'claims', S)).toBe(S.map_pf_claims);
		expect(editValue('fact', 'status', 'established', S)).toBe(S.map_status_established);
		expect(editValue('fact', 'chronology', 'process', S)).toBe(S.map_line_process);
		expect(editValue('deadline', 'end_date', '2026-12-11', S)).toBe('11.12.2026');
		expect(editValue('fact', 'hidden', true, S)).toBe(S.map_yes);
		expect(editValue('fact', 'persons', ['А', 'Б'], S)).toBe('А, Б');
		expect(editValue('passport', 'value', [{ value: 'А' }, { value: 'Б' }], S)).toBe('А; Б');
		expect(editValue('fact', 'kind', '', S)).toBe(S.value_empty);
		expect(
			stateLines({ documents: 22, no_facts: 1, pending: 2, partial: 1, failed: 1 }, S)
		).toHaveLength(3);
		expect(stateLines(null, S)).toEqual([]);
	});
});

describe('таблицы и проходы', () => {
	const sweep = (more: Partial<Sweep> = {}): Sweep => ({
		id: 'x',
		kind: 'table',
		question: 'В?',
		status: 'done',
		pages_scope: 209,
		pages_read: 209,
		scope: 'всё дело',
		...more
	});
	it('состояние и охват прохода', () => {
		expect(statusWord(sweep({ status: 'running', windows_done: 12, windows_total: 29 }), S)).toBe(
			'идёт: прочитано частей документов 12 из 29'
		);
		expect(coverage(sweep(), S)).toBe('Охват: всё дело. Прочитано страниц: 209 из 209.');
		expect(
			coverage(
				sweep({
					pages_read: 168,
					not_read: 41,
					not_read_reasons: { limit: 40, refused: 1 },
					stop: 'limit'
				}),
				S
			)
		).toBe(
			'Охват: всё дело. Прочитано страниц: 168 из 209. Не прочитано страниц: 41. (модель отказалась читать: 1; предел расходов прохода: 40) Проход остановлен пределом трат.'
		);
		expect(coverage(sweep({ text_short: 18 }), S, true)).not.toContain('18');
		expect(coverage(sweep({ text_short: 18 }), S)).toContain('Из них прочитаны не полностью: 18');
	});
	it('цена и правило подтверждения: окно — только если больше 1 USD или цена неизвестна', () => {
		expect(usd(0.0202048)).toBe('0,02');
		expect(usd(0.004)).toBe('0,004');
		expect(usd(0.0042)).toBe('0,0042');
		expect(usd(0)).toBe('0,00');
		expect(usd(null)).toBe('—');
		expect([
			needsConfirm(0.02),
			needsConfirm(1),
			needsConfirm(1.01),
			needsConfirm(null),
			needsConfirm('много')
		]).toEqual([false, false, true, true, true]);
		expect(restText({ windows: 7, pages: 41, estimate_usd: 0.3 }, S)).toBe(
			'Не прочитано частей документов: 7 (страниц: 41). Дочитать — по оценке около 0,30 USD.'
		);
		expect(
			restText(
				{
					windows: 7,
					pages: 41,
					estimate_usd: 1.2,
					raise_to_usd: 3,
					spent_usd: 1.5,
					limit_usd: 1.5
				},
				S
			)
		).toContain('Потрачено 1,50 USD из предела прохода 1,50 USD.');
		expect(scopeQuery('evidence', ['4', '5/1'])).toBe('?preset=evidence&volumes=4&volumes=5%2F1');
	});
	it('слова ячейки, отметка, место на листе, листы из цитаты', () => {
		expect(stateText({ state: 'not_here' }, S)).toBe(S.tables_state_not_here);
		expect(stateText({ state: 'unclear', missing: 1 }, S)).toBe(S.tables_missing);
		expect(
			stateText(
				{ state: 'answered', partial: true, windows_read: 1, windows_total: 3, text_short: 4 },
				S
			)
		).toContain('(прочитано частей документа: 1 из 3)');
		expect(
			copyText({ kind: 'other', title: 'Счёт', label: 'т. 4, л.д. 157', diffs: 9 }, S)
		).toContain('по описи — другой документ: Счёт, т. 4, л.д. 157; отличающихся мест: 9');
		expect(placeQuery({ page_id: 1, read_id: 1398, hl: [699, 734] })).toBe('?v=1398&hl=699-734');
		expect(placeQuery({ page_id: 1 })).toBe('');
		expect(summaryText({ answered: 22, checked: 1, not_here: 0 }, S)).toBe(
			'ответ есть: 22 · проверено: 1'
		);
		const done = sweep({ finished: true });
		expect(canCheck({ state: 'not_here' }, done, true)).toBe(true);
		expect(canCheck({ state: 'not_read' }, done, true)).toBe(false);
		expect(
			canCheck({ state: 'answered', answers: [{ page_id: 1 }] }, sweep({ finished: false }), true)
		).toBe(false);
		expect(canCheck({ state: 'code' }, done, false)).toBe(false);
		expect(refParts({ state: 'partial', raw: 'л.д. 12–14', missing: [13] }, S)).toEqual([
			'л.д. 12–14 — найдена часть диапазона: ',
			'; листа с номером 13 не найдено'
		]);
		expect(refParts({ state: 'нет такого', raw: 'л.д. 9' }, S)).toEqual([
			'л.д. 9 — лист с таким номером не найден',
			''
		]);
	});
});

describe('перечитывание раздела', () => {
	it('не чаще промежутка, не пока открыто окно; одинаковый ответ хранилище не трогает; ошибка — фразой', async () => {
		let t = 0;
		let answer: unknown = { n: 1 };
		let calls = 0;
		let fail = false;
		const loader = createLoader(
			async () => {
				calls += 1;
				if (fail) throw new Error('сбой сервиса');
				return JSON.parse(JSON.stringify(answer));
			},
			{ gap: 20000, now: () => t }
		);
		let sets = 0;
		const off = loader.data.subscribe(() => (sets += 1));
		await loader.refresh();
		expect([calls, get(loader.data)]).toEqual([1, { n: 1 }]);
		const after = sets;
		t = 5000;
		await loader.refresh();
		expect(calls).toBe(1); // 20 с не прошло
		t = 21000;
		await loader.refresh();
		expect([calls, sets]).toEqual([2, after]); // тот же ответ — подписчики не тревожатся
		loader.hold(true);
		t = 50000;
		await loader.refresh();
		expect(calls).toBe(2); // окно открыто
		await loader.refresh(true);
		expect(calls).toBe(3); // «Обновить» и действия — сразу
		loader.hold(false);
		answer = { n: 2 };
		fail = true;
		t = 90000;
		await loader.refresh();
		// прежние данные остаются, а отказ назван словами: фраза сервиса, без неё — что случилось (пустой причины нет)
		expect([reasonText(S, get(loader.error)), get(loader.data)]).toEqual([
			'сбой сервиса',
			{ n: 1 }
		]);
		expect(reasonText(S, { kind: 'network', status: 0, message: '' })).toBe(S.error_no_link);
		expect(reasonText(S, { kind: 'other', status: 502, message: '' })).toBe(
			fmt(S.error_status, { status: 502 })
		);
		expect(reasonText(S, new Error(''))).toBe(S.error_no_answer);
		expect(errorText(S, { kind: 'network', status: 0, message: '' })).toBe(
			fmt(S.error_generic, { detail: S.error_no_link })
		);
		fail = false;
		await loader.refresh(true);
		expect([get(loader.error), get(loader.data)]).toEqual([null, { n: 2 }]);
		loader.set({ n: 3 });
		expect(get(loader.data)).toEqual({ n: 3 });
		loader.stop();
		await loader.refresh(true);
		expect(calls).toBe(5);
		off();
	});
});
