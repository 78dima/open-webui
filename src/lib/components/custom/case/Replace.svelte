<script lang="ts">
	import StaleNote from './StaleNote.svelte';
	// ai-dvokat: «Замена тома» (макет K-replace; опись § 2.12): чем повторно загруженный файл тома отличается от
	// прежнего — плитки счёта, листы добавленные, не найденные, изменённые, не сверенные; «Заменить файл тома» со
	// своим окном подтверждения (право записи). Ручки `GET …/deltas`, `POST …/deltas/<id>/replace`. Перечитывается
	// вместе с обзором дела; раскрытые списки — состояние компонента. Поведение — прежний `sections/whatsnew.js`.
	import { onDestroy } from 'svelte';
	import type { CaseState } from '$lib/custom/case/casestore';
	import { splitLabel, when } from '$lib/custom/case/casepage';
	import { createLoader } from '$lib/custom/case/loader';
	import { casePath, sheetHref, reasonText } from '$lib/custom/case/sections';
	import { count, fmt } from '$lib/custom/case/strings';
	import { caseToast } from '$lib/custom/case/toast';
	import FormDialog from './FormDialog.svelte';
	import Icon from './Icon.svelte';

	export let state: CaseState;
	export let S: Record<string, any> = {};

	type Sheet = { page_id: number; label: string };
	type Side = Sheet & { start?: number; end?: number };
	type Pair = {
		old: Sheet;
		new: Sheet;
		counts?: { numeric?: number; maybe_ocr?: number } & Record<string, number>;
		more?: number;
		places?: { kind: string; old: Side; new: Side }[];
	};
	type Delta = {
		id: number;
		volume_label: string | null;
		old: { filename: string | null; pages: number; removed?: boolean; edited_documents?: number };
		new: { filename: string | null; pages: number; removed?: boolean };
		same: number;
		added: Sheet[];
		removed: Sheet[];
		changed: Pair[];
		unsure: Pair[];
		blind?: Pair[];
		noise?: { pages: number; numeric_pages: number } | null;
		noisy?: { new: Sheet }[];
		single_reading?: number;
		replaceable?: boolean;
		replaced_at?: string | null;
		replaced_by?: string | null;
		replaced_by_name?: string | null;
	};

	const { boot, data } = state;
	const loader = createLoader(() => state.api.get<{ deltas: Delta[] }>(casePath(state, '/deltas')));
	const { data: answer, error } = loader;
	$: ($data, void loader.refresh());
	onDestroy(() => loader.stop());
	$: deltas = $answer?.deltas ?? [];
	$: canWrite = !!$boot?.can_write;

	const CHIPS = 12; // листов в перечне до «ещё N»
	let opened = new Set<string>();
	const flip = (key: string) => {
		const next = new Set(opened);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		opened = next;
	};
	const gone = (d: Delta) => !!d.replaced_at || !!d.old.removed;
	const tiles = (d: Delta) => [
		{ n: d.same, key: 'replace_tile_same', warn: false },
		{ n: d.added.length, key: 'replace_tile_added', warn: false },
		{ n: d.removed.length, key: 'replace_tile_removed', warn: d.removed.length > 0 },
		{ n: d.changed.length, key: 'replace_tile_changed', warn: d.changed.length > 0 },
		{
			n: d.unsure.length + (d.blind?.length ?? 0),
			key: 'replace_tile_unsure',
			warn: d.unsure.length + (d.blind?.length ?? 0) > 0
		}
	];
	const facts = (c: Pair) =>
		Object.keys(c.counts ?? {}).length
			? fmt(S.whatsnew_changed_facts, {
					n: (c.places?.length ?? 0) + (c.more ?? 0),
					numeric: c.counts?.numeric ?? 0,
					ocr: c.counts?.maybe_ocr ?? 0
				})
			: ''; // пара без сходства текста: расхождения не считались
	const placeHref = (pl: NonNullable<Pair['places']>[number]) => {
		const side = pl.kind === 'only_old' ? pl.old : pl.new;
		return sheetHref(state, side.page_id, `?hl=${side.start}-${side.end}`);
	};
	const labels = (list: Sheet[]) => list.map((x) => x.label).join('; ');

	let target: Delta | null = null;
	let confirmOpen = false;
	const ask = (d: Delta) => {
		target = d;
		confirmOpen = true;
	};
	async function replace() {
		if (!target) return;
		await state.api.post(casePath(state, `/deltas/${target.id}/replace`));
		caseToast(S.whatsnew_replace_done);
		void loader.refresh(true);
	}
	const groups = (d: Delta) =>
		[
			{
				id: 'changed',
				title: 'replace_changed_n',
				note: 'replace_changed_note',
				pairs: d.changed,
				blind: false
			},
			{
				id: 'unsure',
				title: 'replace_unsure_n',
				note: 'replace_unsure_note',
				pairs: d.unsure,
				blind: false
			},
			{
				id: 'blind',
				title: 'replace_blind_n',
				note: 'replace_blind_note',
				pairs: d.blind ?? [],
				blind: true
			}
		].filter((g) => g.pairs.length);
