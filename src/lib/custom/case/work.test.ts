/* ai-dvokat: проверки признака хода «работа по делу идёт» (пакет 23.11): сводка не говорит «Готово к работе», пока
   в очереди есть карточки и паспорт; срок опроса 5 с, пока работа идёт; строка хода и признак меню — только у
   разделов, чьи данные зависят от идущей работы; когда работы нет — никаких признаков; загрузчик раздела и «Обновить»;
   страница между полными обзорами спрашивает лёгкую ручку. Прежний сервис (поля `work` нет) — всё по-прежнему. */
import { get } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import bootJson from '../../../../tests/custom/fixtures/case/case-boot.json';
import readyJson from '../../../../tests/custom/fixtures/case/case-overview.json';
import stringsJson from '../../../../tests/custom/fixtures/case/strings.json';
import { CaseApiError, createCaseApi, type CaseApi } from './api';
import {
	SECTION_WORK,
	WAIT_KEYS,
	caseView,
	chronologyReread,
	pausedNow,
	runParts,
	viewWhy,
	workNote,
	WORK_PART,
	isPausedFor,
	navGroups,
	pauseOf,
	pollDelay,
	processing,
	summary,
	waitReasonsText,
	workActive,
	workKey,
	workOnly,
	workParts,
	workWaiting,
	workWaitingOnly,
	workWatcher,
	type Boot,
	type CaseData,
	type Work
} from './casepage';
import { createCaseState } from './casestore';
import { createLoader, createReload } from './loader';
import { caseMarks, listDelay, readListing, type CaseFolder } from './mycases';
import { mergeTableRows, type Cell, type Check } from './tablescore';
import {
	isMarkdownToolItem,
	isStructuredToolItem,
	lastDetailGroupIndex,
	toolPreparingLabel
} from '../toolStatus';

const boot = bootJson as Boot;
const ready = readyJson as unknown as CaseData;
const work = (groups: Record<string, number>, sweeps = 0, stalled = false): Work => ({
	busy: Object.keys(groups).length > 0 || sweeps > 0,
	groups,
	running: {},
	sweeps,
	stalled
});
const S = {
	work_part_read: 'читаются листы',
	work_part_inventory: 'составляется опись',
	work_part_cards: 'разбираются документы — {n}',
	work_part_passport: 'собирается паспорт дела',
	work_part_sweeps: 'идут проходы — {n}'
};
const marked = (data: CaseData) =>
	navGroups(boot, data)
		.flatMap((g) => g.items)
		.filter((i) => i.work)
		.map((i) => i.slug);

