/* ai-dvokat: «Мои дела» — разбор ответа `GET api/cases` и всё, что страница считает сама: счётчики, плитки, отбор
   («Все / Мои / Общие», раздел из чата, поиск), порядок, дерево разделов. Без DOM и запросов — проверяется vitest
   (`mycases.test.ts`). Ничего не выдумывает: число страниц, ход обработки и «Проверьте листы» ручка не отдаёт. */

export type CaseFolder = {
	id: string;
	/** Название папки из чата; пусто — страница пишет «Без названия». */
	title: string;
	/** Имена родительских папок через « / » — как отдаёт сервис. */
	path: string;
	write: boolean;
	owner: boolean;
	shared: boolean;
	/** `work` — вид дела от сервиса (Н-1: то же правило, что у «Обзора» и листа); `busy` — признак прежнего сервиса
	 *  «идёт обработка» (новый сервис отдаёт его только при `work.kind === 'runs'`); прежний сервис может не отдать
	 *  ни того, ни другого. */
	case: {
		id: string;
		volumes: number;
		changed: string | null;
		busy?: boolean;
		work?: CaseWork;
	} | null;
};
/** Вид дела от сервиса (`work.view`). */
export type CaseWork = {
	kind: 'runs' | 'paused' | 'stalled' | 'waiting' | 'ready';
	reason: string | null;
	since?: string | null;
	reasons: string[];
	sweeps: number;
	/** проходов, которые стоят: обработчик заданий не отвечает */
	sweeps_stalled?: number;
};
const KINDS = new Set(['runs', 'paused', 'stalled', 'waiting', 'ready']);
function readWork(raw: unknown): CaseWork | null {
	const w = (raw ?? null) as Record<string, unknown> | null;
	if (!w || typeof w !== 'object' || !KINDS.has(String(w.kind))) return null;
	return {
		kind: w.kind as CaseWork['kind'],
		reason: typeof w.reason === 'string' ? w.reason : null,
		since: typeof w.since === 'string' ? w.since : null,
		reasons: Array.isArray(w.reasons) ? w.reasons.filter((x): x is string => typeof x === 'string') : [],
		sweeps: Number.isFinite(Number(w.sweeps)) ? Math.max(0, Number(w.sweeps)) : 0,
		sweeps_stalled: Number.isFinite(Number(w.sweeps_stalled)) ? Math.max(0, Number(w.sweeps_stalled)) : 0
	};
}
/** Отметка дела в списке: ключ строки, тон, значок и причина (подсказка) — словами строк сервиса. */
export type CaseMark = { key: string; tone: 'i' | 'w' | 's'; icon: 'clock' | 'pause' | 'al'; why?: string };
const MARK: Record<string, Omit<CaseMark, 'why'>> = {
	runs: { key: 'my_cases_busy', tone: 'i', icon: 'clock' },
	paused: { key: 'my_cases_paused', tone: 'w', icon: 'pause' },
	stalled: { key: 'my_cases_stalled', tone: 'w', icon: 'al' },
	waiting: { key: 'my_cases_waiting', tone: 'w', icon: 'pause' }
};
/** Отметки дела (Н-1): обработка — идёт / на паузе (причина) / не отвечает / ждёт (причина); проход — отдельно,
 *  «идёт проход» (данные дела при этом готовы). Прежний сервис без вида — «идёт обработка» по `busy`. Причины —
 *  функцией `why(kind, work)` страницы: ей нужны слова причин паузы и ожидания. */
