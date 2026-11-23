<script lang="ts">
	// ai-dvokat: строка хода «работа по делу идёт» вверху раздела, чьи данные сейчас пересобираются (требование
	// владельца 23.11). Признак — факт сервиса (поле `work` обзора: задачи очереди по группам и идущие проходы), а не
	// таймер: работы названных групп нет — строки нет. Обработка на паузе или обработчик не отвечает — сказано
	// «ждут», а не «идёт». Раздел сам перечитывается, когда работа закончилась (`workWatcher` в разделе).
	import type { CaseState } from '$lib/custom/case/casestore';
	import { workNote } from '$lib/custom/case/casepage';
	import Icon from './Icon.svelte';
	export let state: CaseState;
	export let S: Record<string, any> = {};
	/** Группы работы, от которых зависят данные раздела (`SECTION_WORK`). */
	export let groups: string[] = [];
	/** Ключ строки: «…{parts} — раздел обновится сам». */
	export let key = 'work_note';
	const { data } = state;
	const cap = (s: string) => (s ? s[0].toLocaleUpperCase('ru-RU') + s.slice(1) : s);
	// правило строки — `workNote` (группы на паузе названы отдельно, Н-6; вся работа раздела на паузе — «ждут»)
	$: note = workNote($data, groups, S, key);
</script>

{#if note}
	<div
		class="note"
		class:i={note.kind === 'runs'}
		role="status"
		data-testid="case-work-note"
		data-work={note.kind}
	>
		{#if note.kind !== 'waiting'}<Icon name={note.kind === 'waits' ? 'pause' : 'clock'} klass="l" />{/if}
		<p>{cap(note.text)}</p>
	</div>
{/if}
