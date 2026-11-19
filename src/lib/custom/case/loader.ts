/* ai-dvokat: данные раздела страницы дела, которые приходят своей ручкой (замена тома, копии, паспорт, хронология,
   сроки, таблицы). Раздел перечитывается вместе с обзором дела, но не чаще заданного промежутка и не пока открыто
   окно (`hold`) — как на прежней странице; одинаковый ответ хранилище не трогает, чтобы раскрытое и выбранное в
   разделе не перерисовывалось. Проверяется vitest (`loader.test.ts`). */
import { get, writable, type Readable } from 'svelte/store';

export type Loader<T> = {
	data: Readable<T | null>;
	/** Фраза ошибки последнего запроса; при следующем удачном — пусто. */
	error: Readable<string>;
	/** Перечитать: `force` — сразу, не глядя на промежуток и на открытое окно. */
	refresh: (force?: boolean) => Promise<void>;
	/** Заменить данные ответом действия (правка вернула новое состояние раздела). */
	set: (value: T | null) => void;
	hold: (on: boolean) => void;
	stop: () => void;
};

export function createLoader<T>(
	load: () => Promise<T>,
	options: { gap?: number; now?: () => number } = {}
): Loader<T> {
	const gap = options.gap ?? 0;
	const now = options.now ?? (() => Date.now());
	const data = writable<T | null>(null);
	const error = writable('');
	let json = '';
	let busy = false;
	let held = false;
	let stopped = false;
	let at = -Infinity;
	let again = false;

	async function refresh(force = false): Promise<void> {
		if (stopped) return;
		if (busy) {
			again = again || force; // действие просит свежие данные, пока идёт прежний запрос
			return;
		}
		if (!force && (held || now() - at < gap)) return;
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
			error.set('');
		} catch (e) {
			if (!stopped) error.set((e as { message?: string } | null)?.message ?? '');
		} finally {
			busy = false;
			if (again && !stopped) {
				again = false;
				void refresh(true);
			}
		}
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
		stop: () => {
			stopped = true;
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
