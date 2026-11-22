// ai-dvokat: хронология и суммы — строка группы строк таблиц, ключ строки, подпись принятия, счёт записей (Бп-10).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { acceptedText, dayOf, groupText, recordsTotal, rowKey } from './facts';
import { passportName } from './mapcore';

const S = JSON.parse(readFileSync('tests/custom/fixtures/case/strings.json', 'utf8'));

describe('группы строк таблиц и принятие (пакет Б 22.11)', () => {
	it('строка группы называет документ, число записей и период; одна дата — днём', () => {
		const g = { group: true as const, document_id: 7, document: 'Выписка', n: 680, date_from: '2024-01-02', date_to: '2024-12-30' };
		expect(groupText(g, S)).toBe('Строки таблицы в документе «Выписка»: записей 680, с 02.01.2024 по 30.12.2024');
		expect(groupText({ ...g, date_to: '2024-01-02' }, S)).toBe('Строки таблицы в документе «Выписка»: записей 680, 02.01.2024');
		expect(groupText({ ...g, document: null, date_from: null, date_to: null }, S)).toBe(
			`Строки таблицы в документе «${S.court_untitled}»: записей 680`
		);
	});
	it('ключ строки ленты: группа — по документу, запись — по id', () => {
		expect(rowKey({ group: true, document_id: 5 })).toBe('g5');
		expect(rowKey({ id: 5 })).toBe('f5');
	});
	it('принятие: кто и когда; без имени — только когда', () => {
		expect(acceptedText({ accepted_name: 'Анна', accepted_at: '2026-11-22T10:00:00Z' }, S)).toBe('принято: Анна, 22.11.2026');
		expect(acceptedText({ accepted_at: '2026-11-22T10:00:00Z' }, S)).toBe('принято юристом 22.11.2026');
		expect(dayOf(null)).toBe('');
	});
	it('счёт записей — записи, а не строки ленты; старый сервис — строки', () => {
		expect(recordsTotal({ total: 882, total_records: 2364 })).toBe(2364);
		expect(recordsTotal({ total: 40 })).toBe(40);
	});
	it('подпись поля паспорта — одна, своя: у сводки кода «названные в документах»', () => {
		expect(passportName(S, 'court')).toBe(S.map_pfc_court);
		expect(passportName(S, 'case_number')).toBe(S.map_pfc_case_number);
		expect(passportName(S, 'charge')).toBe(S.map_pf_charge);
		expect(passportName(S, 'measure')).toBe(S.map_pf_measure);
	});
});
