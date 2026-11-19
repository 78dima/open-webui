<script lang="ts">
	// ai-dvokat: окно страниц «Дел» (макет K-dialogs: затемнение и карточка .dlg). Поведение — родное окно браузера
	// <dialog> (как на прежней странице сервиса): фокус не уходит за окно, Esc закрывает, фон не прокручивается.
	// Общий Modal форка здесь не годится: его рамка, тень и место заданы классами чата и не переопределяются.
	import { onMount } from 'svelte';
	export let open = false;
	export let title = '';
	export let labelledby = 'cg-dialog-title';

	let dialog: HTMLDialogElement;
	let mounted = false;
	onMount(() => {
		mounted = true;
	});
	$: if (mounted && dialog) {
		if (open && !dialog.open) dialog.showModal();
		else if (!open && dialog.open) dialog.close();
	}
	// нажатие на затемнение (сам <dialog>, не его содержимое) закрывает окно
	const backdrop = (ev: MouseEvent) => {
		if (ev.target === dialog) open = false;
	};
</script>

<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-noninteractive-element-interactions -->
<dialog
	bind:this={dialog}
	aria-labelledby={labelledby}
	on:close={() => (open = false)}
	on:click={backdrop}
>
	<div class="dlg">
		{#if title}<h2 id={labelledby}>{title}</h2>{/if}
		<slot />
	</div>
</dialog>

<style>
	dialog {
		width: calc(100% - 24px);
		max-width: 560px;
		max-height: calc(100dvh - 32px);
		margin: auto;
		padding: 0;
		border: 0;
		border-radius: 18px;
		background: transparent;
		color: inherit;
		overflow: visible;
	}
	dialog::backdrop {
		background: rgba(20, 20, 30, 0.45);
	}
	dialog .dlg {
		max-width: none;
		max-height: calc(100dvh - 32px);
		overflow-y: auto;
	}
</style>
