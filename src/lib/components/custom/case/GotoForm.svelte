<script lang="ts">
	// ai-dvokat: «Открыть лист» — та же форма GET на адрес `…/ref` сервиса, что на прежней странице и на странице листа
	// (страница листа остаётся в сервисе, работает и без скрипта). Том, номер и «оборот» — состояние этого компонента:
	// переспрашивание обзора его не трогает; если выбранный том исчез из дела — выбор снимается, введённое остаётся.
	export let action: string;
	export let volumes: string[] = [];
	export let S: Record<string, any> = {};
	/** bar — строка в шапке (компьютер), window — окно на телефоне. */
	export let variant: 'bar' | 'window' = 'bar';

	let volume = '';
	let sheet = '';
	let back = false;
	let picked = false; // том выбран юристом: тогда новые тома дела выбор не меняют
	$: if (volumes.length && (!picked || !volumes.includes(volume))) {
		if (!volumes.includes(volume)) picked = false;
		if (!picked) volume = volumes[0];
	}
	const option = (label: string) => String(S.goto_volume_option ?? '').replace('{label}', label);
</script>

{#if volumes.length}
	<form
		class={variant === 'bar' ? 'goto' : 'col g12 goto-window'}
		method="get"
		{action}
		role="search"
		aria-label={S.goto_title_g}
		data-testid="case-goto"
	>
		{#if variant === 'bar'}<span>{S.goto_title_g}</span>{/if}
		<select
			class="in {variant === 'bar' ? 's' : ''}"
			name="t"
			aria-label={S.goto_volume}
			bind:value={volume}
			on:change={() => (picked = true)}
		>
			{#each volumes as v (v)}<option value={v}>{option(v)}</option>{/each}
		</select>
		<input
			class="in {variant === 'bar' ? 's' : ''} sheet"
			type="text"
			name="l"
			inputmode="numeric"
			maxlength="32"
			autocomplete="off"
			enterkeyhint="go"
			required
			aria-label={S.goto_sheet_label}
			placeholder={S.goto_sheet_hint}
			bind:value={sheet}
		/>
		<label class={variant === 'bar' ? '' : 'chk'}
			><input type="checkbox" name="side" value="back" bind:checked={back} />{variant === 'bar'
				? S.goto_back_g
				: S.goto_back_long}</label
		>
		<button type="submit" class="btn p {variant === 'bar' ? 's' : 'big'}">{S.goto_open}</button>
	</form>
{/if}

<style>
	.goto .sheet {
		width: 76px;
	}
	/* поле в строке шапки: по макету 14,5 px; на телефоне строки нет — там окно с полями в 16 px */
	.goto-window {
		align-items: stretch;
	}
</style>
