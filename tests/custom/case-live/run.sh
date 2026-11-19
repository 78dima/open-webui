#!/usr/bin/env bash
# ai-dvokat: живая проверка страниц «Дел» — тем же путём, каким ходит страница: настоящий браузер, настоящий вход,
# Open WebUI (образ форка; фронтенд — сборка этой рабочей копии, каталог build/), legal-tools ветки ai-dvokat со своими
# Postgres, Redis, MinIO и case-worker (распознаёт подставная «идеальная модель» сквозной пробы дела на выдуманном деле
# corpus/case-v1 — бесплатно), Caddy с правилами сервера. Своя среда: свой compose-проект и подсеть, один порт на
# 127.0.0.1; по выходу всё удаляется. Стенд ноутбука и проект legal-assistant не трогаются. Платных вызовов нет.
#
#   node --max-old-space-size=6144 node_modules/vite/bin/vite.js build                 # сборка фронтенда
#   flock /tmp/ai-dvokat-docker-build.lock docker build -t legal-assistant/legal-tools:case-ui-g <ai-dvokat>/tools/
#   LIVE_NAME=<проект> LIVE_SUBNET=<свободная /24> tests/custom/case-live/run.sh [каталог для снимков]
# LIVE_KEEP=1 — оставить среду (убрать: docker compose -p $LIVE_NAME down -v). Код выхода 0 — все проверки OK.
# LIVE_ENV_ONLY=<файл состояния> — поднять среду и выйти, не запуская сценариев (её ведёт платная проверка
# live-paid.mjs: настоящий провайдер задаётся LIVE_OPENROUTER_URL и LIVE_OPENROUTER_KEY, пределы — LIVE_BUDGET_USD и
# LIVE_SWEEP_MAX_USD; только по слову владельца).
# LIVE_TOOLS_OLD_IMAGE=<образ сервиса до сдачи 4> — рядом поднимается прежняя страница листа (/legal-tools-old): с ней
# сверяется скопированная строка.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
FORK=$(cd "$HERE/../../.." && pwd)
TOOLS_REPO=${LIVE_TOOLS_REPO:-$FORK/../ai-dvokat-case-ui}
OUT=${1:-}
export LIVE_NAME=${LIVE_NAME:?нужно имя compose-проекта} LIVE_SUBNET=${LIVE_SUBNET:?нужна свободная подсеть /24}
export LIVE_PORT=${LIVE_PORT:-18470}
export LIVE_TOOLS_IMAGE=${LIVE_TOOLS_IMAGE:-legal-assistant/legal-tools:case-ui-g}
export LIVE_OWUI_IMAGE=${LIVE_OWUI_IMAGE:-ghcr.io/78dima/open-webui-legal:0.13.0-ai9-rc}
export LIVE_MINIO_IMAGE=${LIVE_MINIO_IMAGE:-cgr.dev/chainguard/minio@sha256:88df627ed94cddb2a0417f6248e6024cb614128fd213e1097c283b31f4170b73}
export LIVE_PROV_IMAGE=${LIVE_PROV_IMAGE:-$(sed -n '/^  litellm:/,/^  [a-z]/{s/^    image: //p}' "$TOOLS_REPO/deploy/compose.yaml" | head -n 1)}
PROBE="$TOOLS_REPO/tools/tests/case_probe"
CORPUS="$TOOLS_REPO/corpus/case-v1"
case "$LIVE_PORT" in 8080|8000|4000|9001) echo "порт $LIVE_PORT занят стендом"; exit 2;; esac
[ "$LIVE_NAME" != legal-assistant ] || { echo "это проект стенда"; exit 2; }
[ -f "$FORK/build/index.html" ] || { echo "нет сборки фронтенда ($FORK/build): см. начало файла"; exit 2; }
[ -f "$TOOLS_REPO/deploy/caddy/Caddyfile" ] || { echo "нет рабочей копии ai-dvokat: LIVE_TOOLS_REPO=<путь>"; exit 2; }
[ -f "$CORPUS/key.json" ] && [ -f "$PROBE/prov.py" ] || { echo "нет выдуманного дела corpus/case-v1 или пробы дела в $TOOLS_REPO"; exit 2; }
for i in "$LIVE_TOOLS_IMAGE" "$LIVE_OWUI_IMAGE" "$LIVE_MINIO_IMAGE" "$LIVE_PROV_IMAGE" pgvector/pgvector:pg17 redis:7-alpine caddy:2-alpine; do
  docker image inspect "$i" >/dev/null 2>&1 || { echo "нет образа $i"; exit 2; }
