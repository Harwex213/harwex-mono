# Blender export notes — `assets/wheel_stage.glb`

Agent D. Blender 5.1.2 (`ec6e62d40fa9`), exporter `Khronos glTF Blender I/O v5.1.20`.

The .blend was never written. Checked around every run in this document: its mtime is
`2026-07-29 23:54:20` before and after, its size 2 567 518 bytes, and its MD5
`f8e1d873ea3218fe89ad8638e12b0d51` — all unchanged. The script calls no `save_mainfile` and
no `save_as_mainfile`, and `will_save_settings=False` keeps the exporter from writing its own
settings back into the file. Verify the same way after any change here; the Unity project
shares this file.

Everything below was measured from the export run and from the GLB on disk.

## 1. Reproduce

The caller supplies the Blender binary and the .blend. Neither this document nor
`tools/export_gltf.py` names a path to either: `docs/agent_plan.md` forbids an absolute
path from that document appearing in committed source. Discover both at run time instead.

Run from the crate root:

```sh
BLENDER=${BLENDER:-$(command -v blender)}
BLEND="$(git rev-parse --show-toplevel)/unity/blender-assets/wheel_stage.blend"

"$BLENDER" --background "$BLEND" --python tools/export_gltf.py
```

`$BLENDER` must be a Blender 5.1 executable; section 3 says why the version matters. On
macOS that executable is `Contents/MacOS/Blender` inside the `Blender.app` bundle, wherever
that bundle is installed, and it is not on `PATH` by default — set `BLENDER` yourself when
`command -v blender` finds nothing. `$BLEND` is `wheel_stage.blend` under
`unity/blender-assets/` in this repository, resolved from the repository root rather than
written out — the same file the Unity project opens, which is why invariant 1 forbids saving
it. Substitute your own locations if your layout differs; nothing downstream depends on where
either one lives.

The output path is optional and comes after `--`:

```sh
"$BLENDER" --background "$BLEND" --python tools/export_gltf.py -- renders/probe.glb
```

Without that argument the script writes `assets/wheel_stage.glb`. A relative path is
resolved against the crate root, which the script derives from `__file__`
(`<crate>/tools/export_gltf.py`), so the script holds no absolute path. It creates the
output directory if it is missing.

Then validate the file independently. The validator needs no Blender:

```sh
python3 tools/validate_export.py -v
```

The export script exits 0 only when every invariant in section 7 holds. Any failure raises
`SystemExit` with a message and Blender exits non-zero.

## 2. Result

Re-measured on 2026-07-30 from a fresh run of the command in section 1.

