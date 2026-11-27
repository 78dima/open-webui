# ai-dvokat UI (форк Open WebUI)

Публичный форк `78dima/open-webui` (upstream `open-webui/open-webui`), рабочая ветка `ai-dvokat-0.13` (база `v0.13.0`, образы `0.13.0-ai9-*`). Не писать в `main`/`dev`; префикс каждого коммита — строго `custom:`. В публичный репозиторий никогда не попадают секреты, клиентские документы, cookie и логи живых проверок.

## Источники правды
- [ARCHITECTURE.md](../ai-dvokat/ARCHITECTURE.md) — единая архитектура системы, контракты API и схема контейнеров.
- [AGENTS.md](../ai-dvokat/AGENTS.md) — общие инженерные правила и правила работы в изолированном dev-контуре VPS (`ai-dvokat-dev`).
- [CUSTOM.md](CUSTOM.md) — реестр всех точек подключения к штатным файлам Open WebUI и история слоёв.

## Где живёт наш код
- `backend/open_webui/custom/` — серверные расширения (`ui.py` для `CUSTOM_UI`, `case.py` для проверенного `folder_id` в `metadata`, `builtin_tools_off` и `custom_features`).
- `src/routes/case/` — единый SvelteKit SPA «Дел» (`/case`, `/case/[folderId]`, `/case/[folderId]/[section]`, просмотрщик листа `/case/[folderId]/p/[pageId]` и переход по ссылке `/case/[folderId]/ref`).
- `src/lib/custom/` и `src/lib/components/custom/` — API-клиент и компоненты «Дел» (`src/lib/custom/case/`), бренд/видимость/статусы вызовов инструментов (`toolStatus.ts`), русская локализация `src/lib/custom/locales/ru-RU.json`, стили `src/custom.css` (Tailwind — только через `theme.extend`).

## Жёсткие инженерные правила форка
1. **Сервис считает — фронт только рисует:** запрещено дублировать бизнес-логику, вычисление статусов хода или текстовый разбор на TypeScript — фронт отображает готовые поля JSON API `legal-tools`. Тексты страниц «Дел» приходят из сервиса (`PAGE_STRINGS.json`); снимок для тестов обновляется командой `node tests/custom/case-strings-sync.mjs ../ai-dvokat/tools/src/legal_tools/case/texts/PAGE_STRINGS.json`.
2. **Минимальное вторжение в штатные файлы Open WebUI:** без крайней необходимости не затрагивать новые файлы upstream вне `custom/` и `src/routes/case/`. Каждую точку подключения делать в 1–2 строки с комментарием `ai-dvokat:` и регистрировать в `CUSTOM.md`. Штатный код не удалять — скрытие элементов для роли `user` делать через флаги `CUSTOM_UI`.
3. **Лицензия Open WebUI:** кастомный бренд («Ai - dvokat») без enterprise-лицензии разрешён только при **≤ 50 активных пользователей за 30 дней** (`LICENSE`).
4. **Гигиена тестов:**
   - Python-тесты точек подключения: `python3 -m unittest discover -s tests/custom -p 'test_*.py'`;
   - модульные проверки: `npm run test:frontend`;
   - браузерные тесты Playwright: `cd tests/custom && CASE_PAGE_STRINGS=../../../ai-dvokat/tools/src/legal_tools/case/texts/PAGE_STRINGS.json npm test`.
   Запрещено рисовать выдуманные JSON-ответы без сверки с реальными Pydantic-схемами `legal-tools` и плодить файлы тестов под разовые багфиксы.
5. **Быстрая сборка образов слоями (без 25-минутной полной сборки):**
   - при правках только фронтенда (`src/`, `static/`): `deploy/ui-layer/build.sh --build <базовый образ> <итоговый тег>` (собирает Vite на машине и накладывает поверх `/app/build`, сохраняя `pyodide`);
   - при правках `backend/open_webui/**/*.py`: обновить манифест `deploy/case-layer/build.sh --manifest` и собрать слой `deploy/case-layer/build.sh`;
   - при правках `package*.json`, `pyproject.toml`, `uv.lock` или `Dockerfile` — полная сборка образа. На общей машине сборку запускать под `flock /tmp/ai-dvokat-docker-build.lock`.