describe('работа по делу (поле work обзора)', () => {
	it('«Готово к работе» — только когда работы в очереди нет', () => {
		expect(summary(ready).kind).toBe('ready');
		expect(summary({ ...ready, work: work({}) }).kind).toBe('ready');
		expect(summary({ ...ready, work: work({ cards: 3 }) }).kind).toBe('processing');
		expect(summary({ ...ready, work: work({ passport: 1 }) }).kind).toBe('processing');
		expect(summary({ ...ready, work: work({ vectors: 2 }) }).kind).toBe('processing');
		// идущий проход — работа юриста с готовым делом: обработкой дела не считается
		expect(summary({ ...ready, work: work({}, 1) }).kind).toBe('ready');
		// прежний сервис поля не отдаёт — правило прежнее
		expect(summary({ ...ready, work: undefined }).kind).toBe('ready');
		expect(summary({ ...ready, work: null }).kind).toBe('ready');
	});

	it('опрос 5 с, пока работа идёт (и проход тоже), 30 с — когда её нет', () => {
		expect(pollDelay(ready)).toBe(30000);
		expect(pollDelay({ ...ready, work: work({}) })).toBe(30000);
		expect(pollDelay({ ...ready, work: work({ cards: 1 }) })).toBe(5000);
		expect(pollDelay({ ...ready, work: work({}, 1) })).toBe(5000);
		expect(processing({ ...ready, work: work({ passport: 1 }) })).toBe(true);
		expect(workOnly({ ...ready, work: work({ passport: 1 }) })).toBe(true);
		expect(workOnly(ready)).toBe(false);
		expect(workOnly({ ...ready, work: work({ cards: 1 }) }, true)).toBe(false); // идёт своя передача файла
	});

	it('строка хода и признак меню — у разделов, чьи данные зависят от идущей работы', () => {
		const cards = { ...ready, work: work({ cards: 2, passport: 1 }) };
		// Н-3: разбор документов пишет в строки описи название, дату и автора — у «Описи» и «Копий» тоже признак
		expect(marked(cards).sort()).toEqual([
			'amounts',
			'chronology',
			'copies',
			'deadlines',
			'inventory',
			'passport'
		]);
		expect(marked({ ...ready, work: work({ passport: 1 }) })).toEqual(['passport']);
		expect(marked({ ...ready, work: work({ inventory: 1 }) }).sort()).toEqual(
			['amounts', 'chronology', 'copies', 'deadlines', 'inventory', 'passport'].sort()
		);
		expect(marked({ ...ready, work: work({}, 2) })).toEqual(['tables']);
		expect(marked({ ...ready, work: work({ vectors: 5 }) })).toEqual([]);
		expect(marked(ready)).toEqual([]);
		expect(marked({ ...ready, work: work({}) })).toEqual([]);
		expect(workParts(cards.work, SECTION_WORK.passport, S)).toEqual([
			'разбираются документы — 2',
			'собирается паспорт дела'
		]);
		expect(workParts(cards.work, SECTION_WORK.chronology, S)).toEqual(['разбираются документы — 2']);
		expect(workParts(cards.work, SECTION_WORK.inventory, S)).toEqual(['разбираются документы — 2']);
		expect(workParts(cards.work, SECTION_WORK.check, S)).toEqual([]);
		expect(marked({ ...ready, work: work({ read: 4 }) })).toContain('check'); // «Проверьте листы» растёт
		expect(workParts(cards.work, SECTION_WORK.passport, {})).toEqual([]); // прежний сервис: строк нет — молчит
		expect(workActive(cards, SECTION_WORK.tables)).toBe(false);
	});

	it('состав работы без чисел: счёт тикает — ключ тот же; группа закончилась — другой', () => {
		expect(workKey(work({ cards: 5 }))).toBe(workKey(work({ cards: 2 })));
		expect(workKey(work({ cards: 5 }))).not.toBe(workKey(work({ passport: 1 })));
		expect(workKey(work({ cards: 5 }))).not.toBe(workKey(work({ cards: 5 }, 0, true)));
		expect(workKey(work({}))).toBe(workKey(undefined));
	});

	it('раздел перечитывается, когда работа его групп закончилась, — и только тогда', () => {
		const done = vi.fn();
		const watch = workWatcher(SECTION_WORK.chronology, done);
		watch(ready);
		watch({ work: work({ cards: 2 }) });
		watch(null); // обзора нет (сбой запроса) — не «закончилась»
		watch({ work: work({ cards: 1 }) });
		expect(done).not.toHaveBeenCalled();
		watch({ work: work({ passport: 1 }) }); // карточки кончились, паспорт хронологии не касается
		expect(done).toHaveBeenCalledTimes(1);
		watch({ work: work({}) });
		expect(done).toHaveBeenCalledTimes(1);
	});

	it('«Мои дела»: признак busy — только когда сервис сказал true', () => {
		const list = readListing({
			own: [
				{ folder_id: 'a', case: { id: '1', volumes: 1, changed: null, busy: true } },
				{ folder_id: 'b', case: { id: '2', volumes: 1, changed: null, busy: false } },
				{ folder_id: 'c', case: { id: '3', volumes: 1, changed: null } }
			]
		});
		expect(list.map((f) => !!f.case?.busy)).toEqual([true, false, false]);
	});

	it('Р-1: когда остались только ждущие внешнего условия задачи — waiting, редкий опрос 30 с, без часов в меню', () => {
		const wWait: Work = {
			busy: false,
			groups: {},
			running: {},
			waiting: { cards: 3 },
			wait_reasons: ['reprocess_limit', 'http_401'],
			sweeps: 0,
			stalled: false
		};
		const dWait: CaseData = { ...ready, work: wWait };
		expect(workWaiting(dWait, SECTION_WORK.chronology)).toBe(true);
		expect(workWaiting(dWait, SECTION_WORK.inventory)).toBe(true); // Н-3: разбор документов пишет строки описи
		expect(workWaiting(dWait, SECTION_WORK.check)).toBe(false);
		expect(workWaitingOnly(dWait)).toBe(true);
		expect(summary(dWait).kind).toBe('waiting');
		// даже если том не дошёл до inventory_ready — при одних ждущих задачах это waiting, а не processing
		const readingVol = { ...ready.overview.volumes![0], status: 'reading' };
		expect(
			summary({ ...dWait, overview: { ...ready.overview, volumes: [readingVol] } }).kind
		).toBe('waiting');
		expect(processing(dWait)).toBe(false);
		expect(pollDelay(dWait)).toBe(30000);
		expect(marked(dWait)).toEqual([]);
		expect(waitReasonsText(wWait, stringsJson)).toContain(stringsJson.wait_reprocess_limit);
		expect(waitReasonsText(wWait, stringsJson)).toContain(stringsJson.wait_http_401);
		// если рядом есть активная задача — снова processing и 5 с
		const mixed: CaseData = {
			...ready,
			work: { ...wWait, busy: true, groups: { passport: 1 } }
		};
		expect(workWaitingOnly(mixed)).toBe(false);
		expect(summary(mixed).kind).toBe('processing');
		expect(pollDelay(mixed)).toBe(5000);
	});

	it('переводы групп и причин ожидания согласованы со снимком строк сервиса', () => {
		for (const key of Object.values(WORK_PART)) {
			expect(stringsJson).toHaveProperty(key);
		}
		for (const key of Object.values(WAIT_KEYS)) {
			expect(stringsJson).toHaveProperty(key);
		}
		expect(stringsJson).toHaveProperty('wait_unknown');
	});

	it('Р-2 / Ф-4: rate не считается паузой; пауза групп берётся из work.paused_groups (по шагам сервиса)', () => {
		expect(pauseOf({ paused: { reason: 'rate', since: null, until: null } })).toBeNull();
		const marks = { reason: 'marks', since: null, until: null, groups: ['read'] };
		// marks при идущем шаге text в группе read → сервис отдаёт paused_groups: [] → не на паузе!
		expect(
			isPausedFor(
				{ paused: marks, work: { ...work({ read: 5 }), paused_groups: [] } },
				SECTION_WORK.inventory
			)
		).toBe(false);
		// marks при одних шагах marks в read → сервис отдаёт paused_groups: ['read'] → на паузе
		expect(
			isPausedFor(
				{ paused: marks, work: { ...work({ read: 1 }), paused_groups: ['read'] } },
				SECTION_WORK.inventory
			)
		).toBe(true);
		expect(
			isPausedFor(
				{ paused: marks, work: { ...work({ read: 1, cards: 2 }), paused_groups: ['read'] } },
				SECTION_WORK.chronology
			)
		).toBe(false);
		const budget = { reason: 'budget', since: null, until: null, groups: null };
		expect(
			isPausedFor(
				{ paused: budget, work: { ...work({ cards: 2 }), paused_groups: ['cards'] } },
				SECTION_WORK.chronology
			)
		).toBe(true);
	});

	it('Ф-8: waitReasonsText по группам возвращает причины только нужной группы, без групп — все', () => {
		const w: Work = {
			busy: false,
			groups: {},
			waiting: { cards: 1, read: 1 },
			wait_reasons: ['http_401', 'texts_unreviewed'],
			waiting_reasons: { cards: ['texts_unreviewed'], read: ['http_401'] },
			sweeps: 0
		};
		expect(waitReasonsText(w, stringsJson, ['cards'])).toBe(stringsJson.wait_unreviewed);
		expect(waitReasonsText(w, stringsJson, ['read'])).toBe(stringsJson.wait_http_401);
		expect(waitReasonsText(w, stringsJson)).toContain(stringsJson.wait_http_401);
		expect(waitReasonsText(w, stringsJson)).toContain(stringsJson.wait_unreviewed);
	});

	it('Ф-1: lastDetailGroupIndex находит последнюю группу вызовов без непустого текста после неё на обоих путях', () => {
		// Markdown-токены
		const mdTwo = [{ type: 'detail_group' }, { type: 'paragraph' }, { type: 'detail_group' }, { type: 'space' }];
		expect(lastDetailGroupIndex(mdTwo, (t) => t.type === 'detail_group', (t) => t.type === 'space')).toBe(2);
		const mdTail = [...mdTwo, { type: 'paragraph' }];
		expect(lastDetailGroupIndex(mdTail, (t) => t.type === 'detail_group', (t) => t.type === 'space')).toBe(-1);
		// Структурный вывод (StructuredOutputRenderer)
		const soTwo = [
			{ type: 'detail_group', text: '' },
			{ type: 'message', text: 'Промежуточный' },
			{ type: 'detail_group', text: '' },
			{ type: 'message', text: '   ' }
		];
		expect(
			lastDetailGroupIndex(
				soTwo,
				(it) => it.type === 'detail_group',
				(it) => it.type === 'message' && !it.text.trim()
			)
		).toBe(2);
		const soTail = [...soTwo, { type: 'message', text: 'Ответ' }];
		expect(
			lastDetailGroupIndex(
				soTail,
				(it) => it.type === 'detail_group',
				(it) => it.type === 'message' && !it.text.trim()
			)
		).toBe(-1);
	});
});

