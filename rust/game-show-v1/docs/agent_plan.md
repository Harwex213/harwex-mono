# wheel_stage in Rust + three-d — agent contract

Every agent working on this project reads this file first and obeys it. It holds the
invariants, the ground truth measured from the Blender scene, and the module ownership map.

Goal: a Rust application using the `three-d` crate that renders the Blender scene
`wheel_stage.blend` and looks like `docs/wheel_stage.png`.

## Paths

| What | Path |
| --- | --- |
| Crate root | `/Users/aleh_kaportsau/Projects/harwex-mono/rust/game-show-v1` |
| Reference image | `<crate>/docs/wheel_stage.png` (1672x941) |
| Blender file | `/Users/aleh_kaportsau/Projects/harwex-mono/unity/blender-assets/wheel_stage.blend` |
| Blender binary | `/Applications/Blender.app/Contents/MacOS/Blender` (version 5.1) |
| Export script | `<crate>/tools/export_gltf.py` |
| Exported model | `<crate>/assets/wheel_stage.glb` |
| Scene manifest | `<crate>/assets/scene.json` |
| Render output | `<crate>/renders/` (gitignored) |

All paths inside Rust code and inside the export script are relative to the crate root.
No absolute path from this document may appear in committed source.

## Invariants

1. **Never save the .blend.** The Unity project shares this file. The export script runs
   `blender --background` on a copy of the process state and exits without saving. Never
   call `bpy.ops.wm.save_mainfile`. Never call `save_as_mainfile`.
2. **Do not model geometry from scratch.** Every mesh comes out of Blender. If something is
   missing from the render, the fix is in the export or in the material mapping, never a
   hand-authored primitive in Rust.
3. **No stubs in delivered code.** A function that returns a placeholder, an empty `Vec`, or
   a `todo!()` is a failure, not progress. Say so in your report instead of faking it.
4. **Judge the look on image crops.** Compare rendered crops against reference crops by
   looking at them. Do not tune the renderer to match a histogram, a mean brightness, or any
   other single number. That approach has degraded this scene before. Numbers may describe a
   defect; they may never define success.
5. **Own only your files.** The ownership map below is binding. Editing a file you do not own
   loses another agent's work.
6. **`cargo check` must pass** when you finish. If your change cannot compile alone, say so
   in `blockers` rather than leaving broken code.
7. **The app runs offline.** No network access at runtime, no downloaded assets.
8. **Only one process touches Blender at a time**, and only through
   `blender --background`. Do not use the Blender MCP tools; a human has that session open.
9. **Persist your findings to disk before you finish.** Write the file you own in the
   ownership map, and write it before you write your final report. Later agents read your
   file off the disk; the report only points at it. An agent that reports a finding without
   the file behind it has produced nothing, and if it dies mid-run the work is gone.
10. **Read your predecessors' files off the disk.** The handoff text in your prompt is a
   summary and may be empty if an agent died. The files in `docs/` and `assets/` are the
   authority. If a file you depend on is missing, stop and say so in `blockers` rather than
   inventing the values it should have held.

## Corrections — read these before the tables below

The tables further down were measured on 2026-07-29 at 23:48. The author then edited the
scene and committed it as `fac071b "gameshow v3 - materials"`. Re-measured from the
committed file on 2026-07-30 at 01:20, the differences are:

1. **19 materials, not 20.** `MAT_Rubber_Black` no longer exists. Every other material's
   base colour, metallic, roughness, emission strength and alpha are unchanged, so the
   table below still holds for the 19 that remain. Any validator asserts the 19 real names.
2. **`MAT_LED_Screen` is texture-driven now.** An Image Texture node holding
   `T_LEDWall_Sky` feeds both Base Color and Emission Color, through a UV Map node. The
   file exists: `unity/GameShow_v3/Assets/Art/Textures/T_LEDWall_Sky.png`, 3.3 MB, authored
   by the scene's author. The material is used by `Wall_Screen` **and** `Podium_Riser`.
