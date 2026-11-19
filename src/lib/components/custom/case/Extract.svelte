<script lang="ts">
	// ai-dvokat: «Выписка листов» (макет K-extract; опись § 2.12): листы по записи «т. 2, л.д. 40–45; т. 3, л.д. 7 об.»
	// одним PDF из оригиналов. Ручка `GET …/extract.pdf?ref=…&ref=…`; имя файла даёт сервис. Отказ сервиса — его
	// фразой под полем, а не всплывающим сообщением. Поведение — прежний `sections/whatsnew.js` (`extractForm`).
	import type { CaseState } from '$lib/custom/case/casestore';
	import { saveBlob } from '$lib/custom/case/loader';
	import { casePath } from '$lib/custom/case/sections';
	import Icon from './Icon.svelte';

	export let state: CaseState;
	export let S: Record<string, any> = {};

	let value = '';
	let error = '';
	let busy = false;
	async function submit() {
		const refs = value
			.split(';')
			.map((x) => x.trim())
			.filter(Boolean);
		if (busy) return;
		if (!refs.length) {
			error = S.extract_empty;
			return;
		}
		busy = true;
		error = '';
		const q = new URLSearchParams();
		for (const r of refs) q.append('ref', r);
		try {
			const file = await state.api.download(casePath(state, `/extract.pdf?${q}`));
			saveBlob(file.blob, file.name || 'extract.pdf');
		} catch (e) {
			error = (e as Error).message || S.error_network;
		} finally {
			busy = false;
		}
	}
</script>

<section class="card g16" data-testid="case-extract">
	<p class="md lead">{S.extract_hint}</p>
	<form class="row g12 ae" on:submit|preventDefault={submit} novalidate>
		<label class="lbl grow field"
			>{S.extract_label}<input
				class="in"
				class:bad={!!error}
				type="text"
				maxlength="300"
				autocomplete="off"
				placeholder={S.extract_placeholder}
				aria-describedby={error ? 'case-extract-error' : undefined}
				bind:value
				on:input={() => (error = '')}
			/></label
		>
		<button type="submit" class="btn big p" disabled={busy}
			><Icon name="dl" />{S.extract_submit}</button
		>
	</form>
	{#if error}
		<div
			class="col g4 sm b c-stop"
			id="case-extract-error"
			role="alert"
			data-testid="case-extract-error"
		>
			{#each error.split('\n').filter(Boolean) as line}<span>{line}</span>{/each}
		</div>
	{/if}
	<p class="sm mut">{S.sheets_extract_examples}</p>
</section>

<style>
	.lead {
		max-width: 640px;
		color: var(--muted2);
	}
	.field {
		min-width: 240px;
	}
</style>
