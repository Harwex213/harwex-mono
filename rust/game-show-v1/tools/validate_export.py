#!/usr/bin/env python3
"""Validate `assets/wheel_stage.glb` against the audited Blender scene.

Owner: agent E. Ground truth is `docs/scene_audit.md` and `docs/export_notes.md`.

Usage, from anywhere:

    python3 tools/validate_export.py [path/to/file.glb] [-v]

A relative path is resolved against the crate root, which the script derives from
`__file__`, so no absolute path is baked in. Without an argument it checks
`assets/wheel_stage.glb`.

The script reads the GLB itself: it parses the container by hand and `json.loads` the JSON
chunk. It needs no Blender, no network and no third-party package. It prints one line per
check and exits 1 if any check failed.

If a check fails, the fix belongs in `tools/export_gltf.py`, not in the numbers below. The
only legitimate reason to edit an expectation here is a deliberate change to the export;
say so in `docs/export_notes.md` when you do.
"""

import json
import struct
import sys
from pathlib import Path

CRATE_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_GLB = "assets/wheel_stage.glb"

# ---------------------------------------------------------------------------
# Expectations. Every number comes from docs/scene_audit.md or docs/export_notes.md.
# ---------------------------------------------------------------------------

EXPECTED_SCENE_NAME = "Stage"

# audit section 1: 163 objects, 153 of them meshes. One glTF node per Blender object.
EXPECTED_NODES = 163
EXPECTED_MESHES = 153

# export_notes section 2: 153 meshes plus 26 extra material slots from the 25 multi-slot
# objects (Pointer_Flapper carries three).
EXPECTED_PRIMITIVES = 179
EXPECTED_ACCESSORS = 657

# audit section 9, evaluated geometry with the five BEVEL modifiers applied.
EXPECTED_TRIANGLES = 153392
# "within a few percent": a re-export that changes the triangle count by more than this has
# either dropped the bevels (-3344, 2.2%) or changed the geometry.
TRIANGLE_TOLERANCE = 0.02

# audit section 11 correction 1: the file holds 19 materials, not the 20 in agent_plan.md.
# MAT_Rubber_Black has no users and does not exist in the .blend, so it cannot be in the GLB.
EXPECTED_MATERIALS = [
    "MAT_Bulb_Glass",
    "MAT_Crystal",
    "MAT_Dark_Trim",
    "MAT_Fixture_Body",
    "MAT_Floor_Gloss",
    "MAT_Gold_Dark",
    "MAT_Gold_Trim",
    "MAT_LED_Screen",
    "MAT_Lens_Glow",
    "MAT_Metal_Polished",
    "MAT_Peg_Metal",
    "MAT_Pillar_Body",
    "MAT_Sector_Blue",
    "MAT_Sector_Cream",
    "MAT_Sector_Cyan",
    "MAT_Sector_Gold",
    "MAT_Sector_Pink",
    "MAT_Sector_White",
    "MAT_Truss_Metal",
]

# Nodes the Rust app addresses by name. Losing any of them breaks a feature outright.
REQUIRED_NODES = [
    "Wheel_Root",       # spin pivot, src/spin.rs
    "Wheel_Stand",      # static stand pivot
    "Crest_Root",       # flapper parent
    "Wall_Screen",      # sky shader target, src/screen.rs
    "Pointer_Flapper",  # ticks against the pegs, src/spin.rs
    "Wheel_Pegs",
    "Wheel_Rim",
    "Podium_Riser",     # shares MAT_LED_Screen with Wall_Screen
    "Cam_Hero",
]
REQUIRED_NODES += [f"Wheel_Sector_{i:02d}" for i in range(1, 49)]

# audit section 2: Wheel_Root carries no mesh and parents the 56 spinning meshes.
WHEEL_ROOT_CHILDREN = 56

# export_notes section 9: the exporter puts KHR_lights_punctual in extensionsRequired.
# three-d-asset 0.10 enables that gltf feature, so the GLB loads. If the export is ever
# re-run with export_lights=False on purpose, flip this to False and note it in
# docs/export_notes.md; nothing is lost, because assets/scene.json carries all six lights.
EXPECT_LIGHT_EXTENSION = True
LIGHT_EXTENSION = "KHR_lights_punctual"

