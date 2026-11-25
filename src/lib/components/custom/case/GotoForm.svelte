<script lang="ts">
	// ai-dvokat: «Открыть лист» — форма GET на адрес `/case/<папка>/ref` (внутри SvelteKit SPA, с fallback для внешних URL).
	import { goto } from '$app/navigation';
	import { isSpaCaseHref } from '$lib/custom/case/sheet';

	export let action: string;
	export let volumes: string[] = [];
	export let S: Record<string, any> = {};
	/** bar — строка в шапке (компьютер), window — окно на телефоне, card — карточка «Открыть другой лист». */
	export let variant: 'bar' | 'window' | 'card' = 'bar';
	export let initialVolume = '';
	export let initialSheet = '';
	export let initialBack = false;
	export let onSubmit: (() => void) | undefined = undefined;

	let volume = initialVolume;
	let sheet = initialSheet;
	let back = initialBack;
	let picked = !!initialVolume; // том выбран юристом (или задан изначально)
	let lastInit = `${initialVolume}\0${initialSheet}\0${initialBack}`;
	$: {
		const nextInit = `${initialVolume}\0${initialSheet}\0${initialBack}`;
		if (nextInit !== lastInit) {
			lastInit = nextInit;
			volume = initialVolume;
			sheet = initialSheet;
			back = initialBack;
			picked = !!initialVolume;
		}
	}
	$: if (volumes.length && (!picked || !volumes.includes(volume))) {
		if (!volumes.includes(volume)) picked = false;
		if (!picked) volume = volumes[0];
	}
	const option = (label: string) => String(S.goto_volume_option ?? '').replace('{label}', label);

	function submit(ev: SubmitEvent) {
		if (!isSpaCaseHref(action)) return;
		ev.preventDefault();
		const q = new URLSearchParams();
		if (volume) q.set('t', volume);
		if (sheet.trim()) q.set('l', sheet.trim());
		if (back) q.set('side', 'back');
		onSubmit?.();
		void goto(`${action}?${q.toString()}`);
	}
</script>

{#if volumes.length}
	<form
		class={variant === 'bar'
			? 'goto'
			: variant === 'card'
				? 'row g12 ae'
				: 'col g12 goto-window'}
		method="get"
		{action}
		role="search"
		aria-label={S.goto_title_g}
		data-testid="case-goto"
		on:submit={submit}
	>
		{#if variant === 'bar'}
			<span>{S.goto_title_g}</span>
			<select
				class="in s"
				name="t"
				aria-label={S.goto_volume}
				bind:value={volume}
				on:change={() => (picked = true)}
			>
				{#each volumes as v (v)}<option value={v}>{option(v)}</option>{/each}
			</select>
			<input
				class="in s sheet"
				type="text"
				name="l"
				maxlength="32"
				autocomplete="off"
				enterkeyhint="go"
				required
				aria-label={S.goto_sheet_label}
				placeholder={S.goto_sheet_hint}
				bind:value={sheet}
			/>
			<label
				><input type="checkbox" name="side" value="back" bind:checked={back} />{S.goto_back_g}</label
			>
			<button type="submit" class="btn p s">{S.goto_open}</button>
		{:else if variant === 'card'}
			<label class="lbl f110"
				>{S.goto_volume}<select
					class="in"
					name="t"
					bind:value={volume}
					on:change={() => (picked = true)}
				>
					{#each volumes as v (v)}<option value={v}>{v}</option>{/each}
				</select></label
			>
			<label class="lbl f110"
				>{S.goto_sheet}<input
					class="in"
					type="text"
					name="l"
					maxlength="32"
					autocomplete="off"
					enterkeyhint="go"
					required
					bind:value={sheet}
				/></label
			>
			<label class="chk h40"
				><input type="checkbox" name="side" value="back" bind:checked={back} />{S.goto_back_long}</label
			>
			<button type="submit" class="btn p">{S.goto_open}</button>
		{:else}
			<select
				class="in"
				name="t"
				aria-label={S.goto_volume}
				bind:value={volume}
				on:change={() => (picked = true)}
			>
				{#each volumes as v (v)}<option value={v}>{option(v)}</option>{/each}
			</select>
			<input
				class="in sheet"
				type="text"
				name="l"
				maxlength="32"
				autocomplete="off"
				enterkeyhint="go"
				required
				aria-label={S.goto_sheet_label}
				placeholder={S.goto_sheet_hint}
				bind:value={sheet}
			/>
			<label class="chk"
				><input type="checkbox" name="side" value="back" bind:checked={back} />{S.goto_back_long}</label
			>
			<button type="submit" class="btn p big">{S.goto_open}</button>
		{/if}
	</form>
{/if}

<style>
	.goto .sheet {
		width: 76px;
	}
	.f110 {
		flex: 1 1 110px;
	}
	.h40 {
		min-height: 40px;
	}
	/* поле в строке шапки: по макету 14,5 px; на телефоне строки нет — там окно с полями в 16 px */
	.goto-window {
		align-items: stretch;
	}
</style>
