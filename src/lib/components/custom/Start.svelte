<script lang="ts">
 import { config, models } from '$lib/stores';
 import ru from '$lib/custom/locales/ru-RU.json';
 export let disabled = false;
 export let onChoose: (model: string, prompt: string) => void = () => {};
</script>
{#if $config?.custom_ui?.start === true && !disabled}
 <section data-testid="custom-start" class="mb-4 text-left">
  <h2 class="text-lg font-medium mb-2">{ru.start.title}</h2>
  <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
   {#each ru.start.actions as action}
    {@const available = $models?.some(model => model.id === action.model)}
    <button type="button" class="border rounded-lg p-3 text-left disabled:opacity-50" disabled={!available}
     title={available ? action.title : ru.start.unavailable}
     on:click={() => onChoose(action.model, action.prompt)}>{action.title}</button>
   {/each}
  </div>
  <p class="text-xs mt-2 opacity-70">{ru.start.hint}</p>
 </section>
{/if}
