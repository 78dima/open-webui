/* ai-dvokat: страница дела (вариант «Г») — всё, что страница решает сама по данным сервиса, без DOM и запросов:
   состав меню по настройке разделов и правам, состояние сводки, слова состояния тома, группы «Проверьте листы»,
   поле «Открыть лист». Правила перенесены с прежней страницы сервиса (`case.js`: `Core`, `processing`, `renderCheck`)
   и из макетов K-*; проверяется vitest (`casepage.test.ts`). */
import { fmt } from './strings';
import { pairPlaces } from './marks';

export type Boot = {
	folder_id: string;
	title: string | null;
	has_case: boolean;
	can_write: boolean;
	is_owner: boolean;
	user_id: string;
	sections: string[];
	part_size: number;
	max_file_mb: number;
	case_id: string | null;
};

export type InputFact = {
	photo?: boolean;
	layer_all?: boolean;
	pages?: number;
	layer_pages?: number;
	image_pages?: number;
};
export type Suggest = {
	volume_id?: number | null;
	label?: string | null;
	basis?: string;
	first?: string | number | null;
	last?: string | number | null;
	candidates?: { id?: number; label: string }[];
};
export type FileFacts = {
	id?: number;
	filename?: string;
	status?: string;
	pages?: number | null;
	pages_indexed?: number | null;
	input_kind?: string;
	block_reason?: string | null;
	estimate_usd?: string | null;
	input_fact?: InputFact | null;
	suggest?: Suggest | null;
	image?: boolean;
};
/** Сверка с внутренней описью тома: расхождения и факты сверки словами сервиса; skipped — по листам не сверялось. */
export type CourtInventory = {
	n_court: number;
	n_model: number;
	diffs?: string[];
	facts?: string[];
	skipped?: boolean;
};
export type Volume = {
	id: number;
	label: string | null;
	status: string;
	stage?: string;
	pages?: number;
	range?: { first?: string | null; last?: string | null } | null;
	files?: FileFacts[];
	label_source?: string | null;
	gaps?: { text?: string; missing?: (string | number)[] }[];
	shortfalls?: { text?: string }[];
	duplicates?: { text?: string; number?: string | number; page_ids?: number[] }[];
	disagreements?: { text?: string; page_id: number; reads?: (string | number)[] }[];
	court_inventory?: CourtInventory | null;
};
export type VolumeExtra = {
	label_source?: string | null;
	label_page_id?: number | null;
	label_page_no?: number | null;
	label_sheet?: string | null;
	label_checked?: boolean | null;
};
export type CheckRow = {
	page_id: number | null;
	volume_id: number | null;
	label: string;
	reason: string;
	code: string;
	url?: string | null;
	page_ids?: number[];
	sheets?: { page_id: number; label: string; url: string | null }[];
	parts?: {
		values?: string;
		pairs?: string[][];
		single?: string[];
		reads?: string[];
		place?: string;
		main?: string;
		inventory?: string;
		/** места пар «прочитано по-разному» (строка `text_disagree`, пакет 23.11) и начало адреса листа */
		pair_places?: { a: string; b: string; start?: number; end?: number; hl?: string }[];
		place_base?: string | null;
	};
};
export type Upload = {
	id: string;
	filename: string;
	member_path?: string | null;
	size: number;
	received: number;
	part_size?: number;
	parts?: { n: number; size: number }[];
	status: string;
	error?: string | null;
	phase: string;
	intake?: string | null;
};
export type Deadline = {
	id: number;
	title: string;
	state: string;
	end_date: string | null;
	confirmed_name?: string | null;
	confirmed_at?: string | null;
	basis: {
		page_id: number | null;
		label: string;
		url: string | null;
		/** отметка расхождения прочтений даты срока (пакет 23.11); прежний сервис полей не отдаёт */
		own_value?: { a: string; b: string; url?: string | null }[];
		sheet_checks?: { code?: string; reason: string }[];
	};
};
export type CaseData = {
	overview: {
		case?: { title?: string | null; engine_note?: string | null };
		volumes?: Volume[];
		files_without_volume?: FileFacts[];
		e_case?: {
			file_id: number;
			label: string;
			pages: number;
			court_inventory?: CourtInventory | null;
		}[];
		size?: { pages: number; documents: number };
		index_coverage?: { indexed: number; total: number };
		check_sheets?: CheckRow[];
	};
	check_total?: number;
	rights?: { read: boolean; write: boolean; owner: boolean };
	estimate?: { usd: string | null; pages: number } | null;
	version?: number;
	paused?: { reason: string; since: string | null; until: string | null; groups?: string[] | null } | null;
	files?: Record<string, FileFacts>;
	volumes_extra?: Record<string, VolumeExtra>;
	page_nos?: Record<string, number>;
	spent?: { processing: string; work: string };
	/** до паузы платных шагов (п. 27а захода 22.11): меньший из пределов, «≈» — без резервов в полёте */
	until_pause?: { usd: number; by: string } | null;
	uploads?: Upload[];
	counts?: Record<string, number>;
	deadlines_next?: Deadline[];
	/** какая работа по делу идёт сейчас (сервис, `work.of_case`); прежний сервис поля не отдаёт */
	work?: Work | null;
	/** документов, которые модель не разобрала или разобрала не целиком (partial + failed из `cards.state`, Р-7) */
	cards_failed?: number;
};
/** Работа по делу — факты очереди сервиса: `groups` — готовых и взятых задач группы, `running` — из них взято
 *  обработчиком, `waiting` — задачи, ждущие внешнего условия (`wait:` + `next_at > now()`), `wait_reasons` — их причины,
 *  `sweeps` — идущих проходов, `stalled` — обработчик очереди не отвечает (задачи стоят). */
