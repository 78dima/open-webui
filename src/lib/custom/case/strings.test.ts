import { describe, expect, it } from 'vitest';
import { CaseApiError } from './api';
import { count, fmt, loadCaseStrings, plural } from './strings';

const forms = ['том', 'тома', 'томов'];

describe('строки страниц «Дел»', () => {
	it('подстановка {имя}: нет значения — остаётся как есть; фигурные скобки в значении не ломают строку', () => {
		expect(fmt('Не получилось: {detail}', { detail: 'нет {связи}' })).toBe(
			'Не получилось: нет {связи}'
		);
		expect(fmt('изменено {date}', {})).toBe('изменено {date}');
		expect(fmt(undefined)).toBe('');
	});
	it('форма слова по числу', () => {
		const got = [0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111, 112].map((n) => plural(n, forms));
		expect(got).toEqual([
			'томов',
			'том',
			'тома',
			'тома',
			'томов',
			'томов',
			'томов',
			'томов',
			'том',
			'тома',
			'томов',
			'том',
			'томов',
			'томов'
		]);
		expect(plural(3, undefined)).toBe('');
	});
	it('«4 тома» и формы с числом внутри', () => {
		expect(count(4, forms)).toBe('4 тома');
		const note = ['из них {n} общее', 'из них {n} общих', 'из них {n} общих'];
		expect([1, 2, 5, 21].map((n) => count(n, note))).toEqual([
			'из них 1 общее',
			'из них 2 общих',
			'из них 5 общих',
			'из них 21 общее'
		]);
	});
});

describe('получение строк ручкой сервиса', () => {
	const answer = (status: number, body: unknown) =>
		(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
	it('адрес — от базы сервиса, без токена; сбой не запоминается, успех — один запрос на базу', async () => {
		const calls: [string, RequestInit | undefined][] = [];
		let fail = true;
		const fetcher = (async (url: string, init?: RequestInit) => {
			calls.push([url, init]);
			return fail
				? new Response(JSON.stringify({ detail: 'Не найдено' }), { status: 404 })
				: new Response(JSON.stringify({ strings: { retry: 'Повторить' } }), { status: 200 });
		}) as unknown as typeof fetch;
		const config = { legal_tools_base: '/lt-test' };
		await expect(loadCaseStrings(config, { fetcher })).rejects.toMatchObject({
			kind: 'not_found',
			status: 404
		});
		fail = false;
		expect(await loadCaseStrings(config, { fetcher })).toEqual({ retry: 'Повторить' });
		expect(await loadCaseStrings(config, { fetcher })).toEqual({ retry: 'Повторить' });
		expect(calls.map((c) => c[0])).toEqual([
			'/lt-test/api/cases/ui.json',
			'/lt-test/api/cases/ui.json'
		]);
		expect(JSON.stringify(calls[0][1])).not.toContain('Authorization');
	});
	it('нет связи и чужая форма ответа — ошибка, а не пустые строки', async () => {
		const down = (async () => {
			throw new TypeError('fetch failed');
		}) as unknown as typeof fetch;
		await expect(
			loadCaseStrings({ legal_tools_base: '/lt-a' }, { fetcher: down })
		).rejects.toBeInstanceOf(CaseApiError);
		await expect(
			loadCaseStrings({ legal_tools_base: '/lt-a' }, { fetcher: down })
		).rejects.toMatchObject({ kind: 'network' });
		await expect(
			loadCaseStrings({ legal_tools_base: '/lt-b' }, { fetcher: answer(200, { strings: [] }) })
		).rejects.toMatchObject({ kind: 'other' });
		await expect(
			loadCaseStrings({ legal_tools_base: '/lt-c' }, { fetcher: answer(503, { detail: 'x' }) })
		).rejects.toMatchObject({ kind: 'unavailable' });
	});
});
