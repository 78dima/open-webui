<script lang="ts">
	// B4 entry in the folder menu; shown only with the strict `case` flag.
	import { goto } from '$app/navigation';
	import { config } from '$lib/stores';
	import ru from '$lib/custom/locales/ru-RU.json';
	import { isJobId } from '$lib/custom/jobs';
	export let folderId: string | null = null;
</script>

{#if $config?.custom_ui?.case === true && isJobId(folderId)}
	<button
		data-testid="custom-case-menu"
		class="flex h-[1.6875rem] w-full items-center gap-2 rounded-xl px-2 text-[0.8125rem] select-none cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-900"
		on:click={() => goto(`/custom/case/${folderId}`)}
	>
		<div class="flex items-center">{ru.case.menu}</div>
	</button>
{/if}
