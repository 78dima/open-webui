<script lang="ts">
	// ai-dvokat: «Хронология» (макет K-chronology; опись § 2.9): события дела с датой слева, статусом и линией —
	// чтение модели; цитата — дословный текст листа под «Цитата». Фильтр в одну строку (линия, слова, лицо), период и
	// убранные — по кнопке; порции сервиса под «Показать ещё»; правка, «Убрать» / «Вернуть», история и откат.
	// Ручки `GET …/facts?…`, `PATCH …/facts/<id>`. Перечитывается вместе с обзором, не чаще раза в 20 с и не пока
	// открыто окно. Поведение — прежний `sections/mapcore.js` (`chronology`, `drawFacts`, `factItem`, `editFact`).
	import { onDestroy } from 'svelte';
	import type { CaseState } from '$lib/custom/case/casestore';
	import { useHead } from '$lib/custom/case/head';
	import { createLoader } from '$lib/custom/case/loader';
	import {
		LINES,
		STATUSES,
		dateNote,
		dateParts,
		lineWord,
		quoteMore,
		stateLines,
		statusWord,
		type MapState
	} from '$lib/custom/case/mapcore';
	import { casePath, errorText, query } from '$lib/custom/case/sections';
	import { fmt } from '$lib/custom/case/strings';
	import { caseToast } from '$lib/custom/case/toast';
	import FormDialog from './FormDialog.svelte';
	import HistoryDialog from './HistoryDialog.svelte';
	import Icon from './Icon.svelte';
	import SheetRef from './SheetRef.svelte';

	export let state: CaseState;
	export let S: Record<string, any> = {};

	type More = {
		label: string;
		url?: string | null;
		quote?: string | null;
		quote_rest?: number | null;
	};
	type Fact = {
		id: number;
		summary: string;
		chronology: string;
		status: string;
		kind?: string | null;
		persons: string[];
		date_as_written?: string | null;
		date_value?: string | null;
		date_note?: string | null;
		edited?: boolean;
		hidden?: boolean;
		label?: string;
		url?: string | null;
		document?: string | null;
		quote?: string | null;
		quote_rest?: number | null;
		copies?: { label: string; url?: string | null }[];
		more?: More | null;
		cut?: boolean;
	};
	type Answer = {
		facts: Fact[];
		total: number;
		undated?: number;
		next_page?: number | null;
		state?: MapState | null;
		can_write?: boolean;
	};
	type Query = {
		chronology: string;
		person: string;
		words: string;
		date_from: string;
		date_to: string;
		hidden: boolean;
	};

	const { data } = state;
	// поля формы и запрос, который сейчас показан: запрос меняется по «Найти» и по выбору линии
	let form: Query = {
		chronology: '',
		person: '',
		words: '',
		date_from: '',
		date_to: '',
		hidden: false
	};
	let asked: Query = { ...form };
	let extra: Fact[] = []; // следующие порции той же выборки
	let nextPage: number | null = null;
	const loader = createLoader(
		async () => {
			const d = await state.api.get<Answer>(casePath(state, `/facts${query(asked)}`));
			extra = [];
			nextPage = d.next_page ?? null;
			return d;
		},
		{ gap: 20000 }
	);
	const { data: answer, error } = loader;
	$: ($data, void loader.refresh());
	onDestroy(() => loader.stop());
	$: rows = [...($answer?.facts ?? []), ...extra];
	$: canWrite = !!$answer?.can_write;

	function find() {
		asked = { ...form, person: form.person.trim(), words: form.words.trim() };
		void loader.refresh(true);
	}
	const pickLine = (v: string) => {
		form.chronology = v;
		find();
	};
	let moreBusy = false;
	async function more() {
		if (nextPage == null || moreBusy) return;
		moreBusy = true;
		try {
			const d = await state.api.get<Answer>(
				casePath(state, `/facts${query({ ...asked, page: String(nextPage) })}`)
			);
			extra = [...extra, ...d.facts];
			nextPage = d.next_page ?? null;
		} catch (e) {
			caseToast(errorText(S, e), true);
		} finally {
			moreBusy = false;
		}
	}

	let filterOpen = false;
	let opened = new Set<number>();
	const flip = (id: number) => {
		const next = new Set(opened);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		opened = next;
	};
	let acts = new Set<number>(); // телефон: у каких записей раскрыты действия
	const flipActs = (id: number) => {
		const next = new Set(acts);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		acts = next;
	};
	const hide = (f: Fact) =>
		state.api.request('PATCH', casePath(state, `/facts/${f.id}`), { hidden: !f.hidden }).then(
			() => loader.refresh(true),
			(e) => caseToast(errorText(S, e), true)
		);

	let editing: Fact | null = null;
	let editOpen = false;
	let fields = {
		summary: '',
		chronology: 'process',
		status: 'claimed',
		kind: '',
		written: '',
		value: '',
		persons: ''
	};
	$: statuses =
		editing && !(STATUSES as readonly string[]).includes(editing.status)
			? [...STATUSES, editing.status]
			: [...STATUSES];
	function edit(f: Fact) {
		editing = f;
		fields = {
			summary: f.summary,
			chronology: f.chronology,
			status: f.status,
			kind: f.kind || '',
			written: f.date_as_written || '',
			value: f.date_value || '',
			persons: f.persons.join(', ')
		};
		editOpen = true;
	}
	async function save() {
		if (!editing) return;
		await state.api.request('PATCH', casePath(state, `/facts/${editing.id}`), {
			summary: fields.summary.trim(),
			chronology: fields.chronology,
			status: fields.status,
			kind: fields.kind.trim() || null,
			date_as_written: fields.written.trim() || null,
			date_value: fields.value || null,
			persons: fields.persons
				.split(',')
				.map((x) => x.trim())
				.filter(Boolean)
		});
		await loader.refresh(true);
	}
	let historyId: number | null = null;
	let historyOpen = false;
	$: loader.hold(editOpen || historyOpen);
	const setHead = useHead();
	$: setHead([
		{
			id: 'refresh',
			text: S.map_refresh,
			run: () => void loader.refresh(true),
			testid: 'case-map-refresh'
		}
	]);
