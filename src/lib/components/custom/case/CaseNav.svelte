<script lang="ts">
	// ai-dvokat: меню разделов дела (макеты K-overview и K-menu-phone): группы с подписями, счётчики из ответа обзора,
	// состав — по настройке разделов сервиса и правам (`navGroups`).
	import type { NavGroup } from '$lib/custom/case/casepage';
	import Icon from './Icon.svelte';
	export let groups: NavGroup[] = [];
	export let current = '';
	export let S: Record<string, any> = {};
	export let hrefOf: (slug: string) => string;
	export let onPick: () => void = () => {};
	// работа раздела стоит — подпись значка паузы теми же словами, что отметка дела в «Моих делах»
	const HELD: Record<string, string> = { paused: 'my_cases_paused', stalled: 'my_cases_stalled' };
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
			>{S[item.key]}{#if item.work && item.held && S[HELD[item.held]]}<span
					class="navwork"
					title={S[HELD[item.held]]}
					data-testid="case-nav-work"
					data-held={item.held}
					><Icon name="pause" size={14} /><span class="sr">{S[HELD[item.held]]}</span></span
				>{:else if item.work && S.work_nav_title}<span
					class="navwork"
					title={S.work_nav_title}
					data-testid="case-nav-work"
					><Icon name="clock" size={14} /><span class="sr">{S.work_nav_title}</span></span
				>{/if}{#if item.count}<span class="n" class:w={item.warn}>{item.count}</span>{/if}</a
		>
	{/each}
{/each}

<style>
	/* признак «данные раздела обновляются» у пункта меню — тот же значок часов, что у тома «в очереди» */
	.navwork {
		display: inline-flex;
		align-items: center;
		color: var(--info);
	}

	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
