# `src/postfx.rs` — public surface and tunables

Owner: agent I. Bloom, the additive beam cones, the floor reflection, the vignette and the tone
map. That list is the whole effect set, and it is the set `docs/agent_plan.md` sanctioned from the
start.

**State of this document.** Rewritten during the cleanup pass, against the code as it stands.
Every constant below was read out of `src/postfx.rs` at the same time, so the values here are the
values in the file. The previous version of this file was written after look-dev round 1 and had
drifted badly: it claimed four stages against six in code, `BEAM_STRENGTH` 3.0 against 1.0,
`BLOOM_STRENGTH` 0.55 against 0.38, `BLOOM_BLUR_SPREADS` `[1.0, 3.5]` against `[1.9, 5.5]`, and it
documented none of the reflection, PAR-can, shadow-toe or per-kind beam constants — about 24
of them.

Verified three ways. `cargo check --all-targets` passes on the crate as it stands. `cargo test
--bins` passes all nine of this module's tests, and `cargo test` passes the whole crate. And
`cargo run --bin game-show-v1 -- --shot renders/cleanup_i/shot.png` renders the frame, which is
what proves the GLSL still compiles — the composite lost two texture samples and two shader
helpers in this pass, and `cargo check` cannot see a shader. It reported 38 cones (2 spots, 12
truss heads, 24 PAR cans) and wrote 1672x941. The frame was not judged: this pass does not do
look-dev.

## What the cleanup pass removed

Three layers that look-dev added and that are in neither `wheel_stage.blend` nor the sanctioned
list, per `docs/agent_plan.md` §"Cleanup pass", item 4:

- the anamorphic streak pass and its crest spike, with `FLARE_THRESHOLD`, `FLARE_SPREAD`,
  `FLARE_ASPECT`, `FLARE_TAPS_HALF`, `FLARE_STRENGTH`, `FLARE_SPIKE`, `FLARE_SPIKE_TAPS_HALF`,
  `FLARE_TINT` and `FLARE_SHADER_ID`, the `FlareEffect` screen effect and the half-res `flare`
  target;
- the sparkle-dust layer, with `SPARKLE_STRENGTH`, `SPARKLE_CELLS`, `SPARKLE_RARITY`,
  `SPARKLE_SIZE`, `SPARKLE_BAND`, `SPARKLE_TINTS` and `SPARKLE_LAMP_WEIGHT`, and the
  `sparkle_hash` / `sparkle_layer` GLSL helpers in the composite. `SPARKLE_BAND` gated the glitter
  to a screen-space y band, which is a per-region hack by construction;
- `Stages::sparkles`, which switched the second of those.

A fourth hack was found and taken out during this same pass, on the review that this document
also fixed: `side_tint` and the constants it read, `BEAM_TINTS_LEFT` and `BEAM_TINTS_RIGHT`. It
keyed a cone's colour off the sign of `apex.x` — four hand-graded tints per side, cycled by
fixture index — which is per-side differentiation invented from the reference image, structurally
the same hack as the screen's per-side grade above. A cone's colour now comes straight off the
scene data: the manifest's own light for `Beam_L` / `Beam_R`, and `MAT_Lens_Glow` for every truss
fixture. `Beam_L` and `Beam_R` carry the identical colour `(0.72, 0.36, 1.0)` in
`assets/scene.json`, so the two spot cones are the same hue now, not two different ones.

Nothing that stayed was retuned to make up for what they carried. The frame is further from
`docs/wheel_stage.png` as a result, and that is the intended trade.

## Entry points