# export_notes section 6.3: the exporter normalises `emissiveFactor` to a maximum of 1 and
# puts the rest in KHR_materials_emissive_strength. MAT_LED_Screen's 1.5 lives there, and
# assets/scene.json re-applies it, so the GLB has to actually carry it. Without the
# extension the wall imports at 1.0 and nothing else complains.
EMISSIVE_STRENGTH_EXTENSION = "KHR_materials_emissive_strength"
SCREEN_MATERIAL = "MAT_LED_Screen"
SCREEN_EMISSIVE_STRENGTH = 1.5
STRENGTH_EPSILON = 1e-6

GLTF_UNSIGNED_SHORT = 5123
GLTF_MODE_TRIANGLES = 4

GLB_MAGIC = 0x46546C67  # "glTF"
CHUNK_JSON = 0x4E4F534A  # "JSON"
CHUNK_BIN = 0x004E4942  # "BIN\0"


class Report:
    """Collects check results and prints them."""

    def __init__(self, verbose):
        self.verbose = verbose
        self.failures = []
        self.checks = 0

    def check(self, ok, name, detail=""):
        self.checks += 1
        if ok:
            if self.verbose:
                print(f"  ok    {name}" + (f" — {detail}" if detail else ""))
        else:
            print(f"  FAIL  {name}" + (f" — {detail}" if detail else ""))
            self.failures.append(name)
        return ok

    def equal(self, name, actual, expected):
        return self.check(
            actual == expected, name, f"expected {expected!r}, got {actual!r}"
        )

    def info(self, text):
        if self.verbose:
            print(f"  ..    {text}")


def fail_hard(message):
    print(f"  FAIL  {message}")
    print("\nVALIDATION FAILED: the file is not a readable GLB.")
    sys.exit(1)


