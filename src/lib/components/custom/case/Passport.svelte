<script lang="ts">
	import StaleNote from './StaleNote.svelte';
	// ai-dvokat: «Паспорт» дела (макет K-passport, окно K-dialogs; опись § 2.8): указатель — каждая запись ведёт на
	// лист. Блоки «О деле», «Участники, названные в документах» (первые четыре и «Показать ещё», роли — «ещё N», поиск
	// по написанию), «Ключевые даты», «Ключевые суммы»; цитата записи — под «Цитата»; «Править» поле, «История» и
	// откат. Ручки `GET …/passport`, `PATCH …/passport`. Перечитывается вместе с обзором дела, не чаще раза в 20 с и
	// не пока открыто окно; раскрытое — состояние компонента. Поведение — прежний `sections/mapcore.js`.
	import { onDestroy } from 'svelte';
	import type { CaseState } from '$lib/custom/case/casestore';
	import { useHead } from '$lib/custom/case/head';
	import { createLoader, createReload } from '$lib/custom/case/loader';
	import { SECTION_WORK, workWatcher } from '$lib/custom/case/casepage';
	import WorkNote from './WorkNote.svelte';
	import {
		lines,
		passportName,
		quoteMore,
		stateLines,
		type MapState
	} from '$lib/custom/case/mapcore';
	import { casePath, reasonText } from '$lib/custom/case/sections';
	import { fmt } from '$lib/custom/case/strings';
	import FormDialog from './FormDialog.svelte';
	import HistoryDialog from './HistoryDialog.svelte';
	import Icon, { type IconName } from './Icon.svelte';
	import SheetRef from './SheetRef.svelte';

	export let state: CaseState;
	export let S: Record<string, any> = {};
	export let hrefOf: (slug: string) => string;

	type Place = { label?: string; url?: string | null };
	type Role = {
		value: string;
		documents?: number;
		label?: string;
		url?: string | null;
		more_places?: Place[];
	};
	type Item = Place & {
		value: string;
		source?: string;
		unchecked?: boolean;
		date_note?: string | null;
		unit?: string | null;
		handwritten?: number;
		in_table?: boolean;
		records?: number;
		documents?: number;
		quote?: string | null;
		quote_rest?: number | null;
		more_places?: Place[];
		roles?: Role[];
	};
	type Field = { key: string; items: Item[]; edited?: boolean; lawyer_only?: boolean };
	type Answer = {
		fields: Field[];
		// поля, которых сервис не отдал (модель не заполнила, юрист не правил) — их можно добавить (п. 18 захода 22.11)
		absent?: { key: string }[];
		built?: { cards: number; cards_total: number; missing?: number } | null;
		state?: MapState | null;
		can_write?: boolean;
	};

	const { data } = state;
	const loader = createLoader(() => state.api.get<Answer>(casePath(state, '/passport')), {
		gap: 20000
	});
	const { data: answer, error } = loader;
	$: ($data, void loader.refresh());
	// работа по делу, от которой зависят записи раздела, закончилась — раздел перечитывается сразу, не дожидаясь
	// своего промежутка (пока она идёт, вверху раздела стоит строка хода `WorkNote`)
	const watchWork = workWatcher(SECTION_WORK.passport, () => {
		loader.touch();
		void loader.refresh();
	});
	$: watchWork($data);
	onDestroy(() => loader.stop());

	const OWN_CARD = new Set(['parties', 'key_dates', 'key_amounts']);
	$: fields = $answer?.fields ?? [];
	$: about = fields.filter((f) => !OWN_CARD.has(f.key));
	$: parties = fields.find((f) => f.key === 'parties');
	$: lists = fields.filter((f) => f.key === 'key_dates' || f.key === 'key_amounts');
	$: canWrite = !!$answer?.can_write;
	$: absent = ($answer?.absent ?? []).filter((a) => !OWN_CARD.has(a.key));
	let adding = '';
	// подпись поля — одна, своя таблица страницы (у сводки кода — «названные в документах»; ревью 22.11 Б-5)
	const fieldName = (f: { key: string }) => passportName(S, f.key);
	function addField() {
		const a = absent.find((x) => x.key === adding);
		if (a) edit({ key: a.key, items: [] });
		adding = '';
	}

	const PARTIES = 4; // участников до «Показать ещё»
	const ROWS = 3; // записей в «Ключевых датах» и «Ключевых суммах» до «Показать ещё»
	let opened = new Set<string>();
	const flip = (key: string) => {
		const next = new Set(opened);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		opened = next;
	};
	const cap = (t: string) => (t ? t[0].toLocaleUpperCase('ru-RU') + t.slice(1) : t);
	let search = '';
	$: needle = search.trim().toLocaleLowerCase('ru-RU');
	$: found = (parties?.items ?? []).filter(
		(it) => !needle || it.value.toLocaleLowerCase('ru-RU').includes(needle)
	);
	$: partiesShown = needle || opened.has('parties:all') ? found : found.slice(0, PARTIES);

	type Pill = { text: string; warn: boolean; icon?: IconName };
	function pills(it: Item): Pill[] {
		const out: Pill[] = [];
		if (it.source === 'lawyer') out.push({ text: S.map_passport_lawyer, warn: false });
		if (it.in_table) out.push({ text: S.map_passport_table_party, warn: false });
		if (it.unchecked) out.push({ text: S.export_amount_unchecked, warn: true });
		if (it.date_note === 'document') out.push({ text: S.map_passport_date_document, warn: false });
		if (it.unit === 'elsewhere') out.push({ text: S.map_amount_unit_elsewhere, warn: false });
		if (it.unit === 'missing') out.push({ text: S.map_amount_unit_missing, warn: false });
		if (it.handwritten)
			out.push({
				text:
					it.handwritten >= (it.records || 1)
						? S.map_passport_handwritten
						: fmt(S.map_passport_handwritten_some, { n: it.handwritten, m: it.records }),
				warn: true,
				icon: 'pen'
			});
		return out;
	}

	// ---- править поле, история ----
	let editing: Field | null = null;
	let editOpen = false;
	let editText = '';
	function edit(f: Field) {
		editing = f;
		editText = f.items.map((it) => it.value).join('\n');
		editOpen = true;
	}
	async function save() {
		if (!editing) return;
		await state.api.request('PATCH', casePath(state, '/passport'), {
			key: editing.key,
			values: lines(editText)
		});
		await loader.refresh(true);
	}
	let historyKey: string | null = null;
	let historyOpen = false;
	const history = (key: string) => {
		historyKey = key;
		historyOpen = true;
	};
	$: loader.hold(editOpen || historyOpen);
	// «Обновить»: кнопка занята, пока идёт запрос; по ответу — «Обновлено», и когда записи не изменились
	const reload = createReload(loader, () => S.refreshed && caseToast(S.refreshed));
	const { busy: reloading } = reload;
	const setHead = useHead();
	$: setHead([
		{
			id: 'refresh',
			text: S.map_refresh,
			run: () => void reload.run(),
			busy: $reloading,
			busyText: S.busy_refresh,
			testid: 'case-map-refresh'
		}
	]);
