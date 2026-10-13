# Exports LuxuryCasino_V6.blend for the Bevy app: geometry and materials, nothing else.
#
#   Blender -b <file.blend> --python tools/export_blend.py -- <out_dir>
#
# Writes:
#   casino.glb            meshes with material UVs, normals and tangents; materials only carry their names
#   materials.json        the material table
#   textures/<mat>_*.png  material textures baked from the Blender node graphs
#
# Bevy's StandardMaterial cannot run Blender node graphs, so every material graph is evaluated
# here per texel into plain PBR maps: base color, metallic-roughness, normal, emissive. Inputs
# driven by procedural noise in object space become their average value.
#
# Lights, cameras and the world color live in scene/lighting.json, which the Rust project owns.
# Lightmap UVs, merging, lightmaps and probes come from `cargo run --release --bin bake`.

import json
import os
import struct
import sys
import zlib

import bpy
import numpy as np

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "assets"
TEX = os.path.join(OUT, "textures")
os.makedirs(TEX, exist_ok=True)


# ---------------------------------------------------------------- images

def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


_cache = {}


def load(name):
    """Image as float32 [h, w, 4], rows top to bottom, colors decoded to linear when sRGB."""
    if name in _cache:
        return _cache[name]
    img = bpy.data.images[name]
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)[::-1]
    if img.colorspace_settings.name == "sRGB":
        px = px.copy()
        px[..., :3] = srgb_to_linear(px[..., :3])
    _cache[name] = px
    return px


def write_png(path, rgb_or_rgba, bits=8):
    """8- or 16-bit PNG from a float array in [0, 1]. Blender's own image saving is not used:
    images filled through pixels.foreach_set save black."""
    if bits == 16:
        a = (np.clip(rgb_or_rgba, 0, 1) * 65535 + 0.5).astype(">u2")
    else:
        a = (np.clip(rgb_or_rgba, 0, 1) * 255 + 0.5).astype(np.uint8)
    h, w, c = a.shape
    rows = a.reshape(h, w * c).view(np.uint8).reshape(h, -1)
    raw = np.concatenate([np.zeros((h, 1), np.uint8), rows], axis=1).tobytes()

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    color_type = {3: 2, 4: 6}[c]
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, bits, color_type, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def bw(c):
    # Blender's RGB to BW node.
    return c[..., 0] * 0.2126 + c[..., 1] * 0.7152 + c[..., 2] * 0.0722


def map_range(v, lo, hi):
    return lo + (hi - lo) * v


def mix(a, b, f):
    f = np.clip(f, 0, 1)
    if np.ndim(f) == 2:
        f = f[..., None]
    return a + (b - a) * f


def hsv_scale(c, sat, val):
    # Blender's Hue/Saturation/Value node with hue 0.5 (unchanged).
    v = c.max(axis=-1, keepdims=True)
    return np.clip(v - sat * (v - c), 0, None) * val


def ramp_mean(lo, hi, mean=0.5, sigma=0.09):
    """Average of a linear color ramp from lo to hi over Blender noise values, which cluster
    around 0.5."""
    n = np.random.default_rng(1).normal(mean, sigma, 100000)
    return float(np.clip((n - lo) / (hi - lo), 0, 1).mean())


def strengthen(normal_rgb, strength):
    """Blender's Normal Map strength on an OpenGL normal map, baked into the texels."""
    n = normal_rgb[..., :3] * 2 - 1
    n[..., :2] *= strength
    n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-8
    return n * 0.5 + 0.5


def mr(rough, metal):
    """glTF metallic-roughness texture: roughness in G, metalness in B."""
    rough = np.broadcast_to(rough, metal.shape) if np.ndim(rough) == 0 else rough
    metal = np.broadcast_to(metal, rough.shape) if np.ndim(metal) == 0 else metal
    return np.stack([np.zeros_like(rough), rough, metal], axis=-1)


def const(*rgb):
    return np.array(rgb, dtype=np.float32)


# ---------------------------------------------------------------- materials

