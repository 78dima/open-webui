/* ai-dvokat: загрузка материалов дела частями с продолжением — перенос поведения прежней страницы сервиса
   (`case.js`: `Core.planParts`, `planRows`, `startUpload`, `runUpload`, `withRetry`, `matchUnfinished`) без потерь:
   - файл режется на части по размеру, который назвал сервер (`part_size` загрузки), части идут по порядку;
   - одновременно передаются два файла, остальные ждут очереди;
   - нет связи, 408, 429 — повтор без счёта с растущей паузой (до 30 с); ответ сервера 5xx — не больше пяти повторов
     подряд; пауза и отмена — в любой момент;
   - страницу закрыли — юрист выбирает тот же файл, и передача продолжается с недостающих частей: соответствие
     «файл → загрузка» лежит в `localStorage` под тем же ключом и в том же виде, что у прежней страницы
     (`case-up:<папка>`), поэтому начатое на прежней странице продолжается здесь и наоборот; без записи в хранилище —
     по имени и размеру среди незавершённых загрузок сервера.
   Без DOM: запросы, хранилище и ожидание подставляются — проверяется vitest (`uploads.test.ts`). */
import { writable, type Readable } from 'svelte/store';
import type { CaseApi } from './api';
import { CaseApiError } from './api';
import type { Upload } from './casepage';

// ---- ядро без состояния (как `Core` прежней страницы) ----
export type Part = { n: number; start: number; end: number };

export function planParts(size: number, partSize: number): Part[] {
	const total = Math.max(1, Math.ceil(size / partSize));
	const out: Part[] = [];
	for (let n = 1; n <= total; n++) {
		const start = (n - 1) * partSize;
		out.push({ n, start, end: Math.min(size, start + partSize) });
	}
	return out;
}
export function missingParts(
	plan: Part[],
	received: { n: number; size: number }[] | undefined
): Part[] {
	const have = new Map((received ?? []).map((p) => [p.n, p.size]));
	return plan.filter((p) => have.get(p.n) !== p.end - p.start);
}
export const backoff = (attempt: number): number => Math.min(30, Math.pow(2, Math.min(attempt, 5)));
export const MAX_SERVER_RETRIES = 5;
export const retryable = (status: number): boolean =>
	status === 0 || status === 408 || status === 429 || status >= 500;
/** Сбой связи, 408, 429 — повтор без счёта; 5xx — не больше MAX_SERVER_RETRIES повторов подряд. */
export const retryAgain = (status: number, serverTries: number): boolean =>
	retryable(status) && (status < 500 || serverTries < MAX_SERVER_RETRIES);

export type FileKind = 'pdf' | 'zip' | 'photo';
const FORMATS: Record<string, FileKind> = {
	pdf: 'pdf',
	zip: 'zip',
	jpg: 'photo',
	jpeg: 'photo',
	png: 'photo',
	heic: 'photo',
	heif: 'photo'
};
export const ACCEPT = '.pdf,.zip,.jpg,.jpeg,.png,.heic,.heif';
export function classify(name: string): FileKind | null {
	const m = /\.([A-Za-z0-9]{1,5})$/.exec(name || '');
	return m ? (FORMATS[m[1].toLowerCase()] ?? null) : null;
}
type AnyFile = File & { webkitRelativePath?: string };
export const filePath = (f: AnyFile): string => f.webkitRelativePath || f.name || '';
/** Ключ файла в хранилище — тот же, что у прежней страницы: имя, размер, время изменения. */
export const fileKey = (f: File): string => [f.name, f.size, f.lastModified || 0].join('|');
export const dirName = (f: AnyFile | undefined): string => {
	const p = f?.webkitRelativePath || '';
	return p.indexOf('/') > 0 ? p.split('/')[0] : '';
};

export type InputKind = 'volume' | 'e_case' | 'photo';
export type PendingRow = {
	id: string;
	files: File[];
	kind: FileKind;
	inputKind: InputKind | null;
	/** Связь «файлы одного каталога» (case_upload.batch_id). */
	batch: string | null;
	/** Каталог, из которого выбран файл: «вид для всех PDF папки». */
	group: string | null;
	/** Номер тома с обложки. */
	label: string;
	/** Продолжение тома: id тома или пусто. */
	cont: string;
};

/** Выбранные файлы → строки к загрузке: PDF и ZIP — по строке (у каждого свой том), снимки — одной серией. Всё из
    одного выбора каталога — один batch и порядок по пути внутри каталога. */
