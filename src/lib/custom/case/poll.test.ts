import { describe, expect, it } from 'vitest';
import { createPoller } from './poll';

function clock() {
	let timers: { id: number; fn: () => void; ms: number }[] = [];
	let next = 1;
	return {
		setTimer: (fn: () => void, ms: number) => {
			timers.push({ id: next, fn, ms });
			return next++;
		},
		clearTimer: (id: unknown) => {
			timers = timers.filter((t) => t.id !== id);
		},
		pending: () => timers.map((t) => t.ms),
		fire: () => {
			const t = timers.shift();
			t?.fn();
		}
	};
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('переспрашивание страницы дела', () => {
	it('срок называет страница: 5 с при обработке, 30 с без неё', async () => {
		const c = clock();
		let busy = true;
		let runs = 0;
		const p = createPoller({
			run: async () => void runs++,
			delay: () => (busy ? 5000 : 30000),
			...c
		});
		await p.refresh();
		expect([runs, c.pending()]).toEqual([1, [5000]]);
		busy = false;
		c.fire();
		await settle();
		expect([runs, c.pending()]).toEqual([2, [30000]]);
	});
	it('после сбоя — 30 с; скрытая вкладка не спрашивает, а ждёт следующий срок', async () => {
		const c = clock();
		let hidden = false;
		let runs = 0;
		const p = createPoller({
			run: async () => {
				runs++;
				throw new Error('503');
			},
			delay: () => 5000,
			hidden: () => hidden,
			...c
		});
		await p.refresh();
		expect(c.pending()).toEqual([30000]);
		hidden = true;
		c.fire();
		await settle();
		expect([runs, c.pending()]).toEqual([1, [5000]]);
	});
	it('одновременно идёт один запрос; «стоп» снимает срок и прерывает запрос', async () => {
		const c = clock();
		let release = () => {};
		let aborted = false;
		let runs = 0;
		const p = createPoller({
			run: (signal) =>
				new Promise<void>((resolve) => {
					runs++;
					signal.addEventListener('abort', () => (aborted = true));
					release = resolve;
				}),
			delay: () => 5000,
			...c
		});
		const first = p.refresh();
		expect(p.refresh()).toBe(first);
		expect([runs, p.running]).toEqual([1, true]);
		p.stop();
		release();
		await settle();
		expect([aborted, c.pending(), p.running]).toEqual([true, [], false]);
	});
});
