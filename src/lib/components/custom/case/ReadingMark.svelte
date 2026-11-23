<script lang="ts">
	// ai-dvokat: отметка значения с листа — одна на все разделы «Дел» (пакет 23.11, общий приём А): плашка «прочитано
	// по-разному» — ссылка на первое место; строка «<что> прочитано на листе по-разному: «a» / «b»» со ссылкой «Открыть
	// лист и выбрать верное»; имя только в одном прочтении — своей строкой; пометка листа целиком. Адрес — готовый `url`
	// пары, иначе `place_base` + `&hl=…&pick=1` (лист откроется на месте; у читателя — без карточки правки). Страница
	// ничего не сравнивает: показывает поля сервиса; нет поля — нет отметки, нет строки — нет элемента.
	//
	// `part`: `pills` — только плашки (в строке пометок записи), `lines` — только строки, `all` — плашка и её строка
	// подряд (у срока). Обёртки нет: элементы встают в разметку раздела, как стояли до общего компонента.
	import { MARKS, markView, type MarkFields, type MarkKeys } from '$lib/custom/case/marks';
	import Icon from './Icon.svelte';

	export let m: MarkFields | null | undefined = undefined;
	export let S: Record<string, any> = {};
	/** ключи строк раздела (`MARKS.<раздел>`): собственное значение (одним ключом или по полю `field` пары), имена,
	 *  лист целиком */
	export let keys: MarkKeys = MARKS.fact;
	/** подстановки строк сверх `values` / `reasons` (например, `label` документа пары копий) */
	export let vars: Record<string, unknown> = {};
	export let part: 'all' | 'pills' | 'lines' = 'all';
	/** значок «внимание» в плашке (так у сумм и сроков) */
	export let icon = false;
	/** подсказка у плашки: оба прочтения или причины (где строк рядом нет) */
	export let tip = false;
	export let pillClass = '';
	export let lineClass = '';
	/** начало `data-testid` элементов (у отметок второго листа записи — своё, чтобы не смешивать с первым) */
	export let testid = 'case';

	$: v = markView(m, S, keys, vars);
	$: ownLines = v.lines.filter((l) => l.kind !== 'sheet');
	$: sheetLines = v.lines.filter((l) => l.kind === 'sheet');
	$: pills = part !== 'lines';
	$: texts = part !== 'pills';
</script>

{#if pills && v.own}{#if v.own.url}<a
			class="pill t w {pillClass}"
			href={v.own.url}
			target="_blank"
			rel="noopener"
			title={tip ? v.own.title : undefined}
			data-testid="{testid}-own-value"
			>{#if icon}<Icon name="al" />{/if}{v.own.text}</a
		>{:else}<span
			class="pill t w {pillClass}"
			title={tip ? v.own.title : undefined}
			data-testid="{testid}-own-value"
			>{#if icon}<Icon name="al" />{/if}{v.own.text}</span
		>{/if}{/if}{#if texts}{#each ownLines as l}<p
			class="sm c-warn {lineClass}"
			data-testid={`${testid}-${l.kind === 'own' ? 'own-value' : 'own-person'}-why`}
		>
			{l.text}
			{#if l.url && S.map_own_value_open}<a
					class="ref"
					href={l.url}
					target="_blank"
					rel="noopener"
					data-testid="{testid}-own-value-open">{S.map_own_value_open}</a
				>{/if}
		</p>{/each}{/if}{#if pills && v.sheet}<span
		class="pill t w {pillClass}"
		title={tip ? v.sheet.title : undefined}
		data-testid="{testid}-sheet-check"
		>{#if icon}<Icon name="al" />{/if}{v.sheet.text}</span
	>{/if}{#if texts}{#each sheetLines as l}<p
			class="sm c-warn {lineClass}"
			data-testid="{testid}-sheet-check-why"
		>
			{l.text}
		</p>{/each}{/if}
