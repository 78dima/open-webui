<script lang="ts">
	// The real upstream answer with its copy and insert-to-note buttons (R4).
	import { setContext } from 'svelte';
	import { writable } from 'svelte/store';
	import ResponseMessage from '../../src/lib/components/chat/Messages/ResponseMessage.svelte';
	import { resultMessage, settings } from './stores';
	setContext('i18n', writable({ t: (key: string) => key, language: 'ru-RU' }));
	settings.set({});
	let inserted: string | null = null;
	const noop = () => {};
	$: message = { id: 'answer', parentId: null, childrenIds: [], role: 'assistant', timestamp: 1, ...$resultMessage, model: $resultMessage.model?.id };
	$: history = { messages: { answer: message }, currentId: 'answer' };
</script>

{#key $resultMessage}
	<ResponseMessage
		{history}
		messageId="answer"
		siblings={['answer']}
		showPreviousMessage={noop}
		showNextMessage={noop}
		updateChat={noop}
		editMessage={noop}
		saveMessage={noop}
		rateMessage={noop}
		actionMessage={noop}
		deleteMessage={noop}
		submitMessage={noop}
		continueResponse={noop}
		regenerateResponse={noop}
		addMessages={noop}
		onInsertToNote={(content) => (inserted = content)}
	/>
{/key}
<pre data-testid="inserted">{inserted ?? ''}</pre>