</script>

<WorkNote {state} {S} groups={SECTION_WORK.passport} />

<div class="note n" data-testid="case-passport-note">
	<Icon name="info" klass="l" />
	<div class="col g4 grow">
		<p>{S.map_passport_pointer}</p>
		{#if $answer}
			<p class="sm mut">
				{#if $answer.built}
					{fmt(S.map_passport_built_g, {
						n: $answer.built.cards,
						total: $answer.built.cards_total
					})}
					{#if $answer.built.missing}{fmt(S.map_passport_missing, {
							n: $answer.built.missing
						})}{/if}
				{:else}
					{$answer.state?.pending ? S.map_passport_building : S.map_passport_empty}
				{/if}
			</p>
		{/if}
	</div>
</div>

{#if $error && $answer}<StaleNote {S} error={$error} retry={() => loader.refresh(true)} />{/if}
{#if $error && !$answer}
	<section class="card" data-testid="case-passport-error">
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
	<section class="card g4" data-testid="case-passport-about">
		<h2 class="grouph">{S.passport_group_case}</h2>
		{#each about as f (f.key)}
			<div class="li t" data-testid="case-passport-field" data-field={f.key}>
				<div class="kv grow">
					<dt class="col g4">
						<span class="b fname">{fieldName(f)}</span>
						<!-- у пустого поля, которое задаёт юрист («Роль клиента»), вместо «Править» — кнопка «Указать роль» в
						     значении; «История» остаётся: иначе очистку поля со страницы не откатить -->
						<span class="row g4">
							{#if canWrite && !(f.lawyer_only && !f.items.length)}<button
									type="button"
									class="btn t"
									on:click={() => edit(f)}>{S.map_edit}</button
								>{/if}
							<button type="button" class="btn t" on:click={() => history(f.key)}
								>{S.map_history}</button
							>
						</span>
					</dt>
					<dd class="col g8">
						{#if !f.items.length}
							{#if f.lawyer_only}
								<div class="row g12">
									<span class="fg2">{S.map_passport_client_hint}</span>
									{#if canWrite}
										<button type="button" class="btn s" on:click={() => edit(f)}
											>{S.client_role_set}</button
										>
									{/if}
								</div>
							{:else}
								<span class="mut">{S.map_field_empty}</span>
							{/if}
						{/if}
						{#each f.items as it, n (n)}
							{@const key = `${f.key}:${n}`}
							<div class="col g6" data-testid="case-passport-item">
								<div class="row g8">
									<span class="aw" class:b={it.source === 'cards'}>{it.value}</span>
									{#if (it.documents ?? 0) > 1}<span class="sm mut"
											>{fmt(S.map_passport_in_docs, { n: it.documents })}</span
										>{/if}
									{#if it.label}<SheetRef label={it.label} href={it.url} klass="sm" />{/if}
									{#each pills(it) as p}<span class="pill t" class:w={p.warn}
											>{#if p.warn}<Icon name={p.icon ?? 'al'} />{/if}{p.text}</span
										>{/each}
									{#if it.quote}
										<button
											type="button"
											class="btn t"
											aria-expanded={opened.has(key)}
											on:click={() => flip(key)}
											>{S.quote_toggle}<Icon name={opened.has(key) ? 'u' : 'd'} /></button
										>
									{/if}
								</div>
								{#if it.quote && opened.has(key)}
									<p class="q">
										{it.quote}{#if quoteMore(it.quote_rest, S)}{' '}<span class="mut"
												>{quoteMore(it.quote_rest, S)}</span
											>{/if}
									</p>
								{/if}
								{#if it.more_places?.length}
									<p class="sm mut">
										{S.map_passport_also}
										{#each it.more_places as m, i (i)}{i ? ', ' : ''}<SheetRef
												label={m.label ?? ''}
												href={m.url}
											/>{/each}
									</p>
								{/if}
							</div>
						{/each}
						{#if f.edited}<span class="pill t" data-testid="case-passport-edited"
								>{S.map_passport_edited}</span
							>{/if}
					</dd>
				</div>
			</div>
		{/each}
		{#if canWrite && absent.length}
			<div class="row g8 li" data-testid="case-passport-add">
				<label class="lbl"
					>{S.map_passport_add_pick}<select class="in s" bind:value={adding}>
						<option value=""></option>
						{#each absent as a (a.key)}<option value={a.key}>{fieldName(a)}</option>{/each}
					</select></label
				>
				<button type="button" class="btn s" disabled={!adding} on:click={addField}
					>{S.map_passport_add}</button
				>
			</div>
		{/if}
	</section>

	{#if parties}
		<section class="card g8 tight" data-testid="case-passport-parties">
			<div class="row sp g12">
				<div class="row g12">
					<h2>{passportName(S, 'parties')}</h2>
					<span class="cnt">{parties.items.length}</span>
				</div>
				<div class="row g8">
					{#if parties.items.length > PARTIES}
						<label class="row g8 nw find"
							><Icon name="search" /><input
								class="in s"
								type="search"
								aria-label={S.parties_search_label}
								placeholder={S.parties_search}
								bind:value={search}
							/></label
						>
					{/if}
					{#if canWrite}<button
							type="button"
							class="btn t"
							on:click={() => parties && edit(parties)}>{S.map_edit}</button
						>{/if}
					<button type="button" class="btn t" on:click={() => history('parties')}
						>{S.map_history}</button
					>
				</div>
			</div>
			{#if parties.items.some((it) => it.source === 'cards')}
				<p class="xs mut">{S.map_passport_parties_hint}</p>
			{/if}
			{#if parties.items.some((it) => it.in_table)}
				<p class="xs mut" data-testid="case-passport-table-parties">
					{fmt(S.map_passport_table_parties, { n: parties.items.filter((it) => it.in_table).length })}
				</p>
			{/if}
			{#if parties.edited}<span class="pill t as">{S.map_passport_edited}</span>{/if}
			<div class="col">
				{#if !parties.items.length}<p class="mut">{S.map_field_empty}</p>{/if}
				{#if needle && !found.length}<p class="mut">{S.parties_none_found}</p>{/if}
				{#each partiesShown as it (it.value)}
					{@const key = `party:${it.value}`}
					{@const roles = it.roles ?? []}
					<div class="li t" data-testid="case-party">
						<div class="col g6 grow">
							<div class="row g8">
								<span class="b lg aw">{it.value}</span>
								{#if (it.documents ?? 0) > 1}<span class="sm mut"
										>{fmt(S.map_passport_in_docs, { n: it.documents })}</span
									>{/if}
								{#if it.label}<SheetRef label={it.label} href={it.url} klass="sm" />{/if}
								{#each pills(it) as p}<span class="pill t" class:w={p.warn}
										>{#if p.warn}<Icon name={p.icon ?? 'al'} />{/if}{p.text}</span
									>{/each}
								{#if it.quote}
									<button
										type="button"
										class="btn t"
										aria-expanded={opened.has(key)}
										on:click={() => flip(key)}
										>{S.quote_toggle}<Icon name={opened.has(key) ? 'u' : 'd'} /></button
									>
								{/if}
							</div>
							{#if it.quote && opened.has(key)}
								<p class="q">
									{it.quote}{#if quoteMore(it.quote_rest, S)}{' '}<span class="mut"
											>{quoteMore(it.quote_rest, S)}</span
										>{/if}
								</p>
							{/if}
							{#if it.more_places?.length}
								<p class="sm mut">
									{S.map_passport_also}
									{#each it.more_places as m, i (i)}{i ? ', ' : ''}<SheetRef
											label={m.label ?? ''}
											href={m.url}
										/>{/each}
								</p>
							{/if}
							{#if roles.length}
								{@const all = opened.has(`${key}:roles`) || roles.length === 1}
								<div class="{all ? 'col g4' : 'row g8'} sm fg2" data-testid="case-party-roles">
									<span class="mut">{S.map_passport_roles}</span>
									{#each all ? roles : roles.slice(0, 1) as r, i (i)}
										<span class="aw"
											>{r.value}{#if (r.documents ?? 0) > 1}{' · '}{fmt(S.map_passport_in_docs, {
													n: r.documents
												})}{/if}{#if r.label}{' — '}<SheetRef
													label={r.label}
													href={r.url}
												/>{/if}{#each r.more_places ?? [] as m}{', '}<SheetRef
													label={m.label ?? ''}
													href={m.url}
												/>{/each}</span
										>
									{/each}
									{#if !all}
										<button type="button" class="btn t" on:click={() => flip(`${key}:roles`)}
											>{fmt(S.more_n, { n: roles.length - 1 })}</button
										>
									{/if}
								</div>
							{/if}
						</div>
					</div>
				{/each}
				{#if !needle && found.length > partiesShown.length}
					<div class="li">
						<button type="button" class="btn" on:click={() => flip('parties:all')}
							>{fmt(S.show_more_n, { n: found.length - partiesShown.length })}</button
						>
						<span class="sm mut"
							>{fmt(S.shown_of, { n: partiesShown.length, total: found.length })}</span
						>
					</div>
				{/if}
			</div>
		</section>
	{/if}

	{#each lists as f (f.key)}
		{@const all = opened.has(`${f.key}:all`)}
		<section class="card g4 tight" data-testid="case-passport-field" data-field={f.key}>
			<div class="row sp g12">
				<div class="row g12">
					<h2>{fieldName(f)}</h2>
					{#if f.key === 'key_amounts'}<a class="ref sm" href={hrefOf('amounts')}
							>{S.passport_all_amounts}</a
						>{/if}
				</div>
				<div class="row g4">
					{#if canWrite}<button type="button" class="btn t" on:click={() => edit(f)}
							>{S.map_edit}</button
						>{/if}
					<button type="button" class="btn t" on:click={() => history(f.key)}
						>{S.map_history}</button
					>
				</div>
			</div>
			{#if !f.items.length}<p class="mut">{S.map_field_empty}</p>{/if}
			{#each all ? f.items : f.items.slice(0, ROWS) as it, n (n)}
				{@const key = `${f.key}:${n}`}
				<div class="li t" data-testid="case-passport-item">
					<div class="col g6 grow">
						<span class="aw">{it.value}</span>
						<div class="row g8">
							{#if it.label}<SheetRef label={it.label} href={it.url} klass="sm" />{/if}
							{#each pills(it) as p}<span class="pill t" class:w={p.warn}
									>{#if p.warn}<Icon name={p.icon ?? 'al'} />{/if}{p.text}</span
								>{/each}
							{#if it.quote}
								<button
									type="button"
									class="btn t"
									aria-expanded={opened.has(key)}
									on:click={() => flip(key)}
									>{S.quote_toggle}<Icon name={opened.has(key) ? 'u' : 'd'} /></button
								>
							{/if}
						</div>
						{#if it.quote && opened.has(key)}
							<p class="q">
								{it.quote}{#if quoteMore(it.quote_rest, S)}{' '}<span class="mut"
										>{quoteMore(it.quote_rest, S)}</span
									>{/if}
							</p>
						{/if}
						{#if it.more_places?.length}
							<p class="sm mut">
								{S.map_passport_also}
								{#each it.more_places as m, i (i)}{i ? ', ' : ''}<SheetRef
										label={m.label ?? ''}
										href={m.url}
									/>{/each}
							</p>
						{/if}
					</div>
				</div>
			{/each}
			{#if !all && f.items.length > ROWS}
				<div class="li">
					<button type="button" class="btn s" on:click={() => flip(`${f.key}:all`)}
						>{cap(fmt(S.more_n, { n: f.items.length - ROWS }))}</button
					>
				</div>
			{/if}
			{#if f.edited}<span class="pill t as">{S.map_passport_edited}</span>{/if}
		</section>
	{/each}

	{#each stateLines($answer.state, S) as t}<p class="sm mut" data-testid="case-map-state">
			{t}
		</p>{/each}
{/if}

<FormDialog
	bind:open={editOpen}
	title={editing ? fmt(S.map_passport_edit_title, { name: passportName(S, editing.key) }) : ''}
	{S}
	submit={save}
	testid="case-passport-dialog"
>
	<p class="sm mut">{S.map_passport_edit_hint}</p>
	<textarea
		class="in"
		rows={Math.max(3, (editing?.items.length ?? 0) + 1)}
		aria-label={editing ? passportName(S, editing.key) : ''}
		bind:value={editText}
	></textarea>
</FormDialog>

<HistoryDialog
	bind:open={historyOpen}
	{state}
	{S}
	entity="passport"
	id={historyKey}
	onReverted={() => loader.refresh(true)}
/>

<style>
	.grouph {
		padding-bottom: 6px;
	}
	.fname {
		color: var(--fg);
	}
	.tight {
		padding-bottom: 10px;
	}

	.find {
		position: relative;
		color: var(--muted);
	}
	.find :global(.ic) {
		position: absolute;
		left: 12px;
		top: 50%;
		transform: translateY(-50%);
		pointer-events: none;
	}
	.find input {
		width: 220px;
		padding-left: 34px;
	}
	.as {
		align-self: flex-start;
	}
	textarea {
		min-height: 96px;
		padding-top: 10px;
		padding-bottom: 10px;
		resize: vertical;
	}
	@media (max-width: 720px) {
		.find,
		.find input {
			width: 100%;
		}
	}
</style>