export type Work = {
	busy: boolean;
	groups: Record<string, number>;
	running?: Record<string, number>;
	waiting?: Record<string, number>;
	wait_reasons?: string[];
	waiting_reasons?: Record<string, string[]>;
	paused_groups?: string[];
	sweeps: number;
	/** проходов, чьё задание ждёт в очереди, а обработчик заданий не отвечает (они не «идут»); прежний сервис — нет */
	sweeps_stalled?: number;
	stalled?: boolean;
	/** Вид дела от сервиса (Н-1) — одно правило для «Моих дел», «Обзора» и листа; прежний сервис поля не отдаёт. */
	view?: CaseView;
};
/** Вид дела: runs — обработка идёт; paused — вся идущая обработка на паузе (`reason`: manual, budget, marks, fuse…,
 *  `step` — пауза шага после отказов моделей; `since` — с какого времени общая пауза); stalled — обработчик не
 *  отвечает; waiting — остались задачи, ждущие внешнего условия (`reasons`); ready — обработки нет. `sweeps` —
 *  идущих проходов: проход читает готовое дело и в обработку не входит. */
export type CaseView = {
	kind: 'runs' | 'paused' | 'stalled' | 'waiting' | 'ready';
	reason: string | null;
	since?: string | null;
	reasons: string[];
	sweeps: number;
	sweeps_stalled?: number;
};

// ---------------------------------------------------------------------------------------------------------------------
// Разделы и меню
// ---------------------------------------------------------------------------------------------------------------------

/** Раздел страницы → имя в настройке сервиса `case_page_sections` (null — от настройки не зависит). */
export const SECTION_SETTING: Record<string, string | null> = {
	'': null, // обзор
	upload: null, // право записи
	volumes: 'volumes',
	replace: 'whatsnew', // «Замена тома» и «Выписка листов» — две половины прежнего раздела whatsnew
	check: 'check',
	inventory: 'inventory',
	copies: 'copies',
	passport: 'passport',
	amounts: 'passport', // суммы — прежний подраздел паспорта
	chronology: 'chronology',
	deadlines: 'deadlines',
	tables: 'tables',
	extract: 'whatsnew',
	'folder-files': null, // есть такие файлы
	danger: null // владелец папки
};

/** Прежние метки `#sec-…` страницы сервиса → раздел новой страницы (ссылки из прежних ответов и закладок). */
export function sectionOfHash(hash: string): string | null {
	const m = /^#sec-([a-z-]+)$/.exec(hash || '');
	if (!m) return null;
	const name = m[1] === 'whatsnew' ? 'replace' : m[1];
	return name in SECTION_SETTING && name ? name : null;
}

export type NavItem = {
	slug: string;
	key: string;
	count?: number;
	warn?: boolean;
	quiet?: boolean;
	/** данные раздела сейчас пересобираются (`sectionWork`) — у пункта меню значок часов */
	work?: boolean;
	/** работа раздела стоит: на паузе или обработчик не отвечает — у пункта меню значок паузы, а не часы (Д-11),
	 *  как у строки хода раздела (`workNote` → `waits`) */
	held?: 'paused' | 'stalled';
};
export type NavGroup = { cap?: string; rule?: boolean; items: NavItem[] };

/** Открыт ли раздел этому юристу в этом деле: настройка разделов сервиса и права. */
export function sectionOpen(
	slug: string,
	boot: Boot,
	folderFiles = 0,
	folderFilesFailed = false
): boolean {
	if (!(slug in SECTION_SETTING)) return false;
	if (slug === 'upload') return boot.can_write;
	if (slug === 'danger') return boot.is_owner;
	if (slug === 'folder-files') return folderFiles > 0 || folderFilesFailed;
	const setting = SECTION_SETTING[slug];
	return setting === null || boot.sections.includes(setting);
}

/** Меню разделов, как в макете K-overview: группы с подписями, счётчики — из ответа обзора. `key` — ключ строки. */
export function navGroups(
	boot: Boot,
	data: CaseData | null,
	folderFiles = 0,
	folderFilesFailed = false
): NavGroup[] {
	const c = data?.counts ?? {};
	const n = (name: string) => (c[name] > 0 ? c[name] : undefined);
	const groups: NavGroup[] = [
		{ items: [{ slug: '', key: 'nav_overview' }] },
		{
			cap: 'nav_group_materials',
			items: [
				{ slug: 'upload', key: 'section_upload' },
				{ slug: 'volumes', key: 'section_volumes', count: n('volumes') },
				{ slug: 'replace', key: 'nav_replace' },
				{ slug: 'check', key: 'section_check', count: n('check'), warn: true }
			]
		},
		{
			cap: 'nav_group_documents',
			items: [
				{ slug: 'inventory', key: 'section_inventory', count: n('documents') },
				{ slug: 'copies', key: 'copies_title', count: n('copies') }
			]
		},
		{
			cap: 'nav_group_map',
			items: [
				{ slug: 'passport', key: 'nav_passport' },
				{ slug: 'amounts', key: 'nav_amounts', count: n('amounts') },
				{ slug: 'chronology', key: 'section_chronology', count: n('facts') },
				{ slug: 'deadlines', key: 'section_deadlines', count: n('deadlines') }
			]
		},
		{
			cap: 'nav_group_work',
			items: [
				{ slug: 'tables', key: 'nav_tables', count: n('tables') },
				{ slug: 'extract', key: 'nav_extract' }
			]
		},
		{
			rule: true,
			items: [
				{ slug: 'folder-files', key: 'section_folder_files', quiet: true },
				{ slug: 'danger', key: 'nav_danger', quiet: true }
			]
		}
	];
	return groups
		.map((g) => ({
			...g,
			items: g.items
				.filter((i) => sectionOpen(i.slug, boot, folderFiles, folderFilesFailed))
				.map((i) => {
					const groups = SECTION_WORK[i.slug];
					if (!groups || !workActive(data, groups)) return i;
					const held = data?.work?.stalled
						? ('stalled' as const)
						: isPausedFor(data, groups)
							? ('paused' as const)
							: undefined;
					return held ? { ...i, work: true, held } : { ...i, work: true };
				})
		}))
		.filter((g) => g.items.length);
}

