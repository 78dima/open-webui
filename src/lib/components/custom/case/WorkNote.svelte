<script lang="ts">
	// ai-dvokat: строка хода «работа по делу идёт» вверху раздела, чьи данные сейчас пересобираются (требование
	// владельца 23.11). Признак — факт сервиса (поле `work` обзора: задачи очереди по группам и идущие проходы), а не
	// таймер: работы названных групп нет — строки нет. Обработка на паузе или обработчик не отвечает — сказано
	// «ждут», а не «идёт». Раздел сам перечитывается, когда работа закончилась (`workWatcher` в разделе).
	import type { CaseState } from '$lib/custom/case/casestore';
	import {
		isPausedFor,
		waitReasonsText,
		workActive,
		workParts,
		workWaiting
	} from '$lib/custom/case/casepage';
	import { fmt } from '$lib/custom/case/strings';
	import Icon from './Icon.svelte';
	export let state: CaseState;
	export let S: Record<string, any> = {};
	/** Группы работы, от которых зависят данные раздела (`SECTION_WORK`). */
	export let groups: string[] = [];
	/** Ключ строки: «…{parts} — раздел обновится сам». */
	export let key = 'work_note';
	const { data } = state;
	const cap = (s: string) => (s ? s[0].toLocaleUpperCase('ru-RU') + s.slice(1) : s);
	$: on = workActive($data, groups);
	$: waiting = !on && workWaiting($data, groups);
	$: parts = on ? workParts($data?.work, groups, S).join(', ') : '';
	$: paused = isPausedFor($data, groups);
	$: stalled = !!$data?.work?.stalled && !!S.work_note_stalled;
	$: waits = stalled || (paused && !!S.work_note_paused);
	$: waitReason = waiting ? waitReasonsText($data?.work, S, groups) : '';
	$: text = parts
		? fmt(stalled ? S.work_note_stalled : paused && S.work_note_paused ? S.work_note_paused : S[key], {
				parts
			})
		: waiting && waitReason && S.work_note_waiting
			? fmt(S.work_note_waiting, { reason: waitReason })
			: '';
</script>

{#if text}
	<div
		class="note"
		class:i={!waits && !waiting}
		role="status"
		data-testid="case-work-note"
		data-work={waiting ? 'waiting' : waits ? 'waits' : 'runs'}
	>
		{#if !waiting}<Icon name={waits ? 'pause' : 'clock'} klass="l" />{/if}
		<p>{cap(text)}</p>
	</div>
{/if}
