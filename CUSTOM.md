# ai-dvokat UI — день 1

Статус: реализация и приёмка в работе (02.11.2026). Предыдущие ограничения доступа сняты.

## Репозиторий и правила

Публичный fork https://github.com/78dima/open-webui разрешён владельцем 02.11.2026. Upstream: https://github.com/open-webui/open-webui. Ветка `ai-dvokat` начинается от `v0.12.5`; только коммиты `custom:`. Полная история загружена без shallow clone. Dockerfile не меняется. Первый пакет UI не входит в этот этап.

## Точки подключения

| Файл upstream | Добавление |
| --- | --- |
| `backend/open_webui/config.py` | Импорт из `custom/ui.py`, чтение `CUSTOM_UI` (2 строки) |
| `backend/open_webui/main.py` | Импорт конфигурации; поле `custom_ui` в `/api/config` (по строке) |
| `src/lib/stores/index.ts` | Типизированное поле `custom_ui` (1 строка) |
| `src/lib/components/chat/Placeholder.svelte` | Импорт и вставка `CustomHello` (по строке) |
| `src/app.css` | Импорт `src/custom.css` (1 строка) |
| `tailwind.config.js` | Импорт и spread собственных токенов в `theme.extend` (по строке) |
| `README.md` | Уведомление о неаффилированности публичного форка |
| `.github/workflows/*` upstream | Условие `github.repository == 'open-webui/open-webui'` на каждом job, исключающее запуск в форке |

Все точки отмечены `ai-dvokat:` в синтаксисе комментариев соответствующего языка. Собственный код: `backend/open_webui/custom/`, `src/lib/custom/`, `src/lib/components/custom/`, `src/custom.css`, `tests/custom/`, `.github/workflows/build-image.yml`.

## Конфигурация

`CUSTOM_UI` — JSON-объект, по умолчанию `{}`. Единственный пример включается строго boolean `true`: `{"hello":true}`. `false`, отсутствие флага или строка `"true"` не включают компонент. Некорректный JSON или значение другого типа дают `{}` и предупреждение без содержимого переменной. Для изменения окружения нужен recreate контейнера.

Поле доступно в публичном `/api/config`: никаких секретов в `CUSTOM_UI`. Отдельная русская локализация находится в `src/lib/custom/locales/ru-RU.json`. Собственные CSS-переменные не меняют базовые токены upstream.

## Локальная разработка

Node 24.22.1; upstream package.json декларирует Node до 22 включительно, Dockerfile и CI используют Node 22. На этой машине `sharp` пытается использовать системный libvips; установка выполняется с `SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm ci --force`.

`WEBUI_BACKEND_URL=http://localhost:8080 npm run dev -- --host 127.0.0.1` запускает frontend на 5173. Upstream vite.config.ts уже проксирует `/api`, `/ws`, `/openai`, `/ollama`, `/oauth` на 8080. Ключ задаётся окружением процесса (в .env.example upstream его нет).

## Проверки и публикация

- Backend: `python3 -m unittest discover -s tests/custom -p 'test_*.py'`.
- Playwright: `npm ci --prefix tests/custom`; `cd tests/custom && npx playwright install chromium && npm test`.
- Изолированный browser harness использует настоящий компонент и заменяет только стор конфигурации; живой smoke приложения выполняется отдельно.
- CI запускает эти тесты, затем сборку неизменённым Dockerfile и публикацию GHCR. Push ветки даёт тег `0.12.5-ai1-<sha12>`, тег `0.12.5-ai1` — одноимённый образ. `latest` не публикуется.

Фактические результаты сборки, smoke и переключения флага будут внесены после выполнения; пока они не считаются пройденными.
