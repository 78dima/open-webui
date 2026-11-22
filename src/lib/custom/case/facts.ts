/* ai-dvokat: хронология и суммы без DOM — строка группы «строки таблицы документа», ключ строки ленты, подпись
   принятия (пакет Б захода 22.11, п. 8 и п. 25; ревью Б-1). Проверяется vitest (`facts.test.ts`). */
import { fmt } from './strings';

type Strings = Record<string, any>;

export type TableGroup = {
	group: true;
	document_id: number | null;
	document?: string | null;
	n: number;
	date_from?: string | null;
	date_to?: string | null;
	label?: string;
};

/** Ключ строки ленты: группа — по документу, запись — по id (у группы id нет). */
export const rowKey = (r: { group?: boolean; document_id?: number | null; id?: number }): string =>
	r.group ? `g${r.document_id}` : `f${r.id}`;

/** День ДД.ММ.ГГГГ из ISO-даты; пусто — пусто. */
export const dayOf = (iso?: string | null): string => {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
	return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
};

/** «Строки таблицы в документе «…»: записей N, с … по …» — период, если даты разные; одна дата — днём. */
export function groupText(g: TableGroup, S: Strings): string {
	const a = dayOf(g.date_from);
	const b = dayOf(g.date_to);
	const period =
		a && b && a !== b
			? fmt(S.map_table_period, { from: a, to: b })
			: a
				? fmt(S.map_table_day, { day: a })
				: '';
	return fmt(S.map_table_group, { document: g.document || S.court_untitled, n: g.n, period });
}

/** «принято: кто, когда» — имя из Open WebUI; имени нет — без имени. */
export function acceptedText(
	f: { accepted_name?: string | null; accepted_at?: string | null },
	S: Strings
): string {
	const when = dayOf(f.accepted_at);
	return f.accepted_name
		? fmt(S.map_fact_accepted, { who: f.accepted_name, when })
		: fmt(S.map_fact_accepted_when, { when });
}

/** Счёт записей ленты: записи, а не строки (группа — одна строка, в ней n записей); старый сервис — строки. */
export const recordsTotal = (a: { total: number; total_records?: number | null }): number =>
	a.total_records ?? a.total;
