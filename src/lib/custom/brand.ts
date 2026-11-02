import { readCustomUI } from './config';
import ru from './locales/ru-RU.json' with { type: 'json' };

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
 if (!name) return upstream;
 return { ...upstream, 'ru-RU': { ...upstream['ru-RU'],
  ...Object.fromEntries(Object.entries(ru.brand.translations).map(([key, text]) => [key, text.replaceAll('{name}', name)]))
 } };
}
