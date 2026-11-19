<script lang="ts">
	// ai-dvokat: окно страниц «Дел» (макет K-dialogs: затемнение и карточка .dlg). Поведение — родное окно браузера
	// <dialog> (как на прежней странице сервиса): фокус не уходит за окно, Esc закрывает, фон не прокручивается.
	// Общий Modal форка здесь не годится: его рамка, тень и место заданы классами чата и не переопределяются.
	import { onMount, tick } from 'svelte';
	export let open = false;
	export let title = '';
	export let labelledby = 'cg-dialog-title';

	let dialog: HTMLDialogElement;
	let mounted = false;
	onMount(() => {
		mounted = true;
	});
	$: if (mounted && dialog) {
		if (open && !dialog.open) {
			dialog.showModal();
			void focusFirst();
		} else if (!open && dialog.open) dialog.close();
	}
	// фокус — в первое поле окна; полей нет — на само окно (не на кнопку: Enter не должен ничего нажимать сам).
	// После закрытия браузер возвращает фокус туда, откуда окно открыли.
	async function focusFirst() {
		await tick();
		if (!dialog?.open) return;
		const field = dialog.querySelector<HTMLElement>(
			'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]), select, textarea'
		);
		(field ?? dialog).focus();
	}
	// Нажатие на затемнение окно НЕ закрывает (как на прежней странице): закрывают «Отмена», Esc и удачное
	// сохранение. Иначе введённое терялось от промаха и от протяжки мыши из поля за край окна (ревью 20.11).
</script>

<dialog
	bind:this={dialog}
	tabindex="-1"
	aria-labelledby={labelledby}
	on:close={() => (open = false)}
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
	dialog:focus {
		outline: none;
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
