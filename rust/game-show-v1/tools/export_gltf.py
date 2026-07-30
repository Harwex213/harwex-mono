"""Export the `Stage` scene of `wheel_stage.blend` to a self-contained GLB.

Run headless, from the crate root:

    /Applications/Blender.app/Contents/MacOS/Blender --background \
        ../../unity/blender-assets/wheel_stage.blend \
        --python tools/export_gltf.py -- assets/wheel_stage.glb

The output path is the first argument after `--` and defaults to
`assets/wheel_stage.glb`. It is resolved against the crate root, which this script
derives from its own location (`<crate>/tools/export_gltf.py`), so the file holds no
absolute paths.

The script never writes the .blend. It calls no `save_mainfile`, no `save_as_mainfile`
and no operator that mutates the source file on disk. `export_apply=True` evaluates
modifiers on depsgraph copies only.

Written for Blender 5.1. The exporter's keyword set changes between releases, so the
script introspects `bpy.ops.export_scene.gltf.get_rna_type().properties` and refuses to
run if any keyword it wants is missing. Two 5.1 defaults matter and are both set
explicitly below: `export_apply` defaults to False (modifiers would be dropped) and
`export_cameras` / `export_lights` default to False.

After the export the GLB is re-parsed from disk — container chunks and JSON — and the
invariants the Rust side depends on are checked: object names, material names, the wheel
pivot empty and its 56 children, one buffer with no external URI, triangle-mode
primitives only.
"""

import json
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

SCENE_NAME = "Stage"
DEFAULT_OUTPUT = "assets/wheel_stage.glb"

# Names the Rust side matches on. A rename or a mangled suffix breaks it, so the export
# fails loudly instead of shipping a GLB that loads but cannot be wired up.
REQUIRED_NODES = (
    "Wheel_Root",
    "Wheel_Stand",
    "Crest_Root",
    "Wall_Screen",
    "Pointer_Flapper",
    "Wheel_Rim",
    "Wheel_Pegs",
    "Wheel_Sector_01",
    "Wheel_Sector_48",
    "Podium_Riser",
    "Cam_Hero",
)
# `Wheel_Root` parents the 56 spinning meshes; that count is the spin invariant.
SPIN_PIVOT = "Wheel_Root"
SPIN_CHILD_COUNT = 56
# Empties whose transforms agent E has to be able to reach in the manifest.
EMPTY_NAMES = ("Wheel_Root", "Wheel_Stand", "Crest_Root")
MATERIAL_PREFIX = "MAT_"
EXPECTED_MATERIALS = 19
EXPECTED_TRIANGLES = 153_392  # evaluated, five bevel modifiers applied

GLB_MAGIC = 0x46546C67
CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942
MODE_TRIANGLES = 4


def crate_root() -> Path:
    """The crate root, derived from this script's own path."""
    return Path(__file__).resolve().parent.parent


def parse_output_path(argv: list) -> Path:
    """Take the output path from the arguments after `--`."""
    if "--" in argv:
        extra = argv[argv.index("--") + 1:]
    else:
        extra = []
    if len(extra) > 1:
        raise SystemExit(f"expected at most one argument after `--`, got {extra}")
    relative = extra[0] if extra else DEFAULT_OUTPUT
    path = Path(relative)
    if not path.is_absolute():
        path = crate_root() / path
    return path


def exporter_properties() -> dict:
    """Introspect the glTF exporter and print every keyword this Blender accepts."""
    rna = bpy.ops.export_scene.gltf.get_rna_type()
    props = {}
    for prop in rna.properties:
        if prop.identifier == "rna_type":
            continue
        props[prop.identifier] = prop
    print(f"[introspect] export_scene.gltf exposes {len(props)} keywords on "
          f"Blender {bpy.app.version_string}")
    for identifier in sorted(props):
        prop = props[identifier]
        detail = f"{prop.type}"
        if prop.type == "ENUM":
            items = ",".join(item.identifier for item in prop.enum_items)
            detail += f"[{items}]" if items else "[dynamic]"
        print(f"[introspect]   {identifier}: {detail} default={getattr(prop, 'default', None)!r}")
    return props


