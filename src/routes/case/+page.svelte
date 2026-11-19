<script lang="ts">
	// ai-dvokat: «Мои дела» — адрес /case. «Открыть дело» и переход после «Завести дело» ведут на страницу дела
	// форка (/case/<папка>).
	import { goto } from '$app/navigation';
	import { WEBUI_NAME } from '$lib/stores';
	import { caseStrings } from '$lib/custom/case/strings';
	import MyCases from '$lib/components/custom/case/MyCases.svelte';

	const caseHref = (folderId: string) => `/case/${encodeURIComponent(folderId)}`;
</script>

<svelte:head><title>{$caseStrings?.my_cases_title ?? ''} / {$WEBUI_NAME}</title></svelte:head>
<MyCases {caseHref} onCreated={(folderId) => goto(caseHref(folderId))} />
