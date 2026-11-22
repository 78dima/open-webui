<script lang="ts">
	import { onDestroy } from 'svelte';
	// ai-dvokat: «Опись» (макет K-inventory, окна K-dialogs; опись § 2.7): документы дела с листами — порциями сервиса,
	// отбор по тому, выгрузка в Word и Excel, правка строки («Изменить» с «Историей» внутри), «Разделить»,
	// «Объединить отмеченные: N». Ручки `GET …/documents?page=&volume=`, `PATCH …/documents/<id>`,
	// `POST …/documents/<id>/split`, `POST …/documents/merge`, листы для выбора границ — `GET …/pages`.
	// Опись перечитывается с начала, когда меняется версия дела (как на прежней странице), но не пока открыто окно.
	// Поведение — прежний `case.js` (`loadDocs`, `docRow`, `editDoc`, `splitDoc`, `mergeSelected`).
	import type { CaseState } from '$lib/custom/case/casestore';
	import { saveBlob } from '$lib/custom/case/loader';
	import { day } from '$lib/custom/case/mycases';
	import {
		casePath,
		docNotes,
		docTitle,
		errorText,
		query,
		sheetHref,
		volumesSorted,
		volumeTitle,
		type Doc,
		reasonText
	} from '$lib/custom/case/sections';
	import { fmt } from '$lib/custom/case/strings';
	import { caseToast } from '$lib/custom/case/toast';
	import FormDialog from './FormDialog.svelte';
	import HistoryDialog from './HistoryDialog.svelte';
	import Icon from './Icon.svelte';
	import SheetRef from './SheetRef.svelte';

	export let state: CaseState;
	export let S: Record<string, any> = {};

	type PageRow = { id: number; label: string };
	const { boot, data } = state;
	$: canWrite = !!$boot?.can_write;
	$: volumes = volumesSorted($data?.overview.volumes ?? []);

	let volume = ''; // отбор: номер записи тома или пусто — все тома
	// опись, отбор по тому и отмеченные строки живут, пока открыта страница дела (уход в другой раздел их не сбрасывает)
	const kept = state.keep('inventory', {
		volume: '',
		docs: [] as Doc[],
		total: 0,
		nextPage: 0,
		end: true,
		loaded: false,
		selected: new Map<number, Doc>(),
		version: undefined as number | undefined
	});
	let docs: Doc[] = kept.docs;
	let total = kept.total;
	let nextPage = kept.nextPage;
	let end = kept.end;
	let loaded = kept.loaded;
	let loading = false;
	let error = '';
	let selected = kept.selected;
	let seq = 0;
	volume = kept.volume;
	onDestroy(() =>
		Object.assign(kept, {
			volume,
			docs,
			total,
			nextPage,
			end,
			loaded,
			selected,
			version
		})
	);

	async function load(reset: boolean) {
		const mine = ++seq;
		if (reset) nextPage = 0;
		loading = true;
		try {
			const d = await state.api.get<{
				documents: Doc[];
				total?: number;
				next_page?: number | null;
				end: boolean;
			}>(casePath(state, `/documents${query({ page: String(nextPage), volume })}`));
			if (mine !== seq) return;
			// порция не повторяет уже показанное: состав описи мог сдвинуться между порциями
			const seen = new Set(reset ? [] : docs.map((x) => x.id));
			docs = reset ? d.documents : [...docs, ...d.documents.filter((x) => !seen.has(x.id))];
			if (reset) selected = new Map();
			total = Math.max(d.total ?? 0, docs.length);
			end = d.end;
			nextPage = d.next_page || nextPage;
			error = '';
			loaded = true;
		} catch (e) {
			if (mine !== seq) return;
			error = reasonText(S, e);
			if (loaded) caseToast(errorText(S, e), true);
		} finally {
			if (mine === seq) loading = false;
		}
	}
	// версия дела сменилась (состав или опись) — опись с начала; пока открыто окно правки — подождать
	let version: number | undefined = kept.version;
	let started = false;
	$: if ($data && !started) {
		started = true;
		// вернулись в раздел, а дело не менялось — опись та же, что была (с отбором, порциями и отметками)
		if (!(kept.loaded && kept.version === $data.version)) {
			version = $data.version;
			void load(true);
		}
	}
	$: if ($data && started && $data.version !== version && !winOpen && !historyOpen) {
		version = $data.version;
		void load(true);
	}
	const pickVolume = () => void load(true);

	// ---- выгрузка ----
	let exporting = '';
	async function exportAs(kind: 'docx' | 'xlsx') {
		if (exporting) return;
		exporting = kind;
		try {
			const file = await state.api.download(
				casePath(state, `/export/inventory.${kind}${query({ volume })}`)
			);
			saveBlob(file.blob, file.name || `inventory.${kind}`);
		} catch (e) {
			caseToast(errorText(S, e), true);
		} finally {
			exporting = '';
		}
	}

	// ---- объединить ----
	function toggle(d: Doc, on: boolean) {
		const next = new Map(selected);
		if (on) next.set(d.id, d);
		else next.delete(d.id);
		selected = next;
	}
	let merging = false;
	async function merge() {
		const list = [...selected.values()];
		const places = new Set(
			list.map((d) => `${d.volume_id}:${d.volume_id == null ? d.file_id : ''}`)
		);
		if (list.length < 2 || places.size !== 1) {
			caseToast(S.doc_merge_need_two, true);
			return;
		}
		if (merging) return;
		merging = true;
		try {
			await state.api.post(casePath(state, '/documents/merge'), {
				document_ids: list.map((d) => d.id)
			});
			caseToast(S.saved);
			await load(true);
		} catch (e) {
			caseToast(errorText(S, e), true);
		} finally {
			merging = false;
		}
	}

	// ---- окна: изменить, разделить, история ----
	const pagesOf = async (d: Doc): Promise<PageRow[]> =>
		(
			await state.api.get<{ pages: PageRow[] }>(
				casePath(
					state,
					`/pages${d.volume_id != null ? query({ volume: d.volume_id }) : query({ file: d.file_id })}`
				)
			)
		).pages;
	const FIELDS = [
		'title_as_written',
		'doc_type',
		'date_as_written',
		'date_value',
		'number',
		'author'
	] as const;
	type Form = Record<(typeof FIELDS)[number], string> & {
		first_page_id: string;
		last_page_id: string;
	};
	const original = (d: Doc): Form => ({
		title_as_written: d.title ?? '',
		doc_type: d.doc_type ?? '',
		date_as_written: d.date_as_written ?? '',
		date_value: d.date_value ?? '',
		number: d.number ?? '',
		author: d.author ?? '',
		first_page_id: String(d.first_page_id),
		last_page_id: String(d.last_page_id)
	});
	let win: { kind: 'edit' | 'split'; doc: Doc; pages: PageRow[] } | null = null;
	let winOpen = false;
	let form: Form = original({ id: 0, label: '', first_page_id: 0, last_page_id: 0, sheets: 0 });
	let splitAt = '';
	let opening = 0;
	async function edit(d: Doc) {
		if (opening) return;
		opening = d.id;
		try {
			const pages = await pagesOf(d);
			form = original(d);
			win = { kind: 'edit', doc: d, pages };
			winOpen = true;
		} catch (e) {
			caseToast(errorText(S, e), true);
		} finally {
			opening = 0;
		}
	}
	async function split(d: Doc) {
		if (opening) return;
		opening = d.id;
		try {
			const pages = await pagesOf(d);
			const ids = pages.map((p) => p.id);
			const a = ids.indexOf(d.first_page_id);
			const b = ids.indexOf(d.last_page_id);
			const inside = a >= 0 && b > a ? pages.slice(a + 1, b + 1) : [];
			if (!inside.length) {
				caseToast(S.doc_split_single, true); // документ из одного листа делить нечем
				return;
			}
			splitAt = String(inside[0].id);
			win = { kind: 'split', doc: d, pages: inside };
			winOpen = true;
		} catch (e) {
			caseToast(errorText(S, e), true);
		} finally {
			opening = 0;
		}
	}
	async function submit() {
		if (!win) return;
		if (win.kind === 'split') {
			await state.api.post(casePath(state, `/documents/${win.doc.id}/split`), {
				at_page_id: Number(splitAt)
			});
		} else {
			// уходят только изменённые поля
			const was = original(win.doc);
			const body: Record<string, unknown> = {};
			for (const k of FIELDS) {
				const v = form[k].trim() || null;
				if (v !== (was[k] || null)) body[k] = v;
			}
			for (const k of ['first_page_id', 'last_page_id'] as const) {
				if (form[k] !== was[k]) body[k] = Number(form[k]);
			}
			if (!Object.keys(body).length) return;
			await state.api.request('PATCH', casePath(state, `/documents/${win.doc.id}`), body);
		}
		caseToast(S.saved);
		void load(true);
	}
	let historyId: number | null = null;
	let historyOpen = false;
	function history(id: number) {
		winOpen = false;
		historyId = id;
		historyOpen = true;
	}
	const dateText = (d: Doc) => d.date_as_written || (d.date_value ? day(d.date_value) : '');
	const second = (d: Doc) =>
		[d.number ? fmt(S.doc_number_short, { number: d.number }) : '', d.author ?? '']
			.filter(Boolean)
			.join(' · ');
