"""Finds the lit windows in the skyline crop and writes an ID map for the city animation.

Every lit window is one 4-connected blob of bright pixels; its soft halo joins it by a dilation.
Output PNG (same size as the crop, lossless):
  R, G  window ID as a 16-bit number, 0 = no window
  B     class: 255 = a small window that may switch off, 128 = a big lit facade that stays on
Run after scripts/build-skyline.py: python3 scripts/build-window-ids.py
"""
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "src/assets/background-city-skyline.jpg"
SKY_MASK = ROOT / "src/assets/background-city-sky-mask.png"
OUTPUT = ROOT / "src/assets/background-city-windows.png"

CORE_LUMA = 95
HALO_LUMA = 45
# Bigger blobs are lit facades and spires; switching those off would look broken.
MAX_WINDOW_AREA = 70

rgb = np.asarray(Image.open(SOURCE).convert("RGB")).astype(np.float32)
luma = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
height, width = luma.shape
# Stars are bright blobs too; the sky mask (scripts/build-skyline.py) leaves them out.
sky = np.asarray(Image.open(SKY_MASK)).astype(np.float32) > 64
core = (luma > CORE_LUMA) & ~sky
labels = np.zeros((height, width), dtype=np.int32)
areas = [0]

next_label = 1
for y0, x0 in zip(*np.nonzero(core)):
    if labels[y0, x0]:
        continue
    labels[y0, x0] = next_label
    queue = deque([(y0, x0)])
    area = 0
    while queue:
        y, x = queue.popleft()
        area += 1
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < height and 0 <= nx < width and core[ny, nx] and not labels[ny, nx]:
                labels[ny, nx] = next_label
                queue.append((ny, nx))
    areas.append(area)
    next_label += 1

# Halo: dim pixels next to a window take its label, two rings out.
halo = luma > HALO_LUMA
for _ in range(2):
    grown = labels.copy()
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        shifted = np.roll(np.roll(labels, dy, axis=0), dx, axis=1)
        take = (grown == 0) & halo & (shifted > 0)
        grown[take] = shifted[take]
    labels = grown

areas = np.array(areas)
# Shuffle IDs so neighbouring windows get unrelated seeds.
rng = np.random.default_rng(7)
permutation = np.concatenate([[0], rng.permutation(np.arange(1, next_label)) % 65535 + 1])
ids = permutation[labels]
klass = np.where(labels == 0, 0, np.where(areas[labels] <= MAX_WINDOW_AREA, 255, 128))

out = np.zeros((height, width, 3), dtype=np.uint8)
out[..., 0] = ids >> 8
out[..., 1] = ids & 255
out[..., 2] = klass
Image.fromarray(out, "RGB").save(OUTPUT, optimize=True)
small = int((areas[1:] <= MAX_WINDOW_AREA).sum())
print(f"{next_label - 1} blobs, {small} switchable windows -> {OUTPUT.relative_to(ROOT)}")
