<script lang="ts">
	// ai-dvokat: раздел не обновился («Найти», «Обновить», перечитывание после правки или вместе с обзором), а
	// прежние данные на экране остались: об этом сказано словами и есть «Повторить» — иначе юрист примет старую
	// выборку за новую (ревью 20.11, прежняя страница заменяла раздел текстом ошибки).
	import { reasonText } from '$lib/custom/case/sections';
	import { fmt } from '$lib/custom/case/strings';
	import Icon from './Icon.svelte';
	export let S: Record<string, any> = {};
	export let error: unknown = null;
	export let retry: () => void = () => undefined;
</script>

<div class="note row g12 stale" role="alert" data-testid="case-stale">
	<Icon name="al" />
	<span class="grow">{fmt(S.section_stale, { detail: reasonText(S, error) })}</span>
	<button type="button" class="btn s" on:click={retry}>{S.retry}</button>
</div>

<style>
	.stale {
		align-items: center;
	}
</style>
