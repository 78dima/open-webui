<script lang="ts">
	// ai-dvokat: меню разделов дела (макеты K-overview и K-menu-phone): группы с подписями, счётчики из ответа обзора,
	// состав — по настройке разделов сервиса и правам (`navGroups`).
	import type { NavGroup } from '$lib/custom/case/casepage';
	export let groups: NavGroup[] = [];
	export let current = '';
	export let S: Record<string, any> = {};
	export let hrefOf: (slug: string) => string;
	export let onPick: () => void = () => {};
</script>

{#each groups as g, n (n)}
	{#if g.rule}<div class="hr"></div>{/if}
	{#if g.cap}<span class="cap">{S[g.cap]}</span>{/if}
	{#each g.items as item (item.slug)}
		<a
			class:on={item.slug === current}
			class:quiet={item.quiet}
			aria-current={item.slug === current ? 'page' : undefined}
			href={hrefOf(item.slug)}
			data-testid="case-nav-{item.slug || 'overview'}"
			on:click={onPick}
			>{S[item.key]}{#if item.count}<span class="n" class:w={item.warn}>{item.count}</span>{/if}</a
		>
	{/each}
{/each}
