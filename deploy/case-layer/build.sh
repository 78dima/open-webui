#!/usr/bin/env bash
# ai-dvokat: слой образа 0.13.0-ai9 поверх проверенного образа 0.13.0-ai8 — как слой закрепления пакетов
# (~/ai-dvokat/deploy/scripts/owui-pin-layer.sh): Dockerfile форка не меняется, полная пересборка (15–30 мин, новые
# версии транзитивных пакетов) не нужна ни на стенде, ни на VPS. В слой идут ровно файлы бэкенда, изменённые коммитами
# после базового тега; всё прочее (фронтенд src/, static/, package*.json, pyproject.toml, uv.lock, Dockerfile) слоем не
# доставить — скрипт откажет, нужна полная сборка. CUSTOM.md, раздел «Дело и тома: папка чата в metadata (0.13.0-ai9)».
#
#   deploy/case-layer/build.sh --manifest [<базовый тег git>]
#       (нужна история git) записать deploy/case-layer/layer-manifest.txt — файлы слоя, их sha256 в базовом теге и в HEAD;
#       манифест коммитится вместе с файлами слоя (сборка с историей сверяет его с git и откажет, если он устарел);
#   deploy/case-layer/build.sh [<базовый тег git> <базовый образ> <итоговый тег>]
#   deploy/case-layer/build.sh 0.13.0-ai8 ghcr.io/78dima/open-webui-legal:0.13.0-ai8 ghcr.io/78dima/open-webui-legal:0.13.0-ai9-rc
#       собрать слой. С историей git (стенд): список — git diff от тега, он же должен быть в манифесте. Без истории
#       (VPS: исходники — git archive тега, docs/deploy.md §3): список и суммы — из манифеста этого дерева, файлы дерева
#       сверяются с суммами HEAD; ревизию для метки образа можно дать в LAYER_REVISION (git get-tar-commit-id архива).
#
# Проверки (любая не прошла — образ не собирается или скрипт выходит с ошибкой):
# 1) с историей: файлы слоя закоммичены; изменения после базового тега — только backend/open_webui/**.py (кроме них
#    разрешены только свои файлы без влияния на образ: CUSTOM.md, tests/custom/**, deploy/case-layer/**); манифест HEAD —
#    как git. В обоих режимах файлы дерева — побайтно как HEAD манифеста;
# 2) в базовом образе эти файлы — побайтно как в базовом теге (базовый образ действительно собран из него; на VPS — свой
#    ai8, собранный по §3, и он должен совпасть с тегом по этим файлам);
# 3) в итоговом образе файлы слоя — побайтно как HEAD, остальные .py бэкенда — побайтно как в базовом образе;
# 4) тест форка tests/custom/test_case.py проходит на файлах образа (точки подключения на месте).
# Сборку на общей машине запускать под flock /tmp/ai-dvokat-docker-build.lock. Образ не публикуется.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"
MANIFEST=deploy/case-layer/layer-manifest.txt
die() { echo "ОТКАЗ: $*" >&2; exit 1; }
sum() { sha256sum | cut -d' ' -f1; }
have_git() { [ "$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null)" = "$ROOT" ]; }