export const navItem = (groups: NavGroup[], slug: string): NavItem | undefined =>
	groups.flatMap((g) => g.items).find((i) => i.slug === slug);

// ---------------------------------------------------------------------------------------------------------------------
// «Открыть лист»
// ---------------------------------------------------------------------------------------------------------------------

/** Сравнение меток «1, 2, 5/1, 10» по величине чисел (как `Core.naturalKey` прежней страницы). */
export const naturalKey = (label: unknown): string =>
	String(label ?? '')
		.split(/(\d+)/)
		.map((x) => (/^\d+$/.test(x) ? ('0000000000' + x).slice(-10) : x))
		.join('');

/** Тома поля «Открыть лист»: метки по порядку, без пустых и повторов. */
export function gotoVolumes(volumes: Volume[] | undefined): string[] {
	const seen = new Set<string>();
	for (const v of volumes ?? []) {
		const label = String(v?.label ?? '').trim();
		if (label) seen.add(label);
	}
	return [...seen].sort((a, b) =>
		naturalKey(a) < naturalKey(b) ? -1 : naturalKey(a) > naturalKey(b) ? 1 : 0
	);
}

// ---------------------------------------------------------------------------------------------------------------------
// Обработка: что ещё идёт, срок переспрашивания, состояние сводки
// ---------------------------------------------------------------------------------------------------------------------

const UPLOAD_BUSY = new Set(['received', 'intake']);
const FILE_BUSY = new Set(['queued', 'splitting', 'reading']);

// ---- работа по делу (поле `work` обзора): один источник признака хода для сводки, разделов, меню и срока опроса ----

/** Группы работы, от которых зависят данные раздела: пока они в очереди или в работе, записи раздела пересобираются.
 *  Работа выше по цепочке входит тоже (чтение листов кончится описью, опись — карточками, карточки — паспортом). */
export const SECTION_WORK: Record<string, string[]> = {
	// разбор документов (cards) пишет в строки описи название, дату и автора документа (Н-3); сверка копий идёт по
	// дате и номеру строк описи
	inventory: ['read', 'inventory', 'cards'],
	copies: ['read', 'inventory', 'cards', 'copies'],
	check: ['read'],
	passport: ['read', 'inventory', 'cards', 'passport'],
	amounts: ['read', 'inventory', 'cards'],
	chronology: ['read', 'inventory', 'cards'],
	deadlines: ['read', 'inventory', 'cards'],
	tables: ['sweeps']
};
/** Вся обработка дела (сводка «Обзора»): проходы — работа юриста с готовым делом, в обработку не входят. */
export const WORK_PROCESSING = ['read', 'inventory', 'cards', 'passport', 'copies', 'vectors', 'other'];
const WORK_ORDER = [...WORK_PROCESSING, 'sweeps'];
/** Группа работы → ключ её слов в строках сервиса. */
export const WORK_PART: Record<string, string> = {
	read: 'work_part_read',
	inventory: 'work_part_inventory',
	cards: 'work_part_cards',
	passport: 'work_part_passport',
	copies: 'work_part_copies',
	vectors: 'work_part_vectors',
	other: 'work_part_other',
	sweeps: 'work_part_sweeps'
};
/** Группа работы на паузе → ключ её слов-существительных («чтение листов», Н-6). */
export const WORK_PAUSE_PART: Record<string, string> = {
	read: 'work_pause_part_read',
	inventory: 'work_pause_part_inventory',
	cards: 'work_pause_part_cards',
	passport: 'work_pause_part_passport',
	copies: 'work_pause_part_copies',
	vectors: 'work_pause_part_vectors',
	other: 'work_pause_part_other'
};
/** Код причины ожидания задачи (`work.wait_reasons`) → ключ строки сервиса (как в `work.py` и `sheetg.js`). */
export const WAIT_KEYS: Record<string, string> = {
	av: 'wait_av',
	disk: 'wait_disk',
	upload_receiving: 'wait_upload_receiving',
	models_off: 'paused_models_off',
	reprocess_limit: 'wait_reprocess_limit',
	texts_unreviewed: 'wait_unreviewed',
	texts_missing: 'wait_texts_missing',
	http_401: 'wait_http_401',
	http_429: 'wait_http_429',
	engine_not_configured: 'wait_engine_not_configured',
	not_ready: 'wait_not_ready'
};

/** Сколько задач группы сейчас в очереди и в работе (`sweeps` — идущих проходов). */
export const workCount = (work: Work | null | undefined, group: string): number =>
	!work ? 0 : group === 'sweeps' ? (work.sweeps ?? 0) : (work.groups?.[group] ?? 0);
