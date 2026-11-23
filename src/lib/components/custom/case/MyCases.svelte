<script lang="ts">
	// ai-dvokat: страница «Мои дела» (вариант «Г»; макеты D-panel, D-phone, D-dark, D-dark-phone, D-loading, D-empty,
	// D-empty-phone, D-error, D-error-phone, D-edge снимка дизайна). Данные — ручкой сервиса `GET api/cases`,
	// «Завести дело» — `POST api/cases/<папка>`; дерево разделов — папки чата (`$lib/apis/folders`). Всё остальное
	// (плитки, отбор, порядок, склонение) страница считает сама из пришедшего — `$lib/custom/case/mycases`.
	// Слова — только из строк сервиса (`S.ключ`), данные в разметку — только текстом.
	import { onDestroy, onMount } from 'svelte';
	import { config, folders as chatFolderStore, user } from '$lib/stores';
	import { createNewFolder, getFolders, getSharedFolders } from '$lib/apis/folders';
	import { CaseApiError, createCaseApi } from '$lib/custom/case/api';
	import { caseStrings, count, fmt, plural } from '$lib/custom/case/strings';
	import { caseToast } from '$lib/custom/case/toast';
	import {
		access,
		applyFilter,
		buildSections,
		caseMarks,
		listDelay,
		day,
		flatSections,
		parentMap,
		readListing,
		sortCases,
		totals,
		type CaseFolder,
		type FolderNode,
		type Order,
		type Scope
	} from '$lib/custom/case/mycases';
	import { viewWhy } from '$lib/custom/case/casepage';
	import FormDialog from './FormDialog.svelte';
	import Icon, { type IconName } from './Icon.svelte';
	import Busy from './Busy.svelte';
	import SectionTree from './SectionTree.svelte';
	import StateCard from './StateCard.svelte';

	/** Адрес чата (то же приложение). */
	export let chatHref = '/';
	/** Адрес страницы дела папки (страница форка); не задан — прежняя страница дела сервиса, с полной загрузкой. */
	export let caseHref: ((folderId: string) => string) | null = null;
	/** Что сделать, когда дело заведено; по умолчанию — открыть страницу дела. */
	export let onCreated: ((folderId: string) => void) | null = null;

	const api = createCaseApi($config?.custom_ui);
	const hrefOf = (id: string) =>
		caseHref ? caseHref(id) : api.url(`case/${encodeURIComponent(id)}`);

	$: S = $caseStrings ?? {};

	type Failure = { title: string; text: string };
	let phase: 'loading' | 'ready' | 'error' = 'loading';
	let failure: Failure = { title: '', text: '' };
	let folders: CaseFolder[] = [];
	let nodes: FolderNode[] | null = null;

	let scope: Scope = 'all';
	let section: string | null = null;
	let query = '';
	let order: Order = 'recent';
	let collapsed = new Set<string>();
	let creating: string | null = null;
	let controller: AbortController | null = null;

	/** Свои папки чата (для сверки названия новой папки с соседями верхнего уровня). */
	let ownFolders: { id: string; name?: string; parent_id?: string | null; updated_at?: number }[] = [];
	/** Дерево папок чата: нужно только для «Разделов из чата»; не пришло — страница работает без них. */
	async function chatFolders(): Promise<FolderNode[] | null> {
		const token = localStorage.getItem('token') ?? '';
		try {
			const [own, shared] = await Promise.all([getFolders(token), getSharedFolders(token)]);
			ownFolders = Array.isArray(own) ? own : [];
			// то же хранилище, что обновляет боковая панель чата (`initFolders`): новая папка видна в чате без перезагрузки
			chatFolderStore.set(
				[...ownFolders].sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0)) as never
			);
			return [...ownFolders, ...(Array.isArray(shared) ? shared : [])] as FolderNode[];
		} catch {
			return null;
		}
	}

	// ---- «Создать папку» (пакет 23.11, Д-4): окно здесь же, папка создаётся штатным запросом папок чата ----
	/** Право на папки — как у боковой панели чата (`Sidebar.svelte`, раздел «Папки»). */
	$: canFolders =
		!!$config?.features?.enable_folders &&
		($user?.role === 'admin' || ($user?.permissions?.features?.folders ?? true));
	/** Окно есть, когда сервис прислал его строки; прежний сервис — прежняя ссылка в чат. */
	$: folderDialog = canFolders && !!S.create_folder && !!S.new_folder_name;
	let folderOpen = false;
	let folderName = '';
	const askFolder = () => {
		folderName = '';
		folderOpen = true;
	};
	async function createFolder() {
		let name = folderName.trim();
		// пустое название — отказ, как у штатного окна («Folder name cannot be empty.»)
		if (!name) throw new CaseApiError(400, 'other', S.new_folder_empty);
		// повтор названия среди папок верхнего уровня — номер в конце, как у штатного окна
		const siblings = ownFolders.filter((f) => (f.parent_id ?? null) === null);
		const taken = (x: string) => siblings.some((f) => (f.name ?? '').toLowerCase() === x.toLowerCase());
		if (taken(name)) {
			let i = 1;
			while (taken(`${name} ${i}`)) i++;
			name = `${name} ${i}`;
		}
		try {
			await createNewFolder(localStorage.getItem('token') ?? '', { name });
		} catch (e) {
			throw new CaseApiError(400, 'other', typeof e === 'string' ? e : '');
		}
		caseToast(fmt(S.new_folder_done, { name }));
		await load();
	}

	function describe(error: unknown): Failure {
		const e = error as CaseApiError;
		switch (e?.kind) {
			case 'unavailable':
				return { title: S.my_cases_error_title, text: S.my_cases_error_chat };
			case 'network':
				return { title: S.my_cases_error_network_title, text: S.my_cases_error_network };
			case 'not_found':
				return { title: S.not_found, text: '' };
			case 'auth':
				return { title: S.login_needed, text: '' };
			default:
				return { title: S.my_cases_error_title, text: e?.message ?? '' };
		}
	}

	async function load() {
		controller?.abort();
		const own = new AbortController();
		controller = own;
		phase = 'loading';
		try {
			const [listing, tree] = await Promise.all([
				api.get('api/cases', { signal: own.signal }),
				chatFolders()
			]);
			if (controller !== own) return;
			folders = readListing(listing);
			nodes = tree;
			phase = 'ready';
		} catch (error) {
			if (controller !== own || (error as Error)?.name === 'AbortError') return;
			failure = describe(error);
			phase = 'error';
		}
	}

	async function createCase(f: CaseFolder) {
		if (creating) return;
		creating = f.id;
		try {
			await api.post(`api/cases/${encodeURIComponent(f.id)}`);
			if (onCreated) onCreated(f.id);
			else window.location.assign(hrefOf(f.id));
		} catch (error) {
			const e = error as CaseApiError;
			const detail = e?.kind === 'network' ? S.my_cases_error_network_title : (e?.message ?? '');
			caseToast(fmt(S.error_generic, { detail }), true);
			creating = null;
		}
	}

	const toggle = (id: string) => {
		const next = new Set(collapsed);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		collapsed = next;
	};
	const pick = (id: string) => (section = section === id ? null : id);

	$: all = totals(folders);
	$: parents = parentMap(folders, nodes);
	$: sections = buildSections(folders, parents, S.folder_untitled);
	$: flat = flatSections(sections);
	$: if (section && !flat.some((s) => s.id === section)) section = null;
	$: shown = applyFilter(folders, { scope, section, query }, parents);
	$: cases = sortCases(
		shown.filter((f) => f.case),
		order
	);
	$: empties = shown.filter((f) => !f.case);
	$: asked = query.trim();
	$: columns = Array.isArray(S.my_cases_columns_g) ? S.my_cases_columns_g : [];

	$: scopes = [
		{
			id: 'all',
			icon: 'folder',
			label: S.my_cases_filter_all,
			short: S.my_cases_filter_all_short,
			n: all.cases
		},
		{
			id: 'own',
			icon: 'user',
			label: S.my_cases_filter_own,
			short: S.my_cases_filter_own,
			n: all.casesOwn
		},
		{
			id: 'shared',
			icon: 'users',
			label: S.shared_with_me,
			short: S.shared_short,
			n: all.casesShared
		}
	] as { id: Scope; icon: IconName; label: string; short: string; n: number }[];

	const ACCESS: Record<string, { icon: IconName; key: string }> = {
		own: { icon: 'ok', key: 'access_own' },
		shared: { icon: 'users', key: 'access_shared' },
		readonly: { icon: 'lock', key: 'access_readonly' }
	};

	const volumesText = (f: CaseFolder) =>
		f.case && f.case.volumes > 0 ? count(f.case.volumes, S.volumes_forms) : S.volumes_none;

	// отметки дела (Н-1): идёт обработка / на паузе / не отвечает / ждёт / идёт проход — по виду дела от сервиса
	const marks = (f: CaseFolder) => caseMarks(f, S, (w) => viewWhy(w, S));

	// Пока у какого-то дела идёт обработка или проход, список тихо перечитывается раз в 15 с; когда остались только
	// пауза, молчащий обработчик или ожидание — раз в 30 с (как редкий опрос «Обзора»); без работы список не
	// спрашивается. Отметка сама уходит, когда работа закончилась.
	let quiet = false;
	let gone = false;
	let busyTimer: ReturnType<typeof setTimeout> | null = null;
	function schedule() {
		if (busyTimer !== null) clearTimeout(busyTimer);
		busyTimer = null;
		if (gone) return;
		// без работы — проверить снова через 30 с: список мог прийти позже (загрузка) или дело заведено в другой вкладке
		busyTimer = setTimeout(() => void refreshBusy(), listDelay(folders) ?? 30000);
	}
	async function refreshBusy() {
		busyTimer = null;
		try {
			if (quiet || phase !== 'ready' || listDelay(folders) === null) return;
			if (typeof document !== 'undefined' && document.hidden) return;
			quiet = true;
			const own = controller;
			try {
				const listing = await api.get('api/cases');
				if (controller === own && phase === 'ready') folders = readListing(listing);
			} catch {
				// сбой тихого перечитывания списка не трогает: следующее — через тот же срок
			} finally {
				quiet = false;
			}
		} finally {
			schedule();
		}
	}
	onMount(() => {
		void load();
		schedule();
	});
	onDestroy(() => {
		gone = true;
		controller?.abort();
		if (busyTimer !== null) clearTimeout(busyTimer);
	});
