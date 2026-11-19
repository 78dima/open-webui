<script lang="ts">
	// ai-dvokat: страницы «Дел» (вариант «Г») — вне оболочки чата: маршрут вне группы (app), свой макет и стили.
	// Корневой макет приложения уже получил конфигурацию и пользователя; без входа — на страницу входа с возвратом.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { user } from '$lib/stores';
	import CaseRoot from '$lib/components/custom/case/CaseRoot.svelte';
	import '$lib/custom/case/case.css';

	onMount(() => {
		if (!$user) void goto(`/auth?redirect=${encodeURIComponent($page.url.pathname + $page.url.search)}`);
	});
</script>

{#if $user}
	<CaseRoot><slot /></CaseRoot>
{/if}
