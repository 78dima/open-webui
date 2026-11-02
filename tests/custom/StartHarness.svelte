<script lang="ts">
 import Start from '../../src/lib/components/custom/Start.svelte';
 let selection = '';
 let draft = '';
</script>
<Start onChoose={(model, text) => { selection = model; draft = text; }} />
<output data-testid="selected-model">{selection}</output>
<textarea aria-label="Черновик" bind:value={draft}></textarea>
