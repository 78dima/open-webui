/* ai-dvokat: разделы страницы дела (вариант «Г») — общее без DOM: адреса ручек и листов, слова состояния файла,
   подсказка «продолжение тома», факт входа файла, откуда номер тома. Правила перенесены с прежней страницы сервиса
   (`case.js`: `Core.fileFacts`, `Core.suggestText`, `Core.factText`, `Core.blockKey`, `fileStatus`, `labelSource`);
   проверяется vitest (`sections.test.ts`). */
import type { CaseApi } from './api';
import type { CaseData, FileFacts, InputFact, Suggest, Volume, VolumeExtra } from './casepage';
import { CHECK_GROUPS, naturalKey } from './casepage';
import { count, fmt } from './strings';

type Strings = Record<string, any>;
type Where = { api: CaseApi; folderId: string };

/** Ручка дела: `api/cases/<папка><хвост>`. */
export const casePath = (w: Where, rest = ''): string =>
	`api/cases/${encodeURIComponent(w.folderId)}${rest}`;
/** Адрес страницы сервиса внутри дела: лист, «открыть лист по номеру», выгрузка. */
export const caseHref = (w: Where, rest = ''): string =>
	w.api.url(`case/${encodeURIComponent(w.folderId)}${rest}`);
export const sheetHref = (w: Where, pageId: number | string, query = ''): string =>
	caseHref(w, `/p/${encodeURIComponent(String(pageId))}${query}`);
/** Строка запроса из заполненных полей (пустые не идут). */
export function query(fields: Record<string, unknown>): string {
	const q = new URLSearchParams();
	for (const [k, v] of Object.entries(fields)) {
		if (v != null && v !== '' && v !== false) q.set(k, String(v));
	}
	const text = q.toString();
	return text ? `?${text}` : '';
}
/** «Не получилось: {фраза сервера}» — строка ошибки формы и всплывающего сообщения. */
export const errorText = (S: Strings, e: unknown): string =>
	fmt(S.error_generic, { detail: (e as { message?: string } | null)?.message ?? '' });

// ---- файлы и тома ----

/** Факты файла: свои факты страницы из базы (`files` в ответе обзора) поверх строки обзора. */
export function fileFacts(f: FileFacts, extra: FileFacts | undefined): FileFacts {
	const out: FileFacts = { ...f };
	const x = extra ?? {};
	for (const k of [
		'status',
		'block_reason',
		'pages',
		'pages_indexed',
		'input_kind',
		'suggest'
	] as const) {
		if (x[k] != null) (out as Record<string, unknown>)[k] = x[k];
	}
	if (x.input_fact && Object.keys(x.input_fact).length) out.input_fact = x.input_fact;
	if (x.estimate_usd) out.estimate_usd = x.estimate_usd;
	if (x.image) out.image = true;
	return out;
}

/** Причина блокировки → ключ строки; незнакомый код — нейтральная фраза без кода. */
const BLOCK_KEYS: Record<string, string> = {
	infected: 'block_infected',
	av_limit: 'block_av_limit',
	broken: 'block_broken',
	unsupported: 'block_unsupported',
	zip_limit: 'block_zip_limit',
	disk: 'block_disk'
};
export const blockKey = (code: unknown, S: Strings): string => {
	const c = String(code ?? '');
	const known = BLOCK_KEYS[c];
	if (known && S[known]) return known;
	// причина, которой страница ещё не знает, но строка у сервиса уже есть
	return /^[a-z_]{1,40}$/.test(c) && Object.prototype.hasOwnProperty.call(S, `block_${c}`)
		? `block_${c}`
		: 'block_other';
};

export type FileTone = 'plain' | 'info' | 'stop';
/** Состояние файла. Обычный ход (в очереди, распознаётся, распознан; у электронного дела — прочитан) — словами
 *  страницы по коду состояния, как в макете K-volumes; блокировки и сбои — словами сервиса; незнакомое — как есть. */
export function fileStatus(
	f: FileFacts,
	S: Strings,
	mode: FileMode = 'volume'
): { text: string; tone: FileTone } {
	switch (f.status) {
		case 'queued':
			return { text: S.file_state_queued, tone: 'info' };
		case 'splitting':
			return { text: S.status_splitting, tone: 'info' };
		case 'reading':
			return {
				text: fmt(S.file_state_reading, { n: f.pages_indexed || 0, m: f.pages || '?' }),
				tone: 'info'
			};
		case 'indexed':
			return {
				text: mode === 'ecase' ? S.file_state_ecase_ready : S.file_state_indexed,
				tone: 'plain'
			};
		case 'failed':
			return { text: S.status_failed, tone: 'stop' };
		case 'blocked':
			return {
				text: fmt(S.status_blocked, { reason: S[blockKey(f.block_reason, S)] }),
				tone: 'stop'
			};
		case 'removed':
			return { text: S.status_removed, tone: 'plain' };
		default:
			return { text: f.status || '', tone: 'plain' };
	}
}

export const kindText = (kind: string | undefined, S: Strings): string =>
	kind === 'e_case'
		? S.upload_kind_ecase
		: kind === 'photo'
			? S.upload_kind_photo
			: S.upload_kind_volume;

/** Факт входа файла числом: «цифровой текст у N из M страниц»; «сканы» — только если все страницы сканы. */
export function factText(fact: InputFact | null | undefined, S: Strings): string {
	if (!fact || fact.photo) return '';
	if (fact.layer_all) return S.upload_fact_layer;
	const m = fact.pages || 0;
	if (!m) return '';
	if (!fact.layer_pages && fact.image_pages === m) return S.upload_fact_scan;
	return fmt(S.upload_fact_layer_some, { n: fact.layer_pages || 0, m });
}

