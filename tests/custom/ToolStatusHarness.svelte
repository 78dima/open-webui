<script lang="ts">
	import { setContext } from 'svelte';
	import { writable } from 'svelte/store';
	import ToolCallDisplay from '../../src/lib/components/common/ToolCallDisplay.svelte';
	import Collapsible from '../../src/lib/components/common/Collapsible.svelte';
	import ConsecutiveDetailsGroup from '../../src/lib/components/chat/Messages/Markdown/ConsecutiveDetailsGroup.svelte';
	import StructuredOutputRenderer from '../../src/lib/components/chat/Messages/StructuredOutputRenderer.svelte';
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
	// ai-dvokat: структурный путь (StructuredOutputRenderer, Ф-1) — две группы вызовов в незаконченном сообщении
	const fc = (id: string, name: string) => [
		{ type: 'function_call', id, call_id: id, name, arguments: '{"query":"x"}' },
		{ type: 'function_call_output', call_id: id, output: [{ type: 'output_text', text: result }], status: 'completed' }
	];
	const structuredTwoGroups = [
		...fc('s1', 'legal-tools_case_search'),
		...fc('s2', 'legal-tools_case_read'),
		{ type: 'message', id: 'm1', role: 'assistant', content: [{ type: 'output_text', text: 'Промежуточный текст.' }] },
		...fc('s3', 'legal-tools_case_read'),
		...fc('s4', 'legal-tools_draft_check')
	];
	const structuredWithTailText = [
		...structuredTwoGroups,
		{ type: 'message', id: 'm2', role: 'assistant', content: [{ type: 'output_text', text: 'Итоговый ответ уже пишется.' }] }
	];
	// ai-dvokat: одиночный вызов (Н-2) — первый ход модели почти всегда один вызов; без текста после него и с текстом
	const structuredSingle = [...fc('o1', 'legal-tools_case_overview')];
	const structuredSingleTail = [
		...structuredSingle,
		{ type: 'message', id: 'm3', role: 'assistant', content: [{ type: 'output_text', text: 'Ответ пишется.' }] }
	];
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
<!-- ai-dvokat: две группы вызовов в незаконченном сообщении — признак хода только у последней (Р-6) -->
<section data-testid="group-preparing-earlier">
	<ConsecutiveDetailsGroup
		id="group-preparing-earlier"
		messageDone={false}
		isLast={false}
		tokens={[call('e1', 'legal-tools_case_search'), call('e2', 'legal-tools_case_read')].map((attributes) => ({ attributes, text: result }))}
	>
		<div slot="content"></div>
	</ConsecutiveDetailsGroup>
</section>
<!-- ai-dvokat: вызовы выполнены, сообщение ещё не закончено (модель работает над ответом) -->
<section data-testid="group-preparing">
	<ConsecutiveDetailsGroup
		id="group-preparing"
		messageDone={false}
		isLast={true}
		tokens={[call('p1', 'legal-tools_case_read'), call('p2', 'view_skill'), call('p3', 'legal-tools_draft_check')].map((attributes) => ({ attributes, text: result }))}
	>
		<div slot="content"></div>
	</ConsecutiveDetailsGroup>
</section>
<!-- ai-dvokat: структурный путь (Ф-1): две группы вызовов без текста после второй, и с текстом после второй -->
<section data-testid="structured-two-groups">
	<StructuredOutputRenderer id="so-two" output={structuredTwoGroups} done={false} renderMarkdown={false} />
</section>
<section data-testid="structured-with-tail">
	<StructuredOutputRenderer id="so-tail" output={structuredWithTailText} done={false} renderMarkdown={false} />
</section>
<!-- ai-dvokat: одиночный вызов (Н-2): последний и сообщение не закончено — признак хода; с текстом после — галка -->
<section data-testid="single-preparing">
	<ToolCallDisplay id="single-preparing" attributes={call('sp1', 'legal-tools_case_overview')} isLast={true} messageDone={false} />
</section>
<section data-testid="single-earlier">
	<ToolCallDisplay id="single-earlier" attributes={call('se1', 'legal-tools_case_overview')} isLast={false} messageDone={false} />
</section>
<section data-testid="structured-single">
	<StructuredOutputRenderer id="so-single" output={structuredSingle} done={false} renderMarkdown={false} />
</section>
<section data-testid="structured-single-tail">
	<StructuredOutputRenderer id="so-single-tail" output={structuredSingleTail} done={false} renderMarkdown={false} />
</section>
<section data-testid="reasoning-active">
	<Collapsible id="reasoning-active" title="Thinking..." attributes={{ type: 'reasoning', done: 'false' }} messageDone={false}>
		<div slot="content">secret thought</div>
	</Collapsible>
</section>
<section data-testid="reasoning-done">
	<Collapsible id="reasoning-done" title="Thought for 5 seconds" attributes={{ type: 'reasoning', duration: '5', done: 'true' }} messageDone={true}>
		<div slot="content">secret thought done</div>
	</Collapsible>
</section>
