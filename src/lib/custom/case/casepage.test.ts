import { describe, expect, it } from 'vitest';
import bootJson from '../../../../tests/custom/fixtures/case/case-boot.json';
import readyJson from '../../../../tests/custom/fixtures/case/case-overview.json';
import workJson from '../../../../tests/custom/fixtures/case/case-overview-processing.json';
import strings from '../../../../tests/custom/fixtures/case/strings.json';
import {
	checkGroups,
	checkVolumes,
	filesState,
	gotoVolumes,
	inVolume,
	mb,
	money,
	navGroups,
	pauseKey,
	pollDelay,
	processing,
	sectionOfHash,
	sectionOpen,
	since,
	size,
	splitLabel,
	summary,
	volumeState,
	type Boot,
	type CaseData,
	type CheckRow,
	type Volume
} from './casepage';

const boot = bootJson as Boot;
const ready = readyJson as unknown as CaseData;
const work = workJson as unknown as CaseData;
const slugs = (b: Boot, d: CaseData | null = ready, files = 0) =>
	navGroups(b, d, files).map((g) => [g.cap ?? (g.rule ? '—' : ''), ...g.items.map((i) => i.slug || 'overview')].join(' '));

describe('меню разделов: настройка сервиса и права', () => {
	it('этап 3, владелец: все пункты и группы, как в макете K-overview', () => {
		expect(slugs(boot, ready, 4)).toEqual([
			' overview',
			'nav_group_materials upload volumes replace check',
			'nav_group_documents inventory copies',
			'nav_group_map passport amounts chronology deadlines',
			'nav_group_work tables extract',
			'— folder-files danger'
		]);
	});
	it('счётчики — из ответа обзора; нулевой не показывается; «Проверьте листы» — тоном «требует сверки»', () => {
		const items = navGroups(boot, work).flatMap((g) => g.items);
		const count = Object.fromEntries(items.map((i) => [i.slug, i.count]));
		expect(count).toMatchObject({ volumes: 2, check: 31, inventory: 22, copies: 5, amounts: 43, chronology: 155, deadlines: 2, tables: 5 });
		expect(count.upload).toBeUndefined();
		expect(items.find((i) => i.slug === 'check')?.warn).toBe(true);
		const none = navGroups(boot, { ...ready, counts: { check: 0, volumes: 0 } }).flatMap((g) => g.items);
		expect(none.find((i) => i.slug === 'check')?.count).toBeUndefined();
	});
	it('этап 1: только тома, «Проверьте листы», опись; пустые группы уходят вместе с подписью', () => {
		expect(slugs({ ...boot, sections: ['volumes', 'check', 'inventory'] })).toEqual([
			' overview',
			'nav_group_materials upload volumes check',
			'nav_group_documents inventory',
			'— danger'
		]);
	});
	it('«только чтение»: нет «Загрузить материалы» и «Удаления дела»; файлы папки — только если они есть', () => {
		const reader = { ...boot, can_write: false, is_owner: false };
		const all = slugs(reader, ready, 2).join(' ');
		expect(all).not.toMatch(/upload|danger/);
		expect(all).toMatch(/folder-files/);
		expect(slugs(reader).join(' ')).not.toMatch(/folder-files/);
		expect([sectionOpen('upload', reader), sectionOpen('danger', { ...boot, is_owner: false }), sectionOpen('check', reader)]).toEqual([false, false, true]);
	});
	it('«Замена тома» и «Выписка листов» — половины whatsnew, «Суммы» — паспорта; незнакомый раздел закрыт', () => {
		const partial = { ...boot, sections: ['passport'] };
		expect([sectionOpen('amounts', partial), sectionOpen('replace', partial), sectionOpen('extract', { ...boot, sections: ['whatsnew'] })]).toEqual([true, false, true]);
		expect([sectionOpen('nosuch', boot), sectionOpen('', partial)]).toEqual([false, true]);
	});
	it('прежние метки #sec-… из старых ссылок ведут в раздел', () => {
		expect(['#sec-check', '#sec-whatsnew', '#sec-upload', '#sec-folder-files', '#sec-nosuch', '', '#other'].map(sectionOfHash)).toEqual([
			'check', 'replace', 'upload', 'folder-files', null, null, null
		]);
	});
});

describe('«Открыть лист»', () => {
	it('тома по порядку меток, без пустых и повторов', () => {
		const v = (label: string | null) => ({ id: 1, label, status: 'indexed' }) as Volume;
		expect(gotoVolumes([v('10'), v('2'), v(null), v(' 5/1 '), v('2'), v('')])).toEqual(['2', '5/1', '10']);
		expect(gotoVolumes(undefined)).toEqual([]);
	});
});

