"""Turns the spec's building art into the sprites in `src/assets/buildings/`.

The art in `docs/human/01-first-look/01-first-look-images/` is 1254px and was
exported with its backdrop baked in: most files carry the transparency
checkerboard, `image-12` a flat black plate. This keys the backdrop out and
scales the result down to 256px.

Run from the package root: `python3 scripts/prepare-assets.py`.
"""

from PIL import Image
import numpy as np
from collections import deque

SRC = "docs/human/01-first-look/01-first-look-images"
OUT = "src/assets/buildings"
SIZE = 256
# The art was exported with its backdrop baked in: some files carry the
# transparency checkerboard, some a flat black plate. Both are neutral, so the
# mask is "neutral and at the far end of the ramp", grown from the frame.
NEUTRAL_SPREAD = 14
CHECKER_MIN_LUMA = 195
PLATE_MAX_LUMA = 24

def flood_from_border(candidate):
    h, w = candidate.shape
    filled = np.zeros((h, w), dtype=bool)
    stack = deque()
    for x in range(w):
        stack.append((x, 0))
        stack.append((x, h - 1))
    for y in range(h):
        stack.append((0, y))
        stack.append((w - 1, y))

    while stack:
        x, y = stack.pop()
        if not candidate[y, x] or filled[y, x]:
            continue
        left = x
        while left > 0 and candidate[y, left - 1] and not filled[y, left - 1]:
            left -= 1
        right = x
        while right < w - 1 and candidate[y, right + 1] and not filled[y, right + 1]:
            right += 1
        filled[y, left:right + 1] = True
        for ny in (y - 1, y + 1):
            if ny < 0 or ny >= h:
                continue
            row = candidate[ny]
            done = filled[ny]
            span = False
            for nx in range(left, right + 1):
                if row[nx] and not done[nx]:
                    if not span:
                        stack.append((nx, ny))
                        span = True
                else:
                    span = False
    return filled

pairs = [
    ("01-first-look-image-8.png", "farm.png"),
    ("01-first-look-image-9.png", "mine.png"),
    ("01-first-look-image-10.png", "sawmill.png"),
    ("01-first-look-image-11.png", "village.png"),
    ("01-first-look-image-12.png", "masons-guild.png"),
    ("01-first-look-image-13.png", "observatory.png"),
    ("01-first-look-image-14.png", "university.png"),
]

for src_name, out_name in pairs:
    im = Image.open(f"{SRC}/{src_name}").convert("RGBA")
    arr = np.array(im)
    rgb = arr[..., :3].astype(np.int16)
    spread = rgb.max(axis=2) - rgb.min(axis=2)
    luma = rgb.mean(axis=2)
    neutral = spread <= NEUTRAL_SPREAD

    border_luma = np.concatenate([luma[0], luma[-1], luma[:, 0], luma[:, -1]])
    kind = "checker" if np.median(border_luma) > 128 else "plate"
    candidate = neutral & (luma >= CHECKER_MIN_LUMA if kind == "checker" else luma <= PLATE_MAX_LUMA)

    filled = flood_from_border(candidate)
    arr[..., 3] = np.where(filled, 0, 255)
    keyed = Image.fromarray(arr, mode="RGBA")
    # Premultiplied resize, or the keyed-out backdrop bleeds back into the edges.
    small = keyed.convert("RGBa").resize((SIZE, SIZE), Image.LANCZOS).convert("RGBA")
    small.save(f"{OUT}/{out_name}", optimize=True)
    print(f"{out_name}: {kind}, background {filled.mean() * 100:.1f}%")
