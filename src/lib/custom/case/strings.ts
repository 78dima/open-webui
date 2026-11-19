/* ai-dvokat: строки страниц «Дел». Источник один — файл текстов сервиса (`case/texts/PAGE_STRINGS.json` legal-tools,
   его вычитывает владелец); форк получает их ручкой `GET <база>/api/cases/ui.json` и копии у себя не держит.
   Обращение к строке — `S.ключ` (в разметке `$S.ключ`): проверка `tests/custom/case-code.spec.ts` сверяет ключи кода
   со строками. Ручка отдаёт ETag и `Cache-Control: no-cache` — повторный заход перепроверяет, а не тянет заново. */
import { writable, type Readable } from 'svelte/store';
import { CaseApiError, detailText, errorKind } from './api';
import { legalToolsBase } from '../jobs';

export type CaseStrings = Record<string, any>;

const store = writable<CaseStrings | null>(null);
/** Строки страницы; `null` — ещё не получены. */
export const caseStrings: Readable<CaseStrings | null> = { subscribe: store.subscribe };

let loading: Promise<CaseStrings> | null = null;
let loadedBase: string | null = null;

/** Получить строки один раз на базу; повторный вызов отдаёт уже полученные. `force` — «Повторить» после сбоя. */
export function loadCaseStrings(
	config: unknown,
	options: { force?: boolean; fetcher?: typeof fetch } = {}
): Promise<CaseStrings> {
	const base = legalToolsBase(config);
	if (loading && loadedBase === base && !options.force) return loading;
	loadedBase = base;
	const attempt = (async () => {
		let response: Response;
		try {
			response = await (options.fetcher ?? fetch)(`${base}/api/cases/ui.json`, {
				headers: { Accept: 'application/json' },
				credentials: 'same-origin',
				redirect: 'error'
			});
		} catch {
			throw new CaseApiError(0, 'network');
		}
		let data: unknown = null;
		try {
			data = await response.json();
		} catch {
			data = null;
		}
		if (!response.ok)
			throw new CaseApiError(response.status, errorKind(response.status), detailText(data));
		const strings = (data as { strings?: unknown } | null)?.strings;
		if (strings === null || typeof strings !== 'object' || Array.isArray(strings))
			throw new CaseApiError(response.status, 'other');
		store.set(strings as CaseStrings);
		return strings as CaseStrings;
	})();
	loading = attempt;
	attempt.catch(() => {
		if (loading === attempt) loading = null; // сбой не запоминается: следующий вызов спросит снова
	});
	return attempt;
}

/** Только для проверок: подставить строки без запроса. */
export function setCaseStrings(strings: CaseStrings | null) {
	store.set(strings);
	loading = strings ? Promise.resolve(strings) : null;
}

/** Подстановка `{имя}`: как `fmt` сервиса и прежней страницы — нет значения, остаётся `{имя}`. */
export function fmt(template: unknown, vars: Record<string, unknown> = {}): string {
	return String(template ?? '').replace(/\{(\w+)\}/g, (match, key) =>
		Object.prototype.hasOwnProperty.call(vars, key) && vars[key] != null ? String(vars[key]) : match
	);
}

/** Форма слова по числу: `forms` — три слова («том», «тома», «томов»), как `pages_forms` в файле строк. */
export function plural(n: number, forms: unknown): string {
	const list = Array.isArray(forms) ? forms : [];
	const abs = Math.abs(Math.trunc(Number(n) || 0));
	const tens = abs % 100;
	const ones = abs % 10;
	const index = tens >= 11 && tens <= 14 ? 2 : ones === 1 ? 0 : ones >= 2 && ones <= 4 ? 1 : 2;
	return String(list[index] ?? list[list.length - 1] ?? '');
}

/** «4 тома»: число и форма слова; формы с `{n}` внутри («из них {n} общих») подставляются тем же вызовом. */
export function count(n: number, forms: unknown): string {
	const form = plural(n, forms);
	return form.includes('{n}') ? fmt(form, { n }) : `${n} ${form}`;
}