done
WORK=$(mktemp -d)
# сборка — копией: Open WebUI пишет в свой каталог сборки, рабочая копия остаётся нетронутой
cp -a --reflink=auto "$FORK/build" "$WORK/build"
export LIVE_BUILD="$WORK/build" LIVE_CADDYFILE="$WORK/Caddyfile" LIVE_WORK="$WORK/prov" LIVE_PROV="$PROBE/prov.py"
mkdir -p "$LIVE_WORK" "$WORK/files"
# «идеальная модель»: карта «изображение листа → текст и номер» по ключу выдуманного дела — тем же рендером, что конвейер
docker run --rm --network none --user "$(id -u):$(id -g)" -v "$CORPUS:/corpus:ro" -v "$LIVE_WORK:/work" \
  -v "$PROBE/keymap.py:/keymap.py:ro" --entrypoint python "$LIVE_TOOLS_IMAGE" -I /keymap.py /corpus /work/keymap.json \
  | sed 's/^/     карта ответов модели: /' || { echo "FAIL карта ответов модели (keymap.py)"; exit 1; }
# превращённое дело для «Замены тома»: том 1 переснят целиком (как в сквозной пробе дела) — и его карта ответов
if (cd "$TOOLS_REPO/tools" && uv run ../corpus/case-v1/render.py build --profile mini --mutate dup-volume=1 \
      --out "$LIVE_WORK/mut" >/dev/null 2>&1); then
  mkdir -p "$WORK/mutcorpus" && ln -s "$LIVE_WORK/mut" "$WORK/mutcorpus/mini" && cp "$LIVE_WORK/mut/key.json" "$WORK/mutcorpus/key.json"
  docker run --rm --network none --user "$(id -u):$(id -g)" -v "$WORK/mutcorpus/key.json:/corpus/key.json:ro" \
    -v "$LIVE_WORK/mut:/corpus/mini:ro" -v "$LIVE_WORK:/work" -v "$PROBE/keymap.py:/keymap.py:ro" --entrypoint python \
    "$LIVE_TOOLS_IMAGE" -I /keymap.py /corpus /work/keymap-mut.json \
    | sed 's/^/     карта ответов модели, переснятый том: /' || { echo "FAIL карта ответов переснятого тома"; exit 1; }
else
  echo "     переснятый том не собран (corpus/case-v1/render.py --mutate): «Замена тома» вживую не проверяется"
  rm -rf "$LIVE_WORK/mut"
fi
# том побольше — чтобы передача шла двумя частями (часть — 5 МБ): «Том 1» выдуманного дела трижды подряд
# ещё: второй большой том (загрузка, начатая на прежней странице, продолжается на новой), архив ZIP, папка с двумя
# PDF, файл для «Знаний» папки чата — всё из листов того же выдуманного дела (подставная модель их знает)
(cd "$TOOLS_REPO/tools" && uv run -q python - "$CORPUS/mini" "$WORK/files" <<'EOF'
import sys, zipfile, os
from pypdf import PdfReader, PdfWriter
src, out = sys.argv[1], sys.argv[2]
def many(name, times, to):
    w = PdfWriter()
    for _ in range(times):
        w.append(os.path.join(src, name))
    w.write(os.path.join(out, to))
def pages(name, which, to):
    r, w = PdfReader(os.path.join(src, name)), PdfWriter()
    for n in which:
        w.add_page(r.pages[n])
    os.makedirs(os.path.dirname(os.path.join(out, to)), exist_ok=True)
    w.write(os.path.join(out, to))
many("Том 1.pdf", 3, "Том 7 (большой).pdf")
many("Том 2.pdf", 8, "Том 8 (большой).pdf")
pages("Том 2.pdf", [0], "Доверенность.pdf")            # в «Знания» папки
pages("Том 2.pdf", [1], "Письмо.pdf")                  # внутрь архива
pages("tom5.pdf", [0, 1], "Папка с томами/том-а.pdf")
pages("tom5.pdf", [2, 3], "Папка с томами/том-б.pdf")
with zipfile.ZipFile(os.path.join(out, "Архив.zip"), "w") as z:
    z.write(os.path.join(out, "Письмо.pdf"), "Письмо.pdf")
os.remove(os.path.join(out, "Письмо.pdf"))
EOF
) || { echo "FAIL файлы живой проверки не собраны"; exit 1; }
# правила Caddy — блок chat.<домен> настоящего Caddyfile сервера, только адрес — порт без TLS
python3 - "$TOOLS_REPO/deploy/caddy/Caddyfile" "${LIVE_TOOLS_OLD_IMAGE:-}" > "$LIVE_CADDYFILE" <<'EOF'
import sys
lines = open(sys.argv[1], encoding="utf-8").read().split("\n")
start = next(i for i, l in enumerate(lines) if l.startswith("chat.{$PUBLIC_DOMAIN}"))
end = next(i for i in range(start + 1, len(lines)) if lines[i] == "}")
body = lines[start + 1:end + 1]
if len(sys.argv) > 2 and sys.argv[2]:
    # сервис прежнего образа (прежняя страница листа) — рядом, по своему адресу
    at = next(i for i, l in enumerate(body) if l.strip().startswith("handle_path /legal-tools/*"))
    body[at:at] = ["\thandle_path /legal-tools-old/* {", "\t\treverse_proxy tools-old:8000", "\t}"]
