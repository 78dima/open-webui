<script lang="ts">
	// ai-dvokat: пункт «Дела» в левой панели чата — ведёт на страницы «Дел» (/case). Виден, когда включён
	// выключатель дела (`custom_ui.case === true`) и сервис подтвердил, что «Дела» открыты этому юристу (группа
	// выпуска; `caseAccess` — один вопрос за сеанс, без ответа пункта нет, чат не ждёт). Вид — как у соседних пунктов
	// панели (это часть чата, не «Г»).
	import { config, user } from '$lib/stores';
	import { caseAccess } from '$lib/custom/case/access';
	import ru from '$lib/custom/locales/ru-RU.json';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import Folder from '$lib/components/icons/Folder.svelte';

	/** rail — свёрнутая панель (значок с подсказкой), full — развёрнутая (значок и слово). */
	export let variant: 'rail' | 'full' = 'full';

	let allowed = false;
	$: enabled = $config?.custom_ui?.case === true;
	$: if (enabled && $user) {
		void caseAccess($config?.custom_ui).then((yes) => (allowed = yes));
	} else {
		allowed = false;
	}
</script>

{#if enabled && allowed}
	{#if variant === 'rail'}
		<div>
			<Tooltip content={ru.case_page.sidebar} placement="right">
				<a
					class=" cursor-pointer flex size-8 items-center justify-center transition group"
					href="/case"
					draggable="false"
					aria-label={ru.case_page.sidebar}
					data-testid="custom-cases-link"
				>
					<div
						class="self-center flex size-[calc(30px*var(--app-text-scale,1))] items-center justify-center rounded-lg transition group-hover:bg-gray-100 dark:group-hover:bg-gray-900"
					>
						<Folder className="size-4" strokeWidth="1.5" />
					</div>
				</a>
			</Tooltip>
		</div>
	{:else}
		<div class="px-1 flex justify-center text-gray-700 dark:text-gray-300">
			<a
				id="sidebar-cases-button"
				class="group grow flex items-center space-x-2 rounded-xl px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-900 transition outline-none"
				href="/case"
				draggable="false"
				aria-label={ru.case_page.sidebar}
				data-testid="custom-cases-link"
			>
				<div class="self-center flex size-4 shrink-0 items-center justify-center">
					<Folder className="size-4" strokeWidth="1.5" />
				</div>
				<div class="flex flex-1 self-center translate-y-[0.5px]">
					<div class=" self-center text-[0.8125rem] leading-5">{ru.case_page.sidebar}</div>
				</div>
			</a>
		</div>
	{/if}
{/if}