describe('загрузчик раздела', () => {
	it('touch: следующее обычное перечитывание промежутка не ждёт, открытое окно придерживает', async () => {
		let calls = 0;
		let now = 0;
		const loader = createLoader(async () => ++calls, { gap: 20000, now: () => now });
		await loader.refresh();
		now = 1000;
		await loader.refresh();
		expect(calls).toBe(1);
		loader.touch();
		loader.hold(true);
		await loader.refresh();
		expect(calls).toBe(1);
		loader.hold(false);
		await loader.refresh();
		expect(calls).toBe(2);
	});

	it('«Обновить»: занято, пока идёт запрос; «готово» — и когда ответ тот же; при отказе — нет', async () => {
		let release: (v: number) => void = () => undefined;
		let fail = false;
		const loader = createLoader<number>(() =>
			fail ? Promise.reject(new Error('x')) : new Promise<number>((r) => (release = r))
		);
		const done = vi.fn();
		const reload = createReload(loader, done);
		const first = reload.run();
		expect(get(reload.busy)).toBe(true);
		void reload.run(); // второе нажатие, пока идёт первое, — не второй запрос
		release(1);
		await first;
		expect(get(reload.busy)).toBe(false);
		expect(done).toHaveBeenCalledTimes(1);
		const second = reload.run();
		release(1); // данные не изменились — ответ юристу всё равно есть
		await second;
		expect(done).toHaveBeenCalledTimes(2);
		fail = true;
		await reload.run();
		expect(done).toHaveBeenCalledTimes(2);
		expect(get(reload.busy)).toBe(false);
	});

	it('«Обновить» во время идущего запроса дожидается ответа, собранного после нажатия', async () => {
		const waits: ((v: number) => void)[] = [];
		const loader = createLoader<number>(() => new Promise<number>((r) => waits.push(r)));
		const background = loader.refresh();
		const done = vi.fn();
		const pressed = createReload(loader, done).run();
		void background;
		waits[0](1);
		await vi.waitFor(() => expect(waits.length).toBe(2));
		expect(done).not.toHaveBeenCalled(); // ответ прежнего запроса — ещё не ответ на нажатие
		waits[1](2);
		await pressed;
		expect(done).toHaveBeenCalledTimes(1);
		expect(get(loader.data)).toBe(2);
	});
});

