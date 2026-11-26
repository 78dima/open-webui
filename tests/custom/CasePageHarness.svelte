<script lang="ts">
	// Стенд страницы дела, просмотрщика листа (`SheetView`) и `/ref` (`RefResolve`): настоящие компоненты и стили.
	// Повторяет поведение `src/routes/case/[folderId]/+layout.svelte`: при SPA-переходе из раздела дела на лист или `/ref`
	// скрытый `<CasePage>` остаётся смонтированным со своим прежним разделом (`activeSection`/`activeSub`), не прерывая загрузки.
	import { onDestroy } from 'svelte';
	import { Toaster } from 'svelte-sonner';
	import { config } from './stores';
	import { page as pageStore } from './app-stores';
	import CaseRoot from '../../src/lib/components/custom/case/CaseRoot.svelte';
	import CasePage from '../../src/lib/components/custom/case/CasePage.svelte';
	import SheetView from '../../src/lib/components/custom/case/SheetView.svelte';
	import RefResolve from '../../src/lib/components/custom/case/RefResolve.svelte';
	import '../../src/lib/custom/case/case.css';

	type Standalone =
		| { kind: 'sheet'; folderId: string; pageId: string; search: string }
		| { kind: 'ref'; folderId: string; search: string };

	// раздел и, после косой черты, его часть: `s=tables/<номер>` — открытая таблица
	const split = (s: string) => {
		const [a = '', ...rest] = s.split('/');
		return [a, rest.join('/')];
	};

	function parseUrl(u: URL): {
		folderId: string;
		section: string;
		item: string;
		standalone: Standalone | null;
		pageUrl: URL;
	} {
		const mSheet = u.pathname.match(/^\/case\/([^/]+)\/p\/([^/]+)$/);
		if (mSheet) {
			const fid = decodeURIComponent(mSheet[1]);
			const pid = decodeURIComponent(mSheet[2]);
			return {
				folderId: fid,
				section: '',
				item: '',
				standalone: { kind: 'sheet', folderId: fid, pageId: pid, search: u.search },
				pageUrl: u
			};
		}
		const mRef = u.pathname.match(/^\/case\/([^/]+)\/ref$/);
		if (mRef) {
			const fid = decodeURIComponent(mRef[1]);
			return {
				folderId: fid,
				section: '',
				item: '',
				standalone: { kind: 'ref', folderId: fid, search: u.search },
				pageUrl: u
			};
		}
		const mCase = u.pathname.match(/^\/case\/([^/]+)(?:\/([^/]+)(?:\/(.+))?)?$/);
		if (mCase) {
			return {
				folderId: decodeURIComponent(mCase[1]),
				section: decodeURIComponent(mCase[2] ?? ''),
				item: decodeURIComponent(mCase[3] ?? ''),
				standalone: null,
				pageUrl: u
			};
		}
		const p = u.searchParams;
		if (p.has('casesheet')) {
			const fid = p.get('casesheet') ?? '';
			const pid = p.get('p') ?? '';
			const q = new URLSearchParams(p);
			q.delete('casesheet');
			q.delete('p');
			const qs = q.toString() ? `?${q.toString()}` : '';
			return {
				folderId: fid,
				section: '',
				item: '',
				standalone: { kind: 'sheet', folderId: fid, pageId: pid, search: qs },
				pageUrl: new URL(
					`/case/${encodeURIComponent(fid)}/p/${encodeURIComponent(pid)}${qs}`,
					u.origin
				)
			};
		}
		if (p.has('caseref')) {
			const fid = p.get('caseref') ?? '';
			const q = new URLSearchParams(p);
			q.delete('caseref');
			const qs = q.toString() ? `?${q.toString()}` : '';
			return {
				folderId: fid,
				section: '',
				item: '',
				standalone: { kind: 'ref', folderId: fid, search: qs },
				pageUrl: new URL(`/case/${encodeURIComponent(fid)}/ref${qs}`, u.origin)
			};
		}
		const fid = p.get('casepage') ?? '';
		const [sec, sub] = split(p.get('s') ?? '');
		return {
			folderId: fid,
			section: sec,
			item: sub,
			standalone: null,
			pageUrl: u
		};
	}

	let folderId = '';
	let visitedFolder = '';
	let activeSection = '';
	let activeSub = '';
	let standalone: Standalone | null = null;
	let caseTitle = '';
	let standaloneTitle = '';

	function syncFromUrl(u: URL) {
		const parsed = parseUrl(u);
		folderId = parsed.folderId;
		standalone = parsed.standalone;
		if (!standalone && folderId) {
			visitedFolder = folderId;
			activeSection = parsed.section;
			activeSub = parsed.item;
		}
		pageStore.set({
			url: parsed.pageUrl,
			params: {
				folderId,
				...(standalone?.kind === 'sheet' ? { pageId: standalone.pageId } : {}),
				...(!standalone && activeSection ? { section: activeSection } : {}),
				...(!standalone && activeSub ? { item: activeSub } : {})
			},
			route: {
				id:
					standalone?.kind === 'sheet'
						? '/case/[folderId]/p/[pageId]'
						: standalone?.kind === 'ref'
							? '/case/[folderId]/ref'
							: '/case/[folderId]'
			}
		});
	}

	syncFromUrl(new URL(location.href));

	function navigate(href: string, opts?: { replaceState?: boolean }) {
		const nextUrl = new URL(href, location.origin);
		const target = nextUrl.pathname + nextUrl.search + nextUrl.hash;
		if (opts?.replaceState) history.replaceState({}, '', target);
		else history.pushState({}, '', target);
		syncFromUrl(nextUrl);
	}

	(window as any).__onGoto = (path: string, opts?: { replaceState?: boolean }) => {
		if (path.startsWith('/case/') || path.startsWith('/?casepage=')) {
			navigate(path, opts);
		}
	};

	const hrefOf = (slug: string) =>
		`/?casepage=${encodeURIComponent(folderId)}${slug ? `&s=${slug}` : ''}`;

	function follow(ev: MouseEvent) {
		const a = (ev.target as HTMLElement).closest('a');
		const href = a?.getAttribute('href') ?? '';
		if (ev.defaultPrevented || a?.getAttribute('target') === '_blank') return;
		if (href.startsWith('/?casepage=') || /^\/case\/[^/]+(?:\/|$|\?)/.test(href)) {
			ev.preventDefault();
			navigate(href);
		}
	}

	const onPop = () => syncFromUrl(new URL(location.href));
	window.addEventListener('popstate', onPop);
	onDestroy(() => {
		window.removeEventListener('popstate', onPop);
		delete (window as any).__onGoto;
	});

	$: document.title = standalone ? standaloneTitle : caseTitle;
</script>

<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
{#if $config}
	<div class="frame" on:click={follow}>
		<CaseRoot>
			{#if visitedFolder && visitedFolder === folderId}
				<div class="case-wrap" hidden={!!standalone} data-testid="harness-case-wrap">
					{#key visitedFolder}
						<CasePage
							folderId={visitedFolder}
							section={activeSection}
							sub={activeSub}
							{hrefOf}
							bind:title={caseTitle}
						/>
					{/key}
				</div>
			{/if}
			{#if standalone?.kind === 'sheet'}
				<SheetView
					folderId={standalone.folderId}
					pageId={standalone.pageId}
					search={standalone.search}
					bind:title={standaloneTitle}
				/>
			{:else if standalone?.kind === 'ref'}
				<RefResolve
					folderId={standalone.folderId}
					search={standalone.search}
					bind:title={standaloneTitle}
				/>
			{/if}
		</CaseRoot>
	</div>
{/if}
<Toaster />

<style>
	.frame {
		height: 100dvh;
	}
	.case-wrap {
		height: 100%;
	}
	.case-wrap[hidden] {
		display: none;
	}
	:global(body) {
		margin: 0;
	}
</style>
