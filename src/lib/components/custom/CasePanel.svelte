<script lang="ts">
	// B4: the folder as a case — its materials and case map (Open WebUI), legal-tools jobs (U3)
	// and their files (U4). Read only; downloads use the authorized artifact route.
	import { onDestroy } from 'svelte';
	import { config } from '$lib/stores';
	import ru from '$lib/custom/locales/ru-RU.json';
	import { getFolderById } from '$lib/apis/folders';
	import {
		fetchCaseJobs,
		fetchJobArtifacts,
		downloadArtifact,
		folderItems,
		isJobId,
		legalToolsBase,
		JobRequestError
	} from '$lib/custom/jobs';
	import type { CaseJob, FolderItem, JobArtifact, Artifact } from '$lib/custom/types';
	export let folderId: string;
	const kinds: Record<string, string> = ru.case.kinds;
	const statuses: Record<string, string> = ru.result.statuses;
	const errors: Record<string, string> = ru.case.errors;
	let name = '';
	let items: FolderItem[] = [];
	let folderError = '';
	let jobs: CaseJob[] = [];
	let cursor: string | undefined;
	let loading = false;
	let error = '';
	let open: Record<string, JobArtifact[] | 'loading' | string> = {};
	let downloading = '';
	let downloadError = '';
	let activeKey = '';
	let generation = 0;
	let controller: AbortController | undefined;
	$: enabled = $config?.custom_ui?.case === true && isJobId(folderId);
	$: base = legalToolsBase($config?.custom_ui);
	$: sync(enabled ? `${base}|${folderId}` : '');
	$: notes = items.filter((item) => item.type === 'note');
	$: materials = items.filter((item) => item.type !== 'note');
	const message = (e: unknown) => errors[e instanceof JobRequestError ? e.kind : 'unavailable'];
	const when = (value?: string) =>
		value ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—';
	function sync(key: string) {
		if (key === activeKey) return;
		activeKey = key;
		reset();
		if (key) void refresh();
	}
	function reset() {
		generation++;
		controller?.abort();
		name = '';
		items = [];
		folderError = '';
		jobs = [];
		cursor = undefined;
		error = '';
		open = {};
		downloading = '';
		downloadError = '';
		loading = false;
	}
	async function refresh() {
		reset();
		const current = generation;
		const c = new AbortController();
		controller = c;
		loading = true;
		const timeout = setTimeout(() => c.abort(), 15000);
		const folder = getFolderById(localStorage.token, folderId)
			.then((value) => {
				if (current !== generation) return;
				name = typeof value?.name === 'string' ? value.name : '';
				items = folderItems(value);
			})
			.catch(() => {
				if (current === generation) folderError = ru.case.folderError;
			});
		const page = fetchCaseJobs(base, folderId, undefined, c.signal)
			.then((value) => {
				if (current !== generation) return;
				jobs = value.items;
				cursor = value.next_cursor;
			})
			.catch((e) => {
				if (current === generation) error = message(e);
			});
		await Promise.all([folder, page]);
		clearTimeout(timeout);
		if (current === generation) loading = false;
	}
	async function more() {
		if (!cursor || loading) return;
		const current = generation;
		const c = new AbortController();
		controller = c;
		loading = true;
		try {
			const value = await fetchCaseJobs(base, folderId, cursor, c.signal);
			if (current !== generation) return;
			const seen = new Set(jobs.map((job) => job.id));
			jobs = [...jobs, ...value.items.filter((job) => !seen.has(job.id))];
			cursor = value.next_cursor;
		} catch (e) {
			if (current === generation) error = message(e);
		} finally {
			if (current === generation) loading = false;
		}
	}
	async function toggle(job: CaseJob) {
		if (open[job.id]) {
			const { [job.id]: _, ...rest } = open;
			open = rest;
			return;
		}
		const current = generation;
		open = { ...open, [job.id]: 'loading' };
		try {
			const files = await fetchJobArtifacts(base, job.id, new AbortController().signal);
			if (current === generation && open[job.id]) open = { ...open, [job.id]: files };
		} catch (e) {
			if (current === generation && open[job.id]) open = { ...open, [job.id]: message(e) };
		}
	}
	async function save(job: CaseJob, artifact: Artifact) {
		if (downloading) return;
		const current = generation;
		const c = new AbortController();
		const timeout = setTimeout(() => c.abort(), 30000);
		downloading = artifact.id;
		downloadError = '';
		try {
			await downloadArtifact(base, job.id, artifact, c.signal);
		} catch (e) {
			if (current === generation) downloadError = message(e);
		} finally {
			clearTimeout(timeout);
			if (current === generation) downloading = '';
		}
	}
	onDestroy(() => {
		generation++;
		controller?.abort();
	});
