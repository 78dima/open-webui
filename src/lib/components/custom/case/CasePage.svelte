<script lang="ts">
	// ai-dvokat: страница дела (вариант «Г»): каркас — меню разделов, шапка, «Открыть лист», «В чат дела» — и выбранный
	// раздел (макеты K-overview, K-menu-phone и разделов). Один экземпляр на всё время, пока открыто дело: раздел
	// меняется (у каждого свой адрес), а обзор, его переспрашивание и идущие загрузки остаются. Состав меню — по
	// настройке разделов сервиса и правам; данные — ручки сервиса; слова — строки сервиса.
	import { onDestroy, onMount } from 'svelte';
	import { config } from '$lib/stores';
	import { createCaseApi, type CaseApiError } from '$lib/custom/case/api';
	import { createCaseState } from '$lib/custom/case/casestore';
	import {
		gotoVolumes,
		navGroups,
		navItem,
		sectionOpen,
		SECTION_SETTING
	} from '$lib/custom/case/casepage';
	import { caseStrings, count, fmt } from '$lib/custom/case/strings';
	import { caseToast } from '$lib/custom/case/toast';
	import Amounts from './Amounts.svelte';
	import CaseNav from './CaseNav.svelte';
	import CheckSheets from './CheckSheets.svelte';
	import Chronology from './Chronology.svelte';
	import Copies from './Copies.svelte';
	import Deadlines from './Deadlines.svelte';
	import Dialog from './Dialog.svelte';
	import GotoForm from './GotoForm.svelte';
	import Icon from './Icon.svelte';
	import Inventory from './Inventory.svelte';
	import Overview from './Overview.svelte';
	import Passport from './Passport.svelte';
	import StateCard from './StateCard.svelte';
	import Extract from './Extract.svelte';
	import Replace from './Replace.svelte';
	import Upload from './Upload.svelte';
	import Volumes from './Volumes.svelte';

	export let folderId: string;
	/** Раздел из адреса; пусто — «Обзор». */
	export let section = '';
	/** Адрес «Моих дел», чата папки и страницы дела — страницы того же приложения. */
	export let casesHref = '/case';
	export let chatHref = `/folders/${encodeURIComponent(folderId)}`;
	export let hrefOf = (slug: string) =>
		`/case/${encodeURIComponent(folderId)}${slug ? `/${slug}` : ''}`;
	/** Заголовок вкладки — наружу (его ставит маршрут). */
	export let title = '';

	const api = createCaseApi($config?.custom_ui);
	const state = createCaseState(api, folderId);
	const { boot, bootError, data, folderFiles, uploads } = state;
	$: S = $caseStrings ?? {};

	let menuOpen = false;
	let gotoOpen = false;
	let creating = false;

	$: name = $boot?.title || '';
	$: groups = $boot?.has_case ? navGroups($boot, $data, $folderFiles) : [];
	$: item = navItem(groups, section);
	$: known = section in SECTION_SETTING;
	$: open = !!$boot && known && sectionOpen(section, $boot, $folderFiles);
	// «Файлы папки вне дела»: пока список папки не пришёл, раздел не объявляется закрытым
	$: label = item ? S[item.key] : '';
	$: volumes = gotoVolumes($data?.overview.volumes);
	$: refAction = api.url(`case/${encodeURIComponent(folderId)}/ref`);
	$: title = !$boot
		? ''
		: section && label
			? `${label} — ${name || S.case_no_title}`
			: name
				? fmt(S.case_title, { title: name })
				: S.case_no_title;
	$: checks = Math.max($data?.check_total ?? 0, ($data?.overview.check_sheets ?? []).length);
	// число у заголовка раздела — то же, что у пункта меню; у «Проверьте листы» — с учётом пришедших строк
	$: headCount = section === 'check' ? checks : (item?.count ?? 0);

	async function createCase() {
		if (creating) return;
		creating = true;
		try {
			await state.createCase();
			caseToast(S.case_created);
		} catch (error) {
			caseToast(fmt(S.error_generic, { detail: (error as CaseApiError)?.message ?? '' }), true);
		} finally {
			creating = false;
		}
	}

	// уход со страницы, пока файл передаётся: браузер спрашивает своим окном (как на прежней странице)
	const leaving = (ev: BeforeUnloadEvent) => {
		if (!$uploads.active.some((u) => u.state === 'running')) return;
		ev.preventDefault();
		ev.returnValue = S.upload_leave_warning ?? '';
	};
	/** Идёт ли передача файла — маршрут спрашивает перед уходом из дела внутри приложения. */
	export const uploading = () =>
		$uploads.active.some((u) => u.state === 'running' || u.state === 'queued');

	onMount(() => {
		void state.start();
		window.addEventListener('beforeunload', leaving);
	});
	onDestroy(() => {
		state.stop();
		if (typeof window !== 'undefined') window.removeEventListener('beforeunload', leaving);
	});
	$: (section, (menuOpen = false));
</script>