print("{\n\tauto_https off\n\tadmin off\n}\n:80 {\n" + "\n".join(body))
EOF
COMPOSE=(docker compose -p "$LIVE_NAME" -f "$HERE/compose.yaml")
cleanup() {
  if [ -n "${LIVE_KEEP:-}" ]; then echo "LIVE_KEEP: среда $LIVE_NAME оставлена на http://127.0.0.1:$LIVE_PORT (каталог $WORK)"; return; fi
  "${COMPOSE[@]}" --profile old down -v --remove-orphans >/dev/null 2>&1 || true
  docker run --rm -v "$WORK:/w" alpine:latest rm -rf /w/build >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
BASE="http://127.0.0.1:$LIVE_PORT"
echo "живая проверка $LIVE_NAME ($LIVE_SUBNET): $BASE; Open WebUI = $LIVE_OWUI_IMAGE + сборка $(git -C "$FORK" rev-parse --short HEAD); legal-tools = $LIVE_TOOLS_IMAGE"
"${COMPOSE[@]}" up -d --pull never --quiet-pull pg redis minio prov owui caddy >/dev/null 2>&1
python3 -I "$HERE/setup.py" owui "$BASE" "$WORK/state.json"
export LIVE_RELEASE_GROUP=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["group"])' "$WORK/state.json")
for _ in $(seq 30); do "${COMPOSE[@]}" run --rm --no-deps tools init-buckets >/dev/null 2>&1 && break; sleep 2; done
"${COMPOSE[@]}" up -d --pull never --wait --wait-timeout 180 tools >/dev/null 2>&1 || { echo "FAIL legal-tools не поднялся"; "${COMPOSE[@]}" logs --no-color --tail 40 tools; exit 1; }
"${COMPOSE[@]}" run --rm --no-deps case-worker case-worker --resume >/dev/null 2>&1 || true
"${COMPOSE[@]}" up -d --pull never --no-recreate case-worker jobs-worker >/dev/null 2>&1
OLD=0
if [ -n "${LIVE_TOOLS_OLD_IMAGE:-}" ] && docker image inspect "$LIVE_TOOLS_OLD_IMAGE" >/dev/null 2>&1; then
  "${COMPOSE[@]}" --profile old up -d --pull never --no-recreate tools-old >/dev/null 2>&1 && OLD=1
fi
python3 -I "$HERE/setup.py" cases "$BASE" "$WORK/state.json"
if [ -n "${LIVE_ENV_ONLY:-}" ]; then
  # только среда, без сценариев (платная проверка live-paid.mjs ведёт её сама): состояние — в названный файл, рядом —
  # переменные среды для команд compose (без ключа провайдера); убрать: docker compose -p $LIVE_NAME down -v
  cp "$WORK/state.json" "$LIVE_ENV_ONLY"
  { export -p | grep -E '^declare -x LIVE_' | grep -v OPENROUTER_KEY | sed 's/^declare -x //'; echo "LIVE_WORKDIR=\"$WORK\""; } > "${LIVE_ENV_ONLY%.json}.env"
  LIVE_KEEP=1
  exit 0
fi
rc=0
(cd "$HERE/.." && node case-live/live.mjs --state "$WORK/state.json" ${OUT:+--out "$OUT"}) || rc=1
(cd "$HERE/.." && node case-live/live-case.mjs --state "$WORK/state.json" --corpus "$CORPUS/mini" \
   --big "$WORK/files/Том 7 (большой).pdf" ${OUT:+--out "$OUT"}) || rc=1
# страница листа и «несколько листов» (сдача 4) — на том же деле, до правок разделов; пропуск: LIVE_SHEET=0
if [ "${LIVE_SHEET:-1}" = 1 ] && [ -f "$WORK/case.json" ]; then
  (cd "$HERE/.." && node case-live/live-sheet.mjs --state "$WORK/state.json" --case "$WORK/case.json" --old "$OLD" \
     ${OUT:+--out "$OUT"}) || rc=1
fi
# остальные разделы страницы дела — на том же деле (сдача 3); пропуск: LIVE_SECTIONS=0
if [ "${LIVE_SECTIONS:-1}" = 1 ] && [ -f "$WORK/case.json" ]; then
  (cd "$HERE/.." && node case-live/live-sections.mjs --state "$WORK/state.json" --case "$WORK/case.json" --files "$WORK/files" \
     --mut "$LIVE_WORK/mut" ${OUT:+--out "$OUT"}) || rc=1
fi
if "${COMPOSE[@]}" logs --no-color tools case-worker jobs-worker 2>&1 | grep -q 'Traceback'; then
  echo "FAIL в журнале legal-tools есть Traceback:"; "${COMPOSE[@]}" logs --no-color tools case-worker jobs-worker 2>&1 | grep -B2 -A8 'Traceback' | tail -24; rc=1
else
  echo "OK   журналы legal-tools и case-worker без Traceback"
fi
exit $rc
