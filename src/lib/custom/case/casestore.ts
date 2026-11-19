/* ai-dvokat: состояние страницы дела (вариант «Г»): загрузочные данные, обзор с переспрашиванием, загрузки, файлы
   папки вне дела. Одно на всё время, пока открыто дело: разделы меняются, а обзор, очередь загрузок и идущая передача
   остаются (на прежней странице всё было на одной странице — здесь это держит общий макет дела). */
import { get, writable, type Readable } from 'svelte/store';
import type { CaseApi } from './api';
import { CaseApiError } from './api';
import { pollDelay, type Boot, type CaseData } from './casepage';
import { createPoller } from './poll';
import { createUploads, type Uploads } from './uploads';

export type Failure = { kind: CaseApiError['kind']; status: number; message: string };
const failure = (error: unknown): Failure => {
	const e = error as CaseApiError;
	return { kind: e?.kind ?? 'other', status: e?.status ?? 0, message: e?.message ?? '' };
};

export type CaseState = {
	/** Загрузочные данные: undefined — ещё грузятся. */
	boot: Readable<Boot | undefined>;
	bootError: Readable<Failure | null>;
	/** Последний полученный обзор. */
	data: Readable<CaseData | null>;
	/** Обзор не обновился: показаны прежние сведения (или их нет вовсе). */
	stale: Readable<Failure | null>;
	/** Файлов папки вне дела. */
	folderFiles: Readable<number>;
	uploads: Uploads;
	api: CaseApi;
	folderId: string;
	start: () => Promise<void>;
	/** Спросить обзор сейчас («Повторить сейчас», после действия): ответ будет собран после вызова — если запрос уже
	 *  шёл, следом идёт ещё один (иначе счётчики меню и сводка отставали бы на один опрос). */
	refresh: () => Promise<void>;
	/** Пересчитать файлы папки вне дела (после добавления файла в дело пункт меню и число меняются сразу). */
	reloadFolderFiles: () => Promise<void>;
	/** Выбранное в разделе, пока открыта страница дела: отбор и отметки описи, фильтр хронологии, набор и тома таблиц
	 *  (на прежней странице всё жило на одной странице; здесь раздел при уходе снимается, а выбранное остаётся). */
	keep: <T extends object>(key: string, initial: T) => T;
	createCase: () => Promise<void>;
	stop: () => void;
};

export function createCaseState(api: CaseApi, folderId: string): CaseState {
	const path = (rest = '') => `api/cases/${encodeURIComponent(folderId)}${rest}`;
	const boot = writable<Boot | undefined>(undefined);
	const bootError = writable<Failure | null>(null);
	const data = writable<CaseData | null>(null);
	const stale = writable<Failure | null>(null);
	const folderFiles = writable(0);
	const kept = new Map<string, object>();
	let stopped = false;

	const uploads = createUploads({
		api,
		folderId,
		maxFileMb: () => get(boot)?.max_file_mb ?? 0,
		serverUploads: () => get(data)?.uploads ?? [],
		onChange: () => void poller.refresh()
	});

	const poller = createPoller({
		run: async (signal) => {
			try {
				const next = await api.get<CaseData>(path(), { signal });
				if (stopped) return;
				data.set(next);
				stale.set(null);
				uploads.nudge(next.uploads ?? []);
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
		)
			void poller.refresh();
	};

	async function loadFolderFiles() {
		try {
			const d = await api.get<{ files?: unknown[] }>(path('/folder-files'));
			if (!stopped) folderFiles.set(Array.isArray(d?.files) ? d.files.length : 0);
		} catch {
			/* раздела не будет в меню — как на прежней странице, где он скрывался */
		}
	}

	async function start() {
		bootError.set(null);
		try {
			const b = await api.get<Boot>(path('/boot'));
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
		uploads,
		api,
		folderId,
		start,
		refresh: () => poller.refresh(true),
		reloadFolderFiles: loadFolderFiles,
		keep<T extends object>(key: string, initial: T): T {
			if (!kept.has(key)) kept.set(key, initial);
			return kept.get(key) as T;
		},
		async createCase() {
			await api.post(path());
			await start();
		},
		stop() {
			stopped = true;
			poller.stop();
			uploads.destroy();
			if (typeof document !== 'undefined')
				document.removeEventListener('visibilitychange', onVisible);
		}
	};
}
