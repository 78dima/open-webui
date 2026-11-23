<script lang="ts">
	import PauseNote from './PauseNote.svelte';
	import StaleNote from './StaleNote.svelte';
	// ai-dvokat: «Таблицы и проходы» (макет K-tables; опись § 2.13): перечень проходов дела и запуск набора со
	// страницы — набор, охват (всё дело или тома), факты охвата и цена на кнопке; окно подтверждения — только если
	// цена больше 1 USD (решение владельца). Ручки `GET …/tables`, `GET …/tables/scope?preset=&volumes=`,
	// `POST …/tables`. Перечень перечитывается вместе с обзором; выбранное в форме — состояние компонента.
	// Здесь же строка «Потрачено по делу» (деньги дела — там, где их тратят). Поведение — прежний `sections/tables.js`.
	import { onDestroy } from 'svelte';
	import type { CaseState } from '$lib/custom/case/casestore';
	import { when } from '$lib/custom/case/casepage';
	import { createLoader } from '$lib/custom/case/loader';
	import { casePath, errorText, reasonText } from '$lib/custom/case/sections';
	import { fmt } from '$lib/custom/case/strings';
	import {
		coverage,
		kindWord,
		needsConfirm,
		priceText,
		scopeQuery,
		staleText,
		statusTone,
		statusWord,
		title,
		usd,
		type Sweep
	} from '$lib/custom/case/tablescore';
	import { caseToast } from '$lib/custom/case/toast';
	import { readListing, type CaseFolder } from '$lib/custom/case/mycases';
	import FormDialog from './FormDialog.svelte';
	import Icon from './Icon.svelte';

	export let state: CaseState;
	export let S: Record<string, any> = {};
	export let hrefOf: (slug: string) => string;

	type Preset = {
		name: string;
		title: string;
		page?: boolean;
		available?: boolean;
		scope_hint?: string | null;
	};
	type Scope = {
		label?: string;
		pages: number;
		documents: number;
		windows: number;
		estimate_usd: number | string | null;
		limit_usd?: number | null;
	};

	const { boot, data } = state;
	const loader = createLoader(() =>
		state.api.get<{ tables: Sweep[]; presets?: Preset[] }>(casePath(state, '/tables'))
	);
	const { data: answer, error } = loader;
	$: ($data, void loader.refresh());
	onDestroy(() => loader.stop());
	$: canWrite = !!$boot?.can_write;
	$: tables = $answer?.tables ?? [];
	// со страницы — наборы по всему делу или томам; рассчитанные на один документ и с уточнениями идут из чата
	$: presets = ($answer?.presets ?? []).filter((p) => p.available && p.page);
	$: volumeLabels = ($data?.overview.volumes ?? [])
		.map((v) => v.label)
		.filter((x): x is string => !!x);
	$: spent = $data?.spent;

	// набор и тома выбора живут, пока открыта страница дела (уход в другой раздел их не сбрасывает)
	const kept = state.keep('tables', { preset: '', volumes: [] as string[] });
	let preset = kept.preset;
	let volumes: string[] = kept.volumes;
	onDestroy(() => Object.assign(kept, { preset, volumes }));
	$: if (presets.length && !presets.some((p) => p.name === preset)) preset = presets[0].name;
	$: volumes = volumes.filter((v) => volumeLabels.includes(v));
	$: chosen = presets.find((p) => p.name === preset);

	// факты охвата и оценка цены до запуска
	// Пока оценка нового выбора не пришла, прежней цены на кнопке нет и кнопка не нажимается: запрос ушёл бы с новым
	// выбором под прежней ценой и без окна. Оценка не пришла вовсе — цена неизвестна, перед запуском своё окно.
	let scope: Scope | null = null;
	let scopeError = '';
	let estimating = false;
	let seq = 0;
	let asked = '';
	$: if (canWrite && preset && asked !== `${preset}|${volumes.join(',')}`)
		void estimate(preset, volumes);
	async function estimate(p: string, v: string[]) {
		asked = `${p}|${v.join(',')}`;
		const mine = ++seq;
		[scope, scopeError, estimating] = [null, '', true];
		try {
			const f = await state.api.get<Scope>(casePath(state, `/tables/scope${scopeQuery(p, v)}`));
			if (mine === seq) [scope, scopeError] = [f, ''];
		} catch (e) {
			if (mine === seq) [scope, scopeError] = [null, reasonText(S, e)];
		} finally {
			if (mine === seq) estimating = false;
		}
	}
	/** Цена запуска известна (оценка пришла и это число) — иначе перед запуском подтверждение. */
	$: priced = !!scope && scope.estimate_usd != null && Number.isFinite(Number(scope.estimate_usd));
	const toggleVolume = (label: string, on: boolean) =>
		(volumes = on ? [...volumes, label] : volumes.filter((v) => v !== label));

	let confirmOpen = false;
	let starting = false;
	async function start() {
		const r = await state.api.post<{ cached?: boolean }>(casePath(state, '/tables'), {
			preset,
			params: null,
			volumes
		});
		caseToast(r?.cached ? S.tables_cached : S.tables_started);
		void loader.refresh(true);
	}
	// вопрос и столбцы таблицы другого моего дела (п. 28 захода 22.11): права на дело-источник проверяет сервис
	let otherOpen = false;
	let otherCases: CaseFolder[] = [];
	let otherCase = '';
	let otherTables: {
		id: string;
		question: string;
		columns: { key: string; title?: string | null }[];
	}[] = [];
	let otherTable = '';
	async function openOther() {
		otherOpen = !otherOpen;
		if (!otherOpen || otherCases.length) return;
		try {
			otherCases = readListing(await state.api.get('api/cases')).filter(
				(c) => c.id !== state.folderId
			);
		} catch (e) {
			caseToast(errorText(S, e), true);
		}
	}
	async function pickOther() {
		otherTables = [];
		otherTable = '';
		if (!otherCase) return;
		try {
			const d = await state.api.get<{ tables: typeof otherTables }>(
				casePath(state, `/tables/from/${otherCase}`)
			);
			otherTables = d.tables;
		} catch (e) {
			caseToast(errorText(S, e), true);
		}
	}
	// запуск из другого дела — тем же путём, что набор (ревью 22.11 Б-3): оценка охвата вопросом и столбцами источника,
	// цена на кнопке, окно подтверждения при оценке больше 1 USD или без неё
	let otherScope: Scope | null = null;
	let otherConfirm = false;
	let otherBusy = false;
	async function estimateOther() {
		otherScope = null;
		if (!otherCase || !otherTable) return;
		try {
			const q = volumes.length
				? '?' + volumes.map((v) => `volumes=${encodeURIComponent(v)}`).join('&')
				: '';
			otherScope = await state.api.get<Scope>(
				casePath(state, `/tables/from/${otherCase}/${otherTable}/scope${q}`)
			);
		} catch (e) {
			caseToast(errorText(S, e), true);
		}
	}
	// охват (тома) сменился при выбранной таблице — оценка заново
	$: if (otherOpen && otherTable) void (volumes, estimateOther());
	$: otherPriced =
		!!otherScope &&
		otherScope.estimate_usd != null &&
		Number.isFinite(Number(otherScope.estimate_usd));
	async function pressOther() {
		if (otherBusy || !otherTable) return;
		if (!otherScope || (otherScope.pages && needsConfirm(otherScope.estimate_usd))) {
			otherConfirm = true;
			return;
		}
		await startOther();
	}
	async function startOther() {
		if (!otherCase || !otherTable) return;
		otherBusy = true;
		try {
			const r = await state.api.post<{ cached?: boolean }>(
				casePath(state, `/tables/from/${otherCase}/${otherTable}`),
				{ volumes }
			);
			caseToast(r?.cached ? S.tables_cached : S.tables_started);
			otherOpen = false;
			void loader.refresh(true);
		} catch (e) {
			caseToast(errorText(S, e), true);
		} finally {
			otherBusy = false;
		}
	}
	async function press() {
		if (starting || estimating) return;
		// оценки нет (не пришла или не число) либо она больше 1 USD — своё окно; читать нечего — платить не за что
		if (!scope || (scope.pages && needsConfirm(scope.estimate_usd))) {
			confirmOpen = true;
			return;
		}
		starting = true;
		try {
			await start();
		} catch (e) {
			caseToast(errorText(S, e), true);
		} finally {
			starting = false;
		}
	}
	$: startText =
		scope?.pages && priced
			? fmt(S.runs_start_usd, { usd: usd(scope.estimate_usd) })
			: S.tables_start;
	/** Готовый проход на нынешнем составе дела и нынешней версии чтения — им и пользуются: его название — ссылка,
	 *  «Открыть» у него главная (макет K-tables); у идущих, неполных и устаревших — обычная. */
	// главная кнопка «Открыть» — у последнего прохода: у прежнего (есть более новый) она обычная (пакет 23.11, Д-7)
	const current = (sw: Sweep) =>
		sw.status === 'done' && !sw.stale && !sw.reader_stale && !sw.newer;
	const percent = (sw: Sweep) =>
		sw.windows_total ? Math.round((100 * (sw.windows_done ?? 0)) / sw.windows_total) : 0;