```rust
// Allocate. Builds the beam cones; loads the GLB's node tree itself for the twelve
// MH_nn_Lens transforms and Truss_Par_Lens's vertices, because the manifest has neither.
PostFx::new(&Context, &Manifest, width: u32, height: u32) -> crate::Result<PostFx>

// Same, without the second GLB parse, when a Stage is already loaded. Prefer this in main.rs.
PostFx::new_with_stage(&Context, &Manifest, &scene::Stage, width: u32, height: u32)
    -> crate::Result<PostFx>

// The whole frame: scene + beams into the HDR target, the floor reflection, then the rest of
// the chain into `target`. This is the signature src/main.rs and src/shot.rs already call.
PostFx::render(
    &mut self,
    context: &Context,
    target: &RenderTarget<'_>,
    camera: &mut Camera,
    objects: &[&dyn Object],
    lights: &[&dyn Light],
) -> crate::Result<()>

// The chain without the reflection, over a colour texture somebody else rendered: bright pass,
// blurs, composite (exposure, bloom, shadow toe, vignette, tone map, sRGB) into `target`.
// `color` must be linear and un-tone-mapped, and wants to be floating point. The reflection
// needs the scene depth, which `apply` is not given, so it only runs inside `render`.
PostFx::apply(&self, context: &Context, target: &RenderTarget<'_>, color: &Texture2D)
    -> crate::Result<()>

// The beam cones as objects, for a caller that would rather draw them in its own main pass.
// Set `stages.beams = false` if you do, or they are drawn twice.
PostFx::beams(&self) -> Vec<&dyn Object>

PostFx::resize(&mut self, &Context, width: u32, height: u32)   // reallocates the targets
PostFx::size(&self) -> (u32, u32)
PostFx::beam_specs(&self) -> Vec<&BeamSpec>                    // what each cone was built from
PostFx::set_beam_strength(&mut self, strength: f32)            // look-dev sweep without a rebuild
```

Public fields on `PostFx`: `stages: Stages`, `tone_mapping: ToneMapping`, `exposure: f32`,
`bloom_strength: f32`, `bloom_wide_strength: f32`, `vignette_strength: f32`. Each starts at the
constant of the same name.

`render` calls `resize` itself if `target` is a different size, so a window resize cannot
desynchronise the chain.

## The chain, in order

1. Scene plus the beam cones into a `[f16; 4]` full-res target. One `render` call, because
   `cmp_render_order` only sorts what one call is given and `MAT_Crystal` has to sort against the
   wheel behind it. `camera.disable_tone_and_color_mapping()` is on for this pass and restored on
   the way out: the curve is applied once, in the composite.
2. The floor reflection, reading that target and its depth, into a second full-res target.
3. Bright pass with a soft knee, at half resolution.
4. Two rounds of separable Gaussian blur, four passes, ping-ponging between two half-res targets.
   The tight round ends in `bloom_a` and the wide round in `bloom_wide`, so the composite can
   weight the two halo widths apart.
5. Composite into `target`: exposure, the two bloom taps, the shadow toe, the vignette, the tone
   curve, the sRGB encode.

Five colour targets, all `[f16; 4]`: `hdr` and `mirrored` at full resolution, `bloom_a`, `bloom_b`
and `bloom_wide` at half, plus one `DepthTexture2D` at full resolution.

## Switchable stages

```rust
pub struct Stages { pub bloom: bool, pub reflection: bool, pub tone_map: bool,
                   pub vignette: bool, pub beams: bool }
```

Five fields for the five stages the chain has. `Default` is all five on.

- `bloom: false` skips the bright pass and both blur rounds, and the composite compiles without
  its bloom uniforms (a second `EffectMaterialId`, or the program cache hands back the wrong
  compiled program).
- `reflection: false` sends the raw scene target down the chain instead of the mirrored one.
- `tone_map: false` skips the curve but still encodes sRGB, because the target is written for
  display or for a PNG either way.
- `vignette: false` sends corner strength 0.
- `beams: false` leaves the cones out of `render`'s own draw call; the cones still exist and
  `beams()` still returns them. Set it when the caller has put `beams()` into its own pass, or the
  cones are drawn twice and read twice as bright.

## Tunable constants — the look-dev block

All of these are in one delimited block at the top of the file, each with the measurement or the
reference note behind its value. Grouped as the file groups them.

### Tone, exposure, background

| Constant | Value | What it does |
| --- | --- | --- |
| `TONE_MAPPING` | `ToneMapping::Filmic` | Blender rendered with Filmic at exposure 0. three-d's Filmic is the Hable curve; its per-channel shoulder keeps saturated pinks and cyans from clipping to white, which `Aces` does not. |
| `EXPOSURE` | 1.0 | Blender exposure 0 is a factor of 1.0. |
| `BACKGROUND_GAIN` | 1.0 | Multiplier on `render.world_background` from the manifest, which is what the frame is cleared to. |

