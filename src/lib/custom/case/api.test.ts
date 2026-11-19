import { describe, expect, it } from 'vitest';
import { CaseApiError, createCaseApi, detailText, errorKind } from './api';

type Call = { url: string; init: RequestInit };
const client = (respond: (call: Call) => Response | Promise<Response>, token: string | null = 'tok') => {
	const calls: Call[] = [];
	const fetcher = (async (url: string, init: RequestInit) => {
		const call = { url, init };
		calls.push(call);
		return respond(call);
	}) as unknown as typeof fetch;
	return { api: createCaseApi({ legal_tools_base: '/legal-tools' }, { token: () => token, fetcher }), calls };
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const headers = (call: Call) => call.init.headers as Record<string, string>;

describe('клиент ручек дела', () => {
	it('чтение: путь от базы сервиса, токен сессии, без признака записи и без кэша', async () => {
		const { api, calls } = client(() => json(200, { own: [], shared: [] }));
		expect(await api.get('api/cases')).toEqual({ own: [], shared: [] });
		expect(calls[0].url).toBe('/legal-tools/api/cases');
		expect(headers(calls[0]).Authorization).toBe('Bearer tok');
		expect(headers(calls[0])['X-Ai-Case']).toBeUndefined();
		expect(calls[0].init).toMatchObject({ method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
	});
	it('запись несёт X-Ai-Case: 1; тело — JSON или байты части файла', async () => {
		const { api, calls } = client(() => json(201, { created: true }));
		await api.post('api/cases/f-1');
		await api.request('PATCH', 'api/cases/f-1/volumes/v', { label: '2' });
		await api.request('PUT', 'api/cases/f-1/uploads/u/parts/1', new Blob(['abc']));
		expect(calls.map((c) => headers(c)['X-Ai-Case'])).toEqual(['1', '1', '1']);
		expect(calls[0].init.body).toBeUndefined();
		expect(calls[1].init.body).toBe('{"label":"2"}');
		expect(headers(calls[1])['Content-Type']).toBe('application/json');
		expect(headers(calls[2])['Content-Type']).toBe('application/octet-stream');
	});
	it('база — только путь того же источника: чужой адрес в настройке не уводит токен', () => {
		expect(createCaseApi({ legal_tools_base: 'https://example.org' }).base).toBe('/legal-tools');
		expect(createCaseApi(undefined).url('/case/f-1')).toBe('/legal-tools/case/f-1');
	});
	it('ошибки: вид по коду, фраза сервиса — из detail', async () => {
		const cases: [number, unknown, string, string][] = [
			[401, { detail: 'Войдите в «Юрист РФ» и откройте ссылку снова' }, 'auth', 'Войдите в «Юрист РФ» и откройте ссылку снова'],
			[403, { detail: 'запрос с чужой страницы' }, 'forbidden', 'запрос с чужой страницы'],
			[404, { detail: 'Не найдено' }, 'not_found', 'Не найдено'],
			[409, { detail: { text: 'этот файл уже в деле или ещё добавляется' } }, 'conflict', 'этот файл уже в деле или ещё добавляется'],
			[503, { detail: 'Open WebUI временно не отвечает — список папок не получить' }, 'unavailable', 'Open WebUI временно не отвечает — список папок не получить'],
			[500, { detail: 'внутренняя ошибка — повторите позже' }, 'other', 'внутренняя ошибка — повторите позже']
		];
		for (const [status, body, kind, message] of cases) {
			const { api } = client(() => json(status, body));
			await expect(api.get('api/cases')).rejects.toMatchObject({ status, kind, message });
		}
		const { api } = client(() => new Response('<html>шлюз</html>', { status: 502 }));
		await expect(api.get('api/cases')).rejects.toMatchObject({ status: 502, kind: 'other', message: '' });
	});
	it('нет связи — network; нет входа — auth без запроса; отмена — как отмена', async () => {
		const down = client(() => {
			throw new TypeError('Failed to fetch');
		});
		await expect(down.api.get('api/cases')).rejects.toMatchObject({ status: 0, kind: 'network' });
		const anon = client(() => json(200, {}), null);
		await expect(anon.api.get('api/cases')).rejects.toBeInstanceOf(CaseApiError);
		await expect(anon.api.get('api/cases')).rejects.toMatchObject({ kind: 'auth' });
		expect(anon.calls).toHaveLength(0);
		const aborted = client(() => {
			throw new DOMException('Aborted', 'AbortError');
		});
		await expect(aborted.api.get('api/cases')).rejects.toMatchObject({ name: 'AbortError' });
	});
	it('вид ошибки и фраза — отдельными функциями', () => {
		expect([0, 401, 403, 404, 409, 503, 418].map(errorKind)).toEqual([
			'network', 'auth', 'forbidden', 'not_found', 'conflict', 'unavailable', 'other'
		]);
		expect(detailText(null)).toBe('');
		expect(detailText({ detail: [{ msg: 'x' }] })).toBe('');
	});
});
