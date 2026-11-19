<script lang="ts">
	// ai-dvokat: «Проверьте листы» (макет K-check; опись § 2.6): замечания группами по виду, группа сворачивается,
	// длинный перечень — под «Показать ещё», выбор тома. Отметки «проверено» нет — второй этап. Свёрнутое, раскрытое и
	// выбранный том — состояние компонента: обновление обзора его не сбрасывает.
	import type { CaseState } from '$lib/custom/case/casestore';
	import { checkGroups, checkVolumes, inVolume, type CheckGroup } from '$lib/custom/case/casepage';
	import { count, fmt } from '$lib/custom/case/strings';
	import Icon, { type IconName } from './Icon.svelte';
	import SheetRef from './SheetRef.svelte';

	export let state: CaseState;
	export let S: Record<string, any> = {};

	const ROWS_SHOWN = 5; // строк группы до «Показать ещё»
	const CHIPS_SHOWN = 12; // листов перечня до «ещё N»

	const { data } = state;
	$: rows = $data?.overview.check_sheets ?? [];
	$: total = Math.max($data?.check_total ?? 0, rows.length);
	$: volumes = $data?.overview.volumes ?? [];
	$: withRows = checkVolumes(rows, volumes);

	let volume: number | null = null;
	$: if (volume !== null && !withRows.some((v) => v.id === volume)) volume = null;
	$: groups = checkGroups(rows, volumes, S, volume);

	let folded = new Set<string>();
	let opened = new Set<string>();
	const flip = (set: Set<string>, key: string) => {
		const next = new Set(set);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		return next;
	};
	const cap = (s: string) => (s ? s[0].toLocaleUpperCase('ru-RU') + s.slice(1) : s);
	const title = (g: CheckGroup) => S[g.title];
	/** Пояснение группы: своё; у перечня с одной причиной — сама причина словами сервиса. */
	const hint = (g: CheckGroup) =>
		g.hint ? S[g.hint] : g.chips.length === 1 && !g.rows.length ? cap(g.chips[0].reason) : '';
	const volumeTitle = (label: string | null) => (label ? fmt(S.volume_title, { label }) : S.volume_no_label);
</script>