### Bloom

| Constant | Value | What it does |
| --- | --- | --- |
| `BLOOM_THRESHOLD` | 1.20 | Linear luminance where a pixel starts contributing. |
| `BLOOM_KNEE` | 0.35 | Width of the soft knee under the threshold. A hard threshold makes the halo boundary crawl as the wheel turns. |
| `BLOOM_STRENGTH` | 0.38 | How much of the *tight* blur round the composite adds back. |
| `BLOOM_WIDE_STRENGTH` | 0.055 | How much of the *wide* round. Well under the tight one: a wide wing at full weight fuses the 96 bulbs into one glowing tube and veils the void. |
| `BLOOM_TINT` | `[1.0, 0.95, 0.98]` | Slightly warm, slightly magenta. |
| `BLOOM_DOWNSAMPLE` | 2 | Bright pass and blurs run at 1/2 resolution, so 836x470 for this frame. |
| `BLOOM_BLUR_SPREADS` | `[1.9, 5.5]` | Gaussian **sigma** of the two rounds, in half-res texels — not a tap spacing. A sigma of `s` reads as a halo about `6s` frame pixels across. |
| `BLUR_TAPS_HALF` | 16 | Taps either side of centre, one half-res texel apiece. One tap per texel is what keeps the kernel a blur rather than a comb of displaced copies. |

`BLOOM_THRESHOLD` is 1.20 and the reason it can be that low is `src/scene.rs`: `PhysicalMaterial`'s
`emissive` is four `u8`s, so every glowing material used to arrive clamped at exactly 1.0 and a
threshold under it bloomed the whole LED wall into mush. The scene module now writes the real
linear emission over the clamped uniform. Note that the manifest's `MAT_Bulb_Glass` emission of 3.0
clears this threshold by a wide margin, so the bulb halos are large; that is the .blend's own
number and nothing here compensates for it.

### Vignette

| Constant | Value | What it does |
| --- | --- | --- |
| `VIGNETTE_CORNER_STRENGTH` | 0.18 | Corner darkening, 0 for off. About a fifth of a stop. Agent C measured the reference's vignette as gentle and asymmetric and warned that a strong vignette kills the bright bottom-right floor. |
| `VIGNETTE_INNER_RADIUS` | 0.55 | Where the darkening starts, in half-diagonals. |
| `VIGNETTE_OUTER_RADIUS` | 1.0 | Where it reaches full strength. 1.0 is the corner. |

### The shadow toe

| Constant | Value | What it does |
| --- | --- | --- |
| `SHADOW_LIFT` | 0.044 | Linear radiance added to the darkest pixels before the tone curve. |
| `SHADOW_LIFT_TINT` | `[0.55, 0.24, 1.0]` | Its hue, normalised to a largest channel of 1.0. Plum-violet. |
| `SHADOW_LIFT_RANGE` | 0.115 | Luminance at which the lift has faded to nothing, so nothing above the void is touched. |

### The beam cones

| Constant | Value | What it does |
| --- | --- | --- |
| `BEAM_STRENGTH` | 1.0 | Radiance added at a cone's core, before the tone curve. The two per-kind scales multiply it. |
| `BEAM_HEAD_STRENGTH_SCALE` | 1.28 | What a truss moving-head cone multiplies `BEAM_STRENGTH` by. |
| `BEAM_SPOT_STRENGTH_SCALE` | 0.5 | What a `Beam_L` / `Beam_R` cone multiplies it by. Under 1.0: the two Blender SPOTs are the biggest things in the upper half of the frame and are not among the reference's ten cones. |
| `PAR_BEAM_STRENGTH_SCALE` | 0.85 | What a PAR can cone multiplies it by. |
| `BEAM_SPOT_LENGTH` | 1.5 m | How far a spot cone reaches. From an apex at y 7.2 this ends at y 6.0, above the top of the LED wall at 6.35. |
| `BEAM_SPOT_LENGTH_FALLOFF` | 3.5 | Length-fade exponent for the two spot cones only, replacing `BEAM_LENGTH_FALLOFF`. Higher than the heads', because a spot's base circle is the one cone silhouette large enough on screen to read. |
| `BEAM_HEAD_LENGTH` | 4.2 m | How far a truss moving-head cone reaches. |
| `BEAM_EDGE_SOFTNESS` | 2.0 | Radial falloff exponent, core to edge. Above about 2.5 only a thin line down each cone survives. |
| `BEAM_LENGTH_FALLOFF` | 3.2 | Length-fade exponent for the head and PAR cones. |
| `BEAM_APEX_FADE` | 0.06 | Fraction of the length the cone ramps up over, so the apex is not a hard bright disc on the fixture. |
| `BEAM_AIM_INWARD` | `true` | Swing each truss cone's bearing toward `wheel.pivot`. Read the note below. |
| `BEAM_HEAD_LEAN_SCALE` | 0.6 | Fraction of a fixture's own lean off vertical that its cone keeps. Maps the ring's 38°/52° onto 23°/31°, inside the 20-35° agent C measured. |
| `BEAM_HEAD_HALF_ANGLE_FALLBACK` | 0.16 rad | Only used if the manifest carries no spot light. Normally the half-angle is `Beam_L`'s own `cone_outer_half_angle_rad`, 0.19199. |
| `BEAM_CONE_SEGMENTS` | 28 | Radial segments per cone. |

