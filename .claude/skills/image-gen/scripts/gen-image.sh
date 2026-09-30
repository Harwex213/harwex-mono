#!/usr/bin/env bash
# Одна картинка через встроенный image_gen у Codex CLI.
#
#   gen-image.sh <out.png> "<что нарисовать>"
#
# Путь вывода — любой: каталог создаётся, Codex получает его как writable root
# (-C), а в промпте ему явно велено сохранить ./<имя>.png. Без явного имени
# Codex оставляет оригинал в $CODEX_HOME/generated_images/, где его никто не найдёт.
#
# Переменные окружения:
#   PRESET=<пресет>      что за картинка (см. case ниже и SKILL.md):
#                        raw (по умолчанию) — промпт как есть, без обвеса
#                        pose — референс позы/жеста для аниматора
#                        hand — крупный план кисти, форма пальцев
#                        asset3d — ортографический кадр под image-to-3D (Tripo), прозрачный фон
#                        texture — бесшовная текстура, вид сверху, без света
#                        concept — концепт-арт окружения
#                        ui — иконка/элемент интерфейса на прозрачном фоне
#   ASPECT=square|landscape|portrait   формат кадра (у пресетов свой по умолчанию)
#   REFS="a.png b.png"   картинки-референсы (стиль, персонаж), уходят в -i.
#                        В промпте они помечаются как референсы, а не цель правки.
#   EDIT=src.png         правка существующей картинки вместо генерации с нуля
#   STYLE="<текст>"      своя строка стиля поверх пресета
#   ALPHA=1|0            требовать прозрачный фон (у asset3d и ui — 1 по умолчанию)
set -euo pipefail

out="${1:?нужен путь вывода, например art/refs/stop.png}"
subject="${2:?нужно описание}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$(dirname "$out")"
dir="$(cd "$(dirname "$out")" && pwd)"
name="$(basename "$out")"
case "$name" in *.png) ;; *) name="$name.png" ;; esac

preset="${PRESET:-raw}"
alpha_default=0
aspect_default=square
body=""

case "$preset" in
  raw) ;;
  pose)
    aspect_default=portrait
    body="PURPOSE: an animation pose reference for a 3D animator. It must show exactly how the body, arms, wrists and every finger are placed, so the pose can be rebuilt bone by bone on a rig.
FRAMING: exactly ONE character, the whole body visible head to toe with a margin, nothing cropped. Camera at chest height, three-quarter front view from the character's right-front side, so the gesturing arm and hand are seen from the side and are NOT foreshortened toward the camera.
READABILITY: the hands are drawn large and clean, every finger individually readable, clear silhouette of the hand against the background, no motion blur, no speed lines, no props unless the description asks for them.
LIGHTING: flat even studio light, plain light-grey seamless background, no scenery.
FORBIDDEN: no text, no labels, no arrows, no multiple views, no duplicate characters, no frame or border." ;;
  hand)
    aspect_default=square
    body="PURPOSE: a close-up reference of a single hand gesture for rigging finger bones. It must show exactly which fingers are extended, which are curled into the palm, where the thumb sits and which way the palm faces.
FRAMING: ONE hand and the forearm up to the elbow, filling most of the frame, seen from a three-quarter angle where no finger hides another. Nothing cropped.
LIGHTING: flat even studio light, plain light-grey seamless background.
FORBIDDEN: no text, no labels, no arrows, no second hand unless asked, no jewellery, no props unless asked." ;;
  asset3d)
    alpha_default=1
    aspect_default=square
    body="PURPOSE: a single 3D game asset reference for image-to-3D reconstruction (Tripo).
FRAMING: exactly ONE subject, centered, fully visible with a margin, nothing touching the image edges. Straight-on front orthographic view, no perspective foreshortening. A character stands in a strict symmetric T-pose with empty hands and limbs clearly separated from the torso.
STYLE: stylized mid-poly real-time game model, clean readable shapes, matte surfaces.
LIGHTING: flat even neutral studio lighting from the front, no dramatic contrast.
FORBIDDEN: no text, no logos, no border, no multiple views, no turnaround sheet, no ground plane, no shadow, no pedestal." ;;
  texture)
    aspect_default=square
    body="PURPOSE: a tileable game texture.
