<script lang="ts">
	// ai-dvokat: текст цитаты записи с подчёркнутыми местами, где два прочтения листа расходятся (пакет 23.11, Д-9 и
	// Д-10): `marks` — места в показанной части цитаты от сервиса (`quote_marks`: начало, конец, оба прочтения). В
	// подсказке — оба прочтения. Мест нет (или прежний сервис) — цитата как была. Текст — только текстом.
	import { fmt } from '$lib/custom/case/strings';

	export let quote = '';
	export let marks: { start: number; end: number; a: string; b: string }[] | undefined = undefined;
	export let S: Record<string, any> = {};

	type Part = { text: string; mark?: { a: string; b: string } };
	function split(text: string, list: typeof marks): Part[] {
		const out: Part[] = [];
		let pos = 0;
		for (const m of [...(list ?? [])].sort((x, y) => x.start - y.start)) {
			if (m.start < pos || m.end > text.length || m.end <= m.start) continue; // вне текста или внахлёст — пропуск
			if (m.start > pos) out.push({ text: text.slice(pos, m.start) });
			out.push({ text: text.slice(m.start, m.end), mark: { a: m.a, b: m.b } });
			pos = m.end;
		}
		if (pos < text.length) out.push({ text: text.slice(pos) });
		return out;
	}
	$: parts = split(quote ?? '', marks);
</script>

{#each parts as p}{#if p.mark}<mark
			class="dz"
			data-testid="case-quote-mark"
			title={S.map_quote_mark ? fmt(S.map_quote_mark, p.mark) : `${p.mark.a} / ${p.mark.b}`}>{p.text}</mark
		>{:else}{p.text}{/if}{/each}

<style>
	/* место расхождения двух прочтений — пунктиром, как исправленное место на странице листа, цветом предупреждения */
	mark.dz {
		padding: 0;
		border-radius: 0;
		background: none;
		box-shadow: none;
		border-bottom: 2px dotted var(--warn, #b8962a);
		color: inherit;
		cursor: help;
	}
</style>
