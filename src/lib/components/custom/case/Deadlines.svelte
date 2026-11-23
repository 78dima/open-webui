<script lang="ts">
	import StaleNote from './StaleNote.svelte';
	// ai-dvokat: «Сроки» (макет K-deadlines; опись § 2.10): срок — черновик, пока юрист его не подтвердил; основание —
	// лист и цитата, расчёт и норма — как записаны. «Подтвердить» / «Снять подтверждение», «Править», «Убрать» /
	// «Вернуть», «Добавить срок», история и откат. Ручки `GET …/deadlines?hidden=true`, `PATCH …/deadlines/<id>`
	// (отвечает новым перечнем), `POST …/deadlines`. Перечитывается вместе с обзором, не чаще раза в 20 с и не пока
	// открыто окно. Поведение — прежний `sections/mapcore.js` (`deadlines`, `deadlineItem`, `addDeadline`).
	import { onDestroy } from 'svelte';
	import type { CaseState } from '$lib/custom/case/casestore';
	import { when } from '$lib/custom/case/casepage';
	import { useHead } from '$lib/custom/case/head';
	import { createLoader, createReload } from '$lib/custom/case/loader';
	import { SECTION_WORK, workWatcher } from '$lib/custom/case/casepage';
	import WorkNote from './WorkNote.svelte';
	import { day, deadlineDates, quoteMore } from '$lib/custom/case/mapcore';
	import { casePath, errorText, reasonText } from '$lib/custom/case/sections';
	import { fmt } from '$lib/custom/case/strings';
	import { caseToast } from '$lib/custom/case/toast';
	import FormDialog from './FormDialog.svelte';
	import HistoryDialog from './HistoryDialog.svelte';
	import Icon from './Icon.svelte';
	import QuoteText from './QuoteText.svelte';
	import ReadingMark from './ReadingMark.svelte';
	import { MARKS } from '$lib/custom/case/marks';
	import SheetRef from './SheetRef.svelte';

	export let state: CaseState;
	export let S: Record<string, any> = {};

	type Deadline = {
		id: number;
		title: string;
		state: string;
		start_date?: string | null;
		end_date?: string | null;
		hidden?: boolean;
		via?: string;
		confirmed_name?: string | null;
		confirmed_at?: string | null;
		basis: {
			label: string;
			url?: string | null;
			quote?: string | null;
			quote_rest?: number | null;
			quote_changed?: boolean;
			sheet_checks?: { code: string; reason: string }[];
			own_value?: { a: string; b: string; url?: string }[];
			quote_marks?: { start: number; end: number; a: string; b: string; hl?: string }[];
			place_base?: string | null;
		};
		calc?: string | null;
		norm?: string | null;
		norm_edition_date?: string | null;
		norm_edition_status?: string | null;
	};
	type Answer = { deadlines: Deadline[]; can_write?: boolean };

	const { data } = state;
	const loader = createLoader(
		() => state.api.get<Answer>(casePath(state, '/deadlines?hidden=true')),
		{ gap: 20000 }
	);
	const { data: answer, error } = loader;
	$: ($data, void loader.refresh());
	// работа по делу, от которой зависят записи раздела, закончилась — раздел перечитывается сразу, не дожидаясь
	// своего промежутка (пока она идёт, вверху раздела стоит строка хода `WorkNote`)
	const watchWork = workWatcher(SECTION_WORK.deadlines, () => {
		loader.touch();
		void loader.refresh();
	});
	$: watchWork($data);
	onDestroy(() => loader.stop());
	$: rows = $answer?.deadlines ?? [];
	$: canWrite = !!$answer?.can_write;

	const patch = async (id: number, body: unknown) => {
		loader.set(await state.api.request<Answer>('PATCH', casePath(state, `/deadlines/${id}`), body));
	};
	const act = (id: number, body: unknown) =>
		patch(id, body).catch((e) => caseToast(errorText(S, e), true));
	const edition = (x: Deadline) =>
		x.norm_edition_date
			? fmt(S.map_deadline_norm_edition, { date: day(x.norm_edition_date) }) +
				(x.norm_edition_status ? ` (${x.norm_edition_status})` : '')
			: S.map_deadline_norm_no_edition;

	let win: { kind: 'add' } | { kind: 'edit'; row: Deadline } | null = null;
	let winOpen = false;
	let form = { title: '', ref: '', quote: '', start: '', end: '', calc: '' };
	function show(row: Deadline | null) {
		win = row ? { kind: 'edit', row } : { kind: 'add' };
		form = {
			title: row?.title ?? '',
			ref: '',
			quote: '',
			start: row?.start_date ?? '',
			end: row?.end_date ?? '',
			calc: ''
		};
		winOpen = true;
	}
	async function save() {
		if (!win) return;
		if (win.kind === 'edit') {
			await patch(win.row.id, {
				title: form.title.trim(),
				start_date: form.start || null,
				end_date: form.end || null
			});
			return;
		}
		await state.api.post(casePath(state, '/deadlines'), {
			title: form.title.trim(),
			ref: form.ref.trim(),
			quote: form.quote.trim(),
			start_date: form.start || null,
			end_date: form.end || null,
			calc: form.calc.trim() || null
		});
		await loader.refresh(true);
	}
	let historyId: number | null = null;
	let historyOpen = false;
	$: loader.hold(winOpen || historyOpen);
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
		},
		...(canWrite
			? [
					{
						id: 'add',
						text: S.map_deadline_add,
						run: () => show(null),
						main: true,
						icon: 'plus',
						testid: 'case-deadline-add'
					}
				]
			: [])
	]);