describe('страница дела: лёгкий опрос, пока идёт только работа по делу', () => {
	const stub = (get: (path: string) => Promise<unknown>): CaseApi => ({
		base: '/legal-tools',
		url: (p) => `/legal-tools/${p}`,
		download: async () => ({ blob: new Blob(), name: '' }),
		get: (p) => get(p) as Promise<any>,
		request: () => Promise.resolve({}) as Promise<any>,
		post: () => Promise.resolve({}) as Promise<any>
	});

	it('между полными обзорами — ручка work; состав работы изменился — обзор целиком; работы нет — 30 с', async () => {
		vi.useFakeTimers();
		const calls: string[] = [];
		let current: Work = work({ cards: 3 });
		const api = stub(async (path) => {
			calls.push(path.replace('api/cases/f1', '') || '/');
			if (path.endsWith('/boot')) return { ...boot, folder_id: 'f1', has_case: true };
			if (path.endsWith('/folder-files')) return { files: [] };
			if (path.endsWith('/work')) return { work: current, paused: null };
			return { ...ready, work: current };
		});
		const state = createCaseState(api, 'f1');
		await state.start();
		const only = (p: string) => calls.filter((c) => c === p).length;
		expect(only('/')).toBe(1);
		current = work({ cards: 2 });
		await vi.advanceTimersByTimeAsync(5000);
		expect([only('/'), only('/work')]).toEqual([1, 1]); // лёгкий запрос, обзор не собирался
		expect(get(state.data)?.work?.groups.cards).toBe(2); // счёт в строке хода обновился
		current = work({ passport: 1 });
		await vi.advanceTimersByTimeAsync(5000);
		expect([only('/'), only('/work')]).toEqual([2, 2]); // карточки кончились — обзор целиком тем же заходом
		current = work({});
		await vi.advanceTimersByTimeAsync(5000);
		expect([only('/'), only('/work')]).toEqual([3, 3]);
		expect(get(state.data)?.work?.busy).toBe(false);
		await vi.advanceTimersByTimeAsync(25000);
		expect([only('/'), only('/work')]).toEqual([3, 3]); // работы нет — ни лёгких, ни частых запросов
		await vi.advanceTimersByTimeAsync(5000);
		expect([only('/'), only('/work')]).toEqual([4, 3]);
		state.stop();
		vi.useRealTimers();
	});

	it('прежний сервис (поля work нет): ручка work не спрашивается, опрос по-прежнему 30 с', async () => {
		vi.useFakeTimers();
		const calls: string[] = [];
		const api = stub(async (path) => {
			calls.push(path);
			if (path.endsWith('/boot')) return { ...boot, folder_id: 'f1', has_case: true };
			if (path.endsWith('/folder-files')) return { files: [] };
			return ready;
		});
		const state = createCaseState(api, 'f1');
		await state.start();
		await vi.advanceTimersByTimeAsync(60000);
		expect(calls.filter((c) => c.endsWith('/work'))).toEqual([]);
		expect(calls.filter((c) => c === 'api/cases/f1').length).toBe(3);
		state.stop();
		vi.useRealTimers();
	});
});

