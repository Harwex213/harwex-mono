# game-show-v1 — `wheel_stage` in Rust and three-d

A Rust application that renders the Blender scene `wheel_stage.blend` with the
[`three-d`](https://crates.io/crates/three-d) crate. `docs/wheel_stage.png` is the illustration
the set was drawn from, and it was the look target for five look-dev rounds.

Geometry, materials, the camera and the lights all come out of Blender. One mesh in `src/` is
built in code and only one: `cone_mesh` in `src/postfx.rs` generates the additive light cones,
because a beam is a light effect rather than a modelled object. Everything else you can see is
a Blender mesh. The Blender file is exported to `assets/wheel_stage.glb` and measured into a
manifest `assets/scene.json`, and the app reads only those two files at runtime. The app is
offline: it downloads nothing and reaches no network.

The renderer is **faithful, not art-directed**. A cleanup pass on 2026-07-30 rolled out every
effect that look-dev had invented, and `assets/scene.json` now carries the .blend's own material
values with no override on top. The frame therefore sits further from the illustration than
round 5 did. That was the author's explicit choice. Two sections below record it: *What the
cleanup pass removed* and *What does not match the reference*.

The binary has two modes. Without arguments it opens an interactive viewer with the wheel
spinning. With `--shot` it renders one deterministic frame offscreen at 1672x941 and exits.

## Requirements

- macOS with a GPU that gives OpenGL 3.3. Both modes need a GL context, so `--shot` opens a
  hidden 32x32 window (`src/shot.rs` explains why: `three-d` 0.19 dropped `HeadlessContext`).
- Rust 1.97.1 or newer, through `rustup`. If `which cargo` fails, run
  `export PATH="$HOME/.cargo/bin:$PATH"` first. Homebrew's `rustup` formula does not always
  create the shims.
- Blender 5.1 at `/Applications/Blender.app/Contents/MacOS/Blender`, for the export only. The
  app itself never calls Blender.
- Python 3 for `tools/validate_export.py`. It uses the standard library alone.

Run every command below from the crate root. Every asset and output path in this crate is
relative to it.

## Re-export from Blender

The export is only needed after the .blend changes. `assets/wheel_stage.glb` is committed.

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background \
  ../../unity/blender-assets/wheel_stage.blend \
  --python tools/export_gltf.py
```

That writes `assets/wheel_stage.glb`. An output path may follow `--`:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background \
  ../../unity/blender-assets/wheel_stage.blend \
  --python tools/export_gltf.py -- renders/probe.glb
```

Then validate the result:

```sh
python3 tools/validate_export.py
```

The validator runs 34 checks over the GLB and prints `VALIDATION PASSED` on success. It takes
an optional path argument and otherwise checks `assets/wheel_stage.glb`.

The exporter checks the same invariants itself and exits non-zero when one fails. Three of them
are strict as of the cleanup pass: 19 materials, exactly 153 392 triangles, and an
`MAT_LED_Screen` that still carries its texture at emissive strength 1.5. Edit the .blend's
geometry or materials and the export will fail rather than warn. Update the expectation and
record it in `docs/export_notes.md` §2; do not relax the check.

**The .blend is never saved.** The Unity project shares that file and the author works in it.
`tools/export_gltf.py` runs under `--background`, which gets its own copy of the process state,
and it calls neither `save_mainfile` nor `save_as_mainfile`. Confirm the invariant after any
export:

```sh
stat -f '%Sm' -t '%Y-%m-%dT%H:%M:%S' ../../unity/blender-assets/wheel_stage.blend
```

Two more things to know about the export:

- **The manifest is not written by that script, and no committed script writes it.**
  `assets/scene.json` holds what a GLB cannot carry: the camera, all six lights, the material
  table, the textures, the spin pivot, the flapper geometry and the crop rectangles. The
  cleanup pass regenerated it from two ground truths only — a read-only
  `blender --background <blend> --python <dump>` run, and a parse of the GLB's JSON chunk. The
  procedure is written out field by field in the manifest's own `doc` array. Follow it if the
  .blend's lights, camera or materials change. No look-dev value survives in the file.
- **The export is reproducible to within one ULP.** Two runs of the same command give the same
  file size, a byte-identical JSON chunk, byte-identical index accessors and a byte-identical
  embedded PNG. 27 of 2 009 688 float32 values differ, by at most `1.192e-07`, and all 27 are
  `TEXCOORD_0` values on `Wheel_Legs` and `Podium_Trim` — bevel UV generation, not the
  exporter. Do not use a GLB checksum as a build fingerprint; compare counts and names, which
  is what `tools/validate_export.py` does.

## Run the viewer

```sh
cargo run --release
```

`Cargo.toml` sets `default-run = "game-show-v1"`, so a bare `cargo run` works even though
`src/bin/crop.rs` is a second binary. `cargo run --release --bin game-show-v1` is the same
thing spelled out.

### Controls

| Input | Effect |
| --- | --- |
| drag | orbit the camera around the wheel |
| scroll or pinch | zoom, between 1 m and 60 m from the target |
| space | kick the wheel: it spins up, then coasts down under friction |
| `R` or `Home` | back to the hero view, `Cam_Hero` from the manifest |
| `Esc` | quit |

The same list is printed on start-up, because a window has nowhere to put it.

The wheel turns at a constant idle rate until the first kick. From then on it runs on the
free-running drive, which integrates a velocity and so is the only drive a kick survives.
The window resizes: the projection is re-derived on every viewport change, because Blender's
sensor fit is horizontal and `set_viewport` holds the vertical field of view instead.

## Take a shot

```sh
cargo run --release -- --shot renders/final.png
cargo run --release -- --shot renders/final.png --crops renders/crops_final
```

`--shot` renders one frame at 1672x941 from `Cam_Hero` with the wheel at rotation 0, writes the
PNG and exits. It reads no wall-clock value, so the same build always produces the same bytes.
`--crops <dir>` also writes the six comparison regions as `<dir>/<name>.png`.

| Crop | x | y | w | h | What it checks |
| --- | --- | --- | --- | --- | --- |
| `hub` | 700 | 300 | 300 | 300 | hub metal, spoke convergence, sector inner ends |
| `rim_top` | 620 | 110 | 460 | 210 | gold rim, bulb glow, crest crystal base |
| `floor` | 420 | 760 | 620 | 180 | floor gloss, reflection falloff, ring inlays |
| `screen_left` | 0 | 240 | 420 | 400 | LED wall colour and cloud shape |
| `truss` | 150 | 0 | 500 | 260 | truss silhouette, moving heads, beam cones |
| `podium` | 130 | 600 | 390 | 300 | podium trim, desk, its own reflection |

`src/shot.rs` reads those rectangles from the `crops` array of `assets/scene.json` and holds no
copy of them, so the table above is a convenience and the manifest is the authority.

The reference crops for the same six rectangles are committed at
`renders/ref_crops/<name>.png`. Any other rectangle can be cut from either image with the
second binary:

```sh
cargo run --release --bin crop -- docs/wheel_stage.png renders/ref_crops/x.png 560 850 560 91
```

`x,y` is the top-left corner and y grows downward, matching the reference image's pixel
coordinates.

`renders/` and `target/` are both gitignored, except `renders/ref_crops/*.png` and
`renders/verdict_r*.json`, which are deliverables.

One diagnostic exists: `GS_LIGHT_AUDIT=1` makes `src/lighting.rs` print the rig it built, one
line per light, with the Blender type, the three-d type it became, the watts, the conversion
constant, the resulting intensity, and the position and direction actually used.

## Layout of `src/`

Each module has one owner. The owner's name is in the file's header comment, and the module map
in `docs/agent_plan.md` is the authority.

| File | What it does |
| --- | --- |
| `src/main.rs` | Window, event loop, argument parsing, and `World`, which owns everything drawn. The viewer and `--shot` drive the same `World`, so they cannot drift apart. |
| `src/manifest.rs` | Serde types for `assets/scene.json`. `three-d-asset` 0.10 reads neither cameras nor lights out of a glTF file, so the manifest is mandatory. |
| `src/scene.rs` | Loads the GLB, builds one part per named node, maps the manifest's materials onto `PhysicalMaterial`, re-applies the emission glTF transport loses, and derives the hero camera. |
| `src/lighting.rs` | The six Blender lights as three-d lights, watts converted per light, one stand-in lamp ring for the bulbs, an ambient environment term built from the LED wall, and the shadow map on `Key_Wheel`. |
| `src/postfx.rs` | The frame chain: HDR target, bright pass, two blurs, bloom, floor reflection, vignette, tone map. Also the 38 additive beam cones. |
| `src/screen.rs` | The LED wall. Draws the author's exported `T_LEDWall_Sky` at the mesh's own UVs and at emissive strength 1.5, with a procedural GLSL sky behind a constant as the fallback. |
| `src/spin.rs` | Wheel spin state and the flapper deflecting against the 48 pegs. Two drives: constant rate, and free-running with friction and detents. |
| `src/shot.rs` | The hidden-window GL context and the deterministic offscreen render. |
| `src/bin/crop.rs` | The standalone crop helper above. |

`tools/export_gltf.py` and `tools/validate_export.py` are the Blender side.

## Where the tunable constants live

Every value that can be tuned is a named `pub const` at the top of its module, with a doc
comment saying what it does. Nothing is a bare literal buried in a shader string. After the
cleanup pass most of these are conversions and budgets rather than look knobs: the material
values themselves are all in `assets/scene.json` and are the .blend's own.

| Where | Constants |
| --- | --- |
| `src/lighting.rs` | `*_WATTS_TO_INTENSITY` per light, `SPOT_DISTANCE_FALLOFF`, `KEY_WHEEL_CUTOFF`, the `BULB_RING_*` family, `AMBIENT_INTENSITY`, `ENVIRONMENT_FACE_SIZE`, `ENVIRONMENT_BAND_TOP`, `ENVIRONMENT_BAND_BOTTOM`, `SHADOW_MAP_SIZE`, `SHADOW_REFRESH_INTERVAL` |
| `src/postfx.rs` | `TONE_MAPPING`, `EXPOSURE`, `BACKGROUND_GAIN`, the `BLOOM_*` family, `BLUR_TAPS_HALF`, the `VIGNETTE_*` family, the `BEAM_*`, `PAR_*` and `BEAM_TINTS_*` families, the `REFLECTION_*` family, `FLOOR_PLANE_*`, `SHADOW_LIFT*` |
| `src/screen.rs` | `FORCE_PROCEDURAL_SKY` to switch paths, then `SKY_*`, `CLOUD_*` and `STAR_*`, which only affect the procedural fallback. The texture path has no constant: its emissive strength comes from the manifest |
| `src/scene.rs` | Nothing tunable is left. `MODEL_PATH` and `WORLD_UP` are facts, not knobs. |
| `src/spin.rs` | `KICK_RATE`, `MAX_RATE`, `AIR_DRAG`, `BEARING_FRICTION`, `DETENT_STIFFNESS`, `REST_RATE`, and the `TICK_*`, `RING_*` and `CONTACT_*` flapper constants |
| `src/main.rs` | `SCREEN_DRAWN_BY_SCREEN_RS`, `ORBIT_DISTANCE` |
| `assets/scene.json` | The material table, the light table, the camera, the textures and the crops. All measured. No look-dev override anywhere in the file. |

One constant still names a value the manifest also carries: `scene::MODEL_PATH` against the
manifest's `glb` field. It is a documented fallback rather than a duplicate — `src/scene.rs`
prefers `manifest.glb` and reaches for the constant only when that field is empty — and
`src/postfx.rs` names it in a diagnostic. `docs/agent_plan.md` still calls this shape a defect,
and the honest fix is to make the empty-manifest case an error instead of a default.

Four others were duplicates and are gone. `screen::EMISSIVE_STRENGTH` became an argument to
`SkyScreen::new`, taken from `manifest.screen.emission_strength`. `screen::SCREEN_MATERIAL` and
`scene::SCREEN_NODE` became reads of `manifest.screen.material` and `manifest.screen.node`. Two
test assertions that restated manifest numbers as literals — a wheel geometry ratio in
`src/spin.rs` and the camera in `src/scene.rs` — now derive both sides from the manifest. That
last pair is the reason the rule matters: regenerating the manifest at full precision broke the
`src/spin.rs` assertion, because it held a rounded copy of a number it should have read.

`SHADOW_LIFT`, `SHADOW_LIFT_TINT` and `SHADOW_LIFT_RANGE` in `src/postfx.rs` are a shadow toe in
the composite, which is a grade rather than a physical value. The cleanup pass left them alone
because its scope did not name them. They are the one look-dev knob still in the frame, and
`docs/api/postfx.md` §"The shadow toe" documents all three.

## What the cleanup pass removed from the look, and why

Five look-dev rounds ran and an adversarial review returned BROKEN. The author then chose to
pull the renderer back to faithful and to run no further look-dev, so everything below came out
on 2026-07-30. The reason is the same in every case: it is not in the Blender scene. Nothing was
added anywhere to compensate, and no constant was re-tuned to win back what a rollback cost.

**The re-windowed sky.** `src/screen.rs` used to magnify the author's `T_LEDWall_Sky` and show
about 64% of it through `SCREEN_UV_WINDOW`, then grade what it showed: contrast, saturation,
chroma, a sharpen, a posterise, a tone split, an emission gain, a lit fraction, and a kill on
the procedural stars. It also drew the result as emission alone, with no lighting term. The wall
now samples the texture at the mesh's own `UVMap` and draws `emissive(1.5) * T_LEDWall_Sky` plus
a full lighting term over `albedo * T_LEDWall_Sky`. The hue, the brightness and the cloud scale
all changed with it, and `Podium_Riser` changed too, because the author puts the same material on
it. Seventeen public constants came out of that module in all, counting the per-side set below,
and `docs/api/screen.md` lists every one with the value it held when it was deleted.

**The per-side grade and its seam.** The same module treated the left and the right half of one
screen differently — separate tints, separate highlights, separate UV shifts, blended over
`SCREEN_SIDE_BLEND_M`. The seam sat at `x = 0` because the wheel hides it, which is the
definition of a hack. One screen is now one screen.

**The painted hub.** `src/scene.rs` drew a nine-cycle sunburst into `Wheel_Hub` with its own
GLSL shader, a groove radius, a tint, a bearing-swept lobe, and a metallic dropped from 1.0 to
0.14 to make the paint read. It also moved `Wheel_HubRing` and `Wheel_HubRivets` onto other
materials. The .blend puts `MAT_Metal_Polished` on `Wheel_Hub`, so the hub is now polished metal
at metallic 1.0 and roughness 0.14 like the axle beside it, and the ring and the rivets are back
on `MAT_Dark_Trim` and `MAT_Metal_Polished`. Polished metal with almost nothing to mirror renders
near-black, and that is what the hub does now. It is the largest single cost of this pass.

**The sparkle and flare layers.** `src/postfx.rs` had a two-population glitter dust gated to a
screen-space y band, and an anamorphic streak layer that drew a spike over the crest. Fifteen
constants, one shader id and one stage. Both are gone; `Stages` has five fields, not six. The
ceiling void carries no specks and no streak.

**Every invented emission.** `src/scene.rs` held a `NODE_LIFTS` table of seventeen per-node
overrides. An entry survives only if it restores a value glTF transport lost, and the manifest
proves transport loses no metallic, roughness or base colour on any of the 19 materials — only
emission. So every entry went: the emission lifts on `Podium_Top`, `Podium_Desk`, `Podium_Trim`,
`Floor_Rings`, `Wheel_BasePlate`, `Wall_Fascia`, `Wall_Band_Mid`, `Wall_Band_Up`,
`Wheel_Spokes`, `Wheel_Pegs`, `Wheel_HubRivets` and `Pointer_Flapper`, and the albedo and
metallic overrides on `Wheel_Rim`, `Wheel_BasePlate` and the pillars' cores and caps. Four
materials emit now, which are the four the .blend declares: `MAT_Bulb_Glass` at 3.0,
`MAT_Lens_Glow` at 6.0, `MAT_Crystal` at 1.2 and `MAT_LED_Screen` at 1.5 through its texture.

**The lighting look gains.** `src/lighting.rs` multiplied the key, the rims and the front fill by
hand-tuned gains, and shaped the environment probe with a 2.6x band gain, a left/right hue swing
and a violet ceiling. Every lamp is now watts times its own conversion. The key is 1.14x
brighter, the two rims are 2.85x darker, the front fill is 6.25x brighter — its gain was below
one, so removing it makes the front of the frame flatter, and that is the honest conversion. The
probe's coloured band narrowed from 31 degrees of sky to the measured 14, so every metal went
darker and more neutral. The bulb-ring stand-in lamps took the material's own hue.

**What stayed, by instruction.** Bloom, the additive beam cones, the floor reflection, the
vignette and the tone map were sanctioned from the start. The ring of eight lamps standing in
for `Wheel_Bulbs` also stayed: `MAT_Bulb_Glass` really does emit at 3.0 in the .blend, and
emissive geometry that casts no light is a renderer limitation rather than an invention. It is a
stand-in, and `assets/scene.json`'s `lighting_notes` require it to be called one everywhere.

## What does not match the reference

Read off `renders/faithful.png` against `docs/wheel_stage.png` after the cleanup pass, by eye.
No histogram, mean brightness or similarity score was used, and none should be: that approach
degraded this scene once already.

The frame still reads as the right picture. Composition, camera, silhouette, sector fan,
pillars, podium, truss and LED cyclorama are all in the right place at the right scale, because
they come from the GLB. What differs is value and chroma.

**Structural, and not worth chasing.** The reference is an illustration, not a render of this
.blend:

- Its wheel has about 24 wide sectors with jewelled studs. The Blender wheel has 48 thinner
  sectors and a 96-bulb ring. The sector count, the proportion of magenta to cream in the fan,
  and the wheel's scale and position all come from the GLB.
- Its truss is a deeper, denser rig with confetti in the air. Collection `60_Rig` holds one ring
  with an inner ring, twelve moving heads and six blinders. The silhouette reads correctly; the
  member count cannot.
- Its podium sits about 40 px higher in the frame, and its LED wall is one unbroken screen. The
  Blender wall is crossed by `Wall_Band_Mid`, `Wall_Band_Up` and `Wall_Fascia`, so three bands
  cut across the sky. Both are geometry.
- Its cyclorama is a painted sunset with big coral cumulus. The wall in the render shows
  `T_LEDWall_Sky`, the author's own texture out of the .blend. The art differs at source.

**The round-5 list, and where the rollback left each item.** Round 5 was the last look-dev round
and did not converge. Its six open items were the handover list. Four are unchanged, and four
things moved further from the reference on purpose:

1. **The strip under the wheel is still dead, and now flatter.** `Wheel_BasePlate` carries
   `MAT_Dark_Trim` and renders as one flat dark slab, so the floor reflection has nothing bright
   to mirror there. The reference has a bright gold-and-magenta glossy column. Round 5 asked for
   a `NodeLift` on that plate; the pass deleted the mechanism instead, so the only warmth in the
   floor now comes from the podium's own reflection on the left. **Further away, on purpose.**
2. **The wall's hue is the author's, not the reference's.** The wall now reads as a soft violet
   sunset: a deep blue-violet upper band with thin white stratus, a magenta-and-lilac lower band,
   and warm coral behind the podium. The reference has coral and peach cauliflower tops over
   cobalt on the left and big cyan-white lobes on the right, at a much higher chroma and a much
   wider value range. Round 5 asked for that range to be widened in the shader. It is now the
   texture as authored, ungraded, so the gap is wider and it is no longer a renderer question.
   **Further away, on purpose.**
3. **The golds read as gold, not khaki — where a light reaches them.** This one improved. The
   flat emissive that made every band a matte olive ribbon is gone, and `MAT_Gold_Trim` is a real
   metal at metallic 1.0 and roughness 0.22, so the podium ribs and the desk rim draw thin
   saturated highlights with dark grooves beside them, which is what the reference does. The cost
   lands on the bands no lamp points at: the two wall bands and the wall fascia read as dark
   bronze ribbons and the floor ring inlays barely read at all, where the reference draws a lit
   gold line in each place.
4. **The crest is still soft, and now blown.** `MAT_Crystal` emits at the .blend's 1.2 through
   alpha 0.55, which is over the bloom threshold, so the crest is a pale pink-white mushroom with
   an even glow. The reference is a faceted magenta crystal with hard bevels and a thin white
   spike. The spike used to be drawn by the flare layer, which was invented and is gone.
   **Further away, on purpose.**
5. **The rim's band stack is still thin.** The render draws one gold hoop with the bulb rows on
   it. The reference stacks groove, gold, dark line, gold and chrome over about 45 px. The pegs
   are flat dark balls with no specular of their own.
6. **The hub is a near-black disc.** This is the pass's biggest regression. `Wheel_Hub` is
   polished metal at metallic 1.0, and a fully metallic surface in three-d has no diffuse term at
   all, so everything it shows is a reflection. The only environment it has is the gradient cube
   `src/lighting.rs` generates, whose coloured band sits where the wall really is, at about
   14 degrees of elevation. The dome faces the camera, reflects the dark part of that gradient,
   and reads as a hole in the middle of the wheel, lit by eight small bulb reflections and one
   central specular. The bezel is a light silver ring punched
   through by a full circle of dark rivets, which round 5 also asked to be closed. The reference
   dome is a violet-silver disc with a broad silver lobe. **Further away, on purpose**, and the
   module header of `src/scene.rs` records it as the one open item: the honest fix is an
   environment for the metal to mirror, not paint on the hub.

Two more differences the round-5 list did not carry, both consequences of this pass:

- **The pillars are near-black cylinders.** They are back on `MAT_Pillar_Body` at metallic 0, and
  the environment probe lost its band gain and its warm side, so neither pillar takes the bright
  warm vertical stripe the reference has. The floor mirrors each one as a dark band across the
  wall's pink reflection, where the reference runs a bright warm column down from the pillar's
  base. Round 5 asked for the pillar highlight four times; nothing in this pass could give it
  without inventing a light.
- **The ceiling void is empty.** No sparkle dust, no streaks. The truss tubes, the lens cores and
  the beam cones are all that is up there, against a plum-black field. The reference's void is
  full of confetti and light streaks.

The record of how the look was arrived at, and of what was rolled back, is in
`docs/lookdev_log.md` and `docs/agent_plan.md`. Read the plan's *Cleanup pass — scope and rules*
section before changing anything in the list above: adding an effect back to close one of these
gaps is exactly what the author ruled out.

## The record

| Document | What is in it |
| --- | --- |
| `docs/agent_plan.md` | The binding contract: invariants, the ground truth measured from the .blend, the module ownership map, the CLI contract, the crop table, and the cleanup pass's scope and rules. Read this first. |
| `docs/lookdev_log.md` | The five look-dev rounds, one appended section each. Round 5 holds the verdict the list above starts from. |
| `docs/look_target.md` | The reference image decomposed region by region, with the five features ranked by how much each costs the look. |
| `docs/scene_audit.md` | The audit of the Blender scene: objects, collections, modifiers, polygon counts. |
| `docs/export_notes.md` | The reproduce command, every exporter keyword and why, what the exporter drops and what it no longer drops, and the reproducibility measurement. |
| `docs/three_d_api.md` | Notes on the pinned `three-d` 0.19.0 API, including what it does not have. |
| `docs/api/*.md` | Public signatures, units and tunable constants for `lighting`, `postfx`, `screen` and `spin`. `screen.md`, `postfx.md` and `lighting.md` each open with what the cleanup pass removed from that module, and `screen.md` and `lighting.md` give every deleted constant's last value. |
| `renders/verdict_r<N>.json` | Each look-dev round's machine-readable verdict. |
