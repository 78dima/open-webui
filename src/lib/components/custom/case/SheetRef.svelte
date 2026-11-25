<script lang="ts">
	// ai-dvokat: ссылка на лист — одна на всех страницах «Дел» (макет K-marks). Подпись листа приходит с сервиса и не
	// меняется; у листа без номера («т. 4, файл «…», стр. 120») имя файла показывается мелко — та же строка, другой вид.
	import { splitLabel } from '$lib/custom/case/casepage';
	import { isSpaCaseHref } from '$lib/custom/case/sheet';
	export let label = '';
	export let href: string | null | undefined = undefined;
	export let klass = '';
	$: parts = splitLabel(label);
	$: reload = href && !isSpaCaseHref(href) ? '' : undefined;
</script>

{#if href}
	<a class="ref {klass}" {href} title={label} data-sveltekit-reload={reload}
		>{parts.main}{#if parts.file}{' '}<span class="fn">{parts.file}</span>{/if}</a
	>
{:else}
	<span class={klass} title={label}
		>{parts.main}{#if parts.file}{' '}<span class="fn">{parts.file}</span>{/if}</span
	>
{/if}