describe('Р-8: открытая таблица не теряет строки, отметки и окно примечания при опросе', () => {
	it('обновление строк по месту сохраняет ссылку на строку и не откатывает отметку «проверено» между опросами', () => {
		const localCheck: Check = { stands: true, note: 'сверено', by_name: 'Юрист', at: '2026-11-23' };
		const row1 = {
			document_id: 10,
			cells: {
				c1: { state: 'found', answers: [], check: localCheck } as Cell,
				c2: { state: 'pending', answers: [], check: null } as Cell
			}
		};
		const row2 = {
			document_id: 20,
			cells: { c1: { state: 'found', answers: [], check: null } as Cell }
		};
		// пришёл снимок опроса: в нём c1 ещё без отметки (снимок собран до клика юриста), а c2 уже дочитался
		const incoming = [
			{
				document_id: 10,
				cells: {
					c1: { state: 'found', answers: [], check: null } as Cell,
					c2: { state: 'found', answers: [{ value: 'да', page_id: 1 }], check: null } as Cell
				}
			}
		];
		const merged = mergeTableRows([row1, row2], incoming, new Set(['10:c1']), false);
		// объект row1 — та же ссылка (окно примечания не потеряло строку)
		expect(merged[0]).toBe(row1);
		// отметка «проверено» не откатилась, а новый ответ c2 пришёл
		expect(merged[0].cells.c1.check).toEqual(localCheck);
		expect(merged[0].cells.c2.state).toBe('found');
		// строка из второй порции (row2) осталась на месте
		expect(merged.map((r) => r.document_id)).toEqual([10, 20]);
	});

	it('Ф-11: новая строка первой порции встаёт на своё место, а не в конец списка после догруженных порций', () => {
		const r1 = { document_id: 1, cells: {} };
		const r3 = { document_id: 3, cells: {} };
		const rPage2 = { document_id: 99, cells: {} };
		// пришла свежая первая порция: между 1 и 3 появилась новая строка 2
		const incoming = [
			{ document_id: 1, cells: {} },
			{ document_id: 2, cells: {} },
			{ document_id: 3, cells: {} }
		];
		const merged = mergeTableRows([r1, r3, rPage2], incoming, new Set(), false);
		expect(merged.map((r) => r.document_id)).toEqual([1, 2, 3, 99]);
		expect(merged[0]).toBe(r1);
		expect(merged[2]).toBe(r3);
	});
});

