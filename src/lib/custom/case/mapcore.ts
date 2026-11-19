/* ai-dvokat: карта дела (паспорт, суммы, хронология, сроки) — слова для юриста по фактам сервиса, без DOM.
   Перенос ядра прежних секций сервиса (`sections/mapcore.js`: `Core`); проверяется vitest (`mapcore.test.ts`).
   Ключи строк, выбираемые по данным, записаны здесь строками — по ним собирается снимок строк для проверок. */
import { fmt } from './strings';

type Strings = Record<string, any>;

export const LINES = ['process', 'dispute'] as const;
export const STATUSES = ['claimed', 'evidenced', 'established'] as const;
const LINE_KEYS: Record<string, string> = {
	process: 'map_line_process',
	dispute: 'map_line_dispute'
};
const STATUS_KEYS: Record<string, string> = {
	claimed: 'map_status_claimed',
	evidenced: 'map_status_evidenced',
	established: 'map_status_established'
};
// подпись поля паспорта: у сводки кода (суд, номер, участники) — «названные в документах», а не «ведёт дело»
const PASSPORT_KEYS: Record<string, string> = {
	court: 'map_pfc_court',
	case_number: 'map_pfc_case_number',
	parties: 'map_pfc_parties',
	client_role: 'map_pf_client_role',
	instance: 'map_pf_instance',
	stage: 'map_pf_stage',
	subject: 'map_pf_subject',
	claims: 'map_pf_claims',
	key_dates: 'map_pf_key_dates',
	key_amounts: 'map_pf_key_amounts'
};
const FIELD_KEYS: Record<string, Record<string, string>> = {
	fact: {
		summary: 'map_f_summary',
		chronology: 'map_f_chronology',
		status: 'map_f_status',
		kind: 'map_f_kind',
		date_as_written: 'map_f_date_as_written',
		date_value: 'map_f_date_value',
		date_precision: 'map_f_date_precision',
		persons: 'map_f_persons',
		hidden: 'map_f_hidden'
	},
	amount: {
		value_as_written: 'map_a_value_as_written',
		what: 'map_a_what',
		value_num: 'map_a_value_num',
		hidden: 'map_a_hidden'
	},
	deadline: {
		title: 'map_d_title',
		ref: 'map_d_ref',
		quote: 'map_d_quote',
		start_date: 'map_d_start_date',
		end_date: 'map_d_end_date',
		calc: 'map_d_calc',
		hidden: 'map_d_hidden',
		confirmed: 'map_d_confirmed'
	}
};

/** Слово по ключу строк; значение модели, для которого строки нет, показывается как есть (а не пропадает). */
const word = (S: Strings, keys: Record<string, string>, prefix: string, value: unknown): string => {
	if (value == null) return '';
	const v = String(value);
	return S[keys[v]] ?? S[`${prefix}${v}`] ?? v;
};
export const lineWord = (S: Strings, v: unknown) => word(S, LINE_KEYS, 'map_line_', v);
export const statusWord = (S: Strings, v: unknown) => word(S, STATUS_KEYS, 'map_status_', v);
export const passportName = (S: Strings, key: string): string =>
	S[PASSPORT_KEYS[key]] ?? S[`map_pfc_${key}`] ?? S[`map_pf_${key}`] ?? key;

export const day = (iso: string | null | undefined): string => {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
	return m ? `${m[3]}.${m[2]}.${m[1]}` : (iso ?? '');
};
type Dated = {
	date_as_written?: string | null;
	date_value?: string | null;
	date_note?: string | null;
};
/** Дата записи: как написана; значением — рядом, если запись её не повторяет. */
export function dateParts(f: Dated, S: Strings): { text: string; value: string; none: boolean } {
	const w = f.date_as_written || '';
	const v = day(f.date_value);
	if (!w && !v) return { text: S.map_date_none, value: '', none: true };
	if (!w) return { text: v, value: '', none: false };
	return { text: w, value: v && !w.includes(v) ? v : '', none: false };
}
export const dateNote = (f: Dated, S: Strings): string =>
	f.date_note === 'document'
		? S.map_date_document
		: f.date_note === 'unchecked'
			? S.map_date_unchecked
			: '';
export const quoteMore = (rest: number | null | undefined, S: Strings): string =>
	rest && rest > 0 ? fmt(S.map_more_on_sheet, { n: rest }) : '';

export type MapState = {
	documents: number;
	no_facts: number;
	pending: number;
	partial: number;
	failed: number;
};
/** Строки состояния карты дела по счёту сервиса. */
export function stateLines(st: MapState | null | undefined, S: Strings): string[] {
	if (!st) return [];
	const out = [fmt(S.map_state_note, { n: st.no_facts, total: st.documents })];
	if (st.pending) out.push(fmt(S.map_state_pending, { n: st.pending }));
	if (st.partial + st.failed) out.push(fmt(S.map_state_failed, { n: st.partial + st.failed }));
	return out;
}

/** Значение правки словами: записи паспорта — их значения; да / нет; статус и линия — словами; дата — ДД.ММ.ГГГГ. */
export function editValue(entity: string, field: string, v: unknown, S: Strings): string {
	if (v == null || v === '' || (Array.isArray(v) && !v.length)) return S.value_empty;
	if (entity === 'passport') {
		return Array.isArray(v)
			? v
					.map((x) => (x as { value?: string } | null)?.value)
					.filter(Boolean)
					.join('; ') || S.value_empty
			: String(v);
	}
	if (typeof v === 'boolean') return v ? S.map_yes : S.map_no;
	if (Array.isArray(v)) return v.join(', ');
	if (field === 'status') return statusWord(S, v);
	if (field === 'chronology') return lineWord(S, v);
	if (/_date$|^date_value$/.test(field)) return day(String(v));
	return String(v);
}
export function editField(entity: string, field: string, id: unknown, S: Strings): string {
	if (entity === 'passport') return passportName(S, String(id));
	const keys = FIELD_KEYS[entity] ?? {};
	const prefix = entity === 'fact' ? 'map_f_' : entity === 'amount' ? 'map_a_' : 'map_d_';
	return S[keys[field]] ?? S[`${prefix}${field}`] ?? field;
}

/** Сумма числом для юриста: «1234567.5» → «1 234 567,50»; не число — как есть. */
export function rub(v: unknown): string {
	if (v == null || v === '') return '';
	const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(v));
	if (!m) return String(v);
	return `${m[1]}${m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${`${m[3] ?? ''}00`.slice(0, 2)}`;
}
type Span = { start_date?: string | null; end_date?: string | null };
export function deadlineDates(d: Span, S: Strings): { text: string; none: boolean } {
	const a = day(d.start_date);
	const b = day(d.end_date);
	if (a && b) return { text: fmt(S.map_deadline_dates, { a, b }), none: false };
	if (b) return { text: fmt(S.map_deadline_end, { b }), none: false };
	if (a) return { text: fmt(S.map_deadline_start, { a }), none: false };
	return { text: S.map_deadline_no_dates, none: true };
}
export const lines = (text: string): string[] =>
	String(text ?? '')
		.split('\n')
		.map((x) => x.trim())
		.filter(Boolean);