FRAMING: straight top-down orthographic view of the surface only, filling the whole frame edge to edge. SEAMLESS: the left edge continues the right edge and the top continues the bottom.
LIGHTING: completely flat albedo, no baked shadows, no highlights, no vignette, no perspective.
FORBIDDEN: no objects on top, no text, no border, no frame." ;;
  concept)
    aspect_default=landscape
    body="PURPOSE: environment concept art for a stylized 3D game, used as a composition and colour target.
FORBIDDEN: no text, no logos, no UI, no border, no watermark." ;;
  ui)
    alpha_default=1
    aspect_default=square
    body="PURPOSE: a game UI element or icon.
FRAMING: ONE centered element with a margin, bold readable silhouette at small size.
FORBIDDEN: no text or letters unless the description asks for them, no border, no mockup around it." ;;
  *) echo "неизвестный PRESET: $preset" >&2; exit 1 ;;
esac

case "${ASPECT:-$aspect_default}" in
  square) aspect_text="Square 1:1 image." ;;
  landscape) aspect_text="Landscape 3:2 image." ;;
  portrait) aspect_text="Portrait 2:3 image." ;;
  *) echo "неизвестный ASPECT: $ASPECT" >&2; exit 1 ;;
esac

alpha="${ALPHA:-$alpha_default}"
alpha_text=""
if [ "$alpha" = "1" ]; then
  alpha_text="BACKGROUND: 100 percent empty and fully transparent, real alpha channel (RGBA). No background glow, no halo, no vignette, no gradient, no cast shadow, no ground."
fi

style_text=""
if [ -n "${STYLE:-}" ]; then style_text="STYLE: ${STYLE}"; fi

img_args=()
refs_text=""
if [ -n "${EDIT:-}" ]; then
  img_args+=(-i "$EDIT")
  verb="Edit the FIRST attached image"
else
  verb="Generate an image"
fi
if [ -n "${REFS:-}" ]; then
  for r in $REFS; do img_args+=(-i "$r"); done
  # Не через $(... && ...): под set -e упавшая подстановка в присваивании молча
  # роняет весь скрипт, без единой строки вывода.
  which_refs="the attached image(s)"
  if [ -n "${EDIT:-}" ]; then which_refs="the attached images after the first"; fi
  refs_text="REFERENCES: ${which_refs} are references for character design, proportions and style only. Do NOT copy their pose, camera or background."
fi

prompt="${verb}. Requirements, all mandatory:

${body}
${aspect_text}
${alpha_text}
${style_text}
${refs_text}

SUBJECT: ${subject}

Save the result to ./${name} in the current directory. Use your built-in image generation tool - do not write any code, do not draw it programmatically."

echo "→ $dir/$name (preset=$preset alpha=$alpha)"
# Промпт — через stdin, а не аргументом: -i у codex exec жадный (<FILE>...) и
# съедает промпт, стоящий после него, как ещё одну картинку.
printf '%s' "$prompt" | codex exec -C "$dir" --sandbox workspace-write --skip-git-repo-check "${img_args[@]}" - 2>&1 | tail -2

if [ ! -f "$dir/$name" ]; then
  echo "ПРОБЛЕМА  файла нет: $dir/$name (оригинал может лежать в \$CODEX_HOME/generated_images/)" >&2
  exit 1
fi
if [ "$alpha" = "1" ]; then
  node "$here/check-alpha.mjs" "$dir/$name"
else
  node -e "const b=require('fs').readFileSync(process.argv[1]);console.log('ок  '+process.argv[1]+'  '+b.readUInt32BE(16)+'x'+b.readUInt32BE(20))" "$dir/$name"
fi
