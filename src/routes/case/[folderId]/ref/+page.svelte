<script lang="ts">
	// ai-dvokat: маршрут `/case/[folderId]/ref` — разрешение ссылки «том / лист» в SvelteKit.
	import { page } from '$app/stores';
	import { WEBUI_NAME } from '$lib/stores';
	import RefResolve from '$lib/components/custom/case/RefResolve.svelte';

	let title = '';
	$: folderId = $page.params.folderId ?? '';
	$: search = $page.url.search;
</script>

<svelte:head><title>{title ? `${title} / ` : ''}{$WEBUI_NAME}</title></svelte:head>
<RefResolve {folderId} {search} bind:title />