describe('обработка и состояние сводки', () => {
	it('переспрашивание: 5 с при обработке (том, файл, приём загрузки, своя передача), 30 с без неё', () => {
		expect([pollDelay(ready), pollDelay(work), pollDelay(null), pollDelay(ready, true)]).toEqual([30000, 5000, 30000, 5000]);
		const quiet = { ...ready, uploads: [{ id: 'u', phase: 'receiving', status: 'receiving' }] } as CaseData;
		expect(processing(quiet)).toBe(false); // чужая незавершённая передача опрос не ускоряет
		expect(processing({ ...ready, uploads: [{ id: 'u', phase: 'intake' }] } as CaseData)).toBe(true);
		expect(processing({ ...ready, files: { '1': { status: 'queued' } } })).toBe(true);
	});
	it('состояния: готово, обработка с паузой, пусто', () => {
		expect(summary(ready)).toMatchObject({ kind: 'ready', indexed: 209, total: 209, paused: null, volumes: 1, documents: 22, checks: 31 });
		expect(summary(work)).toMatchObject({ kind: 'processing', indexed: 363, total: 669, paused: { self: false, key: 'paused_budget' } });
		const empty = { ...ready, overview: { ...ready.overview, volumes: [], files_without_volume: [], e_case: [], check_sheets: [] }, uploads: [], check_total: 0 };
		expect(summary(empty as CaseData).kind).toBe('empty');
		expect(summary({ ...empty, uploads: [{ id: 'u', phase: 'receiving' }] } as CaseData).kind).toBe('processing');
	});
	it('том распознан, а опись ещё составляется — дело ещё не «готово»', () => {
		const v = { ...ready.overview.volumes![0], status: 'indexed' };
		expect(summary({ ...ready, overview: { ...ready.overview, volumes: [v] } }).kind).toBe('processing');
	});
	it('пауза: какие пройдут сами; незнакомая причина — нейтральная фраза', () => {
		const paused = (reason: string) => summary({ ...work, paused: { reason, since: null, until: null } }).paused;
		expect(['daily', 'fuse', 'rate', 'marks', 'limiter'].map((r) => paused(r)?.self)).toEqual([true, true, true, true, true]);
		expect(['budget', 'floor', 'manual', 'models_off', 'credits_unknown', 'sweep', 'новая'].map((r) => paused(r)?.self)).toEqual(Array(7).fill(false));
		expect([pauseKey('fuse'), pauseKey('новая'), pauseKey(undefined)]).toEqual(['paused_fuse', 'paused_unknown', 'paused_unknown']);
		for (const r of ['manual', 'budget', 'daily', 'floor', 'credits_unknown', 'fuse', 'rate', 'marks', 'models_off', 'sweep', 'limiter'])
			expect(strings).toHaveProperty(pauseKey(r));
	});
	it('слова состояния тома: «готов» только когда готово всё; электронное дело после обработки — «прочитано»', () => {
		const v = (status: string, files: object[] = []) => volumeState({ id: 1, label: '1', status, pages: 312, files } as Volume);
		expect(v('inventory_ready')).toEqual({ tone: 'plain', key: 'volume_state_ready' });
		expect(v('indexed')).toEqual({ tone: 'info', key: 'volume_state_indexed' });
		expect(v('reading', [{ pages_indexed: 100 }, { pages_indexed: 40 }])).toEqual({ tone: 'info', key: 'volume_state_reading', vars: { n: 140, m: 312 } });
		expect(v('receiving').key).toBe('volume_state_queued');
		expect(filesState([{ status: 'indexed' }, { status: 'indexed' }]).key).toBe('ecase_state_ready');
		expect(filesState([{ status: 'indexed', pages: 10, pages_indexed: 10 }, { status: 'reading', pages: 20, pages_indexed: 5 }])).toMatchObject({ key: 'volume_state_reading', vars: { n: 15, m: 30 } });
		expect(filesState([{ status: 'queued' }]).key).toBe('volume_state_queued');
	});
});

describe('подпись листа', () => {
	it('лист без номера: имя файла — отдельно; обычная подпись не трогается', () => {
		expect(splitLabel('т. 4, файл «tom-2-chast-1.pdf», стр. 120')).toEqual({ main: 'т. 4, стр. 120', file: 'tom-2-chast-1.pdf' });
		expect(splitLabel('файл «a «b».pdf», стр. 47')).toEqual({ main: 'стр. 47', file: 'a «b».pdf' });
		expect(splitLabel('т. 4, л.д. 15 об.')).toEqual({ main: 'т. 4, л.д. 15 об.', file: '' });
		expect([inVolume('т. 4, л.д. 12', '4'), inVolume('т. 5/1, л.д. 3', '4'), inVolume('л.д. 3', null)]).toEqual(['л.д. 12', 'т. 5/1, л.д. 3', 'л.д. 3']);
	});
});