</script>

<p class="md lead">{S.replace_hint}</p>

{#if $error && $answer}<StaleNote {S} error={$error} retry={() => loader.refresh(true)} />{/if}
{#if $error && !$answer}
	<section class="card" data-testid="case-replace-error">
		<div class="col g12 as">
			<span class="pill s"
				><Icon name="al" />{fmt(S.section_error, { detail: reasonText(S, $error) })}</span
			>
			<button type="button" class="btn big" on:click={() => loader.refresh(true)}>{S.retry}</button>
		</div>
	</section>
{:else if !$answer}
	<section class="card"><p class="mut" role="status">{S.loading}</p></section>
{:else if !deltas.length}
	<section class="card" data-testid="case-replace-empty">
		<p class="mut">{S.whatsnew_empty}</p>
	</section>
{:else}
	{#each deltas as d (d.id)}
		{@const was = gone(d)}
		<section class="card g16" data-testid="case-delta">
			<div class="row sp g12 as">
				<div class="col g4 grow">
					<h2>{fmt(S.replace_head, { volume: d.volume_label || '—' })}</h2>
					<p class="md fg2 aw">
						<span class="b">{d.new.filename || '—'}</span>
						{S.replace_versus}
						<span class="b">{d.old.filename || '—'}</span>
					</p>
					<p class="sm mut">
						{fmt(S.whatsnew_counts, {
							same: d.same,
							old_pages: d.old.pages,
							new_pages: d.new.pages
						})}
					</p>
				</div>
				{#if !d.replaced_at && d.replaceable && canWrite}
					<button type="button" class="btn big p" on:click={() => ask(d)} data-testid="case-replace"
						>{S.whatsnew_replace}</button
					>
				{/if}
			</div>
			<div class="tiles counts" data-testid="case-delta-tiles">
				{#each tiles(d) as t (t.key)}
					<div class="col ct" class:w={t.warn}>
						<span class="v b">{t.n}</span><span class="xs cap">{S[t.key]}</span>
					</div>
				{/each}
			</div>
			{#if !d.added.length && !d.removed.length && !d.changed.length && !d.unsure.length && !(d.blind ?? []).length}
				<p class="sm">{S.whatsnew_no_changes}</p>
			{/if}
			<div class="col">
				{#each [{ id: 'added', title: 'replace_added_n', list: d.added, plain: false }, { id: 'removed', title: 'replace_removed_n', list: d.removed, plain: was }] as g (g.id)}
					{#if g.list.length}
						{@const key = `${d.id}:${g.id}`}
						{@const shown = opened.has(key) ? g.list : g.list.slice(0, CHIPS)}
						<div class="li t" data-testid="case-delta-{g.id}">
							<div class="col g6 grow">
								<h3>{fmt(S[g.title], { n: g.list.length })}</h3>
								<div class="row g8">
									{#each shown as x (x.page_id)}
										{@const parts = splitLabel(x.label)}
										{#if g.plain}
											<span class="chipl" title={x.label}
												>{parts.main}{#if parts.file}<span class="fn gap">{parts.file}</span
													>{/if}</span
											>
										{:else}
											<a
												class="chipl"
												href={sheetHref(state, x.page_id)}
												title={x.label}
												target="_blank"
												rel="noopener"
												>{parts.main}{#if parts.file}<span class="fn gap">{parts.file}</span
													>{/if}</a
											>
										{/if}
									{/each}
									{#if g.list.length > shown.length}
										<button type="button" class="btn s" on:click={() => flip(key)}
											>{fmt(S.more_n, { n: g.list.length - shown.length })}</button
										>
									{/if}
								</div>
								{#if g.id === 'removed' && !d.replaced_at}<p class="sm mut">
										{S.replace_removed_note}
									</p>{/if}
							</div>
						</div>
					{/if}
				{/each}
				{#each groups(d) as g (g.id)}
					<div class="li t" data-testid="case-delta-{g.id}">
						<div class="col g6 grow">
							<h3>{fmt(S[g.title], { n: g.pairs.length })}</h3>
							<p class="sm mut">{S[g.note]}</p>
							{#each g.pairs as c, n (n)}
								{@const f = facts(c)}
								<div class="row g8 md">
									{#if was}<span>{c.old.label}</span>{:else}<a
											class="ref"
											href={sheetHref(state, c.old.page_id)}
											target="_blank"
											rel="noopener">{c.old.label}</a
										>{/if}
									<span>→</span>
									<a
										class="ref"
										href={sheetHref(state, c.new.page_id)}
										target="_blank"
										rel="noopener">{c.new.label}</a
									>
									{#if g.blind}
										<span class="pill w t"><Icon name="eye" />{S.replace_blind_pill}</span>
									{:else if f}
										<span class="fg2">— {f}</span>
										{#each (c.places ?? []).slice(0, 5) as pl, i (i)}
											<a class="chipl place" href={placeHref(pl)} target="_blank" rel="noopener"
												>{fmt(S.whatsnew_place, { n: i + 1 })}</a
											>
										{/each}
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/each}
				{#if d.noise?.pages}
					{@const key = `${d.id}:noise`}
					{@const shown = opened.has(key)}
					<div class="li t" data-testid="case-delta-noise">
						<button
							type="button"
							class="tg small"
							aria-expanded={shown}
							aria-label={shown ? S.collapse : S.expand}
							on:click={() => flip(key)}><Icon name={shown ? 'u' : 'd'} /></button
						>
						<div class="col g4 grow">
							<h3>
								{fmt(S.replace_noise_n, { sheets: count(d.noise.pages, S.sheets_count_forms) })}
							</h3>
							<p class="sm mut">
								{fmt(S.whatsnew_noise, { n: d.noise.pages, numeric: d.noise.numeric_pages })}
							</p>
							{#if shown && (d.noisy ?? []).length}
								<div class="row g8">
									<span class="sm mut">{S.whatsnew_noisy}</span>
									{#each d.noisy ?? [] as x (x.new.page_id)}
										<a
											class="chipl"
											href={sheetHref(state, x.new.page_id)}
											target="_blank"
											rel="noopener">{x.new.label}</a
										>
									{/each}
								</div>
							{/if}
						</div>
					</div>
				{/if}
			</div>
			{#if d.single_reading}
				<p class="sm mut">{fmt(S.copies_single_reading, { n: d.single_reading })}</p>
			{/if}
			{#if d.replaced_at}
				<p class="sm mut" data-testid="case-delta-replaced">
					{fmt(S.whatsnew_replaced, {
						when: when(d.replaced_at),
						who: d.replaced_by_name || d.replaced_by || ''
					})}
				</p>
			{:else if !d.replaceable && !d.old.removed && !d.new.removed}
				<p class="sm mut" data-testid="case-delta-not-same">{S.whatsnew_not_same}</p>
			{/if}
		</section>
	{/each}
{/if}

<FormDialog
	bind:open={confirmOpen}
	title={S.replace_confirm_title}
	{S}
	submit={replace}
	submitText={S.whatsnew_replace}
	testid="case-replace-dialog"
>
	{#if target}
		<p class="md aw">
			{fmt(S.whatsnew_replace_confirm, {
				old_name: target.old.filename || '—',
				new_name: target.new.filename || '—'
			})}
		</p>
		{#if S.whatsnew_replace_links}
			<p class="md aw" data-testid="case-replace-links">
				{fmt(S.whatsnew_replace_links, { old_pages: target.old.pages, same: target.same })}
			</p>
		{/if}
		<p class="sm fg2">
			{fmt(S.whatsnew_replace_facts, {
				same: target.same,
				changed: target.changed.length,
				unsure: target.unsure.length
			})}
		</p>
		{#if target.removed.length || (target.blind ?? []).length || target.old.edited_documents}
			<div class="note">
				<Icon name="al" klass="l" />
				<div class="col g6">
					{#if target.removed.length}
						<p>
							{fmt(S.whatsnew_replace_removed, {
								n: target.removed.length,
								sheets: labels(target.removed)
							})}
						</p>
					{/if}
					{#if (target.blind ?? []).length}
						<p>
							{fmt(S.whatsnew_replace_blind, {
								n: (target.blind ?? []).length,
								sheets: labels((target.blind ?? []).map((x) => x.old))
							})}
						</p>
					{/if}
					{#if target.old.edited_documents}
						<p>{fmt(S.whatsnew_replace_edits, { n: target.old.edited_documents })}</p>
					{/if}
				</div>
			</div>
		{/if}
	{/if}
</FormDialog>

<style>
	.lead {
		max-width: 700px;
		color: var(--muted2);
	}
	.counts {
		grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
	}
	.ct {
		padding: 12px 14px;
		border-radius: 12px;
		background: var(--soft);
	}
	.ct .v {
		font-size: 22px;
	}
	.ct .cap {
		color: var(--muted);
	}
	.ct.w {
		background: var(--warn-bg);
	}
	.ct.w .cap {
		color: var(--warn-fg);
	}
	.gap {
		margin-left: 6px;
	}
	.place {
		min-height: 30px;
	}
	.tg.small {
		flex-basis: 32px;
		height: 32px;
	}
	@media (max-width: 720px) {
		.tg.small {
			flex-basis: 44px;
			height: 44px;
		}
		.place {
			min-height: 44px;
		}
	}
</style>