3. **The export dropped that texture, and has been fixed.** `tools/export_gltf.py` ran with
   `export_image_format="NONE"`, because `image.has_data` is `False` in background mode for
   an image nobody has drawn yet — which was read as the file being missing. It is not
   missing. The script now reloads every image with a resolvable path before exporting, and
   `assets/wheel_stage.glb` carries 1 image and 2 textures, with `MAT_LED_Screen` holding a
   `baseColorTexture` and an `emissiveTexture` at emissive strength 1.5. The GLB is
   10.16 MiB. `tools/validate_export.py` asserts all of that. It passed 33 of 33 checks when
   this was written; the cleanup pass added the emissive-strength assertion, so it is 34 now.
   The "Known defect in the source scene" section below is obsolete.
   **Consequence for the screen:** the author's own sky is the primary path and a procedural
   sky is the fallback, not the other way round. This reverses the earlier decision, which
   was made when the texture appeared to be missing. It has not been confirmed by the
   author, so keep the procedural path working behind a named constant.
4. **Toolchain.** `cargo` and `rustc` 1.97.1 are installed and `~/.cargo/bin` is on the
   login PATH. Homebrew's rustup never created the shims, which is why earlier agents found
   no compiler; the shims now exist. If `which cargo` still fails in your shell, run
   `export PATH="$HOME/.cargo/bin:$PATH"` first. Do not reinstall the toolchain.
5. **The author works in this .blend while you run.** Never save it, and treat a mismatch
   between these tables and the file as the file being right. Re-measure with
   `blender --background <blend> --python <script>` rather than trusting a stale table.

Confirmed unchanged: 163 objects, 153 meshes, the six lights with their energies and
positions, `Cam_Hero` at `(0, -6.4, 1)` with a 22mm lens, and the 1672x941 render
resolution. The GLB exports 163 nodes, 153 meshes, `Cam_Hero` with `yfov` 0.86305637 rad
and aspect 1.7768331562, and requires `KHR_lights_punctual` alongside
`KHR_materials_emissive_strength`.

## Ground truth from the Blender scene

Scene name `Stage`. Render engine EEVEE. 163 objects, 153 meshes, 85047 polygons,
77380 vertices, 20 materials. Unit scale 1.0. Z is up in Blender. Render resolution
1672x941, which matches the reference image exactly. View transform Filmic, exposure 0.

### Collections

| Collection | Contents |
| --- | --- |
| `00_Ref` | empty |
| `10_Floor` | `Floor_Disc`, `Floor_Rings` |
| `20_Wall` | `Wall_Screen`, `Wall_Band_Mid`, `Wall_Band_Up`, `Wall_Fascia`, `Wall_Plinth` |
| `30_Wheel` | `Wheel_Root` (empty) parents `Wheel_Rim`, `Wheel_Hub`, `Wheel_HubRing`, `Wheel_HubRivets`, `Wheel_Spokes`, `Wheel_Bulbs`, `Wheel_Pegs`, `Wheel_BackPlate`, `Wheel_Sector_01`..`Wheel_Sector_48`. `Wheel_Stand` (empty) parents `Wheel_Legs`, `Wheel_Axle`, `Wheel_BasePlate`, `Wheel_CrossBar`. `Crest_Root` (empty) parents `Crest_Crystal`, `Crest_Chevron`, `Crest_Stalk`, `Pointer_Flapper` |
| `40_Pillars` | `Pillar_L_*` and `Pillar_R_*`: `Base`, `Core`, `Collar`, `Cap` |
| `50_Podium` | `Podium_Body`, `Podium_Desk`, `Podium_Monitor`, `Podium_Panels`, `Podium_Riser`, `Podium_Top`, `Podium_Trim` |
| `60_Rig` | `Truss_Ring`, `Truss_Ring_Inner`, `Truss_Brace`, `Truss_Brace_Inner`, `Truss_Links`, `Truss_Par_Body`, `Truss_Par_Lens`, `MH_01`..`MH_12` (`Base`/`Yoke`/`Head`/`Lens`), `Blinder_01`..`Blinder_06` (`Body`/`Lens`) |
| `70_Lights` | 6 lights, table below |
| `90_Camera` | `Cam_Hero` |

`Wheel_Root` is the spin pivot. `Crest_Root` holds the flapper and does not spin.

### Camera `Cam_Hero`

Location `(0, -6.4, 1)`, rotation euler XYZ `(1.85, 0, 0)` radians, perspective,
focal length 22mm, sensor width 36mm, clip 0.05 to 200. Vertical field of view follows
from the 22mm lens on a 36mm sensor at the 1672x941 aspect ratio; derive it, do not guess.

