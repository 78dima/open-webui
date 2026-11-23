<script lang="ts">
	// ai-dvokat: открытая таблица или перечень мест (макет K-table-open; опись § 2.13) по адресу
	// `/case/<папка>/tables/<номер>`: таблица «документ × вопрос» с ответом, листом и цитатой в ячейке, отметка
	// «проверено» с примечанием, находки списком; выгрузка в Excel; «Дочитать», «Перечитать таблицу», «Дочитать с новым
	// пределом» — цена на кнопке, окно подтверждения — только если цена больше 1 USD. Открытая таблица при
	// переспрашивании обзора не перерисовывается (юрист в ней работает): данные читаются при открытии и порциями по
	// «Показать ещё». Ручки `GET …/tables/<id>?page=`, `PUT …/tables/<id>/checks`, `POST …/tables/<id>/catch-up`,
	// `GET …/tables/<id>/export.xlsx`. Поведение — прежний `sections/tables.js`.
	import { onDestroy, onMount } from 'svelte';
	import type { CaseState } from '$lib/custom/case/casestore';
	import { saveBlob } from '$lib/custom/case/loader';
	import { inVolume, volumeOf } from '$lib/custom/case/casepage';
	import { day } from '$lib/custom/case/mycases';
	import { casePath, docTitle, errorText, sheetHref, reasonText } from '$lib/custom/case/sections';
	import { fmt } from '$lib/custom/case/strings';
	import {
		canCheck,
		catchUpNote,
		copyText,
		coverage,
		mergeTableRows,
		needsConfirm,
		placeQuery,
		priceText,
		refParts,
		relationWord,
		restText,
		sheetText,
		staleText,
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
	import GotoForm from './GotoForm.svelte';
	import Icon from './Icon.svelte';
	import Busy from './Busy.svelte';
	import SheetRef from './SheetRef.svelte';

	export let state: CaseState;
	export let S: Record<string, any> = {};
	export let hrefOf: (slug: string) => string;
	export let id: string;
	export let caseName = '';
	/** «Открыть лист» в шапке — та же форма, что у остальных разделов (адрес и тома даёт страница дела). */
	export let refAction = '';
	export let volumes: string[] = [];

	type Column = { key: string; title: string; question?: string | null };
	type Row = {
		document_id: number;
		gone?: boolean;
		title?: string;
		title_inventory?: string | null;
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
		title_inventory?: string | null;
		quote: string;
		relation?: string | null;
		other_reading?: boolean;
		quote_changed?: boolean;
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
		total_other_reading?: number;
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
	let loadedId = '';
	let mounted = false;
	let loadedPages = 1;
	let loadSeq = 0;
	async function load(page: number) {
		if (busy) return;
		const reqId = id;
		loadSeq += 1;
		busy = true;
		paged = page > 0;
		try {
			const d = await state.api.get<View>(path(`?page=${page}`));
			if (reqId !== id) return;
			view = d;
			if (page === 0) loadedPages = 1;
			else loadedPages = Math.max(loadedPages, page + 1);
			// порция не повторяет уже показанное (состав мог сдвинуться между порциями): повтор ключа ломал бы список
			if (d.kind === 'table') {
				const seen = new Set(page ? rows.map((r) => r.document_id) : []);
				rows = [...(page ? rows : []), ...(d.rows ?? []).filter((r) => !seen.has(r.document_id))];
			} else findings = [...(page ? findings : []), ...(d.findings ?? [])]; // у находок ключ — место в списке
			error = '';
		} catch (e) {
			if (reqId !== id) return;
			if (view) caseToast(errorText(S, e), true);
			else error = reasonText(S, e);
		} finally {
			if (reqId === id) busy = false;
		}
	}
	// Открытая таблица идущего прохода перечитывает себя раз в 5 с, пока проход не закончен: признак — статус
	// прохода в ответе сервиса (`queued` / `running`), а не таймер. Строки обновляются по месту (`mergeTableRows`),
	// чтобы отметки «проверено» между опросами не откатывались и открытое окно примечания не теряло строку; по
	// окончании прохода перечитывается весь загруженный объём порций, а не только первая (Р-8).
	const LIVE_MS = 5000;
	const live = (s: Sweep | undefined | null) =>
		!!s && (s.status === 'running' || s.status === 'queued');
	let paged = false;
	let checkSeq = 0;
	const cellTouch = new Map<string, number>();
	const inFlightChecks = new Set<string>();
	function protectedChecksSince(startedSeq: number): Set<string> {
		const out = new Set<string>(inFlightChecks);
		for (const [k, s] of cellTouch.entries()) {
			if (s > startedSeq) out.add(k);
		}
		return out;
	}
	async function tick() {
		if (busy || !live(sw) || (typeof document !== 'undefined' && document.hidden)) return;
		const reqId = id;
		const startedSeq = checkSeq;
		const seqAtStart = loadSeq;
		let pagesWanted = loadedPages;
		try {
			const d = await state.api.get<View>(path('?page=0'));
			if (reqId !== id || busy || seqAtStart !== loadSeq) return;
			const guard = protectedChecksSince(startedSeq);
			if (live(d.sweep)) {
				view = paged && view ? { ...view, sweep: d.sweep, summary: d.summary } : d;
				if (d.kind === 'table') rows = mergeTableRows(rows, d.rows ?? [], guard, !paged);
				else if (!paged) findings = d.findings ?? [];
				return;
			}
			// проход закончился: перечитать весь загруженный объём порций, не сбрасывая место и отметки; если юрист
			// нажал «Показать ещё» во время перечитывания — подтягиваем и новую порцию (Ф-11)
			const allRows: Row[] = [...(d.rows ?? [])];
			const allFindings: Finding[] = [...(d.findings ?? [])];
			let lastView = d;
			let p = d.next_page ?? null;
			let got = 1;
			while (got < Math.max(pagesWanted, loadedPages) && p != null && !lastView.end) {
				const more = await state.api.get<View>(path(`?page=${p}`));
				if (reqId !== id) return;
				lastView = more;
				if (more.kind === 'table') allRows.push(...(more.rows ?? []));
				else allFindings.push(...(more.findings ?? []));
				p = more.next_page ?? null;
				got += 1;
			}
			if (reqId !== id || busy) return;
			view = { ...d, next_page: lastView.next_page, end: lastView.end };
			loadedPages = Math.max(got, loadedPages);
			paged = loadedPages > 1;
			const finalGuard = protectedChecksSince(startedSeq);
			if (d.kind === 'table') rows = mergeTableRows(rows, allRows, finalGuard, loadedPages <= got);
			else findings = allFindings;
		} catch {
			// сбой одного перечитывания признака не меняет: следующее — через тот же срок
		}
	}
	let liveTimer: ReturnType<typeof setInterval> | null = null;
	onMount(() => {
		mounted = true;
		loadedId = id;
		void load(0);
		liveTimer = setInterval(() => void tick(), LIVE_MS);
	});
	onDestroy(() => {
		if (liveTimer !== null) clearInterval(liveTimer);
	});
	// переход по ссылке «есть более новый проход» меняет id без пересоздания компонента
	$: if (mounted && id && id !== loadedId) {
		loadedId = id;
		view = null;
		rows = [];
		findings = [];
		opened = new Set();
		error = '';
		busy = false;
		void load(0);
	}
	$: sw = view?.sweep;

	let opened = new Set<string>();
	const flip = (key: string) => {
		const next = new Set(opened);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		opened = next;
	};
	const SHEETS = 4; // листов перечня до «ещё N»
	/** Подпись листа в перечне после первого: без тома, если том тот же («т. 4, л.д. 15» → «л.д. 15»). */
	const within = (label: string | undefined, first: string | undefined) =>
		label ? inVolume(label, volumeOf(first)) : S.tables_col_sheet;

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
	type Action = {
		text: string;
		query: string;
		estimate: unknown;
		note: string;
		warn: boolean;
		/** Заголовок своего окна подтверждения: дочитывание и перечитывание — не «Запустить проход?». */
		title: string;
		/** У какого пояснения стоит кнопка: остаток прохода, изменившееся дело, прежняя версия чтения. */
		where: 'rest' | 'stale' | 'reader';
	};
	$: actions = !sw || !canWrite ? [] : sweepActions(sw);
	function sweepActions(s: Sweep): Action[] {
		const out: Action[] = [];
		// «Дочитать по изменившимся листам» — только у последнего прохода: у прежнего (есть более новый, `newer`) всё уже
		// дочитано новым, повторное «Дочитать» завело бы третий такой же проход (пакет 23.11, Д-7); условие действует и
		// при прежнем сервисе, который ещё присылает оценку
		if (s.stale && s.finished && !s.reader_stale && !s.newer) {
			const cu = s.catch_up;
			if (cu != null) {
				const free = cu.windows === 0;
				out.push({
					text: free
						? S.runs_catch_up_free
						: fmt(S.runs_catch_up_usd, { usd: usd(cu.estimate_usd) }),
					query: '',
					estimate: free ? 0 : cu.estimate_usd,
					note: free
						? ''
						: fmt(S.runs_confirm_rest, { title: title(s), n: cu.windows, pages: cu.pages }),
					warn: false,
					title: S.runs_confirm_catch_up_title,
					where: 'stale'
				});
			} else {
				// прежний ответ сервиса без catch_up: кнопка прежнего вида
				out.push({
					text: S.tables_catch_up,
					query: '',
					estimate: null,
					note: '',
					warn: false,
					title: S.runs_confirm_catch_up_title,
					where: 'stale'
				});
			}
		}
		if (s.reader_stale)
			out.push({
				text: s.reread
					? fmt(S.runs_reread_usd, { usd: usd(s.reread.estimate_usd) })
					: S.tables_reread,
				query: '',
				estimate: s.reread ? s.reread.estimate_usd : null,
				note: s.reread
					? fmt(S.runs_confirm_rest, {
							title: title(s),
							n: s.reread.windows,
							pages: s.reread.pages
						})
					: '',
				warn: false,
				title: S.runs_confirm_reread_title,
				where: 'reader'
			});
		if (!s.stale && !s.reader_stale && s.rest) {
			const raise = s.rest.raise_to_usd != null;
			out.push({
				text: fmt(raise ? S.runs_resume_limit_usd : S.runs_resume_usd, {
					usd: usd(s.rest.estimate_usd)
				}),
				query: raise ? '?raise_limit=true' : '',
				estimate: s.rest.estimate_usd,
				note: fmt(S.runs_confirm_rest, {
					title: title(s),
					n: s.rest.windows,
					pages: s.rest.pages
				}),
				warn: raise,
				title: S.runs_confirm_resume_title,
				where: 'rest'
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
		const cellKey = `${row.document_id}:${col.key}`;
		inFlightChecks.add(cellKey);
		try {
			const r = await state.api.request<{ check: Check | null }>(
				'PUT',
				path('/checks'),
				{
					document_id: row.document_id,
					column_key: col.key,
					checked,
					note: note == null ? null : note
				},
				{ refresh: false }
			);
			row.cells[col.key].check = r.check;
			cellTouch.set(cellKey, ++checkSeq);
			rows = rows;
		} finally {
			inFlightChecks.delete(cellKey);
		}
	}
	// «проверено» строке или столбцу целиком (Р5-7 захода 22.11): сервис ставит отметку каждой ячейке тем же путём
	async function checkMany(body: { document_id?: number; column_key?: string }) {
		try {
			const r = await state.api.request<{ set: number; skipped: number }>(
				'PUT',
				path('/checks/bulk'),
				{ ...body, checked: true },
				{ refresh: false }
			);
			caseToast(fmt(S.tables_check_many_done, { n: r.set, skipped: r.skipped }), false);
			await load(0);
		} catch (e) {
			caseToast(errorText(S, e), true);
		}
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
	{#if refAction}<GotoForm action={refAction} {volumes} {S} />{/if}
	{#if sw}
		<div class="row g8">
			<button
				type="button"
				class="btn"
				disabled={exporting}
				on:click={exportXlsx}
				data-testid="case-table-export"
				><Busy on={exporting} text={S.busy_file}><Icon name="dl" />{S.tables_export}</Busy></button
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
			<!-- остаток частичного прохода и «Дочитать» — одной строкой: действие стоит у своего пояснения (макет) -->
			<div class="note row g12 act" class:n={sw.rest.raise_to_usd == null}>
				<p class="grow">{restText(sw.rest, S)}</p>
				{#each actions.filter((a) => a.where === 'rest') as a (a.text)}
					<button
						type="button"
						class="btn p"
						disabled={acting}
						on:click={() => press(a)}
						data-testid="case-table-action"
						><Busy on={acting} text={S.busy_wait}>{a.text}</Busy></button
					>
				{/each}
			</div>
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
									{#each all ? g.sheets : g.sheets.slice(0, SHEETS) as x, n (x.page_id)}
										<a class="chipl small" href={place(x)} title={x.label} data-sveltekit-reload
											>{n ? within(x.label, g.sheets[0].label) : x.label || S.tables_col_sheet}</a
										>
									{/each}
									{#if !all && g.sheets.length > SHEETS}
										<button type="button" class="btn s clear" on:click={() => flip(g.id)}
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
		{#if sw.newer}
			{#if S.runs_newer_note && S.runs_newer_open}
				<div class="note row g12 act" data-testid="case-table-newer">
					<p class="grow">{S.runs_newer_note}</p>
					<a class="btn p" href={hrefOf(`tables/${sw.newer}`)} data-testid="case-table-newer-open"
						>{S.runs_newer_open}</a
					>
				</div>
			{:else}
				<div class="note i" data-testid="case-table-newer">
					<Icon name="info" klass="l" />
					<p class="sm grow">
						<a class="ref" href={hrefOf(`tables/${sw.newer}`)}>{S.tables_newer}</a>
					</p>
				</div>
			{/if}
		{/if}
		{#if sw.stale}
			<div class="note row g12 act" data-testid="case-table-stale">
				<p class="grow">
					{staleText(sw, S)}{#if sw.catch_up && !sw.reader_stale && !sw.newer}{' '}{catchUpNote(
							sw.catch_up,
							S
						)}{/if}
				</p>
				{#each actions.filter((a) => a.where === 'stale') as a (a.text)}
					<button
						type="button"
						class="btn p"
						disabled={acting}
						on:click={() => press(a)}
						data-testid="case-table-action"
						><Busy on={acting} text={S.busy_wait}>{a.text}</Busy></button
					>
				{/each}
			</div>
		{/if}
		{#if sw.reader_stale}
			<div class="note row g12 act">
				<p class="grow">
					{S.tables_reader_stale}{#if sw.reread}{' '}{fmt(S.tables_reread_note, {
							n: sw.reread.windows,
							pages: sw.reread.pages,
							usd: usd(sw.reread.estimate_usd)
						})}{/if}
				</p>
				{#each actions.filter((a) => a.where === 'reader') as a (a.text)}
					<button
						type="button"
						class="btn p"
						disabled={acting}
						on:click={() => press(a)}
						data-testid="case-table-action"
						><Busy on={acting} text={S.busy_wait}>{a.text}</Busy></button
					>
				{/each}
			</div>
		{/if}
	</div>

	{#if view.kind === 'table'}
		<section class="card grid-card" data-testid="case-table">
			<div class="scroll">
				<div
					class="grid t-open"
					style:grid-template-columns={gridColumns}
					style:min-width={gridWidth}
				>
					<div class="hc">{S.tables_col_document}</div>
					{#each columns as c (c.key)}
						<div class="hc" title={c.question || undefined}>
							<span class="b colname">{c.title}</span><br />{summaryText(view.summary?.[c.key], S)}
							{#if canWrite && sw?.finished}<br /><button
									type="button"
									class="btn t xs"
									data-testid="case-table-check-column"
									on:click={() => checkMany({ column_key: c.key })}>{S.tables_check_column}</button
								>{/if}
						</div>
					{/each}
					{#each rows as r (r.document_id)}
						<div class="dc col g4" data-testid="case-table-doc">
							{#if r.gone}
								<span class="c-warn">{S.tables_doc_gone}</span>
							{:else}
								{@const dt = docTitle(r)}
								<a
									class="aw doc"
									class:b={!dt.unverified}
									class:fg2={dt.unverified}
									href={sheetHref(state, r.first_page_id)}
									data-sveltekit-reload>{dt.text || r.label || ''}</a
								>
								{#if dt.unverified}<span class="xs mut" data-testid="case-doc-title-unverified"
										>{S.inventory_title_unverified}</span
									>{/if}
								<span class="sm mut aw"
									><SheetRef
										label={r.label ?? ''}
										href={sheetHref(state, r.first_page_id)}
									/>{#each [r.doc_type, r.date].filter(Boolean) as t}{' · '}{t}{/each}</span
								>
								{#if canWrite && sw?.finished}<button
										type="button"
										class="btn t xs as"
										data-testid="case-table-check-row"
										on:click={() => checkMany({ document_id: r.document_id })}
										>{S.tables_check_row}</button
									>{/if}
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
										{#if a.quote && opened.has(`${key}:${n}`)}<p class="q pw sm">{a.quote}</p>{/if}
										{#if a.numbers_unconfirmed}
											<span class="pill w t box"
												><Icon name="al" />{S.tables_numbers_unconfirmed}</span
											>
										{/if}
										{#if a.other_reading}
											<span class="pill w t box" data-testid="case-other-reading"
												><Icon name="al" />{S.tables_other_reading}</span
											>
										{/if}
										{#if a.quote_changed}
											<span class="pill w t box" data-testid="case-quote-changed"
												><Icon name="al" />{S.quote_changed}</span
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
			<p class="sm mut" data-testid="case-findings-total">
				{(view.total_other_reading ?? 0) > 0
					? fmt(S.tables_places_other_reading, {
							n: view.total ?? findings.length,
							m: view.total_other_reading
						})
					: fmt(S.tables_findings_total, { n: view.total ?? findings.length })}
			</p>
			{#each findings as f, n (n)}
				<div class="li t" data-testid="case-finding">
					<div class="col g6 grow">
						<div class="row g8 sm">
							<SheetRef label={f.label || S.tables_col_sheet} href={place(f)} />
							{#if relationWord(f.relation, S)}
								<span
									class="pill t"
									class:i={f.relation === 'answers'}
									data-testid="case-finding-relation">{relationWord(f.relation, S)}</span
								>
							{/if}
							{#if f.document}<span class="mut aw">· {f.document}</span
								>{:else if f.title_inventory}<span class="mut aw"
									>· {f.title_inventory} ({S.inventory_title_unverified})</span
								>{/if}
						</div>
						<p class="q pw">{f.quote}</p>
						{#if f.other_reading}
							<div class="row">
								<span class="pill w t box" data-testid="case-other-reading"
									><Icon name="al" />{S.tables_other_reading}</span
								>
							</div>
						{/if}
						{#if f.quote_changed}
							<div class="row">
								<span class="pill w t box" data-testid="case-quote-changed"
									><Icon name="al" />{S.quote_changed}</span
								>
							</div>
						{/if}
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
				data-testid="case-table-more"
				><Busy on={busy} text={S.loading}>{S.tables_more}</Busy></button
			>
		</div>
	{/if}
{/if}

<FormDialog
	bind:open={confirmOpen}
	title={pending?.title ?? S.runs_confirm_title}
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
		<p class="md bb" data-testid="case-table-confirm-price">
			{pending.estimate == null || !Number.isFinite(Number(pending.estimate))
				? S.runs_confirm_no_price
				: priceText(
						S,
						pending.estimate,
						pending.warn && sw?.rest?.raise_to_usd != null ? sw.rest.raise_to_usd : sw?.max_usd
					)}
		</p>
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
	/* длинное действие («Дочитать таблицу по изменившимся листам») на узком экране переносится по словам: кнопка в
	   одну строку раздвигала страницу вбок (ревью 20.11) */
	@media (max-width: 720px) {
		.act :global(.btn) {
			max-width: 100%;
			height: auto;
			padding-top: 10px;
			padding-bottom: 10px;
			white-space: normal;
			text-align: center;
		}
	}

	.act {
		align-items: center;
	}

	.grid-card {
		padding: 12px 24px 14px;
	}
	.chipl.small {
		min-height: 30px;
	}
	.btn.clear {
		background: none;
	}
	.colname {
		color: var(--fg);
	}
	/* «Отметить столбец проверенным» в шапке столбца: кнопка в одну строку шире узкого столбца (от 190 px) и налезала
	   на соседний (пакет 23.11, Д-11) — в шапке она переносится по словам и не выходит за свою ячейку */
	.hc {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.hc .btn {
		max-width: 100%;
		height: auto;
		padding-top: 4px;
		padding-bottom: 4px;
		justify-content: flex-start;
		white-space: normal;
		text-align: left;
	}

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