def parse_glb(path):
    """Returns (gltf_json, bin_length). Exits 1 if the container is malformed."""
    data = path.read_bytes()
    if len(data) < 12:
        fail_hard(f"{path} is {len(data)} bytes, too short for a GLB header")
    magic, version, declared = struct.unpack_from("<III", data, 0)
    if magic != GLB_MAGIC:
        fail_hard(f"bad magic 0x{magic:08X}, expected 0x{GLB_MAGIC:08X} ('glTF')")
    if version != 2:
        fail_hard(f"container version {version}, expected 2")
    if declared != len(data):
        fail_hard(f"header length {declared} does not match file size {len(data)}")

    offset = 12
    json_chunk = None
    bin_length = 0
    while offset + 8 <= len(data):
        length, kind = struct.unpack_from("<II", data, offset)
        offset += 8
        if offset + length > len(data):
            fail_hard(f"chunk of {length} bytes at {offset} runs past the end of the file")
        payload = data[offset:offset + length]
        if kind == CHUNK_JSON:
            json_chunk = payload
        elif kind == CHUNK_BIN:
            bin_length = length
        offset += length + (-length % 4)

    if json_chunk is None:
        fail_hard("no JSON chunk in the container")
    try:
        gltf = json.loads(json_chunk.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        fail_hard(f"JSON chunk does not parse: {exc}")
    return gltf, bin_length, len(data)


def count_triangles(gltf):
    """Triangles over every primitive, the way a renderer will draw them."""
    accessors = gltf.get("accessors", [])
    total = 0
    for mesh in gltf.get("meshes", []):
        for prim in mesh.get("primitives", []):
            if prim.get("mode", GLTF_MODE_TRIANGLES) != GLTF_MODE_TRIANGLES:
                continue
            if "indices" in prim:
                count = accessors[prim["indices"]]["count"]
            else:
                count = accessors[prim["attributes"]["POSITION"]]["count"]
            total += count // 3
    return total


def validate(path, verbose):
    rep = Report(verbose)
    print(f"validate_export.py: {path}")
    gltf, bin_length, file_size = parse_glb(path)
    rep.info(f"{file_size} bytes, BIN chunk {bin_length} bytes")

    nodes = gltf.get("nodes", [])
    meshes = gltf.get("meshes", [])
    materials = gltf.get("materials", [])
    accessors = gltf.get("accessors", [])
    node_names = [n.get("name", "") for n in nodes]
    by_name = {}
    for index, name in enumerate(node_names):
        by_name.setdefault(name, []).append(index)

    print("\n[container]")
    rep.equal("asset version is 2.0", gltf.get("asset", {}).get("version"), "2.0")
    scenes = gltf.get("scenes", [])
    rep.equal("exactly one scene", len(scenes), 1)
    if scenes:
        rep.equal("scene name", scenes[0].get("name"), EXPECTED_SCENE_NAME)
    buffers = gltf.get("buffers", [])
    rep.equal("exactly one buffer", len(buffers), 1)
    if buffers:
        rep.check(
            "uri" not in buffers[0],
            "buffer is self-contained (no uri)",
            f"uri={buffers[0].get('uri')!r}",
        )
        rep.check(
            buffers[0].get("byteLength", 0) <= bin_length,
            "buffer byteLength fits the BIN chunk",
            f"byteLength={buffers[0].get('byteLength')}, BIN chunk={bin_length}",
        )

    print("\n[counts]")
    rep.equal("node count", len(nodes), EXPECTED_NODES)
    rep.equal("mesh count", len(meshes), EXPECTED_MESHES)
    primitives = sum(len(m.get("primitives", [])) for m in meshes)
    rep.equal("primitive count", primitives, EXPECTED_PRIMITIVES)
    rep.equal("accessor count", len(accessors), EXPECTED_ACCESSORS)
    rep.equal("camera count", len(gltf.get("cameras", [])), 1)
    # The LED wall's sky must survive the export. An earlier export read
    # `image.has_data == False` in background mode as "the file is missing" and shipped no
    # images at all, which left the wall flat purple. These assertions exist so that
    # regression cannot pass again.
    rep.equal("image count", len(gltf.get("images", [])), 1)
    rep.equal("texture count", len(gltf.get("textures", [])), 2)
    led = next((m for m in materials if m.get("name") == SCREEN_MATERIAL), {})
    rep.check(
        "baseColorTexture" in led.get("pbrMetallicRoughness", {}),
        f"{SCREEN_MATERIAL} carries a baseColorTexture",
        f"got {sorted(led.get('pbrMetallicRoughness', {}))}",
    )
    rep.check(
        "emissiveTexture" in led,
        f"{SCREEN_MATERIAL} carries an emissiveTexture",
        f"got {sorted(led)}",
    )
    strength = (
        led.get("extensions", {}).get(EMISSIVE_STRENGTH_EXTENSION, {}).get("emissiveStrength")
    )
    rep.check(
        strength is not None
        and abs(strength - SCREEN_EMISSIVE_STRENGTH) <= STRENGTH_EPSILON,
        f"{SCREEN_MATERIAL} {EMISSIVE_STRENGTH_EXTENSION} is {SCREEN_EMISSIVE_STRENGTH}",
        f"got {strength!r}",
    )

    print("\n[triangles]")
    tris = count_triangles(gltf)
    delta = tris - EXPECTED_TRIANGLES
    drift = abs(delta) / EXPECTED_TRIANGLES
    rep.check(
        drift <= TRIANGLE_TOLERANCE,
        "triangle count within "
        f"{TRIANGLE_TOLERANCE * 100:.0f}% of the audited {EXPECTED_TRIANGLES}",
        f"got {tris} ({delta:+d}, {drift * 100:.3f}%)",
    )
    if delta and drift <= TRIANGLE_TOLERANCE:
        print(f"  note  triangle count differs from the audit by {delta:+d}")

    print("\n[materials]")
    material_names = [m.get("name", "") for m in materials]
    rep.equal("material count", len(materials), len(EXPECTED_MATERIALS))
    missing = [n for n in EXPECTED_MATERIALS if n not in material_names]
    rep.check(
        not missing,
        f"all {len(EXPECTED_MATERIALS)} audited MAT_* materials present",
        f"missing {missing}" if missing else "",
    )
    unexpected = sorted(set(material_names) - set(EXPECTED_MATERIALS))
    rep.check(
        not unexpected, "no unexpected materials", f"extra {unexpected}" if unexpected else ""
    )
    bad_prefix = [n for n in material_names if not n.startswith("MAT_")]
    rep.check(
        not bad_prefix,
        "every material name starts with MAT_",
        f"offenders {bad_prefix}" if bad_prefix else "",
    )

    print("\n[nodes]")
    missing_nodes = [n for n in REQUIRED_NODES if n not in by_name]
    rep.check(
        not missing_nodes,
        f"all {len(REQUIRED_NODES)} required nodes present "
        "(Wheel_Root, Wall_Screen, Pointer_Flapper, Wheel_Sector_01..48, ...)",
        f"missing {missing_nodes}" if missing_nodes else "",
    )
    duplicates = sorted(n for n in REQUIRED_NODES if len(by_name.get(n, [])) > 1)
    rep.check(
        not duplicates,
        "no required node name appears twice",
        f"duplicated {duplicates}" if duplicates else "",
    )
    sectors = [n for n in node_names if n.startswith("Wheel_Sector_")]
    rep.equal("Wheel_Sector_* node count", len(sectors), 48)
    mangled = [n for n in node_names if n.endswith(".001") or n.startswith("Object_")]
    rep.check(
        not mangled, "no mangled node names", f"offenders {mangled}" if mangled else ""
    )

    if "Wheel_Root" in by_name:
        root = nodes[by_name["Wheel_Root"][0]]
        rep.check(
            "mesh" not in root,
            "Wheel_Root carries no mesh",
            f"mesh={root.get('mesh')}",
        )
        rep.equal(
            "Wheel_Root child count", len(root.get("children", [])), WHEEL_ROOT_CHILDREN
        )

    print("\n[extensions]")
    used = gltf.get("extensionsUsed", [])
    required = gltf.get("extensionsRequired", [])
    rep.info(f"extensionsUsed={used} extensionsRequired={required}")
    if EXPECT_LIGHT_EXTENSION:
        ok = rep.check(
            LIGHT_EXTENSION in used,
            f"{LIGHT_EXTENSION} listed in extensionsUsed",
            f"extensionsUsed={used}",
        )
        lights = gltf.get("extensions", {}).get(LIGHT_EXTENSION, {}).get("lights", [])
        rep.check(
            len(lights) == 2,
            f"{LIGHT_EXTENSION} declares the two SPOT lights",
            f"got {len(lights)}: {[l.get('name') for l in lights]}",
        )
        if not ok:
            print(
                "  hint  set EXPECT_LIGHT_EXTENSION = False only if the export was "
                "deliberately run with export_lights=False"
            )
    else:
        rep.check(
            LIGHT_EXTENSION not in used,
            f"{LIGHT_EXTENSION} deliberately absent",
            f"extensionsUsed={used}",
        )
    rep.check(
        "KHR_draco_mesh_compression" not in used,
        "geometry is not Draco-compressed",
        f"extensionsUsed={used}",
    )

    print("\n[primitives]")
    bad_mode = []
    missing_attrs = []
    bad_index_type = []
    bad_index_count = []
    for mesh in meshes:
        name = mesh.get("name", "?")
        for slot, prim in enumerate(mesh.get("primitives", [])):
            label = f"{name}[{slot}]"
            if prim.get("mode", GLTF_MODE_TRIANGLES) != GLTF_MODE_TRIANGLES:
                bad_mode.append(label)
            attrs = prim.get("attributes", {})
            for attr in ("POSITION", "NORMAL", "TEXCOORD_0"):
                if attr not in attrs:
                    missing_attrs.append(f"{label}:{attr}")
            if "indices" not in prim:
                bad_index_type.append(f"{label}:none")
                continue
            acc = accessors[prim["indices"]]
            if acc.get("componentType") != GLTF_UNSIGNED_SHORT:
                bad_index_type.append(f"{label}:{acc.get('componentType')}")
            if acc.get("count", 0) % 3 != 0:
                bad_index_count.append(f"{label}:{acc.get('count')}")
    rep.check(
        not bad_mode, "every primitive is TRIANGLES", f"offenders {bad_mode[:5]}" if bad_mode else ""
    )
    rep.check(
        not missing_attrs,
        "every primitive has POSITION, NORMAL and TEXCOORD_0",
        f"missing {missing_attrs[:5]}" if missing_attrs else "",
    )
    rep.check(
        not bad_index_type,
        "every primitive is indexed with UNSIGNED_SHORT",
        f"offenders {bad_index_type[:5]}" if bad_index_type else "",
    )
    rep.check(
        not bad_index_count,
        "every index count is a multiple of 3",
        f"offenders {bad_index_count[:5]}" if bad_index_count else "",
    )

    print()
    if rep.failures:
        print(f"VALIDATION FAILED: {len(rep.failures)} of {rep.checks} checks failed")
        for name in rep.failures:
            print(f"  - {name}")
        print("Fix tools/export_gltf.py and re-run the export; do not loosen a check.")
        return 1
    print(f"VALIDATION PASSED: {rep.checks} checks, {tris} triangles, "
          f"{len(nodes)} nodes, {len(meshes)} meshes, {len(materials)} materials")
    return 0


def main():
    args = [a for a in sys.argv[1:] if a not in ("-v", "--verbose")]
    verbose = len(args) != len(sys.argv[1:])
    target = Path(args[0]) if args else Path(DEFAULT_GLB)
    if not target.is_absolute():
        target = CRATE_ROOT / target
    if not target.is_file():
        print(f"validate_export.py: no such file: {target}")
        print("Run the export first; docs/export_notes.md section 1 has the command.")
        return 1
    return validate(target, verbose)


if __name__ == "__main__":
    sys.exit(main())
