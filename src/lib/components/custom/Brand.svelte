<script lang="ts">
 import { onMount } from 'svelte';
 import { get } from 'svelte/store';
 import { config, WEBUI_NAME } from '$lib/stores';
 import { readCustomUI } from '$lib/custom/config';
 import { brandName, BRAND_LOGO } from '$lib/custom/brand';

 // Only document-head metadata belongs to this controller; app markup uses explicit hooks.
 onMount(() => {
  const upstreamName = get(WEBUI_NAME);
  const originals = new Map<Element, string>();
  let manifestURL: string | undefined;
  const restore = () => {
   for (const [node, href] of originals) node.setAttribute('href', href);
   originals.clear();
   if (manifestURL) URL.revokeObjectURL(manifestURL);
   manifestURL = undefined;
  };
  const unsubscribe = config.subscribe((cfg) => {
   restore();
   const ui = readCustomUI(cfg?.custom_ui);
   document.documentElement.toggleAttribute('data-custom-community-hidden', ui.brand?.community === false);
   WEBUI_NAME.set(brandName(cfg?.custom_ui, cfg?.name ?? upstreamName));
   document.documentElement.toggleAttribute('data-custom-brand', !!ui.brand?.name);
   if (!ui.brand?.name) return;
   manifestURL = URL.createObjectURL(new Blob([JSON.stringify({
    name: ui.brand.name, short_name: ui.brand.name, start_url: new URL('/', location.origin).href, scope: new URL('/', location.origin).href, display: 'standalone',
    icons: [{ src: new URL(BRAND_LOGO, location.origin).href, sizes: '1254x1254', type: 'image/png', purpose: 'any' }]
   })], {type: 'application/manifest+json'}));
   for (const node of document.head.querySelectorAll('link[rel*="icon"], link[rel="manifest"]')) {
    originals.set(node, node.getAttribute('href') ?? '');
    node.setAttribute('href', node.getAttribute('rel') === 'manifest' ? manifestURL : BRAND_LOGO);
   }
  });
  return () => { unsubscribe(); restore(); document.documentElement.removeAttribute('data-custom-community-hidden'); document.documentElement.removeAttribute('data-custom-brand'); };
 });
</script>