</script>

<div class="note n" data-testid="case-inventory-note">
	<Icon name="info" klass="l" />
	<p>{S.inventory_note_g_cards}</p>
</div>

<section class="card inv" data-testid="case-inventory">
	<div class="row sp g12 tools">
		<div class="row g8">
			<select
				class="in s"
				aria-label={S.inventory_volume_filter}
				bind:value={volume}
				on:change={pickVolume}
				data-testid="case-inventory-volume"
			>
				<option value="">{S.inventory_filter_all}</option>
				{#each volumes as v (v.id)}<option value={String(v.id)}>{volumeTitle(v.label, S)}</option
					>{/each}
			</select>
			{#if canWrite}
				<button
					type="button"
					class="btn s"
					class:p={selected.size >= 2}
					disabled={merging}
					on:click={merge}
					data-testid="case-inventory-merge"
					>{selected.size ? fmt(S.doc_merge_n, { n: selected.size }) : S.doc_merge}</button
				>
			{/if}
		</div>
		<div class="row g8">
			<button
				type="button"
				class="btn s"
				disabled={exporting === 'docx'}
				on:click={() => exportAs('docx')}><Icon name="dl" />{S.export_docx}</button
			>
			<button
				type="button"
				class="btn s"
				disabled={exporting === 'xlsx'}
				on:click={() => exportAs('xlsx')}><Icon name="dl" />{S.export_xlsx}</button
			>
		</div>
	</div>

	{#if !loaded}
		{#if error}
			<div class="col g12 as" data-testid="case-inventory-error">
				<span class="pill s"><Icon name="al" />{fmt(S.section_error, { detail: error })}</span>
				<button type="button" class="btn big" on:click={() => load(true)}>{S.retry}</button>
			</div>
		{:else}
			<p class="mut" role="status">{S.loading}</p>
		{/if}
	{:else if !docs.length}
		<p class="mut" data-testid="case-inventory-empty">{S.inventory_empty}</p>
	{:else}
		<div class="t-inv" class:ro={!canWrite}>
			<div class="tr th">
				{#if canWrite}<span></span>{/if}
				<span>{S.inventory_col_sheets}</span>
				<span>{S.inventory_col_title}</span>
				<span>{S.inventory_col_type}</span>
				<span>{S.inventory_col_date}</span>
				<span>{S.inventory_col_count}</span>
				<span></span>
			</div>
			{#each docs as d (d.id)}
				{@const notes = docNotes(d, S)}
				{@const date = dateText(d)}
				<div class="tr t" data-testid="case-doc" data-doc={d.id}>
					{#if canWrite}
						<label class="chk"
							><input
								type="checkbox"
								aria-label={S.doc_select}
								checked={selected.has(d.id)}
								on:change={(ev) => toggle(d, ev.currentTarget.checked)}
							/></label
						>
					{/if}
					<span data-l={S.inventory_col_sheets}
						><SheetRef label={d.label} href={sheetHref(state, d.first_page_id)} /></span
					>
					<div class="col g6 as">
						{#if d.title}
							<span class="b aw">{d.title}</span>
						{:else if d.title_inventory}
							<span class="fg2 aw" data-testid="case-doc-title-fallback">{d.title_inventory}</span>
							<span class="xs mut" data-testid="case-doc-title-unverified"
								>{S.inventory_title_unverified}</span
							>
						{:else}
							<span class="mut">—</span>
						{/if}
						{#if second(d)}<span class="sm mut aw">{second(d)}</span>{/if}
						{#if d.edited}<span class="pill t" data-testid="case-doc-edited"
								>{S.inventory_edited}</span
							>{/if}
						{#each notes as t}
							<span class="pill w t" class:box={t.length > 60}><Icon name="al" />{t}</span>
						{/each}
					</div>
					{#if d.doc_type}<span class="md fg2 aw" data-l={S.inventory_col_type}>{d.doc_type}</span
						>{:else}<span></span>{/if}
					{#if date}<span class="md" class:nob={date.length <= 12} data-l={S.inventory_col_date}
							>{date}</span
						>{:else}<span class="md mut" data-l={S.inventory_col_date}>—</span>{/if}
					<span class="md num" data-l={S.inventory_col_count}>{d.sheets}</span>
					<span class="row g4">
						{#if canWrite}
							<button type="button" class="btn t" on:click={() => edit(d)}>{S.doc_edit}</button>
							<!-- «Разделить» — у каждого документа, как на прежней странице: счёт `sheets` — листы без оборотов, а
							     делится документ по страницам внутри него (лист и его оборот — две страницы); делить нечем — так и сказано -->
							<button type="button" class="btn t" on:click={() => split(d)}>{S.doc_split}</button>
						{:else}
							<button type="button" class="btn t" on:click={() => history(d.id)}>{S.history}</button
							>
						{/if}
					</span>
				</div>
			{/each}
			{#if !end || total > docs.length}
				<div class="tr more">
					{#if canWrite}<span></span>{/if}
					<span class="row g12 wide">
						{#if !end}
							<button
								type="button"
								class="btn"
								disabled={loading}
								on:click={() => load(false)}
								data-testid="case-inventory-more"
								>{total > docs.length
									? fmt(S.show_more_n, { n: Math.min(100, total - docs.length) })
									: S.inventory_more}</button
							>
						{/if}
						<span class="sm mut">{fmt(S.shown_of, { n: docs.length, total })}</span>
					</span>
				</div>
			{/if}
		</div>
	{/if}
</section>

<FormDialog
	bind:open={winOpen}
	title={win?.kind === 'split' ? S.doc_split_title : S.doc_edit_title}
	{S}
	{submit}
	submitText={win?.kind === 'split' ? S.doc_split : ''}
	testid="case-doc-dialog"
>
	{#if win?.kind === 'edit'}
		<label class="lbl"
			>{S.doc_field_title}<input
				class="in"
				type="text"
				maxlength="1000"
				bind:value={form.title_as_written}
			/>{#if !win.doc.title && win.doc.title_inventory}<span
					class="xs mut aw"
					data-testid="case-doc-edit-title-hint"
					>{win.doc.title_inventory} · {S.inventory_title_unverified}</span
				>{/if}</label
		>
		<div class="row g12">
			<label class="lbl grow"
				>{S.doc_field_type}<input
					class="in"
					type="text"
					maxlength="200"
					bind:value={form.doc_type}
				/></label
			>
			<label class="lbl grow"
				>{S.doc_field_number}<input
					class="in"
					type="text"
					maxlength="200"
					bind:value={form.number}
				/></label
			>
		</div>
		<div class="row g12">
			<label class="lbl grow"
				>{S.doc_field_date}<input
					class="in"
					type="text"
					maxlength="100"
					bind:value={form.date_as_written}
				/></label
			>
			<label class="lbl grow"
				>{S.doc_field_date_value}<input
					class="in"
					type="date"
					bind:value={form.date_value}
				/></label
			>
		</div>
		<label class="lbl"
			>{S.doc_field_author}<input
				class="in"
				type="text"
				maxlength="500"
				placeholder={S.doc_author_placeholder}
				bind:value={form.author}
			/></label
		>
		<div class="row g12">
			<label class="lbl grow"
				>{S.doc_field_first}<select class="in" bind:value={form.first_page_id}>
					{#each win.pages as p (p.id)}<option value={String(p.id)}>{p.label}</option>{/each}
				</select></label
			>
			<label class="lbl grow"
				>{S.doc_field_last}<select class="in" bind:value={form.last_page_id}>
					{#each win.pages as p (p.id)}<option value={String(p.id)}>{p.label}</option>{/each}
				</select></label
			>
		</div>
	{:else if win?.kind === 'split'}
		{@const dt = docTitle(win.doc)}
		<p class="md fg2 aw">
			{#if dt.text}{dt.text}{#if dt.unverified}{' '}({S.inventory_title_unverified}){/if}{' · '}{/if}{win.doc.label}
		</p>
		<label class="lbl"
			>{S.doc_split_at}<select class="in" bind:value={splitAt}>
				{#each win.pages as p (p.id)}<option value={String(p.id)}>{p.label}</option>{/each}
			</select></label
		>
	{/if}
	<svelte:fragment slot="aside">
		{#if win?.kind === 'edit'}
			<button type="button" class="btn t" on:click={() => win && history(win.doc.id)}
				>{S.history}</button
			>
		{/if}
	</svelte:fragment>
</FormDialog>

<HistoryDialog
	bind:open={historyOpen}
	{state}
	{S}
	entity="document"
	id={historyId}
	onReverted={() => load(true)}
/>

<style>
	.inv {
		padding-bottom: 12px;
	}
	.tools {
		padding-bottom: 12px;
	}
	.t-inv.ro {
		grid-template-columns: minmax(0, 1fr) minmax(0, 3fr) minmax(0, 1fr) min-content min-content min-content;
	}
	.wide {
		grid-column: 2 / -1;
	}
	.t-inv.ro .wide {
		grid-column: 1 / -1;
	}
	.lbl select,
	.lbl input {
		min-width: 0;
		width: 100%;
	}
	.lbl.grow {
		flex-basis: 180px;
	}
</style>