def export_keywords(output: Path) -> dict:
    """The exact keyword set used for this export."""
    return {
        "filepath": str(output),
        "check_existing": False,           # overwrite without a file-browser prompt
        "export_format": "GLB",            # single self-contained binary
        "use_active_scene": True,          # only the `Stage` scene
        "use_selection": False,
        "use_visible": False,              # nothing in the file is hidden
        "use_renderable": False,
        "use_active_collection": False,
        "export_apply": True,              # 5.1 default is False; the five bevels must bake
        "export_yup": True,                # Blender Z-up -> glTF Y-up: (x, y, z) -> (x, z, -y)
        "export_texcoords": True,          # every mesh has one UV layer `UVMap`
        "export_normals": True,            # smooth shading comes from per-polygon use_smooth
        "export_tangents": False,          # no normal maps in the file
        "export_materials": "EXPORT",
        "export_image_format": "AUTO",     # pack T_LEDWall_Sky; see load_images() for why
        "export_attributes": False,
        "export_vertex_color": "NONE",     # no colour attributes exist
        "export_cameras": True,            # 5.1 default is False
        "export_lights": True,             # 5.1 default is False; writes KHR_lights_punctual
        "export_import_convert_lighting_mode": "SPEC",  # watts -> glTF candela per the spec
        "export_extras": False,
        "export_hierarchy_flatten_objs": False,  # keep parenting; Wheel_Root must stay a pivot
        "export_gpu_instances": False,
        "export_shared_accessors": False,
        "export_animations": False,        # no actions, no animated object in the file
        "export_skins": False,
        "export_morph": False,
        "export_draco_mesh_compression_enable": False,  # no compression
        "export_use_gltfpack": False,                   # no compression, no simplification
        "use_mesh_edges": False,
        "use_mesh_vertices": False,
        "export_unused_images": False,
        "export_unused_textures": False,
        "will_save_settings": False,       # do not write settings back into the .blend
    }


def check_keywords(props: dict, keywords: dict) -> None:
    """Refuse to call the exporter with a keyword this Blender does not have."""
    unknown = sorted(set(keywords) - set(props))
    if unknown:
        raise SystemExit(f"exporter has no such keyword(s): {unknown}")
    for name, value in keywords.items():
        prop = props[name]
        if prop.type == "ENUM":
            valid = [item.identifier for item in prop.enum_items]
            if valid and value not in valid:
                raise SystemExit(f"{name}={value!r} is not one of {valid}")


def load_images() -> None:
    """Force every image with a resolvable file to load its pixels before the export.

    In background mode `image.has_data` is False for an image nobody has drawn yet, whether
    or not its file exists. Reading it as "the file is missing" and exporting with
    `export_image_format="NONE"` is what silently dropped `T_LEDWall_Sky` — the LED wall's
    3.3 MB sky — from an earlier export, leaving the wall a flat purple. Resolve the path
    and reload instead of trusting the flag.
    """
    for image in bpy.data.images:
        if image.source != "FILE" or not image.filepath:
            continue
        resolved = Path(bpy.path.abspath(image.filepath))
        if not resolved.is_file():
            print(f"[images] MISSING {image.name}: {resolved}")
            continue
        image.reload()
        print(f"[images] loaded {image.name}: {resolved} "
              f"({resolved.stat().st_size} bytes, {tuple(image.size)}, has_data={image.has_data})")


def scene_summary() -> None:
    """Print what is about to be exported, straight off the source scene."""
    scene = bpy.context.scene
    if scene.name != SCENE_NAME:
        raise SystemExit(f"active scene is {scene.name!r}, expected {SCENE_NAME!r}")
    objects = list(scene.objects)
    kinds = {}
    for obj in objects:
        kinds[obj.type] = kinds.get(obj.type, 0) + 1
    print(f"[scene] {scene.name}: {len(objects)} objects "
          + ", ".join(f"{k}={v}" for k, v in sorted(kinds.items())))
    print(f"[scene] {len(bpy.data.materials)} materials, "
          f"{len(bpy.data.scenes)} scene(s), {len(bpy.data.actions)} action(s)")
    modifiers = [(o.name, m.type) for o in objects for m in o.modifiers]
    print(f"[scene] {len(modifiers)} modifier(s) to apply: {modifiers}")
    for name in EMPTY_NAMES:
        obj = bpy.data.objects.get(name)
        if obj is None:
            raise SystemExit(f"source scene has no object {name!r}")
        loc, rot, scale = obj.matrix_world.decompose()
        print(f"[scene] empty {name}: blender world t={tuple(round(v, 6) for v in loc)} "
              f"q={tuple(round(v, 6) for v in rot)} s={tuple(round(v, 6) for v in scale)} "
              f"children={len(obj.children)}")