</script>

<div class="note n" data-testid="case-facts-note">
	<Icon name="info" klass="l" />
	<p class="grow">{S.map_model_reading}</p>
</div>

<form class="col g8" on:submit|preventDefault={find} data-testid="case-facts-filter">
	<div class="row g8">
		<div class="seg" role="group" aria-label={S.map_filter_line}>
			<button
				type="button"
				class:on={form.chronology === ''}
				aria-pressed={form.chronology === ''}
				on:click={() => pickLine('')}>{S.map_line_all}</button
			>
			{#each LINES as v (v)}
				<button
					type="button"
					class:on={form.chronology === v}
					aria-pressed={form.chronology === v}
					on:click={() => pickLine(v)}>{lineWord(S, v)}</button
				>
			{/each}
		</div>
		<input
			class="in s grow"
			type="search"
			maxlength="300"
			aria-label={S.map_filter_words}
			placeholder={S.map_filter_words_g}
			bind:value={form.words}
		/>
		<input
			class="in s grow"
			type="search"
			maxlength="200"
			aria-label={S.map_filter_person}
			placeholder={S.map_filter_person}
			bind:value={form.person}
		/>
		<button
			type="button"
			class="btn s"
			aria-expanded={filterOpen}
			on:click={() => (filterOpen = !filterOpen)}
			>{S.map_filter_more}<Icon name={filterOpen ? 'u' : 'd'} /></button
		>
		<button type="submit" class="btn s p">{S.map_find}</button>
	</div>
	{#if filterOpen}
		<div class="row g12 ae" data-testid="case-facts-period">
			<label class="lbl"
				>{S.map_filter_from}<input class="in s" type="date" bind:value={form.date_from} /></label
			>
			<label class="lbl"
				>{S.map_filter_to}<input class="in s" type="date" bind:value={form.date_to} /></label
			>
			<label class="chk hidden"
				><input type="checkbox" bind:checked={form.hidden} />{S.map_filter_hidden}</label
			>
		</div>
	{/if}
</form>

{#if $error && !$answer}
	<section class="card" data-testid="case-facts-error">
		<div class="col g12 as">
			<span class="pill s"><Icon name="al" />{fmt(S.section_error, { detail: $error })}</span>
			<button type="button" class="btn big" on:click={() => loader.refresh(true)}>{S.retry}</button>
		</div>
	</section>
{:else if !$answer}
	<section class="card"><p class="mut" role="status">{S.loading}</p></section>
{:else}
	<section class="card list" data-testid="case-facts">
		<div class="col g2 totals">
			<p class="sm mut">{fmt(S.map_facts_total, { n: $answer.total })}</p>
			{#if $answer.undated}<p class="sm mut">{fmt(S.map_undated, { n: $answer.undated })}</p>{/if}
		</div>
		{#if !rows.length}<p class="mut" data-testid="case-facts-empty">{S.map_facts_empty}</p>{/if}
		{#each rows as f (f.id)}
			{@const date = dateParts(f, S)}
			{@const note = dateNote(f, S)}
			<div class="li t" class:hid={f.hidden} data-testid="case-fact">
				<span class="b date" class:mut={date.none}
					>{date.text}{#if date.value}{' '}<span class="sm mut plain">({date.value})</span
						>{/if}</span
				>
				<div class="col g6 grow body">
					<span class="b aw">{f.summary}</span>
					<div class="row g6">
						<span class="pill t">{statusWord(S, f.status)}</span>
						<span class="pill t">{lineWord(S, f.chronology)}</span>
						{#if f.edited}<span class="pill t"
								>{f.hidden ? S.map_fact_hidden : S.map_fact_edited}</span
							>{/if}
						{#if f.kind || f.persons.length}
							<span class="sm mut aw"
								>{[f.kind, f.persons.join(', ')].filter(Boolean).join(' · ')}</span
							>
						{/if}
					</div>
					{#if note}<p class="sm c-warn">{note}</p>{/if}
					<div class="row g8 sm">
						{#if f.label}<SheetRef label={f.label} href={f.url} />{/if}
						{#if f.document}<span class="mut aw">· {f.document}</span>{/if}
						{#if f.quote}
							<button
								type="button"
								class="btn t"
								aria-expanded={opened.has(f.id)}
								on:click={() => flip(f.id)}
								>{S.quote_toggle}<Icon name={opened.has(f.id) ? 'u' : 'd'} /></button
							>
						{/if}
					</div>
					{#if f.quote && opened.has(f.id)}
						<p class="q">
							{f.quote}{#if quoteMore(f.quote_rest, S)}{' '}<span class="mut"
									>{quoteMore(f.quote_rest, S)}</span
								>{/if}
						</p>
					{/if}
					{#if f.copies?.length}
						<div class="note copy">
							<Icon name="al" klass="l" />
							<p class="sm">
								{fmt(S.map_fact_copy, { labels: f.copies.map((c) => c.label).join('; ') })}
							</p>
						</div>
					{/if}
					{#if f.more}
						<p class="sm mut">
							{fmt(S.map_next_sheet, { label: '' })}<SheetRef
								label={f.more.label}
								href={f.more.url}
							/>
						</p>
						{#if f.more.quote && opened.has(f.id)}
							<p class="q">
								{f.more.quote}{#if quoteMore(f.more.quote_rest, S)}{' '}<span class="mut"
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
						aria-expanded={acts.has(f.id)}
						on:click={() => flipActs(f.id)}
						>{S.file_actions}<Icon name={acts.has(f.id) ? 'u' : 'd'} /></button
					>
				</div>
				<span class="row g4 acts" class:shown={acts.has(f.id)}>
					{#if canWrite}
						<button type="button" class="btn t" on:click={() => edit(f)}>{S.map_edit}</button>
						<button type="button" class="btn t" on:click={() => hide(f)}
							>{f.hidden ? S.map_unhide : S.map_hide}</button
						>
					{/if}
					<button
						type="button"
						class="btn t"
						on:click={() => {
							historyId = f.id;
							historyOpen = true;
						}}>{S.map_history}</button
					>
				</span>
			</div>
		{/each}
		{#if nextPage != null}
			<div class="li">
				<button
					type="button"
					class="btn"
					disabled={moreBusy}
					on:click={more}
					data-testid="case-facts-more">{S.map_show_more}</button
				>
				<span class="sm mut">{fmt(S.shown_of, { n: rows.length, total: $answer.total })}</span>
			</div>
		{/if}
	</section>
	{#each stateLines($answer.state, S) as t}<p class="sm mut" data-testid="case-map-state">
			{t}
		</p>{/each}
{/if}

<FormDialog
	bind:open={editOpen}
	title={S.map_fact_edit_title}
	{S}
	submit={save}
	testid="case-fact-dialog"
>
	<label class="lbl"
		>{S.map_f_summary}<textarea class="in" rows="3" maxlength="2000" bind:value={fields.summary}
		></textarea></label
	>
	<div class="row g12">
		<label class="lbl grow"
			>{S.map_f_chronology}<select class="in" bind:value={fields.chronology}>
				{#each LINES as v (v)}<option value={v}>{lineWord(S, v)}</option>{/each}
			</select></label
		>
		<label class="lbl grow"
			>{S.map_f_status}<select class="in" bind:value={fields.status}>
				{#each statuses as v (v)}<option value={v}>{statusWord(S, v)}</option>{/each}
			</select></label
		>
	</div>
	<label class="lbl"
		>{S.map_f_kind}<input class="in" type="text" maxlength="80" bind:value={fields.kind} /></label
	>
	<div class="row g12">
		<label class="lbl grow"
			>{S.map_f_date_as_written}<input
				class="in"
				type="text"
				maxlength="120"
				bind:value={fields.written}
			/></label
		>
		<label class="lbl grow"
			>{S.map_f_date_value}<input class="in" type="date" bind:value={fields.value} /></label
		>
	</div>
	<label class="lbl"
		>{S.map_f_persons}<input class="in" type="text" bind:value={fields.persons} /></label
	>
</FormDialog>

<HistoryDialog
	bind:open={historyOpen}
	{state}
	{S}
	entity="fact"
	id={historyId}
	onReverted={() => loader.refresh(true)}
/>

<style>
	.list {
		padding: 8px 24px;
	}
	.plain {
		font-weight: 400;
	}
	form .in.grow {
		min-width: 160px;
	}

	.totals {
		padding-bottom: 8px;
	}
	.date {
		flex: 0 0 170px;
		overflow-wrap: anywhere;
	}
	.copy {
		padding: 10px 12px;
	}
	.chk.hidden {
		min-height: 40px;
	}
	.lbl select,
	.lbl input,
	.lbl textarea {
		min-width: 0;
		width: 100%;
	}
	.lbl.grow {
		flex-basis: 180px;
	}
	textarea {
		min-height: 84px;
		padding-top: 10px;
		padding-bottom: 10px;
		resize: vertical;
	}
	@media (max-width: 720px) {
		.acts:not(.shown) {
			display: none;
		}
		.date {
			flex-basis: 100%;
		}
		.seg {
			width: 100%;
		}
	}
</style>