| Measure | Value |
| --- | --- |
| File | `assets/wheel_stage.glb` |
| Size | **10 654 664 bytes (10.16 MiB)** |
| JSON chunk | 151 020 bytes |
| BIN chunk | 10 503 616 bytes, one buffer, no `uri` — self-contained |
| glTF | 2.0, container version 2 |
| Scenes | 1, named `Stage`, 57 root nodes |
| Nodes | 163, one per Blender object, names identical |
| Meshes | 153 |
| Primitives | **179** (153 + 26 extra material slots) |
| Triangles | **153 392** — matches the audited evaluated count exactly |
| Primitive vertices | 196 425 (Blender's 79 052 split per unique normal/UV) |
| Indices | `UNSIGNED_SHORT` on all 179 primitives |
| Accessors / bufferViews | 657 / 657, every POSITION accessor has `min`/`max` |
| Materials | 19, names unchanged |
| Cameras | 1 (`Cam_Hero`) |
| Punctual lights | 2 (`Beam_L`, `Beam_R`) — see section 5 |
| Images / textures / samplers | **1 / 2 / 1** — `T_LEDWall_Sky`, see section 6 |
| Animations | 0 |
| `extensionsUsed` | `KHR_materials_emissive_strength`, `KHR_lights_punctual` |
| `extensionsRequired` | `KHR_lights_punctual` |
| glTF export time | 0.17 s |

The size grew from the 7 312 960 bytes an earlier revision of this document recorded. The
whole difference is the embedded sky: the image's `bufferView` is 3 341 439 bytes at offset
418 240, which is `T_LEDWall_Sky.png` byte for byte. That earlier export dropped it; section
6.2 has the story.

Every one of the five BEVEL modifiers baked: 153 392 triangles is the evaluated count from
`docs/scene_audit.md` §9, not the raw 150 048.

## 3. Exporter keywords used

Blender 5.1's `export_scene.gltf` exposes **109** properties. The script prints all of them
with type and default before it exports, and it refuses to run if a keyword it wants is
absent or an enum value is invalid. Three 5.1 defaults matter:

- **`export_apply` defaults to `False`.** Older Blender defaulted to `True`.
  `docs/scene_audit.md` §5 says the exporter applies modifiers by default; on 5.1 that is
  wrong. Leaving it alone drops all five bevels.
- **`export_cameras` and `export_lights` both default to `False`.**
- `export_format` is a dynamic enum. `get_rna_type().properties` reports its items as
  empty, and Blender logs `WARNING current value '0' matches no enum`. The valid
  identifiers come from `get_format_items` in the addon: `GLB`, `GLTF_SEPARATE`, and
  `GLTF_EMBEDDED` when an addon preference allows it.

The exact keyword set passed, and why:

| Keyword | Value | Why |
| --- | --- | --- |
| `filepath` | output path | from the argument after `--` |
| `check_existing` | `False` | overwrite without a file-browser prompt |
| `export_format` | `"GLB"` | one self-contained binary |
| `use_active_scene` | `True` | the single `Stage` scene only |
| `use_selection` | `False` | whole scene |
| `use_visible` | `False` | nothing in the file is hidden (audit §8) |
| `use_renderable` | `False` | same |
| `use_active_collection` | `False` | all collections |
| `export_apply` | `True` | bake the five BEVEL modifiers |
| `export_yup` | `True` | Blender Z-up to glTF Y-up; see section 4 |
| `export_texcoords` | `True` | every mesh has one UV layer `UVMap` |
| `export_normals` | `True` | smooth shading is per-polygon, not custom normals |
| `export_tangents` | `False` | no normal maps anywhere |
| `export_materials` | `"EXPORT"` | real materials, not placeholders |
| `export_image_format` | `"AUTO"` | embed `T_LEDWall_Sky`; see section 6.2 for why not `"NONE"` |
| `export_attributes` | `False` | no generic attributes in the file |
| `export_vertex_color` | `"NONE"` | no colour attributes exist |
| `export_cameras` | `True` | `Cam_Hero` |
| `export_lights` | `True` | KHR_lights_punctual |
| `export_import_convert_lighting_mode` | `"SPEC"` | spec-correct photometric units |
| `export_extras` | `False` | no custom properties are needed |
| `export_hierarchy_flatten_objs` | `False` | keep parenting; `Wheel_Root` must stay a pivot |
| `export_gpu_instances` | `False` | no shared mesh datablocks to instance |
| `export_shared_accessors` | `False` | keeps primitives independent |
| `export_animations` | `False` | no actions, nothing animated |
| `export_skins` | `False` | no armatures |
| `export_morph` | `False` | no shape keys |
| `export_draco_mesh_compression_enable` | `False` | no compression |
| `export_use_gltfpack` | `False` | no compression, no simplification |
| `use_mesh_edges` | `False` | no loose edges wanted |
| `use_mesh_vertices` | `False` | no loose points wanted |
| `export_unused_images` | `False` | keeps the unused, missing `wheel_stage.png` out; see 6.2 |
| `export_unused_textures` | `False` | same — only textures a material uses are written |
| `will_save_settings` | `False` | never write export settings back into the .blend |

## 4. Up axis: the conversion ran

`export_yup=True`, so the GLB is **Y-up**. Blender's own frame is Z-up. The exporter
applies

```
(x, y, z)_blender  ->  (x, z, -y)_gltf
```

to every position and every node transform. That is a proper rotation, `Rx(-90 deg)`, with
determinant +1, so winding order and handedness are unchanged.

Checked against the GLB, not assumed:

| Object | Blender world | glTF world (read from the GLB) |
| --- | --- | --- |
| `Wheel_Root` | `(0, 1.2, 3.5)` | `(0, 3.5, -1.2)` |
| `Wheel_Stand` | `(0, 1.2, 0)` | `(0, 0, -1.2)` |
| `Crest_Root` | `(0, 0.55, 6.1)` | `(0, 6.1, -0.55)` |
| `Pointer_Flapper` | `(0, 0.795, 6.22)` | `(0, 6.22, -0.795)` |
| `Cam_Hero` | `(0, -6.4, 1)` | `(0, 1, 6.4)` |
| `Key_Wheel` | `(0, -5, 6)` | `(0, 6, 5)` |

**Consequences. Read these before writing `assets/scene.json`, `src/scene.rs` or
`src/spin.rs`.**

Every number in `agent_plan.md` and in `docs/scene_audit.md` is in Blender's Z-up frame.
The geometry in the GLB is not. Pick one of two coherent options and say which in
`assets/scene.json`:

- **A. Stay in glTF space.** Map every manifest value with `(x, y, z) -> (x, z, -y)`. World
  up becomes `(0, 1, 0)`. Section 5 already lists the converted camera and lights.
- **B. Rotate the model back.** Apply one `Rx(+90 deg)` to every imported node's world
  matrix, then use the audit's Z-up numbers unchanged with up `(0, 0, 1)`. Costs one matrix
  multiply per part at load, and keeps every measured number in this repo directly usable.

Axis mapping for direction vectors and rotation axes:

| Blender | glTF |
| --- | --- |
| `+X` | `+X` |
| `+Y` | `-Z` |
| `+Z` | `+Y` |

So the **spin axis is glTF `-Z`** (equivalently the wheel disc lies in the glTF XY plane
and spins about local Z). A rotation of `phi` about Blender `+Y` equals a rotation of
`-phi` about glTF `+Z`. The audit's sense still holds after the sign flip: positive `phi`
about Blender `+Y` reads clockwise from the hero camera, so in glTF space
`Rz(-phi)` is that same clockwise spin. Under option B the axis is Blender `+Y` again.

The flapper deflects about the same axis as the wheel spins, so the same sign rule applies
to `psi`.

## 5. Camera and lights in the GLB, and in glTF space

`three-d-asset` 0.10.0 reads neither cameras nor lights out of a GLB
(`docs/three_d_api.md` §2), so these are exported for completeness and for other tools.
`assets/scene.json` remains the only source the Rust app uses. The values are recorded here
in glTF space so agent E and agent H do not have to redo the conversion.

`Cam_Hero`, as written into the GLB:

```
perspective: yfov 0.86305637367838 rad, aspectRatio 1.7768331562167907,
             znear 0.05, zfar 200
```

That `yfov` is the audit's derived vertical FOV, 49.449488 deg. Blender wrote the right
one; it did **not** use `camera.angle_y`.

Camera basis in glTF space, computed from the node quaternion, glTF cameras look down
local `-Z`:

| | glTF |
| --- | --- |
| position | `(0, 1, 6.4)` |
| forward (`-Z`) | `(0, 0.275637, -0.961262)` |
| up (`+Y`) | `(0, 0.961262, 0.275637)` |
| world up for an orbit | `(0, 1, 0)` |
| hero orbit target | `(0, 3.203633, -1.284982)`, radius 7.994682 m |

Light nodes in glTF space. Blender lights point down local `-Z` and glTF punctual lights do
too, so `forward` is the light direction as three-d wants it:

| Light | Blender type | glTF position | glTF direction |
| --- | --- | --- | --- |
| `Key_Wheel` | AREA 900 W | `(0, 6, 5)` | `(0, -0.515662, -0.856792)` |
| `Beam_L` | SPOT 2500 W | `(-6.5, 7.2, 3)` | `(0.479457, -0.767130, -0.426184)` |
| `Beam_R` | SPOT 2500 W | `(6.5, 7.2, 3)` | `(-0.479457, -0.767130, -0.426184)` |
| `Rim_L` | AREA 400 W | `(-8, 3.5, -3.5)` | `(0.928899, -0.087084, 0.359948)` |
| `Rim_R` | AREA 400 W | `(8, 3.5, -3.5)` | `(-0.928899, -0.087084, 0.359948)` |
| `Fill_Front` | AREA 120 W | `(0, 2, 7.5)` | `(0, -0.066519, -0.997785)` |

The two spots are the only lights with `KHR_lights_punctual` data:

```
Beam_L / Beam_R: type spot, color (0.72, 0.36, 1.0),
                 intensity 135878.53266470565,
                 innerConeAngle 0.14398966, outerConeAngle 0.19198622
```

`outerConeAngle` is the half angle, so it is Blender's `spot_size / 2` =
0.38397 / 2 rad. `innerConeAngle` is `outer * (1 - blend)` = `0.19199 * 0.75`. The
intensity is **candela**, converted from 2500 W by the `SPEC` lighting mode. `three-d`'s
`intensity` is a dimensionless multiplier, so do not feed 135 878 into it. Convert from the
Blender watts in `agent_plan.md` instead, as agent H's own doc requires.

## 6. What the exporter dropped, and what it no longer drops

Item 2 was a real drop and is now fixed, so read it as history plus the current state.

1. **Four AREA lights lost their light data.** `KHR_lights_punctual` has no area light, so
   the exporter logged `WARNING: Unsupported light source AREA` four times and wrote no
   light for `Key_Wheel`, `Rim_L`, `Rim_R` and `Fill_Front`. Their **nodes survive** with
   correct transforms, which is where section 5's positions and directions come from. A
   re-import turns those four nodes into empties. `assets/scene.json` must carry all six
   lights; that was already the plan, because `three-d-asset` reads no lights at all.
2. **The sky texture is exported. It was dropped once, by a bug in this script.** An
   earlier revision passed `export_image_format="NONE"` and this section claimed the PNG was
   missing from disk. It is not missing. The reasoning was wrong: in background mode
   `image.has_data` is `False` for any image nobody has drawn yet, whether or not its file
   exists, and that flag was read as "the file is gone".

   `load_images()` now resolves each image's path with `bpy.path.abspath` and calls
   `image.reload()` before the export, so `has_data` is `True` by the time the exporter looks.
   The run logs what it loaded:

   ```
   [images] loaded T_LEDWall_Sky: <repo>/unity/GameShow_v3/Assets/Art/Textures/T_LEDWall_Sky.png
            (3341439 bytes, (4096, 1024), has_data=True)
   [images] MISSING wheel_stage.png: <repo>/unity/Ref/wheel_stage.png
   ```

   The result in the GLB: **1 image, 2 textures, 1 sampler.** One embedded PNG, referenced
   twice — as `MAT_LED_Screen`'s `baseColorTexture` and as its `emissiveTexture`. The
   material therefore has **no** `baseColorFactor`; the texture supplies base colour, and the
   old literal `(0.35, 0.3, 0.6, 1)` is gone from the file. Anything that still reads that
   literal is reading a value the GLB no longer carries.

   `wheel_stage.png` really is missing, and that is harmless. It is the author's reference
   backdrop, used by no material, and `export_unused_images=False` means it is never
   considered for embedding. The image count stays 1.

   **Consequence:** the author's own sky is the primary path for `Wall_Screen`, and a
   procedural sky is the fallback. That reverses the decision in `docs/agent_plan.md`'s
   "Decisions already made", which was taken while the texture appeared to be missing. Show
   the texture as the mesh's own `UVMap` addresses it. `assets/scene.json`'s `screen` block
   is the authority on this.
3. **Emission strengths are in an extension `three-d-asset` ignores.** The exporter
   normalises `emissiveFactor` to a maximum of 1 and puts the rest in
   `KHR_materials_emissive_strength`. `three-d-asset` 0.10.0 never reads that extension
   (`docs/three_d_api.md` §2), so the importer sees only the normalised factor. Effective
   emission is `emissiveFactor * emissiveStrength`:

   | Material | `emissiveFactor` in the GLB | `emissiveStrength` | Effective emission |
   | --- | --- | --- | --- |
   | `MAT_Bulb_Glass` | `(1, 0.93, 0.74)` | 3.0 | `(3.0, 2.79, 2.22)` |
   | `MAT_Lens_Glow` | `(1, 0.95, 0.82)` | 6.0 | `(6.0, 5.7, 4.92)` |
   | `MAT_Crystal` | `(0.894737, 0.631579, 1)` | 1.14 | `(1.02, 0.72, 1.14)` |
   | `MAT_LED_Screen` | `(1, 1, 1)` + `emissiveTexture` | **1.5** | texture x 1.5 |

   The plan's emission strengths (3.0, 6.0, 1.2, 1.5) multiplied by each base colour give
   exactly the effective column, so nothing was lost in the .blend — only at import.
   Whoever maps materials must re-apply the strength, from the manifest or by the wrapper
   trick in `docs/three_d_api.md` §5.

   `MAT_LED_Screen` is the case to watch. Its emission is a texture rather than a colour, so
   the factor is a flat `(1, 1, 1)` and the entire brightness lives in the extension. An
   importer that ignores `KHR_materials_emissive_strength` shows the wall at 1.0 instead of
   1.5 and nothing else looks wrong, which is a silent 33% dim. Both scripts now assert the
   strength is exactly 1.5 rather than only printing it, so that regression cannot pass.

   `MAT_Crystal`'s strength is 1.14 in the GLB, not the plan's 1.2, because the exporter
   normalised the factor's maximum to 1: `1.2 x 0.95 = 1.14`. Multiply the two back together
   and the .blend's value returns. That is arithmetic, not drift.
4. **No animations, no skins, no morph targets.** There are none in the file.
5. **Nothing else.** No node, no material and no mesh was dropped or renamed.

### Empties survived — no manifest workaround needed

All three empties are present as childless-of-geometry pivot nodes, with the transforms
above and the right children:

| Empty | glTF node | children in the GLB |
| --- | --- | --- |
| `Wheel_Root` | `{"name": "Wheel_Root", "translation": [0, 3.5, -1.2]}`, no mesh | **56** |
| `Wheel_Stand` | `{"translation": [0, 0, -1.2]}`, no mesh | 4 |
| `Crest_Root` | `{"translation": [0, 6.1, -0.55]}`, no mesh | 4 |

All three have identity rotation and unit scale in the GLB, exactly as in Blender. The
`Wheel_Root` subtree is intact, so one rotation on that node spins the 56 meshes and
nothing else. `Pointer_Flapper` keeps its local offset under `Crest_Root`,
`translation [0, 0.11999989, -0.245]`, which is Blender's `(0, 0.245, 0.120)` mapped.

Note for `src/scene.rs`: `three-d-asset` flattens a `CpuModel` and loses these names, so
walk a `CpuScene` and keep the nearest named ancestor, as `docs/three_d_api.md` §2 shows.
The pivot node itself carries no geometry, so it appears in the tree but never as a
`Primitive`. To spin the wheel, either record `Wheel_Root`'s world transform and its
inverse, or take the transforms straight from this document.

## 7. Verification, and what the script checks

The script re-reads the GLB from disk after writing it. It parses the container by hand —
magic, container version, declared length against the file size, then every chunk — and
`json.loads` the JSON chunk. It then fails the run unless all of the following hold:

- exactly one scene, named `Stage`;
- exactly one buffer, with no `uri`, whose `byteLength` fits the BIN chunk;
- no `KHR_draco_mesh_compression` in `extensionsUsed`;
- every name in `REQUIRED_NODES` is present: `Wheel_Root`, `Wheel_Stand`, `Crest_Root`,
  `Wall_Screen`, `Pointer_Flapper`, `Wheel_Rim`, `Wheel_Pegs`, `Wheel_Sector_01`,
  `Wheel_Sector_48`, `Podium_Riser`, `Cam_Hero`;
- the set of glTF node names equals the set of Blender object names in the scene, so no
  name was mangled, suffixed or dropped — all 163 match;
- no node name ends in `.001` and none starts with `Object_`;
- every material name starts with `MAT_`;
- there are exactly 19 materials;
- `Wheel_Root` carries no mesh and has exactly 56 children;
- the three empties and `Pointer_Flapper` are reachable in the scene tree;
- at least one camera and at least one punctual light exist;
- every primitive has mode 4 (`TRIANGLES`) and `POSITION`, `NORMAL` and `TEXCOORD_0`;
- every index count is a multiple of 3;
- the triangle count is exactly the audited 153 392;
- `MAT_LED_Screen` carries a `baseColorTexture`, an `emissiveTexture`, and
  `KHR_materials_emissive_strength` with `emissiveStrength` 1.5.

Every one of those raises `SystemExit`. The last three used to be weaker: the material count
and the triangle count printed a `[verify] NOTE` and let the run succeed, while `verify()`'s
docstring claimed it checked every invariant, and no script checked the emissive strength at
all. All three now fail the export. Verified by re-running the export three times against a
copy of the script with one expectation deliberately wrong; each run exited 1 with the
matching message.

A failure here means the export is wrong. Fix `tools/export_gltf.py` or the .blend — do not
relax the number. If a change to the geometry is deliberate, update the expectation *and* say
so in this document, which is what section 2 is for.

`tools/validate_export.py` re-checks the same facts from the file alone, with no Blender, and
passes **34 checks** on the current GLB. It is the cheaper gate; run it after any export.

An independent read-back was also run: `bpy.ops.import_scene.gltf` in a fresh
`--factory-startup` Blender. It returned `{'FINISHED'}` and, after subtracting the startup
file's cube, camera and light, produced 153 meshes, 153 392 triangles, 196 425 vertices,
19 materials with unchanged names, one UV layer named `UVMap`, `Wheel_Root` back at
`(0, 1.2, 3.5)` with 56 children, `Pointer_Flapper` back at `(0, 0.795, 6.22)`, and a scene
bounding box of `(-11.98, -11.98)` to `(11.98, 11.98)` in the horizontal axes. That
exercises the accessors and the binary chunk, not just the JSON. `agent_plan.md` invariant 8
allows this: both runs were `blender --background`, one at a time.

The four AREA light nodes come back as empties on that read-back, which is the same finding
as section 6.1 seen from the importer's side.

## 8. The export is reproducible to within one ULP

Re-measured on 2026-07-30 between two runs of the section 1 command:

| Compared | Result |
| --- | --- |
| File size | identical, 10 654 664 bytes both times |
| JSON chunk | **byte-identical**, 151 020 bytes; `json.loads` of both gives equal dicts |
| Embedded PNG bytes | **byte-identical**, all 3 341 439 |
| Index accessors | **byte-identical**, no integer value moved |
| Float accessors | **27 float32 values out of 2 009 688** differ, by at most `1.192e-07` |

`1.192e-07` is one ULP at that magnitude. All 27 are `TEXCOORD_0` values, 24 on `Wheel_Legs`
and 3 on `Podium_Trim` — two of the five bevelled objects — so the jitter comes from bevel UV
generation, not from the exporter. No position, normal or index value moved. An earlier
revision measured 45 such values on the pre-texture export; the count varies between run
pairs, the character of the difference does not.

Do not treat a GLB checksum as a build fingerprint. Compare counts and names instead, which
is what section 7 checks.

Note for anyone re-doing this measurement: the BIN chunk now holds the embedded PNG, so
reading the whole chunk as an array of float32 is meaningless. PNG bytes reinterpreted that
way produce `NaN`, and `NaN != NaN` reports thousands of spurious differences. Walk the
`accessors` and compare each one in its own component type, and compare the image's
`bufferView` range as bytes.

## 9. One risk to watch

`extensionsRequired` contains `KHR_lights_punctual`. The `gltf` crate validates required
extensions against the ones its features enable, and `three-d-asset` 0.10.0 does enable
`KHR_lights_punctual` (`docs/three_d_api.md` §1), so the GLB should load. If
`load_and_deserialize` ever fails with an unsupported-extension or validation error, the
one-line fix is `export_lights=False` in `tools/export_gltf.py`: the extension then
disappears from `extensionsRequired`, and nothing is lost, because `three-d-asset` reads no
lights anyway and section 5 records every light value. Re-run the command in section 1
after the change.

`KHR_materials_emissive_strength` is only in `extensionsUsed`, so no importer can reject
the file over it.