describe('«Проверьте листы»: группы по виду замечания', () => {
	const rows = ready.overview.check_sheets as CheckRow[];
	const volumes = ready.overview.volumes as Volume[];
	const groups = checkGroups(rows, volumes, strings);
	const by = Object.fromEntries(groups.map((g) => [g.id, g]));
	it('порядок групп и счёт: листов — у перечней, замечаний — у строк', () => {
		expect(groups.map((g) => [g.id, g.count, g.countSheets])).toEqual([
			['numbers', 1, false],
			['text', 18, true],
			['number_check', 4, true],
			['number_unset', 1, false],
			['gap', 1, false],
			['volume', 1, false]
		]);
	});
	it('числа — без общих слов; номер не установлен — прочитанное и место; нехватка — отдельно строка описи', () => {
		expect(by.numbers.rows[0]).toMatchObject({ detail: '«066328» / «698105»', volume: '4' });
		expect(by.numbers.rows[0].sheets[0].label).toBe('т. 4, л.д. 16');
		expect(by.number_unset.rows[0].detail).toBe('прочитано «55», «32», «56»; между л. 120 и л. 122');
		expect(by.gap.rows[0].detail).toBe('между л. 115 и л. 119 1 страница с неустановленным номером: не хватает не меньше 2 листов');
		expect(by.gap.rows[0].note).toMatch(/^по внутренней описи тома здесь: «Исковое/);
		expect(by.volume.flat && by.volume.rows[0].sheets).toEqual([]);
	});
	it('перечни: у каждого листа своя подпись и адрес; две причины одной группы — двумя перечнями', () => {
		expect(by.text.chips).toHaveLength(1);
		expect(by.text.chips[0].byVolume[0].sheets.slice(0, 3).map((s) => s.label)).toEqual(['т. 4, л.д. 12', 'т. 4, л.д. 15', 'т. 4, л.д. 17']);
		expect(by.text.chips[0].byVolume[0].sheets.every((s) => s.url?.includes('/p/'))).toBe(true);
		expect(by.number_check.chips.map((c) => c.byVolume[0].sheets.length)).toEqual([3, 1]);
	});
	it('без частей фразы — сама фраза; незнакомый код — в «Другие замечания»; выбор тома', () => {
		const extra: CheckRow[] = [
			{ page_id: 9, volume_id: 4, label: 'т. 4, л.д. 9', reason: 'плохо снято — переснимите', code: 'blurred', url: '/p/9' },
			{ page_id: 8, volume_id: 5, label: 'т. 5/1, л.д. 8', reason: 'числа на листе прочитаны по-разному (номер, сумма, дата) — сверьте с изображением листа', code: 'text_disagree', url: '/p/8' },
			{ page_id: 7, volume_id: 5, label: 'т. 5/1, л.д. 7', reason: 'новое замечание', code: 'future_code', url: '/p/7' },
			{ page_id: null, volume_id: 5, label: 'т. 5/1, номера перескакивают', reason: 'номера листов перескакивают с л. 4 на л. 6', code: 'gap', parts: { main: 'номера листов перескакивают с л. 4 на л. 6' } }
		];
		const vols = [...volumes, { id: 5, label: '5/1', status: 'reading' } as Volume];
		const g = Object.fromEntries(checkGroups(extra, vols, strings).map((x) => [x.id, x]));
		expect(g.other.rows.map((r) => r.detail)).toEqual(['плохо снято — переснимите', 'новое замечание']);
		expect(g.numbers.rows[0].detail).toMatch(/^числа на листе прочитаны по-разному \(/);
		expect(g.gap.rows[0]).toMatchObject({ sheets: [], volume: '5/1' });
		expect(checkGroups(extra, vols, strings, 4).map((x) => x.id)).toEqual(['other']);
		expect(checkVolumes([...rows, ...extra], [vols[1], vols[0]]).map((v) => v.label)).toEqual(['4', '5/1']);
		expect(checkGroups([], vols, strings)).toEqual([]);
	});
});

describe('числа и время', () => {
	it('размеры и деньги — как на прежней странице', () => {
		expect([mb(4.2 * 1048576), mb(157 * 1048576), size(850 * 1024), size(500), size(84 * 1048576)]).toEqual(['4,2', '157', '850 КБ', '1 КБ', '84 МБ']);
		expect([money('1.84'), money(null)]).toEqual(['1,84', '']);
	});
	it('«Пауза с 10:02»: сегодняшняя — только время', () => {
		const now = new Date(2025, 10, 14, 12, 0);
		expect(since(new Date(2025, 10, 14, 10, 2).toISOString(), now)).toBe('10:02');
		expect(since(new Date(2025, 10, 13, 10, 2).toISOString(), now)).toBe('13.11 10:02');
		expect(since(null)).toBe('');
	});
});
