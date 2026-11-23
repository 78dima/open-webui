// ai-dvokat: отметка значения с листа (пакет 23.11, общий приём А): поля записи от сервиса — `own_value` (пары прочтений
// собственного значения), `own_person` (пары имён лиц; `b: ""` — имя есть только в одном прочтении), `sheet_checks`
// (лист помечен целиком), `place_base` (начало адреса места) — в то, что показать. Страница ничего не сравнивает: что
// расходится, решил сервис; здесь только слова и адреса. Нет поля (прежний сервис) — нет отметки; нет строки — нет
// элемента.
import { fmt } from './strings';

export type MarkPair = { a: string; b: string; url?: string | null; hl?: string; field?: string };
export type MarkFields = {
	own_value?: MarkPair[] | null;
	own_person?: MarkPair[] | null;
	sheet_checks?: { code?: string; reason: string }[] | null;
	place_base?: string | null;
};
/** Ключи строк отметки: собственное значение — одним ключом или по полю `field` пары (опись: `date`, `number`). */
export type MarkKeys = {
	own?: string | Record<string, string>;
	person?: string;
	personOne?: string;
	sheet?: string;
};
/** Строки отметки по разделам — одно место, где раздел связан со своими словами (ключи — строки сервиса). */
export const MARKS = {
	/** запись хронологии: дата, имя лица записи, лист записи */
	fact: {
		own: 'map_own_date',
		person: 'map_own_person',
		personOne: 'map_own_person_one',
		sheet: 'map_sheet_check'
	},
	/** второй лист записи хронологии (`more.*`) — строками «на втором листе …» */
	factMore: {
		own: 'map_own_date_more',
		person: 'map_own_person_more',
		personOne: 'map_own_person_one_more',
		sheet: 'map_sheet_check_more'
	},
	amount: { own: 'map_own_sum', sheet: 'map_sheet_check_amount' },
	/** срок — в «Сроках» и в «Ближайших сроках» обзора */
	deadline: { own: 'map_own_deadline', sheet: 'map_sheet_check_deadline' },
	/** участник дела (паспорт и шапка обзора): имена */
	party: {
		own: 'map_own_passport_value',
		person: 'map_own_party',
		personOne: 'map_own_party_one',
		sheet: 'map_sheet_check'
	},
	/** строка описи: дата и номер на первом листе документа */
	doc: {
		own: { date: 'map_own_doc_date', number: 'map_own_doc_number' },
		sheet: 'map_sheet_check_doc'
	},
	/** документ пары «Копий» — с подписью листа (`label`) */
	copy: {
		own: { date: 'map_own_copy_date', number: 'map_own_copy_number' },
		sheet: 'map_sheet_check_copy'
	},
	/** ответ ячейки таблицы */
	cell: { own: 'map_own_cell', sheet: 'map_sheet_check_cell' },
	/** место прохода */
	finding: { own: 'map_own_cell', sheet: 'map_sheet_check_finding' },
	/** повтор места прохода на другом листе — с подписью листа (`label`) */
	findingAlso: { own: 'map_own_cell', sheet: 'map_sheet_check_also' }
} satisfies Record<string, MarkKeys>;

/** Поле паспорта: своё значение у номера дела, ключевых дат и сумм (у остальных сервис пар не отдаёт). */
const PASSPORT_OWN: Record<string, string> = {
	case_number: 'map_own_case_number',
	key_dates: 'map_own_passport_date',
	key_amounts: 'map_own_passport_sum'
};
export const passportMarks = (key: string): MarkKeys =>
	key === 'parties'
		? MARKS.party
		: { own: PASSPORT_OWN[key] ?? 'map_own_passport_value', sheet: 'map_sheet_check' };

export type MarkLine = { text: string; url?: string; kind: 'own' | 'person' | 'sheet' };
export type MarkView = {
	/** плашка «прочитано по-разному» — ссылка на первое место */
	own: { text: string; url?: string; title: string } | null;
	/** плашка «лист в «Проверьте листы»» */
	sheet: { text: string; title: string } | null;
	lines: MarkLine[];
};

/** Адрес места: готовый `url` пары, иначе `place_base` + `&hl=<место>&pick=1`; нет ни того, ни другого — без адреса. */
export function placeUrl(
	p: { url?: string | null; hl?: string | null },
	base?: string | null
): string | undefined {
	if (p.url) return p.url;
	if (base && p.hl) return `${base}&hl=${p.hl}&pick=1`;
	return undefined;
}

export const pairText = (p: MarkPair) => (p.b ? `«${p.a}» / «${p.b}»` : `«${p.a}»`);

const keyOf = (own: MarkKeys['own'], field: string | undefined) =>
	typeof own === 'string' ? own : own ? (own[field ?? ''] ?? own['']) : undefined;

export function markView(
	m: MarkFields | null | undefined,
	S: Record<string, any>,
	keys: MarkKeys,
	vars: Record<string, unknown> = {}
): MarkView {
	const own = m?.own_value ?? [];
	const persons = m?.own_person ?? [];
	const checks = m?.sheet_checks ?? [];
	const base = m?.place_base ?? null;
	const lines: MarkLine[] = [];

	// собственное значение: одна строка на вид значения (поле пары), оба прочтения каждой пары
	const byKey = new Map<string, MarkPair[]>();
	for (const p of own) {
		const k = keyOf(keys.own, p.field);
		if (!k || !S[k]) continue;
		if (!byKey.has(k)) byKey.set(k, []);
		byKey.get(k)!.push(p);
	}
	for (const [k, list] of byKey)
		lines.push({
			kind: 'own',
			text: fmt(S[k], { ...vars, values: list.map(pairText).join('; ') }),
			url: placeUrl(list[0], base)
		});
	// имена: расходятся оба прочтения — одной строкой; имя только в одном прочтении — другой
	const two = persons.filter((p) => p.b);
	const one = persons.filter((p) => !p.b);
	for (const [k, list] of [
		[keys.person, two],
		[keys.personOne, one]
	] as const)
		if (k && S[k] && list.length)
			lines.push({
				kind: 'person',
				text: fmt(S[k], { ...vars, values: list.map(pairText).join('; ') }),
				url: placeUrl(list[0], base)
			});
	const reasons = checks.map((c) => c.reason).join('; ');
	if (checks.length && keys.sheet && S[keys.sheet])
		lines.push({ kind: 'sheet', text: fmt(S[keys.sheet], { ...vars, reasons }) });

	const first = own[0] ?? persons[0];
	return {
		own:
			first && S.map_own_value_pill
				? {
						text: S.map_own_value_pill,
						url: placeUrl(first, base),
						title: [...own, ...persons].map(pairText).join('; ')
					}
				: null,
		sheet:
			checks.length && S.map_sheet_check_pill
				? { text: S.map_sheet_check_pill, title: reasons }
				: null,
		lines
	};
}

/** Пары «Проверьте листы» с местом (`pair_places` строки `text_disagree`): текст пары и адрес места на листе. */
export function pairPlaces(
	parts:
		| {
				pair_places?: { a: string; b: string; hl?: string }[] | null;
				place_base?: string | null;
		  }
		| null
		| undefined
): { text: string; url: string }[] {
	const base = parts?.place_base;
	if (!base) return [];
	return (parts?.pair_places ?? [])
		.map((p) => ({ text: pairText(p), url: placeUrl(p, base) }))
		.filter((p): p is { text: string; url: string } => !!p.url);
}
