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
	import AmountRow from './AmountRow.svelte';

	export let state: CaseState;
	export let S: Record<string, any> = {};

	// суммы из строк таблицы документа одной строкой (п. 8 захода 22.11); раскрывается выборкой по документу
	type Group = {
		group: true;
		on_check?: number;
		document_id: number | null;
		document?: string | null;
		n: number;
		label?: string;
	};
	type Amount = {
		group?: undefined;
		id: number;
		in_table?: boolean;
		value_as_written: string;
		what?: string | null;
		value_num?: string | number | null;
		parsed_num?: string | number | null;
		unchecked?: boolean;
		quote_changed?: boolean;
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
	$: rows = ($answer?.amounts ?? [])
		.filter((a) => a.group || !gone.has(a.id))
		.map((a) => (!a.group && patched[a.id]) || a);
	$: canWrite = !!$answer?.can_write;

	const STEP = 30; // строк до «Показать ещё»
	let limit = STEP;
	const toggleHidden = () => {
		gone = new Set(); // «с убранными» — убранные снова видны
		void loader.refresh(true);
	};
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
				casePath(
					state,
					`/amounts${query({ document: String(g.document_id), table_group: true, hidden })}`
				)
			);
			groupRows = { ...groupRows, [k]: d.amounts.filter((a): a is Amount => !a.group) };
		} catch (e) {
			caseToast(errorText(S, e), true);
		}
	}
	// действие над суммой — сумма заменяется на месте ответом сервиса (ревью 22.11 Б-1): место в списке и раскрытая
	// группа сохраняются; состав групп — при следующем обновлении
	let patched: Record<number, Amount> = {};
	// убранная сумма без «с убранными» уходит из списка сразу; ответа с суммой нет — список заново, как прежде
	let gone = new Set<number>();
	const put = (r: unknown) => {
		const na = (r as { amount?: Amount } | null)?.amount;
		if (!na || typeof na.id !== 'number') return void loader.refresh(true);
		if (na.hidden && !hidden) gone = new Set([...gone, na.id]);
		patched = { ...patched, [na.id]: na };
	};
	const hide = (a: Amount) =>
		state.api
			.request('PATCH', casePath(state, `/amounts/${a.id}`), { hidden: !a.hidden })
			.then(put, (e) => caseToast(errorText(S, e), true));

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
		const r = await state.api.request('PATCH', casePath(state, `/amounts/${editing.id}`), {
			value_as_written: form.written.trim(),
			what: form.what.trim() || null,
			value_num: form.num.trim() || null
		});
		put(r);
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
									>{fmt(S.map_a_table_group, {
										document: a.document || S.court_untitled,
										n: a.n
									})}</span
								>
							</div>
							<div class="col g4"></div>
							<div class="col g6 as">
								{#if a.label}<span class="sm mut">{fmt(S.map_table_from, { label: a.label })}</span
									>{/if}
								{#if a.on_check && S.map_group_on_check}<span
										class="pill w t"
										data-testid="case-group-on-check"
										><Icon name="al" />{fmt(S.map_group_on_check, { n: a.on_check })}</span
									>{/if}
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
						{#each (groupRows[rowKey(a)] ?? []).filter((x) => !gone.has(x.id)) as r (r.id)}
							<AmountRow
								a={patched[r.id] ?? r}
								{S}
								{canWrite}
								onEdit={edit}
								onHide={hide}
								onHistory={(x) => {
									historyId = x.id;
									historyOpen = true;
								}}
							/>
						{/each}
					{:else}
						<AmountRow
							{a}
							{S}
							{canWrite}
							onEdit={edit}
							onHide={hide}
							onHistory={(x) => {
								historyId = x.id;
								historyOpen = true;
							}}
						/>
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
	onReverted={() => {
		patched = {};
		gone = new Set();
		groupRows = {};
		void loader.refresh(true);
	}}
/>

<style>
	.list {
		padding-bottom: 10px;
	}
	.bar1 {
		padding-bottom: 8px;
	}

	.t-amt {
		padding-top: 8px;
	}
	.more {
		grid-column: 1 / -1;
	}
	.none {
		padding-top: 12px;
	}
</style>