{#if menuOpen && $boot?.has_case}
	<div class="menuview" data-testid="case-menu">
		<div class="row sp g12 nw menuhead">
			<div class="col">
				<span class="xs mut aw">{name || S.case_no_title}</span>
				<h1 class="menutitle">{S.nav_title}</h1>
			</div>
			<button
				type="button"
				class="rb plain"
				aria-label={S.nav_close}
				on:click={() => (menuOpen = false)}
			>
				<Icon name="x" klass="l" />
			</button>
		</div>
		<nav class="menu" aria-label={S.nav_title}>
			<CaseNav {groups} current={section} {S} {hrefOf} onPick={() => (menuOpen = false)} />
			<a class="back" href={casesHref}>{S.back_to_cases}</a>
		</nav>
	</div>
{:else}
	<div class="shell" data-testid="case-page" data-section={section || 'overview'}>
		<nav class="nav" aria-label={S.nav_title}>
			<span class="brand">{S.brand_name}</span>
			<a class="back" href={casesHref}>{S.back_to_cases}</a>
			{#if groups.length}
				<div class="hr"></div>
				<CaseNav {groups} current={section} {S} {hrefOf} />
			{/if}
		</nav>

		<main class="main" id="main-content">
			<div class="top">
				<a class="rb" href={casesHref} aria-label={S.nav_to_cases}><Icon name="back" klass="l" /></a
				>
				{#if $boot?.has_case}
					<button
						type="button"
						class="sel plain"
						aria-haspopup="true"
						on:click={() => (menuOpen = true)}
						data-testid="case-menu-open"
					>
						<span>{label || S.nav_overview}</span><Icon name="d" />
					</button>
					{#if volumes.length}
						<button
							type="button"
							class="btn p"
							on:click={() => (gotoOpen = true)}
							data-testid="case-goto-open">{S.goto_short}</button
						>
					{/if}
				{/if}
			</div>

			{#if $bootError}
				{#if $bootError.kind === 'not_found'}
					<StateCard icon="folder" title={S.not_found} testid="case-boot-error">
						<a class="btn big act" href={casesHref}>{S.back_to_cases}</a>
					</StateCard>
				{:else}
					<StateCard
						icon="al"
						tone="stop"
						title={$bootError.kind === 'auth'
							? S.login_needed
							: $bootError.kind === 'network'
								? S.my_cases_error_network_title
								: fmt(S.section_error, { detail: $bootError.message })}
						testid="case-boot-error"
					>
						<button type="button" class="btn big p act" on:click={() => state.start()}
							><Icon name="retry" size={18} />{S.retry}</button
						>
					</StateCard>
				{/if}
			{:else if !$boot}
				<p class="mut" role="status">{S.loading}</p>
			{:else if !$boot.has_case}
				<div class="head">
					<div class="col g2 grow">
						<span class="eyebrow">{S.case_caption}</span>
						<h1>{name || S.case_no_title}</h1>
					</div>
				</div>
				<StateCard
					icon="folder"
					title={S.case_no_g}
					text={S.folders_without_case_note}
					testid="case-none"
				>
					<button type="button" class="btn big p act" disabled={creating} on:click={createCase}
						>{creating ? S.create_case_busy : S.create_case}</button
					>
				</StateCard>
			{:else}
				<div class="head">
					<div class="col g2 grow">
						<span class="eyebrow">{section ? name || S.case_no_title : S.case_caption}</span>
						{#if section && headCount}
							<div class="row g12">
								<h1>{label}</h1>
								<span class="cnt headcnt" class:w={item?.warn}
									>{section === 'inventory' ? count(headCount, S.documents_forms) : headCount}</span
								>
							</div>
						{:else}
							<h1>{section ? label || S.not_found : name || S.case_no_title}</h1>
						{/if}
					</div>
					<div class="row g8">
						<GotoForm action={refAction} {volumes} {S} />
						{#if !section}
							<a class="btn big p" href={chatHref}><Icon name="chat" />{S.chat_of_case}</a>
						{/if}
					</div>
				</div>

				{#if section === ''}
					<Overview {state} {S} {hrefOf} />
				{:else if !open}
					<StateCard icon="folder" title={S.not_found} testid="case-section-none">
						<a class="btn big act" href={hrefOf('')}>{S.nav_overview}</a>
					</StateCard>
				{:else if section === 'upload'}
					<Upload {state} {S} {hrefOf} />
				{:else if section === 'check'}
					<CheckSheets {state} {S} />
				{:else if section === 'volumes'}
					<Volumes {state} {S} {hrefOf} />
				{:else if section === 'inventory'}
					<Inventory {state} {S} />
				{:else if section === 'copies'}
					<Copies {state} {S} />
				{:else if section === 'passport'}
					<Passport {state} {S} {hrefOf} />
				{:else if section === 'amounts'}
					<Amounts {state} {S} />
				{:else if section === 'chronology'}
					<Chronology {state} {S} />
				{:else if section === 'deadlines'}
					<Deadlines {state} {S} />
				{:else if section === 'replace'}
					<Replace {state} {S} />
				{:else if section === 'extract'}
					<Extract {state} {S} />
				{:else}
					<!-- раздел следующей сдачи: пока открывается на прежней странице дела сервиса -->
					<section class="card" data-testid="case-section-later">
						<div class="row">
							<a
								class="btn"
								href={`${api.url(`case/${encodeURIComponent(folderId)}`)}#sec-${SECTION_SETTING[section] ?? section}`}
								data-sveltekit-reload>{S.open_case}</a
							>
						</div>
					</section>
				{/if}
			{/if}
		</main>
	</div>
{/if}

<Dialog bind:open={gotoOpen} title={S.goto_title_g} labelledby="cg-goto-title">
	<GotoForm action={refAction} {volumes} {S} variant="window" />
	<div class="row">
		<button type="button" class="btn" on:click={() => (gotoOpen = false)}>{S.cancel}</button>
	</div>
</Dialog>

<style>
	.plain {
		border: 0;
		font: inherit;
		cursor: pointer;
	}
	button.sel {
		text-align: left;
		color: inherit;
	}
	.headcnt {
		height: 26px;
		font-size: 13.5px;
	}
	.menuview {
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
	}
	.menuhead {
		min-height: 64px;
		padding: 0 16px;
	}
	.menutitle {
		font-size: 20px;
		font-weight: 500;
	}
</style>
