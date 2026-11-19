<script lang="ts">
	// ai-dvokat: открытая таблица или перечень мест (макет K-table-open; опись § 2.13) по адресу
	// `/case/<папка>/tables/<номер>`: таблица «документ × вопрос» с ответом, листом и цитатой в ячейке, отметка
	// «проверено» с примечанием, находки списком; выгрузка в Excel; «Дочитать», «Перечитать таблицу», «Дочитать с новым
	// пределом» — цена на кнопке, окно подтверждения — только если цена больше 1 USD. Открытая таблица при
	// переспрашивании обзора не перерисовывается (юрист в ней работает): данные читаются при открытии и порциями по
	// «Показать ещё». Ручки `GET …/tables/<id>?page=`, `PUT …/tables/<id>/checks`, `POST …/tables/<id>/catch-up`,
	// `GET …/tables/<id>/export.xlsx`. Поведение — прежний `sections/tables.js`.
	import { onMount } from 'svelte';
	import type { CaseState } from '$lib/custom/case/casestore';
	import { saveBlob } from '$lib/custom/case/loader';
	import { day } from '$lib/custom/case/mycases';
	import { casePath, errorText, sheetHref } from '$lib/custom/case/sections';
	import { fmt } from '$lib/custom/case/strings';
	import {
		canCheck,
		copyText,
		coverage,
		needsConfirm,
		placeQuery,
		refParts,
		restText,
		sheetText,
		stateText,
		statusTone,
		statusWord,
		summaryText,
		title,
		usd,
		type Cell,
		type Check,
		type Place,
		type Sweep
	} from '$lib/custom/case/tablescore';
	import { caseToast } from '$lib/custom/case/toast';
	import FormDialog from './FormDialog.svelte';
	import Icon from './Icon.svelte';
	import SheetRef from './SheetRef.svelte';

	export let state: CaseState;
	export let S: Record<string, any> = {};
	export let hrefOf: (slug: string) => string;
	export let id: string;
	export let caseName = '';

	type Column = { key: string; title: string; question?: string | null };
	type Row = {
		document_id: number;
		gone?: boolean;
		title?: string;
		label?: string;
		doc_type?: string;
		date?: string;
		first_page_id: number;
		cells: Record<string, Cell>;
	};
	type Ref = {
		state: string;
		raw: string;
		missing?: (string | number)[];
		sheets: (Place & { label: string; how?: string })[];
	};
	type Finding = Place & {
		document?: string | null;
		quote: string;
		also?: Place[];
		refs?: Ref[];
		refs_unparsed?: number;
	};
	type View = {
		sweep: Sweep;
		kind: string;
		columns?: Column[];
		rows?: Row[];
		findings?: Finding[];
		summary?: Record<string, Record<string, number>>;
		total?: number;
		next_page?: number | null;
		end?: boolean;
	};

	const { boot } = state;
	$: canWrite = !!$boot?.can_write;
	const path = (rest = '') => casePath(state, `/tables/${encodeURIComponent(id)}${rest}`);
	const place = (p: Place) => sheetHref(state, p.page_id, placeQuery(p));

	let view: View | null = null;
	let rows: Row[] = [];
	let findings: Finding[] = [];
	let error = '';
	let busy = false;
	async function load(page: number) {
		if (busy) return;
		busy = true;
		try {
			const d = await state.api.get<View>(path(`?page=${page}`));
			view = d;
			if (d.kind === 'table') rows = [...rows, ...(d.rows ?? [])];
			else findings = [...findings, ...(d.findings ?? [])];
			error = '';
		} catch (e) {
			if (view) caseToast(errorText(S, e), true);
			else error = (e as Error).message;
		} finally {
			busy = false;
		}
	}
	onMount(() => void load(0));
	$: sw = view?.sweep;

	let opened = new Set<string>();
	const flip = (key: string) => {
		const next = new Set(opened);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		opened = next;
	};
	const SHEETS = 4; // листов перечня до «ещё N»

	// ---- выгрузка ----
	let exporting = false;
	async function exportXlsx() {
		if (exporting) return;
		exporting = true;
		try {
			const file = await state.api.download(path('/export.xlsx'));
			saveBlob(file.blob, file.name || 'table.xlsx');
		} catch (e) {
			caseToast(errorText(S, e), true);
		} finally {
			exporting = false;
		}
	}

	// ---- дочитать, перечитать ----
	type Action = { text: string; query: string; estimate: unknown; note: string; warn: boolean };
	$: actions = !sw || !canWrite ? [] : sweepActions(sw);
	function sweepActions(s: Sweep): Action[] {
		const out: Action[] = [];
		if (s.stale && s.finished)
			out.push({ text: S.tables_catch_up, query: '', estimate: 0, note: '', warn: false });
		if (!s.stale && s.reader_stale)
			out.push({
				text: s.reread
					? fmt(S.runs_reread_usd, { usd: usd(s.reread.estimate_usd) })
					: S.tables_reread,
				query: '',
				estimate: s.reread ? s.reread.estimate_usd : 0,
				note: s.reread
					? fmt(S.runs_confirm_rest, {
							title: title(s),
							n: s.reread.windows,
							pages: s.reread.pages
						})
					: '',
				warn: false
			});
		if (!s.stale && s.rest) {
			const raise = s.rest.raise_to_usd != null;
			out.push({
				text: raise
					? S.tables_resume_limit
					: fmt(S.runs_resume_usd, { usd: usd(s.rest.estimate_usd) }),
				query: raise ? '?raise_limit=true' : '',
				estimate: s.rest.estimate_usd,
				note: fmt(S.runs_confirm_rest, {
					title: title(s),
					n: s.rest.windows,
					pages: s.rest.pages
				}),
				warn: raise
			});
		}
		return out;
	}
	let back: HTMLAnchorElement;
	let pending: Action | null = null;
	let confirmOpen = false;
	let acting = false;
	async function catchUp(a: Action) {
		const r = await state.api.post<{ cached?: boolean }>(path(`/catch-up${a.query}`));
		caseToast(r?.cached ? S.tables_cached : S.tables_started);
		back.click(); // к перечню проходов: новый проход появится в нём
	}
	async function press(a: Action) {
		if (acting) return;
		if (needsConfirm(a.estimate)) {
			pending = a;
			confirmOpen = true;
			return;
		}
		acting = true;
		try {
			await catchUp(a);
		} catch (e) {
			caseToast(errorText(S, e), true);
		} finally {
			acting = false;
		}
	}

	// ---- отметка «проверено» и примечание ----
	async function sendCheck(
		row: Row,
		col: Column,
		checked: boolean,
		note: string | null | undefined
	) {
		const r = await state.api.request<{ check: Check | null }>('PUT', path('/checks'), {
			document_id: row.document_id,
			column_key: col.key,
			checked,
			note: note == null ? null : note
		});
		row.cells[col.key].check = r.check;
		rows = rows;
	}
	async function toggleCheck(row: Row, col: Column, ev: Event) {
		const box = ev.currentTarget as HTMLInputElement;
		try {
			await sendCheck(row, col, box.checked, row.cells[col.key].check?.note);
		} catch (e) {
			box.checked = !box.checked;
			caseToast(errorText(S, e), true);
		}
	}
	let noteFor: { row: Row; col: Column } | null = null;
	let noteOpen = false;
	let noteText = '';
	function editNote(row: Row, col: Column) {
		noteFor = { row, col };
		noteText = row.cells[col.key].check?.note ?? '';
		noteOpen = true;
	}
	const saveNote = () =>
		noteFor ? sendCheck(noteFor.row, noteFor.col, true, noteText) : undefined;
	const checkText = (check: Check) =>
		fmt(check.stands ? S.tables_checked_by : S.tables_check_stale, {
			who: check.by_name || S.tables_participant,
			when: day(check.at)
		});
	$: columns = view?.columns ?? [];
	$: gridColumns = `230px repeat(${Math.max(1, columns.length)}, minmax(190px, 1fr))`;
	$: gridWidth = `${230 + 200 * Math.max(1, columns.length)}px`;
