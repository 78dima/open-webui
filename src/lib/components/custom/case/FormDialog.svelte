<script lang="ts">
	// ai-dvokat: общая форма в своём окне страниц «Дел» (макет K-dialogs; опись § 0.3): заголовок, поля, строка ошибки
	// под полями («Не получилось: …»), слева внизу — дополнительное (например «История»), справа «Отмена» и главная
	// кнопка. Закрывается «Отменой», Esc, нажатием на затемнение и после удачного сохранения; пока запрос идёт, главная
	// кнопка не нажимается. Без `submit` — только чтение (кнопка «Закрыть»).
	import { errorText } from '$lib/custom/case/sections';
	import Dialog from './Dialog.svelte';

	export let open = false;
	export let title = '';
	export let S: Record<string, any> = {};
	/** Действие главной кнопки; вернуть `true` — окно остаётся открытым. Отказ показывается строкой ошибки. */
	export let submit: (() => Promise<unknown> | unknown) | null = null;
	export let submitText = '';
	/** Главная кнопка красная — для действий, которые нельзя отменить. */
	export let danger = false;
	export let testid = 'case-dialog';

	let error = '';
	let busy = false;
	let wasOpen = false;
	$: if (open !== wasOpen) {
		wasOpen = open;
		error = '';
		busy = false;
	}
	async function onSubmit() {
		if (!submit || busy) return;
		busy = true;
		error = '';
		try {
			const keep = await submit();
			if (keep !== true) open = false;
		} catch (e) {
			error = errorText(S, e);
		} finally {
			busy = false;
		}
	}
</script>

<Dialog bind:open {title} labelledby="{testid}-title">
	{#if open}
		<form class="col g14" on:submit|preventDefault={onSubmit} data-testid={testid} novalidate>
			<slot />
			{#if error}<span class="sm b c-stop" role="alert" data-testid="case-dialog-error"
					>{error}</span
				>{/if}
			<div class="row sp g8">
				<div class="row g8"><slot name="aside" /></div>
				<div class="row g8">
					<button type="button" class="btn" on:click={() => (open = false)}
						>{submit ? S.cancel : S.close}</button
					>
					{#if submit}
						<button type="submit" class="btn {danger ? 'dp' : 'p'}" disabled={busy}
							>{submitText || S.save}</button
						>
					{/if}
				</div>
			</div>
		</form>
	{/if}
</Dialog>

<style>
	.g14 {
		gap: 14px;
	}
</style>
