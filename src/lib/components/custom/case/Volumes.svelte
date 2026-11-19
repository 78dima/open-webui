<script lang="ts">
	// ai-dvokat: «Тома» (макет K-volumes; опись § 2.5): карточка тома — состояние, откуда номер, замечания по нумерации,
	// сверка с внутренней описью (сворачивается), файлы с «Действиями»; файлы без тома с подсказкой «продолжение» и
	// подтверждением; электронное дело. Данные — ответ обзора (его переспрашивает общий макет дела). Раскрытые
	// «Действия» и списки — состояние компонента: обновление обзора их не сбрасывает. Поведение перенесено с прежней
	// страницы сервиса (`case.js`: `renderVolumes`, `fileItem`, `labelDialog`, `attachDialog`, `kindDialog`).
	import type { CaseState } from '$lib/custom/case/casestore';
	import {
		volumeState,
		type CourtInventory,
		type FileFacts,
		type Volume
	} from '$lib/custom/case/casepage';
	import {
		caseHref,
		casePath,
		errorText,
		fileFacts,
		fileLine,
		fileStatus,
		labelSource,
		numberingChecks,
		query,
		sheetHref,
		suggestText,
		volumeLabel,
		volumesSorted,
		volumeTitle,
		type FileMode
	} from '$lib/custom/case/sections';
	import { count, fmt } from '$lib/custom/case/strings';
	import { caseToast } from '$lib/custom/case/toast';
	import FormDialog from './FormDialog.svelte';
	import HistoryDialog from './HistoryDialog.svelte';
	import Icon, { type IconName } from './Icon.svelte';

	export let state: CaseState;
	export let S: Record<string, any> = {};
	export let hrefOf: (slug: string) => string;

	const { boot, data, stale } = state;
	$: canWrite = !!$boot?.can_write;
	$: ov = $data?.overview;
	$: volumes = ov?.volumes ?? [];
	$: loose = ov?.files_without_volume ?? [];
	$: ecase = ov?.e_case ?? [];
	$: extras = $data?.files ?? {};
	$: sorted = volumesSorted(volumes);

	const TONE = { plain: '', info: 'i', warn: 'w', stop: 's' } as const;
	const ICON: Record<string, IconName> = { plain: 'ok', info: 'clock', warn: 'al', stop: 'al' };
	const facts = (f: FileFacts) => fileFacts(f, extras[String(f.id)]);
	const ecaseFile = (e: { file_id: number; label: string; pages: number }): FileFacts => {
		const x = extras[String(e.file_id)] ?? { status: 'indexed', filename: e.label };
		return {
			id: e.file_id,
			filename: x.filename || e.label,
			status: x.status,
			pages: e.pages,
			pages_indexed: x.pages_indexed,
			input_kind: 'e_case',
			input_fact: x.input_fact,
			block_reason: x.block_reason
		};
	};
	const percent = (v: Volume) => {
		const files = (v.files ?? []).map(facts);
		const total = files.reduce((n, f) => n + (f.pages || 0), 0);
		const done = files.reduce(
			(n, f) => n + (f.status === 'indexed' ? f.pages || 0 : f.pages_indexed || 0),
			0
		);
		return total ? Math.round((100 * done) / total) : 0;
	};
	const numbering = (v: Volume) => {
		const c = numberingChecks($data, v.id);
		const lower = (s: string) => (s ? s[0].toLocaleLowerCase('ru-RU') + s.slice(1) : s);
		return c.total
			? fmt(S.volume_check_link, {
					checks: count(c.total, S.volume_check_forms),
					parts: c.groups
						.map((g) => fmt(S.volume_check_part, { group: lower(S[g.key]), n: g.n }))
						.join(', ')
				})
			: '';
	};
	const dupHref = (v: Volume, number: unknown) =>
		v.label ? caseHref(state, `/ref${query({ t: v.label, l: number })}`) : null;
	const hasFacts = (v: Volume) =>
		!!(
			v.gaps?.length ||
			v.shortfalls?.some((g) => g.text) ||
			v.duplicates?.length ||
			v.disagreements?.length
		);

	// ---- раскрытое: «Действия» у файла и расхождения с описью ----
	let openFiles = new Set<string>();
	let courtFlipped = new Set<string>(); // том или файл, у которого юрист переключил список расхождений
	const flip = (set: Set<string>, key: string) => {
		const next = new Set(set);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		return next;
	};
	/** Расхождений больше пяти — список свёрнут, пока юрист не раскроет (как на прежней странице). */
	const courtOpen = (key: string, c: CourtInventory, flipped: Set<string>) =>
		(c.diffs?.length ?? 0) <= 5 !== flipped.has(key);

	// ---- действия ----
	const fail = (e: unknown) => caseToast(errorText(S, e), true);
	const patchFile = (f: FileFacts, body: unknown) =>
		state.api.request('PATCH', casePath(state, `/files/${f.id}`), body);
	const confirm = (f: FileFacts) =>
		patchFile(f, { confirm_suggest: true }).then(() => state.refresh(), fail);
	const detach = (f: FileFacts) => patchFile(f, { detach: true }).then(() => state.refresh(), fail);

	let history: { entity: string; id: number } | null = null;
	let historyOpen = false;
	const showHistory = (entity: string, id: number | undefined) => {
		if (id == null) return;
		history = { entity, id };
		historyOpen = true;
	};

	type Window =
		| { kind: 'label'; volume: Volume }
		| { kind: 'attach'; file: FileFacts }
		| { kind: 'kind'; file: FileFacts }
		| { kind: 'remove'; file: FileFacts };
	let win: Window | null = null;
	let winOpen = false;
	let labelValue = '';
	let attachLabel = '';
	let attachCont = '';
	let kindValue = '';
	function show(w: Window) {
		win = w;
		if (w.kind === 'label') labelValue = w.volume.label ?? '';
		if (w.kind === 'attach') [attachLabel, attachCont] = ['', ''];
		if (w.kind === 'kind') kindValue = w.file.input_kind === 'e_case' ? 'e_case' : 'volume';
		winOpen = true;
	}
	async function submit() {
		if (!win) return;
		if (win.kind === 'label') {
			if (!labelValue.trim()) throw new Error(S.volume_not_set_hint);
			await state.api.request('PATCH', casePath(state, `/volumes/${win.volume.id}`), {
				label: labelValue
			});
			caseToast(S.saved);
		} else if (win.kind === 'attach') {
			const body = attachLabel.trim()
				? { label: attachLabel.trim() }
				: attachCont
					? { continues_volume_id: Number(attachCont) }
					: null;
			if (!body) throw new Error(S.volume_not_set_hint);
			await patchFile(win.file, body);
			caseToast(S.saved);
		} else if (win.kind === 'kind') {
			await patchFile(win.file, { input_kind: kindValue });
			caseToast(S.saved);
		} else {
			await state.api.request('DELETE', casePath(state, `/files/${win.file.id}`));
			caseToast(S.remove_file_done);
		}
		void state.refresh();
	}
	$: winTitle = !win
		? ''
		: win.kind === 'label'
			? S.volume_edit_label_g
			: win.kind === 'attach'
				? S.file_attach
				: win.kind === 'kind'
					? S.file_kind_change
					: S.remove_file_title;
	const KINDS = [
		{ kind: 'volume', key: 'upload_kind_volume' },
		{ kind: 'e_case', key: 'upload_kind_ecase' }
	] as const;
