<script lang="ts">
	// ai-dvokat: один вид «кнопка занята» на всех страницах дела (образец — «Заводим…»): пока действие идёт, в кнопке
	// значок часов и подпись с многоточием; сама кнопка в это время не нажимается (`disabled` ставит зовущий). Признак
	// — идущий запрос этой кнопки, не таймер. Без строки `text` (прежний сервис) — прежняя подпись кнопки.
	import Icon from './Icon.svelte';
	export let on = false;
	/** Подпись, пока действие идёт: «Сохраняется…», «Готовлю файл…». */
	export let text: string | undefined = undefined;
</script>

{#if on && text}<Icon name="clock" /><span data-busy="1">{text}</span>{:else}<slot />{/if}
