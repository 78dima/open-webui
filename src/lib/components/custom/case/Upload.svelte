<script lang="ts">
	import PauseNote from './PauseNote.svelte';
	import { errorText } from '$lib/custom/case/sections';
	// ai-dvokat: «Загрузить материалы» (макет K-upload; опись § 2.4). Вид — «Г», поведение — прежней страницы без
	// потерь: его держит движок `uploads.ts` (части, два файла одновременно, повтор, пауза, продолжение после закрытия
	// страницы), он живёт в общем макете дела и не останавливается при переходе между разделами.
	import type { CaseState } from '$lib/custom/case/casestore';
	import { mb, naturalKey, size } from '$lib/custom/case/casepage';
	import { count, fmt } from '$lib/custom/case/strings';
	import { caseToast } from '$lib/custom/case/toast';
	import {
		ACCEPT,
		dirName,
		filePath,
		serverFailed,
		serverTextKey,
		type ActiveUpload,
		type InputKind,
		type PendingRow
	} from '$lib/custom/case/uploads';
	import type { CaseApiError } from '$lib/custom/case/api';
	import Icon from './Icon.svelte';

	export let state: CaseState;
	export let S: Record<string, any> = {};
	export let hrefOf: (slug: string) => string;

	const { boot, data, uploads } = state;
	$: maxMb = $boot?.max_file_mb ?? 0;
	$: volumes = [...($data?.overview.volumes ?? [])].sort((a, b) =>
		naturalKey(a.label) < naturalKey(b.label) ? -1 : 1
	);
	$: server = $data?.uploads ?? [];
	// незавершённые загрузки, которые эта страница не ведёт (начаты раньше или в другой вкладке)
	$: unfinished = server.filter(
		(u) => u.status === 'receiving' && !uploads.isActive(u.id) && $uploads
	);
	// загрузки, которые сервер принимает или не принял (их части уже переданы)
	$: other = server.filter((u) => u.status !== 'receiving' && !uploads.isActive(u.id) && $uploads);
	$: listed = $uploads.active.length + other.length;

	let pickFiles: HTMLInputElement;
	let pickDir: HTMLInputElement;
	let over = false;

	function add(list: FileList | null | undefined) {
		for (const r of uploads.addFiles(Array.from(list ?? []))) {
			caseToast(
				r.why === 'format'
					? fmt(S.upload_bad_format, { name: r.name })
					: fmt(S.upload_too_big, { name: r.name, mb: maxMb }),
				true
			);
		}
	}
	const picked = (ev: Event) => {
		const input = ev.currentTarget as HTMLInputElement;
		add(input.files);
		input.value = '';
	};
	const dropped = (ev: DragEvent) => {
		over = false;
		add(ev.dataTransfer?.files);
	};
	async function cancelServer(id: string) {
		try {
			await uploads.cancelServer(id);
		} catch (error) {
			caseToast(errorText(S, error), true);
		}
	}

	const KINDS: { kind: InputKind; key: string }[] = [
		{ kind: 'volume', key: 'upload_kind_volume' },
		{ kind: 'e_case', key: 'upload_kind_ecase' }
	];
	const rowSize = (r: PendingRow) => size(r.files.reduce((a, f) => a + f.size, 0));
	/** Каталог с несколькими PDF: перед первой его строкой — «Всем PDF папки». */
	function groupHead(
		rows: PendingRow[],
		n: number
	): { name: string; count: number; group: string } | null {
		const r = rows[n];
		if (r.kind === 'photo' || !r.group) return null;
		const mates = rows.filter((x) => x.group === r.group && x.kind !== 'photo');
		if (mates.length < 2 || mates[0] !== r) return null;
		return { name: dirName(r.files[0]), count: mates.length, group: r.group };
	}
	const percent = (u: ActiveUpload) =>
		u.size ? Math.floor((100 * u.sent) / u.size) : u.state === 'done' ? 100 : 0;
	const progress = (u: ActiveUpload) => ({ done: mb(u.sent), total: mb(u.size) });
	const link = (template: unknown, name: string) => {
		const [before, after = ''] = String(template ?? '').split(`{${name}}`);
		return { before, after };
	};
	$: volumesLink = link(S.upload_goes_to_volumes, 'volumes');
</script>

<PauseNote {state} {S} />
<section
	class="card dash g12 drop"
	class:over
	role="group"
	aria-label={S.section_upload}
	data-testid="case-drop"
	on:dragover|preventDefault={() => (over = true)}
	on:dragleave={() => (over = false)}
	on:drop|preventDefault={dropped}
