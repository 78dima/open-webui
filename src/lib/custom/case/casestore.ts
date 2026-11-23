/* ai-dvokat: состояние страницы дела (вариант «Г»): загрузочные данные, обзор с переспрашиванием, загрузки, файлы
   папки вне дела. Одно на всё время, пока открыто дело: разделы меняются, а обзор, очередь загрузок и идущая передача
   остаются (на прежней странице всё было на одной странице — здесь это держит общий макет дела). */
import { get, writable, type Readable } from 'svelte/store';
import type { CaseApi } from './api';
import { CaseApiError } from './api';
import { pollDelay, workKey, workOnly, type Boot, type CaseData, type Work } from './casepage';
import { createPoller } from './poll';
import { createUploads, type Uploads } from './uploads';

export type Failure = { kind: CaseApiError['kind']; status: number; message: string };
const failure = (error: unknown): Failure => {
	const e = error as CaseApiError;
	return { kind: e?.kind ?? 'other', status: e?.status ?? 0, message: e?.message ?? '' };
};

export type FolderFile = {
	id: string;
	name?: string | null;
	size?: number;
	readable?: boolean;
	adding?: boolean;
	kind?: string | null;
};
export type FolderFilesState = {
	files: FolderFile[] | null;
	error: Failure | null;
	loading: boolean;
};

/** Пока идёт только работа по делу (карточки, паспорт, проходы…), страница раз в 5 с спрашивает лёгкую ручку
 *  `…/work`, а обзор целиком — когда состав работы изменился, после действия юриста и не реже этого срока (мс). */
export const FULL_EVERY_MS = 30000;
/** Тайм-аут запросов опроса (лёгкого `…/work` и обзора в цикле), мс; у действий юриста тайм-аута нет (Р-10). */
export const POLL_TIMEOUT_MS = 15000;
/** Короткое окно сведения частых записей в один запрос обзора (мс). */
export const WRITE_COALESCE_MS = 300;
const FOLDER_UPLOAD_BUSY = new Set(['receiving', 'received', 'intake']);

export type CaseState = {
	/** Загрузочные данные: undefined — ещё грузятся. */
	boot: Readable<Boot | undefined>;
	bootError: Readable<Failure | null>;
	/** Последний полученный обзор. */
	data: Readable<CaseData | null>;
	/** Обзор не обновился: показаны прежние сведения (или их нет вовсе). */
	stale: Readable<Failure | null>;
	/** Файлов папки вне дела (счётчик). */
	folderFiles: Readable<number>;
	/** Общее состояние «Файлов папки вне дела» для меню и раздела (список, ошибка, загрузка). */
	folderFilesState: Readable<FolderFilesState>;
	uploads: Uploads;
	api: CaseApi;
	folderId: string;
	start: () => Promise<void>;
	/** Спросить обзор сейчас («Повторить сейчас», после действия): ответ будет собран после вызова — если запрос уже
	 *  шёл, следом идёт ещё один (иначе счётчики меню и сводка отставали бы на один опрос). */
	refresh: () => Promise<void>;
	/** Пересчитать файлы папки вне дела (единый загрузчик для меню и раздела). */
	reloadFolderFiles: () => Promise<void>;
	/** Выбранное в разделе, пока открыта страница дела: отбор и отметки описи, фильтр хронологии, набор и тома таблиц
	 *  (на прежней странице всё жило на одной странице; здесь раздел при уходе снимается, а выбранное остаётся). */
	keep: <T extends object>(key: string, initial: T) => T;
	createCase: () => Promise<void>;
	stop: () => void;
};