### Lights

Energies are Blender watts and need converting to whatever unit the pinned `three-d`
version expects. Record the conversion you use in a comment.

| Name | Type | Energy | Color | Location | Rotation euler | Size / cone |
| --- | --- | --- | --- | --- | --- | --- |
| `Key_Wheel` | AREA | 900 | `(1, 0.93, 0.82)` | `(0, -5, 6)` | `(1.029, 0, 0)` | size 4 |
| `Beam_L` | SPOT | 2500 | `(0.72, 0.36, 1)` | `(-6.5, -3, 7.2)` | `(0.696, 0, -0.844)` | cone 0.38397 rad, blend 0.25 |
| `Beam_R` | SPOT | 2500 | `(0.72, 0.36, 1)` | `(6.5, -3, 7.2)` | `(0.696, 0, 0.844)` | cone 0.38397 rad, blend 0.25 |
| `Rim_L` | AREA | 400 | `(0.35, 0.55, 1)` | `(-8, 3.5, 3.5)` | `(1.484, 0, -1.94)` | size 3 |
| `Rim_R` | AREA | 400 | `(1, 0.3, 0.65)` | `(8, 3.5, 3.5)` | `(1.484, 0, 1.94)` | size 3 |
| `Fill_Front` | AREA | 120 | `(0.6, 0.6, 0.9)` | `(0, -7.5, 2)` | `(1.504, 0, 0)` | size 6 |

World background is a plain Background node, no HDRI.

### Materials

Base colors are linear RGB. Emission strength 0 means the material does not glow.

| Material | Base color | Metallic | Roughness | Emission strength | Alpha |
| --- | --- | --- | --- | --- | --- |
| `MAT_Bulb_Glass` | `(1, 0.93, 0.74)` | 0 | 0.08 | 3.0 | 1 |
| `MAT_Crystal` | `(0.85, 0.6, 0.95)` | 0 | 0.05 | 1.2 | 0.55 |
| `MAT_Lens_Glow` | `(1, 0.95, 0.82)` | 0 | 0.08 | 6.0 | 1 |
| `MAT_LED_Screen` | `(0.35, 0.3, 0.6)` | 0 | 0.25 | 1.5 | 1 |
| `MAT_Gold_Trim` | `(0.72, 0.52, 0.18)` | 1 | 0.22 | 0 | 1 |
| `MAT_Gold_Dark` | `(0.34, 0.24, 0.09)` | 1 | 0.35 | 0 | 1 |
| `MAT_Metal_Polished` | `(0.78, 0.79, 0.82)` | 1 | 0.14 | 0 | 1 |
| `MAT_Truss_Metal` | `(0.55, 0.56, 0.58)` | 1 | 0.35 | 0 | 1 |
| `MAT_Peg_Metal` | `(0.3, 0.31, 0.34)` | 1 | 0.30 | 0 | 1 |
| `MAT_Floor_Gloss` | `(0.055, 0.05, 0.075)` | 0 | 0.10 | 0 | 1 |
| `MAT_Pillar_Body` | `(0.11, 0.1, 0.14)` | 0 | 0.18 | 0 | 1 |
| `MAT_Dark_Trim` | `(0.06, 0.06, 0.08)` | 0 | 0.35 | 0 | 1 |
| `MAT_Fixture_Body` | `(0.05, 0.05, 0.06)` | 0 | 0.42 | 0 | 1 |
| `MAT_Rubber_Black` | `(0.03, 0.03, 0.03)` | 0 | 0.60 | 0 | 1 |
| `MAT_Sector_Pink` | `(0.92, 0.05, 0.42)` | 0 | 0.35 | 0 | 1 |
| `MAT_Sector_Gold` | `(0.95, 0.64, 0.08)` | 0 | 0.30 | 0 | 1 |
| `MAT_Sector_Cyan` | `(0.13, 0.8, 0.9)` | 0 | 0.35 | 0 | 1 |
| `MAT_Sector_Blue` | `(0.09, 0.22, 0.86)` | 0 | 0.35 | 0 | 1 |
| `MAT_Sector_Cream` | `(0.96, 0.9, 0.72)` | 0 | 0.35 | 0 | 1 |
| `MAT_Sector_White` | `(0.97, 0.97, 0.97)` | 0 | 0.32 | 0 | 1 |