describe('Р-10: отказ лёгкого опроса, отсутствие …/work (404) и тайм-аут опроса', () => {
	const stub = (get: (path: string, opts?: { timeoutMs?: number }) => Promise<unknown>): CaseApi => ({
		base: '/legal-tools',
		url: (p) => `/legal-tools/${p}`,
		download: async () => ({ blob: new Blob(), name: '' }),
		get: (p, o) => get(p, o) as Promise<any>,
		request: () => Promise.resolve({}) as Promise<any>,
		post: () => Promise.resolve({}) as Promise<any>
	});

	it('сбой …/work тем же заходом уходит в обзор целиком и не ставит stale', async () => {
		vi.useFakeTimers();
		const calls: string[] = [];
		const timeouts: (number | undefined)[] = [];
		const api = stub(async (path, opts) => {
			calls.push(path.replace('api/cases/f1', '') || '/');
			if (path === 'api/cases/f1' || path.endsWith('/work')) timeouts.push(opts?.timeoutMs);
			if (path.endsWith('/boot')) return { ...boot, folder_id: 'f1', has_case: true };
			if (path.endsWith('/folder-files')) return { files: [] };
			if (path.endsWith('/work')) throw new CaseApiError(500, 'other', 'boom');
			return { ...ready, work: work({ cards: 2 }) };
		});
		const state = createCaseState(api, 'f1');
		await state.start();
		await vi.advanceTimersByTimeAsync(5000);
		// лёгкий запрос упал → тем же заходом ушли в обзор, stale остался null, тайм-аут передан
		expect(calls.filter((c) => c === '/work').length).toBe(1);
		expect(calls.filter((c) => c === '/').length).toBe(2);
		expect(get(state.stale)).toBeNull();
		expect(timeouts.every((t) => typeof t === 'number' && t > 0)).toBe(true);
		state.stop();
		vi.useRealTimers();
	});

	it('сервис без ручки …/work (404 при живом обзоре): страница переходит на опрос обзором и …/work больше не дёргает', async () => {
		vi.useFakeTimers();
		const calls: string[] = [];
		const api = stub(async (path) => {
			calls.push(path.replace('api/cases/f1', '') || '/');
			if (path.endsWith('/boot')) return { ...boot, folder_id: 'f1', has_case: true };
			if (path.endsWith('/folder-files')) return { files: [] };
			if (path.endsWith('/work')) throw new CaseApiError(404, 'not_found');
			return { ...ready, work: work({ cards: 2 }) };
		});
		const state = createCaseState(api, 'f1');
		await state.start();
		await vi.advanceTimersByTimeAsync(5000);
		await vi.advanceTimersByTimeAsync(5000);
		expect(calls.filter((c) => c === '/work').length).toBe(1);
		expect(calls.filter((c) => c === '/').length).toBe(3);
		expect(get(state.bootError)).toBeNull();
		expect(get(state.stale)).toBeNull();
		state.stop();
		vi.useRealTimers();
	});

	it('тайм-аут запроса опроса в api.ts: зависший запрос завершается CaseApiError(0, network), а без timeoutMs — не обрывается', async () => {
		vi.useFakeTimers();
		const api = createCaseApi(
			{ legal_tools_base: '/legal-tools' },
			{
				token: () => 'tok',
				fetcher: (_url, init) =>
					new Promise<Response>((_resolve, reject) => {
						init?.signal?.addEventListener('abort', () => {
							const e = new Error('Aborted');
							e.name = 'AbortError';
							reject(e);
						});
					})
			}
		);
		const p = api.get('api/cases/f1/work', { timeoutMs: 100 });
		const caught = p.catch((e) => e);
		await vi.advanceTimersByTimeAsync(120);
		const err = await caught;
		expect(err).toBeInstanceOf(CaseApiError);
		expect((err as CaseApiError).kind).toBe('network');
		vi.useRealTimers();
	});
});

// ---------------------------------------------------------------------------------------------------------------------
// Возврат по ревью пакета 2 (23.11): вид дела одним правилом, части на паузе, «Мои дела», хронология, одиночный вызов
// ---------------------------------------------------------------------------------------------------------------------
const SS = stringsJson as Record<string, any>;
const view = (kind: string, extra: Record<string, unknown> = {}) => ({
	kind,
	reason: null,
	since: null,
	reasons: [],
	sweeps: 0,
	...extra
});

