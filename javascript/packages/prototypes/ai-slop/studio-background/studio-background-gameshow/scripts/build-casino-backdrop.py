"""Splits the casino photo (src/assets/casino-hall-photo.png, 650 x 365) into depth layers.

The backdrop (src/scene/casinoBackdrop.ts) projects the photo from a virtual projector onto proxy
geometry: a room shell and a few cut-out cards at their own depths. This script prepares the
textures for that, at twice the photo resolution:

- casino-hall.jpg: the photo, upscaled with Lanczos and lightly sharpened. The cards show it.
- casino-hall-plate.jpg: the photo with every card subject removed and the holes filled
  (push-pull inpainting). The room shell shows it, so a card that slides sideways under parallax
  uncovers a plausible background instead of a copy of itself.
- casino-hall-cut-a.png: card coverage. R = near furniture, G = mid chairs,
  B = right table group + small chandelier.
- casino-hall-cut-b.png: R = columns + left and big chandeliers, G = curtains (sway mask).
- casino-hall-fx.png: R = crystal sparkle, G = lamps and sconces, B = slot machine screens.

The polygons are in photo pixels (650 x 365) and follow the subjects by eye. Chandeliers get a
difference matte against the plate inside their polygon, so the crystal stays see-through.
Run: python3 scripts/build-casino-backdrop.py
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "src/assets"
SOURCE = ASSETS / "casino-hall-photo.png"
SCALE = 2
SUPERSAMPLE = 4

FAR_FURNITURE_LEFT = [
    (0, 220), (22, 219), (60, 219), (96, 220), (103, 228), (106, 240), (112, 236), (118, 228),
    (128, 223), (142, 221), (156, 224), (164, 232), (168, 233), (176, 226), (190, 221), (206, 219),
    (222, 220), (232, 226), (234, 238), (229, 260), (228, 300), (232, 300), (240, 282), (252, 270),
    (272, 263), (300, 261), (326, 265), (348, 274), (366, 286), (382, 302), (392, 322), (398, 345),
    (400, 365), (0, 365),
]
NEAR_FURNITURE_RIGHT = [
    (518, 365), (512, 340), (500, 315), (490, 290), (487, 262), (492, 248), (505, 243), (530, 239),
    (550, 240), (570, 248), (588, 262), (598, 250), (602, 226), (612, 216), (626, 216), (638, 222),
    (642, 236), (634, 262), (630, 300), (632, 330), (650, 328), (650, 365),
]
MID_CHAIRS = [
    (368, 232), (372, 222), (385, 218), (398, 220), (405, 227), (420, 228), (447, 229), (452, 222),
    (462, 218), (478, 220), (492, 221), (500, 228), (500, 262), (492, 300), (488, 320), (445, 322),
    (440, 302), (420, 305), (400, 305), (372, 302), (366, 275),
]
RIGHT_TABLE = [
    (465, 232), (470, 218), (482, 213), (505, 212), (530, 209), (556, 211), (572, 214), (590, 213),
    (604, 216), (604, 262), (465, 262),
]
COLUMN_CENTRE = [
    (270, 0), (332, 0), (334, 18), (328, 30), (322, 34), (322, 244), (286, 244), (287, 34),
    (280, 30), (268, 20),
]
COLUMN_RIGHT = [
    (394, 82), (434, 82), (433, 96), (428, 102), (428, 229), (401, 229), (401, 102), (396, 96),
]
CHANDELIER_LEFT = [
    (164, 0), (179, 0), (179, 18), (198, 26), (214, 38), (216, 52), (209, 60), (211, 74), (201, 91),
    (182, 103), (165, 106), (148, 98), (132, 85), (124, 70), (118, 55), (117, 38), (124, 28),
    (144, 21), (161, 17),
]
CHANDELIER_BIG = [
    (468, 10), (494, 0), (562, 0), (572, 10), (571, 26), (561, 40), (566, 55), (556, 71), (536, 83),
    (510, 86), (488, 81), (471, 68), (462, 55), (460, 40), (458, 28),
]
CHANDELIER_SMALL = [
    (507, 92), (517, 83), (540, 77), (566, 77), (583, 82), (586, 95), (579, 113), (561, 126),
    (535, 128), (519, 119), (511, 106),
]
# The far chandelier in the doorway stays in the room shell; it only sparkles.
CHANDELIER_DOORWAY = [(328, 98), (390, 98), (390, 146), (328, 146)]
CURTAIN_BOX = (436, 118, 650, 232)
SLOT_BOX = (136, 175, 252, 220)


def polygon_mask(size, polygons, feather=1.0):
    """Antialiased coverage of the polygons at the output scale, 0..1."""
    width, height = size
    k = SCALE * SUPERSAMPLE
    canvas = Image.new("L", (width * SUPERSAMPLE, height * SUPERSAMPLE), 0)
    draw = ImageDraw.Draw(canvas)
    for polygon in polygons:
        draw.polygon([(x * k, y * k) for x, y in polygon], fill=255)
    mask = canvas.resize(size, Image.BOX)
    if feather > 0:
        mask = mask.filter(ImageFilter.GaussianBlur(feather))
    return np.asarray(mask).astype(np.float32) / 255.0


def box_mask(size, box):
    x0, y0, x1, y1 = box
    return polygon_mask(size, [[(x0, y0), (x1, y0), (x1, y1), (x0, y1)]], feather=0)


def blur(image, radius):
    """Separable Gaussian blur of a float image (2D or 3D), edges clamped."""
    reach = max(1, int(radius * 3))
    taps = np.exp(-0.5 * (np.arange(-reach, reach + 1) / radius) ** 2)
    taps /= taps.sum()
    out = image.astype(np.float32)
    for axis in (0, 1):
        pad = [(0, 0)] * out.ndim
        pad[axis] = (reach, reach)
        padded = np.pad(out, pad, mode="edge")
        acc = np.zeros_like(out)
        for i, weight in enumerate(taps):
            acc += weight * np.take(padded, np.arange(i, i + out.shape[axis]), axis=axis)
        out = acc
    return out


def dilate(mask, radius):
    image = Image.fromarray((mask * 255).astype(np.uint8))
    return np.asarray(image.filter(ImageFilter.MaxFilter(radius * 2 + 1))).astype(np.float32) / 255.0


def downsample(values, weights):
    h, w = weights.shape
    h2, w2 = (h + 1) // 2, (w + 1) // 2
    pad_h, pad_w = h2 * 2 - h, w2 * 2 - w
    v = np.pad(values * weights[..., None], ((0, pad_h), (0, pad_w), (0, 0)))
    wt = np.pad(weights, ((0, pad_h), (0, pad_w)))
    v = v.reshape(h2, 2, w2, 2, -1).sum(axis=(1, 3))
    wt = wt.reshape(h2, 2, w2, 2).sum(axis=(1, 3))
    return np.where(wt[..., None] > 0, v / np.maximum(wt[..., None], 1e-6), 0.0), wt / 4.0


def upsample(values, shape):
    image = [Image.fromarray(values[..., c].astype(np.float32), mode="F") for c in range(values.shape[2])]
    return np.stack([np.asarray(p.resize((shape[1], shape[0]), Image.BILINEAR)) for p in image], axis=-1)


def push_pull(values, known):
    """Fills the pixels where known == 0 from their surroundings, coarse to fine."""
    levels = [(values, known)]
    while min(levels[-1][1].shape) > 2:
        levels.append(downsample(*levels[-1]))
    filled = levels[-1][0]
    for v, w in reversed(levels[:-1]):
        coarse = upsample(filled, w.shape)
        trust = np.clip(w * 2.0, 0.0, 1.0)[..., None]
        filled = v * trust + coarse * (1.0 - trust)
    return filled


def reflect(k, length):
    """Index k steps away from an edge, bouncing back and forth inside a run of the given length."""
    k %= 2 * length
    return k if k < length else 2 * length - 1 - k


def mirror_rows(image, hole, fallback):
    """Fills each horizontal run of the hole with the pixels mirrored from both of its ends.

    The known run next to each end is reflected back and forth, so a wide hole gets the texture of
    its row instead of a smooth smear. The rows suit this room: a row of the floor lies at one
    depth, and the wall behind a column has horizontal mouldings. A strip that a card uncovers under
    parallax then looks like the room.
    """
    out = fallback.copy()
    height, width = hole.shape
    for y in range(height):
        row = hole[y]
        runs = []
        x = 0
        while x < width:
            start = x
            filled = row[x]
            while x < width and row[x] == filled:
                x += 1
            runs.append((start, x, bool(filled)))
        for index, (start, end, filled) in enumerate(runs):
            if not filled:
                continue
            left_run = runs[index - 1] if index > 0 else None
            right_run = runs[index + 1] if index + 1 < len(runs) else None
            span = end - start
            for i in range(start, end):
                left = None
                right = None
                if left_run:
                    length = left_run[1] - left_run[0]
                    left = image[y, start - 1 - reflect(i - start, length)]
                if right_run:
                    length = right_run[1] - right_run[0]
                    right = image[y, end + reflect(end - 1 - i, length)]
                if left is None and right is None:
                    continue
                if left is None:
                    out[y, i] = right
                elif right is None:
                    out[y, i] = left
                else:
                    t = (i - start + 0.5) / span
                    w = t * t * (3.0 - 2.0 * t)
                    out[y, i] = left * (1.0 - w) + right * w
    return out


# The room model of src/scene/casinoBackdrop.ts, in photo pixels and photo metres.
FOCAL = 500.0
CENTER_U = 325.0
CENTER_V = 182.5
EYE = 1.5
CEILING = 6.5
# The panelled left wall runs at an angle: x = LEFT_WALL_X + LEFT_WALL_SLOPE * depth.
LEFT_WALL_X = -3.952
LEFT_WALL_SLOPE = 0.148
BACK_WALL = 17.0
FLOOR, LEFT, OTHER = 0, 1, 2


def surface_of(u, v):
    """Which room surface photo pixel (u, v) shows, and its depth (vectorised)."""
    rx = (u - CENTER_U) / FOCAL
    ry = -(v - CENTER_V) / FOCAL
    big = np.full(np.broadcast(u, v).shape, 1e9)
    floor = np.where(ry < 0, EYE / np.maximum(-ry, 1e-9), big)
    ceiling = np.where(ry > 0, (CEILING - EYE) / np.maximum(ry, 1e-9), big)
    left = np.where(rx < LEFT_WALL_SLOPE, -LEFT_WALL_X / np.maximum(LEFT_WALL_SLOPE - rx, 1e-9), big)
    depth = np.minimum.reduce([floor, ceiling, left, np.full_like(big, BACK_WALL)])
    kind = np.where(depth == floor, FLOOR, np.where(depth == left, LEFT, OTHER))
    return kind, depth


def clone_floor(image, hole, out):
    """Fills floor holes with the floor a fixed distance to the side, in perspective.

    The shift is in metres on the floor, so the copied carpet and marble keep the right size and
    direction for their depth. Neighbouring pixels pick the same shift, so the copies come in
    coherent patches. Returns the filled image and the mask of the pixels it filled.
    """
    height, width = hole.shape
    ys, xs = np.nonzero(hole)
    u = (xs + 0.5) / SCALE
    v = (ys + 0.5) / SCALE
    kind, depth = surface_of(u, v)
    done = np.zeros(len(xs), dtype=bool)
    # Nearest shifts first, both directions, in 0.6 m steps up to 12 m.
    shifts = [sign * 0.6 * k for k in range(2, 21) for sign in (1, -1)]
    for shift in shifts:
        todo = (~done) & (kind == FLOOR)
        if not todo.any():
            break
        x_metres = (u - CENTER_U) / FOCAL * depth + shift
        sx = np.floor((CENTER_U + x_metres / depth * FOCAL) * SCALE).astype(int)
        sy = ys
        inside = (sx >= 0) & (sx < width)
        sxc = np.clip(sx, 0, width - 1)
        source_kind, _ = surface_of((sxc + 0.5) / SCALE, (sy + 0.5) / SCALE)
        valid = todo & inside & ~hole[sy, sxc] & (source_kind == FLOOR)
        out[ys[valid], xs[valid]] = image[sy[valid], sxc[valid]]
        done |= valid
    filled = np.zeros_like(hole)
    filled[ys[done], xs[done]] = True
    return out, filled


def clone_left_wall(image, hole, out):
    """Fills the hidden low part of the left wall with the same wall higher up, in perspective.

    A point on the wall keeps its depth, so the copy is a vertical shift of shift * FOCAL / depth
    pixels. Sources stay above the slot machines, and the copy is darkened: the bottom of the
    panelling sits in the shadow of the tables.
    """
    height, width = hole.shape
    ys, xs = np.nonzero(hole)
    u = (xs + 0.5) / SCALE
    v = (ys + 0.5) / SCALE
    kind, depth = surface_of(u, v)
    todo = (kind == LEFT) & (v > CENTER_V)
    done = np.zeros(len(xs), dtype=bool)
    for shift in [1.2, 1.6, 2.0, 2.4, 2.8, 3.2]:
        pending = todo & ~done
        if not pending.any():
            break
        sv = v - shift * FOCAL / depth
        sy = np.floor(sv * SCALE).astype(int)
        inside = (sy >= 0) & (sy < height)
        syc = np.clip(sy, 0, height - 1)
        source_kind, _ = surface_of(u, (syc + 0.5) / SCALE)
        valid = pending & inside & ~hole[syc, xs] & (source_kind == LEFT) & (sv < SLOT_BOX[1] - 10)
        out[ys[valid], xs[valid]] = image[syc[valid], xs[valid]] * 0.6
        done |= valid
    filled = np.zeros_like(hole)
    filled[ys[done], xs[done]] = True
    return out, filled


def lum(rgb):
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def save_rgb(path, channels):
    data = np.stack(channels, axis=-1)
    Image.fromarray((np.clip(data, 0.0, 1.0) * 255 + 0.5).astype(np.uint8)).save(path)


def main():
    source = Image.open(SOURCE).convert("RGB")
    size = (source.width * SCALE, source.height * SCALE)
    photo_image = source.resize(size, Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1.6, percent=45, threshold=2))
    photo_image.save(ASSETS / "casino-hall.jpg", quality=92)
    photo = np.asarray(photo_image).astype(np.float32) / 255.0

    near = polygon_mask(size, [FAR_FURNITURE_LEFT, NEAR_FURNITURE_RIGHT])
    mid = polygon_mask(size, [MID_CHAIRS])
    right_table = polygon_mask(size, [RIGHT_TABLE])
    columns = polygon_mask(size, [COLUMN_CENTRE, COLUMN_RIGHT])
    chandelier_shapes = polygon_mask(size, [CHANDELIER_LEFT, CHANDELIER_BIG], feather=1.5)
    small_shape = polygon_mask(size, [CHANDELIER_SMALL], feather=1.5)

    # Plate: everything a card shows is cut out and filled from the surroundings.
    holes = np.maximum.reduce([near, mid, right_table, columns, chandelier_shapes, small_shape])
    holes = dilate((holes > 0.02).astype(np.float32), 3)
    known = 1.0 - holes
    smooth = push_pull(photo, known)
    hole = holes > 0.5
    # Back wall, ceiling, doorway: each row takes the texture of its own row from both sides.
    plate = mirror_rows(photo, hole, smooth)
    # The low part of the left wall is hidden everywhere: panelling from higher up, else a smooth fill.
    pixel_y, pixel_x = np.mgrid[0 : size[1], 0 : size[0]]
    kind, _ = surface_of((pixel_x + 0.5) / SCALE, (pixel_y + 0.5) / SCALE)
    low_wall = (kind == LEFT) & (pixel_y / SCALE > CENTER_V)
    plate[low_wall] = smooth[low_wall] * 0.6
    plate, _ = clone_left_wall(photo, hole, plate)
    # The floor: a shifted copy of the floor reads better than a mirror.
    # Floor pixels with no visible floor at any shift keep the row mirror.
    plate, _ = clone_floor(photo, hole, plate)
    # A soft grain keeps the filled areas from reading as flat paint.
    rng = np.random.default_rng(7)
    grain = blur(rng.normal(0.0, 0.035, photo.shape[:2]).astype(np.float32), 1.2)[..., None]
    plate = photo * known[..., None] + np.clip(plate * (1.0 + grain), 0.0, 1.0) * holes[..., None]
    Image.fromarray((np.clip(plate, 0, 1) * 255 + 0.5).astype(np.uint8)).save(ASSETS / "casino-hall-plate.jpg", quality=92)

    # Chandeliers: see-through crystal. Coverage grows with the difference from the plate.
    difference = np.abs(photo - plate).max(axis=-1)
    matte = np.clip((difference - 0.03) / 0.16, 0.0, 1.0)
    matte = np.maximum(matte, blur(matte, 1.5) * 0.9)
    # The crystal basket is dense: solid coverage below the arms, the matte above.
    rows = np.arange(size[1])[:, None] / SCALE
    basket = (rows > 50) * polygon_mask(size, [CHANDELIER_LEFT]) + (rows > 40) * polygon_mask(size, [CHANDELIER_BIG])
    basket = blur(dilate(1.0 - basket, 4) * -1.0 + 1.0, 1.5) * 0.9
    small_basket = blur(dilate(1.0 - (rows > 95) * small_shape, 4) * -1.0 + 1.0, 1.5) * 0.9
    chandeliers = np.maximum(chandelier_shapes * matte, basket)
    small = np.maximum(small_shape * matte, small_basket)

    curtains_box = box_mask(size, CURTAIN_BOX)
    redness = photo[..., 0] - np.maximum(photo[..., 1], photo[..., 2])
    curtains = curtains_box * np.clip((redness - 0.08) / 0.12, 0.0, 1.0)
    curtains = blur(curtains, 1.5)

    save_rgb(ASSETS / "casino-hall-cut-a.png", [near, mid, np.maximum(right_table, small)])
    save_rgb(ASSETS / "casino-hall-cut-b.png", [np.maximum(columns, chandeliers), curtains, np.zeros_like(near)])

    # Sparkle: crystal points brighter than their surroundings inside the chandeliers.
    luma = lum(photo)
    detail = luma - blur(luma, 2.5)
    crystal = polygon_mask(size, [CHANDELIER_LEFT, CHANDELIER_BIG, CHANDELIER_SMALL, CHANDELIER_DOORWAY], feather=2.0)
    sparkle = crystal * np.clip((detail - 0.02) / 0.08, 0.0, 1.0)

    # Lamps: the brightest, warm-to-white pixels: chandelier shades, sconces, candles.
    # Rows below the lamps hold only gilded furniture: no flicker there.
    lamps = np.clip((luma - 0.68) / 0.2, 0.0, 1.0)
    lamps *= 1.0 - box_mask(size, (0, 214, 650, 365))
    lamps = np.maximum(lamps, blur(lamps, 2.0) * 0.8)

    # Slot screens: lit, coloured pixels on the machine fronts.
    saturation = photo.max(axis=-1) - photo.min(axis=-1)
    slots = box_mask(size, SLOT_BOX) * np.clip((luma - 0.25) / 0.25, 0.0, 1.0) * np.clip(0.4 + saturation * 3.0, 0.0, 1.0)
    slots = blur(slots, 1.0)

    save_rgb(ASSETS / "casino-hall-fx.png", [sparkle, lamps, slots])
    print("written", size)


main()