<div class="row sp g12" data-testid="case-check">
	<p class="md lead">{S.check_hint}</p>
	{#if withRows.length > 1}
		<select class="in s" aria-label={S.goto_volume} bind:value={volume} data-testid="case-check-volume">
			<option value={null}>{S.check_filter_all}</option>
			{#each withRows as v (v.id)}
				<option value={v.id}>{v.label ? fmt(S.check_filter_volume, { label: v.label }) : S.volume_no_label}</option>
			{/each}
		</select>
	{/if}
</div>

{#if !rows.length}
	<section class="card">
		<div class="row"><span class="pill"><Icon name="ok" />{S.check_empty}</span></div>
	</section>
{:else}
	{#if total > rows.length}
		<p class="sm mut">{fmt(S.check_shown, { n: rows.length, total })}</p>
	{/if}
	{#each groups as g (g.id)}
		{@const closed = folded.has(g.id)}
		{@const more = !opened.has(g.id)}
		{@const text = hint(g)}
		<section class="card group" class:flat={g.flat} data-testid="case-check-group" data-group={g.id}>
			<div class="row g12 as nw" class:open={!closed}>
				<span class="ico" class:n={g.flat} aria-hidden="true"><Icon name={g.icon as IconName} klass="l" /></span>
				<div class="col g2 grow">
					<div class="row g8">
						<h3>{title(g)}</h3>
						<span class="cnt">{g.countSheets ? count(g.count, S.sheets_count_forms) : g.count}</span>
					</div>
					{#if text && !closed}<p class="sm mut">{text}</p>{/if}
				</div>
				{#if !g.flat}<button
					type="button"
					class="tg"
					aria-expanded={!closed}
					aria-label={closed ? S.expand : S.collapse}
					on:click={() => (folded = flip(folded, g.id))}
				>
					<Icon name={closed ? 'd' : 'u'} klass="l" />
				</button>{/if}
			</div>

			{#if !closed}
				{#each g.chips as c (c.key)}
					{#if !(g.chips.length === 1 && !g.rows.length)}<p class="sm mut why">{cap(c.reason)}</p>{/if}
					{#each c.byVolume as bucket (bucket.volume)}
						{@const shown = opened.has(`${c.key}:${bucket.volume}`) ? bucket.sheets : bucket.sheets.slice(0, CHIPS_SHOWN)}
						<div class="row g8 sep chips">
							{#if bucket.volume}<span class="b md vol">{fmt(S.goto_volume_option, { label: bucket.volume })}:</span>{/if}
							{#each shown as s (s.page_id)}
								{#if s.url}
									<a class="chipl" href={s.url} data-sveltekit-reload title={s.label}
										>{inVolume(s.label, bucket.volume)}</a
									>
								{:else}
									<span class="chipl">{inVolume(s.label, bucket.volume)}</span>
								{/if}
							{/each}
							{#if bucket.sheets.length > shown.length}
								<button
									type="button"
									class="btn s"
									on:click={() => (opened = flip(opened, `${c.key}:${bucket.volume}`))}
									>{fmt(S.more_n, { n: bucket.sheets.length - shown.length })}</button
								>
							{/if}
						</div>
					{/each}
				{/each}

				{#if g.rows.length}
					{#if g.flat}
						{#each g.rows as r (r.key)}
							<div class="kv sep flatrow">
								<dt class="b">{volumeTitle(r.volume)}</dt>
								<dd class="md fg2">{r.detail}</dd>
							</div>
						{/each}
					{:else}
						<div class="t-chk rows">
							{#each more ? g.rows.slice(0, ROWS_SHOWN) : g.rows as r (r.key)}
								<div class="tr" class:t={!!r.note} data-testid="case-check-row">
									<span class="refs">
										{#each r.sheets as s, n (s.page_id)}{n ? ', ' : ''}<SheetRef label={s.label} href={s.url} />{/each}
										{#if !r.sheets.length}<span class="b">{r.volume ? fmt(S.goto_volume_option, { label: r.volume }) : ''}</span>{/if}
									</span>
									<span class="col g2 md fg2" class:num={r.code === 'text_disagree'}>
										<span class="aw">{r.detail}</span>
										{#if r.note}<span class="sm mut aw">{r.note}</span>{/if}
									</span>
								</div>
							{/each}
							{#if more && g.rows.length > ROWS_SHOWN}
								<div class="tr">
									<span
										><button type="button" class="btn" on:click={() => (opened = flip(opened, g.id))}
											>{fmt(S.show_more_n, { n: g.rows.length - ROWS_SHOWN })}</button
										></span
									>
								</div>
							{/if}
						</div>
					{/if}
				{/if}
			{/if}
		</section>
	{/each}
{/if}

<style>
	.lead {
		max-width: 560px;
		color: var(--muted2);
	}
	.group {
		padding: 18px 24px;
	}
	.group .open {
		padding-bottom: 12px;
	}
	.chips {
		margin-top: 0;
		padding-top: 14px;
	}
	.chips .vol {
		padding-right: 4px;
	}
	.chips + .chips {
		margin-top: 12px;
	}
	.why {
		padding: 2px 0 10px;
	}
	.rows {
		margin-bottom: -10px;
	}
	.flatrow {
		margin-top: 0;
	}
	.flatrow dt {
		color: var(--fg);
		font-size: 15px;
	}
	/* в макете столбцов три (третий — отметка «проверено», второй этап): пока её нет, замечание занимает её место */
	.rows .tr {
		grid-template-columns: 220px minmax(0, 1fr);
	}
	@media (max-width: 720px) {
		.group {
			padding: 16px;
		}
	}
</style>