describe('Н-1: вид дела от сервиса — одно правило для «Обзора», «Моих дел» и листа', () => {
	it('«Обзор»: на паузе — по виду дела, в том числе пауза шага после отказов моделей (общей паузы нет)', () => {
		const step: CaseData = {
			...ready,
			paused: null,
			work: { ...work({ cards: 3 }), paused_groups: ['cards'], view: view('paused', { reason: 'step' }) as any }
		};
		expect(pausedNow(step)).toBe(true);
		const sum = summary(step);
		expect(sum.kind).toBe('processing');
		expect(sum.paused).toEqual({ self: true, key: 'paused_step', since: null, groups: ['cards'] });
		expect(SS[sum.paused!.key]).toBeTruthy();
		// идёт — не на паузе, хотя общая частичная пауза (marks) есть
		const runs: CaseData = {
			...ready,
			paused: { reason: 'marks', since: null, until: null, groups: ['read'] },
			work: { ...work({ cards: 3, read: 1 }), paused_groups: ['read'], view: view('runs') as any }
		};
		expect(pausedNow(runs)).toBe(false);
	});

	it('без поля view (прежний сервис) — прежнее правило; без work — вида нет', () => {
		expect(caseView(ready)).toBeNull();
		expect(caseView({ ...ready, work: work({ cards: 1 }) })?.kind).toBe('runs');
		expect(caseView({ ...ready, work: work({ cards: 1 }, 0, true) })?.kind).toBe('stalled');
		const paused = { reason: 'budget', since: '2026-11-23T10:00:00+00:00', until: null, groups: null };
		expect(caseView({ ...ready, paused, work: work({ cards: 1 }) })).toEqual(
			view('paused', { reason: 'budget', since: paused.since })
		);
		expect(pausedNow({ ...ready, paused, work: work({ cards: 1 }) })).toBe(true);
		expect(
			caseView({
				...ready,
				work: { ...work({}), waiting: { cards: 1 }, waiting_reasons: { cards: ['http_429'] } }
			})
		).toEqual(view('waiting', { reasons: ['http_429'] }));
		expect(caseView({ ...ready, work: work({}, 2) })).toEqual(view('ready', { sweeps: 2 }));
		// вид от сервиса берётся как есть
		const v = view('paused', { reason: 'manual' }) as any;
		expect(caseView({ ...ready, work: { ...work({ cards: 1 }), view: v } })).toBe(v);
	});

	it('«Мои дела»: отметка по виду дела; пауза и ожидание — с причиной; проход — отдельно; опрос 15 / 30 с / нет', () => {
		const list = readListing({
			own: [
				{ folder_id: 'r', case: { id: '1', volumes: 1, changed: null, busy: true, work: view('runs') } },
				{
					folder_id: 'p',
					case: { id: '2', volumes: 1, changed: null, busy: false, work: view('paused', { reason: 'budget' }) }
				},
				{ folder_id: 's', case: { id: '3', volumes: 1, changed: null, busy: false, work: view('stalled') } },
				{
					folder_id: 'w',
					case: {
						id: '4',
						volumes: 1,
						changed: null,
						busy: false,
						work: view('waiting', { reasons: ['http_429'] })
					}
				},
				{ folder_id: 'q', case: { id: '5', volumes: 1, changed: null, busy: false, work: view('ready', { sweeps: 1 }) } },
				{ folder_id: 'z', case: { id: '6', volumes: 1, changed: null, busy: false, work: view('ready') } },
				{ folder_id: 'old', case: { id: '7', volumes: 1, changed: null, busy: true } },
				{ folder_id: 'bad', case: { id: '8', volumes: 1, changed: null, work: { kind: 'nonsense' } } }
			]
		});
		const by = Object.fromEntries(list.map((f) => [f.id, f])) as Record<string, CaseFolder>;
		const why = (w: any) => viewWhy(w, SS);
		const keys = (id: string) => caseMarks(by[id], SS, why).map((m) => m.key);
		expect(keys('r')).toEqual(['my_cases_busy']);
		expect(keys('p')).toEqual(['my_cases_paused']);
		expect(caseMarks(by.p, SS, why)[0].why?.toLowerCase()).toBe(SS.paused_budget.toLowerCase());
		expect(keys('s')).toEqual(['my_cases_stalled']);
		expect(keys('w')).toEqual(['my_cases_waiting']);
		expect(caseMarks(by.w, SS, why)[0].why?.toLowerCase()).toBe(SS.wait_http_429.toLowerCase());
		expect(keys('q')).toEqual(['my_cases_sweeps']);
		expect(keys('z')).toEqual([]);
		expect(keys('old')).toEqual(['my_cases_busy']); // прежний сервис: по busy
		expect(by.bad.case?.work).toBeUndefined();
		for (const k of ['my_cases_busy', 'my_cases_paused', 'my_cases_stalled', 'my_cases_waiting', 'my_cases_sweeps'])
			expect(SS[k], k).toBeTruthy();
		// опрос списка: идёт обработка или проход — 15 с; только пауза / молчание / ожидание — 30 с; ничего — нет
		expect(listDelay([by.p, by.r])).toBe(15000);
		expect(listDelay([by.q])).toBe(15000);
		expect(listDelay([by.old])).toBe(15000);
		expect(listDelay([by.p, by.s, by.w])).toBe(30000);
		expect(listDelay([by.z, by.bad])).toBeNull();
	});
});

