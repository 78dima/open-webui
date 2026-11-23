<script lang="ts">
	import { setContext } from 'svelte';
	import { writable } from 'svelte/store';
	import ToolCallDisplay from '../../src/lib/components/common/ToolCallDisplay.svelte';
	import ConsecutiveDetailsGroup from '../../src/lib/components/chat/Messages/Markdown/ConsecutiveDetailsGroup.svelte';
	// Minimal i18n with upstream interpolation; translations are not under test.
	setContext('i18n', writable({ t: (key: string, values: Record<string, unknown> = {}) =>
		key.replace(/\{\{(\w+)\}\}/g, (_, name) => String(values[name] ?? '')) }));
	const result = JSON.stringify({ items: [{ title: 'Синтетический результат', nd: 1 }] });
	const call = (id: string, name: string, extra: Record<string, string> = {}) => ({
		type: 'tool_calls', id, name, arguments: JSON.stringify({ query: 'синтетический запрос' }),
		result, done: 'true', ...extra
	});
	const grouped = [
		call('g1', 'legal-tools_kplus_search'),
		call('g2', 'legal-tools_kplus_search'),
		call('g3', 'legal-tools_kplus_outline')
	];
	let resolved = '';
</script>

<section data-testid="single">
	<ToolCallDisplay id="done" attributes={call('c1', 'legal-tools_kplus_read')} />
	<ToolCallDisplay id="active" attributes={call('c2', 'legal-tools_kplus_search', { done: 'false', status: 'completed', result: '' })} />
	<ToolCallDisplay id="failed" attributes={call('c3', 'legal-tools_kplus_outline', { status: 'failed' })} />
	<ToolCallDisplay id="unknown" attributes={call('c4', 'other-server_secret_tool')} />
	<ToolCallDisplay id="pending" attributes={call('c5', 'legal-tools_make_xlsx', { done: 'false', status: 'pending', result: '' })}
		resolvable={true} onResolve={(approved) => (resolved = String(approved))} />
	<ToolCallDisplay id="embed" allowEmbeds={true}
		attributes={call('c6', 'legal-tools_kplus_read', { embeds: JSON.stringify(['<p>embed</p>']) })} />
	<ToolCallDisplay id="files" attributes={call('c7', 'legal-tools_make_xlsx', {
		files: JSON.stringify(['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='])
	})} />
	<output data-testid="resolved">{resolved}</output>
</section>
<section data-testid="group">
	<ConsecutiveDetailsGroup id="group" tokens={grouped.map((attributes) => ({ attributes, text: result }))}>
		<div slot="content">
			{#each grouped as attributes, i}<ToolCallDisplay id={`grouped-${i}`} {attributes} grouped={true} />{/each}
		</div>
	</ConsecutiveDetailsGroup>
</section>
<!-- ai-dvokat: вызовы выполнены, сообщение ещё не закончено (модель работает над ответом) -->
<section data-testid="group-preparing">
	<ConsecutiveDetailsGroup
		id="group-preparing"
		messageDone={false}
		tokens={[call('p1', 'legal-tools_case_read'), call('p2', 'view_skill'), call('p3', 'legal-tools_draft_check')].map((attributes) => ({ attributes, text: result }))}
	>
		<div slot="content"></div>
	</ConsecutiveDetailsGroup>
</section>