export function planRows(
	files: File[],
	makeId: () => string | null
): Omit<PendingRow, 'id' | 'label' | 'cont'>[] {
	const list = [...files] as AnyFile[];
	const dir = list.some((f) => !!f.webkitRelativePath);
	if (dir)
		list.sort((a, b) => (filePath(a) < filePath(b) ? -1 : filePath(a) > filePath(b) ? 1 : 0));
	const batch = dir ? makeId() : null;
	const rows: Omit<PendingRow, 'id' | 'label' | 'cont'>[] = [];
	const photos: File[] = [];
	for (const f of list) {
		const kind = classify(f.name);
		if (!kind) continue;
		if (kind === 'photo') photos.push(f);
		else rows.push({ files: [f], kind, inputKind: null, batch, group: batch });
	}
	if (photos.length) {
		rows.push({
			files: photos,
			kind: 'photo',
			inputKind: 'photo',
			group: batch,
			batch: batch || (photos.length > 1 ? makeId() : null)
		});
	}
	return rows;
}

/** Этап приёма на сервере → ключ строки (как `Core.UPLOAD_TEXT`); в новой редакции — ключи `_g`. */
export const SERVER_TEXT: Record<string, string> = {
	failed: 'upload_status_failed_g',
	intake_failed: 'upload_status_intake_failed',
	intake: 'upload_status_intake',
	received: 'upload_status_received',
	done_nofile: 'upload_status_done_nofile_g'
};
export const serverTextKey = (phase: string): string =>
	SERVER_TEXT[phase] ?? 'upload_status_received';
export const serverFailed = (phase: string): boolean =>
	phase === 'failed' || phase === 'intake_failed';

// ---- движок ----
export type ActiveState = 'queued' | 'running' | 'paused' | 'failed' | 'done';
export type ActiveUpload = {
	key: number;
	name: string;
	size: number;
	/** id загрузки на сервере (после первого ответа). */
	id: string | null;
	state: ActiveState;
	sent: number;
	/** Секунд до повтора после сбоя связи; null — не ждёт. */
	retryIn: number | null;
	/** Фраза сервера при ошибке. */
	error: string;
	/** Сервер не собрал файл и после повторов: дальше только «Отменить». */
	assembleFailed: boolean;
};
export type UploadsState = { pending: PendingRow[]; active: ActiveUpload[]; kindMissing: boolean };
export type Rejected = { name: string; why: 'format' | 'big' };

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
type Options = {
	api: CaseApi;
	folderId: string;
	maxFileMb: () => number;
	/** Незавершённые и идущие загрузки этого юриста по ответу обзора. */
	serverUploads: () => Upload[];
	/** Загрузка закончилась или отменена — пора переспросить обзор. */
	onChange?: () => void;
	storage?: Storage | null;
	/** Ожидание одной секунды (подставляется в проверках). */
	second?: () => Promise<void>;
	makeId?: () => string | null;
	maxRunning?: number;
};
type Opts = {
	resumeId?: string | null;
	inputKind?: InputKind | null;
	volumeHint?: string | null;
	continuesVolumeId?: number | null;
	batchId?: string | null;
	memberPath?: string | null;
};
type Job = ActiveUpload & {
	file: File;
	opts: Opts;
	attempt: number;
	serverTries: number;
	stage: 'complete' | null;
	aborted: boolean;
};

class Halt extends Error {} // пауза или отмена посреди ожидания — не ошибка загрузки

export type Uploads = Readable<UploadsState> & {
	/** Выбранные или перетащенные файлы: непринятые возвращаются, продолжаемые стартуют сразу, остальные — в «К загрузке». */
	addFiles: (files: File[]) => Rejected[];
	setKind: (rowId: string, kind: InputKind) => void;
	setGroupKind: (group: string, kind: InputKind) => void;
	setLabel: (rowId: string, label: string) => void;
	setCont: (rowId: string, cont: string) => void;
	removeRow: (rowId: string) => void;
	/** «Загрузить»: false — у какого-то PDF не указано, что это. */
	start: () => boolean;
	togglePause: (key: number) => void;
	cancel: (key: number) => void;
	/** Отменить незавершённую загрузку, которую эта страница не ведёт. */
	cancelServer: (id: string) => Promise<void>;
	/** Файл собран, а задачи приёма нет — повторить «завершить» (идемпотентно, один раз на загрузку). */
	nudge: (uploads: Upload[]) => void;
	isActive: (id: string) => boolean;
	running: () => boolean;
	destroy: () => void;
};

