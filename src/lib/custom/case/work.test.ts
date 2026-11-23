/* ai-dvokat: проверки признака хода «работа по делу идёт» (пакет 23.11): сводка не говорит «Готово к работе», пока
   в очереди есть карточки и паспорт; срок опроса 5 с, пока работа идёт; строка хода и признак меню — только у
   разделов, чьи данные зависят от идущей работы; когда работы нет — никаких признаков; загрузчик раздела и «Обновить»;
   страница между полными обзорами спрашивает лёгкую ручку. Прежний сервис (поля `work` нет) — всё по-прежнему. */
import { get } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import bootJson from '../../../../tests/custom/fixtures/case/case-boot.json';
import readyJson from '../../../../tests/custom/fixtures/case/case-overview.json';
import type { CaseApi } from './api';
import {
	SECTION_WORK,
	navGroups,
	pollDelay,
	processing,
	summary,
	workActive,
	workKey,
	workOnly,
	workParts,
	workWatcher,
	type Boot,
	type CaseData,
	type Work
} from './casepage';
import { createCaseState } from './casestore';
import { createLoader, createReload } from './loader';
import { readListing } from './mycases';

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
		expect(marked(cards).sort()).toEqual(['amounts', 'chronology', 'deadlines', 'passport']);
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
		expect(workParts(cards.work, SECTION_WORK.inventory, S)).toEqual([]);
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
