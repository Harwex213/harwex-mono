"""Cuts the water out of assets/background-city-sky.png for the water band.

The water starts below the dark pier strip and its shadow (rows 978-995); the city crop
(scripts/build-skyline.py) ends above that strip. The plate gets seamless left and right edges:
the shader tiles it around the horizon.
Run: python3 scripts/build-water.py
"""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets/background-city-sky.png"
WATER_OUT = ROOT / "src/assets/background-water.jpg"

WATER_START = 996
SEAM_BLEND = 0.08


def seamless(image):
    """Cross-fades the right edge into the left one so that the plate tiles horizontally."""
    width = image.shape[1]
    blend = int(width * SEAM_BLEND)
    core = image[:, : width - blend].copy()
    tail = image[:, width - blend :]
    ramp = np.linspace(0.0, 1.0, blend, dtype=np.float32)[None, :, None]
    core[:, :blend] = tail * (1.0 - ramp) + core[:, :blend] * ramp
    return core


photo = np.asarray(Image.open(SOURCE).convert("RGB")).astype(np.float32) / 255.0
tile = seamless(photo[WATER_START:])
Image.fromarray((np.clip(tile, 0, 1) * 255 + 0.5).astype(np.uint8)).save(WATER_OUT, quality=90)
print(f"{WATER_OUT.relative_to(ROOT)}: {tile.shape[1]}x{tile.shape[0]}")