describe('Н-6: при частичной паузе строка «идёт» не называет стоящее идущим', () => {
	const w: Work = { ...work({ read: 2, cards: 3 }), paused_groups: ['read'], view: view('runs') as any };
	it('идущие группы — словами хода, группы на паузе — «на паузе: чтение листов»', () => {
		const held = SS.work_paused_tail.replace('{parts}', SS.work_pause_part_read);
		expect(runParts(w, SECTION_WORK.chronology, SS)).toBe(
			`${SS.work_part_cards.replace('{n}', '3')}; ${held}`
		);
		const note = workNote({ work: w, paused: null }, SECTION_WORK.chronology, SS)!;
		expect(note.kind).toBe('runs');
		expect(note.text).toContain(held);
		expect(note.text).not.toContain(SS.work_part_read);
	});
	it('вся работа раздела на паузе — «ждут» существительными; не отвечает — «не отвечает»; ждёт — причина; нет — null', () => {
		const all: Work = { ...work({ read: 2 }), paused_groups: ['read'] };
		const p = workNote({ work: all, paused: null }, SECTION_WORK.check, SS)!;
		expect(p.kind).toBe('waits');
		expect(p.paused).toBe(true);
		expect(p.text).toBe(SS.work_note_paused.replace('{parts}', SS.work_pause_part_read));
		const st = workNote({ work: work({ cards: 1 }, 0, true), paused: null }, SECTION_WORK.amounts, SS)!;
		expect(st.kind).toBe('waits');
		expect(st.text).toContain(SS.work_part_cards.replace('{n}', '1'));
		const wt = workNote(
			{ work: { ...work({}), waiting: { cards: 1 }, waiting_reasons: { cards: ['http_429'] } }, paused: null },
			SECTION_WORK.amounts,
			SS
		)!;
		expect(wt).toEqual({
			kind: 'waiting',
			paused: false,
			text: SS.work_note_waiting.replace('{reason}', SS.wait_http_429)
		});
		expect(workNote({ work: work({ vectors: 1 }), paused: null }, SECTION_WORK.amounts, SS)).toBeNull();
		expect(workNote(ready, SECTION_WORK.amounts, SS)).toBeNull();
	});
});

describe('Н-7: «Хронология» перечитывает весь объём один раз, а не на каждую смену rev', () => {
	const base = { shownRev: 'r1', sameAsked: true, loadedPages: 5, working: false };
	it('та же метка — ничего; идёт работа или прежний сервис без rev — только первая порция; конец работы — всё', () => {
		expect(chronologyReread({ ...base, rev: 'r1' })).toBe('keep');
		expect(chronologyReread({ ...base, rev: 'r2', working: true })).toBe('first');
		expect(chronologyReread({ ...base, rev: null })).toBe('first');
		expect(chronologyReread({ ...base, rev: undefined, working: true })).toBe('first');
		// работа кончилась (метка показанного не обновлялась, пока шла работа) — перечитать весь загруженный объём
		expect(chronologyReread({ ...base, rev: 'r9' })).toBe('all');
		// одна порция или сменился отбор — один запрос
		expect(chronologyReread({ ...base, rev: 'r2', loadedPages: 1, working: true })).toBe('all');
		expect(chronologyReread({ ...base, rev: 'r1', sameAsked: false })).toBe('all');
	});
});

describe('Н-2: одиночный вызов, после которого модель работает, — признак хода, как у группы', () => {
	it('последний вызов — и группа, и одиночный, на обоих путях; строка «Выполнено, готовлю ответ: …»', () => {
		const md = [
			{ type: 'details', attributes: { type: 'tool_calls' } },
			{ type: 'space' }
		];
		expect(lastDetailGroupIndex(md, isMarkdownToolItem, (t) => t.type === 'space')).toBe(0);
		expect(
			lastDetailGroupIndex([...md, { type: 'paragraph' }], isMarkdownToolItem, (t) => t.type === 'space')
		).toBe(-1);
		// «рассуждение» (details без tool_calls) — не вызов
		expect(
			lastDetailGroupIndex([{ type: 'details', attributes: { type: 'reasoning' } }], isMarkdownToolItem, () => false)
		).toBe(-1);
		const so = [{ type: 'detail_single', token: { attributes: { type: 'tool_calls' } } }, { type: 'message', text: ' ' }];
		const empty = (it: any) => it.type === 'message' && !it.text.trim();
		expect(lastDetailGroupIndex(so, isStructuredToolItem, empty)).toBe(0);
		expect(lastDetailGroupIndex([...so, { type: 'message', text: 'Ответ' }], isStructuredToolItem, empty)).toBe(-1);
		expect(toolPreparingLabel('legal-tools_kplus_search')).toMatch(/^Выполнено, готовлю ответ: /);
		expect(toolPreparingLabel('legal-tools_kplus_search')).not.toMatch(/legal-tools|kplus/);
	});
});

