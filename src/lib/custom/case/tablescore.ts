/* ai-dvokat: «Таблицы и проходы» — слова для юриста по фактам сервиса, без DOM. Перенос ядра прежней секции сервиса
   (`sections/tables.js`: `Core`); проверяется vitest (`tablescore.test.ts`). Ключи строк, выбираемые по данным,
   записаны строками — по ним собирается снимок строк для проверок. */
import { usd } from './casepage';
import { fmt } from './strings';
import type { MarkFields } from './marks';

export { usd };

type Strings = Record<string, any>;

const STATUS: Record<string, string> = {
	queued: 'tables_status_queued',
	running: 'tables_status_running',
	done: 'tables_status_done',
	partial: 'tables_status_partial',
	failed: 'tables_status_failed'
};
const KIND: Record<string, string> = {
	table: 'tables_kind_table',
	findings: 'tables_kind_findings'
};
const REASONS: [string, string][] = [
	['refused', 'tables_reason_refused'],
	['error', 'tables_reason_error'],
	['limit', 'tables_reason_limit'],
	['cancelled', 'tables_reason_cancelled'],
	['paused', 'tables_reason_paused'],
	['processing', 'tables_reason_processing'],
	['failed', 'tables_reason_failed'],
	['unreadable', 'tables_reason_unreadable']
];
const STOP: Record<string, string> = {
	limit: 'tables_stop_limit',
	cancelled: 'tables_stop_cancelled',
	failed: 'tables_stop_failed',
	paused: 'tables_stop_paused'
};
const CELL_STATE: Record<string, string> = {
	not_here: 'tables_state_not_here',
	unclear: 'tables_state_unclear',
	not_read: 'tables_state_not_read'
};
const SUMMARY: [string, string][] = [
	['answered', 'tables_sum_answered'],
	['not_here', 'tables_sum_not_here'],
	['unclear', 'tables_sum_unclear'],
	['not_read', 'tables_sum_not_read'],
	['checked', 'tables_sum_checked']
];
const HOW: Record<string, string> = {
	duplicate: 'tables_how_duplicate',
	disputed: 'tables_how_disputed',
	ambiguous: 'tables_how_ambiguous'
};
const REF: Record<string, string> = {
	found: 'tables_ref_found',
	not_found: 'tables_ref_not_found',
	partial: 'tables_ref_partial',
	no_volume: 'runs_ref_no_volume', // редакция «номер тома» (строка прежней страницы — tables_ref_no_volume)
	too_long: 'tables_ref_too_long'
};
const RELATION: Record<string, string> = {
	answers: 'tables_rel_answers',
	mentions: 'tables_rel_mentions'
};

export type Changes = {
	added?: number;
	removed?: number;
	new_text?: number;
	documents?: number;
};
export type CatchUp = {
	windows: number;
	pages: number;
	estimate_usd: number | string | null;
};

export type Rest = {
	windows: number;
	pages: number;
	estimate_usd: number | string | null;
	raise_to_usd?: number | string | null;
	spent_usd?: number | string | null;
	limit_usd?: number | string | null;
};
export type Place = {
	page_id: number;
	label?: string;
	read_id?: number | string | null;
	hl?: [number, number] | null;
} & MarkFields & {
		/** места расхождения двух прочтений в цитате (пакет 23.11, М-6): подчёркивание, как у хронологии */
		quote_marks?: { start: number; end: number; a: string; b: string; hl?: string }[];
	};
export type Sweep = {
	id: string;
	kind: string;
	question: string;
	title?: string | null;
	status: string;
	max_usd?: number | null;
	finished?: boolean;
	stop?: string | null;
	scope?: string;
	pages_scope: number;
	pages_read: number;
	not_read?: number;
	not_read_reasons?: Record<string, number>;
	windows_total?: number;
	windows_done?: number;
	stale?: boolean;
	changes?: Changes | null;
	newer?: string | null;
	reader_stale?: boolean;
	parent?: string | null;
	created_at?: string;
	text_short?: number;
	photos?: number;
	text_short_sheets?: Place[];
	photo_sheets?: Place[];
	rest?: Rest | null;
	catch_up?: CatchUp | null;
	reread?: { windows: number; pages: number; estimate_usd: number | string | null } | null;
	found?: number | null;
};
export type Check = {
	stands?: boolean;
	by_name?: string | null;
	at?: string;
	note?: string | null;
	carried?: boolean;
};
export type Answer = Place & {
	value?: string;
	also?: Place[];
	numbers_unconfirmed?: boolean;
	other_reading?: boolean;
	quote?: string | null;
};
export type Copy = {
	kind?: string;
	title?: string;
	label?: string;
	diffs?: number;
	first_page_id?: number | null;
};
export type Cell = {
	state?: string;
	answers?: Answer[];
	copies?: Copy[];
	missing?: number | boolean;
	unreadable?: number;
	no_text?: number;
	text_short?: number;
	partial?: boolean;
	windows_read?: number;
	windows_total?: number;
	check?: Check | null;
};

