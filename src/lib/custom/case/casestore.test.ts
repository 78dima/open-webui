/* ai-dvokat: проверки casestore (§ 4.1: И-1, И-2, И-4) — обновление обзора после записей, сведение частых записей,
   отказ параметром refresh: false, общий загрузчик «Файлов папки» с ошибкой и перечитыванием по смене загрузок. */
import { get } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import { CaseApiError, type CaseApi } from './api';
import { createCaseState } from './casestore';

function stubApi(handlers: {
	get: (path: string) => Promise<unknown>;
	write?: (method: string, path: string, body?: unknown) => Promise<unknown>;
}): CaseApi {
	return {
		base: '/legal-tools',
		url: (p) => `/legal-tools/${p}`,
		download: async () => ({ blob: new Blob(), name: '' }),
		get: (p) => handlers.get(p) as Promise<any>,
		request: (m, p, b) =>
			(m.toUpperCase() === 'GET' ? handlers.get(p) : (handlers.write?.(m, p, b) ?? Promise.resolve({}))) as Promise<any>,
		post: (p, b) => (handlers.write?.('POST', p, b) ?? Promise.resolve({})) as Promise<any>
	};
}

const BOOT = {
	folder_id: 'f1',
	title: 'Дело',
	has_case: true,
	can_write: true,
	is_owner: true,
	user_id: 'u1',
	sections: ['volumes', 'passport', 'deadlines', 'tables'],
	part_size: 1024,
	max_file_mb: 100,
	case_id: 'c1'
};

describe('casestore § 4.1', () => {
	it('удачная запись сразу обновляет обзор, частые записи в окне сводятся в один запрос, refresh:false пропускается', async () => {
		vi.useFakeTimers();
		let overviewCalls = 0;
		const api = stubApi({
			get: async (p) => {
				if (p.endsWith('/boot')) return BOOT;
				if (p.endsWith('/folder-files')) return { files: [] };
				overviewCalls++;
				return { overview: {}, uploads: [], counts: { amounts: overviewCalls } };
			}
		});
		const st = createCaseState(api, 'f1', { coalesceMs: 300 });
		await st.start();
		expect(overviewCalls).toBe(1);

		// опция refresh: false (части загрузки, отметки ячеек, удаление дела) обзор не дёргает
		await st.api.request('PUT', 'api/cases/f1/uploads/u1/parts/1', new Blob(['a']), { refresh: false });
		await st.api.request('PUT', 'api/cases/f1/tables/t1/checks', { checked: true }, { refresh: false });
		await vi.advanceTimersByTimeAsync(500);
		expect(overviewCalls).toBe(1);

		// первая запись обновляет обзор сразу; три записи подряд внутри окна 300 мс сводятся в один повтор
		await st.api.request('PATCH', 'api/cases/f1/amounts/1', { hidden: true });
		await vi.advanceTimersByTimeAsync(10);
		expect(overviewCalls).toBe(2);
		await st.api.request('PATCH', 'api/cases/f1/amounts/2', { hidden: true });
		await st.api.request('PATCH', 'api/cases/f1/amounts/3', { hidden: true });
		expect(overviewCalls).toBe(2);
		await vi.advanceTimersByTimeAsync(310);
		expect(overviewCalls).toBe(3);

		st.stop();
		vi.useRealTimers();
	});

	it('И-1: смена набора идущих загрузок в обзоре перечитывает folder-files без перезагрузки страницы', async () => {
		let folderStep = 0;
		let overviewStep = 0;
		const api = stubApi({
			get: async (p) => {
				if (p.endsWith('/boot')) return BOOT;
				if (p.endsWith('/folder-files')) {
					folderStep++;
					return folderStep === 1
						? { files: [{ id: 'ff1', name: 'a.pdf', readable: true, adding: true, kind: 'pdf' }] }
						: { files: [] };
				}
				overviewStep++;
				return {
					overview: {},
					uploads:
						overviewStep === 1
							? [{ id: 'up1', filename: 'a.pdf', size: 10, received: 10, status: 'received', phase: 'intake' }]
							: []
				};
			}
		});
		const st = createCaseState(api, 'f1', { coalesceMs: 10 });
		await st.start();
		expect(get(st.folderFiles)).toBe(1);
		expect(get(st.folderFilesState).files?.[0]?.adding).toBe(true);

		// при следующем обзоре загрузка ушла из busy → folder-files перечитывается сам и обнуляется
		await st.refresh();
		await Promise.resolve();
		await Promise.resolve();
		expect(folderStep).toBe(2);
		expect(get(st.folderFiles)).toBe(0);
		expect(get(st.folderFilesState).files).toEqual([]);
		st.stop();
	});

	it('ревью № 13: если список вернул adding раньше, чем обзор пришёл уже без загрузок — следующий обзор всё равно перечитает список', async () => {
		let folderStep = 0;
		const api = stubApi({
			get: async (p) => {
				if (p.endsWith('/boot')) return BOOT;
				if (p.endsWith('/folder-files')) {
					folderStep++;
					return folderStep === 1
						? { files: [{ id: 'ff1', name: 'a.pdf', readable: true, adding: true, kind: 'pdf' }] }
						: { files: [] };
				}
				// обзор уже без идущих загрузок с самого начала (набор busy не меняется)
				return { overview: {}, uploads: [] };
			}
		});
		const st = createCaseState(api, 'f1', { coalesceMs: 10 });
		await st.start();
		expect(folderStep).toBe(1);
		expect(get(st.folderFilesState).files?.[0]?.adding).toBe(true);

		// следующий обзор тоже без загрузок (набор busy не менялся), но в списке есть adding → список перечитывается
		await st.refresh();
		await Promise.resolve();
		await Promise.resolve();
		expect(folderStep).toBe(2);
		expect(get(st.folderFiles)).toBe(0);
		expect(get(st.folderFilesState).files).toEqual([]);

		// когда adding больше нет и uploads не меняется — лишних перечитываний нет
		await st.refresh();
		await Promise.resolve();
		await Promise.resolve();
		expect(folderStep).toBe(2);
		st.stop();
	});

	it('И-4: сбой GET /folder-files сохраняет ошибку в сторе, а не прячет раздел как ноль', async () => {
		let fail = true;
		const api = stubApi({
			get: async (p) => {
				if (p.endsWith('/boot')) return BOOT;
				if (p.endsWith('/folder-files')) {
					if (fail) throw new CaseApiError(500, 'other', 'сбой');
					return { files: [{ id: 'ff1', name: 'a.pdf', readable: true, kind: 'pdf' }] };
				}
				return { overview: {}, uploads: [] };
			}
		});
		const st = createCaseState(api, 'f1');
		await st.start();
		expect(get(st.folderFilesState).error?.status).toBe(500);
		expect(get(st.folderFilesState).files).toBeNull();

		fail = false;
		await st.reloadFolderFiles();
		expect(get(st.folderFilesState).error).toBeNull();
		expect(get(st.folderFiles)).toBe(1);
		st.stop();
	});
});
