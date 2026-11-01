<script lang="ts">
	import { config } from '$lib/stores';
	import ru from '$lib/custom/locales/ru-RU.json';
</script>

{#if $config?.custom_ui?.hello === true}
	<p data-testid="custom-hello" class="custom-hello text-custom-ink font-custom mb-4">
		{ru.hello}
	</p>
{/if}
