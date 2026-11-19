<script lang="ts">
	// Стенд страницы дела: настоящие компоненты и стили; вместо маршрутов SvelteKit — раздел из адреса стенда
	// (?casepage=<папка>&s=<раздел>) и переход по ссылкам разделов без перезагрузки, как в приложении (страница дела
	// при смене раздела остаётся той же). Ручки сервиса подменяет проверка (page.route).
	import { Toaster } from 'svelte-sonner';
	import { config } from './stores';
	import CaseRoot from '../../src/lib/components/custom/case/CaseRoot.svelte';
	import CasePage from '../../src/lib/components/custom/case/CasePage.svelte';
	import '../../src/lib/custom/case/case.css';

	const params = new URLSearchParams(location.search);
	const folderId = params.get('casepage') ?? '';
	let section = params.get('s') ?? '';
	let title = '';
	const hrefOf = (slug: string) => `/?casepage=${encodeURIComponent(folderId)}${slug ? `&s=${slug}` : ''}`;
	function follow(ev: MouseEvent) {
		const a = (ev.target as HTMLElement).closest('a');
		const href = a?.getAttribute('href') ?? '';
		if (!href.startsWith('/?casepage=') || ev.defaultPrevented) return;
		ev.preventDefault();
		history.pushState({}, '', href);
		section = new URLSearchParams(href.slice(2)).get('s') ?? '';
	}
	window.addEventListener('popstate', () => (section = new URLSearchParams(location.search).get('s') ?? ''));
	$: document.title = title;
</script>

<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
{#if $config}
	<div class="frame" on:click={follow}>
		<CaseRoot><CasePage {folderId} {section} {hrefOf} bind:title /></CaseRoot>
	</div>
{/if}
<Toaster />

<style>
	.frame {
		height: 100dvh;
	}
	:global(body) {
		margin: 0;
	}
</style>
