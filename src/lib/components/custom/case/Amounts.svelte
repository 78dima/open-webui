<script lang="ts">
	import { useHead } from '$lib/custom/case/head';
	import StaleNote from './StaleNote.svelte';
	// ai-dvokat: «Суммы» (макет K-amounts; опись § 2.8, подраздел паспорта): суммы карточек документов таблицей — как
	// написано, числом, что это, лист, цитата под «Цитата»; «показать убранные»; правка, «Убрать» / «Вернуть»,
	// история и откат. Ручки `GET …/amounts?hidden=`, `PATCH …/amounts/<id>`. Перечитывается вместе с обзором, не чаще
	// раза в 20 с и не пока открыто окно. Поведение — прежний `sections/mapcore.js` (`drawAmounts`, `editAmount`).
	import { onDestroy } from 'svelte';
	import type { CaseState } from '$lib/custom/case/casestore';
	import { createLoader } from '$lib/custom/case/loader';
	import { quoteMore, rub, stateLines, type MapState } from '$lib/custom/case/mapcore';
	import { casePath, errorText, query, reasonText } from '$lib/custom/case/sections';
	import { fmt } from '$lib/custom/case/strings';
	import { caseToast } from '$lib/custom/case/toast';
	import FormDialog from './FormDialog.svelte';
	import HistoryDialog from './HistoryDialog.svelte';
	import Icon from './Icon.svelte';
	import SheetRef from './SheetRef.svelte';

	export let state: CaseState;
	export let S: Record<string, any> = {};

	// суммы из строк таблицы документа одной строкой (п. 8 захода 22.11); раскрывается выборкой по документу
	type Group = { group: true; document_id: number | null; document?: string | null; n: number; label?: string };
	type Amount = {
		group?: undefined;
		id: number;
		value_as_written: string;
		what?: string | null;
		value_num?: string | number | null;
		unchecked?: boolean;
		unit?: string | null;
		edited?: boolean;
		hidden?: boolean;
		label?: string;
		url?: string | null;
		document?: string | null;
		quote?: string | null;
		quote_rest?: number | null;
	};
	const { data } = state;
	let hidden = false;
	const loader = createLoader(
		() =>
			state.api.get<{ amounts: (Amount | Group)[]; can_write?: boolean; state?: MapState | null }>(
				casePath(state, `/amounts${query({ hidden, groups: true })}`)
			),
		{ gap: 20000 }
	);
	const { data: answer, error } = loader;
	// «Обновить» — в шапке раздела, как у паспорта и сроков (на прежней странице суммы перечитывало «Обновить» паспорта)
	const setHead = useHead();
	$: setHead([
		{
			id: 'refresh',
			text: S.map_refresh,
			run: () => void loader.refresh(true),
			testid: 'case-map-refresh'
		}
	]);
	$: ($data, void loader.refresh());
	onDestroy(() => loader.stop());
	$: rows = $answer?.amounts ?? [];
	$: canWrite = !!$answer?.can_write;

	const STEP = 30; // строк до «Показать ещё»
	let limit = STEP;
	let opened = new Set<number>();
	const flip = (id: number) => {
		const next = new Set(opened);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		opened = next;
	};
	const toggleHidden = () => void loader.refresh(true);
	const rowKey = (a: Amount | Group) => (a.group ? `g${a.document_id}` : `a${a.id}`);
	let groupRows: Record<string, Amount[]> = {};
	async function flipGroup(g: Group) {
		const k = `g${g.document_id}`;
		if (groupRows[k]) {
			const { [k]: _gone, ...rest } = groupRows;
			groupRows = rest;
			return;
		}
		try {
			const d = await state.api.get<{ amounts: (Amount | Group)[] }>(
				casePath(state, `/amounts${query({ document: String(g.document_id), hidden })}`)
			);
			groupRows = { ...groupRows, [k]: d.amounts.filter((a): a is Amount => !a.group) };
		} catch (e) {
			caseToast(errorText(S, e), true);
		}
	}
	const hide = (a: Amount) =>
		state.api.request('PATCH', casePath(state, `/amounts/${a.id}`), { hidden: !a.hidden }).then(
			() => loader.refresh(true),
			(e) => caseToast(errorText(S, e), true)
		);

	let editing: Amount | null = null;
	let editOpen = false;
	let form = { written: '', what: '', num: '' };
	function edit(a: Amount) {
		editing = a;
		form = {
			written: a.value_as_written || '',
			what: a.what || '',
			num: a.value_num != null ? rub(a.value_num) : ''
		};
		editOpen = true;
	}
	async function save() {
		if (!editing) return;
		await state.api.request('PATCH', casePath(state, `/amounts/${editing.id}`), {
			value_as_written: form.written.trim(),
			what: form.what.trim() || null,
			value_num: form.num.trim() || null
		});
		await loader.refresh(true);
	}
	let historyId: number | null = null;
	let historyOpen = false;
	$: loader.hold(editOpen || historyOpen);
</script>

<div class="note n" data-testid="case-amounts-note">
	<Icon name="info" klass="l" />
	<p>{S.map_amounts_hint}</p>
</div>

