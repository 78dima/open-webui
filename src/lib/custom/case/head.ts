/* ai-dvokat: действия раздела в шапке страницы дела (макеты K-deadlines, K-passport, K-chronology: «Обновить» рядом
   с заголовком, главное действие раздела — справа). Шапку рисует страница дела, действия называет раздел: кладёт их
   в общее хранилище при появлении и убирает за собой при уходе (только свои — следующий раздел уже мог положить). */
import { getContext, onDestroy, setContext } from 'svelte';
import { writable, type Writable } from 'svelte/store';

export type HeadAction = {
	id: string;
	text: string;
	run: () => void;
	/** Главное действие раздела (справа, заметная кнопка); без признака — тихая кнопка у заголовка. */
	main?: boolean;
	icon?: string;
	testid?: string;
};
type Head = { owner: symbol | null; actions: HeadAction[] };
const KEY = 'cg-case-head';

/** Зовёт страница дела: хранилище действий шапки для её разделов. */
export function provideHead(): Writable<Head> {
	const store = writable<Head>({ owner: null, actions: [] });
	setContext(KEY, store);
	return store;
}
/** Зовёт раздел: `set(действия)` — при каждом изменении слов или прав; при уходе раздела его действия снимаются. */
export function useHead(): (actions: HeadAction[]) => void {
	const store = getContext<Writable<Head> | undefined>(KEY);
	const me = Symbol('section');
	onDestroy(() => store?.update((v) => (v.owner === me ? { owner: null, actions: [] } : v)));
	return (actions) => store?.set({ owner: me, actions });
}
