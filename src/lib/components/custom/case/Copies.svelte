<script lang="ts">
	import StaleNote from './StaleNote.svelte';
	// ai-dvokat: «Копии и расхождения» (макет K-copies; опись § 2.11): пары документов описи со сходным текстом двумя
	// блоками — копии (по описи совпал реквизит) и похожие документы того же образца; пара свёрнута, по раскрытию —
	// расхождения с местом на листах обеих копий (ссылки открывают лист в новой вкладке и подсвечивают место);
	// неподтверждённые вторым прочтением — отдельно, по кнопке. Ручка `GET …/copies`; перечитывается вместе с обзором.
	// Поведение — прежний `sections/copies.js`.
	import { onDestroy } from 'svelte';
	import type { CaseState } from '$lib/custom/case/casestore';
	import { createLoader } from '$lib/custom/case/loader';
	import { casePath, sheetHref, reasonText } from '$lib/custom/case/sections';
	import { count, fmt } from '$lib/custom/case/strings';
	import Icon from './Icon.svelte';

	export let state: CaseState;
	export let S: Record<string, any> = {};

	type Place = { page_id: number; label?: string; start: number; end: number; text: string };
	type Diff = { kind: string; confirmed?: boolean | null; shown?: boolean; a: Place; b: Place };
	type DocSide = {
		title?: string | null;
		doc_type?: string | null;
		date?: string | null;
		label: string;
		page_id: number;
	} | null;
	type Pair = {
		id: number;
		similarity: number;
		a: DocSide;
		b: DocSide;
		same_document: boolean;
		order?: boolean;
		counts?: { numeric?: number };
		more?: number;
		single_reading?: number;
		only_a: { label: string }[];
		only_b: { label: string }[];
		differences: Diff[];
	};

	const { data } = state;
	const loader = createLoader(() => state.api.get<{ copies: Pair[] }>(casePath(state, '/copies')));
	const { data: answer, error } = loader;
	$: ($data, void loader.refresh());
	onDestroy(() => loader.stop());

	// копия — когда по описи совпал реквизит (дата или номер) и ни один не расходится; остальные пары — похожие документы
	$: real = ($answer?.copies ?? []).filter((c) => c.same_document);
	$: other = ($answer?.copies ?? []).filter((c) => !c.same_document);
	$: blocks = [
		{ id: 'real', title: S.pairs_real_title, note: '', pairs: real },
		{ id: 'other', title: S.pairs_similar_title, note: S.pairs_similar_note, pairs: other }
	].filter((b) => b.id === 'real' || b.pairs.length);

	const PAIRS = 4; // пар в блоке до «Показать ещё»
	const DIFFS = 3; // расхождений пары до «Показать ещё»
	let opened = new Set<string>();
	const flip = (key: string) => {
		const next = new Set(opened);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		opened = next;
	};
	const shownOf = (c: Pair) => c.differences.filter((d) => d.shown);
	const hiddenOf = (c: Pair) => c.differences.filter((d) => !d.shown);
	const labels = (list: { label: string }[]) => list.map((p) => p.label).join('; ');
	function facts(c: Pair): string {
		const out = [fmt(S.copies_similarity, { pct: Math.round(c.similarity * 100) })];
		out.push(fmt(S.copies_diffs, { n: shownOf(c).length, numeric: c.counts?.numeric ?? 0 }));
		if (c.order) out.push(S.copies_order);
		if (c.only_a.length) out.push(fmt(S.copies_only_a, { labels: labels(c.only_a) }));
		if (c.only_b.length) out.push(fmt(S.copies_only_b, { labels: labels(c.only_b) }));
		if (c.single_reading) out.push(fmt(S.copies_single_reading, { n: c.single_reading }));
		if (c.more) out.push(fmt(S.copies_more, { n: c.more }));
		return out.join('; ');
	}
	const note = (d: Diff) =>
		d.confirmed === true ? '' : d.confirmed === false ? S.copies_note_ocr : S.copies_note_single;
	const place = (p: Place) => sheetHref(state, p.page_id, `?hl=${p.start}-${p.end}`);
</script>

<div class="note n" data-testid="case-copies-hint">
	<Icon name="info" klass="l" />
	<p>{S.copies_hint}</p>
</div>

