/* ai-dvokat: переспрашивание для страниц «Дел». Повторяет правило прежней страницы дела (`case.js`, `refresh` и
   `schedule`): следующий запрос — через срок, который называет страница (5 с при обработке, 30 с без неё и после
   сбоя); скрытая вкладка не спрашивает, а вернувшаяся спрашивает сразу; одновременно идёт один запрос.
   «Мои дела» не переспрашивает — этим пользуется страница дела. Без DOM-разметки: время и «видна ли вкладка»
   подставляются, поэтому проверяется vitest (`poll.test.ts`). */

export type PollerOptions = {
	/** Один запрос; бросил — сбой (следующий срок — `failedDelay`). */
	run: (signal: AbortSignal) => Promise<void>;
	/** Срок до следующего запроса после успешного, мс. */
	delay: () => number;
	/** Срок после сбоя, мс. */
	failedDelay?: number;
	hidden?: () => boolean;
	setTimer?: (fn: () => void, ms: number) => unknown;
	clearTimer?: (id: unknown) => void;
};

export type Poller = {
	/** Спросить сейчас (и по возвращении вкладки); после ответа ставится следующий срок. */
	refresh: () => Promise<void>;
	/** Остановить: срок снят, идущий запрос прерван. */
	stop: () => void;
	readonly running: boolean;
};

export function createPoller(options: PollerOptions): Poller {
	const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
	const clearTimer =
		options.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
	const hidden = options.hidden ?? (() => typeof document !== 'undefined' && document.hidden);
	let timer: unknown = null;
	let controller: AbortController | null = null;
	let current: Promise<void> | null = null;
	let stopped = false;

	const schedule = (ms: number) => {
		if (timer !== null) clearTimer(timer);
		timer = null;
		if (stopped) return;
		timer = setTimer(() => {
			timer = null;
			if (hidden()) schedule(options.delay());
			else void refresh();
		}, ms);
	};

	const refresh = (): Promise<void> => {
		if (current) return current;
		stopped = false;
		if (timer !== null) clearTimer(timer);
		timer = null;
		const own = new AbortController();
		controller = own;
		const attempt = options.run(own.signal).then(
			() => {
				if (controller === own && !stopped) schedule(options.delay());
			},
			() => {
				if (controller === own && !stopped) schedule(options.failedDelay ?? 30_000);
			}
		);
		current = attempt.finally(() => {
			if (controller === own) {
				controller = null;
				current = null;
			}
		});
		return current;
	};

	return {
		refresh,
		stop() {
			stopped = true;
			if (timer !== null) clearTimer(timer);
			timer = null;
			controller?.abort();
			controller = null;
			current = null;
		},
		get running() {
			return current !== null;
		}
	};
}