### Known defect in the source scene

`MAT_LED_Screen` references an image `TEX_LED_Cyclorama.png` whose file is missing from
disk. The cloud-sky backdrop in the reference image does not exist in Blender. A procedural
GLSL sky shader in the Rust app replaces it. Do not try to repair the Blender link.

## Decisions already made

- Interaction: orbit and zoom camera, hero view as the default, the wheel spins and the
  flapper ticks against the pegs.
- Fidelity: Blender-faithful geometry and PBR, plus bloom, additive beam cones, a floor
  reflection and a vignette.
- The big screen gets a procedural GLSL sky shader, tuned during look-dev.
- The Rust toolchain is installed with `brew install rustup` then `rustup default stable`.

## Module ownership

`F` creates every file below as a compiling stub with the exact public signatures, so that
each later agent edits one file and `cargo check` still passes.

| File | Owner | Responsibility |
| --- | --- | --- |
| `Cargo.toml` | F, then L | Dependencies. Later agents request deps in their report; L adds them. |
| `src/main.rs` | F, then G, then L | Window, event loop, wiring. Nobody else edits it. |
| `src/manifest.rs` | G | Serde types for `assets/scene.json`. |
| `src/scene.rs` | G | GLB load, model construction, material mapping, camera from manifest. |
| `src/lighting.rs` | H | Blender lights to three-d lights, shadow map on the key light. |
| `src/postfx.rs` | I | Bloom, tone map, vignette, additive beam cone geometry. |
| `src/screen.rs` | J | Procedural sky material for `Wall_Screen`. |
| `src/spin.rs` | K | Wheel spin state, flapper deflection against pegs. |
| `src/shot.rs` | F | Headless shot mode and crop writing. |
| `src/bin/crop.rs` | F | Standalone crop helper over the `image` crate. |
| `tools/export_gltf.py` | D | Blender export. |
| `tools/validate_export.py` | E | Export validator. |
| `docs/three_d_api.md` | A | API notes. |
| `docs/scene_audit.md` | B | Scene audit. |
| `docs/look_target.md` | C | Reference decomposition. |
| `docs/export_notes.md` | D | Reproduce command, exporter keywords used, anything the exporter dropped. |
| `docs/api/lighting.md` | H | Public signatures and units of `src/lighting.rs`. |
| `docs/api/postfx.md` | I | Public signatures and tunable constants of `src/postfx.rs`. |
| `docs/api/screen.md` | J | Public signatures and tunable constants of `src/screen.rs`. |
| `docs/api/spin.md` | K | Public signatures of `src/spin.rs`. |
| `docs/lookdev_log.md` | look-dev judges | One appended section per round: what was wrong, what was asked for. |
| `renders/verdict_r<N>.json` | look-dev judge of round N | The round's machine-readable verdict. |
| `README.md` | N2 | How to re-export and run. |

The four feature agents run in parallel, so each writes its own file under `docs/api/`.
Nobody appends to a shared file while another agent is running.

Look-dev agents may edit `src/lighting.rs`, `src/postfx.rs`, `src/screen.rs`,
`src/scene.rs` and `assets/scene.json`, because tuning is their job.

## CLI contract

```
cargo run --release                      # interactive viewer, hero view, wheel spinning
cargo run --release -- --shot renders/x.png
cargo run --release -- --shot renders/x.png --crops renders/crops_x
```

`--shot` renders one deterministic frame offscreen at 1672x941 from `Cam_Hero` with the
wheel at rotation 0, writes the PNG and exits. It must not require a visible window and
must not depend on wall-clock time. `--crops <dir>` additionally writes the six crops
below as `<dir>/<name>.png`.

## Crop regions

The reference image and the shot share the resolution 1672x941, so one set of pixel
rectangles applies to both. `x,y` is the top-left corner, y grows downward.

