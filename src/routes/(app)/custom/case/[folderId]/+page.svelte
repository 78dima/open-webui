<script lang="ts">
	import { page } from '$app/stores';
	import { WEBUI_NAME } from '$lib/stores';
	import CasePanel from '$lib/components/custom/CasePanel.svelte';
	import ru from '$lib/custom/locales/ru-RU.json';
</script>

<svelte:head><title>{ru.case.title} / {$WEBUI_NAME}</title></svelte:head>
<CasePanel folderId={$page.params.folderId ?? ''} />