/** Идёт ли работа названных групп (без групп — любая). */
export function workActive(
	data: Pick<CaseData, 'work'> | null | undefined,
	groups: string[] = WORK_ORDER
): boolean {
	return groups.some((g) => workCount(data?.work, g) > 0);
}
/** Есть ли в названных группах задачи, ждущие внешнего условия (`wait:`). */
export function workWaiting(
	data: Pick<CaseData, 'work'> | null | undefined,
	groups: string[] = WORK_PROCESSING
): boolean {
	const w = data?.work?.waiting;
	return !!w && groups.some((g) => (w[g] ?? 0) > 0);
}
/** По делу остались только ждущие внешнего условия задачи (активных задач, проходов и своей передачи нет). */
export const workWaitingOnly = (
	data: Pick<CaseData, 'work'> | null | undefined,
	localRunning = false
): boolean => !localRunning && !workActive(data) && workWaiting(data, WORK_PROCESSING);
/** Причины ожидания задач словами сервиса, без повторов (Ф-8: если заданы `groups`, берёт причины этих групп). */
export function waitReasonsText(
	work: Work | null | undefined,
	S: Record<string, any>,
	groups?: string[]
): string {
	const out: string[] = [];
	const codes =
		groups && work?.waiting_reasons
			? groups.flatMap((g) => work.waiting_reasons?.[g] ?? [])
			: (work?.wait_reasons ?? []);
	for (const code of codes) {
		const txt = String(S[WAIT_KEYS[code] ?? 'wait_unknown'] ?? S.wait_unknown ?? '').trim();
		if (txt && !out.includes(txt)) out.push(txt);
	}
	if (!out.length) {
		const fb = String(S.wait_unknown ?? '').trim();
		if (fb) out.push(fb);
	}
	return out.join('; ');
}
/** Работа названных групп на паузе словами-существительными (`work_pause_part_<группа>`: «чтение листов»). */
export function pausedParts(
	work: Work | null | undefined,
	groups: string[],
	S: Record<string, any>
): string[] {
	return WORK_ORDER.filter((g) => groups.includes(g) && workCount(work, g) > 0)
		.map((g) => fmt(S[WORK_PAUSE_PART[g]] ?? S[WORK_PART[g]], { n: workCount(work, g) }))
		.filter(Boolean);
}
/** Части строки «идёт» (Н-6): идущие группы словами хода, группы на паузе (`work.paused_groups`) — отдельно,
 *  «на паузе: …» (как `work.run_parts_text` сервиса). */
export function runParts(work: Work | null | undefined, groups: string[], S: Record<string, any>): string {
	const pg = work?.paused_groups ?? [];
	const runs = workParts(
		work,
		groups.filter((g) => !pg.includes(g)),
		S
	).join(', ');
	const held = pausedParts(
		work,
		groups.filter((g) => pg.includes(g)),
		S
	).join(', ');
	const tail = held && S.work_paused_tail ? fmt(S.work_paused_tail, { parts: held }) : '';
	return [runs, tail].filter(Boolean).join('; ');
}
/** Строка хода раздела (`WorkNote`): идёт / на паузе / не отвечает / ждёт — по работе групп раздела; работы нет — null. */
export function workNote(
	data: Pick<CaseData, 'work' | 'paused'> | null | undefined,
	groups: string[],
	S: Record<string, any>,
	key = 'work_note'
): null | { kind: 'runs' | 'waits' | 'waiting'; paused: boolean; text: string } {
	const work = data?.work;
	if (workActive(data, groups)) {
		if (work?.stalled && S.work_note_stalled) {
			return {
				kind: 'waits',
				paused: false,
				text: fmt(S.work_note_stalled, { parts: workParts(work, groups, S).join(', ') })
			};
		}
		if (isPausedFor(data, groups) && S.work_note_paused) {
			return {
				kind: 'waits',
				paused: true,
				text: fmt(S.work_note_paused, { parts: pausedParts(work, groups, S).join(', ') })
			};
		}
		const parts = runParts(work, groups, S);
		return parts ? { kind: 'runs', paused: false, text: fmt(S[key], { parts }) } : null;
	}
	if (workWaiting(data, groups) && S.work_note_waiting) {
		const reason = waitReasonsText(work, S, groups);
		if (reason) return { kind: 'waiting', paused: false, text: fmt(S.work_note_waiting, { reason }) };
	}
	// проходы стоят: их задания ждут в очереди, а обработчик заданий не отвечает (факт сервиса — его сердцебиение)
	const held = work?.sweeps_stalled ?? 0;
	if (groups.includes('sweeps') && held > 0 && S.work_jobs_stalled) {
		return { kind: 'waits', paused: false, text: fmt(S.work_jobs_stalled, { n: held }) };
	}
	return null;
}
/** Что перечитать в «Хронологии» при очередном обновлении (Р-5, Н-7): `keep` — записи не менялись (та же метка `rev`
 *  и тот же отбор), ничего; `first` — только первую порцию, догруженные остаются на месте: идёт работа групп раздела
 *  (записи меняются почти каждый опрос) или прежний сервис без `rev`; `all` — весь загруженный объём (метка сменилась
 *  без идущей работы — в том числе по её концу, — или сменился отбор, тогда объём — одна порция). */
export function chronologyReread(o: {
	rev: string | null | undefined;
	shownRev: string;
	sameAsked: boolean;
	loadedPages: number;
	working: boolean;
}): 'keep' | 'first' | 'all' {
	if (o.rev && o.sameAsked && o.rev === o.shownRev) return 'keep';
	if (o.sameAsked && o.loadedPages > 1 && (!o.rev || o.working)) return 'first';
	return 'all';
}
/** Причина у отметки дела «на паузе» / «ждёт» (подсказка в «Моих делах», Н-1) словами строк сервиса. */
export function viewWhy(
	w: Pick<CaseView, 'kind' | 'reason' | 'since' | 'reasons'>,
	S: Record<string, any>
): string {
	if (w.kind === 'paused' && w.reason) {
		const t = fmt(S[pauseKey(w.reason)], { time: when(w.since ?? null) });
		return t ? t[0].toLocaleUpperCase('ru-RU') + t.slice(1) : '';
	}
	if (w.kind === 'waiting') {
		const t = waitReasonsText({ wait_reasons: w.reasons } as Work, S);
		return t ? t[0].toLocaleUpperCase('ru-RU') + t.slice(1) : '';
	}
	return '';
}
/** Вид дела: от сервиса (`work.view`, Н-1); прежний сервис без поля — по прежним признакам `work` и `paused`; без
 *  `work` — null (страница живёт по прежним правилам). */
