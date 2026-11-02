<script lang="ts">
 import { config, WEBUI_NAME } from './stores';
 import Brand from '../../src/lib/components/custom/Brand.svelte';
 import About from '../../src/lib/components/custom/About.svelte';
 import { brandAsset } from '../../src/lib/custom/brand';
</script>
<Brand />
<svelte:head><title>{$WEBUI_NAME}</title></svelte:head>
<img data-testid="brand-logo" src={brandAsset($config?.custom_ui, '/static/favicon.png')} alt={$WEBUI_NAME} />
{#if $config?.custom_ui?.brand?.about === true}<About />{:else}<p data-testid="upstream-about">Open WebUI</p>{/if}
<a href="https://openwebui.com/search">Community</a>
