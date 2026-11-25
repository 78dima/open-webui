<script lang="ts">
	// ai-dvokat: разрешение ссылки «том / лист» (`/case/[folderId]/ref?...`) в Svelte-форке.
	import { goto } from '$app/navigation';
	import { config } from '$lib/stores';
	import { createCaseApi, type CaseApiError } from '$lib/custom/case/api';
	import { splitLabel } from '$lib/custom/case/casepage';
	import { reasonText } from '$lib/custom/case/sections';
	import {
		caseRefHref,
		isBackSide,
		sheetPageHref,
		type RefResponse
	} from '$lib/custom/case/sheet';
	import { caseStrings, fmt } from '$lib/custom/case/strings';
	import GotoForm from './GotoForm.svelte';
	import Icon from './Icon.svelte';
	import StateCard from './StateCard.svelte';

	export let folderId: string;
	export let search = '';
	export let title = '';

	const api = createCaseApi($config?.custom_ui);
	$: S = $caseStrings ?? {};
	$: caseHref = `/case/${encodeURIComponent(folderId)}`;
	$: refAction = caseRefHref(folderId);
	$: params = new URLSearchParams(search);
	$: initialVolume = params.get('t') ?? '';
	$: initialSheet = params.get('l') ?? '';
	$: initialBack = isBackSide(params.get('side'));

	let loading = true;
	let error: CaseApiError | null = null;
	let res: RefResponse | null = null;
	let reqSeq = 0;

	$: if (folderId) void resolve(folderId, search);

	async function resolve(fid: string, qs: string) {
		const seq = ++reqSeq;
		loading = true;
		error = null;
		res = null;
		try {
			const data = await api.get<RefResponse>(
				`api/cases/${encodeURIComponent(fid)}/ref${qs ? (qs.startsWith('?') ? qs : `?${qs}`) : ''}`
			);
			if (seq !== reqSeq) return;
			if (data?.status === 'found') {
				await goto(sheetPageHref(fid, data.page_id), { replaceState: true });
				return;
			}
			res = data;
		} catch (e) {
			if (seq !== reqSeq) return;
			error = e as CaseApiError;
		} finally {
			if (seq === reqSeq) loading = false;
		}
	}

	$: howMap = {
		duplicate: S.ref_how_duplicate,
		disputed: S.ref_how_disputed,
		ambiguous: S.ref_how_ambiguous,
		back: S.ref_how_back
	} as Record<string, string>;

	$: title =
		res?.status === 'many'
			? S.ref_many_g || ''
			: res?.status === 'not_found'
				? res.why || ''
				: '';

	$: backText =
		res && res.status !== 'found' && (res.case_title ?? '').trim()
			? fmt(S.back_to_case_g, { title: res.case_title })
			: S.back_to_case_plain;
</script>

<div class="shell" data-testid="case-ref">
	<main class="main narrow" id="main-content">
		{#if loading}
			<p class="mut" role="status">{S.loading}</p>
		{:else if error}
			{#if error.kind === 'not_found'}
				<StateCard icon="folder" title={S.not_found} testid="ref-error">
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
					testid="ref-error"
				>
					<button
						type="button"
						class="btn big p act"
						on:click={() => resolve(folderId, search)}
					>
						<Icon name="retry" size={18} />{S.retry}
					</button>
					<a class="btn big" href="/case">{S.back_to_cases}</a>
				</StateCard>
			{/if}
		{:else if res && res.status !== 'found'}
			<div class="top">
				<a class="rb" href={caseHref} aria-label={S.back_to_case_aria}>
					<Icon name="back" klass="l" />
				</a>
				<span class="grow sm nob ttl">{res.case_title ?? ''}</span>
			</div>

			<div class="col g6">
				<a class="ref sm only-w" href={caseHref}>{backText}</a>
				{#if res.asked}
					<span class="sm mut">{fmt(S.ref_opened, { ref: res.asked })}</span>
				{/if}

				{#if res.status === 'not_found'}
					<h1 class="h2" data-testid="ref-not-found">
						{res.why}{#each res.links ?? [] as link (link.page_id)}
							{@const parts = splitLabel(link.label)}
							{' '}<a class="ref" href={sheetPageHref(folderId, link.page_id)}
								>{parts.main}{#if parts.file}{' '}<span class="fn">{parts.file}</span>{/if}</a
							>
						{/each}
					</h1>
				{:else if res.status === 'many'}
					<h1 data-testid="ref-many">{S.ref_many_g}</h1>
					<p class="md fg3">{S.ref_choose}</p>
				{/if}
			</div>

			{#if res.status === 'many'}
				<div class="col g8">
					{#each res.variants as x (x.page_id)}
						{@const parts = splitLabel(x.label)}
						<a
							class="card row g12 nw variant"
							href={sheetPageHref(folderId, x.page_id)}
							data-testid="ref-variant"
						>
							<span class="col g6 as grow">
								<span class="ref lg"
									>{parts.main}{#if parts.file}{' '}<span class="fn">{parts.file}</span>{/if}</span
								>
								{#if x.page_no != null}
									<span class="sm fg2">
										{fmt(S.ref_file_page, { n: x.page_no })}{#if x.filename}{' '}<span class="fn"
												>{x.filename}</span
											>{/if}
									</span>
								{/if}
								{#if x.how && howMap[x.how]}
									<span class="pill w t">{howMap[x.how]}</span>
								{/if}
							</span>
							<Icon name="r" klass="l mut" />
						</a>
					{/each}
				</div>
			{/if}

			{#if res.volumes?.length}
				<section class="card g12">
					<h3>{S.ref_other}</h3>
					<GotoForm
						action={refAction}
						volumes={res.volumes}
						{S}
						variant="card"
						{initialVolume}
						{initialSheet}
						{initialBack}
					/>
				</section>
			{/if}
		{/if}
	</main>
</div>

<style>
	.narrow {
		max-width: 760px;
		width: 100%;
		margin: 0 auto;
	}
	.top .ttl {
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--muted2);
	}
	.h2 {
		font-size: 21px;
		line-height: 1.3;
		font-weight: 400;
		letter-spacing: 0;
	}
	.fg3 {
		color: var(--muted2);
	}
	.variant {
		flex-direction: row;
		padding: 16px 16px 16px 20px;
	}
</style>
