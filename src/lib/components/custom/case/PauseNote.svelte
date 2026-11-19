<script lang="ts">
	// ai-dvokat: пометка «обработка на паузе» с причиной — теми же строками, что на «Обзоре» (`paused_*`), в разделах,
	// где юрист ждёт обработки: «Загрузить материалы», «Тома», «Таблицы и проходы». На прежней странице сводка с
	// причиной паузы стояла над всеми разделами; на новой её видели только на «Обзоре» (ревью 20.11).
	import type { CaseState } from '$lib/custom/case/casestore';
	import { pauseOf, when } from '$lib/custom/case/casepage';
	import { fmt } from '$lib/custom/case/strings';
	import Icon from './Icon.svelte';
	export let state: CaseState;
	export let S: Record<string, any> = {};
	const { data } = state;
	const cap = (s: string) => (s ? s[0].toLocaleUpperCase('ru-RU') + s.slice(1) : s);
	$: paused = pauseOf($data);
</script>

{#if paused}
	<div class="note" class:s={!paused.self} data-testid="case-paused-note">
		<Icon name={paused.self ? 'pause' : 'al'} klass="l" />
		<p>{cap(fmt(S[paused.key], { time: when(paused.since) }))}</p>
	</div>
{/if}