</script>

<div class="shell mc" data-testid="my-cases" data-phase={phase}>
	<nav class="mc-nav w" aria-label={S.my_cases_nav_label}>
		<span class="mc-brand">{S.brand_name}</span>
		{#each scopes as s (s.id)}
			<button
				type="button"
				class="mc-item"
				class:on={scope === s.id}
				aria-pressed={scope === s.id}
				data-testid="case-scope-{s.id}"
				on:click={() => (scope = s.id)}
			>
				<Icon name={s.icon} size={20} stroke={1.6} />
				<span class="grow">{s.label}</span>
				{#if phase === 'ready'}<span class="mc-n">{s.n}</span>{/if}
			</button>
		{/each}
		{#if phase === 'ready' && sections.length}
			<div class="mc-hr"></div>
			<span class="mc-cap">{S.my_cases_sections}</span>
			<div class="mc-tree">
				<SectionTree
					{sections}
					selected={section}
					{collapsed}
					labels={{ expand: S.expand, collapse: S.collapse }}
					onSelect={pick}
					onToggle={toggle}
				/>
			</div>
		{/if}
	</nav>

	<main class="mc-main" id="main-content">
		<header class="mc-top n">
			<span class="mc-brand">{S.brand_name}</span>
			<a class="mc-chat" class:ghost={phase === 'error'} href={chatHref}>
				<Icon name="chat" size={18} />{S.go_to_chat_short}
			</a>
		</header>

		<div
			class="mc-head"
			class:apart={phase !== 'loading' && !(phase === 'ready' && folders.length)}
		>
			<h1>{S.my_cases_title}</h1>
			{#if phase === 'loading'}
				<span class="mc-loading" role="status">{S.loading}</span>
			{:else if phase === 'ready' && folders.length}
				<label class="mc-search">
					<Icon name="search" size={18} />
					<input
						type="search"
						aria-label={S.my_cases_search_label}
						placeholder={S.my_cases_search}
						autocomplete="off"
						spellcheck="false"
						bind:value={query}
					/>
				</label>
			{/if}
			<a class="mc-chat w" class:ghost={phase === 'error'} href={chatHref}>
				<Icon name="chat" size={18} />{S.go_to_chat}
			</a>
		</div>

		{#if phase === 'loading'}
			<div class="mc-tiles" aria-hidden="true">
				{#each [1, 2, 3] as i (i)}
					<div class="mc-tile t{i}">
						<span class="chip skel"></span>
						<span class="bars"><span class="bar a"></span><span class="bar b"></span></span>
					</div>
				{/each}
			</div>
			<section class="mc-card">
				<h2 class="mc-h2 lone">{S.my_cases_list_title}</h2>
				<div aria-hidden="true">
					{#each [240, 170, 210] as width (width)}
						<div class="mc-skel-row">
							<span class="c1"><i style:width="{width}px"></i></span>
							<span class="c2 w"><i></i></span>
							<span class="c3 w"><i></i></span>
							<span class="c4 w"><i></i></span>
							<span class="c5 w"></span>
						</div>
					{/each}
				</div>
			</section>
		{:else if phase === 'error'}
			<StateCard
				icon="al"
				tone="stop"
				title={failure.title}
				text={failure.text}
				testid="case-error"
			>
				<button class="mc-big act" type="button" data-testid="case-retry" on:click={load}>
					<Icon name="retry" size={18} />{S.retry}
				</button>
			</StateCard>
		{:else if !folders.length}
			<StateCard
				icon="folder"
				title={S.my_cases_empty_title}
				text={S.my_cases_empty}
				testid="case-empty"
			>
				{#if folderDialog}
					<button type="button" class="mc-big ghost act" on:click={askFolder} data-testid="case-new-folder"
						><Icon name="plus" stroke={2} />{S.create_folder}</button
					>
				{:else if canFolders}
					<a class="mc-big ghost act" href={chatHref}
						><Icon name="plus" stroke={2} />{S.create_folder_in_chat}</a
					>
				{/if}
			</StateCard>
		{:else}
			<div class="mc-tiles">
				<div class="mc-tile t1" data-testid="case-tile-cases">
					<span class="chip" aria-hidden="true"><Icon name="folder" size={20} stroke={1.7} /></span>
					<div class="w col">
						<span class="lab">{S.my_cases_tile_cases}</span>
						<span class="val"
							><b>{all.cases}</b>{#if all.casesShared}<span class="lab"
									>{count(all.casesShared, S.my_cases_tile_cases_note_forms)}</span
								>{/if}</span
						>
					</div>
					<b class="n">{all.cases}</b>
					<span class="lab n">{plural(all.cases, S.cases_forms)}</span>
				</div>
				<div class="mc-tile t2" data-testid="case-tile-volumes">
					<span class="chip" aria-hidden="true"><Icon name="vol" size={20} stroke={1.7} /></span>
					<div class="w col">
						<span class="lab">{S.my_cases_tile_volumes}</span>
						<span class="val"
							><b>{all.volumes}</b>{#if all.casesWithVolumes}<span class="lab"
									>{count(all.casesWithVolumes, S.my_cases_tile_volumes_note_forms)}</span
								>{/if}</span
						>
					</div>
					<b class="n">{all.volumes}</b>
					<span class="lab n">{plural(all.volumes, S.volumes_forms)}</span>
				</div>
				<div class="mc-tile t3" data-testid="case-tile-folders">
					<span class="chip" aria-hidden="true"
						><Icon name="folder-plus" size={20} stroke={1.7} /></span
					>
					<div class="w col">
						<span class="lab">{S.folders_without_case}</span>
						<span class="val"
							><b>{all.foldersWithoutCase}</b>{#if all.foldersCanCreate}<span class="lab"
									>{fmt(S.folders_without_case_tile_note, { n: all.foldersCanCreate })}</span
								>{/if}</span
						>
					</div>
					<b class="n">{all.foldersWithoutCase}</b>
					<span class="lab n">{plural(all.foldersWithoutCase, S.folders_without_case_forms)}</span>
				</div>
			</div>

			<div class="mc-pills n" role="group" aria-label={S.my_cases_nav_label}>
				{#each scopes as s (s.id)}
					<button
						type="button"
						class="mc-pillbtn"
						class:on={scope === s.id}
						aria-pressed={scope === s.id}
						on:click={() => (scope = s.id)}>{s.short} <span>{s.n}</span></button
					>
				{/each}
				{#if flat.length}
					<select aria-label={S.my_cases_section_label} bind:value={section}>
						<option value={null}>{S.my_cases_sections_all}</option>
						{#each flat as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
					</select>
				{/if}
			</div>

			<section class="mc-card" data-testid="case-list">
				<div class="mc-cardhead">
					<div class="mc-title">
						<h2 class="mc-h2">{S.my_cases_list_title}</h2>
						{#if !(asked && !cases.length)}<span class="mc-cnt">{cases.length}</span>{/if}
					</div>
					{#if cases.length}
						<label class="mc-sort w"
							>{S.my_cases_sort}
							<select bind:value={order}>
								<option value="recent">{S.my_cases_sort_recent}</option>
								<option value="name">{S.my_cases_sort_name}</option>
							</select>
						</label>
					{/if}
				</div>

				{#if !cases.length}
					<div class="mc-note">
						{#if asked}
							<p>{fmt(S.my_cases_search_empty, { q: asked })}</p>
							<button type="button" class="mc-btn" on:click={() => (query = '')}
								>{S.my_cases_search_reset}</button
							>
						{:else}
							<p>{empties.length ? S.my_cases_no_cases : S.my_cases_none_here}</p>
						{/if}
					</div>
				{:else}
					<div class="mc-scroll w">
						<div class="mc-table" role="table" aria-label={S.my_cases_list_title}>
							<div class="mc-row th" role="row">
								{#each columns as c (c)}<span role="columnheader">{c}</span>{/each}
								<span role="columnheader"></span>
							</div>
							{#each cases as f (f.id)}
								{@const a = ACCESS[access(f)]}
								<div class="mc-row" role="row" data-testid="case-row" data-folder={f.id}>
									<div class="name" role="cell">
										{#if f.path}<span class="path">{f.path}</span>{/if}
										<a
											class="title"
											class:none={!f.title}
											href={hrefOf(f.id)}
											data-sveltekit-reload={caseHref ? undefined : ''}
											>{f.title || S.folder_untitled}</a
										>
										{#each marks(f) as m (m.key)}<span
												class="mc-pill busy {m.tone}"
												title={m.why}
												data-testid="case-row-busy"
												data-mark={m.key}><Icon name={m.icon} />{S[m.key]}</span
											>{/each}
									</div>
									<span class="vol" class:none={!f.case?.volumes} role="cell">{volumesText(f)}</span
									>
									<span class="date" role="cell">{day(f.case?.changed)}</span>
									<span role="cell"
										><span class="mc-pill {access(f)}"><Icon name={a.icon} />{S[a.key]}</span></span
									>
									<span role="cell"
										><a
											class="mc-btn open"
											href={hrefOf(f.id)}
											data-sveltekit-reload={caseHref ? undefined : ''}>{S.open_case}</a
										></span
									>
								</div>
							{/each}
						</div>
					</div>

					<div class="mc-list n">
						{#each cases as f (f.id)}
							{@const a = ACCESS[access(f)]}
							<a
								class="mc-line"
								href={hrefOf(f.id)}
								data-sveltekit-reload={caseHref ? undefined : ''}
								data-folder={f.id}
							>
								<span class="body">
									{#if f.path}<span class="path">{f.path}</span>{/if}
									<span class="title" class:none={!f.title}>{f.title || S.folder_untitled}</span>
									<span class="meta"
										>{volumesText(f)}{f.case?.changed
											? ` · ${fmt(S.changed_on, { date: day(f.case.changed) })}`
											: ''}</span
									>
									<span class="tag"
										><span class="mc-pill {access(f)}"
											><Icon name={a.icon} size={15} />{S[a.key]}</span
										>{#each marks(f) as m (m.key)}<span
												class="mc-pill busy {m.tone}"
												title={m.why}
												data-mark={m.key}><Icon name={m.icon} size={15} />{S[m.key]}</span
											>{/each}</span
									>
								</span>
								<Icon name="r" size={20} />
							</a>
						{/each}
					</div>
				{/if}
			</section>

			<section class="mc-free" data-testid="case-folders">
				{#if empties.length}
					<div class="mc-freehead">
						<div class="col">
							<div class="mc-title">
								<h2 class="mc-h2">{S.folders_without_case}</h2>
								<span class="mc-cnt solid">{empties.length}</span>
							</div>
							<p>{S.folders_without_case_note}</p>
						</div>
						{#if folderDialog}
							<button type="button" class="mc-new w" on:click={askFolder} data-testid="case-new-folder"
								><Icon name="plus" stroke={2} />{S.create_folder}</button
							>
						{:else if canFolders}
							<a class="mc-new w" href={chatHref}
								><Icon name="plus" stroke={2} />{S.create_folder_in_chat}</a
							>
						{/if}
					</div>
					<div class="mc-grid">
						{#each empties as f (f.id)}
							<div
								class="mc-folder"
								class:ro={!f.write}
								data-testid="case-folder"
								data-folder={f.id}
							>
								<span class="ico w" aria-hidden="true"
									><Icon name="folder" size={18} stroke={1.7} /></span
								>
								<span class="name">
									{#if f.path}<span class="path">{f.path}</span>{/if}
									<span class="title" class:none={!f.title}>{f.title || S.folder_untitled}</span>
								</span>
								{#if f.write}
									<button
										type="button"
										class="mc-btn"
										disabled={creating !== null}
										class:busy={creating === f.id}
										on:click={() => createCase(f)}
										><Busy on={creating === f.id} text={S.create_case_busy}>{S.create_case}</Busy
										></button
									>
								{:else}
									<span class="mc-pill readonly"><Icon name="lock" />{S.access_readonly}</span>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<div class="mc-freehead alone w">
						{#if folderDialog}
							<button type="button" class="mc-new" on:click={askFolder} data-testid="case-new-folder"
								><Icon name="plus" stroke={2} />{S.create_folder}</button
							>
						{:else if canFolders}
							<a class="mc-new" href={chatHref}
								><Icon name="plus" stroke={2} />{S.create_folder_in_chat}</a
							>
						{/if}
					</div>
				{/if}
				{#if folderDialog}
					<button type="button" class="mc-new wide n" on:click={askFolder} data-testid="case-new-folder"
						><Icon name="plus" stroke={2} />{S.create_folder}</button
					>
				{:else if canFolders}
					<a class="mc-new wide n" href={chatHref}
						><Icon name="plus" stroke={2} />{S.create_folder_in_chat}</a
					>
				{/if}
			</section>
		{/if}
	</main>
</div>

<FormDialog
	bind:open={folderOpen}
	title={S.new_folder_title}
	{S}
	submit={createFolder}
	submitText={S.create_folder}
	testid="case-new-folder-dialog"
>
	<label class="lbl"
		>{S.new_folder_name}<input
			class="in"
			type="text"
			maxlength="200"
			required
			autocomplete="off"
			bind:value={folderName}
		/></label
	>
	<p class="sm mut">{S.new_folder_hint}</p>
</FormDialog>

<style>
	/* Значения — из макетов D-* (там они записаны прямо в разметке). Цвета, общие с делом и листом, — переменные
	   case.css; здесь — только то, чего в g.css нет: оттенки меню, пометок и кнопок «Моих дел» в двух схемах. */
	.mc {
		--raise: #ffffff;
		--chip: #ffffff;
		--nav-on: #ffffff;
		--nav-on-fg: #1b1b29;
		--ctl-line: #e3e3ec;
		--ctl-line2: #d5d5e3;
		--search-line: #d9d9e6;
		--btn-line2: #b9b9cc;
		--ico-bg: #efeff8;
		--glass: rgba(255, 255, 255, 0.6);
		--select-bg: rgba(255, 255, 255, 0.6);
		--tile-chip: #ffffff;
		--tile-chip-shadow: 0 2px 6px rgba(90, 60, 110, 0.12);
		--pill-shadow: 0 1px 3px rgba(60, 60, 110, 0.08);
		--cnt-shadow: 0 1px 3px rgba(60, 60, 110, 0.1);
		--skel: #ececf3;
		--skel-tile: rgba(27, 27, 41, 0.12);
		--skel-chip: rgba(255, 255, 255, 0.7);
		flex-wrap: nowrap;
	}
	:global(html.dark) .mc {
		--raise: #23232e;
		--chip: #2a2a38;
		--nav-on: #2a2a38;
		--nav-on-fg: #ffffff;
		--ctl-line: #34343f;
		--ctl-line2: #34343f;
		--search-line: #34343f;
		--btn-line2: #4a4a5c;
		--ico-bg: #2a2a38;
		--glass: rgba(255, 255, 255, 0.04);
		--select-bg: #1e1e28;
		--tile-chip: rgba(255, 255, 255, 0.12);
		--tile-chip-shadow: none;
		--pill-shadow: none;
		--cnt-shadow: none;
		--skel: #292935;
		--skel-tile: rgba(255, 255, 255, 0.12);
		--skel-chip: rgba(255, 255, 255, 0.12);
		--muted2: #c3c3d3;
	}

	.n {
		display: none !important;
	}
	.mc :global(button),
	.mc :global(select),
	.mc :global(input) {
		line-height: normal;
	}
	.col {
		display: flex;
		flex-direction: column;
	}
	.grow {
		flex: 1 1 auto;
		min-width: 0;
	}
	.mc-main h1 {
		font-size: 30px;
		line-height: 1.2;
		font-weight: 400;
		letter-spacing: -0.01em;
	}
	.mc-h2 {
		font-size: 21px;
		line-height: 1.3;
		font-weight: 400;
	}
	.mc-h2.lone {
		padding-bottom: 8px;
	}

	/* меню: ширина — по содержимому его пунктов, не уже 232 px; дерево папок переносится внутри себя */
	.mc-nav {
		flex: 0 0 auto;
		min-width: 232px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 28px 18px;
		border-right: 1px solid var(--line);
	}
	.mc-tree {
		width: 0;
		min-width: 100%;
	}
	.mc-brand {
		padding: 0 14px 22px;
		font-size: 19px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.mc-item {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 44px;
		padding: 0 14px;
		border: none;
		border-radius: 999px;
		background: transparent;
		font-size: 14.5px;
		color: var(--fg2);
		text-align: left;
		white-space: nowrap;
		cursor: pointer;
	}
	.mc-item.on {
		background: var(--nav-on);
		box-shadow: var(--pop);
		font-weight: 500;
		color: var(--nav-on-fg);
	}
	.mc-n {
		font-weight: 400;
		color: var(--muted);
	}
	.mc-hr {
		flex: 0 0 1px;
		height: 1px;
		margin: 14px 6px;
		background: var(--line);
	}
	.mc-cap {
		padding: 0 14px 4px;
		font-size: 12.5px;
		color: var(--muted);
	}

	/* правая часть */
	.mc-main {
		flex: 999 1 560px;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 28px;
		padding: 28px 40px 40px;
	}
	.mc-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 12px 24px;
	}
	.mc-head.apart {
		justify-content: space-between;
	}
	.mc-search,
	.mc-loading {
		flex: 1 1 220px;
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 44px;
		padding-left: 24px;
		border-left: 1px solid var(--search-line);
	}
	.mc-loading {
		font-size: 14.5px;
		color: var(--muted);
	}
	.mc-search :global(.ic) {
		color: var(--muted);
	}
	.mc-search input {
		flex: 1 1 auto;
		min-width: 0;
		height: 44px;
		padding: 0;
		border: none;
		outline: none;
		background: transparent;
		font-size: 16px;
		color: var(--fg);
	}
	.mc-search:focus-within {
		border-left-color: var(--link);
	}
	.mc-chat,
	.mc-big {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		min-height: 46px;
		padding: 0 21px;
		border: 1px solid transparent;
		border-radius: 999px;
		background: var(--accent);
		color: var(--accent-fg);
		font-size: 14.5px;
		font-weight: 500;
		white-space: nowrap;
		cursor: pointer;
	}
	.mc-big {
		padding: 0 23px;
	}
	.mc-chat.ghost,
	.mc-big.ghost {
		border-color: var(--btn-line2);
		background: var(--card);
		color: var(--fg);
	}
	.mc-chat.ghost {
		padding: 0 22px;
	}
	.mc-big.ghost {
		gap: 8px;
		padding: 0 22px;
	}

	/* плитки */
	.mc-tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
		gap: 8px;
	}
	.mc-tile {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 16px 18px;
		border-radius: 12px;
		background: linear-gradient(100deg, var(--t1) 0%, var(--t2) 100%);
	}
	.mc-tile.t2 {
		background: linear-gradient(100deg, var(--t2) 0%, var(--t3) 100%);
	}
	.mc-tile.t3 {
		background: linear-gradient(100deg, var(--t3) 0%, var(--t4) 100%);
	}
	.mc-tile .chip {
		flex: 0 0 44px;
		height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		background: var(--tile-chip);
		box-shadow: var(--tile-chip-shadow);
		color: var(--fg);
	}
	.mc-tile .chip.skel {
		background: var(--skel-chip);
		box-shadow: none;
	}
	.mc-tile .lab {
		font-size: 13px;
		color: var(--muted2);
	}
	.mc-tile .val {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 8px;
	}
	.mc-tile b {
		font-size: 26px;
		line-height: 1.2;
		font-weight: 500;
	}
	.mc-tile .bars {
		display: flex;
		flex-direction: column;
		gap: 9px;
	}
	.mc-tile .bar {
		height: 10px;
		width: 60px;
		border-radius: 999px;
		background: var(--skel-tile);
	}
	.mc-tile .bar.b {
		width: 120px;
		height: 18px;
	}

	/* карточка «Дела» */
	.mc-card {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 22px 24px 8px;
		border-radius: 14px;
		background: var(--card);
		box-shadow: var(--shadow);
	}
	.mc-cardhead {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px 16px;
		padding-bottom: 8px;
	}
	.mc-title {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.mc-cnt {
		display: inline-flex;
		align-items: center;
		height: 26px;
		padding: 0 10px;
		border: 1px solid var(--ctl-line);
		border-radius: 999px;
		font-size: 12.5px;
		font-weight: 500;
		color: var(--fg2);
	}
	.mc-cnt.solid {
		height: 24px;
		border: none;
		background: var(--chip);
		box-shadow: var(--cnt-shadow);
	}
	.mc-sort {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 13.5px;
		color: var(--muted);
	}
	.mc-sort select {
		height: 40px;
		padding: 0 12px;
		border: 1px solid var(--ctl-line);
		border-radius: 999px;
		font-size: 14.5px;
	}
	.mc-note {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 12px;
		min-height: 80px;
		padding-bottom: 14px;
	}
	.mc-note p {
		font-size: 15px;
		color: var(--muted2);
		overflow-wrap: break-word;
	}
	.mc-scroll {
		overflow-x: auto;
	}
	.mc-table {
		min-width: 700px;
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(100px, max-content) 120px 150px 140px;
		column-gap: 16px;
	}
	.mc-row {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: subgrid;
		align-items: center;
		min-height: 68px;
		padding: 10px 0;
		border-top: 1px solid var(--line2);
		font-size: 14.5px;
	}
	.mc-row.th {
		min-height: 0;
		border-top: 0;
		font-size: 13px;
		color: var(--muted);
	}
	.mc-row .name,
	.mc-folder .name,
	.mc-line .body {
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.path {
		font-size: 12.5px;
		color: var(--muted);
		overflow-wrap: break-word;
	}
	.mc-row .title {
		font-size: 15.5px;
		font-weight: 500;
		line-height: 1.35;
		overflow-wrap: break-word;
	}
	.none {
		color: var(--muted);
	}
	.mc-row .vol {
		white-space: nowrap;
	}
	.mc-row .date {
		font-variant-numeric: tabular-nums;
	}
	.mc-pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 12px 0 9px;
		border: 1px solid var(--ctl-line);
		border-radius: 999px;
		background: var(--raise);
		box-shadow: var(--pill-shadow);
		font-size: 13px;
		font-weight: 500;
		color: var(--fg2);
		white-space: nowrap;
	}
	/* «идёт обработка» у дела — в тоне плашек хода страницы дела (.pill.i) */
	.mc-pill.busy {
		align-self: flex-start;
		border-color: transparent;
		background: var(--info-bg);
		color: var(--info);
	}
	/* на паузе, не отвечает, ждёт — в тоне записки о паузе страницы дела */
	.mc-pill.busy.w {
		background: var(--warn-bg);
		color: var(--warn);
	}
	.mc-pill.shared {
		color: var(--info);
	}
	.mc-pill.readonly {
		color: var(--stop);
	}
	.mc-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 40px;
		padding: 0 16px;
		border: 1px solid var(--btn-line);
		border-radius: 999px;
		background: var(--raise);
		font-size: 14px;
		font-weight: 500;
		color: var(--fg);
		white-space: nowrap;
		cursor: pointer;
	}
	.mc-btn.open {
		width: 100%;
		padding: 0;
		font-size: 14.5px;
	}
	.mc-btn:disabled {
		cursor: default;
	}
	.mc-btn.busy {
		border-color: var(--line);
		background: var(--soft);
		color: var(--muted);
	}

	/* «Папки без дела» */
	.mc-free {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.mc-freehead {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px 16px;
	}
	.mc-freehead.alone {
		justify-content: flex-end;
	}
	.mc-freehead .col {
		gap: 2px;
	}
	.mc-freehead p {
		font-size: 13.5px;
		color: var(--muted);
	}
	/* «Создать папку» — кнопка в виде прежней ссылки */
	button.mc-new,
	button.mc-big {
		font: inherit;
		cursor: pointer;
	}
	.mc-new {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		min-height: 44px;
		padding: 0 20px;
		border: 1px solid var(--btn-line2);
		border-radius: 999px;
		background: var(--glass);
		font-size: 14.5px;
		font-weight: 500;
		white-space: nowrap;
	}
	.mc-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(380px, 100%), 1fr));
		gap: 8px;
	}
	.mc-folder {
		display: flex;
		align-items: center;
		gap: 14px;
		min-height: 64px;
		padding: 10px 14px;
		border-radius: 12px;
		background: var(--card);
		box-shadow: var(--shadow);
	}
	.mc-folder .ico {
		flex: 0 0 40px;
		height: 40px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		background: var(--ico-bg);
		color: var(--fg2);
	}
	.mc-folder .name {
		flex: 1 1 auto;
	}
	.mc-folder .title {
		font-size: 15px;
		font-weight: 500;
		line-height: 1.35;
		overflow-wrap: break-word;
	}
	.mc-folder .mc-btn,
	.mc-folder .mc-pill {
		flex: 0 0 auto;
	}

	/* заготовка строк при загрузке */
	.mc-skel-row {
		display: flex;
		align-items: center;
		gap: 16px;
		min-height: 68px;
		border-top: 1px solid var(--line2);
	}
	.mc-skel-row span {
		display: flex;
	}
	.mc-skel-row i {
		display: block;
		max-width: 100%;
		height: 12px;
		border-radius: 999px;
		background: var(--skel);
	}
	.mc-skel-row .c1 {
		flex: 1 1 auto;
		min-width: 0;
	}
	.mc-skel-row .c2 {
		flex: 0 0 100px;
	}
	.mc-skel-row .c2 i {
		width: 56px;
	}
	.mc-skel-row .c3 {
		flex: 0 0 120px;
	}
	.mc-skel-row .c3 i {
		width: 80px;
	}
	.mc-skel-row .c4 {
		flex: 0 0 150px;
	}
	.mc-skel-row .c4 i {
		width: 84px;
		height: 30px;
	}
	.mc-skel-row .c5 {
		flex: 0 0 140px;
		height: 40px;
		border-radius: 999px;
		background: var(--skel);
	}

	/* наведение: в макетах его нет; подсказка «это нажимается», без смены раскладки */
	@media (hover: hover) {
		.mc-item:not(.on):hover,
		.mc-pillbtn:not(.on):hover {
			background: var(--glass);
		}
		.mc-btn:not(:disabled):hover,
		.mc-new:hover,
		.mc-chat.ghost:hover,
		.mc-big.ghost:hover {
			border-color: var(--fg2);
		}
		.mc-chat:not(.ghost):hover,
		.mc-big:not(.ghost):hover {
			opacity: 0.9;
		}
		.mc-row .title:hover,
		.mc-line:hover .title {
			color: var(--link);
		}
	}

	/* узкий экран (макеты D-phone, D-dark-phone, D-empty-phone, D-error-phone) */
	@media (max-width: 720px) {
		.w {
			display: none !important;
		}
		.n {
			display: revert !important;
		}
		.mc {
			line-height: 1.45;
		}
		/* фон телефона в макетах «Моих дел» — свой наклон и чуть светлее (в тёмной схеме цвета те же) */
		:global(.cg.cg-page:has(> .mc)) {
			background: linear-gradient(160deg, #e9e9f4 0%, #f2ebf2 50%, #e6eaf5 100%);
		}
		:global(html.dark .cg.cg-page:has(> .mc)) {
			background: linear-gradient(160deg, var(--bg1) 0%, var(--bg2) 50%, var(--bg3) 100%);
		}
		.mc-main {
			gap: 16px;
			padding: 0;
		}
		.mc-top.n {
			display: flex !important;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			min-height: 64px;
		}
		.mc-brand {
			padding: 0;
			font-size: 18px;
		}
		.mc-top .mc-chat {
			gap: 8px;
			min-height: 44px;
			padding: 0 17px;
		}
		.mc-top .mc-chat.ghost {
			padding: 0 18px;
		}
		.mc-main h1 {
			font-size: 28px;
		}
		.mc-h2 {
			font-size: 20px;
		}
		.mc-head {
			display: flex;
			flex-direction: column;
			align-items: stretch;
			gap: 16px;
		}
		.mc-search {
			position: relative;
			flex: 0 0 auto;
			display: block;
			min-height: 0;
			padding: 0;
			border: 0;
		}
		.mc-search :global(.ic) {
			position: absolute;
			left: 16px;
			top: 15px;
		}
		.mc-search input {
			width: 100%;
			height: 48px;
			padding: 0 16px 0 44px;
			border: 1px solid var(--ctl-line);
			border-radius: 999px;
			background: var(--card);
		}
		.mc-search input:focus-visible {
			border-color: var(--link);
		}
		.mc-loading {
			flex: 0 0 auto;
			min-height: 0;
			padding: 0;
			border: 0;
		}
		.mc-tiles {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
		.mc-tile {
			flex-direction: column;
			align-items: flex-start;
			gap: 2px;
			min-height: 84px;
			padding: 12px;
			background: linear-gradient(120deg, var(--t1) 0%, var(--t2) 100%);
		}
		.mc-tile.t2 {
			background: linear-gradient(120deg, var(--t2) 0%, var(--t3) 100%);
		}
		.mc-tile.t3 {
			background: linear-gradient(120deg, var(--t3) 0%, var(--t4) 100%);
		}
		.mc-tile .chip,
		.mc-tile .bars {
			display: none;
		}
		.mc-tile b.n {
			display: block !important;
			font-size: 24px;
		}
		.mc-tile .lab.n {
			display: block !important;
			font-size: 12.5px;
			line-height: 1.3;
		}
		.mc-pills.n {
			display: flex !important;
			flex-wrap: wrap;
			gap: 8px;
		}
		.mc-pillbtn {
			min-height: 44px;
			padding: 0 16px;
			border: 1px solid var(--ctl-line2);
			border-radius: 999px;
			background: transparent;
			font-size: 14.5px;
			color: var(--fg2);
			cursor: pointer;
		}
		.mc-pillbtn span {
			font-weight: 400;
			color: var(--muted);
		}
		.mc-pillbtn.on {
			border-width: 0;
			background: var(--nav-on);
			box-shadow: var(--pop);
			font-weight: 500;
			color: var(--nav-on-fg);
		}
		.mc-pills select {
			flex: 1 1 100%;
			min-width: 0;
			height: 44px;
			padding: 0 14px;
			border: 1px solid var(--ctl-line2);
			border-radius: 999px;
			background-color: var(--select-bg);
			font-size: 16px;
		}
		.mc-card {
			gap: 0;
			padding: 16px 16px 4px;
			border-radius: 16px;
		}
		.mc-cardhead {
			padding-bottom: 12px;
		}
		.mc-title {
			gap: 10px;
		}
		.mc-list.n {
			display: flex !important;
			flex-direction: column;
		}
		.mc-line {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 14px 0;
			border-top: 1px solid var(--line2);
		}
		.mc-line .body {
			flex: 1 1 auto;
			gap: 2px;
		}
		.mc-line .title {
			font-size: 16px;
			font-weight: 500;
			line-height: 1.3;
			overflow-wrap: break-word;
		}
		.mc-line .meta {
			font-size: 13.5px;
			color: var(--muted);
			font-variant-numeric: tabular-nums;
		}
		.mc-line .tag {
			display: flex;
			margin-top: 6px;
		}
		.mc-line > :global(.ic) {
			color: var(--muted);
		}
		.mc-pill {
			height: 28px;
			padding: 0 11px 0 8px;
			font-size: 12.5px;
		}
		.mc-pill :global(.ic) {
			width: 15px;
			height: 15px;
		}
		.mc-free {
			gap: 8px;
			margin-top: 8px;
		}
		.mc-freehead {
			padding-bottom: 4px;
		}
		.mc-grid {
			grid-template-columns: minmax(0, 1fr);
		}
		.mc-folder {
			gap: 10px;
			padding: 10px 10px 10px 14px;
		}
		.mc-folder .title {
			line-height: 1.3;
		}
		.mc-folder .mc-btn {
			min-height: 44px;
			padding: 0 14px;
		}
		.mc-folder.ro {
			flex-direction: column;
			align-items: flex-start;
			justify-content: center;
			gap: 8px;
			padding: 14px;
		}
		.mc-btn {
			min-height: 44px;
		}
		.mc-new.wide.n {
			display: flex !important;
			min-height: 48px;
			margin-top: 8px;
			padding: 0 16px;
		}
		.mc-big {
			min-height: 48px;
		}
		.mc :global(.state .mc-big:not(.ghost)) {
			font-size: 15px;
		}
		.mc-skel-row {
			min-height: 56px;
		}
	}
</style>