MATERIALS = {}


def material(name, **params):
    """Registers a material. Texture arrays are written to PNGs; the rest goes to materials.json."""
    entry = {"name": name}
    for key, value in params.items():
        if isinstance(value, np.ndarray) and value.ndim == 3:
            path = f"textures/{name}_{key}.png"
            # A weakened normal map tilts by less than one 8-bit step in places. Its 8-bit
            # steps then show as sparkles in the highlights of the glossy marble.
            write_png(os.path.join(OUT, path), value, bits=16 if key == "normal" else 8)
            entry[key] = path
        elif isinstance(value, np.ndarray):
            entry[key] = [float(x) for x in value]
        else:
            entry[key] = value
    MATERIALS[name] = entry
    print("material", name, sorted(k for k in entry if k != "name"))


def gold(name, a_tint, a_fac, b_tint, b_fac, ramp, sat, val, rough_range, normal_strength, metallic):
    # Two metal scans tinted and blended by low-frequency object-space noise.
    w = ramp_mean(*ramp)
    a = load("Metal034_2K-JPG_Color.jpg")[..., :3]
    b = load("Metal048B_2K-JPG_Color.jpg")[..., :3]
    a = mix(a, a * a_tint, a_fac)
    b = mix(b, b * b_tint, b_fac)
    base = hsv_scale(mix(a, b, w), sat, val)
    ra = load("Metal034_2K-JPG_Roughness.jpg")[..., 0]
    rb = load("Metal048B_2K-JPG_Roughness.jpg")[..., 0]
    rough = map_range(mix(ra, rb, w), *rough_range)
    material(
        name,
        base=linear_to_srgb(base),
        mr=mr(rough, np.full_like(rough, metallic)),
        normal=strengthen(load("Metal048B_2K-JPG_NormalGL.jpg"), normal_strength),
    )


