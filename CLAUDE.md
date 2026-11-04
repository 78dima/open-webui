# ai-dvokat UI

Следовать [AGENTS.md](AGENTS.md).

Источники задачи:
- [План форка от 02.11.2026](/home/arimi/ai-dvokat/docs/fork-plan-2026-11-02.md), правила §2.
- [Решения от 01.11.2026](/home/arimi/ai-dvokat/docs/decisions/open-webui-fable-decisions-2026-11-01.md), §16 и записи §17 от 05.11.
- [Бриф этапа 2](/home/arimi/ai-dvokat/docs/ui-customization-brief-2026-11-02.md) и контракты U1–U6 в [отчёте продукта](/home/arimi/ai-dvokat/docs/reports/product-2026-11-03.md) §3.

Решение владельца 05.11: стиль остаётся текущий Open WebUI, макетов и редизайна нет; бренд Ai - dvokat остаётся. Пакеты B1–B5 включаются флагами в этом стиле, B6 — после пилота. Работать в этом каталоге; в соседнем `ai-dvokat` разрешены только строка образа `openwebui` в `deploy/compose.yaml` и строка `CUSTOM_UI` в `deploy/openwebui.env`, без коммитов и пуша там и без изменений `tools/` или `owui/`.

Фактический статус: [CUSTOM.md](CUSTOM.md).
