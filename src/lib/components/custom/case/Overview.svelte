<script lang="ts">
	import { reasonText } from '$lib/custom/case/sections';
	// ai-dvokat: «Обзор» дела (макеты K-overview, K-status, K-marks): шапка из паспорта, состояние и ход обработки,
	// три плитки, ближайшие сроки, состав дела, пометка о распознавании. Денег в обзоре нет (решение владельца).
	// Данные — ответ обзора сервиса (его переспрашивает общий макет дела) и раздел паспорта; слова — строки сервиса.
	import { onDestroy } from 'svelte';
	import type { CaseState } from '$lib/custom/case/casestore';
	import {
		ecaseFiles,
		filesState,
		fileStuck,
		sectionOpen,
		since,
		summary,
		usd,
		volumeState,
		waitReasonsText,
		when,
		workParts,
		WORK_PROCESSING,
		type State,
		type Tone
	} from '$lib/custom/case/casepage';
	import { day } from '$lib/custom/case/mycases';
	import { count, fmt, plural } from '$lib/custom/case/strings';
	import Icon, { type IconName } from './Icon.svelte';
	import SheetRef from './SheetRef.svelte';

	export let state: CaseState;
	export let S: Record<string, any> = {};
	export let hrefOf: (slug: string) => string;

	const { boot, data, stale } = state;
	$: b = $boot!;
	$: d = $data;
	$: sum = d ? summary(d) : null;
	$: ov = d?.overview;
	$: volumes = ov?.volumes ?? [];
	$: loose = ov?.files_without_volume ?? [];
	$: blocked = loose.filter((f) => f.status === 'blocked').length;
	$: ecase = d ? ecaseFiles(d) : [];
	$: uploads = d?.uploads ?? [];
	$: failed = uploads.filter((u) => u.phase === 'failed' || u.phase === 'intake_failed').length;
	$: pending = volumes.some((v) => v.status !== 'inventory_ready');
	$: paused = sum?.paused ?? null;
	$: pausedText = paused ? cap(fmt(S[paused.key], { time: when(paused.since) })) : '';
	$: percent = sum && sum.total ? Math.round((100 * sum.indexed) / sum.total) : 0;
	// что сейчас в очереди и в работе по делу (поле `work` сервиса) — словами, под ходом распознавания
	$: workLine =
		d?.work && S.overview_work_line
			? workParts(d.work, WORK_PROCESSING, S).join(', ')
			: '';

	const TONE: Record<Tone, string> = { plain: '', info: 'i', warn: 'w', stop: 's' };
	const ICON: Record<Tone, IconName> = { plain: 'ok', info: 'clock', warn: 'al', stop: 'al' };
	const text = (s: State) => fmt(S[s.key], s.vars ?? {});
	const cap = (s: string) => (s ? s[0].toLocaleUpperCase('ru-RU') + s.slice(1) : s);
	/** Строка с подстановкой, в которую вставляется ссылка: части до и после `{имя}`. */
	const around = (template: unknown, name: string) => {
		const [before, after = ''] = String(template ?? '').split(`{${name}}`);
		return { before, after };
	};

	// ---- шапка дела из паспорта (раздел паспорта сервиса; перечитывается не чаще раза в 20 с, как на прежней странице) ----
	type Place = {
		value: string;
		label?: string;
		url?: string;
		handwritten?: number;
		records?: number;
	};
	type Party = Place & { roles?: { value: string }[] };
	let head: { numbers: Place[]; courts: Place[]; parties: Party[] } | null = null;
	let headAt = 0;
	let gone = false;
	async function loadHead() {
		headAt = Date.now();
		try {
			const p = await state.api.get<{ fields?: { key: string; items?: Party[] }[] }>(
				`api/cases/${encodeURIComponent(state.folderId)}/passport`
			);
			if (gone) return;
			const of = (key: string) => (p?.fields ?? []).find((f) => f.key === key)?.items ?? [];
			head = { numbers: of('case_number'), courts: of('court'), parties: of('parties') };
		} catch {
			/* шапка из паспорта — дополнение: обзор работает и без неё */
		}
	}
	// с каждым приходом обзора, но не чаще раза в 20 с: паспорт строится после распознавания и версию дела не меняет,
	// поэтому по одной версии его не поймать — страница, открытая во время обработки, осталась бы без шапки
	$: if (d && sectionOpen('passport', b) && Date.now() - headAt > 20000) void loadHead();
	onDestroy(() => (gone = true));
	$: hasHead =
		!!head && (head.numbers.length > 0 || head.courts.length > 0 || head.parties.length > 0);