</script>

{#if !$data}
	<section class="card" data-testid="case-volumes-wait">
		{#if $stale}
			<div class="col g12 as">
				<span class="pill s"
					><Icon name="al" />{$stale.kind === 'network'
						? S.overview_state_offline
						: fmt(S.section_error, { detail: $stale.message })}</span
				>
				<button type="button" class="btn big" on:click={() => state.refresh()}>{S.retry}</button>
			</div>
		{:else}
			<p class="mut" role="status">{S.loading}</p>
		{/if}
	</section>
{:else}
	{#if !volumes.length && !loose.length && !ecase.length}
		<section class="card" data-testid="case-volumes-empty">
			<div class="col g12 as">
				<p class="mut">{S.volumes_empty_g}</p>
				{#if canWrite}<a class="btn" href={hrefOf('upload')}><Icon name="up" />{S.section_upload}</a
					>{/if}
			</div>
		</section>
	{/if}

	{#each volumes as v (v.id)}
		{@const st = volumeState(v)}
		{@const src = labelSource(v, $data.volumes_extra?.[String(v.id)], S)}
		{@const note = numbering(v)}
		{@const court = v.court_inventory}
		<section class="card g16" data-testid="case-volume" data-volume={v.label ?? ''}>
			<div class="row sp g12">
				<div class="row g12">
					<h2>{volumeTitle(v.label, S)}</h2>
					<span class="pill {TONE[st.tone]}"
						><Icon name={ICON[st.tone]} />{fmt(S[st.key], st.vars ?? {})}</span
					>
					<span class="md fg2"
						>{count(v.pages ?? 0, S.file_pages_forms)}{#if v.range?.first}{' · '}{fmt(
								v.status === 'inventory_ready' ? S.volume_range : S.overview_comp_range_sofar,
								{ first: v.range.first, last: v.range.last }
							)}{/if}</span
					>
				</div>
				<div class="row g8">
					{#if canWrite}
						<button
							type="button"
							class="btn s"
							on:click={() => show({ kind: 'label', volume: v })}
							data-testid="case-volume-label">{S.volume_edit_label_g}</button
						>
					{/if}
					<button type="button" class="btn t" on:click={() => showHistory('volume', v.id)}
						>{S.history}</button
					>
				</div>
			</div>
			{#if st.tone === 'info' && v.status !== 'inventory_ready' && percent(v) > 0 && percent(v) < 100}
				<div class="bar" aria-hidden="true"><i style:width="{percent(v)}%"></i></div>
			{/if}
			{#if src}
				<p class="sm mut" data-testid="case-volume-source">
					{src.text}
					{#if src.pageId != null}
						<a
							class="ref"
							href={sheetHref(state, src.pageId)}
							title={fmt(S.label_sheet_link, { label: src.sheet })}
							data-sveltekit-reload>{S.label_sheet_caption}</a
						>
					{/if}
					{#if src.unchecked}<span class="c-warn"> · {S.label_not_on_sheet}</span>{/if}
				</p>
			{/if}
			{#if note}
				<a class="note row g12 checklink" href={hrefOf('check')} data-testid="case-volume-checks">
					<Icon name="list" klass="l" /><span class="grow">{note}</span><span class="bb nob"
						>{S.volume_check_open}</span
					>
				</a>
			{/if}
			{#if hasFacts(v)}
				<div class="col g8" data-testid="case-volume-facts">
					<h3>{S.volume_numbering_title}</h3>
					<ul class="col g6 sm fg2 facts">
						{#each v.gaps ?? [] as g}
							{@const miss = g.missing ?? []}
							<li>
								{g.text ||
									fmt(S.check_gap, {
										range: miss.length > 1 ? `${miss[0]}–${miss[miss.length - 1]}` : miss[0]
									})}
							</li>
						{/each}
						{#each (v.shortfalls ?? []).filter((g) => g.text) as g}<li>{g.text}</li>{/each}
						{#each v.duplicates ?? [] as dup}
							{@const ids = dup.page_ids ?? []}
							{@const pn = $data.page_nos ?? {}}
							{@const text =
								dup.text ||
								fmt(S.check_duplicate, {
									n: dup.number,
									x: pn[String(ids[0])] ?? '?',
									y: pn[String(ids[1])] ?? '?'
								})}
							{@const href = dupHref(v, dup.number)}
							<li>
								{#if href}<a class="ref" {href} data-sveltekit-reload>{text}</a>{:else}{text}{/if}
							</li>
						{/each}
						{#each v.disagreements ?? [] as dg}
							<li>
								<a class="ref" href={sheetHref(state, dg.page_id)} data-sveltekit-reload
									>{dg.text ||
										fmt(S.check_number_disagree, {
											a: (dg.reads ?? [])[0],
											b: (dg.reads ?? []).slice(1).join(' / ')
										})}</a
								>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
			{#if court}
				{@const key = `v${v.id}`}
				{@const shown = courtOpen(key, court, courtFlipped)}
				<div class="col g8" data-testid="case-court">
					<div class="row sp g8">
						<h3>{S.court_title}</h3>
						<span class="sm mut"
							>{fmt(S.court_counts, { n_court: court.n_court, n_model: court.n_model })}</span
						>
					</div>
					{#if !court.diffs?.length}
						<p class="sm mut">{S.court_no_diffs}</p>
					{:else}
						<div class="row g8 nw as">
							<button
								type="button"
								class="tg small"
								aria-expanded={shown}
								aria-label={shown ? S.collapse : S.expand}
								on:click={() => (courtFlipped = flip(courtFlipped, key))}
								><Icon name={shown ? 'u' : 'd'} /></button
							>
							<div class="col g6 grow sm fg2">
								<span class="b fg">{fmt(S.court_diffs_n, { n: court.diffs.length })}</span>
								{#if shown}{#each court.diffs as t}<span class="aw">{t}</span>{/each}{/if}
							</div>
						</div>
					{/if}
				</div>
			{/if}
			<div class="col">
				<h3 class="filesh">{S.volume_files_title}</h3>
				{#each (v.files ?? []).map(facts) as f (f.id)}
					{@const fs = fileStatus(f, S)}
					{@const key = String(f.id)}
					<div class="li" data-testid="case-file" data-file={f.filename}>
						<div class="col g2 grow">
							<span class="b aw">{f.filename}</span>
							<span class="sm mut">{fileLine(f, 'volume', S)}</span>
						</div>
						{#if f.status !== 'indexed'}
							<span class="pill {TONE[fs.tone]}" class:box={f.status === 'blocked'}
								><Icon name={ICON[fs.tone]} />{fs.text}</span
							>
						{/if}
						<button
							type="button"
							class="btn s"
							aria-expanded={openFiles.has(key)}
							on:click={() => (openFiles = flip(openFiles, key))}
							data-testid="case-file-actions"
							>{S.file_actions}<Icon name={openFiles.has(key) ? 'u' : 'd'} /></button
						>
					</div>
					{#if openFiles.has(key)}
						<div class="row sp g8 actions" data-testid="case-file-panel">
							<div class="row g8">
								{#if canWrite}
									<button
										type="button"
										class="btn s"
										on:click={() => show({ kind: 'attach', file: f })}>{S.file_attach}</button
									>
									{#if f.input_kind !== 'photo' && !f.image}
										<button
											type="button"
											class="btn s"
											on:click={() => show({ kind: 'kind', file: f })}>{S.file_kind_change}</button
										>
									{/if}
									<button type="button" class="btn s" on:click={() => detach(f)}
										>{S.file_detach}</button
									>
								{/if}
								<button type="button" class="btn t" on:click={() => showHistory('file', f.id)}
									>{S.history}</button
								>
							</div>
							{#if canWrite}
								<button
									type="button"
									class="btn s d"
									on:click={() => show({ kind: 'remove', file: f })}>{S.remove_file}</button
								>
							{/if}
						</div>
					{/if}
				{/each}
			</div>
		</section>
	{/each}

	{#if loose.length}
		<section class="card g12" data-testid="case-loose">
			<div class="col g4">
				<div class="row g12">
					<h2>{S.files_without_volume}</h2>
					<span class="cnt w">{loose.length}</span>
				</div>
				<p class="sm mut">{S.files_without_volume_hint}</p>
			</div>
			<div class="col">
				{#each loose.map(facts) as f (f.id)}
					{@const fs = fileStatus(f, S)}
					{@const key = String(f.id)}
					{@const sug = suggestText(f.suggest, S, (id) => volumeLabel(volumes, id))}
					<div class="li t" data-testid="case-file" data-file={f.filename}>
						<div class="col g2 grow">
							<span class="b aw">{f.filename}</span>
							<span class="sm mut">{fileLine(f, 'loose', S)}</span>
						</div>
						<span class="pill {TONE[fs.tone]}" class:box={f.status === 'blocked'}
							><Icon name={ICON[fs.tone]} />{fs.text}</span
						>
						<button
							type="button"
							class="btn s"
							aria-expanded={openFiles.has(key)}
							on:click={() => (openFiles = flip(openFiles, key))}
							data-testid="case-file-actions"
							>{S.file_actions}<Icon name={openFiles.has(key) ? 'u' : 'd'} /></button
						>
					</div>
					{#if sug}
						<div class="note row g12 sug" data-testid="case-suggest">
							<span class="grow">{sug}</span>
							{#if canWrite}
								{#if f.suggest?.volume_id != null}
									<button type="button" class="btn s p" on:click={() => confirm(f)}
										>{S.file_confirm}</button
									>
									<button
										type="button"
										class="btn s clear"
										on:click={() => show({ kind: 'attach', file: f })}>{S.file_attach_other}</button
									>
								{:else}
									<button
										type="button"
										class="btn s p"
										on:click={() => show({ kind: 'attach', file: f })}>{S.file_attach}</button
									>
								{/if}
							{/if}
						</div>
					{/if}
					{#if openFiles.has(key)}
						<div class="row sp g8 actions" data-testid="case-file-panel">
							<div class="row g8">
								{#if canWrite}
									<button
										type="button"
										class="btn s"
										on:click={() => show({ kind: 'attach', file: f })}>{S.file_attach}</button
									>
									{#if f.input_kind !== 'photo' && !f.image}
										<button
											type="button"
											class="btn s"
											on:click={() => show({ kind: 'kind', file: f })}>{S.file_kind_change}</button
										>
									{/if}
								{/if}
								<button type="button" class="btn t" on:click={() => showHistory('file', f.id)}
									>{S.history}</button
								>
							</div>
							{#if canWrite}
								<button
									type="button"
									class="btn s d"
									on:click={() => show({ kind: 'remove', file: f })}>{S.remove_file}</button
								>
							{/if}
						</div>
					{/if}
				{/each}
			</div>
		</section>
	{/if}

	{#if ecase.length}
		<section class="card g8 ecase" data-testid="case-ecase">
			<div class="row g12">
				<h2>{S.section_ecase}</h2>
				<span class="cnt">{ecase.length}</span>
			</div>
			<div class="col">
				{#each ecase as e (e.file_id)}
					{@const f = ecaseFile(e)}
					{@const fs = fileStatus(f, S)}
					{@const key = String(f.id)}
					{@const court = e.court_inventory}
					<div class="li" data-testid="case-file" data-file={f.filename}>
						<div class="col g2 grow">
							<span class="b aw">{f.filename}</span>
							{#if e.label && e.label !== f.filename}<span class="sm mut aw">{e.label}</span>{/if}
							<span class="sm mut">{fileLine(f, 'ecase', S)}</span>
						</div>
						<span class="pill {TONE[fs.tone]}" class:box={f.status === 'blocked'}
							><Icon name={ICON[fs.tone]} />{f.status === 'indexed'
								? S.ecase_state_ready
								: fs.text}</span
						>
						<button
							type="button"
							class="btn s"
							aria-expanded={openFiles.has(key)}
							on:click={() => (openFiles = flip(openFiles, key))}
							data-testid="case-file-actions"
							>{S.file_actions}<Icon name={openFiles.has(key) ? 'u' : 'd'} /></button
						>
					</div>
					{#if court}
						{@const ckey = `f${e.file_id}`}
						{@const shown = courtOpen(ckey, court, courtFlipped)}
						<div class="col g8 ecourt" data-testid="case-court">
							<div class="row sp g8">
								<h3>{S.court_title}</h3>
								<span class="sm mut"
									>{fmt(S.court_counts, { n_court: court.n_court, n_model: court.n_model })}</span
								>
							</div>
							{#if !court.diffs?.length}
								<p class="sm mut">{S.court_no_diffs}</p>
							{:else}
								<div class="row g8 nw as">
									<button
										type="button"
										class="tg small"
										aria-expanded={shown}
										aria-label={shown ? S.collapse : S.expand}
										on:click={() => (courtFlipped = flip(courtFlipped, ckey))}
										><Icon name={shown ? 'u' : 'd'} /></button
									>
									<div class="col g6 grow sm fg2">
										<span class="b fg">{fmt(S.court_diffs_n, { n: court.diffs.length })}</span>
										{#if shown}{#each court.diffs as t}<span class="aw">{t}</span>{/each}{/if}
									</div>
								</div>
							{/if}
						</div>
					{/if}
					{#if openFiles.has(key)}
						<div class="row sp g8 actions" data-testid="case-file-panel">
							<div class="row g8">
								{#if canWrite}
									<button
										type="button"
										class="btn s"
										on:click={() => show({ kind: 'kind', file: f })}>{S.file_kind_change}</button
									>
								{/if}
								<button type="button" class="btn t" on:click={() => showHistory('file', f.id)}
									>{S.history}</button
								>
							</div>
							{#if canWrite}
								<button
									type="button"
									class="btn s d"
									on:click={() => show({ kind: 'remove', file: f })}>{S.remove_file}</button
								>
							{/if}
						</div>
					{/if}
				{/each}
			</div>
		</section>
	{/if}
{/if}

<FormDialog
	bind:open={winOpen}
	title={winTitle}
	{S}
	{submit}
	submitText={win?.kind === 'remove' ? S.remove_file : ''}
	danger={win?.kind === 'remove'}
	testid="case-volumes-dialog"
>
	{#if win?.kind === 'label'}
		<label class="lbl"
			>{S.volume_label_prompt_g}<input
				class="in"
				type="text"
				maxlength="32"
				autocomplete="off"
				bind:value={labelValue}
			/></label
		>
	{:else if win?.kind === 'attach'}
		<p class="md fg2 aw">{win.file.filename}</p>
		<label class="lbl"
			>{S.file_attach_label_g}<input
				class="in"
				type="text"
				maxlength="32"
				autocomplete="off"
				placeholder={S.upload_volume_label_hint}
				bind:value={attachLabel}
			/></label
		>
		<label class="lbl"
			>{S.file_attach_continues}<select class="in" bind:value={attachCont}>
				<option value="">{S.upload_continues_none}</option>
				{#each sorted as v (v.id)}<option value={String(v.id)}>{volumeTitle(v.label, S)}</option
					>{/each}
			</select></label
		>
	{:else if win?.kind === 'kind'}
		<p class="md fg2 aw">{win.file.filename}</p>
		<fieldset>
			<legend class="sm mut">{S.upload_kind_question}</legend>
			<div class="row g6 kinds">
				{#each KINDS as k (k.kind)}
					<label class="opt" class:on={kindValue === k.kind}
						><input type="radio" name="case-file-kind" value={k.kind} bind:group={kindValue} />{S[
							k.key
						]}</label
					>
				{/each}
			</div>
		</fieldset>
	{:else if win?.kind === 'remove'}
		<p class="md fg2 aw">{fmt(S.remove_file_confirm_g, { name: win.file.filename })}</p>
	{/if}
</FormDialog>

<HistoryDialog
	bind:open={historyOpen}
	{state}
	{S}
	entity={history?.entity ?? ''}
	id={history?.id ?? null}
	onReverted={() => state.refresh()}
/>

<style>
	.checklink {
		align-items: center;
		text-decoration: none;
	}
	.facts {
		margin: 0;
		padding-left: 18px;
		list-style: disc;
	}
	.fg {
		color: var(--fg);
	}
	.tg.small {
		flex-basis: 32px;
		height: 32px;
	}
	.filesh {
		padding-bottom: 8px;
	}
	.actions {
		padding: 10px 14px;
		margin-bottom: 12px;
		border-radius: 12px;
		background: var(--soft);
	}
	.sug {
		align-items: center;
		margin-bottom: 12px;
	}
	.btn.clear {
		background: none;
	}
	.ecase {
		padding-bottom: 10px;
	}
	.ecase .li:first-child {
		margin-top: 6px;
	}
	.ecourt {
		padding: 0 0 12px;
	}
	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
		min-width: 0;
	}
	.kinds {
		padding-top: 8px;
	}
	@media (max-width: 720px) {
		.checklink .grow {
			flex-basis: 100%;
		}
		.tg.small {
			flex-basis: 44px;
			height: 44px;
		}
	}
</style>