# Файлы слоя по git: строки манифеста «база голова путь» (база «-» — файла в теге нет).
git_layer() {
  local base_ref=$1 f base n=0
  local -a changed
  git rev-parse --verify -q "$base_ref^{commit}" >/dev/null || die "нет базового тега $base_ref"
  mapfile -t changed < <(git diff --name-only "$base_ref" HEAD)
  for f in "${changed[@]}"; do
    case "$f" in
      backend/open_webui/*.py) ;;
      CUSTOM.md|tests/custom/*|deploy/case-layer/*) continue ;;
      *) die "изменён $f: слоем не доставить, нужна полная сборка образа из тега" ;;
    esac
    if git cat-file -e "$base_ref:$f" 2>/dev/null; then base=$(git show "$base_ref:$f" | sum); else base=-; fi
    echo "$base $(git show "HEAD:$f" | sum) $f"
    n=$((n + 1))
  done
  [ $n -gt 0 ] || die "после $base_ref нет изменений бэкенда — слой не нужен"
}

manifest_text() {   # $1 — базовый тег, stdin — строки git_layer
  echo "# ai-dvokat: файлы слоя 0.13.0-ai9 (deploy/case-layer/build.sh --manifest); руками не править"
  echo "base-ref $1"
  echo "base-commit $(git rev-parse "$1^{commit}")"
  cat
}

if [ "${1:-}" = "--manifest" ]; then
  have_git || die "--manifest: нужна история git форка"
  BASE_REF=${2:-0.13.0-ai8}
  lines=$(git_layer "$BASE_REF")
  manifest_text "$BASE_REF" <<<"$lines" > "$MANIFEST"
  echo "записан $MANIFEST ($(wc -l <<<"$lines") файл(ов) после $BASE_REF) — закоммитить вместе с файлами слоя"
  exit 0
fi

[ -f "$MANIFEST" ] || die "нет $MANIFEST (deploy/case-layer/build.sh --manifest и коммит)"
MANIFEST_REF=$(sed -n 's/^base-ref //p' "$MANIFEST")
BASE_REF=${1:-$MANIFEST_REF}
BASE_IMG=${2:-ghcr.io/78dima/open-webui-legal:0.13.0-ai8}
OUT=${3:-ghcr.io/78dima/open-webui-legal:0.13.0-ai9-rc}
[ "$BASE_REF" = "$MANIFEST_REF" ] || die "базовый тег $BASE_REF, а манифест — от $MANIFEST_REF"
docker image inspect "$BASE_IMG" >/dev/null 2>&1 || die "нет базового образа $BASE_IMG"

entries=$(grep -E '^([0-9a-f]{64}|-) [0-9a-f]{64} backend/open_webui/[^ ]+\.py$' "$MANIFEST" || true)
[ -n "$entries" ] || die "в $MANIFEST нет файлов слоя"
if have_git; then
  MODE=git
  REV=$(git rev-parse HEAD)
  [ "$(git show "HEAD:$MANIFEST" 2>/dev/null)" = "$(cat "$MANIFEST")" ] || die "$MANIFEST изменён и не закоммичен"
  want=$(git_layer "$BASE_REF")
  [ "$(manifest_text "$BASE_REF" <<<"$want")" = "$(cat "$MANIFEST")" ] \
    || die "$MANIFEST устарел против git (deploy/case-layer/build.sh --manifest $BASE_REF и коммит)"
else
  MODE=archive
  REV=${LAYER_REVISION:-unknown}
fi
layer=(); base_sums=(); head_sums=()
while read -r b h f; do layer+=("$f"); base_sums+=("$b"); head_sums+=("$h"); done <<<"$entries"
if [ "$MODE" = git ]; then
  [ -z "$(git status --porcelain -- "${layer[@]}" tests/custom/test_case.py)" ] || die "файлы слоя не закоммичены"
fi
# 1) дерево = HEAD манифеста (с историей — закоммиченные файлы; без неё — архив тега не повреждён и тот самый)
for i in "${!layer[@]}"; do
  [ "$(sum < "${layer[$i]}")" = "${head_sums[$i]}" ] || die "${layer[$i]} в дереве не как в манифесте"
done

echo "слой ($MODE): ${#layer[@]} файл(ов) после $BASE_REF → $REV"
printf '  %s\n' "${layer[@]}"

# 2) базовый образ = базовый тег по этим файлам (новые файлы в базе отсутствуют)
for i in "${!layer[@]}"; do
  f=${layer[$i]}
  in_img=$(docker run --rm --entrypoint sh "$BASE_IMG" -c "sha256sum /app/$f 2>/dev/null | cut -d' ' -f1" || true)
  if [ "${base_sums[$i]}" = - ]; then
    [ -z "$in_img" ] || die "$f уже есть в $BASE_IMG, а в $BASE_REF его нет"
  else
    [ "$in_img" = "${base_sums[$i]}" ] || die "$f в $BASE_IMG не как в $BASE_REF"
  fi
done

ctx=$(mktemp -d)
trap 'rm -rf "$ctx"' EXIT
for f in "${layer[@]}"; do
  install -D -m 0644 "$f" "$ctx/app/$f"
done
{
  echo "# ai-dvokat: слой поверх $BASE_IMG (deploy/case-layer/build.sh, $MODE); файлы бэкенда из $REV"
  echo "FROM $BASE_IMG"
  echo "COPY app/ /app/"
  printf 'RUN python -m compileall -q'
  printf ' /app/%s' "${layer[@]}"
  echo
  echo "LABEL org.opencontainers.image.revision=\"$REV\" ai-dvokat.layer-base=\"$BASE_IMG\" ai-dvokat.layer-base-ref=\"$BASE_REF\" ai-dvokat.layer-manifest=\"$(sum < "$MANIFEST")\""
} > "$ctx/Dockerfile"
docker build -q -t "$OUT" "$ctx" >/dev/null
echo "собран $OUT ($(docker image inspect -f '{{.Id}}' "$OUT" | cut -c8-19))"

# 3) файлы слоя — как HEAD, прочие .py бэкенда — как в базе
for i in "${!layer[@]}"; do
  got=$(docker run --rm --entrypoint sha256sum "$OUT" "/app/${layer[$i]}" | cut -d' ' -f1)
  [ "$got" = "${head_sums[$i]}" ] || die "${layer[$i]} в $OUT не как в HEAD"
done
list='cd /app && find backend/open_webui -name "*.py" -print0 | LC_ALL=C sort -z | xargs -0 sha256sum'
base_list=$(docker run --rm --entrypoint sh "$BASE_IMG" -c "$list")
out_list=$(docker run --rm --entrypoint sh "$OUT" -c "$list")
skip=$(printf '%s\n' "${layer[@]}")
diff <(grep -vFf <(printf '%s\n' "$skip") <<<"$base_list") <(grep -vFf <(printf '%s\n' "$skip") <<<"$out_list") >/dev/null \
  || die "в $OUT изменились файлы бэкенда вне слоя"
echo "прочие .py бэкенда: как в $BASE_IMG ($(wc -l <<<"$base_list") файлов)"

# 4) тест форка на файлах образа
docker run --rm -v "$ROOT/tests/custom/test_case.py:/app/tests/custom/test_case.py:ro" -w /app --entrypoint python "$OUT" \
  -m unittest -q tests/custom/test_case.py
echo "OK $OUT"