A cone's colour is not a tunable any more: `beam_specs` reads `Beam_L` / `Beam_R`'s own colour off
`assets/scene.json`, and `par_beam_specs` and the truss-head half of `beam_specs` both read
`MAT_Lens_Glow`'s `base_color` through the private helper `truss_fixture_color`. `BEAM_TINTS_LEFT`
and `BEAM_TINTS_RIGHT`, the four-tint tables keyed off the sign of a cone's `apex.x`, are gone —
see "What the cleanup pass removed" above.

### The PAR cans on the inner truss ring

`Truss_Par_Lens` is one baked mesh of 24 lens islands at identity, so there is no per-can node
transform to read. The apexes are measured by clustering the mesh's own world-space vertices.

| Constant | Value | What it does |
| --- | --- | --- |
| `PAR_LENS_NODE` | `"Truss_Par_Lens"` | The node whose mesh holds every PAR can lens. |
| `PAR_CLUSTER_RADIUS_M` | 0.5 m | How close two vertices have to be to count as the same lamp. The cans sit 1.55 m apart and each lens is 0.22 m across, so anything from 0.3 to 0.7 separates them. |
| `PAR_LAMP_LIMIT` | 48 | Guard on the clustering, not a measurement: the mesh has 24 islands and a malformed one must not become hundreds of cones. |
| `PAR_BEAM_LENGTH` | 4.6 m | How far a PAR cone reaches. Ends about 3.4 m above the floor and clear of the cyclorama. |
| `PAR_BEAM_LEAN` | 0.44 rad | Lean off vertical, 25°. The scene cannot supply it — the mesh is baked at identity, so every can reads as aiming straight down — and `docs/look_target.md` measures the reference's cones at 20 to 35 degrees. |
| `PAR_BEAM_PREFIX` | `"PAR_"` | Prefix of a PAR cone's `BeamSpec::name`, so its kind can be told from its name the way `MH_` already is. |

### The floor reflection

Screen space, and exact for a flat mirror seen from a level camera: for a pixel on the floor plane
the mirror image of whatever stands there is the frame itself reflected about that object's contact
line. The pass reconstructs each pixel's world position from the depth buffer, keeps the ones on
the floor plane, walks up the column for the contact line, and samples the colour buffer mirrored
about it, blurred and faded with depth. The floor's own gold ring inlays are already in the colour
buffer at that pixel and are added to, never blurred.

