"""Builds the casino panorama (src/scene/casinoPanorama.ts) from three generated photos.

Sources (assets/):
- casino-panorama-center.png: the hall, 1536 x 1024, camera level, horizon near the middle row;
- casino-panorama-left.png: an outpainting whose right half is the left half of the center photo;
- casino-panorama-right.png: an outpainting whose left half is the right half of the center photo.

Outputs (src/assets/):
- casino-panorama.jpg: 3072 x 1024. The left half of the left photo, the center photo, the right half of the
  right photo. Each seam cross-fades over BLEND pixels inside the shared halves.
- casino-panorama-fx.png: 1536 x 512 effect mask for the shader.
  R = crystal of the chandeliers: bright points above the horizon that stand out from their surroundings. G = warm lamps and candles: bright pixels with a warm hue. B = slot machine screens:
  bright saturated blue, violet, cyan or magenta pixels below the horizon.

Run: python3 scripts/build-casino-panorama.py
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
OUT = ROOT / "src/assets"
WIDTH = 1536
HEIGHT = 1024
HALF = WIDTH // 2
BLEND = 160
# The horizon row of the center photo (the vanishing point of the hall), from the top.
HORIZON_ROW = 540


def load(name: str) -> np.ndarray:
    image = Image.open(ASSETS / name).convert("RGB")
    if image.size != (WIDTH, HEIGHT):
        image = image.resize((WIDTH, HEIGHT), Image.LANCZOS)
    return np.asarray(image).astype(np.float32) / 255.0


def stitch() -> np.ndarray:
    left = load("casino-panorama-left.png")
    center = load("casino-panorama-center.png")
    right = load("casino-panorama-right.png")
    panorama = np.zeros((HEIGHT, WIDTH * 2, 3), dtype=np.float32)
    panorama[:, :HALF] = left[:, :HALF]
    panorama[:, HALF:HALF + WIDTH] = center
    panorama[:, HALF + WIDTH:] = right[:, HALF:]
    # Cross-fades inside the shared halves: the outpainted half runs on into the center photo, or out of it.
    ramp = np.linspace(0.0, 1.0, BLEND, dtype=np.float32)[None, :, None]
    panorama[:, HALF:HALF + BLEND] = left[:, HALF:HALF + BLEND] * (1 - ramp) + center[:, :BLEND] * ramp
    start = WIDTH - BLEND
    panorama[:, HALF + start:HALF + WIDTH] = center[:, start:] * (1 - ramp) + right[:, HALF - BLEND:HALF] * ramp
    return panorama


def masks(photo: np.ndarray) -> np.ndarray:
    height, width, _ = photo.shape
    r, g, b = photo[..., 0], photo[..., 1], photo[..., 2]
    luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    top = np.max(photo, axis=2)
    saturation = (top - np.min(photo, axis=2)) / np.maximum(top, 1e-4)
    rows = np.arange(height, dtype=np.float32)[:, None] / height
    horizon = HORIZON_ROW / HEIGHT
    # Local contrast: the pixel against a blurred copy of the luma.
    blurred = np.asarray(Image.fromarray((luma * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6))).astype(np.float32) / 255.0
    contrast = np.clip((luma - blurred) * 6.0, 0.0, 1.0)

    # Crystal sparkles: small bright points that stand out from their surroundings, above the horizon.
    crystal = np.clip((luma - 0.45) * 4.0, 0, 1) * np.clip((contrast - 0.25) * 2.5, 0, 1) * np.clip((0.75 - saturation) * 4.0, 0, 1)
    crystal = crystal * (rows < horizon + 0.02)
    # Lamps and candles: bright warm glows that are not crystal.
    lamps = np.clip((luma - 0.45) * 3.0, 0, 1) * np.clip((r - b) * 4.0, 0, 1) * np.clip((saturation - 0.25) * 4.0, 0, 1)
    lamps = lamps * (1.0 - crystal)
    screens = np.clip((top - 0.35) * 3.0, 0, 1) * np.clip((saturation - 0.35) * 3.0, 0, 1)
    screens *= np.clip((b - r * 0.8) * 5.0, 0, 1) + np.clip((b + g * 0.5 - r) * 3.0, 0, 1) * 0.5
    screens = np.clip(screens, 0, 1) * (rows > horizon - 0.02)

    channels = []
    for channel in (crystal, lamps, screens):
        image = Image.fromarray((np.clip(channel, 0, 1) * 255).astype(np.uint8))
        image = image.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
        channels.append(image.resize((width // 2, height // 2), Image.BILINEAR))
    return Image.merge("RGB", channels)


def main() -> None:
    panorama = stitch()
    Image.fromarray((np.clip(panorama, 0, 1) * 255 + 0.5).astype(np.uint8)).save(OUT / "casino-panorama.jpg", quality=92)
    masks(panorama).save(OUT / "casino-panorama-fx.png")
    print("panorama", panorama.shape[1], "x", panorama.shape[0], "horizon from bottom", round(1 - HORIZON_ROW / HEIGHT, 4))


if __name__ == "__main__":
    main()
