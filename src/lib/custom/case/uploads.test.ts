import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { CaseApiError, type CaseApi } from './api';
import type { Upload } from './casepage';
import {
	backoff,
	classify,
	createUploads,
	fileKey,
	missingParts,
	planParts,
	planRows,
	retryAgain,
	serverFailed,
	serverTextKey
} from './uploads';

const MB = 1048576;
const file = (name: string, size: number, path = '') => {
	const f = new File([new Uint8Array(size)], name, { lastModified: 1700000000000 });
	if (path) Object.defineProperty(f, 'webkitRelativePath', { value: path });
	return f;
};
const settle = async (n = 30) => {
	for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

/** Подставной сервис загрузок: помнит части, отвечает как настоящий (`uploads.upload_view`), умеет сбоить. */
function server(partSize = 4) {
	const uploads = new Map<
		string,
		{ info: Upload; parts: Map<number, number>; completed: boolean; deleted: boolean }
	>();
	const calls: { method: string; path: string; body?: unknown }[] = [];
	const fails: ((method: string, path: string) => CaseApiError | null)[] = [];
	let next = 1;
	const view = (id: string) => {
		const u = uploads.get(id)!;
		return { ...u.info, parts: [...u.parts].map(([n, size]) => ({ n, size })) };
	};
	const request = async (method: string, path: string, body?: unknown) => {
		calls.push({ method, path, body });
		for (const f of fails) {
			const e = f(method, path);
			if (e) throw e;
		}
		const m = /uploads(?:\/([^/]+))?(?:\/(parts\/(\d+)|complete))?$/.exec(path)!;
		const [, id, tail, n] = m;
		if (method === 'POST' && !id) {
			const b = body as { filename: string; size: number };
			const nid = `u-${next++}`;
			uploads.set(nid, {
				info: {
					id: nid,
					filename: b.filename,
					size: b.size,
					received: 0,
					part_size: partSize,
					status: 'receiving',
					phase: 'receiving'
				} as Upload,
				parts: new Map(),
				completed: false,
				deleted: false
			});
			return { upload: view(nid) };
		}
		const u = uploads.get(id);
		if (!u || u.deleted) throw new CaseApiError(404, 'not_found', 'Не найдено');
		if (method === 'GET') return view(id);
		if (method === 'PUT') {
			u.parts.set(Number(n), (body as Blob).size);
			return { ok: true };
		}
		if (method === 'POST' && tail === 'complete') {
			u.completed = true;
			return { ok: true };
		}
		if (method === 'DELETE') {
			u.deleted = true;
			return { ok: true };
		}
		throw new Error(`unexpected ${method} ${path}`);
	};
	const api = {
		base: '/legal-tools',
		url: (p: string) => `/legal-tools/${p}`,
		request,
		get: (p: string) => request('GET', p),
		post: (p: string, b?: unknown) => request('POST', p, b)
	} as unknown as CaseApi;
	return { api, uploads, calls, fails, view };
}
function memory(initial: Record<string, string> = {}) {
	const data = { ...initial };
	return {
		data,
		getItem: (k: string) => data[k] ?? null,
		setItem: (k: string, v: string) => void (data[k] = v)
	};
}
const engine = (
	s: ReturnType<typeof server>,
	extra: Partial<Parameters<typeof createUploads>[0]> = {}
) => {
	const changes: number[] = [];
	const up = createUploads({
		api: s.api,
		folderId: 'f 1',
		maxFileMb: () => 100,
		serverUploads: () => [],
		onChange: () => changes.push(1),
		storage: memory(),
		second: async () => undefined,
		makeId: (() => {
			let n = 0;
			return () => `batch-${++n}`;
		})(),
		...extra
	});
	return { up, changes, state: () => get(up) };
};

describe('ядро загрузки частями', () => {
	it('части по размеру сервера; недостающие — те, что не дошли целиком', () => {
		expect(planParts(10, 4)).toEqual([
			{ n: 1, start: 0, end: 4 },
			{ n: 2, start: 4, end: 8 },
			{ n: 3, start: 8, end: 10 }
		]);
		expect(planParts(0, 4)).toHaveLength(1);
		const plan = planParts(10, 4);
		expect(
			missingParts(plan, [
				{ n: 1, size: 4 },
				{ n: 2, size: 3 }
			]).map((p) => p.n)
		).toEqual([2, 3]);
		expect(missingParts(plan, undefined)).toHaveLength(3);
	});
	it('повтор: сеть, 408 и 429 — без счёта; 5xx — не больше пяти подряд; пауза растёт до 30 с', () => {
		expect([0, 408, 429].map((s) => retryAgain(s, 99))).toEqual([true, true, true]);
		expect([
			retryAgain(500, 4),
			retryAgain(500, 5),
			retryAgain(404, 0),
			retryAgain(409, 0)
		]).toEqual([true, false, false, false]);
		expect([1, 2, 3, 4, 5, 9].map(backoff)).toEqual([2, 4, 8, 16, 30, 30]);
	});
	it('форматы: PDF, ZIP, фото; Word и Excel не принимаются', () => {
		expect(['a.PDF', 'b.zip', 'c.jpeg', 'd.HEIC', 'e.docx', 'f.xlsx', 'g'].map(classify)).toEqual([
			'pdf',
			'zip',
			'photo',
			'photo',
			null,
			null,
			null
		]);
	});
	it('строки к загрузке: PDF и ZIP — по строке, фото — одной серией; каталог — один batch и порядок по пути', () => {
		let n = 0;
		const id = () => `b${++n}`;
		const loose = planRows(
			[file('1.pdf', 1), file('a.jpg', 1), file('b.png', 1), file('x.zip', 1)],
			id
		);
		expect(loose.map((r) => [r.kind, r.files.length, r.inputKind, r.batch, r.group])).toEqual([
			['pdf', 1, null, null, null],
			['zip', 1, null, null, null],
			['photo', 2, 'photo', 'b1', null]
		]);
		const dir = planRows(
			[
				file('2.pdf', 1, 'Тома/2.pdf'),
				file('1.pdf', 1, 'Тома/1.pdf'),
				file('n.txt', 1, 'Тома/n.txt')
			],
			id
		);
		expect(dir.map((r) => [r.files[0].name, r.batch, r.group])).toEqual([
			['1.pdf', 'b2', 'b2'],
			['2.pdf', 'b2', 'b2']
		]);
		expect(planRows([file('one.jpg', 1)], id)[0].batch).toBeNull();
	});
	it('слова этапа приёма — по этапу сервера', () => {
		expect(
			['received', 'intake', 'failed', 'intake_failed', 'done_nofile', 'странный'].map(
				serverTextKey
			)
		).toEqual([
			'upload_status_received',
			'upload_status_intake',
			'upload_status_failed_g',
			'upload_status_intake_failed',
			'upload_status_done_nofile_g',
			'upload_status_received'
		]);
		expect([serverFailed('failed'), serverFailed('intake_failed'), serverFailed('intake')]).toEqual(
			[true, true, false]
		);
	});
});

describe('загрузка: очередь, отправка, продолжение', () => {
	it('без ответа «что это» у PDF не стартует; с ответом — создаёт загрузку с видом, томом и каталогом', async () => {
		const s = server();
		const { up, state, changes } = engine(s);
		expect(
			up.addFiles([
				file('tom.pdf', 10, 'Тома/tom.pdf'),
				file('b.pdf', 3, 'Тома/b.pdf'),
				file('doc.docx', 5),
				file('big.pdf', 101 * MB)
			])
		).toEqual([
			{ name: 'doc.docx', why: 'format' },
			{ name: 'big.pdf', why: 'big' }
		]);
		expect(state().pending.map((r) => r.files[0].name)).toEqual(['b.pdf', 'tom.pdf']);
		expect(up.start()).toBe(false);
		expect(state().kindMissing).toBe(true);
		expect(s.calls).toEqual([]);
		const [b, tom] = state().pending;
		up.setGroupKind(tom.group!, 'volume');
		expect(state().kindMissing).toBe(false);
		up.setKind(b.id, 'e_case');
		up.setLabel(tom.id, ' 5/1 ');
		up.setCont(tom.id, '7'); // номер тома заполнен — продолжение не учитывается
		up.setCont(b.id, '4');
		expect(up.start()).toBe(true);
		await settle();
		const created = s.calls
			.filter((c) => c.method === 'POST' && c.path.endsWith('/uploads'))
			.map((c) => c.body);
		expect(created).toEqual([
			{
				filename: 'b.pdf',
				size: 3,
				input_kind: 'e_case',
				volume_hint: null,
				continues_volume_id: 4,
				batch_id: 'batch-1',
				member_path: 'Тома/b.pdf'
			},
			{
				filename: 'tom.pdf',
				size: 10,
				input_kind: 'volume',
				volume_hint: '5/1',
				continues_volume_id: null,
				batch_id: 'batch-1',
				member_path: 'Тома/tom.pdf'
			}
		]);
		expect(s.calls[0].path).toBe('api/cases/f%201/uploads');
		expect(state().active.map((a) => [a.name, a.state, a.sent])).toEqual([
			['Тома/b.pdf', 'done', 3],
			['Тома/tom.pdf', 'done', 10]
		]);
		expect([...s.uploads.values()].map((u) => [[...u.parts.values()], u.completed])).toEqual([
			[[3], true],
			[[4, 4, 2], true]
		]);
		expect(changes.length).toBe(2);
		expect(state().pending).toEqual([]);
	});

	it('одновременно идут два файла, третий ждёт очереди', async () => {
		const s = server();
		let release: () => void = () => {};
		const gate = new Promise<void>((r) => (release = r));
		s.fails.push((method) => (method === 'PUT' ? null : null));
		const original = s.api.request;
		(s.api as { request: CaseApi['request'] }).request = (async (
			method: string,
			path: string,
			body?: unknown
		) => {
			if (method === 'PUT') await gate;
			return original(method, path, body);
		}) as CaseApi['request'];
		const { up, state } = engine(s);
		up.addFiles([file('1.jpg', 2), file('2.jpg', 2), file('3.jpg', 2)]);
		up.start();
		await settle();
		expect(state().active.map((a) => a.state)).toEqual(['running', 'running', 'queued']);
		expect(up.running()).toBe(true);
		release();
		await settle();
		expect(state().active.map((a) => a.state)).toEqual(['done', 'done', 'done']);
		expect(up.running()).toBe(false);
	});

	it('обрыв связи посреди файла: повтор сам, уже переданные части не шлются заново', async () => {
		const s = server();
		let drop = 2;
		s.fails.push((method, path) =>
			method === 'PUT' && path.endsWith('/parts/2') && drop-- > 0
				? new CaseApiError(0, 'network')
				: null
		);
		const waits: number[] = [];
		const { up, state } = engine(s, { second: async () => void waits.push(1) });
		up.addFiles([file('a.jpg', 10)]);
		up.start();
		await settle(80);
		expect(state().active[0]).toMatchObject({ state: 'done', sent: 10, retryIn: null });
		expect(s.calls.filter((c) => c.method === 'PUT').map((c) => c.path.split('/').pop())).toEqual([
			'1',
			'2',
			'2',
			'2',
			'3'
		]);
		expect(waits.length).toBe(2 + 4); // паузы 2 и 4 секунды
	});

	it('сервер отвечает 5xx: после пяти повторов — «не загрузился» с фразой сервера, «Продолжить» досылает остаток', async () => {
		const s = server();
		let broken = true;
		s.fails.push((method, path) =>
			broken && method === 'PUT' && path.endsWith('/parts/2')
				? new CaseApiError(500, 'other', 'внутренняя ошибка — повторите позже')
				: null
		);
		const { up, state } = engine(s);
		up.addFiles([file('a.jpg', 10)]);
		up.start();
		await settle(200);
		expect(state().active[0]).toMatchObject({
			state: 'failed',
			sent: 4,
			error: 'внутренняя ошибка — повторите позже',
			assembleFailed: false
		});
		expect(s.calls.filter((c) => c.method === 'PUT' && c.path.endsWith('/parts/2'))).toHaveLength(
			6
		);
		broken = false;
		up.togglePause(state().active[0].key);
		await settle(60);
		expect(state().active[0]).toMatchObject({ state: 'done', sent: 10 });
		expect(s.calls.filter((c) => c.method === 'PUT' && c.path.endsWith('/parts/1'))).toHaveLength(
			1
		);
	});

	it('сервер не собрал файл: дальше только «Отменить»; отказ 409 — без повторов', async () => {
		const s = server();
		s.fails.push((method, path) =>
			method === 'POST' && path.endsWith('/complete')
				? new CaseApiError(500, 'other', 'сбой хранилища')
				: null
		);
		const { up, state } = engine(s);
		up.addFiles([file('a.jpg', 3)]);
		up.start();
		await settle(200);
		expect(state().active[0]).toMatchObject({ state: 'failed', assembleFailed: true });
		up.togglePause(state().active[0].key); // «Продолжить» не действует
		await settle();
		expect(state().active[0].state).toBe('failed');

		const s2 = server();
		s2.fails.push((method, path) =>
			method === 'POST' && path.endsWith('/uploads')
				? new CaseApiError(409, 'conflict', 'этот файл уже в деле или ещё добавляется')
				: null
		);
		const second = engine(s2);
		second.up.addFiles([file('a.jpg', 3)]);
		second.up.start();
		await settle();
		expect(second.state().active[0]).toMatchObject({
			state: 'failed',
			error: 'этот файл уже в деле или ещё добавляется'
		});
		expect(s2.calls).toHaveLength(1);
	});

	it('пауза останавливает перед следующей частью, «Продолжить» идёт с того же места; «Отменить» удаляет загрузку на сервере', async () => {
		const s = server();
		const { up, state, changes } = engine(s);
		const original = s.api.request;
		(s.api as { request: CaseApi['request'] }).request = (async (
			method: string,
			path: string,
			body?: unknown
		) => {
			const out = await original(method, path, body);
			if (method === 'PUT' && path.endsWith('/parts/1')) up.togglePause(get(up).active[0].key);
			return out;
		}) as CaseApi['request'];
		up.addFiles([file('a.jpg', 10)]);
		up.start();
		await settle();
		expect(state().active[0]).toMatchObject({ state: 'paused', sent: 4 });
		expect(up.running()).toBe(false);
		up.togglePause(state().active[0].key);
		await settle(60);
		expect(state().active[0]).toMatchObject({ state: 'done', sent: 10 });
		expect(s.calls.filter((c) => c.method === 'PUT').map((c) => c.path.split('/').pop())).toEqual([
			'1',
			'2',
			'3'
		]);

		up.addFiles([file('b.jpg', 10)]);
		up.start();
		await settle();
		const done = state().active.find((a) => a.name === 'b.jpg')!;
		up.cancel(done.key); // законченную отмена на сервере не трогает
		expect(s.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
		expect(state().active.map((a) => a.name)).toEqual(['a.jpg']);
		expect(changes.length).toBe(2);
	});

	it('продолжение после закрытия страницы: тот же файл находит свою загрузку и досылает недостающее', async () => {
		const s = server();
		const store = memory();
		const first = engine(s, { storage: store });
		const original = s.api.request;
		(s.api as { request: CaseApi['request'] }).request = (async (
			method: string,
			path: string,
			body?: unknown
		) => {
			const out = await original(method, path, body);
			if (method === 'PUT' && path.endsWith('/parts/2')) first.up.destroy(); // страницу закрыли на середине
			return out;
		}) as CaseApi['request'];
		const f = file('tom.pdf', 10);
		first.up.addFiles([f]);
		first.up.setKind(get(first.up).pending[0].id, 'volume');
		first.up.start();
		await settle();
		expect([...s.uploads.get('u-1')!.parts.keys()]).toEqual([1, 2]);
		expect(JSON.parse(store.data['case-up:f 1'])).toEqual({ [fileKey(f)]: 'u-1' }); // тот же ключ и вид, что у прежней страницы
		(s.api as { request: CaseApi['request'] }).request = original;

		// новая страница: сервер знает незавершённую загрузку, хранилище — какой это файл
		const unfinished = () => [{ ...s.view('u-1'), status: 'receiving' } as Upload];
		const again = engine(s, { storage: store, serverUploads: unfinished });
		expect(again.up.addFiles([file('tom.pdf', 10)])).toEqual([]);
		expect(get(again.up).pending).toEqual([]); // вопросов «что это» нет: загрузка уже начата
		await settle(60);
		expect(get(again.up).active[0]).toMatchObject({ state: 'done', id: 'u-1', sent: 10 });
		const after = s.calls.slice(s.calls.findIndex((c) => c.method === 'GET'));
		expect(after.map((c) => `${c.method} ${c.path.split('uploads')[1]}`)).toEqual([
			'GET /u-1',
			'PUT /u-1/parts/3',
			'POST /u-1/complete'
		]);
		expect(JSON.parse(store.data['case-up:f 1'])).toEqual({});

		// без записи в хранилище (начато на другом адресе) — по имени и размеру
		const s3 = server();
		await s3.api.post('api/cases/f%201/uploads', { filename: 'other.pdf', size: 6 });
		const third = engine(s3, {
			serverUploads: () => [{ ...s3.view('u-1'), status: 'receiving' } as Upload]
		});
		third.up.addFiles([file('other.pdf', 6)]);
		await settle(60);
		expect(get(third.up).active[0]).toMatchObject({ state: 'done', id: 'u-1' });
		expect(third.up.isActive('u-1')).toBe(true);
	});

	it('файл собран, а задачи приёма нет — «завершить» повторяется один раз; чужую незавершённую можно отменить', async () => {
		const s = server();
		await s.api.post('api/cases/f%201/uploads', { filename: 'a.pdf', size: 1 });
		const { up, changes } = engine(s);
		const stuck = [
			{ id: 'u-1', phase: 'received', intake: 'none' } as Upload,
			{ id: 'u-9', phase: 'intake', intake: 'leased' } as Upload
		];
		up.nudge(stuck);
		up.nudge(stuck);
		await settle();
		expect(s.calls.filter((c) => c.path.endsWith('/complete'))).toHaveLength(1);
		await up.cancelServer('u-1');
		expect(s.uploads.get('u-1')!.deleted).toBe(true);
		expect(changes.length).toBe(1);
	});
});