export function caseMarks(
	f: CaseFolder,
	S: Record<string, any>,
	why: (w: CaseWork) => string = () => ''
): CaseMark[] {
	const c = f.case;
	if (!c) return [];
	const w = c.work;
	if (!w) return c.busy && S.my_cases_busy ? [{ ...MARK.runs }] : [];
	const out: CaseMark[] = [];
	const m = MARK[w.kind];
	if (m && S[m.key]) out.push(w.kind === 'runs' ? { ...m } : { ...m, why: why(w) || undefined });
	if (w.sweeps > 0 && S.my_cases_sweeps) out.push({ key: 'my_cases_sweeps', tone: 'i', icon: 'clock' });
	// проход стоит: его задание ждёт в очереди, а обработчик заданий не отвечает — «не отвечает», не «идёт проход»
	if ((w.sweeps_stalled ?? 0) > 0 && w.kind !== 'stalled' && S.my_cases_stalled) {
		out.push({
			...MARK.stalled,
			why: S.work_jobs_stalled
				? String(S.work_jobs_stalled).replace('{n}', String(w.sweeps_stalled))
				: undefined
		});
	}
	return out;
}
/** Раз во сколько мс «Мои дела», пока вкладка видна, тихо перечитывают список (`GET /api/cases`, вид дела — в нём):
 *  открытые заранее видят, что дело занялось, и что работа кончилась. Скрытая вкладка не спрашивает, вернувшаяся —
 *  сразу. Отдельной лёгкой ручки списка нет: права на папки всё равно проверяет тот же `list_folders`, и по цене
 *  она почти не отличалась бы (Д-8, Д-9 живой проверки 23.11, решение координатора). */
export const LIST_EVERY_MS = 10000;

/** Папка из дерева чата (`/api/v1/folders/` и `/api/v1/folders/shared`): нужна только связь с родителем. */
export type FolderNode = { id?: unknown; parent_id?: unknown };

export type Scope = 'all' | 'own' | 'shared';
export type Order = 'recent' | 'name';
export type Access = 'own' | 'shared' | 'readonly';

export type Section = {
	id: string;
	title: string;
	/** Полный путь для списка на телефоне: «Арбитраж / 2025». */
	label: string;
	depth: number;
	children: Section[];
};

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Ответ ручки → плоский список: сначала свои папки, затем общие (порядок сервиса сохраняется). */
export function readListing(raw: unknown): CaseFolder[] {
	const data = (raw ?? {}) as { own?: unknown; shared?: unknown };
	const out: CaseFolder[] = [];
	const seen = new Set<string>();
	for (const [list, shared] of [
		[data.own, false],
		[data.shared, true]
	] as const) {
		if (!Array.isArray(list)) continue;
		for (const item of list) {
			const f = (item ?? {}) as Record<string, unknown>;
			const id = text(f.folder_id);
			if (!id || seen.has(id)) continue;
			seen.add(id);
			const c = f.case as Record<string, unknown> | null | undefined;
			out.push({
				id,
				title: text(f.title).trim(),
				path: text(f.path).trim(),
				write: f.write === true,
				owner: f.owner === true,
				shared: f.shared === true || shared,
				case:
					c && typeof c === 'object'
						? {
								id: text(c.id),
								volumes: Number.isFinite(Number(c.volumes)) ? Math.max(0, Number(c.volumes)) : 0,
								changed: text(c.changed) || null,
								...(c.busy === true ? { busy: true } : {}),
								...(readWork(c.work) ? { work: readWork(c.work)! } : {})
							}
						: null
			});
		}
	}
	return out;
}

export const access = (f: CaseFolder): Access =>
	!f.shared ? 'own' : f.write ? 'shared' : 'readonly';

/** Родитель каждой папки списка — только если он сам есть в списке (иначе папка считается верхней). */
export function parentMap(folders: CaseFolder[], nodes: FolderNode[] | null): Map<string, string> {
	const known = new Set(folders.map((f) => f.id));
	const parents = new Map<string, string>();
	for (const node of nodes ?? []) {
		const id = text(node?.id);
		const parent = text(node?.parent_id);
		if (id && parent && id !== parent && known.has(id) && known.has(parent))
			parents.set(id, parent);
	}
	return parents;
}

