<script lang="ts">
	// The real upstream message renderer with the fork's wrapper (R4).
	import { setContext } from 'svelte';
	import { writable } from 'svelte/store';
	import ContentRenderer from '../../src/lib/components/chat/Messages/ContentRenderer.svelte';
	import { resultMessage } from './stores';
	setContext('i18n', writable({ t: (key: string) => key, language: 'ru-RU' }));
</script>

{#key $resultMessage}
	<div data-testid="renderer">
		<ContentRenderer
			id="message"
			messageId="message"
			history={{ messages: {}, currentId: null }}
			content={$resultMessage.content}
			output={$resultMessage.output ?? []}
			model={$resultMessage.model}
			sources={$resultMessage.sources}
			done={$resultMessage.done}
			floatingButtons={false}
		/>
	</div>
{/key}
