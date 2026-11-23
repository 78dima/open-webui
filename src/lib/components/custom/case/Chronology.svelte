<script lang="ts">
	import StaleNote from './StaleNote.svelte';
	// ai-dvokat: «Хронология» (макет K-chronology; опись § 2.9): события дела с датой слева, статусом и линией —
	// чтение модели; цитата — дословный текст листа под «Цитата». Фильтр в одну строку (линия, слова, лицо), период и
	// убранные — по кнопке; порции сервиса под «Показать ещё»; правка, «Убрать» / «Вернуть», история и откат.
	// «Принять» / «Снять принятие» и отбор «принятые / все» — п. 25 захода 22.11: кто и когда принял, пишет сервис.
	// Ручки `GET …/facts?…`, `PATCH …/facts/<id>`. Перечитывается вместе с обзором, не чаще раза в 20 с и не пока
	// открыто окно. Поведение — прежний `sections/mapcore.js` (`chronology`, `drawFacts`, `factItem`, `editFact`).
	import { onDestroy } from 'svelte';
	import type { CaseState } from '$lib/custom/case/casestore';
	import { useHead } from '$lib/custom/case/head';
	import { createLoader, createReload } from '$lib/custom/case/loader';
	import {
		chronologyReread,
		SECTION_WORK,
		workActive,
		workWatcher
	} from '$lib/custom/case/casepage';
	import WorkNote from './WorkNote.svelte';
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
	import { casePath, errorText, query, reasonText } from '$lib/custom/case/sections';
	import {
		dayOf,
		groupText as groupLine,
		recordsTotal,
		rowKey as rowKeyOf
	} from '$lib/custom/case/facts';
	import { fmt } from '$lib/custom/case/strings';
	import { caseToast } from '$lib/custom/case/toast';
	import FormDialog from './FormDialog.svelte';
	import HistoryDialog from './HistoryDialog.svelte';
	import Icon from './Icon.svelte';
	import Busy from './Busy.svelte';
	import SheetRef from './SheetRef.svelte';
	import FactRow from './FactRow.svelte';

	export let state: CaseState;
	export let S: Record<string, any> = {};

	type More = {
		label: string;
		url?: string | null;
		quote?: string | null;
		quote_rest?: number | null;
	};
	// строка ленты «записи из строк таблицы документа» (п. 8 захода 22.11): раскрывается выборкой по документу
	type Group = {
		group: true;
		on_check?: number;
		document_id: number | null;
		document?: string | null;
		n: number;
		date_from?: string | null;
		date_to?: string | null;
		label?: string;
	};
	type Fact = {
		id: number;
		group?: undefined;
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
		accepted?: boolean;
		near_accepted?: boolean;
		accepted_name?: string | null;
		accepted_at?: string | null;
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
		facts: (Fact | Group)[];
		total: number;
		total_records?: number;
		undated?: number;
		next_page?: number | null;
		state?: MapState | null;
		rev?: string | null;
		can_write?: boolean;
	};
	type Query = {
		chronology: string;
		person: string;
		words: string;
		date_from: string;
		date_to: string;
		hidden: boolean;
		accepted: boolean;
	};

	const { data } = state;
	// поля формы и запрос, который сейчас показан: запрос меняется по «Найти» и по выбору линии
	// отбор живёт, пока открыта страница дела (уход в другой раздел его не сбрасывает)
	const kept = state.keep('chronology', {
		form: {
			chronology: '',
			person: '',
			words: '',
			date_from: '',
			date_to: '',
			hidden: false,
			accepted: false
		} as Query,
		asked: null as Query | null
	});
	let form: Query = { ...kept.form };
	let asked: Query = { ...(kept.asked ?? form) };
	onDestroy(() => Object.assign(kept, { form: { ...form }, asked: { ...asked } }));
	let extra: (Fact | Group)[] = []; // следующие порции той же выборки
	let nextPage: number | null = null;
	let loadedPages = 1; // сколько порций сейчас показано юристу
	let shownRev = ''; // метка состояния записей хронологии от сервиса (`rev`)
	let shownAsked = ''; // сериализованный отбор, для которого показана лента
	const loader = createLoader(
		async () => {
			const askedNow = { ...asked };
			const askedKey = JSON.stringify(askedNow);
			const d = await state.api.get<Answer>(
				casePath(state, `/facts${query({ ...askedNow, groups: true })}`)
			);
			// Р-5: решение «сохранить догруженное» принимается по факту сервиса (`rev`), а не по первой порции.
			// Версия та же и отбор тот же — догруженные порции и место юриста остаются; изменилась — перечитать
			// столько же порций, сколько было загружено, сохраняя место юриста.
			// Р-5, Н-7: что перечитать — по факту сервиса (`rev`) и идущей работе групп раздела (`chronologyReread`)
			const how = chronologyReread({
				rev: d.rev,
				shownRev,
				sameAsked: askedKey === shownAsked,
				loadedPages,
				working: workActive($data, SECTION_WORK.chronology)
			});
			if (how === 'keep') return d;
			if (how === 'first') {
				const first = new Set(d.facts.map(rowKey));
				extra = extra.filter((x) => !first.has(rowKey(x)));
				const freshFirst = new Set(d.facts.filter((x) => !x.group).map((x) => (x as Fact).id));
				patched = Object.fromEntries(
					Object.entries(patched).filter(([k]) => !freshFirst.has(Number(k)))
				);
				return d;
			}
			const keepCount = askedKey === shownAsked && loadedPages > 1 ? loadedPages : 1;
			let nextExtra: (Fact | Group)[] = [];
			let nextP: number | null = d.next_page ?? null;
			let pagesGot = 1;
			const seen = new Set(d.facts.map(rowKey));
			while (pagesGot < keepCount && nextP != null) {
				const moreD = await state.api.get<Answer>(
					casePath(state, `/facts${query({ ...askedNow, groups: true, page: String(nextP) })}`)
				);
				for (const item of moreD.facts) {
					const k = rowKey(item);
					if (!seen.has(k)) {
						seen.add(k);
						nextExtra.push(item);
					}
				}
				nextP = moreD.next_page ?? null;
				pagesGot += 1;
			}
			shownAsked = askedKey;
			shownRev = d.rev ?? '';
			loadedPages = pagesGot;
			extra = nextExtra;
			nextPage = nextP;
			if (askedNow.hidden) gone = new Set(); // «с убранными» — убранные снова видны
			// свежие порции ленты — сами новее правок на месте; у строк раскрытых групп правка на месте остаётся
			const fresh = new Set(
				[...d.facts, ...nextExtra].filter((x) => !x.group).map((x) => (x as Fact).id)
			);
			patched = Object.fromEntries(Object.entries(patched).filter(([k]) => !fresh.has(Number(k))));
			return d;
		},
		{ gap: 20000 }
	);
	const { data: answer, error } = loader;
	$: ($data, void loader.refresh());
	// работа по делу, от которой зависят записи раздела, закончилась — раздел перечитывается сразу, не дожидаясь
	// своего промежутка (пока она идёт, вверху раздела стоит строка хода `WorkNote`)
	const watchWork = workWatcher(SECTION_WORK.chronology, () => {
		loader.touch();
		void loader.refresh();
	});
	$: watchWork($data);
	onDestroy(() => loader.stop());
	$: rows = [...($answer?.facts ?? []), ...extra]
		.filter((f) => f.group || !gone.has(f.id))
		.map((f) => (!f.group && patched[f.id]) || f);
	$: canWrite = !!$answer?.can_write;

	function find() {
		asked = { ...form, person: form.person.trim(), words: form.words.trim() };
		void loader.refresh(true);
	}
	const pickLine = (v: string) => {
		form.chronology = v;
		find();
	};
	const pickAccepted = (v: boolean) => {
		form.accepted = v;
		find();
	};
	let moreBusy = false;
	async function more() {
		if (nextPage == null || moreBusy) return;
		moreBusy = true;
		try {
			const d = await state.api.get<Answer>(
				casePath(state, `/facts${query({ ...asked, groups: true, page: String(nextPage) })}`)
			);
			// порция не повторяет уже показанное: состав выборки мог сдвинуться между порциями (правка, новые записи)
			const seen = new Set(rows.map(rowKey));
			extra = [...extra, ...d.facts.filter((f) => !seen.has(rowKey(f)))];
			nextPage = d.next_page ?? null;
			loadedPages += 1;
		} catch (e) {
			caseToast(errorText(S, e), true);
		} finally {
			moreBusy = false;
		}
	}

	const rowKey = (f: Fact | Group) => rowKeyOf(f);
	const groupText = (g: Group) => groupLine(g, S);

	// раскрытые группы: записи группы документа порциями до конца (ревью 22.11 Б-1), тем же видом строки, что в ленте
	type Open = { rows: Fact[]; next: number | null; busy: boolean };
	let groupRows: Record<string, Open> = {};
	async function loadGroup(g: Group, page: number) {
		const k = `g${g.document_id}`;
		const cur = groupRows[k] ?? { rows: [], next: null, busy: false };
		groupRows = { ...groupRows, [k]: { ...cur, busy: true } };
		try {
			const d = await state.api.get<Answer>(
				casePath(
					state,
					`/facts${query({
						document: String(g.document_id),
						table_group: true,
						chronology: asked.chronology,
						hidden: asked.hidden,
						page: String(page)
					})}`
				)
			);
			const seen = new Set(cur.rows.map((x) => x.id));
			const got = d.facts.filter((x): x is Fact => !x.group && !seen.has(x.id));
			groupRows = {
				...groupRows,
				[k]: { rows: [...cur.rows, ...got], next: d.next_page ?? null, busy: false }
			};
		} catch (e) {
			groupRows = { ...groupRows, [k]: { ...cur, busy: false } };
			caseToast(errorText(S, e), true);
		}
	}
	function flipGroup(g: Group) {
		const k = `g${g.document_id}`;
		if (groupRows[k]) {
			const { [k]: _gone, ...rest } = groupRows;
			groupRows = rest;
			return;
		}
		void loadGroup(g, 0);
	}

	let filterOpen = false;
	// период и «с убранными» действуют на выборку — пока они заданы (в форме или в показанном запросе), блок с ними
	// раскрыт: свёрнутый блок с действующим отбором не оставлял признака (ревью 20.11)
	$: periodSet = !!(
		form.date_from ||
		form.date_to ||
		form.hidden ||
		asked.date_from ||
		asked.date_to ||
		asked.hidden
	);
	// после действия — лента и раскрытые группы заново: принятая или правленая запись уходит из группы в ленту
	// действие над записью — запись заменяется на месте ответом сервиса (ревью 22.11 Б-1): юрист, дочитавший ленту или
	// группу до середины, остаётся там же; состав групп и счёт — при следующем обновлении ленты
	let patched: Record<number, Fact> = {};
	type Patched = { fact?: Fact };
	// убранная запись без «с убранными» уходит из ленты сразу; ответа с записью нет — лента заново, как прежде
	let gone = new Set<number>();
	const put = (r: unknown) => {
		const nf = (r as Patched | null)?.fact;
		if (!nf || typeof nf.id !== 'number') return void loader.refresh(true);
		if (nf.hidden && !asked.hidden) gone = new Set([...gone, nf.id]);
		patched = { ...patched, [nf.id]: nf };
	};
	const accept = (f: Fact) =>
		state.api
			.request('PATCH', casePath(state, `/facts/${f.id}`), { accepted: !f.accepted })
			.then(put, (e) => caseToast(errorText(S, e), true));
	const hide = (f: Fact) =>
		state.api
			.request('PATCH', casePath(state, `/facts/${f.id}`), { hidden: !f.hidden })
			.then(put, (e) => caseToast(errorText(S, e), true));

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
		const r = await state.api.request('PATCH', casePath(state, `/facts/${editing.id}`), {
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
		put(r);
	}
	let historyId: number | null = null;
	let historyOpen = false;
	$: loader.hold(editOpen || historyOpen);
	// «Обновить»: кнопка занята, пока идёт запрос; по ответу — «Обновлено», и когда записи не изменились
	const reload = createReload(loader, () => S.refreshed && caseToast(S.refreshed));
	const { busy: reloading } = reload;
	const setHead = useHead();
	$: setHead([
		{
			id: 'refresh',
			text: S.map_refresh,
			run: () => {
				shownRev = ''; // «Обновить» юриста — перечитать ленту заново
				loadedPages = 1;
				void reload.run();
			},
			busy: $reloading,
			busyText: S.busy_refresh,
			testid: 'case-map-refresh'
		}
	]);
</script>

<WorkNote {state} {S} groups={SECTION_WORK.chronology} />

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
		<div class="seg" role="group" aria-label={S.map_filter_accepted}>
			<button
				type="button"
				class:on={!form.accepted}
				aria-pressed={!form.accepted}
				on:click={() => pickAccepted(false)}>{S.map_filter_accepted_all}</button
			>
			<button
				type="button"
				class:on={form.accepted}
				aria-pressed={form.accepted}
				data-testid="case-facts-accepted"
				on:click={() => pickAccepted(true)}>{S.map_filter_accepted_only}</button
			>
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
			aria-expanded={filterOpen || periodSet}
			on:click={() => (filterOpen = !filterOpen)}
			>{S.map_filter_more}<Icon name={filterOpen || periodSet ? 'u' : 'd'} /></button
		>
		<button type="submit" class="btn s p">{S.map_find}</button>
	</div>
	{#if filterOpen || periodSet}
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

{#if $error && $answer}<StaleNote {S} error={$error} retry={() => loader.refresh(true)} />{/if}
{#if $error && !$answer}
	<section class="card" data-testid="case-facts-error">
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
	<section class="card list" data-testid="case-facts">
		<div class="col g2 totals">
			<p class="sm mut">{fmt(S.map_facts_total, { n: recordsTotal($answer) })}</p>
			{#if $answer.undated}<p class="sm mut">{fmt(S.map_undated, { n: $answer.undated })}</p>{/if}
		</div>
		{#if !rows.length}<p class="mut" data-testid="case-facts-empty">{S.map_facts_empty}</p>{/if}
		{#each rows as f (rowKey(f))}
			{#if f.group}
				<div class="li t" data-testid="case-fact-group">
					<span class="b date">{dayOf(f.date_from) || S.map_date_none}</span>
					<div class="col g6 grow body">
						<span class="b aw">{groupText(f)}</span>
						<div class="row g8 sm">
							{#if f.label}<span class="mut">{fmt(S.map_table_from, { label: f.label })}</span>{/if}
							{#if f.on_check && S.map_group_on_check}<span
									class="pill t w"
									data-testid="case-group-on-check">{fmt(S.map_group_on_check, { n: f.on_check })}</span
								>{/if}
							<button
								type="button"
								class="btn t"
								aria-expanded={!!groupRows[rowKey(f)]}
								data-testid="case-fact-group-open"
								on:click={() => f.group && flipGroup(f)}
								>{groupRows[rowKey(f)] ? S.map_table_close : S.map_table_open}<Icon
									name={groupRows[rowKey(f)] ? 'u' : 'd'}
								/></button
							>
						</div>
						{#if groupRows[rowKey(f)]}
							<div class="col sub" data-testid="case-fact-group-rows">
								{#if groupRows[rowKey(f)].busy && !groupRows[rowKey(f)].rows.length}
									<!-- группа раскрыта, первая порция ещё в пути: не пустое место, а «Загрузка…» -->
									<p class="sm mut" role="status" data-testid="case-fact-group-loading">
										{S.loading}
									</p>
								{/if}
								{#each groupRows[rowKey(f)].rows.filter((x) => !gone.has(x.id)) as r (r.id)}
									<FactRow
										f={patched[r.id] ?? r}
										{S}
										{canWrite}
										onAccept={accept}
										onEdit={edit}
										onHide={hide}
										onHistory={(x) => {
											historyId = x.id;
											historyOpen = true;
										}}
									/>
								{/each}
								{#if groupRows[rowKey(f)].next != null}
									<button
										type="button"
										class="btn as"
										disabled={groupRows[rowKey(f)].busy}
										data-testid="case-fact-group-more"
										on:click={() => f.group && loadGroup(f, groupRows[rowKey(f)].next ?? 0)}
										><Busy on={groupRows[rowKey(f)].busy} text={S.loading}
											>{fmt(S.shown_of, { n: groupRows[rowKey(f)].rows.length, total: f.n })} ·
											{S.map_show_more}</Busy
										></button
									>
								{/if}
							</div>
						{/if}
					</div>
				</div>
			{:else}
				<FactRow
					{f}
					{S}
					{canWrite}
					onAccept={accept}
					onEdit={edit}
					onHide={hide}
					onHistory={(x) => {
						historyId = x.id;
						historyOpen = true;
					}}
				/>
			{/if}
		{/each}
		{#if nextPage != null}
			<div class="li">
				<button
					type="button"
					class="btn"
					disabled={moreBusy}
					on:click={more}
					data-testid="case-facts-more"
					><Busy on={moreBusy} text={S.loading}>{S.map_show_more}</Busy></button
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
	onReverted={() => {
		patched = {};
		gone = new Set();
		groupRows = {};
		void loader.refresh(true);
	}}
/>

<style>
	.list {
		padding: 8px 24px;
	}
	form .in.grow {
		min-width: 160px;
	}

	.totals {
		padding-bottom: 8px;
	}
	.date {
		flex: 0 0 170px;
		overflow-wrap: break-word;
	}
	.sub {
		padding-left: 12px;
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
		.date {
			flex-basis: 100%;
		}
		.seg {
			width: 100%;
		}
	}
</style>