export const kindWord = (sw: Sweep, S: Strings): string => S[KIND[sw.kind]] ?? sw.kind;
export const statusWord = (sw: Sweep, S: Strings): string =>
	fmt(S[STATUS[sw.status]] ?? S[`tables_status_${sw.status}`] ?? sw.status, {
		done: sw.windows_done,
		total: sw.windows_total
	});
export const statusTone = (sw: Sweep): '' | 'i' | 'w' | 's' =>
	sw.status === 'running' || sw.status === 'queued'
		? 'i'
		: sw.status === 'partial'
			? 'w'
			: sw.status === 'failed'
				? 's'
				: '';
export const title = (sw: Sweep): string => sw.title || sw.question;

/** Строка охвата: сколько прочитано, сколько нет и почему, чем кончился частичный проход. `noSheets` — листы,
 *  прочитанные не полностью, и фото показаны отдельно перечнем (открытая таблица). */
export function coverage(sw: Sweep, S: Strings, noSheets = false): string {
	let line = fmt(S.tables_coverage, {
		label: sw.scope || '',
		read: sw.pages_read,
		scope: sw.pages_scope
	});
	if (sw.not_read) {
		line += ` ${fmt(S.tables_not_read, { n: sw.not_read })}`;
		const why = REASONS.filter(([r]) => (sw.not_read_reasons ?? {})[r]).map(([r, key]) =>
			fmt(S[key], { n: sw.not_read_reasons![r] })
		);
		if (why.length) line += ` (${why.join('; ')})`;
	}
	if (sw.text_short && !noSheets) line += ` ${fmt(S.tables_text_short_cov, { n: sw.text_short })}`;
	if (sw.photos && !noSheets) line += ` ${fmt(S.tables_photos_cov, { n: sw.photos })}`;
	if (sw.stop) line += ` ${S[STOP[sw.stop]] ?? ''}`;
	return line.trim();
}

/** Платное действие дороже 1 USD — перед ним своё окно подтверждения (решение владельца); до 1 USD цены на кнопке
 *  достаточно. Цена неизвестна — подтверждение нужно. */
/** Окно подтверждения: «оценка ≈ X USD; предел прохода — Y USD» (ревью 22.11 Бп-4) — два факта рядом; предела нет
 *  (прежний сервис) — только оценка. */
export const priceText = (S: Strings, estimate: unknown, limit: unknown): string => {
	const n = Number(limit);
	return limit == null || limit === '' || !Number.isFinite(n)
		? fmt(S.runs_confirm_price_only, { usd: usd(estimate as number) })
		: fmt(S.runs_confirm_price, { usd: usd(estimate as number), limit: usd(n) });
};
export const needsConfirm = (estimate: unknown): boolean => {
	const n = Number(estimate);
	return estimate == null || !Number.isFinite(n) || n > 1;
};
/** Остаток частичного прохода до «Дочитать»: части, страницы, оценка; у остановленного пределом трат — потрачено и
 *  предел после поднятия. */
export const restText = (l: Rest, S: Strings): string =>
	l.raise_to_usd != null
		? fmt(S.tables_limit_note, {
				spent: usd(l.spent_usd),
				limit: usd(l.limit_usd),
				pages: l.pages,
				usd: usd(l.estimate_usd),
				to: usd(l.raise_to_usd)
			})
		: fmt(S.tables_rest_note, { n: l.windows, pages: l.pages, usd: usd(l.estimate_usd) });

/** Слова ячейки сверх показанных ответов: «модель не нашла», «ответ не показан», приписки о непрочитанном. */
export function stateText(cell: Cell, S: Strings): string {
	const parts: string[] = [];
	const st = cell.state ?? '';
	if (st === 'not_here' || st === 'not_read' || (st === 'unclear' && !cell.missing))
		parts.push(S[CELL_STATE[st]] ?? st);
	if (cell.missing) parts.push(S.tables_missing);
	if (cell.unreadable) parts.push(fmt(S.tables_unreadable, { n: cell.unreadable }));
	if (cell.no_text) parts.push(fmt(S.tables_no_text, { n: cell.no_text }));
	if (cell.text_short) parts.push(fmt(S.tables_text_short, { n: cell.text_short }));
	if (cell.partial)
		parts.push(fmt(S.tables_partial, { read: cell.windows_read, total: cell.windows_total }));
	return parts.join(' ');
}
export const copyText = (c: Copy, S: Strings): string =>
	fmt(
		c.kind === 'other'
			? S.tables_copy_other
			: c.kind === 'unknown'
				? S.tables_copy_unknown
				: S.tables_copy,
		{ title: c.title || '', label: c.label || '', n: c.diffs }
	);
export const placeQuery = (p: Place): string =>
	p.read_id == null
		? ''
		: `?v=${encodeURIComponent(String(p.read_id))}${p.hl ? `&hl=${p.hl[0]}-${p.hl[1]}` : ''}`;
/** Счёт ячеек столбца: только то, что есть (нулей в шапке нет). */
export const summaryText = (sum: Record<string, number> | undefined, S: Strings): string =>
	SUMMARY.filter(([k]) => (sum ?? {})[k])
		.map(([k, key]) => fmt(S[key], { n: sum![k] }))
		.join(' · ');
