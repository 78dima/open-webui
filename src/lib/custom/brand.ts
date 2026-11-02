import { readCustomUI } from './config';
import ru from './locales/ru-RU.json' with { type: 'json' };

let activeBrandName: string | undefined;
export const DEFAULT_BRAND_NAME = 'Ai - dvokat';
export const BRAND_LOGO = '/custom/logo.png';
export function brandName(value: unknown, upstream = 'Open WebUI'): string {
 const brand = readCustomUI(value).brand;
 return brand?.name ?? (brand?.suffix === false ? upstream.replace(/ \(Open WebUI\)$/, '') : upstream);
}
export function brandAsset(value: unknown, upstream: string): string {
 return readCustomUI(value).brand?.name ? BRAND_LOGO : upstream;
}
export function brandTranslations(value: unknown, upstream: Record<string, Record<string, string>> = {}) {
 const name = readCustomUI(value).brand?.name;
 activeBrandName = name;
 if (!name) return upstream;
 return { ...upstream, 'ru-RU': { ...upstream['ru-RU'],
  ...Object.fromEntries(Object.entries(ru.brand.translations).map(([key, text]) => [key, text.replaceAll('{name}', name)]))
 } };
}

/** Apply the same name to loaded language bundles without editing upstream dictionaries. */
export function brandLocale(resource: Record<string, string>): Record<string, string> {
 if (!activeBrandName) return resource;
 return Object.fromEntries(Object.entries(resource).map(([key, value]) =>
  [key, typeof value === 'string' ? value.replace(/Open\s*WebUI/gi, activeBrandName!) : value]));
}
/** Client-only feature gating; backend behavior and technical identifiers remain untouched. */
export function brandConfig<T extends {custom_ui?: unknown; name?: string; features?: Record<string, unknown>}>(cfg: T): T {
 const brand = readCustomUI(cfg?.custom_ui).brand;
 if (!brand?.name) return cfg;
 return {...cfg,name:brand.name,features:{...cfg.features,
  enable_version_update_check:false,
  ...(brand.community === false ? {enable_community_sharing:false} : {})}};
}
