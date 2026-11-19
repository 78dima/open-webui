<script lang="ts" context="module">
	// ai-dvokat: имена значков спрайта (Sprite.svelte); проверка сверяет список со спрайтом
	export const ICONS = [
		'al',
		'back',
		'chat',
		'clock',
		'd',
		'dl',
		'eye',
		'folder',
		'folder-plus',
		'fwd',
		'gap',
		'hash',
		'img',
		'info',
		'list',
		'lock',
		'ok',
		'pen',
		'plus',
		'q',
		'r',
		'retry',
		'search',
		'u',
		'up',
		'user',
		'users',
		'vol',
		'x',
		'zoom'
	] as const;
	export type IconName = (typeof ICONS)[number];
</script>

<script lang="ts">
	export let name: IconName;
	/** Сторона в px; без значения — 16 (правило .ic), `l` в `klass` — 20. */
	export let size: number | undefined = undefined;
	/** Толщина линии; без значения — 1.8 (правило .ic). */
	export let stroke: number | undefined = undefined;
	export let klass = '';
</script>

<svg
	class="ic {klass}"
	aria-hidden="true"
	focusable="false"
	style:width={size ? `${size}px` : undefined}
	style:height={size ? `${size}px` : undefined}
	style:stroke-width={stroke ?? undefined}
>
	<use href="#cg-i-{name}" />
</svg>