export function caseView(data: Pick<CaseData, 'work' | 'paused'> | null | undefined): CaseView | null {
	const work = data?.work;
	if (!work) return null;
	if (work.view) return work.view;
	const sweeps = work.sweeps ?? 0;
	const base = { reason: null, since: null, reasons: [] as string[], sweeps };
	if (workActive(data, WORK_PROCESSING)) {
		if (work.stalled) return { ...base, kind: 'stalled' };
		if (isPausedFor(data, WORK_PROCESSING)) {
			return {
				...base,
				kind: 'paused',
				reason: data?.paused?.reason ?? null,
				since: data?.paused?.since ?? null
			};
		}
		return { ...base, kind: 'runs' };
	}
	if (workWaiting(data, WORK_PROCESSING)) {
		const reasons = [...new Set(WORK_PROCESSING.flatMap((g) => work.waiting_reasons?.[g] ?? []))];
		return { ...base, kind: 'waiting', reasons: reasons.length ? reasons : (work.wait_reasons ?? []) };
	}
	return { ...base, kind: 'ready' };
}
/** Работа названных групп словами сервиса (`work_part_<группа>`), по порядку цепочки; без строки — группа молчит. */
export function workParts(
	work: Work | null | undefined,
	groups: string[],
	S: Record<string, any>
): string[] {
	return WORK_ORDER.filter((g) => groups.includes(g) && workCount(work, g) > 0)
		.map((g) => fmt(S[WORK_PART[g]], { n: workCount(work, g) }))
		.filter(Boolean);
}
/** Состав работы без чисел: изменился — пора перечитать обзор целиком (между этим хватает лёгкого запроса). */
export const workKey = (work: Work | null | undefined): string =>
	[
		...WORK_ORDER.filter((g) => workCount(work, g) > 0),
		...WORK_PROCESSING.filter((g) => (work?.waiting?.[g] ?? 0) > 0).map((g) => `w:${g}`),
		...(work?.wait_reasons ?? []).map((r) => `wr:${r}`),
		...(work?.paused_groups ?? []).map((g) => `pg:${g}`),
		work?.stalled ? 'stalled' : '',
		(work?.sweeps_stalled ?? 0) > 0 ? 'jobs_stalled' : ''
	].join(',');
/** Раздел следит за работой своих групп: `done` зовётся, когда она закончилась, — раздел перечитывает себя сразу. */
export function workWatcher(groups: string[], done: () => void) {
	let was = false;
	return (data: Pick<CaseData, 'work'> | null | undefined): void => {
		if (!data) return;
		const now = workActive(data, groups);
		if (was && !now) done();
		was = now;
	};
}

/** Приём и распознавание файлов — правило прежней страницы (`processing`): ради них обзор спрашивается целиком. */
export function intake(data: CaseData | null, localRunning = false): boolean {
	if (!data) return localRunning;
	// незавершённая загрузка из другой вкладки (receiving) опрос не ускоряет: её части шлёт не эта страница
	if ((data.uploads ?? []).some((u) => UPLOAD_BUSY.has(u.phase))) return true;
	if (Object.values(data.files ?? {}).some((f) => FILE_BUSY.has(String(f.status)))) return true;
	if ((data.overview.volumes ?? []).some((v) => v.status === 'receiving' || v.status === 'reading'))
		return true;
	return localRunning;
}

/** Идёт ли обработка, ради которой страница переспрашивает чаще: приём и распознавание файлов и любая работа по
 *  делу, которую называет сервис (опись, карточки, паспорт, векторы, проходы). Когда остались только ждущие внешнего
 *  условия задачи (`wait:`), частый опрос не идёт. */
export function processing(data: CaseData | null, localRunning = false): boolean {
	if (workWaitingOnly(data, localRunning)) return false;
	return intake(data, localRunning) || workActive(data);
}
/** Между полными обзорами хватает лёгкого запроса `…/work`: идёт только работа по делу, файлы не принимаются. */
export const workOnly = (data: CaseData | null, localRunning = false): boolean =>
	!!data && workActive(data) && !intake(data, localRunning);

/** Срок до следующего запроса обзора: 5 с при обработке, 30 с без неё. */
export const pollDelay = (data: CaseData | null, localRunning = false): number =>
	processing(data, localRunning) ? 5000 : 30000;

/** Паузы, которые проходят сами (опись § 2.3); остальные ждут администратора. */
const PAUSE_SELF = new Set(['daily', 'fuse', 'rate', 'marks', 'limiter', 'step']);
/** Пауза обработки для показа: проходит ли сама, ключ фразы причины, с какого времени, какие группы остановлены
 *  (`groups: null` — общая пауза всех групп). `rate` (3 с ограничения скорости) паузой для юриста не считается. */
