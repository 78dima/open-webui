<script lang="ts">
	// ai-dvokat: карточка состояния страницы «Дел» — «пусто» и «ошибка» (макеты D-empty, D-error и телефонные).
	// Одна и та же для состояний, которых в макетах нет: значок в круге, заголовок, пояснение, действие в слоте.
	import Icon, { type IconName } from './Icon.svelte';
	export let icon: IconName = 'folder';
	export let tone: 'plain' | 'stop' = 'plain';
	export let title = '';
	export let text = '';
	export let testid = 'case-state';
</script>

<section class="state" class:stop={tone === 'stop'} data-testid={testid}>
	<span class="mark" aria-hidden="true"><Icon name={icon} /></span>
	<h2>{title}</h2>
	{#if text}<p>{text}</p>{/if}
	<slot />
</section>

<style>
	.state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 14px;
		padding: 56px 32px;
		border-radius: 14px;
		background: var(--card);
		box-shadow: var(--shadow);
		text-align: center;
	}
	.mark {
		width: 64px;
		height: 64px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		background: linear-gradient(120deg, var(--t1) 0%, var(--t3) 100%);
		color: var(--fg);
	}
	.mark :global(.ic) {
		width: 28px;
		height: 28px;
		stroke-width: 1.6;
	}
	.stop .mark {
		background: var(--stop-bg);
		color: var(--stop);
	}
	.stop .mark :global(.ic) {
		stroke-width: 1.7;
	}
	.state h2 {
		font-size: 22px;
		line-height: 1.3;
		font-weight: 400;
		overflow-wrap: break-word;
	}
	.state p {
		max-width: 460px;
		font-size: 15px;
		color: var(--muted2);
		overflow-wrap: break-word;
	}
	.state :global(.act) {
		margin-top: 6px;
	}
	@media (max-width: 720px) {
		.state {
			gap: 12px;
			margin-top: 8px;
			padding: 36px 20px;
			border-radius: 16px;
		}
		.mark {
			width: 60px;
			height: 60px;
		}
		.mark :global(.ic) {
			width: 26px;
			height: 26px;
		}
		.state h2 {
			font-size: 21px;
		}
		.state p {
			max-width: none;
		}
		.state :global(.act) {
			align-self: stretch;
			margin-top: 8px;
		}
	}
</style>
