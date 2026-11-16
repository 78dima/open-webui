#!/usr/bin/env bash
# ai-dvokat: слой образа 0.13.0-ai9 поверх проверенного образа 0.13.0-ai8 — как слой закрепления пакетов
# (~/ai-dvokat/deploy/scripts/owui-pin-layer.sh): Dockerfile форка не меняется, полная пересборка (15–30 мин, новые
# версии транзитивных пакетов) не нужна. В слой идут ровно файлы бэкенда, изменённые коммитами после базового тега;
# всё прочее (фронтенд src/, static/, package*.json, pyproject.toml, uv.lock, Dockerfile) слоем не доставить —
# скрипт откажет, нужна полная сборка. CUSTOM.md, раздел «Дело и тома: папка чата в metadata (0.13.0-ai9)».
#
#   deploy/case-layer/build.sh [<базовый тег git> <базовый образ> <итоговый тег>]
#   deploy/case-layer/build.sh 0.13.0-ai8 ghcr.io/78dima/open-webui-legal:0.13.0-ai8 ghcr.io/78dima/open-webui-legal:0.13.0-ai9-rc
#
# Проверки (любая не прошла — образ не собирается или скрипт выходит с ошибкой):
# 1) файлы слоя в рабочей копии закоммичены; изменения после базового тега — только backend/open_webui/**.py (кроме
#    них разрешены только свои файлы без влияния на образ: CUSTOM.md, tests/custom/**, deploy/case-layer/**);
# 2) в базовом образе эти файлы — побайтно как в базовом теге (базовый образ действительно собран из него);
# 3) в итоговом образе файлы слоя — побайтно как HEAD, остальные .py бэкенда — побайтно как в базовом образе;
# 4) тест форка tests/custom/test_case.py проходит на файлах образа (точки подключения на месте).
# Сборку на общей машине запускать под flock /tmp/ai-dvokat-docker-build.lock. Образ не публикуется.
set -euo pipefail
BASE_REF=${1:-0.13.0-ai8}
BASE_IMG=${2:-ghcr.io/78dima/open-webui-legal:0.13.0-ai8}
OUT=${3:-ghcr.io/78dima/open-webui-legal:0.13.0-ai9-rc}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"
die() { echo "ОТКАЗ: $*" >&2; exit 1; }

git rev-parse --verify -q "$BASE_REF^{commit}" >/dev/null || die "нет базового тега $BASE_REF"
docker image inspect "$BASE_IMG" >/dev/null 2>&1 || die "нет базового образа $BASE_IMG"
mapfile -t changed < <(git diff --name-only "$BASE_REF" HEAD)
layer=()
for f in "${changed[@]}"; do
  case "$f" in
    backend/open_webui/*.py) layer+=("$f") ;;
    CUSTOM.md|tests/custom/*|deploy/case-layer/*) ;;
    *) die "изменён $f: слоем не доставить, нужна полная сборка образа из тега" ;;
  esac
done
[ ${#layer[@]} -gt 0 ] || die "после $BASE_REF нет изменений бэкенда — слой не нужен"
[ -z "$(git status --porcelain -- "${layer[@]}" tests/custom/test_case.py)" ] || die "файлы слоя не закоммичены"

echo "слой: ${#layer[@]} файл(ов) после $BASE_REF ($(git rev-parse --short "$BASE_REF") → $(git rev-parse --short HEAD))"
printf '  %s\n' "${layer[@]}"

# 2) базовый образ = базовый тег по этим файлам (новые файлы в базе отсутствуют)
for f in "${layer[@]}"; do
  in_img=$(docker run --rm --entrypoint sh "$BASE_IMG" -c "sha256sum /app/$f 2>/dev/null | cut -d' ' -f1" || true)
  if git cat-file -e "$BASE_REF:$f" 2>/dev/null; then
    want=$(git show "$BASE_REF:$f" | sha256sum | cut -d' ' -f1)
    [ "$in_img" = "$want" ] || die "$f в $BASE_IMG не как в $BASE_REF"
  else
    [ -z "$in_img" ] || die "$f уже есть в $BASE_IMG, а в $BASE_REF его нет"
  fi
done

ctx=$(mktemp -d)
trap 'rm -rf "$ctx"' EXIT
for f in "${layer[@]}"; do
  install -D -m 0644 "$f" "$ctx/app/$f"
done
{
  echo "# ai-dvokat: слой поверх $BASE_IMG (deploy/case-layer/build.sh); файлы бэкенда из $(git rev-parse HEAD)"
  echo "FROM $BASE_IMG"
  echo "COPY app/ /app/"
  printf 'RUN python -m compileall -q'
  printf ' /app/%s' "${layer[@]}"
  echo
  echo "LABEL org.opencontainers.image.revision=\"$(git rev-parse HEAD)\" ai-dvokat.layer-base=\"$BASE_IMG\" ai-dvokat.layer-base-ref=\"$BASE_REF\""
} > "$ctx/Dockerfile"
docker build -q -t "$OUT" "$ctx" >/dev/null
echo "собран $OUT ($(docker image inspect -f '{{.Id}}' "$OUT" | cut -c8-19))"

# 3) файлы слоя — как HEAD, прочие .py бэкенда — как в базе
for f in "${layer[@]}"; do
  got=$(docker run --rm --entrypoint sha256sum "$OUT" "/app/$f" | cut -d' ' -f1)
  [ "$got" = "$(git show "HEAD:$f" | sha256sum | cut -d' ' -f1)" ] || die "$f в $OUT не как в HEAD"
done
list='cd /app && find backend/open_webui -name "*.py" -print0 | LC_ALL=C sort -z | xargs -0 sha256sum'
base_sums=$(docker run --rm --entrypoint sh "$BASE_IMG" -c "$list")
out_sums=$(docker run --rm --entrypoint sh "$OUT" -c "$list")
skip=$(printf '%s\n' "${layer[@]}")
diff <(grep -vFf <(printf '%s\n' "$skip") <<<"$base_sums") <(grep -vFf <(printf '%s\n' "$skip") <<<"$out_sums") >/dev/null \
  || die "в $OUT изменились файлы бэкенда вне слоя"
echo "прочие .py бэкенда: как в $BASE_IMG ($(wc -l <<<"$base_sums") файлов)"

# 4) тест форка на файлах образа
docker run --rm -v "$ROOT/tests/custom/test_case.py:/app/tests/custom/test_case.py:ro" -w /app --entrypoint python "$OUT" \
  -m unittest -q tests/custom/test_case.py
echo "OK $OUT"
