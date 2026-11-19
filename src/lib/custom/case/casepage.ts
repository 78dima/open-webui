/* ai-dvokat: страница дела (вариант «Г») — всё, что страница решает сама по данным сервиса, без DOM и запросов:
   состав меню по настройке разделов и правам, состояние сводки, слова состояния тома, группы «Проверьте листы»,
   поле «Открыть лист». Правила перенесены с прежней страницы сервиса (`case.js`: `Core`, `processing`, `renderCheck`)
   и из макетов K-*; проверяется vitest (`casepage.test.ts`). */
import { fmt } from './strings';

export type Boot = {
	folder_id: string;
	title: string | null;
	has_case: boolean;
	can_write: boolean;
	is_owner: boolean;
	user_id: string;
	sections: string[];
	stage: number;
	part_size: number;
	max_file_mb: number;
	case_id: string | null;
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
};
export type Volume = {
	id: number;
	label: string | null;
	status: string;
	stage?: string;
	pages?: number;
	range?: { first?: string | null; last?: string | null } | null;
	files?: FileFacts[];
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
	basis: { page_id: number | null; label: string; url: string | null };
};
export type CaseData = {
	overview: {
		case?: { title?: string | null; engine_note?: string | null };
		volumes?: Volume[];
		files_without_volume?: FileFacts[];
		e_case?: { file_id: number; label: string; pages: number }[];
		size?: { pages: number; documents: number };
		index_coverage?: { indexed: number; total: number };
		check_sheets?: CheckRow[];
	};
	check_total?: number;
	rights?: { read: boolean; write: boolean; owner: boolean };
	estimate?: { usd: string | null; pages: number } | null;
	version?: number;
	paused?: { reason: string; since: string | null; until: string | null } | null;
	files?: Record<string, FileFacts>;
	uploads?: Upload[];
	counts?: Record<string, number>;
	deadlines_next?: Deadline[];
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

export type NavItem = { slug: string; key: string; count?: number; warn?: boolean; quiet?: boolean };
export type NavGroup = { cap?: string; rule?: boolean; items: NavItem[] };

/** Открыт ли раздел этому юристу в этом деле: настройка разделов сервиса и права. */
export function sectionOpen(slug: string, boot: Boot, folderFiles = 0): boolean {
	if (!(slug in SECTION_SETTING)) return false;
	if (slug === 'upload') return boot.can_write;
	if (slug === 'danger') return boot.is_owner;
	if (slug === 'folder-files') return folderFiles > 0;
	const setting = SECTION_SETTING[slug];
	return setting === null || boot.sections.includes(setting);
}

/** Меню разделов, как в макете K-overview: группы с подписями, счётчики — из ответа обзора. `key` — ключ строки. */
export function navGroups(boot: Boot, data: CaseData | null, folderFiles = 0): NavGroup[] {
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
		.map((g) => ({ ...g, items: g.items.filter((i) => sectionOpen(i.slug, boot, folderFiles)) }))
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
	return [...seen].sort((a, b) => (naturalKey(a) < naturalKey(b) ? -1 : naturalKey(a) > naturalKey(b) ? 1 : 0));
}

// ---------------------------------------------------------------------------------------------------------------------
// Обработка: что ещё идёт, срок переспрашивания, состояние сводки
// ---------------------------------------------------------------------------------------------------------------------

const UPLOAD_BUSY = new Set(['received', 'intake']);
const FILE_BUSY = new Set(['queued', 'splitting', 'reading']);

/** Идёт ли обработка, ради которой обзор переспрашивается чаще, — правило прежней страницы (`processing`). */
export function processing(data: CaseData | null, localRunning = false): boolean {
	if (!data) return localRunning;
	// незавершённая загрузка из другой вкладки (receiving) опрос не ускоряет: её части шлёт не эта страница
	if ((data.uploads ?? []).some((u) => UPLOAD_BUSY.has(u.phase))) return true;
	if (Object.values(data.files ?? {}).some((f) => FILE_BUSY.has(String(f.status)))) return true;
	if ((data.overview.volumes ?? []).some((v) => v.status === 'receiving' || v.status === 'reading')) return true;
	return localRunning;
}

/** Срок до следующего запроса обзора: 5 с при обработке, 30 с без неё. */
export const pollDelay = (data: CaseData | null, localRunning = false): number =>
	processing(data, localRunning) ? 5000 : 30000;

/** Паузы, которые проходят сами (опись § 2.3); остальные ждут администратора. */
const PAUSE_SELF = new Set(['daily', 'fuse', 'rate', 'marks', 'limiter']);
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
	limiter: 'paused_limiter'
};
/** Ключ фразы причины паузы (как `Core.pauseKey`): незнакомая причина — нейтральная фраза. */
export const pauseKey = (reason: unknown): string => PAUSE_KEYS[String(reason)] ?? 'paused_unknown';