export type FileMode = 'volume' | 'loose' | 'ecase';
/** Строка фактов файла: страницы · вид (где он не ясен из места) · цифровой текст. Оценки в строке нет: оценка
 *  показывается только у платного действия (решение владельца), общая — в «Загрузить материалы». */
export function fileLine(f: FileFacts, mode: FileMode, S: Strings): string {
	const out: string[] = [];
	if (f.pages) out.push(count(f.pages, S.file_pages_forms));
	if (mode === 'loose' || (mode === 'volume' && f.input_kind === 'photo'))
		out.push(kindText(f.input_kind, S));
	const fact = factText(f.input_fact, S);
	if (fact) out.push(fact);
	return out.join(' · ');
}

/** Подсказка «похоже на продолжение тома»: основание — непрерывность номеров или опись суда; кандидатов несколько
 *  без выделенного — «укажите том», подтверждать нечего. */
export function suggestText(
	sug: Suggest | null | undefined,
	S: Strings,
	labelOf: (id: number) => string
): string {
	if (!sug) return '';
	const label = (id: number, fallback?: string | null) => fallback || labelOf(id);
	if (sug.volume_id == null) {
		const c = sug.candidates ?? [];
		return c.length
			? fmt(S.upload_suggest_many, {
					volumes: c.map((x) => fmt(S.volume_title, { label: x.label })).join(', ')
				})
			: '';
	}
	if (sug.basis === 'inventory')
		return fmt(S.upload_suggest_inventory, {
			n: label(sug.volume_id, sug.label),
			first: sug.first
		});
	return fmt(S.upload_suggest, {
		n: label(sug.volume_id, sug.label),
		a: sug.last,
		next: sug.first
	});
}

export const volumeLabel = (volumes: Volume[], id: number | string): string =>
	volumes.find((v) => String(v.id) === String(id))?.label ?? '?';
export const volumeTitle = (label: string | null | undefined, S: Strings): string =>
	label ? fmt(S.volume_title, { label }) : S.volume_no_label;
/** Тома по порядку номеров («1, 2, 5/1, 10») — для списков «продолжение тома». */
export const volumesSorted = (volumes: Volume[]): Volume[] =>
	[...volumes].sort((a, b) => (naturalKey(a.label) < naturalKey(b.label) ? -1 : 1));

export type LabelSource = {
	text: string;
	pageId: number | null;
	sheet: string;
	unchecked: boolean;
};
/** Откуда номер тома — факт базы: кто назвал, лист с номером, «в тексте листа не нашли». */
export function labelSource(
	v: Volume,
	extra: VolumeExtra | undefined,
	S: Strings
): LabelSource | null {
	const x = extra ?? {};
	const src = x.label_source || v.label_source;
	const text =
		src === 'lawyer'
			? S.label_source_lawyer_g
			: src === 'cover'
				? S.label_source_cover_g
				: src === 'inventory'
					? S.label_source_inventory_g
					: '';
	if (!text) return null;
	return {
		text,
		pageId: x.label_page_id ?? null,
		sheet: x.label_sheet ?? '',
		unchecked: src !== 'lawyer' && x.label_checked === false
	};
}

/** Замечания тома по нумерации — для ссылки «По нумерации тома N замечаний» в «Проверьте листы». */
const NUMBERING_GROUPS = new Set(['number_check', 'number_unset', 'gap']);
/** Код замечания → ключ названия его группы; группы и коды — те же, что в «Проверьте листы». */
export const NUMBERING_CODES: Record<string, string> = Object.fromEntries(
	CHECK_GROUPS.filter((g) => NUMBERING_GROUPS.has(g.id)).flatMap((g) =>
		g.codes.map((code) => [code, g.title])
	)
);
export function numberingChecks(
	data: CaseData | null,
	volumeId: number
): { total: number; groups: { key: string; n: number }[] } {
	const by = new Map<string, number>();
	let total = 0;
	for (const row of data?.overview.check_sheets ?? []) {
		if (row.volume_id !== volumeId) continue;
		const key = NUMBERING_CODES[row.code];
		if (!key) continue;
		const n = Math.max(1, row.sheets?.length ?? row.page_ids?.length ?? 1);
		by.set(key, (by.get(key) ?? 0) + n);
		total += n;
	}
	return { total, groups: [...by].map(([key, n]) => ({ key, n })) };
}

// ---- опись ----

export type Doc = {
	id: number;
	volume_id?: number | null;
	file_id?: number | null;
	first_page_id: number;
	last_page_id: number;
	label: string;
	title?: string | null;
	doc_type?: string | null;
	date_as_written?: string | null;
	date_value?: string | null;
	number?: string | null;
	author?: string | null;
	edited?: boolean;
	sheets: number;
	unchecked?: string[];
	overlap?: ({ label?: string } | null)[];
	uncovered?: boolean;
};
/** Пометки проверки строки описи кодом сервиса: чего не нашли на листах, пересечения, «не размечено». */
export function docNotes(d: Doc, S: Strings): string[] {
	const out: string[] = [];
	const un = d.unchecked ?? [];
	if (un.includes('title')) out.push(S.inventory_unchecked);
	if (un.includes('date')) out.push(S.inventory_date_unchecked);
	const ov = (d.overlap ?? []).map((o) => o?.label).filter(Boolean);
	if (ov.length) out.push(fmt(S.inventory_overlap, { docs: ov.join('; ') }));
	if (d.uncovered) out.push(S.inventory_uncovered);
	return out;
}
