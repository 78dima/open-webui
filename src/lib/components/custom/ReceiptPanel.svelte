<script lang="ts">
	import { config } from '$lib/stores';
	import ru from '$lib/custom/locales/ru-RU.json';
	export let receiptId: string | null = null;
	$: enabled = $config?.custom_ui?.receipt_panel === true;
	$: if (!enabled) receiptId = null;
</script>

{#if enabled && receiptId}
	<aside
		data-testid="custom-receipt-panel"
		aria-label={ru.pending.receiptTitle}
		class="border rounded-lg p-3 my-3 text-sm"
	>
		<div class="flex items-center justify-between gap-3">
			<h2 class="font-medium">{ru.pending.receiptTitle}</h2>
			<button type="button" on:click={() => (receiptId = null)} aria-label={ru.pending.close}
				>{ru.pending.close}</button
			>
		</div>
		<p role="status">{ru.pending.receiptUnavailable}</p>
		<p>{ru.pending.noRequest}</p>
	</aside>
{/if}