export type Summary = {
	/** empty — материалов нет; processing — идёт обработка; ready — всё распознано и опись готова. */
	kind: 'empty' | 'processing' | 'ready';
	indexed: number;
	total: number;
	/** Пауза обработки всех дел: self — пройдёт сама. */
	paused: null | { self: boolean; key: string; since: string | null };
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
	const busy =
		processing(data) ||
		uploads.some((u) => u.phase === 'receiving') || // файл ещё передаётся — материалы в пути

		ic.indexed < ic.total ||
		volumes.some((v) => v.status !== 'inventory_ready') ||
		files.some((f) => FILE_BUSY.has(String(f.status)));
	const p = data.paused;
	return {
		kind: !some ? 'empty' : busy ? 'processing' : 'ready',
		indexed: ic.indexed,
		total: ic.total,
		paused: p ? { self: PAUSE_SELF.has(p.reason), key: pauseKey(p.reason), since: p.since } : null,
		volumes: volumes.length,
		documents: ov.size?.documents ?? 0,
		checks: Math.max(data.check_total ?? 0, (ov.check_sheets ?? []).length)
	};
}

export type Tone = 'plain' | 'info' | 'warn' | 'stop';
export type State = { tone: Tone; key: string; vars?: Record<string, unknown> };

/** Слова состояния тома (решение владельца 19.11): «готов» — только когда у тома готово всё. */
export function volumeState(v: Volume): State {
	if (v.status === 'inventory_ready') return { tone: 'plain', key: 'volume_state_ready' };
	if (v.status === 'indexed') return { tone: 'info', key: 'volume_state_indexed' };
	if (v.status === 'reading') {
		const done = (v.files ?? []).reduce((a, f) => a + (f.pages_indexed ?? 0), 0);
		return { tone: 'info', key: 'volume_state_reading', vars: { n: done, m: v.pages ?? 0 } };
	}
	return { tone: 'info', key: 'volume_state_queued' };
}

/** Состояние группы файлов (электронное дело): после обработки — «прочитано». */
export function filesState(files: FileFacts[]): State {
	if (files.length && files.every((f) => f.status === 'indexed')) return { tone: 'plain', key: 'ecase_state_ready' };
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
	if (files.some((f) => f.status === 'blocked' || f.status === 'failed')) return { tone: 'stop', key: 'status_failed' };
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
export function inVolume(label: string, volume: string | null | undefined): string {
	const head = volume ? `т. ${volume}, ` : '';
	return head && label.startsWith(head) ? label.slice(head.length) : label;
}

export type CheckGroupId = 'numbers' | 'text' | 'number_check' | 'number_unset' | 'gap' | 'other' | 'volume';
type GroupDef = { id: CheckGroupId; title: string; icon: string; codes: string[]; hint?: string; flat?: boolean };
/** Группы по виду замечания (названия приняты владельцем 19.11); код вне перечня — «Другие замечания к листам». */
export const CHECK_GROUPS: GroupDef[] = [
	{ id: 'numbers', title: 'check_group_numbers', icon: 'hash', codes: ['text_disagree'], hint: 'check_group_numbers_hint' },
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
	{ id: 'gap', title: 'check_group_gap', icon: 'gap', codes: ['gap', 'gap_long', 'gap_min'], hint: 'check_group_gap_hint' },
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
};
export type CheckChips = { key: string; reason: string; byVolume: { volume: string | null; sheets: Sheet[] }[] };
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
			{ id: g.id, title: g.title, icon: g.icon, hint: g.hint, flat: !!g.flat, rows: [], chips: [], count: 0, countSheets: false }
		])
	);
	const groupOf = (code: string) => CHECK_GROUPS.find((g) => g.codes.includes(code))?.id ?? 'other';
	rows.forEach((r, n) => {
		if (onlyVolume !== null && r.volume_id !== onlyVolume) return;
		const g = out.get(groupOf(r.code))!;
		const volume = r.volume_id != null ? (labelOf.get(r.volume_id) ?? null) : null;
		const sheets: Sheet[] =
			r.sheets ?? (r.page_id != null ? [{ page_id: r.page_id, label: r.label, url: r.url ?? null }] : []);
		if (CHIP_CODES.has(r.code) && sheets.length) {
			let chips = g.chips.find((c) => c.reason === r.reason);
			if (!chips) g.chips.push((chips = { key: `${r.code}:${g.chips.length}`, reason: r.reason, byVolume: [] }));
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
		g.rows.push({ key: `${r.code}:${r.page_id ?? 'v' + r.volume_id}:${n}`, code: r.code, volume, sheets, detail, note, reason: r.reason });
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
		: d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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
/** Сумма «1,84» из «1.84»: на странице дробь пишется с запятой. */
export const money = (usd: string | null | undefined): string => String(usd ?? '').replace('.', ',');
