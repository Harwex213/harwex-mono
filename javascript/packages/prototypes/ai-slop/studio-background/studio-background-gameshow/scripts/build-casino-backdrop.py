"""Splits the casino hall picture (src/assets/casino-hall-photo.png, 1536 x 1024) into depth layers.

The picture is a generated one-point view down a tall Art Deco casino hall. The backdrop
(src/scene/casinoBackdrop.ts) projects it from a virtual projector onto proxy geometry: a box-shaped
room shell and cut-out cards at their own depths. This script holds the room model and the card
outlines, and writes everything the backdrop needs:

- casino-hall.jpg: the picture. The cards show it.
- casino-hall-plate.jpg: the picture with every card subject removed. The holes are filled from
  casino-hall-empty.png, the same hall generated without furniture and chandeliers. The room shell
  shows the plate, so a card that slides sideways under parallax uncovers the floor and the walls
  behind it instead of a smear or a copy of itself.
- casino-hall-cut.png: card coverage. R, G and B each hold several cards whose boxes do not overlap.
- casino-hall-fx.png: R = crystal and its floor reflections (sparkle), G = lamps and sconces (glow),
  B = slot machine screens.
- casino-hall-layout.json: the room model and the card table (box, depth, channel, hang
  point). casinoBackdrop.ts reads it, so the outlines and the geometry cannot drift apart.

Projection model (photo pixels and photo metres, image rows grow downwards):
- a level pinhole with FOCAL = 1200 px (horizontal field of view 65.2 deg), principal point at
  column CENTER_U = 768 and the horizon on row HORIZON_V = 630 (the floor lines and the slot rows
  meet there; the picture is a level camera with its lens shifted up);
- the eye is EYE = 1.8 m above the floor (the near chairs are 1 m tall);
- the room is a box: side walls at x = +-HALF_WIDTH, ceiling at CEILING, back wall BACK metres away.
The generated picture is not a perfectly consistent 3D scene (the ceiling lines meet higher than the
floor lines). The box is the compromise that keeps the floor, where all the parallax is, exact.

Outlines were traced by eye on zoomed crops of the picture; `crop` maps crop pixels to picture pixels.
Run: python3 scripts/build-casino-backdrop.py
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "src/assets"
SOURCE = ASSETS / "casino-hall-photo.png"
# The same picture with the tables, chairs and chandeliers removed (an image edit of SOURCE).
EMPTY = ASSETS / "casino-hall-empty.png"
LAYOUT = ASSETS / "casino-hall-layout.json"
SUPERSAMPLE = 4

WIDTH, HEIGHT = 1536, 1024
FOCAL = 1200.0
CENTER_U = 768.0
HORIZON_V = 630.0
EYE = 1.8
CEILING = 22.5
HALF_WIDTH = 17.0
BACK = 80.0
# The chandeliers hang in two rows this far left and right of the axis.
CHANDELIER_ROW_X = 7.0

FLOOR, CEIL, LEFT, RIGHT, BACK_WALL = 0, 1, 2, 3, 4


def crop(x0, y0, zoom, points):
    """Picture pixels of a polygon traced on a crop that starts at (x0, y0) and is zoomed `zoom` times."""
    return [(x0 + x / zoom, y0 + y / zoom) for x, y in points]


# Card outlines. Each card: name, polygons, how its depth is found, channel of casino-hall-cut.png.
# Furniture stands on the floor: `contact` is the picture row where it meets the floor.
# A chandelier hangs in a row CHANDELIER_ROW_X off the axis: `chain` is the column of its chain.
CARDS = [
    {
        "name": "Chandelier Left 1",
        "chain": 500,
        "channel": 0,
        "polygons": [crop(410, 0, 2, [
            (172, 0), (188, 0), (188, 145), (210, 150), (212, 200), (240, 210), (242, 310), (300, 345),
            (305, 440), (250, 450), (250, 500), (210, 520), (200, 560), (160, 565), (140, 520),
            (100, 500), (98, 450), (48, 440), (45, 345), (120, 310), (120, 210), (150, 198), (150, 150),
            (172, 145),
        ])],
    },
    {
        "name": "Chandelier Left 2",
        "chain": 569,
        "channel": 1,
        "polygons": [crop(410, 0, 2, [
            (314, 100), (322, 100), (322, 520), (340, 528), (355, 560), (355, 635), (400, 660), (402, 730),
            (370, 740), (345, 770), (330, 795), (300, 795), (290, 770), (265, 740), (230, 730), (228, 660),
            (275, 635), (275, 560), (290, 528), (314, 520),
        ])],
    },
    {
        "name": "Chandelier Left 3",
        "chain": 605,
        "channel": 0,
        "polygons": [crop(410, 0, 2, [
            (386, 290), (394, 290), (394, 738), (412, 745), (430, 770), (430, 820), (458, 830), (460, 880),
            (430, 890), (410, 920), (398, 930), (385, 920), (370, 890), (342, 880), (340, 830), (368, 820),
            (368, 770), (386, 745),
        ])],
    },
    {
        "name": "Chandelier Left 4",
        "chain": 634,
        "channel": 1,
        "polygons": [crop(410, 0, 2, [
            (440, 460), (456, 460), (456, 878), (470, 890), (475, 935), (495, 945), (497, 975), (470, 985),
            (462, 1005), (448, 1008), (440, 1000), (420, 980), (415, 945), (437, 935), (440, 890),
        ])],
    },
    {
        "name": "Chandelier Right 1",
        "chain": 1035,
        "channel": 0,
        "polygons": [crop(846, 0, 2, [
            (372, 0), (384, 0), (384, 148), (408, 152), (410, 205), (438, 215), (440, 310), (505, 345),
            (512, 440), (440, 455), (430, 500), (415, 530), (405, 562), (365, 565), (355, 530), (335, 500),
            (310, 455), (258, 440), (255, 345), (320, 310), (320, 215), (348, 205), (348, 152), (372, 148),
        ])],
    },
    {
        "name": "Chandelier Right 2",
        "chain": 967,
        "channel": 1,
        "polygons": [crop(846, 0, 2, [
            (236, 160), (246, 160), (246, 520), (262, 528), (280, 560), (282, 635), (328, 655), (330, 730),
            (300, 740), (270, 770), (255, 795), (225, 795), (215, 770), (190, 740), (158, 730), (157, 655),
            (205, 635), (205, 560), (222, 528), (236, 520),
        ])],
    },
    {
        "name": "Chandelier Right 3",
        "chain": 929,
        "channel": 0,
        "polygons": [crop(846, 0, 2, [
            (162, 300), (171, 300), (171, 735), (182, 742), (185, 770), (185, 815), (215, 825), (216, 870),
            (190, 885), (175, 915), (160, 928), (145, 920), (135, 885), (100, 870), (97, 825), (130, 815),
            (130, 770), (150, 742), (162, 735),
        ])],
    },
    {
        "name": "Chandelier Right 4",
        "chain": 900,
        "channel": 1,
        "polygons": [crop(846, 0, 2, [
            (100, 460), (118, 460), (118, 878), (125, 890), (122, 935), (142, 945), (143, 975), (120, 985),
            (110, 1000), (100, 1007), (88, 1000), (78, 985), (62, 975), (63, 945), (85, 935), (88, 890),
            (100, 878),
        ])],
    },
    {
        "name": "Tables Far Left",
        "contact": 724,
        "channel": 2,
        # The far tables and the row of chairs in front of the slot machines.
        "polygons": [crop(150, 640, 2, [
            (95, 150), (100, 80), (140, 75), (180, 72), (250, 70), (330, 66), (360, 64), (420, 60), (500, 58),
            (560, 56), (600, 60), (640, 58), (700, 55), (720, 48), (740, 45), (760, 52), (800, 50), (900, 46),
            (1000, 42), (1090, 40), (1092, 60), (1040, 80), (980, 110), (960, 150), (950, 175), (900, 180),
            (860, 180), (780, 175), (700, 170), (640, 160), (600, 150), (560, 150), (440, 125), (330, 125),
            (250, 175), (160, 170),
        ])],
    },
    {
        "name": "Tables Far Right",
        "contact": 724,
        "channel": 2,
        "polygons": [crop(776, 640, 2, [
            (118, 38), (240, 42), (340, 52), (460, 48), (462, 38), (474, 38), (476, 50), (560, 48), (600, 50),
            (640, 50), (690, 58), (720, 62), (760, 64), (800, 66), (860, 66), (900, 66), (940, 70), (980, 74),
            (1020, 74), (1060, 76), (1100, 74), (1140, 80), (1150, 110), (1100, 120), (1060, 140), (1000, 148),
            (960, 150), (905, 160), (900, 180), (800, 175), (780, 180), (700, 170), (660, 130), (600, 110),
            (560, 100), (440, 105), (420, 140), (400, 165), (310, 180), (240, 120), (160, 70),
        ])],
    },
    {
        "name": "Tables Mid Left",
        "contact": 777,
        "channel": 1,
        "polygons": [crop(280, 630, 3, [
            (85, 215), (100, 203), (160, 198), (330, 192), (480, 190), (600, 195), (650, 200), (665, 210),
            (690, 195), (760, 188), (780, 195), (775, 240), (760, 300), (755, 400), (700, 420), (600, 445),
            (560, 465), (480, 470), (300, 470), (240, 465), (215, 440), (90, 300),
        ])],
    },
    {
        "name": "Tables Mid Right",
        "contact": 778,
        "channel": 1,
        "polygons": [crop(816, 630, 3, [
            (540, 185), (560, 180), (600, 183), (610, 192), (650, 195), (700, 197), (720, 210), (760, 200),
            (1000, 198), (1010, 215), (1170, 212), (1190, 203), (1240, 205), (1245, 240), (1230, 300),
            (1060, 300), (1060, 460), (900, 470), (740, 470), (700, 420), (560, 410), (540, 300),
        ])],
    },
    {
        "name": "Tables Near Left",
        "contact": 905,
        "channel": 0,
        "polygons": [[
            (0, 712), (60, 712), (92, 712), (98, 706), (104, 712), (150, 716), (217, 720), (228, 712),
            (272, 712), (278, 722), (290, 730), (298, 728), (330, 730), (336, 723), (362, 726), (364, 740),
            (358, 760), (352, 800), (350, 830), (345, 870), (330, 880), (300, 895), (260, 905), (220, 915),
            (160, 915), (50, 925), (0, 935),
        ]],
    },
    {
        "name": "Tables Near Right",
        "contact": 903,
        "channel": 0,
        "polygons": [crop(1136, 640, 3, [
            (100, 275), (110, 262), (150, 262), (180, 270), (190, 262), (230, 258), (260, 268), (290, 300),
            (330, 300), (345, 290), (400, 240), (405, 222), (440, 218), (510, 220), (518, 255), (545, 250),
            (600, 245), (880, 240), (888, 222), (905, 218), (930, 222), (938, 240), (1200, 240), (1200, 880),
            (1180, 880), (1100, 840), (850, 830), (760, 830), (560, 800), (490, 730), (250, 710), (150, 660),
            (140, 500), (100, 300),
        ])],
    },
]
# Slot machine banks along both side walls (picture pixels: left, top, right, bottom).
SLOT_BOXES = [
    (190, 600, 310, 692), (372, 615, 442, 670), (480, 622, 520, 662), (545, 625, 580, 658),
    (1226, 600, 1346, 692), (1094, 615, 1164, 670), (1016, 622, 1056, 662), (956, 625, 992, 658),
]


def card_depth(card):
    if "contact" in card:
        return EYE * FOCAL / (card["contact"] - HORIZON_V)
    return CHANDELIER_ROW_X * FOCAL / abs(card["chain"] - CENTER_U)


def polygon_mask(polygons, feather=0.7):
    """Antialiased coverage of the polygons, 0..1."""
    k = SUPERSAMPLE
    canvas = Image.new("L", (WIDTH * k, HEIGHT * k), 0)
    draw = ImageDraw.Draw(canvas)
    for polygon in polygons:
        draw.polygon([(x * k, y * k) for x, y in polygon], fill=255)
    mask = canvas.resize((WIDTH, HEIGHT), Image.BOX)
    if feather > 0:
        mask = mask.filter(ImageFilter.GaussianBlur(feather))
    return np.asarray(mask).astype(np.float32) / 255.0


def box_mask(box):
    x0, y0, x1, y1 = box
    return polygon_mask([[(x0, y0), (x1, y0), (x1, y1), (x0, y1)]], feather=0)


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


def surface_of(u, v):
    """Which room surface picture pixel (u, v) shows, and the 3D point (x, y, depth) relative to the eye."""
    rx = (u - CENTER_U) / FOCAL
    ry = -(v - HORIZON_V) / FOCAL
    big = np.full(np.broadcast(u, v).shape, 1e9)
    floor = np.where(ry < 0, EYE / np.maximum(-ry, 1e-9), big)
    ceiling = np.where(ry > 0, (CEILING - EYE) / np.maximum(ry, 1e-9), big)
    left = np.where(rx < 0, HALF_WIDTH / np.maximum(-rx, 1e-9), big)
    right = np.where(rx > 0, HALF_WIDTH / np.maximum(rx, 1e-9), big)
    back = np.full_like(big, BACK)
    depth = np.minimum.reduce([floor, ceiling, left, right, back])
    kind = np.select(
        [depth == floor, depth == ceiling, depth == left, depth == right],
        [FLOOR, CEIL, LEFT, RIGHT],
        BACK_WALL,
    )
    return kind, rx * depth, ry * depth, depth


def lum(rgb):
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def save_rgb(path, channels):
    data = np.stack(channels, axis=-1)
    Image.fromarray((np.clip(data, 0.0, 1.0) * 255 + 0.5).astype(np.uint8)).save(path)


def main():
    source = Image.open(SOURCE).convert("RGB")
    assert source.size == (WIDTH, HEIGHT), source.size
    source.save(ASSETS / "casino-hall.jpg", quality=92)
    photo = np.asarray(source).astype(np.float32) / 255.0

    # Coverage, nearest card first: a card loses the pixels that a nearer card hides.
    for card in CARDS:
        card["depth"] = card_depth(card)
    order = sorted(range(len(CARDS)), key=lambda i: CARDS[i]["depth"])
    nearer = np.zeros((HEIGHT, WIDTH), np.float32)
    coverage = {}
    for i in order:
        own = polygon_mask(CARDS[i]["polygons"])
        coverage[i] = own * (1.0 - nearer)
        nearer = np.maximum(nearer, own)
    channels = [np.zeros((HEIGHT, WIDTH), np.float32) for _ in range(3)]
    for i, card in enumerate(CARDS):
        channels[card["channel"]] = np.maximum(channels[card["channel"]], coverage[i])

    # Plate: everything a card shows is cut out and filled from the empty hall. That picture was
    # made from this one by an image edit, so it lines up pixel for pixel, but its colours drift a
    # little: a smooth gain matches them to the picture around each hole.
    holes = blur(dilate((nearer > 0.02).astype(np.float32), 3), 1.5)
    known = (holes < 0.01).astype(np.float32)
    empty = np.asarray(Image.open(EMPTY).convert("RGB")).astype(np.float32) / 255.0
    gain = (blur(photo, 6.0) + 0.02) / (blur(empty, 6.0) + 0.02)
    gain = push_pull(gain, known)
    filled = np.clip(empty * np.clip(gain, 0.6, 1.6), 0.0, 1.0)
    plate = photo * (1.0 - holes[..., None]) + filled * holes[..., None]
    Image.fromarray((np.clip(plate, 0, 1) * 255 + 0.5).astype(np.uint8)).save(ASSETS / "casino-hall-plate.jpg", quality=92)
    save_rgb(ASSETS / "casino-hall-cut.png", channels)

    pixel_y, pixel_x = np.mgrid[0:HEIGHT, 0:WIDTH]
    kind, _, _, _ = surface_of(pixel_x + 0.5, pixel_y + 0.5)
    luma = lum(photo)
    detail = luma - blur(luma, 2.5)

    # Sparkle: crystal points brighter than their surroundings, and the chandelier reflections on the floor.
    chandeliers = polygon_mask([p for card in CARDS if "chain" in card for p in card["polygons"]], feather=1.5)
    crystal = chandeliers * np.clip((detail - 0.02) / 0.08, 0.0, 1.0)
    floor_shine = (kind == FLOOR) * (1.0 - nearer) * np.clip((luma - 0.55) / 0.3, 0.0, 1.0)
    sparkle = np.maximum(crystal, blur(floor_shine, 1.0) * 0.6)

    # Lamps: the brightest warm pixels above the floor: sconces, table lamps, chandelier hearts, the bar.
    lamps = np.clip((luma - 0.72) / 0.2, 0.0, 1.0) * (kind != FLOOR)
    lamps = np.maximum(lamps, blur(lamps, 2.0) * 0.8)

    # Slot screens: lit, saturated pixels on the machine fronts.
    saturation = photo.max(axis=-1) - photo.min(axis=-1)
    bank = np.maximum.reduce([box_mask(box) for box in SLOT_BOXES])
    slots = bank * np.clip((luma - 0.18) / 0.25, 0.0, 1.0) * np.clip(saturation * 3.0 - 0.3, 0.0, 1.0)
    slots = blur(slots, 0.8)
    save_rgb(ASSETS / "casino-hall-fx.png", [sparkle, lamps, slots])

    layout = {
        "_comment": "Written by scripts/build-casino-backdrop.py; edit the script, not this file.",
        "width": WIDTH,
        "height": HEIGHT,
        "focal": FOCAL,
        "centerU": CENTER_U,
        "horizonV": HORIZON_V,
        "eye": EYE,
        "ceiling": CEILING,
        "halfWidth": HALF_WIDTH,
        "back": BACK,
        "cards": [],
    }
    for i in sorted(range(len(CARDS)), key=lambda i: -CARDS[i]["depth"]):
        card = CARDS[i]
        points = [pt for polygon in card["polygons"] for pt in polygon]
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        entry = {
            "name": card["name"],
            "box": [
                max(0, int(np.floor(min(xs))) - 2),
                max(0, int(np.floor(min(ys))) - 2),
                min(WIDTH, int(np.ceil(max(xs))) + 2),
                min(HEIGHT, int(np.ceil(max(ys))) + 2),
            ],
            "depth": round(card["depth"], 3),
            "channel": card["channel"],
        }
        if "chain" in card:
            entry["hangU"] = card["chain"]
        layout["cards"].append(entry)
    LAYOUT.write_text(json.dumps(layout, indent=2) + "\n")
    for entry in layout["cards"]:
        print(f'{entry["name"]:22s} depth {entry["depth"]:6.2f} box {entry["box"]} ch {entry["channel"]}')


if __name__ == "__main__":
    main()
