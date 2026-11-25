<script lang="ts">
	// ai-dvokat: просмотрщик листа (`/case/[folderId]/p/[pageId]`) в дизайне «Г» (полный перенос `sheetg.js` +
	// `page_api._sheet_g` в Svelte-форк).
	import { onDestroy, onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { config } from '$lib/stores';
	import { createCaseApi, type CaseApiError } from '$lib/custom/case/api';
	import { splitLabel, usd, when } from '$lib/custom/case/casepage';
	import { errorText, query, reasonText } from '$lib/custom/case/sections';
	import {
		buildTextSegments,
		caseRefHref,
		codePointsToUtf16,
		copyLine,
		currentSheetHref,
		DEFAULT_IMAGE_WIDTH,
		IMAGE_WIDTHS,
		sheetPageHref,
		utf16ToCodePoints,
		type SheetData,
		type SheetPlace
	} from '$lib/custom/case/sheet';
	import { caseStrings, fmt } from '$lib/custom/case/strings';
	import { caseToast } from '$lib/custom/case/toast';
	import type { CaseState } from '$lib/custom/case/casestore';
	import Busy from './Busy.svelte';
	import Dialog from './Dialog.svelte';
	import GotoForm from './GotoForm.svelte';
	import HistoryDialog from './HistoryDialog.svelte';
	import Icon from './Icon.svelte';
	import StateCard from './StateCard.svelte';

	export let folderId: string;
	export let pageId: string;
	export let search = '';
	export let title = '';

	const api = createCaseApi($config?.custom_ui);
	$: S = $caseStrings ?? {};
	$: caseHref = `/case/${encodeURIComponent(folderId)}`;
	$: refAction = caseRefHref(folderId);

	$: params = new URLSearchParams(search);
	$: vParam = params.get('v');
	$: hlParam = params.get('hl');
	$: pickParam = params.get('pick') === '1';

	let loading = true;
	let error: CaseApiError | null = null;
	let sh: SheetData | null = null;
	let reqSeq = 0;

	// состояние интерфейса
	let activeTab: 'text' | 'image' = 'text';
	let noImage = false;
	let imageWidth: number = DEFAULT_IMAGE_WIDTH;
	let gotoOpen = false;
	let historyOpen = false;
	let recalcOpen = false;
	let recalcBusy = false;

	// правка номера
	let numberInput = '';
	let sideInput = 'face';
	let numberSaving = false;
	let numberError = '';
	let numberDetailsOpen = true;

	// правка текста
	let textEditOpen = false;
	let textInput = '';
	let prefilledText: string | null = null;
	let pickedSel: { a: number; b: number; before: string; display: string } | null = null;
	let textSaving = false;
	let textError = '';
	let hasQuoteSel = false;

	// строка хода и её опрос
	let workState: { kind: string; text: string } | null = null;
	let workTimer: ReturnType<typeof setTimeout> | null = null;
	let workDelay = 5000;

	let textBox: HTMLDivElement | undefined;
	let textAreaEl: HTMLTextAreaElement | undefined;
	let framesEl: SVGSVGElement | undefined;
	let figureEl: HTMLElement | undefined;

	// минимальный state-адаптер для HistoryDialog (ему нужны только api и folderId)
	$: historyState = { api, folderId } as unknown as CaseState;

	$: if (folderId && pageId) void loadSheet(folderId, pageId, vParam, hlParam, pickParam);

	function stopWork() {
		if (workTimer !== null) {
			clearTimeout(workTimer);
			workTimer = null;
		}
	}

	async function loadSheet(
		fid: string,
		pid: string,
		v: string | null,
		hl: string | null,
		pick: boolean
	) {
		const seq = ++reqSeq;
		stopWork();
		loading = true;
		error = null;
		noImage = false;
		numberError = '';
		textError = '';
		pickedSel = null;
		prefilledText = null;
		textInput = '';
		hasQuoteSel = false;
		try {
			const qs = query({ v: v ?? undefined, hl: hl ?? undefined });
			const data = await api.get<SheetData>(
				`api/cases/${encodeURIComponent(fid)}/pages/${encodeURIComponent(pid)}${qs}`
			);
			if (seq !== reqSeq) return;
			sh = data;
			numberInput = data.number_as_written ?? '';
			sideInput = data.side || 'face';
			textEditOpen = pick;
			if (typeof window !== 'undefined') {
				numberDetailsOpen = !window.matchMedia('(max-width:720px)').matches;
				activeTab = window.location.hash === '#image' ? 'image' : 'text';
			}
			if (data.work_note && data.work_note.length >= 2) {
				workState = { kind: data.work_note[0], text: data.work_note[1] };
				workDelay = data.work_note[0] === 'waiting' ? 30000 : 5000;
				scheduleWork(workDelay);
			} else {
				workState = null;
			}
			loading = false;
			await tick();
			if (seq !== reqSeq) return;
			if (typeof window !== 'undefined' && window.location.hash !== '#image') {
				const target =
					(pick ? document.getElementById('sheet-text-pick') : null) ??
					document.getElementById('hl');
				target?.scrollIntoView?.({ block: 'center' });
			}
		} catch (e) {
			if (seq !== reqSeq) return;
			error = e as CaseApiError;
			sh = null;
			loading = false;
		}
	}

	function scheduleWork(ms: number) {
		workDelay = ms;
		stopWork();
		workTimer = setTimeout(pollWork, ms);
	}

	async function pollWork() {
		workTimer = null;
		if (typeof document !== 'undefined' && document.hidden) {
			scheduleWork(workDelay);
			return;
		}
		try {
			const d = await api.get<{
				sheet_note?: [string, string] | null;
				cards_failed?: number;
			}>(`api/cases/${encodeURIComponent(folderId)}/work`, { timeoutMs: 15000 });
			if (!d || !('sheet_note' in d)) {
				stopWork();
				return;
			}
			const note = d.sheet_note;
			if (!note) {
				stopWork();
				const cf = Number(d.cards_failed) || 0;
				if (cf > 0 && S.sheet_work_done_failed) {
					workState = { kind: 'done_failed', text: fmt(S.sheet_work_done_failed, { n: cf }) };
				} else if (sh?.card && !sh.card.queued && S.sheet_work_done_card) {
					workState = { kind: 'done_card', text: S.sheet_work_done_card };
				} else {
					workState = { kind: 'done', text: S.sheet_work_done ?? '' };
				}
				return;
			}
			workState = { kind: note[0], text: note[1] };
			scheduleWork(note[0] === 'waiting' ? 30000 : 5000);
		} catch (e) {
			const err = e as CaseApiError;
			if (err?.status === 404 || err?.status === 403) {
				stopWork();
				workState = null;
				return;
			}
			scheduleWork(workDelay);
		}
	}

	$: labelParts = splitLabel(sh?.label ?? '');
	$: title = sh?.label || S.sheet_text || '';
	$: backText = (sh?.case_title ?? '').trim()
		? fmt(S.back_to_case_g, { title: sh?.case_title })
		: S.back_to_case_plain;

	$: checks = (() => {
		if (!sh) return [] as string[];
		const list = (sh.flags ?? []).map((f) => f.text);
		if (sh.reading_note && sh.reading_note_page === S.reading_model_g) {
			list.push(sh.reading_note_page);
		}
		return list;
	})();

	$: readingSub =
		sh && !(sh.reading_note && sh.reading_note_page === S.reading_model_g)
			? (sh.reading_note_page ?? null)
			: null;

	$: lawyerLine = (() => {
		const law = sh?.lawyer;
		if (!law?.line) return '';
		if (law.at) {
			return fmt(S.sheet_text_by_lawyer, {
				n: law.n,
				who: law.who ?? '',
				when: when(law.at)
			});
		}
		return law.line;
	})();

	$: boxes = (sh?.boxes ?? []).filter((b) => Array.isArray(b) && b.length === 4);
	$: segments = buildTextSegments(sh?.text ?? '', sh?.hl, sh?.edited_spans);
	$: imageBase = api.url(
		`api/cases/${encodeURIComponent(folderId)}/pages/${encodeURIComponent(pageId)}/image`
	);
	$: imageSrcset = IMAGE_WIDTHS.map((w) => `${imageBase}?w=${w} ${w}w`).join(', ');

	$: readOnlyNumberLine = (() => {
		if (!sh) return '';
		const num = (sh.number_as_written ?? '').trim();
		const sideStr = S[`side_${sh.side || 'face'}`] ?? '';
		const parts = [
			num ? fmt(S.sheet_number_line, { number: num, side: sideStr }) : '',
			sh.number_note_page ?? ''
		].filter(Boolean);
		return parts.join(' · ');
	})();

	// ---- выделение текста и копирование ----
	function offsetIn(container: Node, node: Node, offset: number): number {
		const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
		let pos = 0;
		let n: Node | null;
		while ((n = walker.nextNode())) {
			if (n === node) return pos + offset;
			pos += (n.nodeValue ?? '').length;
		}
		if (node === container) {
			let count = 0;
			for (let i = 0; i < offset && i < container.childNodes.length; i++) {
				count += (container.childNodes[i].textContent ?? '').length;
			}
			return count;
		}
		return pos;
	}

	function currentSelection(): { a: number; b: number; text: string } | null {
		if (!textBox || typeof window === 'undefined' || !window.getSelection) return null;
		const sel = window.getSelection();
		if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
		const r = sel.getRangeAt(0);
		if (!textBox.contains(r.startContainer) || !textBox.contains(r.endContainer)) return null;
		const a = offsetIn(textBox, r.startContainer, r.startOffset);
		const b = offsetIn(textBox, r.endContainer, r.endOffset);
		const text = sel.toString().replace(/\s+/g, ' ').trim();
		return b > a && text ? { a, b, text } : null;
	}

	function onSelectionChange() {
		const s = currentSelection();
		hasQuoteSel = !!(s && sh?.read_id);
		if (!s || !textBox || !sh?.can_write || !sh?.text_editable) return;
		const whole = textBox.textContent ?? '';
		const before = whole.slice(s.a, s.b);
		pickedSel = {
			a: utf16ToCodePoints(whole, s.a),
			b: utf16ToCodePoints(whole, s.b),
			before,
			display: s.text
		};
		if (
			typeof document !== 'undefined' &&
			document.activeElement !== textAreaEl &&
			(textInput === '' || textInput === prefilledText)
		) {
			textInput = before;
			prefilledText = before;
		}
	}

	async function copyText(text: string) {
		if (navigator.clipboard && window.isSecureContext) {
			await navigator.clipboard.writeText(text);
			return;
		}
		const ta = document.createElement('textarea');
		ta.className = 'offscreen';
		ta.readOnly = true;
		ta.value = text;
		document.body.appendChild(ta);
		ta.select();
		const ok = document.execCommand('copy');
		ta.remove();
		if (!ok) throw new Error(S.error_no_answer);
	}

	async function onCopy() {
		if (!sh) return;
		const fullUrl =
			typeof window !== 'undefined'
				? new URL(sheetPageHref(folderId, sh.page_id), window.location.origin).toString()
				: sheetPageHref(folderId, sh.page_id);
		const line = copyLine(sh.label, fullUrl, sh.read_id, currentSelection());
		try {
			await copyText(line);
			caseToast(S.sheet_copied);
		} catch (e) {
			caseToast(errorText(S, e), true);
		}
	}

	function showOnImage() {
		activeTab = 'image';
		void tick().then(() => {
			const target = framesEl?.querySelector('rect') ?? figureEl;
			target?.scrollIntoView?.({ block: 'center' });
		});
	}

	// ---- выделение места расхождения в тексте ----
	function nodeAt(pos: number): { node: Node; offset: number } | null {
		if (!textBox) return null;
		const walker = document.createTreeWalker(textBox, NodeFilter.SHOW_TEXT);
		let n: Node | null;
		let acc = 0;
		let last: Node | null = null;
		while ((n = walker.nextNode())) {
			last = n;
			const len = (n.nodeValue ?? '').length;
			if (pos <= acc + len) return { node: n, offset: pos - acc };
			acc += len;
		}
		return last ? { node: last, offset: (last.nodeValue ?? '').length } : null;
	}

	function selectPlace(p: SheetPlace) {
		if (!textBox || typeof window === 'undefined' || !window.getSelection) return;
		const whole = textBox.textContent ?? '';
		const [st, en] = p.shown ?? [p.start, p.end];
		const a = nodeAt(codePointsToUtf16(whole, st));
		const b = nodeAt(codePointsToUtf16(whole, en));
		if (!a || !b) return;
		activeTab = 'text';
		void tick().then(() => {
			const sel = window.getSelection();
			if (!sel) return;
			sel.removeAllRanges();
			const range = document.createRange();
			range.setStart(a.node, a.offset);
			range.setEnd(b.node, b.offset);
			sel.addRange(range);
			a.node.parentElement?.scrollIntoView?.({ block: 'center' });
		});
	}

	// ---- сохранение номера / текста / пересчёт карточки ----
	async function reloadCurrent(message: string) {
		caseToast(message);
		const cur = currentSheetHref($page.url);
		if (cur !== $page.url.pathname + $page.url.search + $page.url.hash) {
			await goto(cur, { replaceState: true });
		} else {
			await loadSheet(folderId, pageId, null, null, false);
		}
	}

	async function saveNumber() {
		if (!sh || numberSaving) return;
		numberSaving = true;
		numberError = '';
		try {
			await api.request(
				'PATCH',
				`api/cases/${encodeURIComponent(folderId)}/pages/${encodeURIComponent(pageId)}`,
				{ number_as_written: numberInput.trim() || null, side: sideInput }
			);
			caseToast(S.saved);
			await loadSheet(folderId, pageId, vParam, hlParam, pickParam);
		} catch (e) {
			numberError = errorText(S, e);
		} finally {
			numberSaving = false;
		}
	}

	async function sendTextEdit(payload: {
		start: number;
		end: number;
		before: string;
		after: string;
		how: 'text' | 'choice';
	}) {
		if (!sh || textSaving) return;
		textSaving = true;
		textError = '';
		try {
			await api.post(
				`api/cases/${encodeURIComponent(folderId)}/pages/${encodeURIComponent(pageId)}/text`,
				{ ...payload, read_id: sh.read_id }
			);
			await reloadCurrent(S.saved);
		} catch (e) {
			textError = errorText(S, e);
		} finally {
			textSaving = false;
		}
	}

	function onTextFormSubmit() {
		if (!pickedSel) {
			textError = errorText(S, new Error(S.sheet_text_select_first));
			return;
		}
		void sendTextEdit({
			start: pickedSel.a,
			end: pickedSel.b,
			before: pickedSel.before,
			after: textInput,
			how: 'text'
		});
	}

	function onChoosePlace(p: SheetPlace, value: string) {
		const [st, en] = p.shown ?? [p.start, p.end];
		void sendTextEdit({ start: st, end: en, before: p.a, after: value, how: 'choice' });
	}

	async function recalcCard() {
		if (!sh?.card || recalcBusy) return;
		recalcBusy = true;
		try {
			await api.post(
				`api/cases/${encodeURIComponent(folderId)}/documents/${sh.card.document_id}/card`
			);
			recalcOpen = false;
			caseToast(S.sheet_card_queued);
			await loadSheet(folderId, pageId, vParam, hlParam, pickParam);
		} catch (e) {
			caseToast(errorText(S, e), true);
		} finally {
			recalcBusy = false;
		}
	}

	// ---- горячие клавиши стрелок влево/вправо ----
	function onKeyDown(ev: KeyboardEvent) {
		if (
			ev.altKey ||
			ev.ctrlKey ||
			ev.metaKey ||
			gotoOpen ||
			historyOpen ||
			recalcOpen ||
			!sh ||
			sh.removed
		)
			return;
		const t = ev.target as HTMLElement | null;
		if (t?.closest?.('input,textarea,select,dialog[open]')) return;
		if (ev.key === 'ArrowLeft' && sh.prev) {
			void goto(sheetPageHref(folderId, sh.prev));
		} else if (ev.key === 'ArrowRight' && sh.next) {
			void goto(sheetPageHref(folderId, sh.next));
		}
	}

	onMount(() => {
		document.addEventListener('selectionchange', onSelectionChange);
		document.addEventListener('keydown', onKeyDown);
	});
	onDestroy(() => {
		stopWork();
		if (typeof document !== 'undefined') {
			document.removeEventListener('selectionchange', onSelectionChange);
			document.removeEventListener('keydown', onKeyDown);
		}
	});
</script>

<div
	class="shell sheet-shell"
	class:t-img={activeTab === 'image' && !noImage}
	class:t-text={activeTab !== 'image' || noImage}
	class:noimg={noImage}
	data-testid="case-sheet"
>
	<main class="main" id="main-content">
		{#if loading}
			<p class="mut" role="status">{S.loading}</p>
		{:else if error}
			{#if error.kind === 'not_found'}
				<StateCard icon="folder" title={S.not_found} testid="sheet-error">
					<a class="btn big act" href="/case">{S.back_to_cases}</a>
				</StateCard>
			{:else}
				<StateCard
					icon="al"
					tone="stop"
					title={error.kind === 'auth'
						? S.login_needed
						: error.kind === 'network'
							? S.my_cases_error_network_title
							: fmt(S.section_error, { detail: reasonText(S, error) })}
					testid="sheet-error"
				>
					<button
						type="button"
						class="btn big p act"
						on:click={() => loadSheet(folderId, pageId, vParam, hlParam, pickParam)}
					>
						<Icon name="retry" size={18} />{S.retry}
					</button>
					<a class="btn big" href="/case">{S.back_to_cases}</a>
				</StateCard>
			{/if}
		{:else if sh}
			<!-- Верх на телефоне -->
			<div class="top">
				<a class="rb" href={caseHref} aria-label={S.back_to_case_aria}>
					<Icon name="back" klass="l" />
				</a>
				<span class="grow sm nob ttl">{sh.case_title ?? ''}</span>
				{#if sh.volumes?.length}
					<button type="button" class="btn p" on:click={() => (gotoOpen = true)}>
						{S.goto_short}
					</button>
				{/if}
			</div>

			{#if sh.removed}
				<!-- Удалённый лист -->
				<div class="head">
					<div class="col g4 grow">
						<a class="ref sm only-w" href={caseHref}>{backText}</a>
					</div>
					<div class="col g12 ae only-w">
						<GotoForm
							action={refAction}
							volumes={sh.volumes ?? []}
							{S}
							initialVolume={sh.volume_label ?? ''}
						/>
					</div>
				</div>
				<section class="col g8 state" data-testid="sheet-removed">
					<h1 class="h2">{sh.removed_text}</h1>
					{#if sh.removed_facts}
						{@const rf = sh.removed_facts}
						{@const fname = rf.filename || '…'}
						<p class="md">
							{rf.label
								? fmt(S.sheet_removed_was, { label: rf.label, name: fname })
								: fmt(S.sheet_removed_was_page, { page: rf.page_no ?? '?', name: fname })}
						</p>
						<p class="md">
							{rf.by === 'replaced'
								? fmt(S.sheet_removed_replaced, { old: fname, new: rf.new_filename || '…' })
								: fmt(S.sheet_removed_file_removed, { name: fname })}
						</p>
						{#if rf.same?.length}
							<div class="note n col8" id="sheet-same">
								<p class="sm">{S.sheet_removed_same}</p>
								<div class="row g8">
									{#each rf.same as x (x.page_id)}
										<a
											class="btn p"
											data-same-sheet
											href={sheetPageHref(folderId, x.page_id)}
										>
											{fmt(S.sheet_removed_same_open, {
												label: x.label || '',
												name: x.filename || '…'
											})}
										</a>
									{/each}
								</div>
							</div>
						{:else if rf.label}
							<p class="md" id="sheet-same-none">
								{fmt(S.sheet_removed_none, { label: rf.label })}
							</p>
						{:else}
							<p class="md" id="sheet-same-none">{S.sheet_removed_no_number}</p>
						{/if}
					{/if}
					<a class="ref sm" href={caseHref}>{S.back_to_case_plain}</a>
				</section>
			{:else}
				<!-- Шапка листа -->
				<div class="head">
					<div class="col g4 grow">
						<a class="ref sm only-w" href={caseHref}>{backText}</a>
						<h1 class="lbl1" id="sheet-label">
							{labelParts.main}{#if labelParts.file}{' '}<span class="fn">{labelParts.file}</span
								>{/if}
						</h1>
						{#if sh.doc_title}
							<span class="md fg2">{sh.doc_title}</span>
						{/if}
						{#if sh.number_note_page}
							<span class="sm mut" id="sheet-number-note">{sh.number_note_page}</span>
						{/if}
					</div>
					<div class="col g12 ae only-w">
						<GotoForm
							action={refAction}
							volumes={sh.volumes ?? []}
							{S}
							initialVolume={sh.volume_label ?? ''}
						/>
						<nav class="pager" aria-label={S.sheet_pager}>
							{#if sh.prev}
								<a class="btn" rel="prev" href={sheetPageHref(folderId, sh.prev)}>
									<Icon name="back" />{S.sheet_prev}
								</a>
							{:else}
								<button type="button" class="btn" disabled>
									<Icon name="back" />{S.sheet_prev}
								</button>
							{/if}
							<button
								type="button"
								class="btn p"
								on:mousedown|preventDefault
								on:click={onCopy}
								data-testid="sheet-copy"
							>
								{hasQuoteSel ? S.sheet_copy_quote : S.sheet_copy_g}
							</button>
							{#if sh.next}
								<a class="btn" rel="next" href={sheetPageHref(folderId, sh.next)}>
									{S.sheet_next}<Icon name="fwd" />
								</a>
							{:else}
								<button type="button" class="btn" disabled>
									{S.sheet_next}<Icon name="fwd" />
								</button>
							{/if}
						</nav>
					</div>
				</div>

				<!-- Половины разворота -->
				{#if sh.halves?.length}
					<div class="row g8">
						<span class="sm mut">{S.sheet_spread}</span>
						{#each sh.halves as h (h.page_id)}
							{@const hp = splitLabel(h.label)}
							<a class="chipl" href={sheetPageHref(folderId, h.page_id)}>
								{hp.main}{#if hp.file}{' '}<span class="fn">{hp.file}</span>{/if}
							</a>
						{/each}
					</div>
				{/if}

				<!-- Старая версия текста -->
				{#if sh.old_version}
					<div class="note n row g12 vc" data-testid="sheet-old-version">
						<span class="grow">
							<span>{S.sheet_version_old}</span>
							<span>{S.sheet_version_check}</span>
						</span>
						<a class="btn s" href={sheetPageHref(folderId, sh.page_id)}>
							{S.sheet_version_current}
						</a>
					</div>
				{/if}

				<!-- Лист без номера (открытая форма правки) -->
				{#if sh.number_missing && sh.can_write}
					<section class="note col10" id="sheet-edit">
						<p class="row g8 bb"><Icon name="pen" klass="l cw" />{S.sheet_number_missing}</p>
						<form class="row g12 ae" on:submit|preventDefault={saveNumber}>
							<label class="lbl f120">
								{S.sheet_number_edit}
								<input
									class="in"
									type="text"
									name="number"
									maxlength="32"
									autocomplete="off"
									bind:value={numberInput}
								/>
							</label>
							<label class="lbl f140">
								{S.sheet_side}
								<select class="in" name="side" bind:value={sideInput}>
									<option value="face">{S.side_face}</option>
									<option value="back">{S.side_back}</option>
									<option value="unknown">{S.side_unknown}</option>
								</select>
							</label>
							<button type="submit" class="btn p" disabled={numberSaving}>
								<Busy on={numberSaving} text={S.busy_saving}>{S.save}</Busy>
							</button>
							<button type="button" class="btn t" on:click={() => (historyOpen = true)}>
								{S.history}
							</button>
						</form>
						{#if numberError}
							<p class="sm b c-stop" role="alert">{numberError}</p>
						{/if}
					</section>
				{/if}

				<!-- Строка хода обработки по делу -->
				{#if workState}
					<div
						class="note"
						class:i={workState.kind === 'runs'}
						class:n={workState.kind === 'done' || workState.kind === 'done_card'}
						id="sheet-work"
						role="status"
						data-work={workState.kind}
					>
						{#if workState.kind === 'runs' || workState.kind === 'waits'}
							<Icon name="clock" klass="l" />
						{/if}
						<p id="sheet-work-text">{workState.text}</p>
					</div>
				{/if}

				<!-- Пометки «Сверьте по изображению» -->
				{#if checks.length}
					<section class="note col8" id="sheet-checks">
						<h3 class="row g8"><Icon name="eye" klass="l cw" />{S.sheet_flags_g}</h3>
						<ul class="col g4 sm flags">
							{#each checks as c, idx (idx)}
								<li>{c}</li>
							{/each}
						</ul>
					</section>
				{/if}

				<!-- Переключатель Текст / Изображение на телефоне -->
				<div class="seg tabs" role="group" aria-label={S.sheet_tabs}>
					<button
						type="button"
						class:on={activeTab === 'text'}
						aria-pressed={activeTab === 'text'}
						on:click={() => (activeTab = 'text')}
					>
						{S.sheet_tab_text}
					</button>
					<button
						type="button"
						class:on={activeTab === 'image'}
						aria-pressed={activeTab === 'image'}
						on:click={() => (activeTab = 'image')}
					>
						{S.sheet_tab_image}
					</button>
				</div>

				<!-- Две колонки: скан + текст -->
				<div class="sheet2">
					<section class="card g12 p-img" id="image">
						<figure class="sheet-fig" id="sheet-figure" bind:this={figureEl}>
							<img
								id="sheet-img"
								src="{imageBase}?w={imageWidth}"
								srcset={imageWidth === DEFAULT_IMAGE_WIDTH ? imageSrcset : undefined}
								sizes="(min-width: 721px) 50vw, 100vw"
								alt={fmt(S.sheet_image_alt, { label: sh.label })}
								decoding="async"
								on:error={() => {
									noImage = true;
									activeTab = 'text';
								}}
							/>
							{#if boxes.length}
								<svg
									class="hlsvg"
									id="sheet-frames"
									bind:this={framesEl}
									viewBox="0 0 1 1"
									preserveAspectRatio="none"
									aria-hidden="true"
								>
									{#each boxes as b, i (i)}
										<rect
											class="hl"
											x={b[0]}
											y={b[1]}
											width={Math.max(0, b[2] - b[0])}
											height={Math.max(0, b[3] - b[1])}
											vector-effect="non-scaling-stroke"
										/>
									{/each}
								</svg>
							{/if}
						</figure>
						<div class="row sp g8">
							{#if boxes.length}
								<span class="sm mut">{S.sheet_image_hint}</span>
							{/if}
							<div class="row g8" class:mla={!boxes.length}>
								<select
									class="in s"
									aria-label={S.sheet_zoom}
									bind:value={imageWidth}
									data-testid="sheet-width"
								>
									{#each IMAGE_WIDTHS as w (w)}
										<option value={w}>{w} px</option>
									{/each}
								</select>
								<a
									class="btn s"
									href="{imageBase}?w={IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1]}"
									target="_blank"
									rel="noopener"
								>
									<Icon name="zoom" />{S.sheet_zoom}
								</a>
							</div>
						</div>
					</section>

					<div class="col g16 p-text" id="text">
						<section class="card g12">
							<div class="row sp g8">
								<h2>{S.sheet_text}</h2>
								{#if boxes.length && !noImage}
									<button type="button" class="btn s only-n" on:click={showOnImage}>
										<Icon name="eye" />{S.sheet_show_on_image}
									</button>
								{/if}
							</div>
							{#if readingSub}
								<span class="sm mut">{readingSub}</span>
							{/if}
							{#if lawyerLine}
								<span class="sm mut" id="sheet-text-lawyer">{lawyerLine}</span>
							{/if}
							{#if sh.text}
								<div class="txt pre" id="sheet-text" bind:this={textBox}>
									{#each segments as seg, idx (idx)}
										{#if seg.hl && seg.edited}
											<mark id={segments.findIndex((x) => x.hl) === idx ? 'hl' : undefined}
												><mark class="ed" title={S.sheet_text_edited_title}>{seg.text}</mark></mark
											>
										{:else if seg.hl}
											<mark id={segments.findIndex((x) => x.hl) === idx ? 'hl' : undefined}
												>{seg.text}</mark
											>
										{:else if seg.edited}
											<mark class="ed" title={S.sheet_text_edited_title}>{seg.text}</mark>
										{:else}
											{seg.text}
										{/if}
									{/each}
								</div>
								<p class="sm mut">{S.sheet_copy_hint}</p>
							{:else}
								<span class="pill i sfs"><Icon name="clock" />{S.sheet_no_text}</span>
							{/if}
						</section>

						<!-- Правка текста листа -->
						{#if sh.can_write && sh.text_editable}
							<section class="card">
								<details id="sheet-text-edit" bind:open={textEditOpen}>
									<summary class="row sp g8 nw">
										<h3>
											{sh.places?.length
												? fmt(S.sheet_text_edit_title_n, { n: sh.places.length })
												: S.sheet_text_edit_title}
										</h3>
										<span class="tg"><Icon name="d" klass="l" /></span>
									</summary>
									<div class="col g12 dbody">
										<p class="sm mut">{S.sheet_text_edit_hint}</p>
										{#if sh.places?.length}
											<div class="col g4">
												<h3 class="sm b">{S.sheet_text_places}</h3>
												<ul class="col" id="sheet-text-places">
													{#each sh.places as p, i (i)}
														{@const isPicked =
															pickParam &&
															sh.hl &&
															p.start === sh.hl[0] &&
															p.end === sh.hl[1]}
														<li
															class="li t"
															id={isPicked ? 'sheet-text-pick' : undefined}
															data-pick={isPicked ? '' : undefined}
														>
															<button
																type="button"
																class="btn t grow place-btn"
																on:click={() => selectPlace(p)}
															>
																{p.b
																	? fmt(S.sheet_text_place, { a: p.a, b: p.b })
																	: fmt(S.sheet_text_place_single, { a: p.a })}
															</button>
															<span class="row g8">
																{#each p.b ? [p.a, p.b] : [p.a] as val, vi (vi)}
																	<button
																		type="button"
																		class="btn s"
																		disabled={textSaving}
																		on:click={() => onChoosePlace(p, val)}
																	>
																		{fmt(S.sheet_text_keep, { v: val })}
																	</button>
																{/each}
															</span>
														</li>
													{/each}
												</ul>
											</div>
										{/if}
										<form class="col g8" on:submit|preventDefault={onTextFormSubmit}>
											<p class="sm b" id="sheet-text-sel">
												{pickedSel
													? fmt(S.sheet_text_selected, { text: pickedSel.display })
													: S.sheet_text_select_first}
											</p>
											<label class="lbl">
												{S.sheet_text_new}
												<textarea
													class="in"
													name="text"
													rows="2"
													maxlength="5000"
													autocomplete="off"
													bind:this={textAreaEl}
													bind:value={textInput}
												></textarea>
											</label>
											<div class="row g8">
												<button type="submit" class="btn p" disabled={textSaving}>
													<Busy on={textSaving} text={S.busy_saving}>{S.save}</Busy>
												</button>
												<button
													type="button"
													class="btn t"
													on:click={() => (historyOpen = true)}
												>
													{S.history}
												</button>
											</div>
										</form>
										{#if textError}
											<p class="sm b c-stop" role="alert">{textError}</p>
										{/if}
										{#if sh.card && !sh.card.queued}
											<div class="note n col8" id="sheet-card">
												<p class="sm">{S.sheet_card_stale}</p>
												<p class="sm">
													{fmt(S.sheet_card_price, { usd: usd(sh.card.estimate_usd) })}
												</p>
												<button
													type="button"
													class="btn s"
													on:click={() => (recalcOpen = true)}
												>
													{S.sheet_card_recalc}
												</button>
											</div>
										{:else if sh.card}
											<div class="note n" id="sheet-card">
												<p class="sm">{S.sheet_card_queued}</p>
											</div>
										{/if}
									</div>
								</details>
							</section>
						{/if}

						<!-- Правка номера листа (или чтение + история) -->
						{#if sh.can_write && !sh.number_missing}
							<section class="card">
								<details id="sheet-edit" bind:open={numberDetailsOpen}>
									<summary class="row sp g8 nw">
										<h3>{S.sheet_number_title}</h3>
										<span class="tg"><Icon name="d" klass="l" /></span>
									</summary>
									<div class="col g12 dbody">
										<p class="sm mut">{S.sheet_number_hint}</p>
										<form class="row g12 ae" on:submit|preventDefault={saveNumber}>
											<label class="lbl f120">
												{S.sheet_number_edit}
												<input
													class="in"
													type="text"
													name="number"
													maxlength="32"
													autocomplete="off"
													bind:value={numberInput}
												/>
											</label>
											<label class="lbl f140">
												{S.sheet_side}
												<select class="in" name="side" bind:value={sideInput}>
													<option value="face">{S.side_face}</option>
													<option value="back">{S.side_back}</option>
													<option value="unknown">{S.side_unknown}</option>
												</select>
											</label>
											<button type="submit" class="btn p" disabled={numberSaving}>
												<Busy on={numberSaving} text={S.busy_saving}>{S.save}</Busy>
											</button>
											<button
												type="button"
												class="btn t"
												on:click={() => (historyOpen = true)}
											>
												{S.history}
											</button>
										</form>
										{#if numberError}
											<p class="sm b c-stop" role="alert">{numberError}</p>
										{/if}
									</div>
								</details>
							</section>
						{:else if !sh.can_write}
							<section class="card g12" id="sheet-number">
								<div class="row sp g8">
									<h3>{S.sheet_number_edit}</h3>
									<button type="button" class="btn t" on:click={() => (historyOpen = true)}>
										{S.history}
									</button>
								</div>
								{#if readOnlyNumberLine}
									<p class="md fg2">{readOnlyNumberLine}</p>
								{/if}
							</section>
						{/if}
					</div>
				</div>

				<!-- Нижняя полоса листания на телефоне -->
				<nav class="pager stick only-n" aria-label={S.sheet_pager}>
					{#if sh.prev}
						<a
							class="btn step"
							rel="prev"
							href={sheetPageHref(folderId, sh.prev)}
							aria-label={S.sheet_prev_long}
						>
							<Icon name="back" klass="l" />
						</a>
					{:else}
						<button type="button" class="btn step" disabled aria-label={S.sheet_prev_long}>
							<Icon name="back" klass="l" />
						</button>
					{/if}
					<button
						type="button"
						class="btn p"
						on:mousedown|preventDefault
						on:click={onCopy}
					>
						{hasQuoteSel ? S.sheet_copy_quote : S.sheet_copy_g}
					</button>
					{#if sh.next}
						<a
							class="btn step"
							rel="next"
							href={sheetPageHref(folderId, sh.next)}
							aria-label={S.sheet_next_long}
						>
							<Icon name="fwd" klass="l" />
						</a>
					{:else}
						<button type="button" class="btn step" disabled aria-label={S.sheet_next_long}>
							<Icon name="fwd" klass="l" />
						</button>
					{/if}
				</nav>
			{/if}
		{/if}
	</main>
</div>

<!-- Окно «Открыть лист» на телефоне -->
<Dialog bind:open={gotoOpen} title={S.goto_title_g} labelledby="sheet-goto-title">
	<GotoForm
		action={refAction}
		volumes={sh?.volumes ?? []}
		{S}
		variant="window"
		initialVolume={sh?.volume_label ?? ''}
		onSubmit={() => (gotoOpen = false)}
	/>
	<div class="row">
		<button type="button" class="btn" on:click={() => (gotoOpen = false)}>{S.cancel}</button>
	</div>
</Dialog>

<!-- История правок листа -->
<HistoryDialog
	bind:open={historyOpen}
	state={historyState}
	{S}
	entity="page"
	id={pageId}
	onReverted={() => void reloadCurrent(S.revert_done)}
/>

<!-- Подтверждение пересчёта карточки документа -->
<Dialog bind:open={recalcOpen} title={S.sheet_card_recalc} labelledby="sheet-card-title">
	{#if sh?.card}
		<p class="md">{fmt(S.sheet_card_price, { usd: usd(sh.card.estimate_usd) })}</p>
	{/if}
	<div class="row g8 je">
		<button type="button" class="btn" on:click={() => (recalcOpen = false)}>{S.close}</button>
		<button type="button" class="btn p" disabled={recalcBusy} on:click={recalcCard}>
			<Busy on={recalcBusy} text={S.busy_wait}>{S.sheet_card_recalc}</Busy>
		</button>
	</div>
</Dialog>

<style>
	.lbl1 {
		font-weight: 500;
	}
	.lbl1 .fn {
		font-size: 15px;
	}
	.h2 {
		font-size: 21px;
		line-height: 1.3;
		font-weight: 400;
		letter-spacing: 0;
	}
	.cw {
		color: var(--warn);
	}
	.mla {
		margin-left: auto;
	}
	.je {
		justify-content: flex-end;
	}
	.vc {
		align-items: center;
	}
	.sfs {
		align-self: flex-start;
	}
	.f120 {
		flex: 1 1 120px;
	}
	.f140 {
		flex: 1 1 140px;
	}
	.top .ttl {
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--muted2);
	}
	.state {
		padding: 20px;
		border-radius: 12px;
		background: var(--soft);
	}
	.note.col8 {
		flex-direction: column;
		gap: 8px;
	}
	.note.col10 {
		flex-direction: column;
		gap: 10px;
	}
	.note.col8 > h3 {
		font-size: 14.5px;
		font-weight: 600;
	}
	.note.col10 .lbl {
		color: var(--warn-fg);
	}
	.flags {
		padding-left: 18px;
	}
	.p-img {
		padding: 14px;
	}
	.sheet-fig {
		position: relative;
		margin: 0;
		line-height: 0;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--paper);
		overflow: hidden;
	}
	.sheet-fig img {
		display: block;
		width: 100%;
		height: auto;
		font-size: 13px;
		line-height: 1.4;
		color: var(--muted);
	}
	:global(html.dark) .sheet-fig img {
		filter: brightness(0.87);
	}
	.hlsvg {
		position: absolute;
		left: 0;
		top: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}
	.hlsvg .hl {
		fill: #ffc800;
		fill-opacity: 0.35;
		stroke: var(--markline);
		stroke-width: 1;
	}
	.txt.pre {
		display: block;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.txt :global(mark) {
		scroll-margin: 96px;
	}
	.txt :global(mark.ed) {
		padding: 0;
		border-radius: 0;
		background: none;
		box-shadow: none;
		border-bottom: 2px dotted var(--info);
	}
	#sheet-text-places {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.place-btn {
		justify-content: flex-start;
		text-align: left;
		white-space: normal;
	}
	#sheet-text-pick {
		padding: 6px 8px;
		border-radius: 8px;
		background: var(--mark);
		box-shadow: inset 0 0 0 1px var(--markline);
	}
	details > summary {
		list-style: none;
		cursor: pointer;
	}
	details > summary::-webkit-details-marker {
		display: none;
	}
	details[open] > summary .tg :global(.ic) {
		transform: rotate(180deg);
	}
	details > .dbody {
		margin-top: 12px;
	}
	.noimg .p-img {
		display: none;
	}
	.noimg .sheet2 {
		grid-template-columns: minmax(0, 1fr);
	}
	:global(.offscreen) {
		position: fixed;
		left: -1000px;
		top: 0;
		width: 10px;
		height: 10px;
		opacity: 0;
	}
	@media (max-width: 720px) {
		.note.vc {
			flex-direction: column;
			align-items: flex-start;
		}
		.sheet2 > .p-text {
			order: -1;
		}
		.noimg .tabs {
			display: none;
		}
		.sheet-shell.t-text .p-img,
		.sheet-shell.t-img .p-text {
			display: none;
		}
		.stick {
			position: sticky;
			bottom: 0;
			z-index: 5;
			margin-top: auto;
			-webkit-backdrop-filter: blur(12px);
			backdrop-filter: blur(12px);
		}
		.stick .step {
			flex: 0 0 52px;
			padding: 0;
		}
		.stick .btn.p {
			min-width: 0;
		}
		.head {
			align-items: stretch;
		}
	}
</style>