export function pauseOf(
	data: Pick<CaseData, 'paused'> | null | undefined
): null | { self: boolean; key: string; since: string | null; groups: string[] | null } {
	const p = data?.paused;
	if (!p || p.reason === 'rate') return null;
	const groups = p.groups ?? null;
	if (Array.isArray(groups) && !groups.length) return null;
	return { self: PAUSE_SELF.has(p.reason), key: pauseKey(p.reason), since: p.since, groups };
}
/** Пауза шага после отказов моделей (Н-4): общей паузы нет, а вид дела от сервиса — «на паузе» с причиной `step`. */
export function stepPause(
	data: Pick<CaseData, 'paused' | 'work'> | null | undefined
): null | { self: boolean; key: string; since: string | null; groups: string[] | null } {
	const v = data?.work?.view;
	if (!v || v.kind !== 'paused' || v.reason !== 'step') return null;
	return { self: true, key: pauseKey('step'), since: v.since ?? null, groups: data?.work?.paused_groups ?? [] };
}
/** Стоит ли обработка дела на паузе (вид дела «Обзора»): по виду от сервиса, а у прежнего сервиса — по прежнему
 *  правилу (общая пауза или пауза всех идущих групп). */
export function pausedNow(data: Pick<CaseData, 'paused' | 'work'> | null | undefined): boolean {
	const v = data?.work?.view;
	if (v) return v.kind === 'paused';
	const p = pauseOf(data);
	return !!p && (p.groups === null || isPausedFor(data, WORK_PROCESSING));
}
/** Остановлена ли паузой вся активная работа названных групп (Ф-4: по готовому `work.paused_groups` от сервиса,
 *  вычисленному по шагам; при прежнем сервисе без `paused_groups` — по `paused`). */
export function isPausedFor(
	data: Pick<CaseData, 'paused' | 'work'> | null | undefined,
	groups: string[] = WORK_PROCESSING
): boolean {
	const active = groups.filter((g) => workCount(data?.work, g) > 0);
	if (!active.length) return false;
	if (Array.isArray(data?.work?.paused_groups)) {
		const pg = data.work.paused_groups;
		return active.every((g) => pg.includes(g));
	}
	const p = pauseOf(data);
	if (!p) return false;
	if (p.groups === null) return true;
	return active.every((g) => p.groups!.includes(g));
}
const PAUSE_KEYS: Record<string, string> = {
	manual: 'paused_manual',
	budget: 'paused_budget',
	daily: 'paused_daily',
	floor: 'paused_floor',
	credits_unknown: 'paused_credits_unknown',
	fuse: 'paused_fuse',
	rate: 'paused_rate',
	marks: 'paused_marks',
	models_off: 'paused_models_off',
	sweep: 'paused_sweep',
	limiter: 'paused_limiter',
	step: 'paused_step'
};
/** Ключ фразы причины паузы (как `Core.pauseKey`): незнакомая причина — нейтральная фраза. */
export const pauseKey = (reason: unknown): string => PAUSE_KEYS[String(reason)] ?? 'paused_unknown';

export type Summary = {
	/** empty — материалов нет; processing — идёт обработка; waiting — остались только ждущие внешнего условия задачи;
	 *  ready — всё распознано, опись готова и работы по делу (карточки, паспорт, копии, векторы) в очереди нет. */
	kind: 'empty' | 'processing' | 'waiting' | 'ready';
	indexed: number;
	total: number;
	/** Пауза обработки всех дел: self — пройдёт сама; groups: null — общая пауза. */
	paused: null | { self: boolean; key: string; since: string | null; groups: string[] | null };
	volumes: number;
	documents: number;
	checks: number;
};

export function summary(data: CaseData): Summary {
	const ov = data.overview;
	const volumes = ov.volumes ?? [];
	const files = Object.values(data.files ?? {});
	const uploads = data.uploads ?? [];
	const some =
		volumes.length > 0 ||
		(ov.files_without_volume ?? []).length > 0 ||
		(ov.e_case ?? []).length > 0 ||
		uploads.some((u) => UPLOAD_BUSY.has(u.phase) || u.phase === 'receiving');
	const ic = ov.index_coverage ?? { indexed: 0, total: 0 };
	const waitingOnly = workWaitingOnly(data);
	const busy =
		!waitingOnly &&
		(intake(data) ||
			uploads.some((u) => u.phase === 'receiving') || // файл ещё передаётся — материалы в пути
			ic.indexed < ic.total ||
			volumes.some((v) => v.status !== 'inventory_ready') ||
			files.some((f) => FILE_BUSY.has(String(f.status))) ||
			// опись, карточки документов, паспорт, копии, векторы ещё в очереди или в работе: «Готово к работе» — только
			// когда работа действительно закончена (требование владельца 23.11)
			workActive(data, WORK_PROCESSING));
	return {
		kind: !some ? 'empty' : waitingOnly ? 'waiting' : busy ? 'processing' : 'ready',
		indexed: ic.indexed,
		total: ic.total,
		paused: pauseOf(data) ?? stepPause(data),
		volumes: volumes.length,
		documents: ov.size?.documents ?? 0,
		checks: Math.max(data.check_total ?? 0, (ov.check_sheets ?? []).length)
	};
}

export type Tone = 'plain' | 'info' | 'warn' | 'stop';
export type State = { tone: Tone; key: string; vars?: Record<string, unknown> };

/** Слова состояния тома (решение владельца 19.11): «готов» — только когда у тома готово всё. Том распознан, а опись
 *  не составляется — ждёт внешнего условия, стоит на паузе или обработчик не отвечает (факт сервиса `work`), — просто
 *  «распознан», без часов: «составляется опись» было бы неправдой, а почему стоит, говорит плашка обзора (Д-11). */
export function volumeState(v: Volume, data?: Pick<CaseData, 'work' | 'paused'> | null): State {
	if (v.status === 'inventory_ready') return { tone: 'plain', key: 'volume_state_ready' };
	if (v.status === 'indexed') {
		const inv = ['inventory'];
		const held = workActive(data, inv)
			? !!data?.work?.stalled || isPausedFor(data, inv)
			: workWaiting(data, inv);
		return held ? { tone: 'plain', key: 'file_state_indexed' } : { tone: 'info', key: 'volume_state_indexed' };
	}
	if (v.status === 'reading') {
		const done = (v.files ?? []).reduce((a, f) => a + (f.pages_indexed ?? 0), 0);
		return { tone: 'info', key: 'volume_state_reading', vars: { n: done, m: v.pages ?? 0 } };
	}
	return { tone: 'info', key: 'volume_state_queued' };
}