| Name | x | y | w | h | What it checks |
| --- | --- | --- | --- | --- | --- |
| `hub` | 700 | 300 | 300 | 300 | Hub metal, spoke convergence, sector inner ends |
| `rim_top` | 620 | 110 | 460 | 210 | Gold rim, bulb glow, crest crystal base |
| `floor` | 420 | 760 | 620 | 180 | Floor gloss, reflection falloff, ring inlays |
| `screen_left` | 0 | 240 | 420 | 400 | Sky shader colour and cloud shape |
| `truss` | 150 | 0 | 500 | 260 | Truss silhouette, moving heads, beam cones |
| `podium` | 130 | 600 | 390 | 300 | Podium trim, desk, its own reflection |

`C` writes the reference crops to `renders/ref_crops/<name>.png` using `src/bin/crop.rs`
once it exists, or with `sips` before then.

## Cleanup pass — scope and rules

Five look-dev rounds ran and an adversarial review returned BROKEN with 11 findings. The
author then chose, explicitly: **pull the renderer back to faithful, and do a cleanup pass
with no further look-dev.** That decision governs everything below and outranks any earlier
instruction in this file or in an agent's prompt.

The frame will get further from `docs/wheel_stage.png` as a result. That is the intended
trade. Do not compensate for it by adding a new effect somewhere else, and do not tune any
constant to win back what a rollback costs. Nobody is judging crops in this pass.

### What comes out

These were invented during look-dev and are not in the Blender scene:

1. `SCREEN_UV_WINDOW` in `src/screen.rs`, which re-windows and magnifies the author's
   `T_LEDWall_Sky` so the wall shows about 64% of it. The wall must show the texture as the
   mesh's own `UVMap` addresses it, at the emissive strength the glTF declares.
2. The per-side sky grade and its seam: `SCREEN_SIDE_BLEND_M`, the per-side UV offsets, and
   anything else that treats the left and right halves of one screen differently. The seam
   was placed at `x = 0` because the wheel hides it, which is the definition of a hack.
3. The sunburst painted into `Wheel_Hub` in `src/scene.rs`, and the metallic drop from 1.0 to
   0.14 that came with it. `Wheel_Hub` follows `MAT_Metal_Polished` like every other node.
4. The sparkle-dust layer and the anamorphic streak/flare layers in `src/postfx.rs`, with
   their `SPARKLE_*` and `FLARE_*` constants, including `SPARKLE_BAND`, which gates glitter
   to a screen-space y band.
5. Every `NODE_LIFTS` entry that invents emission a material does not have in the .blend.

### What stays

Bloom, the additive beam cones, the floor reflection, the vignette and the tone map. Those
four plus tone mapping were sanctioned from the start and are not up for removal.

A `NODE_LIFTS` entry survives only if it restores a value that glTF transport lost — a
metallic or roughness that arrived wrong. Judge each entry by that test and say in your
report which entries you kept and which you deleted, with the reason per entry.

The extra light standing in for the bulb ring may stay if and only if it stands in for
emissive geometry that really is emissive in the .blend. Emissive geometry casting no light
is a renderer limitation, so replacing it with a lamp is faithful, not invented. Document it
as a stand-in wherever it is described.

### The manifest is the single source of truth

The renderer currently hardcodes values that contradict `assets/scene.json`: gold metallic
0.75 against 1.0, a different crystal emission, and more. After this pass the renderer reads
the manifest and the manifest matches the Blender scene. A constant in Rust that duplicates
a manifest value is a defect even when the two agree, because they will drift.

`assets/scene.json` is also stale in a way that matters: its `glb_audit` records
`images: 0, textures: 0` and it states the screen is procedural. Both were true before the
export was fixed and are false now. Whatever regenerates it must derive from the current
Blender file and the current GLB, not from an older report.

Any test that asserts a manifest value the renderer does not read is a green test over a
divergent render. Fix the test to assert what the renderer actually uses.

### Honesty rules for this pass

A document that disagrees with its module is a defect, not a stylistic matter. Three of the
four `docs/api/*.md` files currently contradict their code on constant names and values.

`tools/export_gltf.py` downgraded two checks inside `verify()` from `SystemExit` to a
`print`, while that function's own docstring claims it checks every invariant. Restore them.

## Reporting

Return data, not prose for a human. Give a short factual `summary`, the exact
`files_written`, any `deps_needed`, and `blockers` for anything you could not do. Never
report success for work you did not verify.