</script>

<a bind:this={back} href={hrefOf('tables')} hidden aria-hidden="true" tabindex="-1"
	>{S.tables_back}</a
>

<div class="head" data-testid="case-table-head">
	<div class="col g4 grow">
		<a class="ref sm" href={hrefOf('tables')}>{S.runs_back}</a>
		<div class="row g12">
			<h1 class="aw">{sw ? title(sw) : caseName}</h1>
			{#if sw}
				{@const tone = statusTone(sw)}
				<span class="pill {tone}"
					><Icon name={tone === 'i' ? 'clock' : tone ? 'al' : 'ok'} />{statusWord(sw, S)}</span
				>
				{#if sw.parent}<span class="pill">{S.tables_parent}</span>{/if}
			{/if}
		</div>
	</div>
	{#if sw}
		<div class="row g8">
			{#each actions as a (a.text)}
				<button
					type="button"
					class="btn"
					class:p={!a.warn}
					disabled={acting}
					on:click={() => press(a)}
					data-testid="case-table-action">{a.text}</button
				>
			{/each}
			<button type="button" class="btn" disabled={exporting} on:click={exportXlsx}
				><Icon name="dl" />{S.tables_export}</button
			>
		</div>
	{/if}
</div>

{#if error}
	<section class="card" data-testid="case-table-error">
		<div class="col g12 as">
			<span class="pill s"><Icon name="al" />{fmt(S.section_error, { detail: error })}</span>
			<button type="button" class="btn big" on:click={() => load(0)}>{S.retry}</button>
		</div>
	</section>
{:else if !view || !sw}
	<section class="card"><p class="mut" role="status">{S.loading}</p></section>
{:else}
	<div class="col g8" data-testid="case-table-facts">
		{#if !sw.stale && sw.rest}
			<p
				class="sm"
				class:c-warn={sw.rest.raise_to_usd != null}
				class:mut={sw.rest.raise_to_usd == null}
			>
				{restText(sw.rest, S)}
			</p>
		{/if}
		{#if sw.title}<p class="md fg2 aw">{fmt(S.tables_question, { question: sw.question })}</p>{/if}
		<p class="sm mut">{coverage(sw, S, true)}</p>
		{#if sw.text_short || sw.photos}
			<div class="note">
				<Icon name="eye" klass="l" />
				<div class="col g8 grow">
					{#each [{ id: 'short', n: sw.text_short, text: S.tables_text_short_cov, sheets: sw.text_short_sheets ?? [] }, { id: 'photo', n: sw.photos, text: S.tables_photos_cov, sheets: sw.photo_sheets ?? [] }] as g (g.id)}
						{#if g.n}
							{@const all = opened.has(g.id)}
							<p>{fmt(g.text, { n: g.n })}</p>
							{#if g.sheets.length}
								<div class="row g6">
									{#each all ? g.sheets : g.sheets.slice(0, SHEETS) as x (x.page_id)}
										<a class="chipl" href={place(x)} data-sveltekit-reload
											>{x.label || S.tables_col_sheet}</a
										>
									{/each}
									{#if !all && g.sheets.length > SHEETS}
										<button type="button" class="btn s" on:click={() => flip(g.id)}
											>{fmt(S.more_n, { n: g.sheets.length - SHEETS })}</button
										>
									{/if}
								</div>
							{/if}
						{/if}
					{/each}
				</div>
			</div>
		{/if}
		{#if sw.stale}<div class="note">
				<Icon name="al" klass="l" />
				<p>{S.tables_stale}</p>
			</div>{/if}
		{#if sw.reader_stale}
			<div class="note">
				<Icon name="al" klass="l" />
				<p>
					{S.tables_reader_stale}{#if sw.reread}{' '}{fmt(S.tables_reread_note, {
							n: sw.reread.windows,
							pages: sw.reread.pages,
							usd: usd(sw.reread.estimate_usd)
						})}{/if}
				</p>
			</div>
		{/if}
	</div>

	{#if view.kind === 'table'}
		<section class="card" data-testid="case-table">
			<div class="scroll">
				<div
					class="grid t-open"
					style:grid-template-columns={gridColumns}
					style:min-width={gridWidth}
				>
					<div class="hc">{S.tables_col_document}</div>
					{#each columns as c (c.key)}
						<div class="hc" title={c.question || undefined}>
							<span class="b">{c.title}</span><br />{summaryText(view.summary?.[c.key], S)}
						</div>
					{/each}
					{#each rows as r (r.document_id)}
						<div class="dc col g4" data-testid="case-table-doc">
							{#if r.gone}
								<span class="c-warn">{S.tables_doc_gone}</span>
							{:else}
								<a class="b aw doc" href={sheetHref(state, r.first_page_id)} data-sveltekit-reload
									>{r.title || r.label || ''}</a
								>
								<span class="sm mut aw"
									>{[r.label, r.doc_type, r.date].filter(Boolean).join(' · ')}</span
								>
							{/if}
						</div>
						{#each columns as c (c.key)}
							{@const cell = r.cells[c.key]}
							{@const key = `${r.document_id}:${c.key}`}
							<div class="col g6" data-l={c.title} data-testid="case-table-cell">
								{#if cell}
									{#each cell.answers ?? [] as a, n (n)}
										<span class="md aw">{a.value || ''}</span>
										<div class="row g8 sm">
											<SheetRef label={a.label || S.tables_col_sheet} href={place(a)} />
											{#each a.also ?? [] as p}<SheetRef
													label={p.label || S.tables_col_sheet}
													href={place(p)}
												/>{/each}
											{#if a.quote}
												<button
													type="button"
													class="btn t"
													aria-expanded={opened.has(`${key}:${n}`)}
													on:click={() => flip(`${key}:${n}`)}
													>{S.quote_toggle}<Icon
														name={opened.has(`${key}:${n}`) ? 'u' : 'd'}
													/></button
												>
											{/if}
										</div>
										{#if a.quote && opened.has(`${key}:${n}`)}<p class="q sm">{a.quote}</p>{/if}
										{#if a.numbers_unconfirmed}
											<span class="pill w t box"
												><Icon name="al" />{S.tables_numbers_unconfirmed}</span
											>
										{/if}
									{/each}
									{#each cell.copies ?? [] as copy}
										{#if copy.first_page_id != null}
											<a
												class="ref sm"
												href={sheetHref(state, copy.first_page_id)}
												data-sveltekit-reload>{copyText(copy, S)}</a
											>
										{:else}
											<span class="sm">{copyText(copy, S)}</span>
										{/if}
									{/each}
									{#if cell.state === 'code' && !(cell.copies ?? []).length}
										<span class="sm mut">{S.tables_copies_none}</span>
									{/if}
									{#if stateText(cell, S)}<span class="sm mut">{stateText(cell, S)}</span>{/if}
									{#if canCheck(cell, sw, canWrite)}
										<label class="chk"
											><input
												type="checkbox"
												checked={!!cell.check?.stands}
												on:change={(ev) => toggleCheck(r, c, ev)}
											/>{S.tables_check}</label
										>
									{/if}
									{#if cell.check}
										<span
											class="xs"
											class:mut={cell.check.stands}
											class:c-warn={!cell.check.stands}
											title={cell.check.carried ? S.tables_carried : undefined}
										>
											{checkText(cell.check)}{#if cell.check.note}{' — '}{cell.check.note}{/if}
											{#if canCheck(cell, sw, canWrite) && cell.check.stands}
												· <button type="button" class="linkbtn" on:click={() => editNote(r, c)}
													>{S.tables_note_edit}</button
												>
											{/if}
										</span>
									{/if}
								{/if}
							</div>
						{/each}
					{/each}
				</div>
			</div>
		</section>
	{:else}
		<section class="card" data-testid="case-findings">
			<p class="sm mut">{fmt(S.tables_findings_total, { n: view.total ?? findings.length })}</p>
			{#each findings as f, n (n)}
				<div class="li t" data-testid="case-finding">
					<div class="col g6 grow">
						<div class="row g8 sm">
							<SheetRef label={f.label || S.tables_col_sheet} href={place(f)} />
							{#if f.document}<span class="mut aw">· {f.document}</span>{/if}
						</div>
						<p class="q">{f.quote}</p>
						{#if f.also?.length}
							<p class="sm mut">
								{S.tables_also_copies}
								{#each f.also as a, i (i)}{i ? '; ' : ''}<SheetRef
										label={a.label || S.tables_col_sheet}
										href={place(a)}
									/>{/each}
							</p>
						{/if}
						{#each f.refs ?? [] as r}
							{@const parts = refParts(r, S)}
							<p class="sm" class:c-warn={r.state !== 'found'}>
								{parts[0]}{#each r.sheets as s, i (i)}{i ? '; ' : ''}<SheetRef
										label={sheetText(s, S)}
										href={place(s)}
									/>{/each}{parts[1]}
							</p>
						{/each}
						{#if f.refs_unparsed}<p class="sm c-warn">
								{fmt(S.tables_refs_unparsed, { n: f.refs_unparsed })}
							</p>{/if}
					</div>
				</div>
			{/each}
		</section>
	{/if}
	{#if !view.end}
		<div class="row">
			<button
				type="button"
				class="btn"
				disabled={busy}
				on:click={() => load(view?.next_page ?? 0)}
				data-testid="case-table-more">{S.tables_more}</button
			>
		</div>
	{/if}
{/if}

<FormDialog
	bind:open={confirmOpen}
	title={S.runs_confirm_title}
	{S}
	submit={() => (pending ? catchUp(pending) : undefined)}
	submitText={pending?.text ?? ''}
	testid="case-table-confirm"
>
	{#if pending}
		{#if pending.note}<p class="md">{pending.note}</p>{/if}
		{#if sw?.rest?.raise_to_usd != null && pending.warn}<p class="sm fg2">
				{restText(sw.rest, S)}
			</p>{/if}
		<p class="md bb">{fmt(S.runs_confirm_price, { usd: usd(pending.estimate) })}</p>
	{/if}
</FormDialog>

<FormDialog
	bind:open={noteOpen}
	title={S.tables_check_note}
	{S}
	submit={saveNote}
	testid="case-table-note"
>
	<textarea
		class="in"
		rows="3"
		maxlength="500"
		aria-label={S.tables_check_note}
		bind:value={noteText}
	></textarea>
</FormDialog>

<style>
	.doc {
		color: inherit;
	}
	.linkbtn {
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		color: var(--link);
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.card > .li:first-of-type {
		border-top: 0;
	}
	textarea {
		min-height: 84px;
		padding-top: 10px;
		padding-bottom: 10px;
		resize: vertical;
	}
	@media (max-width: 720px) {
		.grid.t-open {
			min-width: 0 !important;
		}
		.linkbtn {
			min-height: 44px;
		}
	}
</style>
