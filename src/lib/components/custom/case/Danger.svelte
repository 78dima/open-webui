<script lang="ts">
	// ai-dvokat: «Удаление дела» (макет K-danger; опись § 2.15) — только владельцу папки: своё окно подтверждения
	// вместо окна браузера; после удаления — сообщение и переход на «Мои дела». Ручка `DELETE …/cases/<папка>?confirm=`.
	import type { CaseState } from '$lib/custom/case/casestore';
	import { casePath } from '$lib/custom/case/sections';
	import { fmt } from '$lib/custom/case/strings';
	import { caseToast } from '$lib/custom/case/toast';
	import FormDialog from './FormDialog.svelte';

	export let state: CaseState;
	export let S: Record<string, any> = {};
	export let casesHref = '/case';
	export let caseName = '';

	const { boot } = state;
	let open = false;
	let away: HTMLAnchorElement;
	async function remove() {
		await state.api.request(
			'DELETE',
			casePath(state, `?confirm=${encodeURIComponent($boot?.case_id ?? '')}`)
		);
		state.stop(); // дела больше нет: обзор не переспрашивать
		caseToast(S.delete_case_done);
		away.click();
	}
</script>

<a bind:this={away} href={casesHref} hidden aria-hidden="true" tabindex="-1">{S.back_to_cases}</a>

<section class="card g16 box" data-testid="case-danger">
	<p class="md lead">{S.delete_case_confirm_g} {S.delete_case_owner_note}</p>
	<button type="button" class="btn big d" on:click={() => (open = true)}>{S.delete_case}</button>
</section>

<FormDialog
	bind:open
	title={fmt(S.delete_case_title, { title: caseName || S.case_no_title })}
	{S}
	submit={remove}
	submitText={S.delete_case}
	danger
	testid="case-danger-dialog"
>
	<p class="md fg2">{S.delete_case_confirm_g}</p>
</FormDialog>

<style>
	.lead {
		max-width: 620px;
	}

	.box {
		align-items: flex-start;
	}
</style>