/** Разделы — папки, внутри которых есть другие папки. Дерево повторяет вложенность папок чата. */
export function buildSections(
	folders: CaseFolder[],
	parents: Map<string, string>,
	untitled = ''
): Section[] {
	const hasChild = new Set(parents.values());
	const byId = new Map<string, Section>();
	for (const f of folders) {
		if (hasChild.has(f.id))
			byId.set(f.id, { id: f.id, title: f.title || untitled, label: '', depth: 0, children: [] });
	}
	const roots: Section[] = [];
	for (const f of folders) {
		const section = byId.get(f.id);
		if (!section) continue;
		const parent = byId.get(parents.get(f.id) ?? '');
		if (parent && !isAncestor(f.id, parent.id, parents)) parent.children.push(section);
		else roots.push(section);
	}
	const walk = (list: Section[], depth: number, prefix: string) => {
		for (const s of list) {
			s.depth = depth;
			s.label = prefix ? `${prefix} / ${s.title}` : s.title;
			walk(s.children, depth + 1, s.label);
		}
	};
	walk(roots, 0, '');
	return roots;
}

/** Разделы одним списком сверху вниз (для выбора на телефоне). */
export function flatSections(sections: Section[]): Section[] {
	return sections.flatMap((s) => [s, ...flatSections(s.children)]);
}

/** `ancestor` стоит выше `id` по цепочке родителей (петля в данных не зацикливает). */
export function isAncestor(ancestor: string, id: string, parents: Map<string, string>): boolean {
	const seen = new Set<string>([id]);
	let current = parents.get(id);
	while (current && !seen.has(current)) {
		if (current === ancestor) return true;
		seen.add(current);
		current = parents.get(current);
	}
	return false;
}

const fold = (value: string) => value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').trim();

export type Filter = { scope: Scope; section: string | null; query: string };

/** Отбор действует на оба списка: «Все / Мои / Общие», раздел (всё, что внутри него на любой глубине), поиск. */
export function applyFilter(
	folders: CaseFolder[],
	filter: Filter,
	parents: Map<string, string>
): CaseFolder[] {
	const query = fold(filter.query);
	return folders.filter((f) => {
		if (filter.scope === 'own' && f.shared) return false;
		if (filter.scope === 'shared' && !f.shared) return false;
		// сама папка-раздел входит в свой отбор: у неё может быть своё дело (ревью 20.11 — она пропадала из списка)
		if (filter.section && f.id !== filter.section && !isAncestor(filter.section, f.id, parents))
			return false;
		if (query && !fold(f.title).includes(query)) return false;
		return true;
	});
}

const collator = new Intl.Collator('ru-RU', { numeric: true, sensitivity: 'base' });

/** Порядок относится к «Делам»: недавние — по дате изменения дела, по названию — как в словаре, числа по величине. */
export function sortCases(cases: CaseFolder[], order: Order): CaseFolder[] {
	const byName = (a: CaseFolder, b: CaseFolder) => collator.compare(a.title, b.title);
	const stamp = (f: CaseFolder) => {
		const t = f.case?.changed ? Date.parse(f.case.changed) : NaN;
		return Number.isFinite(t) ? t : -Infinity;
	};
	return [...cases].sort(order === 'name' ? byName : (a, b) => stamp(b) - stamp(a) || byName(a, b));
}

export type Totals = {
	cases: number;
	casesOwn: number;
	casesShared: number;
	volumes: number;
	casesWithVolumes: number;
	foldersWithoutCase: number;
	foldersCanCreate: number;
};

/** Общий итог по всем папкам — его показывают плитки и счётчики меню, отбор на него не влияет. */
export function totals(folders: CaseFolder[]): Totals {
	const t: Totals = {
		cases: 0,
		casesOwn: 0,
		casesShared: 0,
		volumes: 0,
		casesWithVolumes: 0,
		foldersWithoutCase: 0,
		foldersCanCreate: 0
	};
	for (const f of folders) {
		if (f.case) {
			t.cases += 1;
			if (f.shared) t.casesShared += 1;
			else t.casesOwn += 1;
			t.volumes += f.case.volumes;
			if (f.case.volumes > 0) t.casesWithVolumes += 1;
		} else {
			t.foldersWithoutCase += 1;
			if (f.write) t.foldersCanCreate += 1;
		}
	}
	return t;
}

/** Дата «14.11.2025», как на прежней странице; не дата — пусто. */
export function day(iso: string | null | undefined): string {
	if (!iso) return '';
	const d = new Date(iso);
	return Number.isNaN(d.getTime())
		? ''
		: d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