>
	<span class="ico n big only-w mark" aria-hidden="true"><Icon name="up" klass="l" /></span>
	<div class="row g12 center">
		<button type="button" class="btn big p" on:click={() => pickFiles.click()}
			>{S.upload_pick_files}</button
		>
		<button type="button" class="btn big only-w" on:click={() => pickDir.click()}
			>{S.upload_pick_folder_g}</button
		>
		<span class="md only-w soft">{S.upload_drop}</span>
	</div>
	<p class="xs mut">{fmt(S.upload_formats_g, { mb: maxMb })}</p>
	<input
		bind:this={pickFiles}
		type="file"
		multiple
		accept={ACCEPT}
		hidden
		on:change={picked}
		data-testid="case-pick-files"
	/>
	<input
		bind:this={pickDir}
		type="file"
		multiple
		webkitdirectory
		hidden
		on:change={picked}
		data-testid="case-pick-dir"
	/>
</section>

{#if unfinished.length}
	<div class="note stack" data-testid="case-unfinished">
		<p><span class="bb">{S.upload_unfinished_title}</span> {S.upload_unfinished_text}</p>
		{#each unfinished as u (u.id)}
			<div class="row g12">
				<span class="aw"
					>{fmt(S.upload_unfinished_row, {
						name: u.filename,
						done: mb(u.received),
						total: mb(u.size)
					})}</span
				>
				<button type="button" class="btn s warnbtn" on:click={() => cancelServer(u.id)}
					>{S.upload_cancel}</button
				>
			</div>
		{/each}
	</div>
{/if}

{#if $uploads.pending.length}
	<section class="card" data-testid="case-queue">
		<div class="col g4 queuehead">
			<div class="row g12">
				<h2>{S.upload_queue_title}</h2>
				<span class="cnt">{$uploads.pending.length}</span>
			</div>
			<p class="sm mut">{S.upload_kind_hint}</p>
		</div>

		{#each $uploads.pending as r, n (r.id)}
			{@const head = groupHead($uploads.pending, n)}
			{@const missing = $uploads.kindMissing && r.kind !== 'photo' && !r.inputKind}
			{#if head}
				<div class="row sp g8 dir" data-testid="case-queue-dir">
					<span class="b sm aw"
						>{fmt(S.upload_dir_group_g, { name: head.name, n: head.count })}</span
					>
					<span class="row g8 sm soft"
						>{S.upload_dir_kind_all_g}
						{#each KINDS as k (k.kind)}
							<button
								type="button"
								class="btn s"
								on:click={() => uploads.setGroupKind(head.group, k.kind)}>{S[k.key]}</button
							>
						{/each}</span
					>
				</div>
			{/if}
			<div class="col g12 qrow" data-testid="case-queue-row">
				<div class="row sp g12 nw">
					<span class="aw"
						><span class="b"
							>{r.kind === 'photo'
								? fmt(S.upload_photos_row_g, { n: r.files.length })
								: filePath(r.files[0])}</span
						>
						<span class="sm mut">· {rowSize(r)}</span></span
					>
					<button type="button" class="btn t" on:click={() => uploads.removeRow(r.id)}
						>{S.upload_remove_row}</button
					>
				</div>
				<div class="row g16 as">
					{#if r.kind !== 'photo'}
						<fieldset>
							<legend class:b={missing} class:c-stop={missing}
								>{missing ? S.upload_kind_pick : S.upload_kind_question_g}</legend
							>
							<div class="row g6">
								{#each KINDS as k (k.kind)}
									<label class="opt" class:on={r.inputKind === k.kind} class:bad={missing}
										><input
											type="radio"
											name="kind-{r.id}"
											checked={r.inputKind === k.kind}
											on:change={() => uploads.setKind(r.id, k.kind)}
										/>{S[k.key]}</label
									>
								{/each}
							</div>
						</fieldset>
					{/if}
					<fieldset>
						<legend>{S.upload_volume_legend}</legend>
						<div class="row g8">
							<input
								class="in label"
								class:on={!!r.label.trim()}
								type="text"
								maxlength="32"
								autocomplete="off"
								aria-label={S.upload_volume_label}
								placeholder={S.upload_volume_placeholder}
								value={r.label}
								on:input={(ev) => uploads.setLabel(r.id, ev.currentTarget.value)}
							/>
							<span class="sm mut">{S.upload_or}</span>
							<select
								class="in"
								class:on={!r.label.trim() && !!r.cont}
								aria-label={S.upload_continues_field}
								disabled={!!r.label.trim()}
								value={r.label.trim() ? '' : r.cont}
								on:change={(ev) => uploads.setCont(r.id, ev.currentTarget.value)}
							>
								<option value="">{S.upload_continues_none}</option>
								{#each volumes as v (v.id)}
									<option value={String(v.id)}
										>{v.label
											? fmt(S.upload_continues_option, { label: v.label })
											: S.upload_continues_no_label}</option
									>
								{/each}
							</select>
						</div>
					</fieldset>
				</div>
			</div>
		{/each}

		<div class="row g16 foot">
			{#if $uploads.kindMissing}<span class="sm b c-stop" role="alert"
					>{S.upload_kind_required}</span
				>{/if}
			<button
				type="button"
				class="btn big p"
				on:click={() => uploads.start()}
				data-testid="case-upload-start">{S.upload_start}</button
			>
		</div>
	</section>
{/if}

{#if listed}
	<section class="card list" data-testid="case-uploads">
		<div class="row g12 listhead">
			<h2>{S.upload_list_title}</h2>
			{#if listed}<span class="cnt">{listed}</span>{/if}
		</div>

		{#each $uploads.active as u (u.key)}
			<div class="li" data-testid="case-upload" data-state={u.state}>
				<div class="col g8 grow">
					<span class="aw"
						><span class="b">{u.name}</span> <span class="sm mut">· {size(u.size)}</span></span
					>
					<div class="bar" aria-hidden="true">
						{#if u.state !== 'queued' || u.sent}
							<i
								class:off={u.state === 'paused' || u.retryIn !== null}
								class:bad={u.state === 'failed'}
								class:done={u.state === 'done'}
								style:width="{u.state === 'failed' && u.assembleFailed ? 100 : percent(u)}%"
							></i>
						{/if}
					</div>
					{#if u.state === 'done'}
						<span class="row g6 sm b fg2"><Icon name="ok" />{S.upload_done}</span>
					{:else if u.state === 'failed'}
						<span class="sm b c-stop aw" role="alert"
							>{u.assembleFailed
								? S.upload_complete_failed
								: fmt(S.upload_failed, { detail: u.error || S.error_no_answer })}</span
						>
					{:else if u.state === 'paused'}
						<span class="sm soft">{fmt(S.upload_paused_g, progress(u))}</span>
					{:else if u.retryIn !== null}
						<span class="sm c-warn">{fmt(S.upload_retrying, { s: u.retryIn })}</span>
					{:else if u.state === 'queued'}
						<span class="sm soft">{S.upload_waiting}</span>
					{:else}
						<span class="sm soft">{fmt(S.upload_progress_g, progress(u))}</span>
					{/if}
				</div>
				{#if u.state !== 'done'}
					<div class="row g8">
						{#if u.state === 'running'}
							<button type="button" class="btn s" on:click={() => uploads.togglePause(u.key)}
								>{S.upload_pause}</button
							>
						{:else if (u.state === 'paused' || u.state === 'failed') && !u.assembleFailed}
							<button type="button" class="btn s p" on:click={() => uploads.togglePause(u.key)}
								>{S.upload_resume}</button
							>
						{/if}
						<button type="button" class="btn t" on:click={() => uploads.cancel(u.key)}
							>{S.upload_cancel}</button
						>
					</div>
				{/if}
			</div>
		{/each}

		{#each other as u (u.id)}
			{@const bad = serverFailed(u.phase)}
			<div class="li" data-testid="case-upload-server" data-phase={u.phase}>
				<span class="grow aw"
					><span class="b">{u.filename}</span> <span class="sm mut">· {size(u.size)}</span></span
				>
				<span class="pill box" class:s={bad} class:i={!bad && u.phase !== 'done_nofile'}>
					{#if bad}<Icon name="al" />{:else if u.phase !== 'done_nofile'}<Icon
							name="clock"
						/>{/if}{fmt(S[serverTextKey(u.phase, u.filename)], { error: u.error || '' })}</span
				>
			</div>
		{/each}

		<div class="li col g4 tail">
			<p class="sm mut">
				{volumesLink.before}<a class="ref" href={hrefOf('volumes')}
					>{S.upload_goes_to_volumes_link}</a
				>{volumesLink.after}
			</p>
		</div>
	</section>
{/if}

<style>
	.drop {
		padding: 28px 24px;
	}
	.drop.over {
		border-color: var(--link);
		background: var(--info-bg);
	}
	.mark {
		background: linear-gradient(120deg, var(--t1), var(--t3));
	}
	.center {
		justify-content: center;
	}
	.soft {
		color: var(--muted2);
	}
	.stack {
		flex-direction: column;
		gap: 8px;
	}
	.warnbtn {
		border-color: var(--warn);
		background: none;
		color: var(--warn-fg);
	}
	.queuehead {
		padding-bottom: 14px;
	}
	.dir {
		padding: 10px 14px;
		border-radius: 10px;
		background: var(--soft);
	}
	.qrow {
		padding: 16px 0;
		border-bottom: 1px solid var(--line2);
	}
	.label {
		width: 150px;
	}
	.foot {
		justify-content: flex-end;
		padding-top: 18px;
	}
	.list {
		padding-bottom: 8px;
	}
	.listhead {
		padding-bottom: 12px;
	}
	.tail {
		align-items: flex-start;
	}
	@media (max-width: 720px) {
		.label {
			flex: 1 1 110px;
			width: auto;
			min-width: 0;
		}
		.qrow select {
			flex: 1 1 100%;
			min-width: 0;
		}
	}
</style>
