<script lang="ts">
	// ai-dvokat: страница дела — /case/<папка> («Обзор») и /case/<папка>/<раздел>. Макет общий для всех разделов дела:
	// страница дела создаётся один раз и живёт, пока открыто это дело, — обзор, его переспрашивание и идущие загрузки
	// не прерываются при переходе между разделами. Прежняя метка раздела (#sec-check) из старых ссылок — на адрес раздела.
	import { onMount } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { WEBUI_NAME } from '$lib/stores';
	import { sectionOfHash } from '$lib/custom/case/casepage';
	import { caseStrings } from '$lib/custom/case/strings';
	import CasePage from '$lib/components/custom/case/CasePage.svelte';

	let title = '';
	let casePage: CasePage | undefined;
	$: folderId = $page.params.folderId ?? '';

	onMount(() => {
		const slug = !$page.params.section ? sectionOfHash($page.url.hash) : null;
		if (slug) void goto(`/case/${encodeURIComponent(folderId)}/${slug}`, { replaceState: true });
	});

	// уход из дела внутри приложения, пока файл передаётся: передача остановилась бы — спросить (продолжить можно позже)
	beforeNavigate((navigation) => {
		const inside =
			navigation.to?.route.id?.startsWith('/case/[folderId]') &&
			navigation.to.params?.folderId === folderId;
		if (inside || navigation.willUnload || !casePage?.uploading()) return;
		if (!window.confirm($caseStrings?.upload_leave_warning ?? '')) navigation.cancel();
	});
</script>

<svelte:head><title>{title ? `${title} / ` : ''}{$WEBUI_NAME}</title></svelte:head>
{#key folderId}
	<CasePage bind:this={casePage} {folderId} section={$page.params.section ?? ''} bind:title />
{/key}
<slot />