export function createCaseState(
	rawApi: CaseApi,
	folderId: string,
	deps: { coalesceMs?: number } = {}
): CaseState {
	const path = (rest = '') => `api/cases/${encodeURIComponent(folderId)}${rest}`;
	const coalesceMs = deps.coalesceMs ?? WRITE_COALESCE_MS;
	const boot = writable<Boot | undefined>(undefined);
	const bootError = writable<Failure | null>(null);
	const data = writable<CaseData | null>(null);
	const stale = writable<Failure | null>(null);
	const folderFiles = writable(0);
	const folderFilesState = writable<FolderFilesState>({ files: null, error: null, loading: false });
	const kept = new Map<string, object>();
	let stopped = false;
	let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
	let lastWriteRefreshAt = 0;
	let prevBusyUploads: string | null = null;
	let fullAt = 0; // когда обзор пришёл целиком
	let wantFull = true; // следующий запрос — обзор целиком (первый, после действия, по возвращении вкладки)
	let noWorkEndpoint = false; // сервис без ручки …/work (404 при живом обзоре) — работать по обзору (Р-10)

	function scheduleRefresh() {
		if (stopped) return;
		const now = Date.now();
		const elapsed = now - lastWriteRefreshAt;
		if (!coalesceTimer && elapsed >= coalesceMs) {
			lastWriteRefreshAt = now;
			wantFull = true;
			void poller.refresh(true);
			return;
		}
		if (!coalesceTimer) {
			coalesceTimer = setTimeout(
				() => {
					coalesceTimer = null;
					if (stopped) return;
					lastWriteRefreshAt = Date.now();
					wantFull = true;
					void poller.refresh(true);
				},
				Math.max(0, coalesceMs - elapsed)
			);
		}
	}

	const api: CaseApi = {
		base: rawApi.base,
		url: rawApi.url,
		download: rawApi.download,
		get: rawApi.get,
		async request<T = unknown>(
			method: string,
			reqPath: string,
			body?: unknown,
			options?: Parameters<CaseApi['request']>[3]
		): Promise<T> {
			const res = await rawApi.request<T>(method, reqPath, body, options);
			const m = method.toUpperCase();
			if (m !== 'GET' && m !== 'HEAD' && options?.refresh !== false) scheduleRefresh();
			return res;
		},
		post<T = unknown>(
			reqPath: string,
			body?: unknown,
			options?: Parameters<CaseApi['post']>[2]
		): Promise<T> {
			return api.request<T>('POST', reqPath, body, options);
		}
	};

	const uploads = createUploads({
		api,
		folderId,
		maxFileMb: () => get(boot)?.max_file_mb ?? 0,
		serverUploads: () => get(data)?.uploads ?? []
	});

	const poller = createPoller({
		run: async (signal) => {
			try {
				const cur = get(data);
				let lightWas404 = false;
				if (
					cur &&
					!wantFull &&
					!noWorkEndpoint &&
					workOnly(cur, uploads.running()) &&
					Date.now() - fullAt < FULL_EVERY_MS
				) {
					// лёгкий запрос: счёт задач в строке хода тикает, обзор целиком не собирается; при сбое лёгкого
					// запроса тем же заходом идём в обзор целиком, «нет связи» не ставим (Р-10)
					try {
						const light = await rawApi.get<{ work: Work; paused: CaseData['paused'] }>(
							path('/work'),
							{ signal, timeoutMs: POLL_TIMEOUT_MS }
						);
						if (stopped) return;
						const same =
							workKey(light.work) === workKey(cur.work) &&
							(light.paused?.reason ?? '') === (cur.paused?.reason ?? '');
						if (same) {
							if (JSON.stringify(light.work) !== JSON.stringify(cur.work))
								data.set({ ...cur, work: light.work, paused: light.paused });
							stale.set(null);
							return;
						}
						// состав работы изменился (группа закончилась или началась) — обзор целиком тем же заходом
					} catch (lightErr) {
						if ((lightErr as Error)?.name === 'AbortError' || stopped) return;
						if (failure(lightErr).kind === 'not_found') lightWas404 = true;
						// идём в обзор целиком тем же заходом
					}
				}
				wantFull = false;
				const next = await rawApi.get<CaseData>(path(), { signal, timeoutMs: POLL_TIMEOUT_MS });
				if (stopped) return;
				if (lightWas404) noWorkEndpoint = true;
				fullAt = Date.now();
				data.set(next);
				stale.set(null);
				uploads.nudge(next.uploads ?? []);
				const busyKey = (next.uploads ?? [])
					.filter((u) => FOLDER_UPLOAD_BUSY.has(u.phase))
					.map((u) => u.id)
					.sort()
					.join(',');
				const hasAdding = (get(folderFilesState).files ?? []).some((f) => f.adding);
				if (prevBusyUploads !== null && (hasAdding || busyKey !== prevBusyUploads))
					void loadFolderFiles();
				prevBusyUploads = busyKey;
			} catch (error) {
				if ((error as Error)?.name === 'AbortError' || stopped) return;
				const f = failure(error);
				if (f.kind === 'not_found') {
					// дело удалили или доступ сняли, пока страница открыта: «Не найдено» вместо прежних данных на экране
					// (как прежняя страница); опрос прекращается
					bootError.set(f);
					boot.set(undefined); // меню разделов и шапка дела уходят вместе с данными — как при «Не найдено» с порога
					data.set(null);
					stale.set(null);
					queueMicrotask(() => poller.stop());
					return;
				}
				stale.set(f);
				throw error;
			}
		},
		delay: () => pollDelay(get(data), uploads.running())
	});

	const onVisible = () => {
		// дела больше нет (обзор ответил «Не найдено») — спрашивать нечего, пока страницу не откроют заново
		if (
			typeof document !== 'undefined' &&
			!document.hidden &&
			get(boot)?.has_case &&
			!get(bootError)
		) {
			wantFull = true;
			void poller.refresh();
		}
	};

	let folderFilesSeq = 0;
	async function loadFolderFiles() {
		const mine = ++folderFilesSeq;
		folderFilesState.update((s) => ({ ...s, loading: true }));
		try {
			const d = await rawApi.get<{ files?: FolderFile[] }>(path('/folder-files'));
			if (stopped || mine !== folderFilesSeq) return;
			const list = Array.isArray(d?.files) ? d.files : [];
			folderFiles.set(list.length);
			folderFilesState.set({ files: list, error: null, loading: false });
		} catch (error) {
			if (stopped || mine !== folderFilesSeq) return;
			// И-4: сбой запроса — не ноль: пункт меню остаётся, раздел показывает свою ошибку с «Повторить»
			folderFilesState.update((s) => ({ ...s, error: failure(error), loading: false }));
		}
	}

	async function start() {
		bootError.set(null);
		try {
			const b = await rawApi.get<Boot>(path('/boot'));
			if (stopped) return;
			boot.set(b);
			if (!b.has_case) return;
			if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
			void loadFolderFiles();
			await poller.refresh();
		} catch (error) {
			if (!stopped) bootError.set(failure(error));
		}
	}

	return {
		boot,
		bootError,
		data,
		stale,
		folderFiles,
		folderFilesState,
		uploads,
		api,
		folderId,
		start,
		refresh: () => {
			wantFull = true;
			return poller.refresh(true);
		},
		reloadFolderFiles: loadFolderFiles,
		keep<T extends object>(key: string, initial: T): T {
			if (!kept.has(key)) kept.set(key, initial);
			return kept.get(key) as T;
		},
		async createCase() {
			await rawApi.post(path());
			await start();
		},
		stop() {
			stopped = true;
			if (coalesceTimer !== null) {
				clearTimeout(coalesceTimer);
				coalesceTimer = null;
			}
			poller.stop();
			uploads.destroy();
			if (typeof document !== 'undefined')
				document.removeEventListener('visibilitychange', onVisible);
		}
	};
}