</script>

{#if enabled}
	<section data-testid="custom-case" aria-label={ru.case.title} class="p-4 text-sm max-w-3xl">
		<header class="flex flex-wrap items-center gap-3 mb-3">
			<h1 class="text-lg font-medium">{ru.case.title}{name ? `: ${name}` : ''}</h1>
			<button type="button" class="border rounded px-2 py-1" disabled={loading} on:click={refresh}
				>{ru.case.refresh}</button
			>
		</header>
		{#if loading}<p role="status">{ru.case.loading}</p>{/if}
		{#if folderError}<p role="alert">{folderError}</p>{/if}

		<h2 class="font-medium mt-3">{ru.case.caseMap}</h2>
		{#if !notes.length && !folderError && !loading}<p>{ru.case.caseMapEmpty}</p>{/if}
		<ul>
			{#each notes as note}<li data-testid="custom-case-note">
					<span>{note.name}</span>
					<a href={`/notes/${note.id}`} class="underline">{ru.case.openNote}</a>
				</li>{/each}
		</ul>

		<h2 class="font-medium mt-3">{ru.case.materials}</h2>
		{#if !materials.length && !folderError && !loading}<p>{ru.case.materialsEmpty}</p>{/if}
		<ul>
			{#each materials as item}<li data-testid="custom-case-material">
					{item.name}{item.type === 'collection' ? ` (${ru.case.collection})` : ''}
				</li>{/each}
		</ul>

		<h2 class="font-medium mt-3">{ru.case.jobs}</h2>
		{#if error}<p role="alert">{error}</p>{/if}
		{#if !jobs.length && !error && !loading}<p>{ru.case.jobsEmpty}</p>{/if}
		{#each jobs as job (job.id)}
			<article data-testid="custom-case-job" class="border-b py-2">
				<h3 class="font-medium">{kinds[job.kind] ?? job.kind} — {statuses[job.status] ?? job.status}</h3>
				<p>
					{ru.case.created}: {when(job.created_at)}; {ru.case.finished}: {when(job.finished_at)}; {ru
						.case.spent}: {job.spent_usd ?? '—'}
				</p>
				<p>{ru.case.files}: {job.artifacts.length}</p>
				{#if job.artifacts.length}
					<button type="button" class="border rounded px-2 py-1" on:click={() => toggle(job)}
						>{open[job.id] ? ru.case.hideFiles : ru.case.showFiles}</button
					>
				{/if}
				{#if open[job.id] === 'loading'}<p role="status">{ru.case.loading}</p>
				{:else if typeof open[job.id] === 'string'}<p role="alert">{open[job.id]}</p>
				{:else if Array.isArray(open[job.id])}
					{@const files = open[job.id]}
					{#if Array.isArray(files) && !files.length}<p>{ru.case.filesEmpty}</p>{/if}
					<ul>
						{#each Array.isArray(files) ? files : [] as file}<li data-testid="custom-case-file">
								<span>{file.name}</span>
								<button
									type="button"
									disabled={!!downloading}
									on:click={() => save(job, file)}>{ru.case.download}</button
								>
							</li>{/each}
					</ul>
				{/if}
			</article>
		{/each}
		{#if downloadError}<p role="alert">{downloadError}</p>{/if}
		{#if cursor}<button type="button" class="border rounded px-2 py-1 mt-2" disabled={loading} on:click={more}
				>{ru.case.more}</button
			>{/if}
	</section>
{:else}
	<p data-testid="custom-case-disabled" class="p-4">{ru.pending.disabled}</p>
{/if}