</script>

<WorkNote {state} {S} groups={SECTION_WORK.deadlines} />

<div class="note n" data-testid="case-deadlines-note">
	<Icon name="info" klass="l" />
	<p class="grow">{S.map_deadlines_hint}</p>
</div>

{#if $error && $answer}<StaleNote {S} error={$error} retry={() => loader.refresh(true)} />{/if}
{#if $error && !$answer}
	<section class="card" data-testid="case-deadlines-error">
		<div class="col g12 as">
			<span class="pill s"
				><Icon name="al" />{fmt(S.section_error, { detail: reasonText(S, $error) })}</span
			>
			<button type="button" class="btn big" on:click={() => loader.refresh(true)}>{S.retry}</button>
		</div>
	</section>
{:else if !$answer}
	<section class="card"><p class="mut" role="status">{S.loading}</p></section>
{:else if !rows.length}
	<section class="card" data-testid="case-deadlines-empty">
		<p class="mut">{S.map_deadlines_empty}</p>
	</section>
{:else}
	{#each rows as x (x.id)}
		{@const dates = deadlineDates(x, S)}
		{@const confirmed = x.state === 'confirmed'}
		<section
			class="card g12"
			class:hid={x.hidden}
			data-testid="case-deadline"
			data-state={x.hidden ? 'hidden' : x.state}
		>
			<div class="row sp g12 as toprow">
				<div class="col g4 grow">
					<span class="b num dates" class:mut={dates.none}>{dates.text}</span>
					<h3 class="aw name">{x.title}</h3>
				</div>
				<div class="row g8">
					{#if x.hidden}
						<span class="pill">{S.deadline_hidden}</span>
					{:else if confirmed}
						<span class="pill"
							><Icon name="ok" />{fmt(S.map_deadline_confirmed, {
								who: x.confirmed_name || S.map_deadline_lawyer,
								when: when(x.confirmed_at)
							})}</span
						>
					{:else}
						<span class="pill w"><Icon name="al" />{S.map_deadline_draft}</span>
					{/if}
					<span class="sm mut"
						>{x.via === 'chat' ? S.map_deadline_via_chat : S.map_deadline_via_page}</span
					>
				</div>
			</div>
			<dl class="kv">
				<dt>{S.deadline_kv_basis}</dt>
				<dd class="col g6">
					<SheetRef label={x.basis.label} href={x.basis.url} />
					{#if x.basis.quote_changed}<span class="pill w t as" data-testid="case-quote-changed"
							><Icon name="al" />{S.quote_changed}</span
						>{/if}
					<!-- отметка срока (пакет 23.11, Д-10; общий компонент — общий приём А): расходится его дата — оба прочтения;
					     лист-основание помечен целиком -->
					<ReadingMark m={x.basis} {S} keys={MARKS.deadline} icon pillClass="as" />
					{#if x.basis.quote}
						<p class="q">
							<QuoteText
								quote={x.basis.quote}
								marks={x.basis.quote_marks}
								base={x.basis.place_base}
								{S}
							/>{#if quoteMore(x.basis.quote_rest, S)}{' '}<span class="mut"
									>{quoteMore(x.basis.quote_rest, S)}</span
								>{/if}
						</p>
					{/if}
				</dd>
				{#if x.calc}
					<dt>{S.deadline_kv_calc}</dt>
					<dd class="aw">{x.calc}</dd>
				{/if}
				{#if !x.hidden || x.norm}
					<dt>{S.deadline_kv_norm}</dt>
					{#if x.norm}<dd class="aw">{x.norm}; {edition(x)}</dd>{:else}<dd class="mut">
							{S.deadline_norm_none}
						</dd>{/if}
				{/if}
			</dl>
			<div class="row g8 sep">
				{#if canWrite}
					{#if x.hidden}
						<button type="button" class="btn" on:click={() => act(x.id, { hidden: false })}
							>{S.map_unhide}</button
						>
					{:else}
						<!-- черновик без даты окончания подтвердить нельзя (правило сервиса `deadlines._set`): вместо
						     «Подтвердить» — «Указать даты», открывает правку; дата появилась — появляется «Подтвердить» -->
						{#if !confirmed && !x.end_date}
							{#if S.map_deadline_set_dates}
								<button
									type="button"
									class="btn p"
									data-testid="case-deadline-set-dates"
									on:click={() => show(x)}>{S.map_deadline_set_dates}</button
								>
							{/if}
						{:else}
							<button
								type="button"
								class="btn"
								class:p={!confirmed}
								on:click={() => act(x.id, { confirmed: !confirmed })}
								>{confirmed ? S.map_deadline_unconfirm : S.map_deadline_confirm}</button
							>
						{/if}
						<button type="button" class="btn" on:click={() => show(x)}>{S.map_edit}</button>
						<button type="button" class="btn t" on:click={() => act(x.id, { hidden: true })}
							>{S.map_hide}</button
						>
					{/if}
				{/if}
				<button
					type="button"
					class="btn t"
					on:click={() => {
						historyId = x.id;
						historyOpen = true;
					}}>{S.map_history}</button
				>
			</div>
		</section>
	{/each}
{/if}

<FormDialog
	bind:open={winOpen}
	title={win?.kind === 'edit' ? win.row.title : S.map_deadline_add}
	{S}
	submit={save}
	testid="case-deadline-dialog"
>
	<label class="lbl"
		>{S.map_d_title}<input
			class="in"
			type="text"
			maxlength="300"
			required
			bind:value={form.title}
		/></label
	>
	{#if win?.kind === 'add'}
		<label class="lbl"
			>{S.map_d_ref}<input
				class="in"
				type="text"
				maxlength="200"
				required
				bind:value={form.ref}
			/></label
		>
		<label class="lbl"
			>{S.map_d_quote}<textarea
				class="in"
				rows="3"
				maxlength="2000"
				required
				bind:value={form.quote}
			></textarea></label
		>
	{/if}
	<div class="row g12">
		<label class="lbl grow"
			>{S.map_d_start_date}<input class="in" type="date" bind:value={form.start} /></label
		>
		<label class="lbl grow"
			>{S.map_d_end_date}<input class="in" type="date" bind:value={form.end} /></label
		>
	</div>
	{#if win?.kind === 'add'}
		<label class="lbl"
			>{S.map_d_calc}<textarea
				class="in"
				rows="2"
				maxlength="2000"
				placeholder={S.deadline_calc_placeholder}
				bind:value={form.calc}
			></textarea></label
		>
	{/if}
</FormDialog>

<HistoryDialog
	bind:open={historyOpen}
	{state}
	{S}
	entity="deadline"
	id={historyId}
	onReverted={() => loader.refresh(true)}
/>

<style>
	/* телефон: даты и название — во всю ширину, пометка состояния — строкой ниже (иначе название сжимается в столбик) */
	@media (max-width: 720px) {
		.toprow > .col {
			flex-basis: 100%;
		}
	}

	.dates {
		font-size: 20px;
	}
	.name {
		font-size: 17px;
	}

	.lbl input,
	.lbl textarea {
		min-width: 0;
		width: 100%;
	}
	.lbl.grow {
		flex-basis: 160px;
	}
	textarea {
		min-height: 84px;
		padding-top: 10px;
		padding-bottom: 10px;
		resize: vertical;
	}
</style>