</script>

{#if hasHead && head}
	<section class="col g8" data-testid="case-head">
		<dl class="kv">
			{#if head.numbers.length}
				{@const it = head.numbers[0]}
				<dt>{S.map_pf_case_number}</dt>
				<dd class="row g8">
					<span class="b aw">{it.value}</span>
					{#if it.label}<SheetRef label={it.label} href={it.url} klass="sm" />{/if}
					{#if it.handwritten}
						<span class="pill w t"
							><Icon name="pen" />{it.records && it.handwritten < it.records
								? fmt(S.map_passport_handwritten_some, { n: it.handwritten, m: it.records })
								: S.map_passport_handwritten}</span
						>
					{/if}
					{#if head.numbers.length > 1}
						<a class="sm mut" href={hrefOf('passport')}
							>{count(head.numbers.length - 1, S.overview_head_more_numbers_forms)}</a
						>
					{/if}
				</dd>
			{/if}
			{#if head.courts.length}
				{@const it = head.courts[0]}
				<dt>{S.map_pf_court}</dt>
				<dd class="row g8">
					<span class="aw">{it.value}</span>
					{#if it.label}<SheetRef label={it.label} href={it.url} klass="sm" />{/if}
					{#if head.courts.length > 1}
						<a class="sm mut" href={hrefOf('passport')}
							>{count(head.courts.length - 1, S.overview_head_more_records_forms)}</a
						>
					{/if}
				</dd>
			{/if}
			{#if head.parties.length}
				<dt>{S.overview_head_parties}</dt>
				<dd class="col g2">
					{#each head.parties.slice(0, 3) as it, n (n)}
						<span class="aw"
							>{it.value}{it.roles?.[0]?.value ? ` — ${it.roles[0].value}` : ''}
							{#if it.label}<SheetRef label={it.label} href={it.url} klass="sm" />{/if}</span
						>
					{/each}
					<a class="sm ref" href={hrefOf('passport')}
						>{fmt(S.overview_head_all_parties, { n: head.parties.length })}</a
					>
				</dd>
			{/if}
		</dl>
		<p class="xs mut">{S.overview_head_note}</p>
	</section>
{/if}

{#if !d || !sum}
	<section class="card" data-testid="case-summary" data-state={$stale ? 'error' : 'loading'}>
		{#if $stale}
			<div class="col g12 as">
				<span class="pill s"
					><Icon name="al" />{$stale.kind === 'network'
						? S.overview_state_offline
						: fmt(S.section_error, { detail: reasonText(S, $stale) })}</span
				>
				<button type="button" class="btn big" on:click={() => state.refresh()}>{S.retry}</button>
			</div>
		{:else}
			<p class="mut" role="status">{S.loading}</p>
		{/if}
	</section>
{:else}
	{#if $stale}
		<section class="card" data-testid="case-offline">
			<div class="col g12 as">
				<span class="pill s"
					><Icon name="al" />{$stale.kind === 'network'
						? S.overview_state_offline
						: fmt(S.section_error, { detail: reasonText(S, $stale) })}</span
				>
				<h2 class="big">{S.overview_offline_title}</h2>
				<p class="md soft">{S.overview_offline_text}</p>
				<button type="button" class="btn big" on:click={() => state.refresh()}
					>{S.overview_retry_now}</button
				>
			</div>
		</section>
	{/if}

	<section class="card" data-testid="case-summary" data-state={sum.kind}>
		<div class="row g20 sp">
			<div class="col g12 as lead">
				{#if sum.kind !== 'empty'}
					<div class="row g8">
						{#if sum.kind === 'ready'}
							<span class="pill"><Icon name="ok" />{S.overview_state_ready}</span>
						{:else if sum.kind === 'waiting'}
							<span class="pill" data-testid="case-state-waiting">{S.overview_state_waiting}</span>
						{:else if paused && paused.self}
							<span class="pill w"
								><Icon name="pause" />{fmt(S.overview_state_paused, {
									time: since(paused.since)
								})}</span
							>
						{:else if paused}
							<span class="pill s"><Icon name="al" />{S.overview_state_stopped}</span>
						{:else}
							<span class="pill i"><Icon name="clock" />{S.overview_state_processing}</span>
						{/if}
						{#if !b.can_write}<span class="pill ro"><Icon name="lock" />{S.access_readonly}</span
							>{/if}
					</div>
				{/if}
				{#if sum.kind === 'empty'}
					<h2 class="big">{S.overview_empty_title}</h2>
					<p class="md soft">{S.overview_empty_text}</p>
				{:else if sum.kind === 'ready'}
					{#if sum.total}
						<h2 class="big">
							{fmt(plural(sum.total, S.overview_all_recognized_forms), { n: sum.total })}
						</h2>
					{/if}
					<p class="md soft">
						{fmt(S.overview_ready_line, {
							volumes: count(sum.volumes, S.volumes_forms),
							documents: count(sum.documents, S.documents_forms)
						})}{sum.checks
							? ` ${fmt(S.overview_ready_check, { checks: count(sum.checks, S.overview_tile_check_forms) })}`
							: ''}
					</p>
				{:else if sum.kind === 'waiting'}
					{#if sum.total && sum.indexed < sum.total}
						<h2 class="big">{fmt(S.overview_recognized, { n: sum.indexed, m: sum.total })}</h2>
					{:else if sum.total}
						<h2 class="big">
							{fmt(plural(sum.total, S.overview_all_recognized_forms), { n: sum.total })}
						</h2>
					{/if}
					{#if S.work_waiting_line}
						<p class="md soft" data-testid="case-work-waiting">
							{fmt(S.work_waiting_line, { reason: waitReasonsText(d.work, S) })}
						</p>
					{/if}
				{:else}
					{#if sum.total}
						<h2 class="big">{fmt(S.overview_recognized, { n: sum.indexed, m: sum.total })}</h2>
						<div class="bar wide" aria-hidden="true">
							<i class:off={!!paused} style:width="{percent}%"></i>
						</div>
					{/if}
					{#if workLine}
						<p class="md soft" data-testid="case-work-line">
							{fmt(d.work?.stalled && S.work_stalled ? S.work_stalled : S.overview_work_line, {
								parts: workLine
							})}
						</p>
					{/if}
					<p class="md soft">{paused ? pausedText : S.overview_can_close}</p>
				{/if}
				{#if sum.kind !== 'empty' && !b.can_write}<p class="md soft">
						{S.overview_readonly_text}
					</p>{/if}
				{#if sum.kind === 'ready' && (sum.checks || b.can_write)}
					<div class="row g8 acts">
						{#if sum.checks && sectionOpen('check', b)}
							<a class="btn big p" href={hrefOf('check')}>{S.overview_check_btn}</a>
						{/if}
						{#if b.can_write}<a class="btn big" href={hrefOf('upload')}>{S.overview_upload_more}</a
							>{/if}
					</div>
				{/if}
				{#if sum.kind === 'empty' && b.can_write}
					<a class="btn big p" href={hrefOf('upload')}><Icon name="up" />{S.section_upload}</a>
				{/if}
			</div>
			{#if sum.kind === 'processing' && b.can_write}
				<a class="btn big p" href={hrefOf('upload')}><Icon name="up" />{S.section_upload}</a>
			{/if}
		</div>
	</section>

	{#if sum.kind === 'ready' && paused}
		<div class="note" class:s={!paused.self} data-testid="case-paused-note">
			<Icon name={paused.self ? 'pause' : 'al'} klass="l" />
			<p>{pausedText}</p>
		</div>
	{/if}

	{#if sum.kind !== 'empty'}
		<div class="tiles" data-testid="case-tiles">
			{#if sectionOpen('check', b)}
				<a class="tile" href={hrefOf('check')}
					><span class="chip" aria-hidden="true"><Icon name="list" klass="l" /></span><span
						class="col"
						><span class="l">{S.section_check}</span><span class="row g8 ab"
							><span class="v">{sum.checks}</span><span class="l"
								>{plural(sum.checks, S.overview_tile_check_forms)}</span
							></span
						></span
					></a
				>
			{/if}
			{#if sectionOpen('volumes', b)}
				<a class="tile b" href={hrefOf('volumes')}
					><span class="chip" aria-hidden="true"><Icon name="vol" klass="l" /></span><span
						class="col"
						><span class="l">{S.files_without_volume}</span><span class="row g8 ab"
							><span class="v">{loose.length}</span>{#if loose.length}<span class="l"
									>{S.overview_tile_loose_note}</span
								>{/if}</span
						></span
					></a
				>
			{/if}
			{#if b.can_write}
				<a class="tile c" href={hrefOf('upload')}
					><span class="chip" aria-hidden="true"><Icon name="up" klass="l" /></span><span
						class="col"
						><span class="l">{S.overview_tile_uploads}</span><span class="row g8 ab"
							><span class="v">{uploads.length}</span>{#if failed}<span class="l"
									>{count(failed, S.overview_tile_uploads_failed_forms)}</span
								>{/if}</span
						></span
					></a
				>
			{/if}
		</div>
	{/if}

	{#if d.deadlines_next?.length}
		{@const basis = around(S.map_deadline_basis, 'label')}
		<section class="card" data-testid="case-deadlines">
			<div class="row sp g8 cardhead">
				<h2>{S.overview_deadlines}</h2>
				<a class="ref sm" href={hrefOf('deadlines')}>{S.overview_deadlines_all}</a>
			</div>
			{#each d.deadlines_next as dl (dl.id)}
				<div class="li t">
					<span class="b num nob until">{fmt(S.map_deadline_end, { b: day(dl.end_date) })}</span>
					<span class="col g4 grow"
						><span class="b aw">{dl.title}</span>{#if dl.basis?.label}<span class="sm mut"
								>{basis.before}<SheetRef
									label={dl.basis.label}
									href={dl.basis.url}
								/>{basis.after}</span
							>{/if}</span
					>
					{#if dl.state === 'confirmed'}
						<span class="pill"
							><Icon name="ok" />{fmt(S.map_deadline_confirmed, {
								who: dl.confirmed_name || S.map_deadline_lawyer,
								when: day(dl.confirmed_at)
							})}</span
						>
					{:else}
						<span class="pill w"><Icon name="al" />{S.map_deadline_draft}</span>
					{/if}
				</div>
			{/each}
		</section>
	{/if}

	{#if sum.kind !== 'empty'}
		<section class="card comp" data-testid="case-composition">
			<h2 class="comphead">{S.overview_composition}</h2>
			<div class="t-comp">
				{#each volumes as v (v.id)}
					{@const st = volumeState(v)}
					<div class="tr" data-testid="case-comp-volume">
						<span class="b lg aw"
							>{v.label ? fmt(S.volume_title, { label: v.label }) : S.volume_no_label_g}</span
						>
						<span
							><span class="pill {TONE[st.tone]}"><Icon name={ICON[st.tone]} />{text(st)}</span
							></span
						>
						<span class="md fg2"
							>{count(v.pages ?? 0, S.pages_forms)}{v.range?.first
								? ` · ${fmt(v.status === 'reading' || v.status === 'receiving' ? S.overview_comp_range_sofar : S.volume_range, v.range)}`
								: ''}</span
						>
						<a class="ref sm end" href={hrefOf('volumes')}>{S.overview_to_volume}</a>
					</div>
				{/each}
				{#if loose.length}
					<div class="tr" data-testid="case-comp-loose">
						<span class="b lg">{S.files_without_volume}</span>
						<span><span class="pill w"><Icon name="al" />{S.overview_tile_loose_note}</span></span>
						<span class="md fg2"
							>{count(loose.length, S.files_forms)} — {S.overview_comp_loose}{blocked
								? `; ${count(blocked, S.overview_comp_blocked_forms)}`
								: ''}</span
						>
						<a class="ref sm end" href={hrefOf('volumes')}>{S.overview_to_volumes}</a>
					</div>
				{/if}
				{#if ecase.length}
					{@const st = filesState(ecase)}
					<div class="tr" data-testid="case-comp-ecase">
						<span class="b lg">{S.section_ecase}</span>
						<span
							><span class="pill {TONE[st.tone]}"><Icon name={ICON[st.tone]} />{text(st)}</span
							></span
						>
						<span class="md fg2"
							>{count(ecase.length, S.files_forms)} · {count(
								ecase.reduce((a, f) => a + (f.pages ?? 0), 0),
								S.pages_forms
							)}{ecase.some(fileStuck)
								? `; ${count(ecase.filter(fileStuck).length, S.overview_comp_blocked_forms)}`
								: ''}</span
						>
						<a class="ref sm end" href={hrefOf('volumes')}>{S.overview_to_volumes}</a>
					</div>
				{/if}
				{#if sectionOpen('inventory', b)}
					<div class="tr" data-testid="case-comp-inventory">
						<span class="b lg">{S.section_inventory}</span>
						<span></span>
						<span class="md fg2"
							>{count(sum.documents, S.documents_forms)}{pending
								? `; ${S.overview_comp_inventory_pending}`
								: ''}</span
						>
						<a class="ref sm end" href={hrefOf('inventory')}>{S.overview_to_inventory}</a>
					</div>
				{/if}
			</div>
			{#if volumes.length}<p class="sm soft compnote" data-testid="case-pages-note">
					{S.overview_pages_note}
				</p>{/if}
		</section>
	{/if}

	{#if ov?.case?.engine_note}
		<div class="note" data-testid="case-engine-note">
			<Icon name="eye" klass="l" />
			<p>{S.case_engine_note}</p>
		</div>
	{/if}

	{#if d.estimate?.usd != null || (d.spent && !b.sections.includes('tables'))}
		<div class="col g4" data-testid="case-overview-money">
			{#if d.estimate?.usd != null}
				<p class="sm mut" data-testid="case-upload-estimate">
					{fmt(S.upload_estimate, { usd: usd(d.estimate.usd), pages: d.estimate.pages })}
					{S.upload_estimate_hint}
				</p>
			{/if}
			{#if d.spent && !b.sections.includes('tables')}
				<p class="sm mut" data-testid="case-spent">
					{fmt(S.spent_line, {
						processing: usd(d.spent.processing),
						work: usd(d.spent.work)
					})}
				</p>
			{/if}
			{#if d.until_pause}
				<p class="sm mut" data-testid="case-until-pause">
					{fmt(S.until_pause_line, { usd: usd(d.until_pause.usd) })}
				</p>
			{/if}
		</div>
	{/if}
{/if}

<style>
	.lead {
		flex: 1 1 420px;
		min-width: 0;
	}
	h2.big {
		font-size: 24px;
	}
	.soft {
		color: var(--muted2);
	}
	.bar.wide {
		align-self: stretch;
	}
	.acts {
		margin-top: 4px;
	}
	.cardhead {
		padding-bottom: 6px;
	}
	.until {
		flex: 0 0 130px;
	}
	.comp {
		padding-bottom: 8px;
	}
	.comphead {
		padding-bottom: 12px;
	}
	.compnote {
		padding: 10px 0 6px;
	}
	.end {
		justify-self: end;
	}
</style>
