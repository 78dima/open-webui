<script lang="ts">
	import ReceiptPanel from './ReceiptPanel.svelte';
	import { onMount, onDestroy } from 'svelte';
	import { config } from '$lib/stores';
	import ru from '$lib/custom/locales/ru-RU.json';
	import {
		jobIdFromMessage,
		stripJobMarker,
		stripJobMarkerFromOutput,
		legalToolsBase,
		fetchJob,
		normalizeSources,
		downloadArtifact,
		elapsedSeconds,
		JobRequestError
	} from '$lib/custom/jobs';
	import type { Job, Artifact } from '$lib/custom/types';
	export let content: string = '';
	export let output: any[] | null = null;
	export let model: { id?: string } | null = null;
	export let sources: unknown = null;
	export let done = true;
	const statuses: Record<string, string> = ru.result.statuses;
	let mounted = false;
	let tab = 0;
	let job: Job | undefined;
	let loading = false;
	let error = '';
	let downloadError = '';
	let downloading = false;
	let activeKey = '';
	let activeReceipt: string | null = null;
	let generation = 0;
	let request: AbortController | undefined;
	let download: AbortController | undefined;
	let poll: ReturnType<typeof setTimeout> | undefined;
	$: enabled =
		$config?.custom_ui?.result_card === true && model?.id?.startsWith('legal_workflows.') === true;
	$: id = jobIdFromMessage(content);
	// R4: the renderer always receives text without the U1 marker, with any flags.
	$: visibleContent = stripJobMarker(content);
	$: visibleOutput = stripJobMarkerFromOutput(output);
	$: base = legalToolsBase($config?.custom_ui);
	$: cardSources = job?.sources.length ? job.sources : normalizeSources(sources);
	$: sync(mounted && enabled && done ? `${base}:${id ?? 'saved'}` : '');
	onMount(() => {
		mounted = true;
	});
	onDestroy(() => {
		generation++;
		request?.abort();
		download?.abort();
		clearTimeout(poll);
	});
	function sync(key: string) {
		if (key === activeKey) return;
		activeKey = key;
		activeReceipt = null;
		generation++;
		request?.abort();
		download?.abort();
		clearTimeout(poll);
		job = undefined;
		loading = false;
		error = '';
		downloadError = '';
		downloading = false;
		tab = 0;
		if (key && id) void load();
	}
	function message(e: unknown): string {
		return ru.result.errors[e instanceof JobRequestError ? e.kind : 'unavailable'];
	}
	async function load() {
		if (!id || !enabled) return;
		const current = ++generation;
		request?.abort();
		clearTimeout(poll);
		const controller = new AbortController();
		request = controller;
		const timeout = setTimeout(() => controller.abort(), 15000);
		loading = true;
		error = '';
		try {
			const value = await fetchJob(base, id, controller.signal);
			if (current !== generation) return;
			job = value;
			if (['queued', 'running'].includes(value.status)) poll = setTimeout(load, 3000);
		} catch (e) {
			if (current === generation) error = message(e);
		} finally {
			clearTimeout(timeout);
			if (current === generation) loading = false;
		}
	}
	async function save(artifact: Artifact) {
		if (!id || downloading) return;
		const current = generation;
		const controller = new AbortController();
		download = controller;
		const timeout = setTimeout(() => controller.abort(), 30000);
		downloading = true;
		downloadError = '';
		try {
			await downloadArtifact(base, id, artifact, controller.signal);
		} catch (e) {
			if (current === generation) downloadError = message(e);
		} finally {
			clearTimeout(timeout);
			if (current === generation) downloading = false;
		}
	}
</script>

