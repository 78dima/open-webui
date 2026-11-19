<script lang="ts">
	// ai-dvokat: «Мои дела» — адрес /case. Страница дела (/case/<папка>) пока прежняя, в сервисе: туда ведут
	// «Открыть дело» и «Завести дело».
	import { WEBUI_NAME } from '$lib/stores';
	import { caseStrings } from '$lib/custom/case/strings';
	import MyCases from '$lib/components/custom/case/MyCases.svelte';
</script>

<svelte:head><title>{$caseStrings?.my_cases_title ?? ''} / {$WEBUI_NAME}</title></svelte:head>
<MyCases />