{#if $error && $answer}<StaleNote {S} error={$error} retry={() => loader.refresh(true)} />{/if}
{#if $error && !$answer}
	<section class="card" data-testid="case-copies-error">
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
	{#each blocks as b (b.id)}
		{@const all = opened.has(`${b.id}:all`)}
		<section class="card g4 block" data-testid="case-copies-{b.id}">
			<div class="row g12">
				<h2>{b.title}</h2>
				<span class="cnt">{b.pairs.length}</span>
			</div>
			{#if b.note}<p class="sm mut blocknote">{b.note}</p>{/if}
			{#if !b.pairs.length}<p class="md fg2 none">{S.copies_empty}</p>{/if}
			{#each all ? b.pairs : b.pairs.slice(0, PAIRS) as c (c.id)}
				{@const key = `p${c.id}`}
				{@const open = opened.has(key)}
				{@const shown = shownOf(c)}
				{@const hidden = hiddenOf(c)}
				<div class="li t" data-testid="case-copy">
					<button
						type="button"
						class="tg small"
						aria-expanded={open}
						aria-label={open ? S.collapse : S.expand}
						on:click={() => flip(key)}><Icon name={open ? 'u' : 'd'} /></button
					>
					<div class="col g8 grow">
						<div class="row g8 md">
							{#each [c.a, c.b] as d, n}
								{#if n}<span class="mut">↔</span>{/if}
								{#if !d}
									<span class="mut">{S.copies_doc_gone}</span>
								{:else}
									<span class="aw"
										>{#if d.title || d.doc_type}<span class="b">{d.title || d.doc_type}</span
											>{:else}<span class="mut">{S.copies_untitled}</span>{/if} —
										<a class="ref" href={sheetHref(state, d.page_id)} target="_blank" rel="noopener"
											>{d.label}</a
										>{d.date ? `, ${d.date}` : ''}</span
									>
								{/if}
							{/each}
						</div>
						<p class="sm mut">
							{facts(c)}{#if hidden.length}; {fmt(S.copies_maybe_ocr, { n: hidden.length }).replace(
									/^./,
									(x) => x.toLocaleLowerCase('ru-RU')
								)}{/if}
						</p>
						{#if open}
							{#each [{ id: 'shown', list: shown }, { id: 'hidden', list: hidden }] as part (part.id)}
								{#if part.list.length}
									{@const more = opened.has(`${key}:${part.id}`)}
									{#if part.id === 'hidden'}
										<p class="sm b">{fmt(S.copies_maybe_ocr, { n: hidden.length })}</p>
									{/if}
									<div class="col g6 sm" data-testid="case-copy-diffs">
										{#each more ? part.list : part.list.slice(0, DIFFS) as d}
											{@const why = note(d)}
											<div class="row g8">
												{#if d.kind === 'only_a' || d.kind === 'only_b'}
													{@const here = d.kind === 'only_a' ? d.a : d.b}
													{@const there = d.kind === 'only_a' ? d.b : d.a}
													<span class="mut">{S.copies_only_here}</span>
													<a class="ref" href={place(here)} target="_blank" rel="noopener"
														>{here.label || S.copies_sheet}</a
													>
													<span class="aw">«{here.text}»</span>
													<span class="mut">— {S.copies_absent_on}</span>
													<a class="ref" href={place(there)} target="_blank" rel="noopener"
														>{there.label || S.copies_sheet}</a
													>
												{:else}
													<a class="ref" href={place(d.a)} target="_blank" rel="noopener"
														>{d.a.label || S.copies_sheet}</a
													>
													<span class="aw">«{d.a.text}»</span>
													<span class="mut">—</span>
													<a class="ref" href={place(d.b)} target="_blank" rel="noopener"
														>{d.b.label || S.copies_sheet}</a
													>
													<span class="aw">«{d.b.text}»</span>
												{/if}
												{#if why}<span class="pill w t"><Icon name="eye" />{why}</span>{/if}
											</div>
										{/each}
									</div>
									{#if !more && part.list.length > DIFFS}
										<div>
											<button type="button" class="btn s" on:click={() => flip(`${key}:${part.id}`)}
												>{count(part.list.length - DIFFS, S.pairs_more_diffs_forms)}</button
											>
										</div>
									{/if}
								{/if}
							{/each}
						{/if}
					</div>
				</div>
			{/each}
			{#if !all && b.pairs.length > PAIRS}
				<div class="li">
					<button type="button" class="btn" on:click={() => flip(`${b.id}:all`)}
						>{fmt(S.show_more_n, { n: b.pairs.length - PAIRS })}</button
					>
				</div>
			{/if}
		</section>
	{/each}
{/if}

<style>
	.block {
		padding-bottom: 10px;
	}
	.blocknote {
		padding-bottom: 8px;
	}
	.none {
		padding: 4px 0 10px;
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
	}
</style>
