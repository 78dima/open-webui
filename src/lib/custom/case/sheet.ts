/* ai-dvokat: логика и типы просмотрщика листа (`/case/[folderId]/p/[pageId]`) и разрешения ссылки
   (`/case/[folderId]/ref`) — без DOM и запросов, проверяется Vitest (`sheet.test.ts`). */
import { query } from './sections';

export const IMAGE_WIDTHS = [480, 800, 1200, 1600, 2400] as const;
export const DEFAULT_IMAGE_WIDTH = 1200;

export type SheetFlag = { code: string; text: string };
export type SheetHalf = { page_id: number; label: string };
export type SheetPlace = {
	start: number;
	end: number;
	a: string;
	b?: string | null;
	shown?: [number, number];
};
export type SheetLawyer = {
	n: number;
	by?: string | null;
	at?: string | null;
	who?: string | null;
	line?: string | null;
};
export type SheetCard = {
	document_id: number;
	queued?: boolean;
	estimate_usd?: string | number | null;
};
export type SheetRemovedFacts = {
	by: string;
	label?: string | null;
	filename?: string | null;
	page_no?: number | null;
	new_filename?: string | null;
	same?: { page_id: number; label?: string | null; filename?: string | null }[];
};

export type SheetData = {
	page_id: number;
	label: string;
	volume_id?: number | null;
	volume_label?: string | null;
	file_id?: number | null;
	filename?: string | null;
	page_no?: number | null;
	area?: string | null;
	state?: string | null;
	removed: boolean;
	removed_at?: string | null;
	removed_text?: string | null;
	removed_facts?: SheetRemovedFacts | null;
	halves?: SheetHalf[];
	read_id?: number | null;
	accepted_read_id?: number | null;
	old_version?: boolean;
	version_missing?: boolean;
	other_reading?: boolean;
	text?: string;
	hl?: [number, number] | null;
	reading_note?: string | null;
	reading_note_page?: string | null;
	flags?: SheetFlag[];
	number_as_written?: string | null;
	number_source?: string | null;
	side?: string | null;
	number_note?: string | null;
	number_note_page?: string | null;
	number_reads?: string[];
	number_missing?: boolean;
	document_id?: number | null;
	doc_title?: string | null;
	prev?: number | null;
	next?: number | null;
	boxes?: number[][];
	edited_spans?: [number, number][];
	lawyer?: SheetLawyer | null;
	text_editable?: boolean;
	places?: SheetPlace[];
	can_write?: boolean;
	user_id?: string | null;
	case_title?: string | null;
	volumes?: string[];
	card?: SheetCard | null;
	work_note?: [string, string] | null;
};

export type RefVariant = {
	page_id: number;
	label: string;
	how?: string | null;
	page_no?: number | null;
	filename?: string | null;
};

export type RefResponse =
	| { status: 'found'; page_id: number }
	| {
			status: 'many';
			case_title?: string | null;
			asked?: string;
			variants: RefVariant[];
			volumes: string[];
	  }
	| {
			status: 'not_found';
			case_title?: string | null;
			asked?: string;
			why: string;
			links: { page_id: number; label: string }[];
			volumes: string[];
	  };

export type TextSegment = { text: string; hl: boolean; edited: boolean };

/** Является ли ссылка внутренним маршрутом SvelteKit `/case/...` (не `/legal-tools/...` и не внешним URL). */
export const isSpaCaseHref = (href: string | null | undefined): boolean =>
	typeof href === 'string' && /^\/case(?:\/|\?|$)/.test(href);

/** Ссылка на лист внутри SvelteKit SPA. */
export function sheetPageHref(
	folderId: string,
	pageId: number | string,
	opts: { v?: number | string | null; hl?: string | null; pick?: boolean } = {}
): string {
	const q = query({
		v: opts.v ?? undefined,
		hl: opts.hl ?? undefined,
		pick: opts.pick ? '1' : undefined
	});
	return `/case/${encodeURIComponent(folderId)}/p/${encodeURIComponent(String(pageId))}${q}`;
}

/** Ссылка на разрешение «том / лист» внутри SvelteKit SPA. */
export function caseRefHref(
	folderId: string,
	opts: { t?: string | null; l?: string | null; side?: string | null } = {}
): string {
	return `/case/${encodeURIComponent(folderId)}/ref${query({
		t: opts.t ?? undefined,
		l: opts.l ?? undefined,
		side: opts.side ?? undefined
	})}`;
}

/** Адрес нынешней версии листа (без `v`, `hl`, `pick`) — после правки текста или отката. */
export function currentSheetHref(url: URL): string {
	const next = new URL(url.toString());
	next.searchParams.delete('v');
	next.searchParams.delete('hl');
	next.searchParams.delete('pick');
	return next.pathname + next.search + next.hash;
}

/** Формат скопированной строки (совпадает с `sheetg.js` — менять нельзя, на нём стоят ссылки юристов). */
export function copyLine(
	label: string,
	pageUrl: string,
	readId: number | string | null | undefined,
	sel: { a: number; b: number; text: string } | null
): string {
	if (sel && readId != null && readId !== '') {
		return `«${sel.text}» (${label}) ${pageUrl}?v=${encodeURIComponent(String(readId))}&hl=${sel.a}-${sel.b}`;
	}
	return `${label} ${pageUrl}`;
}

/** Безопасная разбивка текста листа на сегменты для `<mark id="hl">` и `<mark class="ed">` без `{@html}`. */
export function buildTextSegments(
	text: string,
	hl: [number, number] | null | undefined,
	editedSpans: [number, number][] | null | undefined
): TextSegment[] {
	if (!text) return [];
	const n = text.length;
	const validHl: [number, number] | null =
		hl && hl.length === 2 && hl[0] >= 0 && hl[0] < hl[1] && hl[1] <= n ? [hl[0], hl[1]] : null;
	const eds = (editedSpans ?? [])
		.filter((s) => Array.isArray(s) && s.length === 2 && s[0] >= 0 && s[0] < s[1] && s[1] <= n)
		.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

	const cuts = new Set<number>([0, n]);
	if (validHl) {
		cuts.add(validHl[0]);
		cuts.add(validHl[1]);
	}
	for (const [a, b] of eds) {
		cuts.add(a);
		cuts.add(b);
	}
	const pts = [...cuts].sort((a, b) => a - b);
	const out: TextSegment[] = [];
	for (let i = 0; i < pts.length - 1; i++) {
		const a = pts[i];
		const b = pts[i + 1];
		if (a >= b) continue;
		const inHl = !!validHl && a >= validHl[0] && b <= validHl[1];
		const inEd = eds.some(([ea, eb]) => a >= ea && b <= eb);
		out.push({ text: text.slice(a, b), hl: inHl, edited: inEd });
	}
	return out;
}

/** Перевод смещения UTF-16 (браузерное выделение) в смещение в кодовых точках (сервер `sheettext.to_raw`). */
export const utf16ToCodePoints = (whole: string, u16Offset: number): number =>
	Array.from(whole.slice(0, Math.max(0, u16Offset))).length;

/** Перевод смещения в кодовых точках (сервер `places.shown`) в смещение UTF-16. */
export const codePointsToUtf16 = (whole: string, cpOffset: number): number =>
	Array.from(whole).slice(0, Math.max(0, cpOffset)).join('').length;

/** Является ли чекбокс «оборот» отмеченным по значению query-параметра `side`. */
export const isBackSide = (side: string | null | undefined): boolean =>
	['back', 'об', 'об.', 'оборот'].includes((side ?? '').trim().toLowerCase());
