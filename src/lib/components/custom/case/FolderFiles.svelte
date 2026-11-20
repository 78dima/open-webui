<script lang="ts">
	// ai-dvokat: «Файлы папки вне дела» (макет K-files; опись § 2.14): файлы из «Знаний» папки чата, которых нет в
	// деле; «Добавить в дело» с ответом «что это» у PDF и архива (право записи, без подтверждения). Ручки
	// `GET …/folder-files`, `POST …/folder-files/<id>/add`. Поведение — прежний `case.js` (`loadFolderFiles`).
	import type { CaseState, FolderFile } from '$lib/custom/case/casestore';
	import { size } from '$lib/custom/case/casepage';
	import { casePath, errorText, reasonText } from '$lib/custom/case/sections';
	import { fmt } from '$lib/custom/case/strings';
	import { caseToast } from '$lib/custom/case/toast';
	import Icon from './Icon.svelte';
	import StaleNote from './StaleNote.svelte';

	export let state: CaseState;
	export let S: Record<string, any> = {};

	const { boot, folderFilesState } = state;
	$: canWrite = !!$boot?.can_write;
	$: files = $folderFilesState.files;
	$: error = $folderFilesState.error;
	let kinds: Record<string, string> = {};
	let busy = new Set<string>();
	const load = () => void state.reloadFolderFiles();
	async function add(f: FolderFile) {
		if (busy.has(f.id)) return;
		busy = new Set(busy).add(f.id);
		try {
			await state.api.post(casePath(state, `/folder-files/${encodeURIComponent(f.id)}/add`), {
				input_kind: f.kind !== 'photo' ? (kinds[f.id] ?? 'volume') : null
			});
			caseToast(S.folder_file_added);
			void state.reloadFolderFiles();
		} catch (e) {
			caseToast(errorText(S, e), true);
		} finally {
			const next = new Set(busy);
			next.delete(f.id);
			busy = next;
		}
	}
</script>

<p class="md intro">{S.folder_files_hint_g}</p>

{#if error && files}
	<StaleNote {S} {error} retry={load} />
{/if}
{#if error && !files}
	<section class="card" data-testid="case-folder-files-error">
		<div class="col g12 as">
			<span class="pill s"
				><Icon name="al" />{fmt(S.section_error, { detail: reasonText(S, error) })}</span
			>
			<button type="button" class="btn big" on:click={load}>{S.retry}</button>
		</div>
	</section>
{:else if !files}
	<section class="card"><p class="mut" role="status">{S.loading}</p></section>
{:else}
	<section class="card list" data-testid="case-folder-files">
		{#each files as f (f.id)}
			<div class="li" data-testid="case-folder-file">
				<div class="col g2 grow">
					<span class="b aw">{f.name || f.id}</span>
					{#if f.size}<span class="sm mut">{size(f.size)}</span>{/if}
				</div>
				{#if !f.readable}
					<span class="pill ro box"><Icon name="al" />{S.folder_file_unreadable}</span>
				{:else if f.adding}
					<span class="pill i"><Icon name="clock" />{S.folder_file_adding}</span>
				{:else if !f.kind}
					<span class="pill ro box"><Icon name="al" />{S.folder_file_bad_format}</span>
				{:else if canWrite}
					<div class="row g8">
						{#if f.kind !== 'photo'}
							<select class="in s" aria-label={S.upload_kind_question_g} bind:value={kinds[f.id]}>
								<option value="volume">{S.upload_kind_volume}</option>
								<option value="e_case">{S.upload_kind_ecase}</option>
							</select>
						{/if}
						<button type="button" class="btn s p" disabled={busy.has(f.id)} on:click={() => add(f)}
							>{S.folder_file_add}</button
						>
					</div>
				{/if}
			</div>
		{/each}
	</section>
{/if}

<style>
	.list {
		padding: 8px 24px;
	}

	.intro {
		max-width: 680px;
		color: var(--muted2);
	}
	.li:first-child {
		border-top: 0;
	}
</style>
