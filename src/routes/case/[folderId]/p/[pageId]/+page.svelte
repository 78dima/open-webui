<script lang="ts">
	// ai-dvokat: маршрут `/case/[folderId]/p/[pageId]` — просмотрщик листа дела в SvelteKit.
	import { page } from '$app/stores';
	import { WEBUI_NAME } from '$lib/stores';
	import SheetView from '$lib/components/custom/case/SheetView.svelte';

	let title = '';
	$: folderId = $page.params.folderId ?? '';
	$: pageId = $page.params.pageId ?? '';
	$: search = $page.url.search;
</script>

<svelte:head><title>{title ? `${title} / ` : ''}{$WEBUI_NAME}</title></svelte:head>
<SheetView {folderId} {pageId} {search} bind:title />