| Constant | Value | What it does |
| --- | --- | --- |
| `REFLECTION_STRENGTH` | 1.15 | How much of the mirrored frame is added at the contact line. Over 1.0 is allowed: the term is added to a floor whose own radiance is a fifth of the wheel's. |
| `REFLECTION_SATURATION` | 1.9 | Chroma multiplier about the reflection's own luminance, applied before the strength. A 369-sample mean of a gold bulb and the dark plate beside it is a desaturated pink; this returns the hue of the brightest thing in the kernel. |
| `REFLECTION_FADE_PX` | 95 px | Distance below the contact line over which the reflection falls to `1/e`. |
| `REFLECTION_SEARCH_PX` | 130 | How far up the column the pass looks for the contact line. A little over the fade length, and it bounds the cost: this is the only non-fixed loop in the chain. |
| `REFLECTION_BLUR_PX` | `(10.0, 48.0)` | Vertical blur half-width at the contact line and at the end of the fade. Growing with depth is what dissolves the inverted shape. |
| `REFLECTION_BLUR_H_PX` | 14 px | Horizontal blur half-width, constant with depth. Joins the reflected bulb dashes sideways so they read as one smear rather than parallel wires. |
| `REFLECTION_TAPS` | 41 | Taps in the vertical blur, each sampled at nine horizontal offsets: 369 samples per floor pixel. |
| `REFLECTION_JITTER` | `true` | Per-pixel phase inside one tap stride, hashed from `gl_FragCoord`. Without it every floor pixel reads the same 4.8 x 3.5 px lattice, which prints as a fixed checkerboard dither. Fixed per pixel, so `--shot` stays byte-deterministic. |
| `REFLECTION_SQUASH` | 1.6 | Vertical scale of the mirrored image. 1.0 is the true mirror for a level camera. |
| `FLOOR_PLANE_Y` | 0.0 m | World `y` of the floor plane. `Floor_Disc`'s top face is the exported frame's `y = 0`. |
| `FLOOR_PLANE_TOLERANCE` | 0.06 m | How far off that plane a reconstructed position may be and still count as floor. `Floor_Rings` at 16 mm is in; the wheel's base plate at 0.14 m is out. |

### Non-tunable public constants

`SPOT_BEAM_LIGHTS` (`["Beam_L", "Beam_R"]`), `MOVING_HEAD_COUNT` (12), `FIXTURE_LOCAL_AIM`
(`(0, -1, 0)`), and the six `*_SHADER_ID` values: `BRIGHT_PASS_SHADER_ID` 0x0A01,
`BLUR_SHADER_ID` 0x0A02, `COMPOSITE_SHADER_ID` 0x0A03, `COMPOSITE_BLOOM_SHADER_ID` 0x0A04,
`BEAM_SHADER_ID` 0x0A05, `REFLECTION_SHADER_ID` 0x0A06. All inside three-d's public
`0x0000..=0x4FFF` range; 0x0A07 is free again now that the streak pass is gone.

## Two things the next agent needs to know

**1. The cones are aimed by this file, not by the scene, and it was forced.** The author points all
twelve moving heads *outward*. `MH_01_Lens` sits 10.04 m from the arena axis and aims further out;
the cyclorama is at 11.3 m, so an outward cone has about a metre of clear air and the depth test
cuts it off inside the wall. `BEAM_AIM_INWARD` turns each cone's *bearing* toward `wheel.pivot` and
scales its lean by `BEAM_HEAD_LEAN_SCALE`, keeping the ring's alternating tilt so no two neighbours
come out parallel. Set it to `false` for the author's aim back, and expect the head cones to
disappear. This is the one place the beams leave the scene data, and `docs/look_target.md` is the
authority the plan gives for it.

**2. Only two of the twelve moving-head cones can ever reach this frame.** Projected through
`Cam_Hero`: `MH_07` to `MH_12` hang behind the camera, `MH_01` and `MH_06` land about 106 px
outside the left and right edges, and `MH_03` and `MH_04` sit inside the wheel disc and therefore
behind it. Rendering at 25x the shipping strength confirmed it — two cones, no more. The lamps the
frame actually shows along the truss arcs are the PAR cans, which is why they have cones at all.

## Helpers, exposed because they are testable without a GPU

