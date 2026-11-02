<script lang="ts">
 import { config } from '$lib/stores';
 import { brandName, BRAND_LOGO } from '$lib/custom/brand';
 import ru from '$lib/custom/locales/ru-RU.json';
</script>
<section data-testid="custom-about" class="text-sm space-y-4">
 <h2>{ru.brand.about}</h2>
 <img src={BRAND_LOGO} alt="" width="64" height="64" class="bg-white rounded-lg" />
 <p>{brandName($config?.custom_ui, $config?.name)}</p>
 <p>{ru.brand.description}</p>
 <p class="text-xs">{ru.brand.origin}</p>
 <p class="text-xs">{ru.brand.copyright}</p>
 <p class="text-xs">{ru.brand.emoji} <a href="https://creativecommons.org/licenses/by/4.0/">CC-BY 4.0</a></p>
</section>
