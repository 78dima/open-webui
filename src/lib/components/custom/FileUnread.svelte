<script lang="ts">
	// ai-dvokat: постоянный знак у вложения чата, из которого не извлечён текст (разбор файла на сервере завершился
	// ошибкой: битый PDF, сбой распознавания). Штатный интерфейс показывает ошибку только всплывающим сообщением на
	// несколько секунд; вложение после этого выглядело как обычное (пакет 23.11, Д-6). Причина — в подсказке.
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import ru from '$lib/custom/locales/ru-RU.json';

	export let error: unknown = '';
	$: reason = typeof error === 'string' ? error : '';
</script>

{#if error}
	<Tooltip content={ru.file_unread.reason.replace('{error}', reason)} placement="top">
		<span
			class="shrink-0 rounded-md bg-red-50 px-1.5 text-[0.6875rem] leading-5 font-medium text-red-700 dark:bg-red-950 dark:text-red-300"
			data-testid="file-item-error"
			role="status">{ru.file_unread.mark}</span
		>
	</Tooltip>
{/if}
