# Blender export notes — `assets/wheel_stage.glb`

Agent D. Blender 5.1.2 (`ec6e62d40fa9`), exporter `Khronos glTF Blender I/O v5.1.20`.
The .blend was never written; its mtime is unchanged.

Everything below was measured from the export run and from the GLB on disk.

## 1. Reproduce

Run from the crate root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background \
  ../../unity/blender-assets/wheel_stage.blend \
  --python tools/export_gltf.py
```

The path used in the actual run, verbatim:

```sh
cd /Users/aleh_kaportsau/Projects/harwex-mono/rust/game-show-v1 && \
/Applications/Blender.app/Contents/MacOS/Blender --background \
  /Users/aleh_kaportsau/Projects/harwex-mono/unity/blender-assets/wheel_stage.blend \
  --python tools/export_gltf.py
```

The output path is optional and comes after `--`:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background <blend> \
  --python tools/export_gltf.py -- renders/probe.glb
```

Without that argument the script writes `assets/wheel_stage.glb`. A relative path is
resolved against the crate root, which the script derives from `__file__`
(`<crate>/tools/export_gltf.py`), so the script holds no absolute path. It creates the
output directory if it is missing.

The script exits 0 only when every invariant in section 7 holds. Any failure raises
`SystemExit` with a message and Blender exits non-zero.

## 2. Result

| Measure | Value |
| --- | --- |
| File | `assets/wheel_stage.glb` |
| Size | **7 312 960 bytes (6.97 MiB)** |
| JSON chunk | 166 839 bytes |
| BIN chunk | 7 162 176 bytes, one buffer, no `uri` — self-contained |
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
| Images / textures | 0 / 0 |
| Animations | 0 |
| `extensionsUsed` | `KHR_materials_emissive_strength`, `KHR_lights_punctual` |
| `extensionsRequired` | `KHR_lights_punctual` |
| glTF export time | 0.17 s |

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
| `export_image_format` | `"NONE"` | the only image has no data on disk; see section 6 |
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
| `export_unused_images` | `False` | nothing to carry |
| `export_unused_textures` | `False` | nothing to carry |
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

## 6. What the exporter dropped

1. **Four AREA lights lost their light data.** `KHR_lights_punctual` has no area light, so
   the exporter logged `WARNING: Unsupported light source AREA` four times and wrote no
   light for `Key_Wheel`, `Rim_L`, `Rim_R` and `Fill_Front`. Their **nodes survive** with
   correct transforms, which is where section 5's positions and directions come from. A
   re-import turns those four nodes into empties. `assets/scene.json` must carry all six
   lights; that was already the plan, because `three-d-asset` reads no lights at all.
2. **No images, no textures.** `export_image_format="NONE"`. The file's only image,
   `T_LEDWall_Sky`, has `has_data == False` — the PNG is missing from disk (audit §10), so
   there was nothing to embed. Exporting it would have produced a broken or empty image in
   the GLB. `MAT_LED_Screen` kept its literal `baseColorFactor` of `(0.35, 0.3, 0.6, 1)`;
   the missing texture did not clobber it. `src/screen.rs` supplies the sky procedurally,
   so nothing is lost.
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
   | `MAT_LED_Screen` | `(0.525, 0.45, 0.9)` | absent (1.0) | `(0.525, 0.45, 0.9)` |

   The plan's emission strengths (3.0, 6.0, 1.2, 1.5) multiplied by each base colour give
   exactly the effective column, so nothing was lost in the .blend — only at import.
   Whoever maps materials must re-apply the strength, from the manifest or by the wrapper
   trick in `docs/three_d_api.md` §5.
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
- `Wheel_Root` carries no mesh and has exactly 56 children;
- the three empties and `Pointer_Flapper` are reachable in the scene tree;
- at least one camera and at least one punctual light exist;
- every primitive has mode 4 (`TRIANGLES`) and `POSITION`, `NORMAL` and `TEXCOORD_0`;
- every index count is a multiple of 3.

It prints, and does not fail on, a triangle count that differs from the audited 153 392 and
a material count that differs from 19.

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

Two runs of the same command produce the same file size and a byte-identical JSON chunk;
`json.loads` of both gives equal dicts. The binary chunk differs in **45 float32 values out
of 1.79 million**, by at most `1.19e-7`, which is one ULP at that magnitude. All 45 are
`TEXCOORD_0` values on `Wheel_Legs` and `Podium_Trim`, two of the five bevelled objects, so
the jitter comes from bevel UV generation, not from the exporter. No position, normal or
index byte moved.

Do not treat a GLB checksum as a build fingerprint. Compare counts and names instead, which
is what section 7 checks.

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
