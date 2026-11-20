<script lang="ts">
	// ai-dvokat: «Разделы из чата» в меню «Моих дел» — дерево папок чата, внутри которых есть другие папки.
	// Нажатие на раздел оставляет в списках то, что лежит внутри него; повторное — снимает отбор. Стрелка
	// сворачивает и разворачивает вложенные разделы (в макете это одна строка: название слева, стрелка справа).
	import type { Section } from '$lib/custom/case/mycases';
	import Icon from './Icon.svelte';

	export let sections: Section[] = [];
	export let selected: string | null = null;
	export let collapsed: Set<string> = new Set();
	export let labels: { expand: string; collapse: string } = { expand: '', collapse: '' };
	export let onSelect: (id: string) => void = () => {};
	export let onToggle: (id: string) => void = () => {};
</script>

{#each sections as s (s.id)}
	<div class="sec" class:on={selected === s.id}>
		<button
			type="button"
			class="name"
			aria-pressed={selected === s.id}
			data-testid="case-section"
			on:click={() => onSelect(s.id)}
		>
			{#if s.depth === 0}<Icon name="folder" size={20} stroke={1.6} />{/if}
			<span>{s.title}</span>
		</button>
		{#if s.children.length}
			<button
				type="button"
				class="tog"
				aria-expanded={!collapsed.has(s.id)}
				aria-label={collapsed.has(s.id) ? labels.expand : labels.collapse}
				on:click={() => onToggle(s.id)}
			>
				<Icon name={collapsed.has(s.id) ? 'd' : 'u'} />
			</button>
		{/if}
	</div>
	{#if s.children.length && !collapsed.has(s.id)}
		<div class="kids" class:deep={s.depth >= 2}>
			<svelte:self sections={s.children} {selected} {collapsed} {labels} {onSelect} {onToggle} />
		</div>
	{/if}
{/each}

<style>
	.sec {
		display: flex;
		align-items: center;
		min-height: 44px;
		border-radius: 999px;
		color: var(--fg2);
	}
	.sec.on {
		background: var(--nav-on);
		box-shadow: var(--pop);
		color: var(--nav-on-fg);
	}
	.name,
	.tog {
		border: none;
		background: transparent;
		color: inherit;
		font-size: 14.5px;
		line-height: 1.3;
		cursor: pointer;
	}
	.name {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 44px;
		padding: 6px 14px;
		border-radius: 999px;
		text-align: left;
	}
	.name span {
		min-width: 0;
		overflow-wrap: break-word;
	}
	.sec.on .name {
		font-weight: 500;
	}
	.tog {
		flex: 0 0 44px;
		height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
	}
	.kids {
		display: flex;
		flex-direction: column;
		margin-left: 23px;
		padding-left: 12px;
		border-left: 1px solid var(--line);
	}
	/* глубже третьего уровня отступ не растёт: меню узкое, а вложенность папок чата не ограничена */
	.kids.deep {
		margin-left: 6px;
		padding-left: 8px;
	}
</style>