/** Файл не обработан и сам не обработается (заблокирован антивирусом, отказ приёма). */
export const fileStuck = (f: FileFacts): boolean => f.status === 'blocked' || f.status === 'failed';

/** Состояние группы файлов (электронное дело): после обработки — «прочитано». Строка говорит о целом: один
 *  заблокированный файл не делает «не обработанной» всю группу — такие файлы называются счётом рядом (как у файлов
 *  без тома); «не обработан» — только когда не обработан ни один. */
export function filesState(all: FileFacts[]): State {
	const live = all.filter((f) => !fileStuck(f));
	const files = live.length ? live : all;
	if (files.length && files.every((f) => f.status === 'indexed'))
		return { tone: 'plain', key: 'ecase_state_ready' };
	const reading = files.filter((f) => f.status === 'reading');
	if (reading.length) {
		return {
			tone: 'info',
			key: 'volume_state_reading',
			vars: {
				n: files.reduce((a, f) => a + (f.pages_indexed ?? 0), 0),
				m: files.reduce((a, f) => a + (f.pages ?? 0), 0)
			}
		};
	}
	if (files.some((f) => f.status === 'blocked' || f.status === 'failed'))
		return { tone: 'stop', key: 'status_failed' };
	return { tone: 'info', key: 'volume_state_queued' };
}

/** Файлы электронного дела с фактами страницы (`files` обзора поверх строки `e_case`). */
export function ecaseFiles(data: CaseData): FileFacts[] {
	return (data.overview.e_case ?? []).map((e) => ({
		status: 'indexed',
		pages: e.pages,
		...(data.files ?? {})[String(e.file_id)]
	}));
}

// ---------------------------------------------------------------------------------------------------------------------
// Подпись листа и «Проверьте листы»
// ---------------------------------------------------------------------------------------------------------------------

/** Вид подписи листа без номера: «т. 4, стр. 120» и имя файла мелко. Сама подпись (и скопированная строка) не меняется. */
export function splitLabel(label: string): { main: string; file: string } {
	const m = /^(.*?)файл «(.+)», (стр\. .+)$/.exec(label ?? '');
	return m ? { main: `${m[1]}${m[3]}`, file: m[2] } : { main: label ?? '', file: '' };
}

/** Подпись листа внутри тома: «т. 4, л.д. 12» → «л.д. 12» (том назван перед перечнем). */
/** Том из подписи листа («т. 5/1, л.д. 88» → «5/1»); подпись без тома — пусто. */
export function volumeOf(label: string | null | undefined): string {
	return /^т\. ([^,]+), /.exec(label ?? '')?.[1] ?? '';
}
export function inVolume(label: string, volume: string | null | undefined): string {
	const head = volume ? `т. ${volume}, ` : '';
	return head && label.startsWith(head) ? label.slice(head.length) : label;
}

export type CheckGroupId =
	| 'numbers'
	| 'text'
	| 'number_check'
	| 'number_unset'
	| 'gap'
	| 'other'
	| 'volume';
type GroupDef = {
	id: CheckGroupId;
	title: string;
	icon: string;
	codes: string[];
	hint?: string;
	flat?: boolean;
};
/** Группы по виду замечания (названия приняты владельцем 19.11); код вне перечня — «Другие замечания к листам». */
export const CHECK_GROUPS: GroupDef[] = [
	{
		id: 'numbers',
		title: 'check_group_numbers',
		icon: 'hash',
		codes: ['text_disagree'],
		hint: 'check_group_numbers_hint'
	},
	{ id: 'text', title: 'check_group_text', icon: 'img', codes: ['text_short'] },
	{
		id: 'number_check',
		title: 'check_group_number_check',
		icon: 'eye',
		codes: ['number_single', 'number_check', 'number_disagree', 'duplicate', 'lawyer_number']
	},
	{
		id: 'number_unset',
		title: 'check_group_number_unset',
		icon: 'pen',
		codes: ['number_unresolved', 'no_number', 'no_number_sheet'],
		hint: 'check_group_number_unset_hint'
	},
	{
		id: 'gap',
		title: 'check_group_gap',
		icon: 'gap',
		codes: ['gap', 'gap_long', 'gap_min'],
		hint: 'check_group_gap_hint'
	},
	{ id: 'other', title: 'check_group_other', icon: 'al', codes: [] },
	{
		id: 'volume',
		title: 'check_group_volume',
		icon: 'info',
		codes: ['volume_bw', 'volume_corner', 'file_order'],
		hint: 'check_group_volume_hint',
		flat: true
	}
];
/** Причины, у которых все листы — одним перечнем под общей фразой (остальные — строкой на замечание). */
const CHIP_CODES = new Set(['text_short', 'number_single', 'number_check']);

export type Sheet = { page_id: number | null; label: string; url: string | null };
export type CheckItem = {
	key: string;
	code: string;
	volume: string | null;
	sheets: Sheet[];
	/** Что показать рядом с листом: части фразы без общих слов группы или сама фраза. */
	detail: string;
	note: string;
	reason: string;
	/** пары с местом на листе — ссылки «к месту, где выбирается верное прочтение» (только `text_disagree`) */
	places: { text: string; url: string }[];
};
export type CheckChips = {
	key: string;
	reason: string;
	byVolume: { volume: string | null; sheets: Sheet[] }[];
};
export type CheckGroup = {
	id: CheckGroupId;
	title: string;
	icon: string;
	hint?: string;
	flat: boolean;
	rows: CheckItem[];
	chips: CheckChips[];
	/** Число для заголовка: листов (у перечней) или замечаний. */
	count: number;
	countSheets: boolean;
};

