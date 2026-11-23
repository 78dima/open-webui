<script lang="ts">
	// ai-dvokat: строка суммы — одна и та же в списке и в раскрытой группе строк таблиц документа (ревью 22.11 Б-1: у
	// раскрытых сумм те же действия и пометки). Действия — колбэками раздела.
	import { quoteMore, rub } from '$lib/custom/case/mapcore';
	import { fmt } from '$lib/custom/case/strings';
	import Icon from './Icon.svelte';
	import SheetRef from './SheetRef.svelte';

	export let a: any;
	export let S: Record<string, any> = {};
	export let canWrite = false;
	export let onEdit: (a: any) => void = () => {};
	export let onHide: (a: any) => void = () => {};
	export let onHistory: (a: any) => void = () => {};

	let quoteOpen = false;
</script>

<div class="tr t" class:hid={a.hidden} data-testid="case-amount">
	<div class="col g2">
		<span class="b lg num aw">{a.value_as_written}</span>
		<span class="sm mut num"
			>{a.value_num != null
				? fmt(S.map_amount_value, { v: rub(a.value_num) })
				: S.map_amount_no_value}</span
		>
	</div>
	<div class="col g4">
		{#if a.what}<span class="md aw">{a.what}</span>{/if}
		{#if a.document}<span class="sm mut aw">{a.document}</span>{/if}
	</div>
	<div class="col g6 as">
		{#if a.label}<SheetRef label={a.label} href={a.url} />{/if}
		{#if a.unchecked}<span class="pill w t"><Icon name="al" />{S.map_amount_unchecked}</span>{/if}
		{#if a.quote_changed}<span class="pill w t" data-testid="case-quote-changed"
				><Icon name="al" />{S.quote_changed}</span
			>{/if}
		{#if a.sheet_checks?.length && S.map_sheet_check_pill}<span
				class="pill w t"
				data-testid="case-sheet-check"><Icon name="al" />{S.map_sheet_check_pill}</span
			>{/if}
		{#if a.unit === 'elsewhere'}<span class="pill t">{S.map_amount_unit_elsewhere}</span>{/if}
		{#if a.unit === 'missing'}<span class="pill t">{S.map_amount_unit_missing}</span>{/if}
		{#if a.in_table}<span class="pill t" data-testid="case-amount-in-table"
				>{S.map_fact_in_table}</span
			>{/if}
		{#if a.edited}<span class="pill t">{a.hidden ? S.map_amount_hidden : S.map_amount_edited}</span
			>{/if}
		{#if a.quote}
			<button
				type="button"
				class="btn t"
				aria-expanded={quoteOpen}
				on:click={() => (quoteOpen = !quoteOpen)}
				>{S.quote_toggle}<Icon name={quoteOpen ? 'u' : 'd'} /></button
			>
		{/if}
	</div>
	<span class="row g4">
		{#if canWrite}
			<button type="button" class="btn t" on:click={() => onEdit(a)}>{S.map_edit}</button>
			<button type="button" class="btn t" on:click={() => onHide(a)}
				>{a.hidden ? S.map_unhide : S.map_hide}</button
			>
		{/if}
		<button type="button" class="btn t" on:click={() => onHistory(a)}>{S.map_history}</button>
	</span>
	<!-- лист суммы стоит в «Проверьте листы» (пакет 23.11, Д-9): причины — словами списка -->
	{#if a.sheet_checks?.length && S.map_sheet_check_amount}<p
			class="sm c-warn why"
			data-testid="case-sheet-check-why"
		>
			{fmt(S.map_sheet_check_amount, {
				reasons: a.sheet_checks.map((c: { reason: string }) => c.reason).join('; ')
			})}
		</p>{/if}
	{#if a.quote && quoteOpen}
		<p class="q">
			{a.quote}{#if quoteMore(a.quote_rest, S)}{' '}<span class="mut"
					>{quoteMore(a.quote_rest, S)}</span
				>{/if}
		</p>
	{/if}
</div>

<style>
	.tr > .q {
		margin-top: 8px;
		grid-column: 1 / -1;
	}
	.tr > .why {
		grid-column: 1 / -1;
	}
</style>
