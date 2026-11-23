/* ai-dvokat: данные раздела страницы дела, которые приходят своей ручкой (замена тома, копии, паспорт, хронология,
   сроки, таблицы). Раздел перечитывается вместе с обзором дела, но не чаще заданного промежутка и не пока открыто
   окно (`hold`) — как на прежней странице; одинаковый ответ хранилище не трогает, чтобы раскрытое и выбранное в
   разделе не перерисовывалось. Проверяется vitest (`loader.test.ts`). */
import { get, writable, type Readable } from 'svelte/store';

export type Loader<T> = {
	data: Readable<T | null>;
	/** Отказ последнего запроса (сам объект ошибки — причину словами называет `reasonText`); при удачном — null. */
	error: Readable<unknown>;
	/** Перечитать: `force` — сразу, не глядя на промежуток и на открытое окно. */
	refresh: (force?: boolean) => Promise<void>;
	/** Заменить данные ответом действия (правка вернула новое состояние раздела). */
	set: (value: T | null) => void;
	hold: (on: boolean) => void;
	/** Данные устарели (работа по делу закончилась): следующее обычное перечитывание промежутка не ждёт; открытое
	 *  окно (`hold`) по-прежнему придерживает. */
	touch: () => void;
	stop: () => void;
};

export function createLoader<T>(
	load: () => Promise<T>,
	options: { gap?: number; now?: () => number } = {}
): Loader<T> {
	const gap = options.gap ?? 0;
	const now = options.now ?? (() => Date.now());
	const data = writable<T | null>(null);
	const error = writable<unknown>(null);
	let json = '';
	let busy = false;
	let held = false;
	let stopped = false;
	let at = -Infinity;
	// просьба о свежих данных, пока идёт прежний запрос: force — действие юриста, soft — данные устарели (`touch`)
	let again: null | 'force' | 'soft' = null;
	let current: Promise<void> | null = null;

	async function run(): Promise<void> {
		busy = true;
		at = now();
		try {
			const value = await load();
			if (stopped) return;
			const next = JSON.stringify(value);
			if (next !== json || get(data) === null) {
				json = next;
				data.set(value);
			}
			error.set(null);
		} catch (e) {
			if (!stopped) error.set(e ?? new Error());
		} finally {
			busy = false;
			current = null;
			if (again && !stopped) {
				const force = again === 'force';
				again = null;
				if (!force) at = -Infinity;
				await refresh(force); // зовущий «Обновить» дожидается ответа, собранного после его нажатия
			}
		}
	}

	function refresh(force = false): Promise<void> {
		if (stopped) return Promise.resolve();
		if (busy) {
			if (force) again = 'force'; // действие просит свежие данные, пока идёт прежний запрос
			return current ?? Promise.resolve();
		}
		if (!force && (held || now() - at < gap)) return Promise.resolve();
		current = run();
		return current;
	}

	return {
		data: { subscribe: data.subscribe },
		error: { subscribe: error.subscribe },
		refresh,
		set: (value) => {
			json = JSON.stringify(value);
			data.set(value);
		},
		hold: (on) => {
			held = on;
		},
		touch: () => {
			at = -Infinity;
			if (busy && !again) again = 'soft'; // идущий запрос мог быть собран до конца работы
		},
		stop: () => {
			stopped = true;
		}
	};
}

/** «Обновить» раздела: кнопка занята, пока идёт запрос; по ответу зовётся `done` — и когда данные не изменились
 *  (загрузчик одинаковый ответ не перерисовывает, и без этого у нажатия не было бы видимого ответа). Отказ запроса
 *  показывает сам раздел (`StaleNote`), `done` тогда не зовётся. */
export function createReload<T>(
	loader: Loader<T>,
	done: () => void
): { busy: Readable<boolean>; run: () => Promise<void> } {
	const busy = writable(false);
	return {
		busy: { subscribe: busy.subscribe },
		async run() {
			if (get(busy)) return;
			busy.set(true);
			try {
				await loader.refresh(true);
				if (!get(loader.error)) done();
			} finally {
				busy.set(false);
			}
		}
	};
}

/** Сохранить файл, полученный от сервиса: браузер скачивает его под именем сервиса. */
export function saveBlob(blob: Blob, name: string): void {
	const a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = name;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