export function checkGroups(
	rows: CheckRow[],
	volumes: Volume[],
	S: Record<string, any>,
	onlyVolume: number | null = null
): CheckGroup[] {
	const labelOf = new Map(volumes.map((v) => [v.id, v.label]));
	const out = new Map<CheckGroupId, CheckGroup>(
		CHECK_GROUPS.map((g) => [
			g.id,
			{
				id: g.id,
				title: g.title,
				icon: g.icon,
				hint: g.hint,
				flat: !!g.flat,
				rows: [],
				chips: [],
				count: 0,
				countSheets: false
			}
		])
	);
	const groupOf = (code: string) => CHECK_GROUPS.find((g) => g.codes.includes(code))?.id ?? 'other';
	rows.forEach((r, n) => {
		if (onlyVolume !== null && r.volume_id !== onlyVolume) return;
		const g = out.get(groupOf(r.code))!;
		const volume = r.volume_id != null ? (labelOf.get(r.volume_id) ?? null) : null;
		const sheets: Sheet[] =
			r.sheets ??
			(r.page_id != null ? [{ page_id: r.page_id, label: r.label, url: r.url ?? null }] : []);
		if (CHIP_CODES.has(r.code) && sheets.length) {
			let chips = g.chips.find((c) => c.reason === r.reason);
			if (!chips)
				g.chips.push(
					(chips = { key: `${r.code}:${g.chips.length}`, reason: r.reason, byVolume: [] })
				);
			let bucket = chips.byVolume.find((b) => b.volume === volume);
			if (!bucket) chips.byVolume.push((bucket = { volume, sheets: [] }));
			bucket.sheets.push(...sheets);
			g.count += sheets.length;
			g.countSheets = true;
			return;
		}
		const p = r.parts ?? {};
		let detail = r.reason;
		let note = '';
		if (r.code === 'text_disagree' && p.values) detail = p.values;
		else if (r.code === 'number_unresolved' && (p.reads?.length || p.place)) {
			const reads = p.reads?.length
				? fmt(S.check_reads_short, { reads: p.reads.map((x) => `«${x}»`).join(', ') })
				: '';
			detail = [reads, p.place ?? ''].filter(Boolean).join('; ');
		} else if (p.main) {
			detail = p.main;
			note = p.inventory ?? '';
		}
		g.rows.push({
			key: `${r.code}:${r.page_id ?? 'v' + r.volume_id}:${n}`,
			code: r.code,
			volume,
			sheets,
			detail,
			note,
			reason: r.reason,
			places: r.code === 'text_disagree' ? pairPlaces(p) : []
		});
		g.count += g.id === 'number_check' ? Math.max(1, sheets.length) : 1;
		if (g.id === 'number_check') g.countSheets = true;
	});
	return [...out.values()].filter((g) => g.rows.length || g.chips.length);
}

/** Тома, у которых есть замечания, — для выбора тома (по порядку меток). */
export function checkVolumes(rows: CheckRow[], volumes: Volume[]): Volume[] {
	const have = new Set(rows.map((r) => r.volume_id));
	return volumes
		.filter((v) => have.has(v.id))
		.sort((a, b) => (naturalKey(a.label) < naturalKey(b.label) ? -1 : 1));
}

// ---------------------------------------------------------------------------------------------------------------------
// Числа и даты
// ---------------------------------------------------------------------------------------------------------------------

/** «157» / «4,2» — мегабайты, как на прежней странице. */
export function mb(bytes: number): string {
	const v = (bytes || 0) / 1048576;
	return v < 10 ? v.toFixed(1).replace('.', ',') : String(Math.round(v));
}
/** «850 КБ», «4,2 МБ» (единицы — как на прежней странице, не строка для вычитки). */
export function size(bytes: number): string {
	const b = bytes || 0;
	return b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} КБ` : `${mb(b)} МБ`;
}
/** Дата и время «14.11.2025, 10:02» (как `when` прежней страницы). */
export function when(iso: string | null | undefined): string {
	if (!iso) return '';
	const d = new Date(iso);
	return Number.isNaN(d.getTime())
		? ''
		: d.toLocaleString('ru-RU', {
				day: '2-digit',
				month: '2-digit',
				year: 'numeric',
				hour: '2-digit',
				minute: '2-digit'
			});
}
/** Время начала паузы для пометки «Пауза с 10:02»: сегодняшняя — часы и минуты, иначе с датой. */
export function since(iso: string | null | undefined, now = new Date()): string {
	if (!iso) return '';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
	return d.toDateString() === now.toDateString()
		? time
		: `${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} ${time}`;
}
/** Единый форматтер сумм в USD: 0 → «0,00»; от цента — два знака («1,84»); меньше цента — две значащие цифры
 *  («0,0042», «0,00085») без «< 0,01» и без экспоненты. */
export function usd(v: unknown): string {
	if (v == null || v === '') return '—';
	const n = Number(v);
	if (!Number.isFinite(n)) return '—';
	if (n === 0) return '0,00';
	const abs = Math.abs(n);
	if (abs >= 0.01) return n.toFixed(2).replace('.', ',');
	const exp = Math.floor(Math.log10(abs));
	const decimals = Math.max(2, -exp + 1);
	const fixed = n.toFixed(decimals).replace(/(\.\d*?[1-9])0+$/, '$1');
	return fixed.replace('.', ',');
}
