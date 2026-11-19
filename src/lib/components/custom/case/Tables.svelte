<script lang="ts">
	// ai-dvokat: «Таблицы и проходы» (макет K-tables; опись § 2.13): перечень проходов дела и запуск набора со
	// страницы — набор, охват (всё дело или тома), факты охвата и цена на кнопке; окно подтверждения — только если
	// цена больше 1 USD (решение владельца). Ручки `GET …/tables`, `GET …/tables/scope?preset=&volumes=`,
	// `POST …/tables`. Перечень перечитывается вместе с обзором; выбранное в форме — состояние компонента.
	// Здесь же строка «Потрачено по делу» (деньги дела — там, где их тратят). Поведение — прежний `sections/tables.js`.
	import { onDestroy } from 'svelte';
	import type { CaseState } from '$lib/custom/case/casestore';
	import { when } from '$lib/custom/case/casepage';
	import { createLoader } from '$lib/custom/case/loader';
	import { casePath, errorText } from '$lib/custom/case/sections';
	import { fmt } from '$lib/custom/case/strings';
	import {
		coverage,
		kindWord,
		needsConfirm,
		scopeQuery,
		statusTone,
		statusWord,
		title,
		usd,
		type Sweep
	} from '$lib/custom/case/tablescore';
	import { caseToast } from '$lib/custom/case/toast';
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

	let preset = '';
	let volumes: string[] = [];
	$: if (presets.length && !presets.some((p) => p.name === preset)) preset = presets[0].name;
	$: volumes = volumes.filter((v) => volumeLabels.includes(v));
	$: chosen = presets.find((p) => p.name === preset);

	// факты охвата и оценка цены до запуска
	let scope: Scope | null = null;
	let scopeError = '';
	let seq = 0;
	let asked = '';
	$: if (canWrite && preset && asked !== `${preset}|${volumes.join(',')}`)
		void estimate(preset, volumes);
	async function estimate(p: string, v: string[]) {
		asked = `${p}|${v.join(',')}`;
		const mine = ++seq;
		try {
			const f = await state.api.get<Scope>(casePath(state, `/tables/scope${scopeQuery(p, v)}`));
			if (mine === seq) [scope, scopeError] = [f, ''];
		} catch (e) {
			if (mine === seq) [scope, scopeError] = [null, (e as Error).message];
		}
	}
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
		void state.refresh();
	}
	async function press() {
		if (starting) return;
		if (scope?.pages && needsConfirm(scope.estimate_usd)) {
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
	$: startText = scope?.pages
		? fmt(S.runs_start_usd, { usd: usd(scope.estimate_usd) })
		: S.tables_start;
	/** Готовый проход на нынешнем составе дела и нынешней версии чтения — им и пользуются: его название — ссылка,
	 *  «Открыть» у него главная (макет K-tables); у идущих, неполных и устаревших — обычная. */
	const current = (sw: Sweep) => sw.status === 'done' && !sw.stale && !sw.reader_stale;
	const percent = (sw: Sweep) =>
		sw.windows_total ? Math.round((100 * (sw.windows_done ?? 0)) / sw.windows_total) : 0;
</script>

<p class="md intro">{S.runs_intro}</p>

{#if $error && !$answer}
	<section class="card" data-testid="case-tables-error">
		<div class="col g12 as">
			<span class="pill s"><Icon name="al" />{fmt(S.section_error, { detail: $error })}</span>
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
					{#if sw.stale}<div class="note">
							<Icon name="al" klass="l" />
							<p class="sm">{S.tables_stale}</p>
						</div>{/if}
					{#if sw.reader_stale}
						<div class="note">
							<Icon name="al" klass="l" />
							<p class="sm">{S.tables_reader_stale}</p>
						</div>
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
					disabled={starting}
					on:click={press}
					data-testid="case-tables-start">{startText}</button
				>
			</div>
		</section>
	{/if}
{/if}

{#if spent}
	<p class="sm mut" data-testid="case-spent">
		{fmt(S.spent_line, { processing: spent.processing, work: spent.work })}
	</p>
{/if}

<FormDialog
	bind:open={confirmOpen}
	title={S.runs_confirm_title}
	{S}
	submit={start}
	submitText={startText}
	testid="case-tables-confirm"
>
	{#if scope}
		<p class="md">
			{fmt(S.runs_confirm_scope, {
				title: chosen?.title ?? '',
				label: scope.label ?? '',
				documents: scope.documents,
				pages: scope.pages
			})}
		</p>
		<p class="md bb">{fmt(S.runs_confirm_price, { usd: usd(scope.estimate_usd) })}</p>
	{/if}
</FormDialog>

<style>
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