```rust
pub struct BeamSpec { name: String, apex: Vec3, axis: Vec3, length: f32, half_angle: f32,
                      color: [f32; 3] }
pub struct Beam { spec: BeamSpec, object: Gm<Mesh, BeamMaterial> }

// Resolves the manifest's two spots, then each MH_nn_Lens the closure can find. Pure.
pub fn beam_specs(&Manifest, node_transform: impl Fn(&str) -> Option<Mat4>) -> Vec<BeamSpec>
// One cone per PAR can, from world-space lens vertices. Pure.
pub fn par_beam_specs(&Manifest, positions: &[Vec3]) -> Vec<BeamSpec>
pub fn par_lamp_apexes(positions: &[Vec3]) -> Vec<Vec3>   // greedy island clustering
pub fn moving_head_lens_name(index: u32) -> String        // "MH_07_Lens"
pub fn scale_lean(aim: Vec3, up: Vec3, lean_scale: f32) -> Vec3
pub fn swing_into_arena(apex: Vec3, aim: Vec3, target: Vec3, up: Vec3, lean_scale: f32) -> Vec3
pub fn cone_transformation(&BeamSpec) -> Mat4             // unit cone -> world
pub fn cone_mesh(segments: u32) -> CpuMesh                // the one authored mesh
fn truss_fixture_color(&Manifest) -> [f32; 3]             // MAT_Lens_Glow's base_color, private
pub struct BeamMaterial { apex, axis, length, tan_half_angle, color, strength, edge_softness,
                          length_falloff, apex_fade }     // impl Material
pub fn BeamMaterial::new(&BeamSpec, strength: f32) -> BeamMaterial
```

`cone_mesh` is the one hand-authored mesh in the crate. `docs/agent_plan.md` invariant 2 forbids
modelling geometry in Rust; a beam cone is the documented exception, because it is a light effect
rather than scene modelling and `wheel_stage.blend` has no such geometry to export. Everything that
*places* a cone still comes out of the scene: the two spot cones from `assets/scene.json`, the
twelve head cones from `MH_nn_Lens` world transforms in the GLB, the PAR cones from
`Truss_Par_Lens`'s own vertices.

Nine unit tests cover the module, all GPU-free (`cargo test --bins postfx`): the two spots match
the manifest verbatim (position, direction and colour), all twelve lenses resolve and aim
downward, the truss cones lean 18-36° off vertical and head for the stage with more than one
distinct lean, the swing keeps the lean and turns only the bearing, the PAR mesh clusters into one
ring of 24 lamps whose cones stay inside the room, the cone transform keeps its handedness and
lands on the axis, the mesh is wound outward, every truss cone's colour comes from `MAT_Lens_Glow`
rather than from which side of the frame it hangs on, and the bloom targets are never degenerate.

## Traps found the hard way, kept here so nobody pays for them twice

- **`pow(0.0, y)` returns NaN on this driver.** The beam shader's falloffs hit an exact zero over a
  large area, one NaN fragment poisoned the whole bloom through the blur, and the frame printed
  hard black wedges over the floor and the podium. Every `pow` base in this file is
  `max(x, POW_FLOOR)`, and the bright pass drops any non-finite fragment before the blur can smear
  it. The reflection pass drops one too.
- **A cone shell cannot carry a radial coordinate.** Every point of a cone's lateral surface is at
  the cone's edge, so "distance from the axis over the radius here" is 1 everywhere and the cone
  renders black. `|dot(normal, toEye)|` is the obvious replacement and is also wrong: it measures
  how squarely the shell faces the viewer, so a cone pointing along the view axis goes nearly
  black, and this camera sits inside the truss ring. What the shader uses is the sight ray's miss
  distance from the cone axis over the cone's radius there, which does not care which way a cone
  points.
- **`apply_screen_effect` draws through `viewer.viewport()`.** An intermediate pass at half
  resolution needs a viewer whose viewport is the *destination* size, or it writes a quarter of the
  target and leaves the rest black — as a doubled, blurred copy of the frame's bottom-left quarter
  offset to the top right. That is what the private `PassViewer` is for; the scene camera cannot be
  used for the bloom passes.
- **`program.use_uniform` panics on a uniform the shader does not declare.** The composite has two
  shader variants, with and without bloom, so the bloom uniforms are sent only in the variant that
  declares them — and the variants have different `EffectMaterialId`s, or the program cache hands
  back the wrong compiled program.
- **`Blend::ADD` adds alpha too.** The cones write alpha 0 so the frame's alpha is left alone.
- **`Cull::Back`, not `Cull::None`, on the cones.** With both faces drawn the same pixel is shaded
  twice and drops to half brightness wherever geometry hides the far side of the shell.
- **The two blur rounds need separate targets.** Run in series into one target, the second round
  blurs the first round's output and the composite only ever sees the wide result, so there is no
  tight halo anywhere in the frame.