def run_export(output: Path, keywords: dict) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    print(f"[export] keywords: {json.dumps(keywords, indent=2, sort_keys=True)}")
    result = bpy.ops.export_scene.gltf(**keywords)
    if result != {"FINISHED"}:
        raise SystemExit(f"export_scene.gltf returned {result}")
    if not output.is_file():
        raise SystemExit(f"exporter reported success but {output} does not exist")
    print(f"[export] wrote {output} ({output.stat().st_size} bytes, "
          f"{output.stat().st_size / 1024 / 1024:.2f} MiB)")


def read_glb(path: Path) -> tuple:
    """Parse the GLB container. Returns (json chunk as dict, binary chunk length)."""
    data = path.read_bytes()
    if len(data) < 12:
        raise SystemExit(f"{path} is {len(data)} bytes, too short to be a GLB")
    magic, version, total = struct.unpack_from("<III", data, 0)
    if magic != GLB_MAGIC:
        raise SystemExit(f"{path} does not start with the glTF magic (got {magic:#x})")
    if version != 2:
        raise SystemExit(f"{path} is glTF container version {version}, expected 2")
    if total != len(data):
        raise SystemExit(f"{path} header length {total} != file size {len(data)}")
    offset = 12
    gltf = None
    bin_length = 0
    while offset < len(data):
        chunk_length, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        if offset + chunk_length > len(data):
            raise SystemExit(f"chunk of {chunk_length} bytes at {offset} runs past the file end")
        chunk = data[offset:offset + chunk_length]
        offset += chunk_length
        if chunk_type == CHUNK_JSON:
            gltf = json.loads(chunk.decode("utf-8"))
        elif chunk_type == CHUNK_BIN:
            bin_length = chunk_length
        else:
            print(f"[verify] ignoring unknown chunk type {chunk_type:#x} ({chunk_length} bytes)")
    if gltf is None:
        raise SystemExit(f"{path} has no JSON chunk")
    print(f"[verify] container ok: glTF {version}, JSON chunk parsed, "
          f"BIN chunk {bin_length} bytes")
    return gltf, bin_length


def node_local_matrix(node: dict) -> Matrix:
    if "matrix" in node:
        m = node["matrix"]  # glTF stores column-major
        return Matrix([[m[0], m[4], m[8], m[12]],
                       [m[1], m[5], m[9], m[13]],
                       [m[2], m[6], m[10], m[14]],
                       [m[3], m[7], m[11], m[15]]])
    translation = Matrix.Translation(Vector(node.get("translation", (0.0, 0.0, 0.0))))
    x, y, z, w = node.get("rotation", (0.0, 0.0, 0.0, 1.0))
    rotation = Quaternion((w, x, y, z)).to_matrix().to_4x4()
    sx, sy, sz = node.get("scale", (1.0, 1.0, 1.0))
    scale = Matrix.Diagonal((sx, sy, sz, 1.0))
    return translation @ rotation @ scale


def world_matrices(gltf: dict) -> dict:
    """glTF-space world matrix per node name, accumulated down the scene tree."""
    nodes = gltf.get("nodes", [])
    out = {}

    def walk(index: int, parent: Matrix) -> None:
        node = nodes[index]
        world = parent @ node_local_matrix(node)
        out[node.get("name", f"<node {index}>")] = world
        for child in node.get("children", []):
            walk(child, world)

    for scene in gltf.get("scenes", []):
        for root in scene.get("nodes", []):
            walk(root, Matrix.Identity(4))
    return out


