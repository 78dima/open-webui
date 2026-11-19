<script lang="ts">
	// Стенд страниц «Дел»: настоящие компоненты и стили, подменены только хранилища приложения (stores.ts);
	// ручки сервиса и Open WebUI подменяет проверка (page.route).
	import { Toaster } from 'svelte-sonner';
	import { config } from './stores';
	import CaseRoot from '../../src/lib/components/custom/case/CaseRoot.svelte';
	import MyCases from '../../src/lib/components/custom/case/MyCases.svelte';
	import '../../src/lib/custom/case/case.css';
</script>

{#if $config}
	<div class="frame">
		<CaseRoot><MyCases /></CaseRoot>
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
