#!/usr/bin/env bash
# ai-dvokat: слой образа чата с новым интерфейсом — страницы «Дел» варианта «Г» — поверх проверенного образа
# (0.13.0-ai9-rc). Фронтенд собирается на машине (node, vite — полторы минуты) и кладётся в /app/build поверх прежнего;
# бэкенд образа не трогается, пакеты Pyodide (/app/build/pyodide — их в сборке на машине нет) остаются из базового
# образа. Полная пересборка образа (15–30 мин, новые версии транзитивных пакетов) не нужна. Образ не публикуется.
# CUSTOM.md, раздел «Страницы „Дел“ в форке, вариант „Г“».
#
#   deploy/ui-layer/build.sh --build [<базовый образ> [<итоговый тег>]]   собрать фронтенд из HEAD и слой
#   deploy/ui-layer/build.sh [<базовый образ> [<итоговый тег>]]           слой из уже собранного build/ (сборка — из HEAD)
#   умолчания: ghcr.io/78dima/open-webui-legal:0.13.0-ai9-rc → legal-assistant/open-webui-legal:0.13.0-ai9-caseg
#   deploy/ui-layer/build.sh --pack <файл.tar.gz>     упаковать готовую сборку и этот скрипт для сервера, где нет ни
#       истории git, ни node: там архив распаковывается в пустой каталог и слой собирается той же командой (режим
#       «архив»: сборка берётся из архива, а базовый образ сервера сверяется по бэкенду с тем, на котором сборка
#       проверена здесь, — суммы записаны в метке сборки).
#
# Проверки (любая не прошла — образ не собирается или скрипт выходит с ошибкой):
# 1) рабочая копия чиста; HEAD — потомок ревизии, из которой собран базовый образ (его метка
#    org.opencontainers.image.revision): все прежние доработки интерфейса в сборке есть; после этой ревизии изменены
#    только исходники фронтенда и свои файлы — бэкенд (нужен deploy/case-layer) и зависимости (нужна полная сборка)
#    слоем фронтенда не доставить;
# 2) build/ собран из HEAD (метка сборки build/ai-dvokat-ui-layer.json; её пишет --build) и без битых правил CSS;
# 3) в итоговом образе: бэкенд, package.json и CHANGELOG.md — побайтно как в базовом; pyodide — как в базовом;
#    фронтенд — побайтно как build/ на машине; в нём есть и новые страницы «Дел», и прежние доработки интерфейса;
# 4) тесты форка на файлах образа (точки подключения бэкенда на месте).
# Сборку на общей машине запускать под flock /tmp/ai-dvokat-docker-build.lock.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"
die() { echo "ОТКАЗ: $*" >&2; exit 1; }
BUILD=0
STAMP=build/ai-dvokat-ui-layer.json
if [ "${1:-}" = "--pack" ]; then
  [ -n "${2:-}" ] || die "--pack <файл.tar.gz>"
  [ -f build/index.html ] && grep -q '"base_backend"' "$STAMP" 2>/dev/null || die "нет проверенной сборки: сначала deploy/ui-layer/build.sh --build"
  tar -czf "$2" --exclude=build/pyodide build deploy/ui-layer/build.sh tests/custom/test_case.py tests/custom/test_config.py
  echo "упакован $2 ($(du -h "$2" | cut -f1)): сборка $(sed -n 's/.*"revision": "\([0-9a-f]\{9\}\).*/\1/p' "$STAMP")"
  exit 0
fi
if [ "${1:-}" = "--build" ]; then BUILD=1; shift; fi
BASE_IMG=${1:-ghcr.io/78dima/open-webui-legal:0.13.0-ai9-rc}
OUT=${2:-legal-assistant/open-webui-legal:0.13.0-ai9-caseg}
docker image inspect "$BASE_IMG" >/dev/null 2>&1 || die "нет базового образа $BASE_IMG"
in_img() { docker run --rm --entrypoint sh "$1" -c "$2"; }
back='cd /app && { find backend -type f \( -name "*.py" -o -name "*.json" -o -name "*.txt" -o -name "*.sh" \) -not -path "*/data/*" -print0 | LC_ALL=C sort -z | xargs -0 sha256sum; sha256sum package.json CHANGELOG.md; }'
BASE_BACK=$(in_img "$BASE_IMG" "$back")
BASE_BACK_SUM=$(sha256sum <<<"$BASE_BACK" | cut -d' ' -f1)
if [ "$(git rev-parse --show-toplevel 2>/dev/null)" = "$ROOT" ]; then MODE=git; else MODE=archive; fi

