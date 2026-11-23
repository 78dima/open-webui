<script lang="ts">
	// ai-dvokat: строка записи хронологии — одна и та же в ленте и в раскрытой группе строк таблиц документа (ревью
	// 22.11 Б-1: у раскрытых записей те же действия и пометки, что у обычных). Действия — колбэками раздела.
	import { dateNote, dateParts, lineWord, quoteMore, statusWord } from '$lib/custom/case/mapcore';
	import { fmt } from '$lib/custom/case/strings';
	import { acceptedText as acceptedLine } from '$lib/custom/case/facts';
	import Icon from './Icon.svelte';
	import QuoteText from './QuoteText.svelte';
	import ReadingMark from './ReadingMark.svelte';
	import { MARKS } from '$lib/custom/case/marks';
	import SheetRef from './SheetRef.svelte';

	export let f: any;
	export let S: Record<string, any> = {};
	export let canWrite = false;
	export let onAccept: (f: any) => void = () => {};
	export let onEdit: (f: any) => void = () => {};
	export let onHide: (f: any) => void = () => {};
	export let onHistory: (f: any) => void = () => {};

	let quoteOpen = false;
	let actsOpen = false;
	$: date = dateParts(f, S);
	$: note = dateNote(f, S);
	const acceptedText = (x: any) => acceptedLine(x, S);
</script>

<div class="li t" class:hid={f.hidden} data-testid="case-fact">
	<span class="b date" class:mut={date.none}
		>{date.text}{#if date.value}{' '}<span class="sm mut plain">({date.value})</span>{/if}</span
	>
	<div class="col g6 grow body">
		<span class="b aw">{f.summary}</span>
		<div class="row g6">
			<span class="pill t">{statusWord(S, f.status)}</span>
			<span class="pill t">{lineWord(S, f.chronology)}</span>
			{#if f.edited}<span class="pill t">{f.hidden ? S.map_fact_hidden : S.map_fact_edited}</span
				>{/if}
			{#if f.accepted}<span class="pill t" data-testid="case-fact-accepted">{acceptedText(f)}</span
				>{/if}
			{#if f.in_table}<span class="pill t" data-testid="case-fact-in-table"
					>{S.map_fact_in_table}</span
				>{/if}
			{#if f.near_accepted}<span class="pill t w" data-testid="case-fact-near-accepted"
					>{S.map_fact_near_accepted}</span
				>{/if}
			{#if f.quote_changed}<span class="pill t w" data-testid="case-quote-changed"
					>{S.quote_changed}</span
				>{/if}
			<ReadingMark m={f} {S} part="pills" />
			{#if f.kind || f.persons.length}
				<span class="sm mut aw">{[f.kind, f.persons.join(', ')].filter(Boolean).join(' · ')}</span>
			{/if}
		</div>
		{#if note}<p class="sm c-warn">{note}</p>{/if}
		<!-- отметка записи (пакет 23.11, Д-9; общий компонент — общий приём А): расходится её собственная дата или имя
		     лица записи — оба прочтения; лист помечен целиком — причины словами списка; лист — ссылкой ниже -->
		<ReadingMark m={f} {S} keys={MARKS.fact} part="lines" />
		<div class="row g8 sm">
			{#if f.label}<SheetRef label={f.label} href={f.url} />{/if}
			{#if f.document}<span class="mut aw">· {f.document}</span>{/if}
			{#if f.quote}
				<button
					type="button"
					class="btn t"
					aria-expanded={quoteOpen}
					on:click={() => (quoteOpen = !quoteOpen)}
					>{S.quote_toggle}<Icon name={quoteOpen ? 'u' : 'd'} /></button
				>
			{/if}
		</div>
		{#if f.quote && quoteOpen}
			<p class="q">
				<QuoteText
					quote={f.quote}
					marks={f.quote_marks}
					base={f.place_base}
					{S}
				/>{#if quoteMore(f.quote_rest, S)}{' '}<span class="mut">{quoteMore(f.quote_rest, S)}</span
					>{/if}
			</p>
		{/if}
		{#if f.copies?.length}
			<div class="note copy">
				<Icon name="al" klass="l" />
				<p class="sm">
					{fmt(S.map_fact_copy, {
						labels: f.copies.map((c: { label: string }) => c.label).join('; ')
					})}
				</p>
			</div>
		{/if}
		{#if f.more}
			<p class="sm mut">
				{fmt(S.map_next_sheet, { label: '' })}<SheetRef label={f.more.label} href={f.more.url} />
			</p>
			<!-- отметки второго листа записи (`more.*`) — своими строками «на втором листе …» -->
			<ReadingMark m={f.more} {S} keys={MARKS.factMore} part="lines" testid="case-more" />
			{#if f.more.quote && quoteOpen}
				<p class="q">
					<QuoteText
						quote={f.more.quote}
						marks={f.more.quote_marks}
						base={f.more.place_base}
						{S}
					/>{#if quoteMore(f.more.quote_rest, S)}{' '}<span class="mut"
							>{quoteMore(f.more.quote_rest, S)}</span
						>{/if}
				</p>
			{/if}
		{:else if f.cut}
			<p class="sm c-warn">{S.map_cut}</p>
		{/if}
	</div>
	<div class="only-n">
		<button
			type="button"
			class="btn s"
			aria-expanded={actsOpen}
			on:click={() => (actsOpen = !actsOpen)}
			>{S.file_actions}<Icon name={actsOpen ? 'u' : 'd'} /></button
		>
	</div>
	<span class="row g4 acts" class:shown={actsOpen}>
		{#if canWrite}
			<button type="button" class="btn t" on:click={() => onAccept(f)}
				>{f.accepted ? S.map_fact_unaccept : S.map_fact_accept}</button
			>
			<button type="button" class="btn t" on:click={() => onEdit(f)}>{S.map_edit}</button>
			<button type="button" class="btn t" on:click={() => onHide(f)}
				>{f.hidden ? S.map_unhide : S.map_hide}</button
			>
		{/if}
		<button type="button" class="btn t" on:click={() => onHistory(f)}>{S.map_history}</button>
	</span>
</div>

<style>
	.plain {
		font-weight: 400;
	}
	.date {
		flex: 0 0 170px;
		overflow-wrap: break-word;
	}
	.copy {
		padding: 10px 12px;
	}
	@media (max-width: 720px) {
		.acts:not(.shown) {
			display: none;
		}
		.date {
			flex-basis: 100%;
		}
	}
</style>