{#if $error && $answer}<StaleNote {S} error={$error} retry={() => loader.refresh(true)} />{/if}
{#if $error && !$answer}
	<section class="card" data-testid="case-amounts-error">
		<div class="col g12 as">
			<span class="pill s"
				><Icon name="al" />{fmt(S.section_error, { detail: reasonText(S, $error) })}</span
			>
			<button type="button" class="btn big" on:click={() => loader.refresh(true)}>{S.retry}</button>
		</div>
	</section>
{:else if !$answer}
	<section class="card"><p class="mut" role="status">{S.loading}</p></section>
{:else}
	<section class="card list" data-testid="case-amounts">
		<div class="row sp g12 bar1">
			<label class="chk"
				><input
					type="checkbox"
					bind:checked={hidden}
					on:change={toggleHidden}
				/>{S.map_amounts_hidden}</label
			>
			{#if rows.length > limit}<span class="sm mut"
					>{fmt(S.shown_of, { n: limit, total: rows.length })}</span
				>{/if}
		</div>
		{#if !rows.length}
			<p class="mut none" data-testid="case-amounts-empty">{S.map_amounts_empty}</p>
		{:else}
			<div class="t-amt">
				<div class="tr th">
					<span>{S.amounts_col_written}</span><span>{S.map_a_what}</span><span
						>{S.amounts_col_sheet}</span
					><span></span>
				</div>
				{#each rows.slice(0, limit) as a (rowKey(a))}
					{#if a.group}
						<div class="tr t" data-testid="case-amount-group">
							<div class="col g2">
								<span class="b aw"
									>{fmt(S.map_a_table_group, { document: a.document || S.court_untitled, n: a.n })}</span
								>
							</div>
							<div class="col g4">
								{#each groupRows[rowKey(a)] ?? [] as r (r.id)}
									<span class="sm aw"
										>{r.value_as_written}{r.what ? ` — ${r.what}` : ''}{#if r.label}{' '}<SheetRef
												label={r.label}
												href={r.url}
											/>{/if}</span
									>
								{/each}
							</div>
							<div class="col g6 as">
								{#if a.label}<span class="sm mut">{fmt(S.map_table_from, { label: a.label })}</span>{/if}
							</div>
							<span class="row g4">
								<button
									type="button"
									class="btn t"
									aria-expanded={!!groupRows[rowKey(a)]}
									on:click={() => a.group && flipGroup(a)}
									>{groupRows[rowKey(a)] ? S.map_table_close : S.map_table_open}</button
								>
							</span>
						</div>
					{:else}
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
							{#if a.unchecked}<span class="pill w t"
									><Icon name="al" />{S.map_amount_unchecked}</span
								>{/if}
							{#if a.unit === 'elsewhere'}<span class="pill t">{S.map_amount_unit_elsewhere}</span
								>{/if}
							{#if a.unit === 'missing'}<span class="pill t">{S.map_amount_unit_missing}</span>{/if}
							{#if a.edited}<span class="pill t"
									>{a.hidden ? S.map_amount_hidden : S.map_amount_edited}</span
								>{/if}
							{#if a.quote}
								<button
									type="button"
									class="btn t"
									aria-expanded={opened.has(a.id)}
									on:click={() => flip(a.id)}
									>{S.quote_toggle}<Icon name={opened.has(a.id) ? 'u' : 'd'} /></button
								>
							{/if}
						</div>
						<span class="row g4">
							{#if canWrite}
								<button type="button" class="btn t" on:click={() => edit(a)}>{S.map_edit}</button>
								<button type="button" class="btn t" on:click={() => hide(a)}
									>{a.hidden ? S.map_unhide : S.map_hide}</button
								>
							{/if}
							<button
								type="button"
								class="btn t"
								on:click={() => {
									historyId = a.id;
									historyOpen = true;
								}}>{S.map_history}</button
							>
						</span>
						{#if a.quote && opened.has(a.id)}
							<p class="q">
								{a.quote}{#if quoteMore(a.quote_rest, S)}{' '}<span class="mut"
										>{quoteMore(a.quote_rest, S)}</span
									>{/if}
							</p>
						{/if}
					</div>
					{/if}
				{/each}
				{#if rows.length > limit}
					<div class="tr">
						<span class="more"
							><button type="button" class="btn" on:click={() => (limit += STEP)}
								>{fmt(S.show_more_n, { n: Math.min(STEP, rows.length - limit) })}</button
							></span
						>
					</div>
				{/if}
			</div>
		{/if}
	</section>
	{#each stateLines($answer.state, S) as t}<p class="sm mut" data-testid="case-map-state">
			{t}
		</p>{/each}
{/if}

<FormDialog
	bind:open={editOpen}
	title={S.map_amount_edit_title}
	{S}
	submit={save}
	testid="case-amount-dialog"
>
	<p class="sm mut">{S.map_amount_edit_hint}</p>
	<label class="lbl"
		>{S.map_a_value_as_written}<input
			class="in"
			type="text"
			maxlength="300"
			bind:value={form.written}
		/></label
	>
	<label class="lbl"
		>{S.map_a_what}<input class="in" type="text" maxlength="500" bind:value={form.what} /></label
	>
	<label class="lbl"
		>{S.map_a_value_num}<input
			class="in"
			type="text"
			inputmode="decimal"
			maxlength="30"
			bind:value={form.num}
		/></label
	>
</FormDialog>

<HistoryDialog
	bind:open={historyOpen}
	{state}
	{S}
	entity="amount"
	id={historyId}
	onReverted={() => loader.refresh(true)}
/>

<style>
	.list {
		padding-bottom: 10px;
	}
	.bar1 {
		padding-bottom: 8px;
	}
	.tr > .q {
		margin-top: 8px;
	}

	.t-amt {
		padding-top: 8px;
	}
	.tr > .q,
	.more {
		grid-column: 1 / -1;
	}
	.none {
		padding-top: 12px;
	}
</style>