if [ $MODE = git ]; then
# 1) что доставляется слоем
[ -z "$(git status --porcelain -- . ':!build')" ] || die "рабочая копия не чиста — закоммитьте изменения"
REV=$(git rev-parse HEAD)
BASE_REV=$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$BASE_IMG")
git rev-parse --verify -q "$BASE_REV^{commit}" >/dev/null || die "ревизии базового образа ($BASE_REV) нет в истории"
git merge-base --is-ancestor "$BASE_REV" HEAD || die "HEAD не потомок ревизии базового образа $BASE_REV — прежние доработки могли потеряться"
n=0
while IFS= read -r f; do
  case "$f" in
    src/*|static/*) n=$((n + 1)) ;;
    CUSTOM.md|tests/custom/*|deploy/*) ;;
    backend/*) die "изменён $f: бэкенд слоем фронтенда не доставить (deploy/case-layer/build.sh)" ;;
    *) die "изменён $f: слоем фронтенда не доставить, нужна полная сборка образа" ;;
  esac
done < <(git diff --name-only "$BASE_REV" HEAD)
[ $n -gt 0 ] || die "после $BASE_REV нет изменений фронтенда — слой не нужен"
echo "слой фронтенда: $n файл(ов) исходников после ${BASE_REV:0:9} → ${REV:0:9}"

# 2) сборка фронтенда из HEAD
if [ $BUILD = 1 ]; then
  log=$(mktemp)
  node --max-old-space-size=6144 node_modules/vite/bin/vite.js build > "$log" 2>&1 || { tail -20 "$log"; die "сборка фронтенда не прошла"; }
  ! grep -q 'css-syntax-error' "$log" || die "в сборке битое правило CSS (css-syntax-error) — см. CUSTOM.md про Tailwind"
  rm -f "$log"
  printf '{"revision": "%s", "built": "%s", "base_revision": "%s", "base_backend": "%s"}\n' "$REV" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$BASE_REV" "$BASE_BACK_SUM" > "$STAMP"
fi
[ -f build/index.html ] && [ -f "$STAMP" ] || die "нет сборки фронтенда из HEAD (deploy/ui-layer/build.sh --build)"
grep -q "\"revision\": \"$REV\"" "$STAMP" || die "build/ собран не из HEAD (${REV:0:9}): пересоберите с --build"
grep -q "\"base_backend\": \"$BASE_BACK_SUM\"" "$STAMP" || die "сборка проверена на другом базовом образе: пересоберите с --build для $BASE_IMG"
else
  # режим «архив» (сервер: ни истории git, ни node): сборка — из архива --pack; базовый образ сервера должен нести тот
  # же бэкенд, на котором сборка проверена на машине сборки
  [ $BUILD = 0 ] || die "--build нужен на машине с историей git и node; здесь — слой из архива (--pack)"
  [ -f build/index.html ] && [ -f "$STAMP" ] || die "в каталоге нет сборки из архива (deploy/ui-layer/build.sh --pack)"
  REV=$(sed -n 's/.*"revision": "\([0-9a-f]*\)".*/\1/p' "$STAMP")
  BASE_REV=$(sed -n 's/.*"base_revision": "\([0-9a-f]*\)".*/\1/p' "$STAMP")
  [ -n "$REV" ] || die "метка сборки $STAMP без ревизии"
  grep -q "\"base_backend\": \"$BASE_BACK_SUM\"" "$STAMP" \
    || die "бэкенд $BASE_IMG не тот, на котором сборка проверена (ревизия ${BASE_REV:0:9}): нужен образ чата с тем же бэкендом"
  echo "слой фронтенда (архив): сборка ${REV:0:9}, бэкенд базового образа — как у проверенного (${BASE_REV:0:9})"
fi

ctx=$(mktemp -d)
trap 'rm -rf "$ctx"' EXIT
cp -a --reflink=auto build "$ctx/build"
rm -rf "$ctx/build/pyodide"            # пакеты Pyodide — из базового образа
{
  echo "# ai-dvokat: слой фронтенда поверх $BASE_IMG (deploy/ui-layer/build.sh); фронтенд из $REV"
  echo "FROM $BASE_IMG"
  # прежний фронтенд убирается весь, кроме pyodide (его слой не трогает — образ не растёт на его размер)
  echo "RUN find /app/build -mindepth 1 -maxdepth 1 ! -name pyodide -exec rm -rf {} +"
  echo "COPY build/ /app/build/"
  echo "LABEL org.opencontainers.image.revision=\"$REV\" ai-dvokat.ui-layer-base=\"$BASE_IMG\" ai-dvokat.ui-layer-base-revision=\"$BASE_REV\""
} > "$ctx/Dockerfile"
docker build -q -t "$OUT" "$ctx" >/dev/null
echo "собран $OUT ($(docker image inspect -f '{{.Id}}' "$OUT" | cut -c8-19))"

# 3) что в образе
[ "$BASE_BACK" = "$(in_img "$OUT" "$back")" ] || die "в $OUT изменились файлы бэкенда"
echo "бэкенд, package.json, CHANGELOG.md: как в $BASE_IMG ($(in_img "$OUT" "$back" | wc -l) файлов)"
pyo='cd /app/build/pyodide && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum; find . -type f | wc -l'
[ "$(in_img "$BASE_IMG" "$pyo")" = "$(in_img "$OUT" "$pyo")" ] || die "pyodide в $OUT не как в базовом образе"
echo "pyodide: как в базовом образе ($(in_img "$OUT" "$pyo" | tail -1) файлов)"
front='cd /app/build && find . -type f -not -path "./pyodide/*" -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum'
local_front=$(cd "$ctx/build" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum)
[ "$(in_img "$OUT" "$front")" = "$local_front" ] || die "фронтенд в $OUT не как build/ на машине"
# новые страницы и прежние доработки интерфейса — по их приметам в собранном коде
for mark in 'my-cases' 'case-summary' 'custom_ui' 'tool_details'; do
  in_img "$OUT" "grep -rlq -- '$mark' /app/build/_app/immutable" || die "в сборке образа нет приметы «$mark»"
done
echo "фронтенд: как build/ на машине; страницы «Дел» и прежние доработки на месте"

# 4) тесты форка на файлах образа
docker run --rm -v "$ROOT/tests/custom:/app/tests/custom:ro" -w /app --entrypoint python "$OUT" \
  -m unittest -q tests/custom/test_case.py tests/custom/test_config.py
echo "OK $OUT"
