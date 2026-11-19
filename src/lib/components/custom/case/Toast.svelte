<script lang="ts">
	// ai-dvokat: всплывающее сообщение страниц «Дел» (вариант «Г»). Показ, очередь и срок — svelte-sonner форка
	// (Toaster стоит в корневом макете), вид — свой: sonner отдаёт содержимое этому компоненту без своих стилей.
	// Сообщение живёт вне страницы, поэтому несёт корневой класс .cg сам (переменные схемы).
	import Icon from './Icon.svelte';
	export let text = '';
	export let error = false;
</script>

<div class="cg cg-toast">
	<div class="toast" class:s={error} role={error ? 'alert' : 'status'} data-testid="case-toast">
		{#if error}<Icon name="al" size={22} />{/if}
		<span>{text}</span>
	</div>
</div>

<style>
	/* место в окне задаёт sonner (внизу по центру); здесь — «таблетка» по макету D-edge */
	.cg-toast {
		display: flex;
		justify-content: center;
		width: 100%;
		pointer-events: none;
	}
	/* «таблетка» шире места, которое sonner отводит сообщению (356 px): растёт от середины, но не шире окна */
	.cg-toast .toast {
		flex: 0 0 auto;
		max-width: calc(100vw - 32px);
		min-height: 52px;
		padding: 10px 20px 10px 14px;
		gap: 12px;
		overflow-wrap: anywhere;
		pointer-events: auto;
	}
	.cg-toast .toast.s {
		box-shadow: 0 12px 30px rgba(165, 42, 92, 0.3);
	}
</style>
