import { describe, expect, it } from 'vitest';
import listing from '../../../../tests/custom/fixtures/case/my-cases.json';
import own from '../../../../tests/custom/fixtures/case/folders.json';
import shared from '../../../../tests/custom/fixtures/case/folders-shared.json';
import {
	access,
	applyFilter,
	buildSections,
	day,
	flatSections,
	isAncestor,
	parentMap,
	readListing,
	sortCases,
	totals
} from './mycases';

const id = (n: number) =>
	`5a1c${String(n).padStart(4, '0')}-0000-4000-a000-${String(n).padStart(12, '0')}`;
const folders = readListing(listing);
const parents = parentMap(folders, [...own, ...shared]);
const titles = (list: { title: string }[]) => list.map((f) => f.title);

describe('«Мои дела»: разбор ответа ручки', () => {
	it('свои папки идут первыми, общие — следом, повтор папки не удваивает строку', () => {
		expect(folders).toHaveLength(8);
		expect(folders.slice(0, 5).every((f) => !f.shared)).toBe(true);
		expect(folders.slice(5).every((f) => f.shared)).toBe(true);
		const twice = readListing({ own: listing.own, shared: [...listing.shared, listing.own[0]] });
		expect(twice).toHaveLength(8);
	});
	it('чужая форма ответа не роняет страницу', () => {
		expect(readListing(null)).toEqual([]);
		expect(readListing({ own: 'x', shared: [null, {}, { folder_id: 7 }] })).toEqual([]);
		const [f] = readListing({ own: [{ folder_id: 'a', case: { volumes: 'много' } }] });
		expect(f).toMatchObject({ id: 'a', title: '', path: '', write: false, case: { volumes: 0, changed: null } });
	});
	it('доступ: моё, общее (можно править), только чтение', () => {
		expect(folders.map(access)).toEqual(['own', 'own', 'own', 'own', 'own', 'shared', 'readonly', 'readonly']);
	});
});

describe('«Мои дела»: счётчики и плитки — общий итог', () => {
	it('как в макете D-panel: 4 дела (2 общих), 14 томов в 4 делах, 4 папки без дела (в 3 можно завести)', () => {
		expect(totals(folders)).toEqual({
			cases: 4,
			casesOwn: 2,
			casesShared: 2,
			volumes: 14,
			casesWithVolumes: 4,
			foldersWithoutCase: 4,
			foldersCanCreate: 3
		});
	});
});

describe('«Мои дела»: разделы из чата', () => {
	it('разделы — папки с вложенными папками; дерево и подписи для телефона', () => {
		const sections = buildSections(folders, parents);
		expect(sections.map((s) => s.title)).toEqual(['Арбитраж']);
		expect(sections[0].children.map((s) => s.title)).toEqual(['2025']);
		expect(flatSections(sections).map((s) => [s.label, s.depth])).toEqual([
			['Арбитраж', 0],
			['Арбитраж / 2025', 1]
		]);
	});
	it('без дерева папок чата разделов нет, родитель вне списка не считается', () => {
		expect(buildSections(folders, parentMap(folders, null))).toEqual([]);
		expect(parentMap(folders, [{ id: id(1), parent_id: 'нет-в-списке' }]).size).toBe(0);
	});
	it('петля в данных не зацикливает и не теряет папки', () => {
		const loop = parentMap(folders, [
			{ id: id(4), parent_id: id(5) },
			{ id: id(5), parent_id: id(4) }
		]);
		expect(isAncestor(id(4), id(5), loop)).toBe(true);
		expect(flatSections(buildSections(folders, loop)).map((s) => s.title).sort()).toEqual(['2025', 'Арбитраж']);
	});
	it('папка без названия получает переданное слово', () => {
		const nameless = readListing({ own: [{ folder_id: 'p' }, { folder_id: 'c' }] });
		const s = buildSections(nameless, parentMap(nameless, [{ id: 'c', parent_id: 'p' }]), 'Без названия');
		expect(s[0].label).toBe('Без названия');
	});
});

describe('«Мои дела»: отбор действует на оба списка', () => {
	const pick = (filter: Partial<Parameters<typeof applyFilter>[1]>) =>
		applyFilter(folders, { scope: 'all', section: null, query: '', ...filter }, parents);
	it('«Мои» и «Общие»', () => {
		expect(pick({ scope: 'own' })).toHaveLength(5);
		expect(titles(pick({ scope: 'shared' }))).toEqual([
			'Бета-Логистик (апелляция)',
			'Тихонов — трудовой спор',
			'Миронов Д. П. — наследство'
		]);
	});
	it('раздел показывает всё, что внутри него на любой глубине, но не сам раздел', () => {
		expect(titles(pick({ section: id(4) }))).toEqual(['А40-123456/2025', '2025']);
		expect(titles(pick({ section: id(5) }))).toEqual(['А40-123456/2025']);
	});
	it('поиск по названию: без учёта регистра, «ё» = «е», пробелы по краям не мешают', () => {
		expect(titles(pick({ query: '  миронов ' }))).toEqual(['Миронов Д. П. — наследство']);
		expect(titles(pick({ query: 'ВЕТЕР' }))).toEqual(['Северный ветер — поставка']);
		expect(pick({ query: 'мироненко' })).toEqual([]);
		const yo = readListing({ own: [{ folder_id: 'a', title: 'Королёв — заём' }] });
		expect(applyFilter(yo, { scope: 'all', section: null, query: 'королев' }, new Map())).toHaveLength(1);
	});
	it('условия складываются', () => {
		expect(pick({ scope: 'shared', section: id(4) })).toEqual([]);
		expect(titles(pick({ scope: 'own', query: '2025' }))).toEqual(['А40-123456/2025', '2025']);
	});
});

describe('«Мои дела»: порядок дел', () => {
	const cases = folders.filter((f) => f.case);
	it('сначала недавние — по дате изменения дела', () => {
		expect(titles(sortCases(cases, 'recent'))).toEqual([
			'Северный ветер — поставка',
			'А40-123456/2025',
			'Бета-Логистик (апелляция)',
			'Миронов Д. П. — наследство'
		]);
	});
	it('по названию — как в словаре, числа по величине; исходный список не меняется', () => {
		const before = titles(cases);
		expect(titles(sortCases(cases, 'name'))).toEqual([
			'А40-123456/2025',
			'Бета-Логистик (апелляция)',
			'Миронов Д. П. — наследство',
			'Северный ветер — поставка'
		]);
		expect(titles(cases)).toEqual(before);
		const numbered = readListing({ own: ['Том 10', 'Том 2', 'том 1'].map((t, i) => ({ folder_id: `n${i}`, title: t, case: { id: 'c', volumes: 1 } })) });
		expect(titles(sortCases(numbered, 'name'))).toEqual(['том 1', 'Том 2', 'Том 10']);
	});
	it('дело без даты изменения — в конце недавних', () => {
		const list = readListing({
			own: [
				{ folder_id: 'a', title: 'Без даты', case: { id: '1', volumes: 0, changed: null } },
				{ folder_id: 'b', title: 'С датой', case: { id: '2', volumes: 0, changed: '2025-01-01T00:00:00+00:00' } }
			]
		});
		expect(titles(sortCases(list, 'recent'))).toEqual(['С датой', 'Без даты']);
	});
});

describe('дата', () => {
	it('ДД.ММ.ГГГГ; пусто и мусор — пустая строка', () => {
		expect(day('2025-11-14T09:12:40+00:00')).toMatch(/^\d{2}\.11\.2025$/);
		expect(day(null)).toBe('');
		expect(day('не дата')).toBe('');
	});
});
