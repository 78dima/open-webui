// Стенд компонентов: вместо `$app/environment` SvelteKit — значения страницы в браузере (сцены идут в браузере, без
// отрисовки на сервере). Нужен цепочке StructuredOutputRenderer → … → MentionToken в сцене чата (Д-10 живой проверки
// 23.11: без псевдонима сборщик стенда не находил модуль и падали все сцены).
export const browser = true;
export const dev = false;
export const building = false;
export const version = 'test';