{#if enabled && done}
	<section data-testid="custom-result" class="border rounded-lg p-3 my-3 text-sm">
		<header class="flex flex-wrap gap-2 items-center mb-2">
			<h2 class="font-medium">{ru.result.title}</h2>
			{#if job}<span>{statuses[job.status] ?? ru.result.unavailable}</span>{/if}
			{#if id}<button type="button" disabled={loading} on:click={load}>{ru.result.refresh}</button
				>{/if}
		</header>
		{#if !id}<p class="text-xs opacity-70">{ru.result.saved}</p>{/if}
		{#if loading}<p role="status">{ru.result.loading}</p>{/if}
		{#if error}<p role="alert">{error}</p>{/if}
		<nav aria-label={ru.result.title} class="flex flex-wrap gap-2 my-3">
			{#each ru.result.tabs as title, index}<button
					type="button"
					aria-pressed={tab === index}
					class="border rounded px-2 py-1"
					on:click={() => (tab = index)}>{title}</button
				>{/each}
		</nav>
		{#if tab === 0}
			{#if job?.summary}<p class="whitespace-pre-wrap">{job.summary}</p>{/if}
			{#if job?.gaps.length}<h3>{ru.result.gaps}</h3>
				<ul>
					{#each job.gaps as gap}<li>{gap}</li>{/each}
				</ul>{/if}
		{:else if tab === 1}
			{#if job?.findings === undefined}<p>{ru.result.unavailable}</p>
			{:else if !job.findings.length}<p>{ru.result.empty}</p>
			{:else}{#each job.findings as finding}<article class="border-b py-2">
						<p>{finding.claim}</p>
						<p>{finding.element_ids.join(', ')}</p>
						{#if finding.severity}<p>{ru.result.levels[finding.severity]}</p>{/if}
					</article>{/each}{/if}
		{:else if tab === 2}
			{#if job?.edits === undefined}<p>{ru.result.unavailable}</p>
			{:else if !job.edits.length}<p>{ru.result.empty}</p>
			{:else}{#each job.edits as edit}<article class="border-b py-2">
						<h3>{edit.element_id}</h3>
						<dl>
							<dt>{ru.result.before}</dt>
							<dd class="whitespace-pre-wrap">{edit.before ?? ru.result.unavailable}</dd>
							<dt>{ru.result.after}</dt>
							<dd class="whitespace-pre-wrap">{edit.after ?? ru.result.unavailable}</dd>
							<dt>{ru.result.rationale}</dt>
							<dd>{edit.rationale ?? ru.result.unavailable}</dd>
						</dl>
					</article>{/each}{/if}
		{:else if tab === 3}
			{#if !cardSources.length}<p>{ru.result.unavailable}</p>{/if}
			{#each cardSources as source}<article class="border-b py-2">
					<h3>{source.label}</h3>
					{#if source.receipt_id}<p>{ru.result.receipt}: {source.receipt_id}</p>{/if}
					{#if source.receipt_id && $config?.custom_ui?.receipt_panel === true}<button
							type="button"
							on:click={() => (activeReceipt = source.receipt_id ?? null)}
							>{ru.pending.openReceipt}</button
						>{/if}
					{#if source.edition}<p>{ru.result.edition}: {source.edition}</p>{/if}
					{#if source.fragment}<details>
							<summary>{ru.result.fragment}</summary>
							<p class="whitespace-pre-wrap">{source.fragment}</p>
						</details>{:else}<p>{ru.result.noFragment}</p>{/if}
					{#if source.url}<a href={source.url} target="_blank" rel="noopener noreferrer"
							>{ru.result.sourceLink}</a
						>{/if}
				</article>{/each}
		{:else if tab === 4}
			{#if !job?.artifacts.length}<p>{ru.result.filesFallback}</p>{/if}
			{#each job?.artifacts ?? [] as artifact}<div class="py-2">
					<span>{artifact.name}</span>
					<button type="button" disabled={downloading} on:click={() => save(artifact)}
						>{ru.result.download}</button
					>
				</div>{/each}
			{#if downloadError}<p role="alert">{downloadError}</p>{/if}
		{:else if tab === 5}
			<dl>
				<dt>{ru.result.spent}</dt>
				<dd>{job?.spent_usd ?? '—'}</dd>
				<dt>{ru.result.time}</dt>
				<dd>{job ? (elapsedSeconds(job) ?? '—') : '—'}</dd>
			</dl>
			{#if job?.unknown_usage}<p>{ru.result.unknown}</p>{/if}
		{/if}
		<div hidden={tab !== 0}><slot content={visibleContent} output={visibleOutput} /></div>
		<ReceiptPanel bind:receiptId={activeReceipt} />
	</section>
{:else}<slot content={visibleContent} output={visibleOutput} />{/if}