</script>

<PauseNote {state} {S} />
<p class="md intro">{S.runs_intro}</p>

{#if $error && $answer}<StaleNote {S} error={$error} retry={() => loader.refresh(true)} />{/if}
{#if $error && !$answer}
	<section class="card" data-testid="case-tables-error">
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
	<section class="card list" data-testid="case-tables">
		{#if !tables.length}<p class="md fg2" data-testid="case-tables-empty">{S.tables_empty}</p>{/if}
		{#each tables as sw (sw.id)}
			{@const tone = statusTone(sw)}
			<div class="li t" data-testid="case-table-row">
				<div class="col g6 grow">
					<div class="row g8">
						{#if current(sw)}
							<a class="b lg aw name" href={hrefOf(`tables/${sw.id}`)} title={title(sw)}
								>{title(sw)}</a
							>
						{:else}
							<span class="b lg aw name" title={title(sw)}>{title(sw)}</span>
						{/if}
						<span class="pill t">{kindWord(sw, S)}</span>
						<span class="pill t {tone}"
							><Icon name={tone === 'i' ? 'clock' : tone ? 'al' : 'ok'} />{statusWord(sw, S)}</span
						>
						{#if sw.parent}<span class="pill t">{S.tables_parent}</span>{/if}
						{#if sw.newer && S.runs_prior_pill}<span class="pill t" data-testid="case-table-prior"
								>{S.runs_prior_pill}</span
							>{/if}
					</div>
					{#if sw.status === 'running'}
						<div class="bar run" aria-hidden="true"><i style:width="{percent(sw)}%"></i></div>
					{/if}
					{#if sw.title}<p class="sm fg2 aw">
							{fmt(S.tables_question, { question: sw.question })}
						</p>{/if}
					<p class="sm mut">
						{when(sw.created_at)} · {coverage(sw, S)}{#if sw.found != null}{' '}{fmt(
								S.tables_findings_total,
								{
									n: sw.found
								}
							)}{/if}
					</p>
					{#if sw.stale}<div class="note" data-testid="case-table-stale">
							<Icon name="al" klass="l" />
							<p class="sm">{staleText(sw, S)}</p>
						</div>{/if}
					{#if sw.reader_stale}
						<div class="note">
							<Icon name="al" klass="l" />
							<p class="sm">{S.tables_reader_stale}</p>
						</div>
					{/if}
					{#if sw.newer}
						<p class="sm">
							<a class="ref" href={hrefOf(`tables/${sw.newer}`)} data-testid="case-table-newer"
								>{S.runs_newer_open || S.tables_newer}</a
							>
						</p>
					{/if}
				</div>
				<a
					class="btn s"
					class:p={current(sw)}
					href={hrefOf(`tables/${sw.id}`)}
					data-testid="case-table-open">{S.tables_open}</a
				>
			</div>
		{/each}
	</section>

	{#if canWrite && presets.length}
		<section class="card g16" data-testid="case-tables-new">
			<h2>{S.tables_new}</h2>
			<fieldset>
				<legend>{S.tables_preset}</legend>
				<div class="row g6">
					{#each presets as p (p.name)}
						<label class="opt" class:on={preset === p.name}
							><input
								type="radio"
								name="case-table-preset"
								value={p.name}
								bind:group={preset}
							/>{p.title}</label
						>
					{/each}
				</div>
				{#if chosen?.scope_hint}<p class="sm mut hint">
						{fmt(S.tables_hint, { hint: chosen.scope_hint })}
					</p>{/if}
			</fieldset>
			{#if volumeLabels.length}
				<fieldset>
					<legend>{S.tables_scope}</legend>
					<div class="row g16">
						{#each volumeLabels as label (label)}
							<label class="chk"
								><input
									type="checkbox"
									checked={volumes.includes(label)}
									on:change={(ev) => toggleVolume(label, ev.currentTarget.checked)}
								/>{fmt(S.tables_volume, { label })}</label
							>
						{/each}
					</div>
				</fieldset>
			{/if}
			<div class="row sp g12 sep go">
				<p class="md fg2 scope" aria-live="polite" data-testid="case-tables-scope">
					{#if scopeError}{scopeError}{:else if !scope}{S.loading}{:else if !scope.pages}{S.tables_estimate_none}{:else}{fmt(
							S.runs_scope_facts,
							{ documents: scope.documents, pages: scope.pages, windows: scope.windows }
						)}{/if}
				</p>
				<button
					type="button"
					class="btn big p"
					disabled={starting || estimating}
					on:click={press}
					data-testid="case-tables-start">{startText}</button
				>
			</div>
			<div class="col g8 sep other" data-testid="case-tables-other">
				<button type="button" class="btn t as wrap" aria-expanded={otherOpen} on:click={openOther}
					>{S.tables_from_other}<Icon name={otherOpen ? 'u' : 'd'} /></button
				>
				{#if otherOpen}
					<div class="row g8">
						<label class="lbl"
							>{S.tables_from_other_case}<select
								class="in s"
								bind:value={otherCase}
								on:change={pickOther}
							>
								<option value=""></option>
								{#each otherCases as c (c.id)}<option value={c.id}
										>{c.title || S.folder_untitled}</option
									>{/each}
							</select></label
						>
						{#if otherTables.length}
							<label class="lbl"
								>{S.tables_from_other_table}<select class="in s" bind:value={otherTable}>
									<option value=""></option>
									{#each otherTables as t (t.id)}<option value={t.id}
											>{t.question} ({t.columns.map((c) => c.title || c.key).join(', ')})</option
										>{/each}
								</select></label
							>
						{:else if otherCase}<span class="sm mut">{S.tables_from_other_none}</span>{/if}
						<button
							type="button"
							class="btn s"
							disabled={!otherTable || otherBusy}
							data-testid="case-tables-other-start"
							on:click={pressOther}
							>{otherScope?.pages && otherPriced
								? fmt(S.runs_start_usd, { usd: usd(otherScope.estimate_usd) })
								: S.tables_from_other_start}</button
						>
					</div>
					<p class="xs mut">{S.tables_from_other_hint}</p>
				{/if}
			</div>
		</section>
	{/if}
{/if}

{#if spent}
	<p class="sm mut" data-testid="case-spent">
		{fmt(S.spent_line, { processing: usd(spent.processing), work: usd(spent.work) })}
	</p>
{/if}

<FormDialog
	bind:open={otherConfirm}
	title={S.runs_confirm_title}
	{S}
	submit={startOther}
	submitText={otherScope?.pages && otherPriced
		? fmt(S.runs_start_usd, { usd: usd(otherScope.estimate_usd) })
		: S.runs_start_no_price}
	testid="case-tables-other-confirm"
>
	{#if otherScope?.pages}<p class="md">
			{fmt(S.runs_scope_facts, {
				documents: otherScope.documents,
				pages: otherScope.pages,
				windows: otherScope.windows
			})}
		</p>{/if}
	<p class="md bb">
		{otherPriced && otherScope
			? priceText(S, otherScope.estimate_usd, otherScope.limit_usd)
			: S.runs_confirm_no_price}
	</p>
</FormDialog>

<FormDialog
	bind:open={confirmOpen}
	title={S.runs_confirm_title}
	{S}
	submit={start}
	submitText={scope?.pages && priced ? startText : S.runs_start_no_price}
	testid="case-tables-confirm"
>
	{#if !scope || !priced}
		<!-- цена неизвестна: оценка не пришла — об этом сказано прямо -->
		<p class="md">{chosen?.title ?? ''}</p>
		<p class="md bb" data-testid="case-tables-confirm-price">{S.runs_confirm_no_price}</p>
	{:else}
		<p class="md">
			{fmt(S.runs_confirm_scope, {
				title: chosen?.title ?? '',
				label: scope.label ?? '',
				documents: scope.documents,
				pages: scope.pages
			})}
		</p>
		<p class="md bb">
			{priceText(S, scope.estimate_usd, scope.limit_usd)}
		</p>
	{/if}
</FormDialog>

<style>
	/* выбор дела и таблицы: длинный вопрос таблицы не раздвигает карточку */
	.other :global(.lbl),
	.other select {
		max-width: 100%;
		min-width: 0;
	}
	/* длинная подпись «Взять вопрос и столбцы…» на телефоне переносится, а не уходит вбок */
	.btn.wrap {
		white-space: normal;
		text-align: left;
		max-width: 100%;
		height: auto;
	}
	.list {
		padding: 10px 24px;
	}
	.run {
		max-width: 420px;
	}
	.go {
		margin-top: 0;
	}
	.scope {
		max-width: 520px;
	}

	.intro {
		max-width: 720px;
		color: var(--muted2);
	}
	.name {
		color: inherit;
		text-decoration: none;
		/* длинное название (вопрос прохода-«находки») — две строки с многоточием; целиком — в подсказке и в самой таблице */
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
		flex: 1 1 100%;
		max-width: max-content;
	}
	.note {
		padding: 10px 12px;
	}
	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
		min-width: 0;
	}
	legend {
		padding: 0 0 8px;
		font-size: 13px;
		color: var(--muted);
	}
	.hint {
		padding-top: 8px;
	}
	.li:first-child {
		border-top: 0;
	}
</style>
