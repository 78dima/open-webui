<script lang="ts">
	// ai-dvokat: «История правок» — общая для тома, файла, строки описи и записей карты дела (макет K-dialogs; опись
	// § 0.4). Ручка `GET …/edits?entity=…&id=…`; значения словами готовит сервис. «Откатить» — у последней
	// неоткаченной правки поля, без подтверждения: сообщение «Откачено», окно закрывается, раздел перечитывается.
	import type { CaseState } from '$lib/custom/case/casestore';
	import { when } from '$lib/custom/case/casepage';
	import { editField, editValue } from '$lib/custom/case/mapcore';
	import { casePath, errorText, query, reasonText } from '$lib/custom/case/sections';
	import { fmt } from '$lib/custom/case/strings';
	import { caseToast } from '$lib/custom/case/toast';
	import FormDialog from './FormDialog.svelte';
	import Busy from './Busy.svelte';

	export let open = false;
	export let state: CaseState;
	export let S: Record<string, any> = {};
	export let entity = '';
	export let id: number | string | null = null;
	export let onReverted: () => void = () => undefined;

	type Edit = {
		id: number;
		entity?: string;
		entity_id?: number | string;
		field?: string;
		before?: unknown;
		after?: unknown;
		field_text?: string | null;
		who: string;
		at: string;
		before_text?: string | null;
		after_text?: string | null;
		revert_of?: number | null;
		reverted_by?: number | null;
		can_revert?: boolean;
	};
	const LIMIT = 50; // сервис отдаёт первые 50 правок
	let edits: Edit[] | null = null;
	let error = '';
	let asked = '';
	$: if (open && id != null && asked !== `${entity}:${id}`) void load();
	$: if (!open) asked = '';

	async function load() {
		asked = `${entity}:${id}`;
		edits = null;
		error = '';
		const mine = asked;
		try {
			const d = await state.api.get<{ edits: Edit[] }>(
				casePath(state, `/edits${query({ entity, id })}`)
			);
			if (mine === asked) edits = d?.edits ?? [];
		} catch (e) {
			if (mine === asked) error = reasonText(S, e);
		}
	}
	let reverting: number | null = null; // откат в пути: кнопка занята, второй откат не уходит
	async function revert(e: Edit) {
		if (reverting !== null) return;
		reverting = e.id;
		try {
			await state.api.post(casePath(state, `/edits/${e.id}/revert`));
			caseToast(S.revert_done);
			open = false;
			onReverted();
		} catch (err) {
			caseToast(errorText(S, err), true);
		} finally {
			reverting = null;
		}
	}
	// значения словами готовит сервис (том, файл, опись, лист); у записей карты дела (паспорт, хронология, суммы,
	// сроки) сервис отдаёт сами значения, а названия поля у него нет — слова для них здесь, тем же правилом, что на
	// прежней странице (`sections/mapcore.js`)
	const MAP_ENTITIES = new Set(['passport', 'fact', 'amount', 'deadline']);
	const mapped = (e: Edit) => MAP_ENTITIES.has(e.entity ?? '') && !!e.field && !e.field_text;
	// название поля тома «номер тома» — строка страницы: сервис отдаёт слово прежней страницы («Метка тома»)
	const OWN_FIELD: Record<string, string> = { 'volume:label': 'edit_field_volume_label_g' };
	const fieldOf = (e: Edit) =>
		mapped(e)
			? editField(e.entity!, e.field!, e.entity_id, S)
			: (S[OWN_FIELD[`${e.entity}:${e.field}`]] ?? e.field_text ?? '');
	const line = (e: Edit) =>
		fmt(S.edit_history_row, {
			who: e.who,
			when: when(e.at),
			a: mapped(e) ? editValue(e.entity!, e.field!, e.before, S) : e.before_text || S.value_empty,
			b: mapped(e) ? editValue(e.entity!, e.field!, e.after, S) : e.after_text || S.value_empty
		});
</script>

<FormDialog bind:open title={S.history_title} {S} testid="case-history">
	{#if error}
		<div class="row g12">
			<span class="sm b c-stop grow" role="alert">{fmt(S.section_error, { detail: error })}</span>
			<button type="button" class="btn s" on:click={load}>{S.retry}</button>
		</div>
	{:else if edits === null}
		<p class="mut" role="status">{S.loading}</p>
	{:else if !edits.length}
		<p class="mut" data-testid="case-history-empty">{S.history_empty}</p>
	{:else}
		<div class="col">
			{#each edits as e (e.id)}
				<div class="li t" data-testid="case-history-row">
					<div class="col g4 grow">
						<div class="row g8">
							{#if fieldOf(e)}<span class="b">{fieldOf(e)}</span>{/if}
							{#if e.revert_of}<span class="pill t">{S.history_revert_of}</span>{/if}
							{#if e.reverted_by}<span class="pill t">{S.history_reverted}</span>{/if}
						</div>
						<span class="sm fg2 aw">{line(e)}</span>
					</div>
					{#if e.can_revert}
						<button
							type="button"
							class="btn s"
							disabled={reverting !== null}
							on:click={() => revert(e)}
							data-testid="case-history-revert"
							><Busy on={reverting === e.id} text={S.busy_wait}>{S.revert}</Busy></button
						>
					{/if}
				</div>
			{/each}
		</div>
		{#if edits.length >= LIMIT}<p class="sm mut">{fmt(S.history_first_n, { n: LIMIT })}</p>{/if}
	{/if}
</FormDialog>

<style>
	.li:first-child {
		border-top: 0;
	}
</style>
