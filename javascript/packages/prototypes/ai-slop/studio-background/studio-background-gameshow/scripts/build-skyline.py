"""Cuts the city with its own sky out of assets/background-city-sky.png.

Outputs:
- src/assets/background-city-skyline.jpg: rows from the top down to the lit waterfront. The dark
  pier strip under it is left out; the water plate starts below that strip.
- src/assets/background-city-sky-mask.png: white where the pixel is sky. The shader lets only
  those pixels drift, so the towers and their glow stay put.

The sky is the area connected to the top edge whose colour stays close to the sky colour of its
row. That colour is measured on rows where the older photo (black sky, same layout) shows sky.
Run: python3 scripts/build-skyline.py
"""
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets/background-city-sky.png"
LAYOUT = ROOT / "assets/background-city.png"
SKYLINE_OUT = ROOT / "src/assets/background-city-skyline.jpg"
MASK_OUT = ROOT / "src/assets/background-city-sky-mask.png"

# Last bright waterfront row + 1; rows 978-995 are the pier and its shadow.
CITY_END = 978
# Rows of the older photo that are sky there are dark.
LAYOUT_SKY_LUMA = 10.0

photo = np.asarray(Image.open(SOURCE).convert("RGB")).astype(np.float32)[:CITY_END]
layout = np.asarray(Image.open(LAYOUT).convert("L")).astype(np.float32)[:CITY_END]
height, width, _ = photo.shape

# Sky colour per row, smoothed; rows with too few sky samples keep the last good colour.
sky_color = np.zeros((height, 3), dtype=np.float32)
last = photo[0].mean(axis=0)
for y in range(height):
    samples = photo[y][layout[y] < LAYOUT_SKY_LUMA]
    if len(samples) > width * 0.3:
        last = np.median(samples, axis=0)
    sky_color[y] = last
kernel = np.ones(15, dtype=np.float32) / 15
for c in range(3):
    sky_color[:, c] = np.convolve(np.pad(sky_color[:, c], 7, mode="edge"), kernel, mode="valid")

distance = np.linalg.norm(photo - sky_color[:, None, :], axis=2)
tolerance = 12.0 + 0.35 * sky_color.mean(axis=1, keepdims=True)
allowed = distance < tolerance

sky = np.zeros_like(allowed)
queue = deque((0, x) for x in range(width) if allowed[0, x])
for y, x in queue:
    sky[y, x] = True
while queue:
    y, x = queue.popleft()
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        ny, nx = y + dy, (x + dx) % width
        if 0 <= ny < height and allowed[ny, nx] and not sky[ny, nx]:
            sky[ny, nx] = True
            queue.append((ny, nx))

soft = sky.astype(np.float32)
for _ in range(2):
    soft = (soft + np.roll(soft, 1, 0) + np.roll(soft, -1, 0) + np.roll(soft, 1, 1) + np.roll(soft, -1, 1)) / 5.0

Image.fromarray(photo.clip(0, 255).astype(np.uint8)).save(SKYLINE_OUT, quality=92)
Image.fromarray((soft * 255 + 0.5).astype(np.uint8), "L").save(MASK_OUT, optimize=True)
print(f"{width}x{height}, sky {sky.mean():.0%} -> {SKYLINE_OUT.relative_to(ROOT)}, {MASK_OUT.relative_to(ROOT)}")