def build_materials():
    gold("BLK_Gold", const(1, .72, .38), .55, const(.9, .62, .3), .6, (.45, .65), .95, .85, (.26, .34), .25, 1.0)
    gold("BLK_GoldAccent", const(1, .8, .46), .3, const(1, .74, .4), .35, (.62, .85), 1.05, 1.15, (.14, .18), .1, 1.0)
    gold("BLK_GoldBackground", const(.7, .5, .3), 1.0, const(.6, .44, .26), 1.0, (.15, .45), .75, .32, (.45, .53), .45, .9)

    # Noise over object space: constant mirror tint and roughness.
    w = ramp_mean(.42, .72)
    material("BLK_AntiqueMirror", color=list(mix(const(.3, .25, .18), const(.12, .09, .06), w)),
             metallic=1.0, roughness=map_range(0.5, .04, .22))

    col = load("Marble016_2K-JPG_Color.jpg")
    f = np.clip(bw(col) * 1.6, 0, 1)
    material("BLK_BalconyMarble",
             base=linear_to_srgb(mix(const(.014, .013, .012), const(.14, .128, .11), f)),
             mr=mr(map_range(load("Marble016_2K-JPG_Roughness.jpg")[..., 0], .36, .44), 0.0),
             normal=strengthen(load("Marble016_2K-JPG_NormalGL.jpg"), .12),
             uv_scale=[.25, .25], uv_offset=[.37, .61], reflectance=.06)

    material("BLK_BarShelf", base=linear_to_srgb(load("bar_shelf_card.png")[..., :3]),
             emissive_texture=True, emissive_strength=2.0, roughness=.3)

    material("BLK_BlackLacquer", color=[.01, .01, .01], roughness=.1, clearcoat=1.0, clearcoat_roughness=.03)

    # The node graph shuffles marble tiles and draws thin grout lines; this keeps the marble only.
    material("BLK_BlackMarble",
             base=linear_to_srgb(load("Marble016_2K-JPG_Color.jpg")[..., :3] * const(.6, .6, .62)),
             mr=mr(map_range(load("Marble016_2K-JPG_Roughness.jpg")[..., 0], .06, .14), 0.0),
             normal=strengthen(load("Marble016_2K-JPG_NormalGL.jpg"), .25),
             uv_scale=[.2 * 2.972 * .3365] * 2, reflectance=.6)

    material("BLK_BlackMarbleColumn",
             base=linear_to_srgb(load("Marble006_2K-JPG_Color.jpg")[..., :3] * const(.55, .5, .45)),
             mr=mr(map_range(load("Marble006_2K-JPG_Roughness.jpg")[..., 0], .1, .2), 0.0),
             normal=strengthen(load("Marble006_2K-JPG_NormalGL.jpg"), .3),
             uv_scale=[1 / 3, 1 / 3], reflectance=.6)

    material("BLK_Candle", color=[1, .85, .6], roughness=.4, emissive=[1, .58, .22], emissive_strength=40.0)

    col = load("coffer_ornament_color.png")[..., :3]
    metal = np.clip((col[..., 0] - col[..., 2]) * 3, 0, 1)
    material("BLK_CeilingCoffer", base=linear_to_srgb(col * const(.55, .5, .6)),
             mr=mr(map_range(metal, .55, .28), metal),
             normal=strengthen(load("coffer_ornament_normal.png"), 1.0))

    material("BLK_CeilingNavy", color=[.01, .016, .045],
             mr=mr(map_range(load("Travertine009_2K-JPG_Roughness.jpg")[..., 0], .35, .55), 0.0),
             normal=strengthen(load("Travertine009_2K-JPG_NormalGL.jpg"), .3),
             uv_scale=[.5, .5], clearcoat=.2, clearcoat_roughness=.2)

    fab = load("Fabric026_2K-JPG_Color.jpg")
    material("BLK_ChairRed", base=linear_to_srgb(mix(const(.1, .004, .008), const(.3, .012, .022), bw(fab))),
             mr=mr(map_range(load("Fabric026_2K-JPG_Roughness.jpg")[..., 0], .55, .8), 0.0),
             normal=strengthen(load("Fabric026_2K-JPG_NormalGL.jpg"), .5),
             uv_scale=[2, 2], reflectance=.25)

    # Emission strength is 25 * voronoi sparkle + 1.2; the sparkles cover a few percent of the
    # surface.
    # Bevy's screen-space transmission shows only what lies behind the crystal on screen, and
    # the thin strands vanish. The crystal stays opaque in the app: a glossy dielectric with its
    # glow. The baker reads `bake_transmission` and refracts through it like Cycles.
    material("BLK_Crystal", color=[1, .93, .82], roughness=.03,
             emissive=[1, .72, .42], emissive_strength=1.6, reflectance=1.0,
             bake_transmission=1.0, ior=1.55, specular_ior_level=1.0)

    material("BLK_DarkWood", base=linear_to_srgb(load("Wood051_2K-JPG_Color.jpg")[..., :3] * const(.6, .5, .45)),
             mr=mr(map_range(load("Wood051_2K-JPG_Roughness.jpg")[..., 0], .25, .5), 0.0),
             normal=strengthen(load("Wood051_2K-JPG_NormalGL.jpg"), .5),
             clearcoat=.6, clearcoat_roughness=.08)

    material("BLK_Flowers", color=[.28, .01, .025], roughness=.55)
    material("BLK_Glass", color=[.97, .93, .86], roughness=.08, transmission=1.0, ior=1.5)

    # The fabric weave is 5x finer than the felt layout; only its average roughness survives.
    material("BLK_GreenFelt", base=linear_to_srgb(load("felt_layout_color.png")[..., :3] * const(.2, .36, .28)),
             roughness=map_range(float(load("Fabric034_2K-JPG_Roughness.jpg")[..., 0].mean()), .8, .95),
             reflectance=.3)

    material("BLK_LampShade", color=[.75, .5, .28], roughness=.6, emissive=[1, .6, .28], emissive_strength=2.0)

    # Emission runs up the shade along UV v: a ramp of color and of strength.
    v = 1.0 - (np.arange(256, dtype=np.float32) + 0.5) / 256  # PNG rows run top to bottom
    t = np.clip(v / .367, 0, 1)
    k = np.clip(t / .9, 0, 1)[:, None]
    color = const(1, .33, .07) + (const(1, .7, .42) - const(1, .33, .07)) * k
    strength = map_range(t, .65, .12)[:, None]
    emissive = np.repeat((color * strength / .65)[:, None, :], 4, axis=1)
    material("BLK_LampShadeFabric", color=[.8, .63, .42], roughness=.75,
             emissive_map=linear_to_srgb(emissive), emissive_strength=.65)

    material("BLK_LeatherRail", color=[.03, .012, .008], roughness=.38, clearcoat=.3, clearcoat_roughness=.2)

    material("BLK_NightWindow", color=[0, 0, 0], roughness=.1,
             emissive_map=linear_to_srgb(load("night_city_backdrop.png")[..., :3]), emissive_strength=.8)

    leaf = load("palm_frond_alpha.png")
    material("BLK_Plant", base=np.concatenate([linear_to_srgb(leaf[..., :3] * const(.6, .65, .5)), leaf[..., 3:]], -1),
             roughness=.55, reflectance=.4, alpha_mask=.5, double_sided=True)

    material("BLK_RedCarpet", base=linear_to_srgb(load("carpet_artdeco_color.png")[..., :3] * const(.42, .07, .09)),
             roughness=map_range(float(load("Carpet013_2K-JPG_Roughness.jpg")[..., 0].mean()), .75, .95),
             uv_scale=[.25, .25], reflectance=.15)

    # The drapes show the pleats; the fine fabric weave only adds its average color.
    weave = float(bw(load("Fabric026_2K-JPG_Color.jpg")).mean())
    material("BLK_RedVelvet", color=list(mix(const(.1, .004, .008), const(.3, .012, .022), weave)),
             roughness=map_range(float(load("Fabric026_2K-JPG_Roughness.jpg")[..., 0].mean()), .55, .8),
             normal=strengthen(load("drape_pleats_normal.png"), 1.0), uv_scale=[.5, .1], reflectance=.25)

    material("BLK_SlotBody", base=linear_to_srgb(load("Metal046A_2K-JPG_Color.jpg")[..., :3] * const(.35, .33, .35)),
             mr=mr(map_range(load("Metal046A_2K-JPG_Roughness.jpg")[..., 0], .25, .45),
                   load("Metal046A_2K-JPG_Metalness.jpg")[..., 0]),
             normal=strengthen(load("Metal046A_2K-JPG_NormalGL.jpg"), .5))

    material("BLK_SlotScreen", base=linear_to_srgb(load("slot_screens_atlas.png")[..., :3]),
             emissive_texture=True, emissive_strength=3.0, roughness=.15, clearcoat=.5, clearcoat_roughness=.05)

    stone = load("Travertine009_2K-JPG_Color.jpg")[..., :3] * load("Travertine009_2K-JPG_AmbientOcclusion.jpg")[..., :3]
    material("BLK_WarmStone", base=linear_to_srgb(stone * const(.16, .11, .08)),
             mr=mr(map_range(load("Travertine009_2K-JPG_Roughness.jpg")[..., 0], .5, .8), 0.0),
             normal=strengthen(load("Travertine009_2K-JPG_NormalGL.jpg"), .8), uv_scale=[.5, .5])


# ---------------------------------------------------------------- run

def export_glb():
    for o in bpy.context.scene.objects:
        o.select_set(o.type == "MESH" and not o.hide_render)
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, "casino.glb"),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_tangents=True,
        export_materials="EXPORT",
        export_image_format="NONE",
        export_cameras=False,
        export_lights=False,
        export_yup=True,
    )


build_materials()
export_glb()
with open(os.path.join(OUT, "materials.json"), "w") as f:
    json.dump(list(MATERIALS.values()), f, indent=1)
print("exported", len(MATERIALS), "materials")