export function createUploads(options: Options): Uploads {
	const { api, folderId } = options;
	const storage: Storage | null =
		options.storage !== undefined
			? options.storage
			: typeof localStorage !== 'undefined'
				? localStorage
				: null;
	const second = options.second ?? (() => new Promise<void>((r) => setTimeout(r, 1000)));
	const makeId =
		options.makeId ??
		(() => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : null));
	const maxRunning = options.maxRunning ?? 2;
	const path = (rest = '') => `api/cases/${encodeURIComponent(folderId)}/uploads${rest}`;
	const localKey = `case-up:${folderId}`;

	let local: Record<string, string> = {};
	try {
		local = JSON.parse(storage?.getItem(localKey) || '{}') || {};
	} catch {
		local = {};
	}
	const saveLocal = () => {
		try {
			storage?.setItem(localKey, JSON.stringify(local));
		} catch {
			/* режим без хранения */
		}
	};

	let pending: PendingRow[] = [];
	let jobs: Job[] = [];
	let kindMissing = false;
	let queue: Job[] = [];
	let runningCount = 0;
	let nextKey = 1;
	let destroyed = false;
	const retried = new Set<string>();

	const store = writable<UploadsState>({ pending: [], active: [], kindMissing: false });
	const emit = () =>
		store.set({
			pending: [...pending],
			active: jobs.map((j) => ({
				key: j.key,
				name: j.name,
				size: j.size,
				id: j.id,
				state: j.state,
				sent: j.sent,
				retryIn: j.retryIn,
				error: j.error,
				assembleFailed: j.assembleFailed
			})),
			kindMissing
		});

	const isActive = (id: string) => jobs.some((j) => j.id === id);

	function matchUnfinished(file: File): Upload | null {
		const server = options.serverUploads().filter((u) => u.status === 'receiving');
		const known = local[fileKey(file)];
		const byLocal = known ? server.find((u) => u.id === known) : undefined;
		if (byLocal) return byLocal;
		return (
			server.find((u) => u.filename === file.name && u.size === file.size && !isActive(u.id)) ??
			null
		);
	}

	function addFiles(files: File[]): Rejected[] {
		const rejected: Rejected[] = [];
		const fresh: File[] = [];
		for (const file of files) {
			if (!classify(file.name)) {
				rejected.push({ name: file.name, why: 'format' });
				continue;
			}
			if (file.size > options.maxFileMb() * 1048576) {
				rejected.push({ name: file.name, why: 'big' });
				continue;
			}
			const resume = matchUnfinished(file);
			if (resume) startUpload(file, { resumeId: resume.id });
			else fresh.push(file);
		}
		for (const row of planRows(fresh, makeId)) {
			pending.push({ ...row, id: `r${nextKey++}`, label: '', cont: '' });
		}
		emit();
		return rejected;
	}

	const row = (id: string) => pending.find((r) => r.id === id);
	const edit = (id: string, change: (r: PendingRow) => void) => {
		const r = row(id);
		if (!r) return;
		change(r);
		if (pending.every((x) => x.kind === 'photo' || x.inputKind)) kindMissing = false;
		emit();
	};

	function start(): boolean {
		if (pending.some((r) => r.kind !== 'photo' && !r.inputKind)) {
			kindMissing = true;
			emit();
			return false;
		}
		const rows = pending;
		pending = [];
		kindMissing = false;
		for (const r of rows) {
			const label = r.label.trim() || null;
			const cont = r.cont ? Number(r.cont) : null;
			for (const file of r.files) {
				startUpload(file, {
					inputKind: r.inputKind,
					volumeHint: label,
					continuesVolumeId: label ? null : cont, // заполнен номер тома — продолжение не учитывается
					batchId: r.batch,
					memberPath: (file as AnyFile).webkitRelativePath || null
				});
			}
		}
		emit();
		return true;
	}

	function startUpload(file: File, opts: Opts): Job {
		const job: Job = {
			key: nextKey++,
			name: filePath(file as AnyFile),
			size: file.size,
			id: opts.resumeId ?? null,
			state: 'queued',
			sent: 0,
			retryIn: null,
			error: '',
			assembleFailed: false,
			file,
			opts,
			attempt: 0,
			serverTries: 0,
			stage: null,
			aborted: false
		};
		jobs.push(job);
		queue.push(job);
		pump();
		return job;
	}

	function pump() {
		while (runningCount < maxRunning && queue.length) {
			const job = queue.shift()!;
			if (job.state !== 'queued' || job.aborted) continue;
			runningCount++;
			const done = () => {
				runningCount--;
				pump();
			};
			run(job).then(done, done);
		}
		emit();
	}

	async function wait(seconds: number, job: Job): Promise<void> {
		let left = seconds;
		job.retryIn = left;
		emit();
		while (left > 0) {
			await second();
			left--;
			if (job.state !== 'running' || job.aborted || destroyed) break;
			job.retryIn = left;
			emit();
		}
		job.retryIn = null;
		emit();
	}

	async function withRetry<T>(job: Job, fn: () => Promise<T>): Promise<T> {
		for (;;) {
			try {
				return await fn();
			} catch (error) {
				const status = error instanceof CaseApiError ? error.status : -1;
				if (
					job.state !== 'running' ||
					job.aborted ||
					!(error instanceof CaseApiError) ||
					!retryAgain(status, job.serverTries)
				)
					throw error;
				if (status >= 500) job.serverTries++;
				job.attempt++;
				await wait(backoff(job.attempt), job);
				if (job.state !== 'running' || job.aborted) throw new Halt();
			}
		}
	}

	async function run(job: Job): Promise<void> {
		job.state = 'running';
		job.error = '';
		emit();
		const { file, opts } = job;
		try {
			const info = job.id
				? await withRetry(job, () => api.get<Upload>(path(`/${job.id}`)))
				: (
						await withRetry(job, () =>
							api.post<{ upload: Upload }>(path(), {
								filename: file.name,
								size: file.size,
								input_kind: opts.inputKind ?? null,
								volume_hint: opts.volumeHint ?? null,
								continues_volume_id: opts.continuesVolumeId ?? null,
								batch_id: opts.batchId ?? null,
								member_path: opts.memberPath ?? null
							})
						)
					).upload;
			job.id = info.id;
			local[fileKey(file)] = info.id;
			saveLocal();
			const todo = missingParts(planParts(file.size, info.part_size || file.size || 1), info.parts);
			job.sent = file.size - todo.reduce((a, p) => a + (p.end - p.start), 0);
			emit();
			for (const p of todo) {
				if (job.state !== 'running' || job.aborted) throw new Halt();
				await withRetry(job, () =>
					api.request('PUT', path(`/${job.id}/parts/${p.n}`), file.slice(p.start, p.end))
				);
				job.attempt = 0;
				job.serverTries = 0;
				job.sent += p.end - p.start;
				emit();
			}
			job.stage = 'complete';
			await withRetry(job, () => api.post(path(`/${job.id}/complete`)));
			job.state = 'done';
			job.sent = file.size;
			delete local[fileKey(file)];
			saveLocal();
			emit();
			options.onChange?.();
		} catch (error) {
			if (job.aborted || (job.state as ActiveState) === 'paused' || error instanceof Halt) return;
			const e = error as CaseApiError;
			// сервер не собрал файл и после повторов: дальше не повторяем — «отменить и выбрать файл снова»
			job.assembleFailed =
				job.stage === 'complete' &&
				e instanceof CaseApiError &&
				e.status >= 500 &&
				e.status !== 503;
			job.stage = null;
			job.serverTries = 0;
			job.state = 'failed';
			job.error = e?.message ?? '';
			emit();
		}
	}

	function togglePause(key: number) {
		const job = jobs.find((j) => j.key === key);
		if (!job) return;
		if (job.state === 'running') {
			job.state = 'paused';
			job.retryIn = null;
			emit();
		} else if ((job.state === 'paused' || job.state === 'failed') && !job.assembleFailed) {
			job.state = 'queued';
			job.error = '';
			job.opts.resumeId = job.id;
			queue.push(job);
			pump();
		}
	}

	function cancel(key: number) {
		const job = jobs.find((j) => j.key === key);
		if (!job) return;
		const prev = job.state;
		job.aborted = true;
		jobs = jobs.filter((j) => j !== job);
		delete local[fileKey(job.file)];
		saveLocal();
		emit();
		if (job.id && prev !== 'done') {
			api.request('DELETE', path(`/${job.id}`)).then(
				() => options.onChange?.(),
				() => undefined // брошенную загрузку отменит сервер
			);
		}
	}

	async function cancelServer(id: string): Promise<void> {
		await api.request('DELETE', path(`/${id}`));
		options.onChange?.();
	}

	function nudge(uploads: Upload[]) {
		for (const u of uploads) {
			if (
				u.phase !== 'received' ||
				(u.intake && u.intake !== 'none') ||
				retried.has(u.id) ||
				isActive(u.id)
			)
				continue;
			retried.add(u.id);
			api.post(path(`/${u.id}/complete`)).catch(() => retried.delete(u.id));
		}
	}

	return {
		subscribe: store.subscribe,
		addFiles,
		setKind: (id, kind) => edit(id, (r) => (r.inputKind = kind)),
		setGroupKind(group, kind) {
			for (const r of pending) if (r.group === group && r.kind !== 'photo') r.inputKind = kind;
			if (pending.every((x) => x.kind === 'photo' || x.inputKind)) kindMissing = false;
			emit();
		},
		setLabel: (id, label) => edit(id, (r) => (r.label = label)),
		setCont: (id, cont) => edit(id, (r) => (r.cont = cont)),
		removeRow(id) {
			pending = pending.filter((r) => r.id !== id);
			if (pending.every((x) => x.kind === 'photo' || x.inputKind)) kindMissing = false;
			emit();
		},
		start,
		togglePause,
		cancel,
		cancelServer,
		nudge,
		isActive,
		running: () => jobs.some((j) => j.state === 'running' || j.state === 'queued'),
		destroy() {
			destroyed = true;
			for (const j of jobs) if (j.state === 'running' || j.state === 'queued') j.state = 'paused';
			queue = [];
		}
	};
}
