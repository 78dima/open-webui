<script lang="ts">
	// ai-dvokat: корень страниц «Дел» (вариант «Г»): своя прокрутка и фон, значки, строки сервиса.
	// Страница — вне оболочки чата (маршрут вне группы (app)); общий корневой макет даёт вход и конфигурацию.
	// Пока строк нет, слов для юриста у страницы нет: показывается пустой фон. Строки не пришли или «Дела»
	// выключены (`custom_ui.case`) — короткая карточка со словами форка (`case_page` в ru-RU.json): строки сервиса
	// в этот момент недоступны по определению.
	import { config } from '$lib/stores';
	import ru from '$lib/custom/locales/ru-RU.json';
	import { caseStrings, loadCaseStrings } from '$lib/custom/case/strings';
	import type { CaseApiError } from '$lib/custom/case/api';
	import Sprite from './Sprite.svelte';
	import Icon from './Icon.svelte';
	import StateCard from './StateCard.svelte';

	/** Адрес чата: страница — часть того же приложения. */
	export let chatHref = '/';

	let failure: 'not_found' | 'unavailable' | null = null;
	let busy = false;

	$: enabled = $config?.custom_ui?.case === true;

	async function load(force = false) {
		if (!enabled || busy) return;
		busy = true;
		failure = null;
		try {
			await loadCaseStrings($config?.custom_ui, { force });
		} catch (error) {
			failure = (error as CaseApiError)?.kind === 'not_found' ? 'not_found' : 'unavailable';
		} finally {
			busy = false;
		}
	}

	// конфигурация приходит от корневого макета; строки спрашиваются один раз, после сбоя — только по «Повторить»
	$: if (enabled && !$caseStrings && !failure && !busy) void load();
</script>

<div class="cg-view">
	<div class="cg cg-page" aria-busy={enabled && !$caseStrings && !failure}>
		<Sprite />
		{#if enabled && $caseStrings}
			<slot />
		{:else if !enabled || failure}
			<div class="shell">
				<main class="main" id="main-content">
					{#if !enabled || failure === 'not_found'}
						<StateCard icon="folder" title={ru.case_page.not_found} testid="case-fallback">
							<a class="btn p big act" href={chatHref}
								><Icon name="chat" size={18} />{ru.case_page.to_chat}</a
							>
						</StateCard>
					{:else}
						<StateCard
							icon="al"
							tone="stop"
							title={ru.case_page.unavailable}
							text={ru.case_page.unavailable_hint}
							testid="case-fallback"
						>
							<button
								class="btn p big act"
								type="button"
								disabled={busy}
								on:click={() => load(true)}
								><Icon name="retry" size={18} />{ru.case_page.retry}</button
							>
							<a class="btn big" href={chatHref}
								><Icon name="chat" size={18} />{ru.case_page.to_chat}</a
							>
						</StateCard>
					{/if}
				</main>
			</div>
		{/if}
	</div>
</div>

<style>
	/* корневой макет приложения держит окно без прокрутки (h-dvh, overflow-hidden) — страница прокручивается сама */
	.cg-view {
		height: 100%;
		overflow-x: hidden;
		overflow-y: auto;
	}
</style>