/** Отметку можно поставить на то, что показано: ответ с листом, «не сказано» по прочитанному документу, копии. */
export const canCheck = (cell: Cell, sw: Sweep, canWrite: boolean): boolean =>
	canWrite &&
	!!sw.finished &&
	((cell.answers ?? []).length > 0 || cell.state === 'not_here' || cell.state === 'code');
export const sheetText = (sh: { label: string; how?: string }, S: Strings): string =>
	S[HOW[sh.how ?? '']] ? `${sh.label} (${S[HOW[sh.how ?? '']]})` : sh.label;
/** Запись листа из цитаты: слова до листов и после них (листы между ними — ссылками). */
export function refParts(
	r: { state: string; raw: string; missing?: (string | number)[] },
	S: Strings
): [string, string] {
	const mark = '\u0000';
	const text = fmt(S[REF[r.state]] ?? S.tables_ref_not_found, {
		raw: r.raw,
		sheets: mark,
		missing: (r.missing ?? []).join(', ')
	});
	const i = text.indexOf(mark);
	return i < 0 ? [text, ''] : [text.slice(0, i), text.slice(i + 1)];
}
export const scopeQuery = (preset: string, volumes: string[]): string =>
	`?preset=${encodeURIComponent(preset)}${volumes.map((v) => `&volumes=${encodeURIComponent(v)}`).join('')}`;

/** Факты устаревания прохода (Т-5) из `sweep.changes`: нулевые части не пишутся, `documents` — только у таблиц.
 *  Для прежних ответов без `changes` остаётся общая строка `tables_stale`. */
export function staleText(sw: Sweep, S: Strings): string {
	const c = sw.changes;
	if (c) {
		const parts: string[] = [];
		if (c.added) parts.push(fmt(S.tables_stale_added, { n: c.added }));
		if (c.removed) parts.push(fmt(S.tables_stale_removed, { n: c.removed }));
		if (c.new_text) parts.push(fmt(S.tables_stale_new_text, { n: c.new_text }));
		if (sw.kind === 'table' && c.documents)
			parts.push(fmt(S.tables_stale_documents, { n: c.documents }));
		if (parts.length) {
			const head = fmt(S.tables_stale_changes, { parts: parts.join(', ') });
			return c.added || c.new_text ? `${head} ${S.tables_stale_unread}` : head;
		}
	}
	return S.tables_stale;
}

/** Пояснение цены «Дочитать по изменившимся листам» (`sweep.catch_up`); при `windows === 0` — бесплатно. */
export const catchUpNote = (cu: CatchUp, S: Strings): string =>
	cu.windows === 0
		? S.tables_catch_up_free
		: fmt(S.tables_catch_up_note, {
				windows: cu.windows,
				pages: cu.pages,
				usd: usd(cu.estimate_usd)
			});

/** Подпись отношения места прохода к вопросу (`answers` / `mentions`); `null` — без отметки. */
export const relationWord = (relation: string | null | undefined, S: Strings): string =>
	relation && RELATION[relation] ? (S[RELATION[relation]] ?? '') : '';

/** Обновить строки открытой таблицы по месту (Р-8): существующие объекты строк сохраняют ссылку (открытое окно
 *  примечания не теряет строку), а отметки «проверено» из `protectedChecks` (поставленные между опросами или в полёте)
 *  не откатываются более старым снимком. Если `replaceList` — порядок и состав берутся из `incoming`, иначе прежние
 *  строки (включая догруженные порции) сохраняются и обновляются по `document_id`. */
export function mergeTableRows<T extends { document_id: number; cells: Record<string, Cell> }>(
	prev: T[],
	incoming: T[],
	protectedChecks: ReadonlySet<string>,
	replaceList = false
): T[] {
	const byId = new Map(prev.map((r) => [r.document_id, r]));
	const updateOne = (cur: T, inc: T): T => {
		const nextCells: Record<string, Cell> = { ...cur.cells };
		for (const [k, incCell] of Object.entries(inc.cells ?? {})) {
			const cellKey = `${inc.document_id}:${k}`;
			const curCell = cur.cells?.[k];
			if (protectedChecks.has(cellKey) && curCell) {
				nextCells[k] = { ...incCell, check: curCell.check };
			} else {
				nextCells[k] = incCell;
			}
		}
		Object.assign(cur, inc, { cells: nextCells });
		return cur;
	};
	if (replaceList) {
		return incoming.map((inc) => {
			const cur = byId.get(inc.document_id);
			return cur ? updateOne(cur, inc) : inc;
		});
	}
	// Ф-11: новая строка первой порции встаёт на своё место по порядку incoming, а строки следующих порций из prev
	// остаются следом в прежнем порядке (объекты существующих строк сохраняют ссылку).
	const seen = new Set<number>();
	const head = incoming.map((inc) => {
		seen.add(inc.document_id);
		const cur = byId.get(inc.document_id);
		return cur ? updateOne(cur, inc) : inc;
	});
	const tail = prev.filter((r) => !seen.has(r.document_id));
	return [...head, ...tail];
}
