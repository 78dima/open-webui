/* ai-dvokat: клиент ручек дела legal-tools для страниц «Дел» (вариант «Г»).
   Данные берутся теми же ручками, что у прежних страниц сервиса (`…/api/cases…`). База — путь того же источника из
   `custom_ui.legal_tools_base` (`legalToolsBase`), вход — токен сессии Open WebUI, как в `jobs.ts`. Запись несёт
   `X-Ai-Case: 1`; `Origin` ставит браузер — их проверяет `check_write` сервиса. Ответ об ошибке сервис отдаёт как
   `{detail: строка для юриста}` — она и попадает в `message`. */
import { legalToolsBase } from '../jobs';

export type CaseErrorKind =
	| 'network' // ответа нет: сеть, обрыв
	| 'auth' // 401: вход истёк или его нет
	| 'forbidden' // 403: запись с чужой страницы
	| 'not_found' // 404: нет доступа, нет дела, вне группы выпуска, выпуск выключен — снаружи одинаково
	| 'conflict' // 409: фраза сервера для юриста
	| 'unavailable' // 503: Open WebUI или хранилище не ответили сервису
	| 'other';

export class CaseApiError extends Error {
	constructor(
		public status: number,
		public kind: CaseErrorKind,
		message = '',
		public detail: unknown = undefined
	) {
		super(message);
		this.name = 'CaseApiError';
	}
}

export const errorKind = (status: number): CaseErrorKind =>
	status === 0
		? 'network'
		: status === 401
			? 'auth'
			: status === 403
				? 'forbidden'
				: status === 404
					? 'not_found'
					: status === 409
						? 'conflict'
						: status === 503
							? 'unavailable'
							: 'other';

/** Фраза сервера из тела ответа: `detail` строкой или `detail.text`; иначе пусто — слова выбирает страница. */
export function detailText(data: unknown): string {
	const detail = (data as { detail?: unknown } | null)?.detail;
	if (typeof detail === 'string') return detail;
	const text = (detail as { text?: unknown } | null)?.text;
	return typeof text === 'string' ? text : '';
}

export type CaseRequestOptions = { signal?: AbortSignal };
export type CaseApi = {
	base: string;
	/** Адрес в сервисе от его базы: `url('case/<папка>')` — прежняя страница дела и листы. */
	url: (path: string) => string;
	request: <T = unknown>(
		method: string,
		path: string,
		body?: unknown,
		options?: CaseRequestOptions
	) => Promise<T>;
	get: <T = unknown>(path: string, options?: CaseRequestOptions) => Promise<T>;
	post: <T = unknown>(path: string, body?: unknown, options?: CaseRequestOptions) => Promise<T>;
};

const sessionToken = (): string | null => {
	try {
		return localStorage.getItem('token');
	} catch {
		return null;
	}
};

/** `config` — значение `custom_ui` из `/api/config`; `token` и `fetcher` подменяются в проверках. */
export function createCaseApi(
	config: unknown,
	deps: { token?: () => string | null; fetcher?: typeof fetch } = {}
): CaseApi {
	const base = legalToolsBase(config);
	const token = deps.token ?? sessionToken;
	const url = (path: string) => `${base}/${path.replace(/^\/+/, '')}`;

	async function request<T>(
		method: string,
		path: string,
		body?: unknown,
		options: CaseRequestOptions = {}
	): Promise<T> {
		const bearer = token();
		if (!bearer) throw new CaseApiError(401, 'auth');
		const headers: Record<string, string> = {
			Accept: 'application/json',
			Authorization: `Bearer ${bearer}`
		};
		const init: RequestInit = {
			method,
			headers,
			credentials: 'same-origin',
			redirect: 'error',
			cache: 'no-store',
			signal: options.signal
		};
		if (method !== 'GET' && method !== 'HEAD') headers['X-Ai-Case'] = '1';
		if (typeof Blob !== 'undefined' && body instanceof Blob) {
			init.body = body;
			headers['Content-Type'] = 'application/octet-stream';
		} else if (body !== undefined) {
			init.body = JSON.stringify(body);
			headers['Content-Type'] = 'application/json';
		}
		let response: Response;
		try {
			response = await (deps.fetcher ?? fetch)(url(path), init);
		} catch (error) {
			if ((error as { name?: string } | null)?.name === 'AbortError') throw error;
			throw new CaseApiError(0, 'network');
		}
		let data: unknown = null;
		let foreign = false;
		try {
			const text = await response.text();
			data = text ? JSON.parse(text) : null;
		} catch (error) {
			if ((error as { name?: string } | null)?.name === 'AbortError') throw error;
			data = null;
			foreign = true;
		}
		// «200», но не JSON — ответил не сервис (например, приложение чата отдало свою страницу по этому пути,
		// когда путь к сервису не настроен): это сбой, а не пустой список
		if (response.ok && foreign) throw new CaseApiError(response.status, 'other');
		if (!response.ok) {
			throw new CaseApiError(
				response.status,
				errorKind(response.status),
				detailText(data),
				(data as { detail?: unknown } | null)?.detail
			);
		}
		return data as T;
	}

	return {
		base,
		url,
		request,
		get: (path, options) => request('GET', path, undefined, options),
		post: (path, body, options) => request('POST', path, body, options)
	};
}
