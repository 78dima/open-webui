<script lang="ts">
	// B3: the stored K+ fragment behind a source (U2 GET /api/receipts/{id}). Read only.
	import { onDestroy } from 'svelte';
	import { config } from '$lib/stores';
	import ru from '$lib/custom/locales/ru-RU.json';
	import { fetchReceipt, legalToolsBase, JobRequestError } from '$lib/custom/jobs';
	import type { Receipt } from '$lib/custom/types';
	export let receiptId: string | null = null;
	let receipt: Receipt | undefined;
	let loading = false;
	let error = '';
	let activeKey = '';
	let request: AbortController | undefined;
	$: enabled = $config?.custom_ui?.receipt_panel === true;
	$: if (!enabled) receiptId = null;
	$: base = legalToolsBase($config?.custom_ui);
	$: sync(enabled && receiptId ? `${base}|${receiptId}` : '');
	const errors: Record<string, string> = ru.receipt.errors;
	const day = (value?: string) =>
		value ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '';
	function sync(key: string) {
		if (key === activeKey) return;
		activeKey = key;
		request?.abort();
		receipt = undefined;
		error = '';
		loading = false;
		if (key && receiptId) void load(receiptId);
	}
	async function load(id: string) {
		const controller = new AbortController();
		request = controller;
		const timeout = setTimeout(() => controller.abort(), 15000);
		loading = true;
		try {
			const value = await fetchReceipt(base, id, controller.signal);
			if (request === controller) receipt = value;
		} catch (e) {
			if (request === controller)
				error = errors[e instanceof JobRequestError ? e.kind : 'unavailable'];
		} finally {
			clearTimeout(timeout);
			if (request === controller) loading = false;
		}
	}
	onDestroy(() => request?.abort());
</script>

{#if enabled && receiptId}
	<aside
		data-testid="custom-receipt-panel"
		aria-label={ru.receipt.title}
		class="border rounded-lg p-3 my-3 text-sm"
	>
		<div class="flex items-center justify-between gap-3">
			<h2 class="font-medium">{ru.receipt.title}</h2>
			<button type="button" on:click={() => (receiptId = null)} aria-label={ru.pending.close}
				>{ru.pending.close}</button
			>
		</div>
		{#if loading}<p role="status">{ru.receipt.loading}</p>{/if}
		{#if error}<p role="alert">{error}</p>{/if}
		{#if receipt}
			<dl class="my-2">
				{#if receipt.citation ?? receipt.citation_label}<dt>{ru.receipt.citation}</dt>
					<dd>{receipt.citation ?? receipt.citation_label}</dd>{/if}
				{#if receipt.doc_title}<dt>{ru.receipt.document}</dt>
					<dd>{receipt.doc_title}</dd>{/if}
				{#if receipt.edition_date || receipt.edition_status}<dt>{ru.receipt.edition}</dt>
					<dd>{[receipt.edition_date, receipt.edition_status].filter(Boolean).join(', ')}</dd>{/if}
				{#if receipt.para_from}<dt>{ru.receipt.paragraphs}</dt>
					<dd>
						{receipt.para_to && receipt.para_to !== receipt.para_from
							? `${receipt.para_from}–${receipt.para_to}`
							: receipt.para_from}
					</dd>{/if}
				<dt>{ru.receipt.verify}</dt>
				<dd>{receipt.verify_status ?? ru.receipt.verifyMissing}</dd>
				{#if receipt.fetched_at}<dt>{ru.receipt.fetched}</dt>
					<dd>{day(receipt.fetched_at)}</dd>{/if}
				{#if receipt.base_updated_on}<dt>{ru.receipt.baseUpdated}</dt>
					<dd>{receipt.base_updated_on}</dd>{/if}
			</dl>
			<h3 class="font-medium">{ru.receipt.fragment}</h3>
			<blockquote data-testid="custom-receipt-text" class="whitespace-pre-wrap border-l-2 pl-3 my-2">{receipt.canonical_text}</blockquote>
			{#if receipt.kplus_url}<a href={receipt.kplus_url} target="_blank" rel="noopener noreferrer"
					>{ru.receipt.open}</a
				>{/if}
		{/if}
	</aside>
{/if}
