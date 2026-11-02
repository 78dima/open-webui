<script lang="ts">
	import { config } from '$lib/stores';
	import ru from '$lib/custom/locales/ru-RU.json';
	export let folderId: string;
</script>

{#if $config?.custom_ui?.case === true && folderId}
	<section data-testid="custom-case" aria-label={ru.pending.caseTitle} class="p-4">
		<h1 class="text-lg font-medium">{ru.pending.caseTitle}</h1>
		<p role="status">{ru.pending.caseUnavailable}</p>
		<p>{ru.pending.noRequest}</p>
	</section>
{:else}
	<p data-testid="custom-case-disabled" class="p-4">{ru.pending.disabled}</p>
{/if}
