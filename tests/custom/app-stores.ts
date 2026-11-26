// Стенд компонентов: заглушка `$app/stores` (`page`) для SheetView / RefResolve и переходов в CasePageHarness.
import { writable } from 'svelte/store';

export const page = writable<{
	url: URL;
	params: Record<string, string>;
	route: { id: string | null };
}>({
	url: new URL(typeof location !== 'undefined' ? location.href : 'http://127.0.0.1/'),
	params: {},
	route: { id: null }
});