def verify(gltf: dict, bin_length: int) -> None:
    """Check every invariant the Rust side and the manifest depend on."""
    asset = gltf.get("asset", {})
    print(f"[verify] asset: version={asset.get('version')} generator={asset.get('generator')!r}")
    print(f"[verify] extensionsUsed={gltf.get('extensionsUsed', [])} "
          f"extensionsRequired={gltf.get('extensionsRequired', [])}")

    scenes = gltf.get("scenes", [])
    nodes = gltf.get("nodes", [])
    meshes = gltf.get("meshes", [])
    materials = gltf.get("materials", [])
    print(f"[verify] {len(scenes)} scene(s) {[s.get('name') for s in scenes]}, "
          f"{len(nodes)} nodes, {len(meshes)} meshes, {len(materials)} materials, "
          f"{len(gltf.get('accessors', []))} accessors, "
          f"{len(gltf.get('images', []))} images, {len(gltf.get('textures', []))} textures, "
          f"{len(gltf.get('animations', []))} animations")

    if len(scenes) != 1:
        raise SystemExit(f"expected exactly one glTF scene, got {len(scenes)}")
    if scenes[0].get("name") != SCENE_NAME:
        raise SystemExit(f"glTF scene is named {scenes[0].get('name')!r}, expected {SCENE_NAME!r}")

    # One buffer, no external URI: the GLB must be self-contained.
    buffers = gltf.get("buffers", [])
    if len(buffers) != 1:
        raise SystemExit(f"expected one buffer, got {len(buffers)}")
    if "uri" in buffers[0]:
        raise SystemExit(f"buffer references an external file: {buffers[0]['uri']!r}")
    if buffers[0].get("byteLength", 0) > bin_length:
        raise SystemExit(f"buffer byteLength {buffers[0]['byteLength']} exceeds the "
                         f"{bin_length}-byte BIN chunk")

    if "KHR_draco_mesh_compression" in gltf.get("extensionsUsed", []):
        raise SystemExit("Draco compression is present; the export must be uncompressed")

    # Names.
    names = [node.get("name") for node in nodes]
    missing = [name for name in REQUIRED_NODES if name not in names]
    if missing:
        raise SystemExit(f"nodes missing from the GLB (renamed or dropped?): {missing}")
    mangled = [n for n in names if n and (n.endswith(".001") or n.startswith("Object_"))]
    if mangled:
        raise SystemExit(f"node names look mangled: {mangled[:10]}")

    material_names = [m.get("name") for m in materials]
    bad = [n for n in material_names if not (n or "").startswith(MATERIAL_PREFIX)]
    if bad:
        raise SystemExit(f"material names do not all start with {MATERIAL_PREFIX!r}: {bad}")
    if len(material_names) != EXPECTED_MATERIALS:
        print(f"[verify] NOTE {len(material_names)} materials, expected {EXPECTED_MATERIALS}")
    print(f"[verify] materials: {sorted(material_names)}")
    for material in sorted(materials, key=lambda m: m.get("name") or ""):
        pbr = material.get("pbrMetallicRoughness", {})
        print(f"[verify]   {material.get('name')}: "
              f"base={pbr.get('baseColorFactor', [1, 1, 1, 1])} "
              f"metallic={pbr.get('metallicFactor', 1.0)} "
              f"roughness={pbr.get('roughnessFactor', 1.0)} "
              f"emissive={material.get('emissiveFactor', [0, 0, 0])} "
              f"alphaMode={material.get('alphaMode', 'OPAQUE')} "
              f"ext={material.get('extensions', {})}")

    # Names must survive one-to-one: the Rust side matches objects by name.
    scene_objects = {obj.name for obj in bpy.context.scene.objects}
    node_names = {name for name in names if name}
    if node_names != scene_objects:
        raise SystemExit(f"node names do not match the scene objects. "
                         f"only in GLB: {sorted(node_names - scene_objects)}; "
                         f"only in blend: {sorted(scene_objects - node_names)}")
    print(f"[verify] all {len(node_names)} node names equal the Blender object names")

    # The spin pivot and its children.
    pivot = nodes[names.index(SPIN_PIVOT)]
    children = pivot.get("children", [])
    if "mesh" in pivot:
        raise SystemExit(f"{SPIN_PIVOT} carries a mesh; it must stay a bare pivot node")
    if len(children) != SPIN_CHILD_COUNT:
        raise SystemExit(f"{SPIN_PIVOT} has {len(children)} children, expected {SPIN_CHILD_COUNT}")
    print(f"[verify] {SPIN_PIVOT} is a childed pivot with {len(children)} children, "
          f"local={ {k: v for k, v in pivot.items() if k in ('translation', 'rotation', 'scale', 'matrix')} }")

    # Transforms in glTF space, for the manifest: the empties, the flapper hinge, the
    # camera and every light object.
    worlds = world_matrices(gltf)
    reportable = list(EMPTY_NAMES) + ["Pointer_Flapper"]
    reportable += [obj.name for obj in bpy.context.scene.objects
                   if obj.type in {"CAMERA", "LIGHT"}]
    for name in reportable:
        if name not in worlds:
            raise SystemExit(f"{name} is not reachable in the glTF scene tree")
        loc, rot, scale = worlds[name].decompose()
        print(f"[verify] gltf world {name}: t={tuple(round(v, 6) for v in loc)} "
              f"q(wxyz)={tuple(round(v, 6) for v in rot)} s={tuple(round(v, 6) for v in scale)}")

    # Cameras and punctual lights.
    cameras = gltf.get("cameras", [])
    print(f"[verify] {len(cameras)} camera(s): {cameras}")
    if not cameras:
        raise SystemExit("no camera in the GLB; export_cameras did not take effect")
    lights = gltf.get("extensions", {}).get("KHR_lights_punctual", {}).get("lights", [])
    print(f"[verify] {len(lights)} KHR_lights_punctual light(s)")
    for light in lights:
        print(f"[verify]   {light.get('name')}: type={light.get('type')} "
              f"intensity={light.get('intensity')} color={light.get('color')} "
              f"spot={light.get('spot')}")
    if not lights:
        raise SystemExit("no punctual lights in the GLB; export_lights did not take effect")
    # KHR_lights_punctual has no area light, so Blender's AREA lights carry no light data
    # even though their nodes are exported. `assets/scene.json` is the only source for them.
    exported_lights = {light.get("name") for light in lights}
    for obj in bpy.context.scene.objects:
        if obj.type == "LIGHT" and obj.name not in exported_lights:
            print(f"[verify] DROPPED light {obj.name} ({obj.data.type}): node kept, "
                  f"no KHR_lights_punctual data. It must come from the manifest.")

    # Geometry: triangles only, and the evaluated triangle count.
    accessors = gltf.get("accessors", [])
    primitives = 0
    triangles = 0
    for mesh in meshes:
        for primitive in mesh.get("primitives", []):
            primitives += 1
            mode = primitive.get("mode", MODE_TRIANGLES)
            if mode != MODE_TRIANGLES:
                raise SystemExit(f"mesh {mesh.get('name')!r} has a primitive with mode {mode}")
            attributes = primitive.get("attributes", {})
            for required in ("POSITION", "NORMAL", "TEXCOORD_0"):
                if required not in attributes:
                    raise SystemExit(f"mesh {mesh.get('name')!r} primitive lacks {required}")
            if "indices" in primitive:
                count = accessors[primitive["indices"]]["count"]
            else:
                count = accessors[attributes["POSITION"]]["count"]
            if count % 3:
                raise SystemExit(f"mesh {mesh.get('name')!r} has {count} indices, not a multiple of 3")
            triangles += count // 3
    mesh_nodes = sum(1 for node in nodes if "mesh" in node)
    print(f"[verify] {mesh_nodes} nodes carry a mesh, {primitives} primitives, "
          f"{triangles} triangles")
    if triangles != EXPECTED_TRIANGLES:
        print(f"[verify] NOTE triangle count differs from the audited {EXPECTED_TRIANGLES}")
    print("[verify] all invariants hold")


def main() -> None:
    output = parse_output_path(list(sys.argv))
    props = exporter_properties()
    keywords = export_keywords(output)
    check_keywords(props, keywords)
    load_images()
    scene_summary()
    run_export(output, keywords)
    gltf, bin_length = read_glb(output)
    verify(gltf, bin_length)
    try:
        shown = output.relative_to(crate_root())
    except ValueError:
        shown = output
    print(f"[done] {shown} {output.stat().st_size} bytes; the .blend was not written")


if __name__ == "__main__":
    main()
