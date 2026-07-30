# `src/postfx.rs` — public surface and tunables

Owner: agent I. Bloom, tone mapping, vignette, additive beam cones.

Everything below was compiled (`cargo check` clean) and run (`cargo run --bin game-show-v1 --
--shot`, 1672x941, shaders compiled, 14 cones built). The look was judged on the rendered frame
and on `renders/crops_i/` against `renders/ref_crops/`, never on a summary statistic.

## Entry points

```rust
// Allocate. Builds the beam cones; loads the GLB's node tree itself for the twelve
// MH_nn_Lens transforms, because the manifest has no moving-head data.
PostFx::new(&Context, &Manifest, width: u32, height: u32) -> crate::Result<PostFx>

// Same, without the second GLB parse, when a Stage is already loaded. Prefer this in main.rs.
PostFx::new_with_stage(&Context, &Manifest, &scene::Stage, width: u32, height: u32)
    -> crate::Result<PostFx>

// The whole frame: scene + beams into the HDR target, then the chain into `target`.
// This is the signature src/main.rs and src/shot.rs already call. Unchanged.
PostFx::render(
    &mut self,
    context: &Context,
    target: &RenderTarget<'_>,
    camera: &mut Camera,
    objects: &[&dyn Object],
    lights: &[&dyn Light],
) -> crate::Result<()>

// The chain alone, over a colour texture somebody else rendered: bright pass, blur,
// composite (exposure, bloom, vignette, tone map, sRGB) into `target`.
// `color` must be linear and un-tone-mapped, and wants to be floating point.
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
`bloom_strength: f32`, `vignette_strength: f32`. Each starts at the constant of the same name.

`render` calls `resize` itself if `target` is a different size, so a window resize cannot
desynchronise the chain.

## Switchable stages

```rust
pub struct Stages { pub bloom: bool, pub tone_map: bool, pub vignette: bool, pub beams: bool }
```

`Default` is all four on. `tone_map: false` skips the curve but still encodes sRGB, because the
target is written for display or for a PNG either way. `beams: false` leaves the cones out of
`render`'s own draw call; the cones still exist and `beams()` still returns them.

## Tunable constants — the look-dev block

All of these are in one delimited block at the top of the file, each with the measurement or the
reference note behind its value. Ranked by how likely it is that look-dev needs to move it.

| Constant | Value | What it does |
| --- | --- | --- |
| `BLOOM_THRESHOLD` | 1.20 | Linear luminance where the bloom starts. Read the note below. |
| `BEAM_STRENGTH` | 3.0 | Radiance at a cone's core. High on purpose; see below. |
| `BLOOM_STRENGTH` | 0.55 | How much blurred bright pass is added back. |
| `BLOOM_KNEE` | 0.35 | Soft knee under the threshold. A hard knee makes halos crawl. |
| `BLOOM_BLUR_SPREADS` | `[1.0, 3.5]` | Tap spacing of the two blur rounds, in half-res texels. Two rounds because the reference has a tight halo *and* a 25-40 px wing. |
| `BLOOM_DOWNSAMPLE` | 2 | Bright pass and blurs run at 1/2 resolution. |
| `BLOOM_TINT` | `[1.0, 0.95, 0.98]` | Bloom is warm-pink: the reference's hot cores clip to pale lemon and pale pink, not neutral white. |
| `VIGNETTE_CORNER_STRENGTH` | 0.18 | Corner darkening. Agent C measured the reference's vignette as gentle and asymmetric and warned that a strong vignette kills the bright bottom-right floor. |
| `VIGNETTE_INNER_RADIUS` / `VIGNETTE_OUTER_RADIUS` | 0.55 / 1.0 | Where the darkening starts and tops out, in half-diagonals. |
| `TONE_MAPPING` | `ToneMapping::Filmic` | Blender rendered with Filmic at exposure 0. three-d's Filmic is the Hable curve; its per-channel shoulder keeps saturated pinks and cyans from clipping to white, which `Aces` does not. |
| `EXPOSURE` | 1.0 | Blender exposure 0 is a factor of 1.0. |
| `BACKGROUND_GAIN` | 1.0 | Multiplier on `render.world_background` from the manifest, which is what the frame is cleared to. |
| `BEAM_EDGE_SOFTNESS` | 1.6 | Radial falloff exponent. Above ~2.5 only a thin line down each cone survives. |
| `BEAM_LENGTH_FALLOFF` | 2.5 | Fade along the cone. The reference's cones are brightest over their first third. |
| `BEAM_APEX_FADE` | 0.06 | Fraction of the length the cone ramps up over, so the apex is not a hard disc on the lens. |
| `BEAM_SPOT_LENGTH` / `BEAM_HEAD_LENGTH` | 8.0 / 5.0 m | Cone lengths. Both stop above the floor: no cone pools light on the floor in the reference. |
| `BEAM_AIM_INWARD` | `true` | Swing the truss cones into the arena. Read the note below. |
| `BEAM_HEAD_LEAN_SCALE` | 0.6 | Fraction of a fixture's own lean off vertical that its cone keeps. Maps the ring's 38°/52° onto 23°/31°, inside the 20-35° agent C measured. |
| `BEAM_TINTS_LEFT` / `BEAM_TINTS_RIGHT` | 4 each | Cone tints by side, cycled by fixture index. Lavender/magenta/cyan on the left; amber-gold, lavender, cyan on the right. The amber has no source in the .blend and is the reference's warm accent. |
| `BEAM_CONE_SEGMENTS` | 28 | Radial segments per cone. |
| `BEAM_HEAD_HALF_ANGLE_FALLBACK` | 0.16 rad | Only used if the manifest carries no spot light. Normally the half-angle is `Beam_L`'s own `cone_outer_half_angle_rad`, 0.19199. |

Non-tunable public constants: `SPOT_BEAM_LIGHTS`, `MOVING_HEAD_COUNT`, `FIXTURE_LOCAL_AIM`, and
the five `*_SHADER_ID` values (`0x0A01`..`0x0A05`, inside three-d's public `0x0000..=0x4FFF`
range).

## Two things the next agent needs to know

**1. The bloom cannot separate the lens glows from the LED wall yet, and that is not a bloom
bug.** `PhysicalMaterial::emissive` is four `u8`s, so `src/scene.rs` clamps every glowing
material to exactly 1.0: `MAT_Lens_Glow` (6.0 in Blender), `MAT_Bulb_Glass` (3.0) and
`MAT_LED_Screen` (1.5) all land on the same value. The wall fills most of the frame at that
value. A threshold under 1.0 therefore blooms the whole wall into mush — rendered and looked at,
it washes the picture out and buries the reference's midtone contrast. 1.20 keeps only pixels that
clear the ceiling *plus* real lighting: the bulb channel, the gold rim speculars, the crest
crystal, the podium's hot desk band. The cost is that a moving-head lens at exactly 1.0 does not
bloom, and in `renders/ref_crops/truss.png` the blown lens cores with halos one and a half to two
diameters wide are the whole story of that region. The fix belongs in `src/scene.rs`: the
`HdrEmissive` wrapper from `docs/three_d_api.md` §5 option (b), giving those two materials their
real 6.0 and 3.0. Nothing in `postfx.rs` has to change when it lands.

**2. The truss cones are aimed by this file, not by the scene, and it was forced.** The author
points all twelve moving heads *outward*. `MH_01_Lens` sits 10.04 m from the arena axis and aims
further out; the LED wall is at 10.5 m. Every cone therefore has under half a metre of clear air
and is swallowed by the wall — rendered with the author's aim, the frame shows no cones at all. In
Blender this costs nothing because EEVEE draws no volumetrics here and the reference is a painting
anyway. `BEAM_AIM_INWARD` turns each cone's *bearing* toward `wheel.pivot` and scales its lean by
`BEAM_HEAD_LEAN_SCALE`, keeping the ring's alternating tilt so no two neighbours are parallel. Set
the constant to `false` for the author's aim back, and expect no visible cones.

Also worth knowing: `BEAM_STRENGTH` is 3.0, which is high for an additive effect. The LED wall
wraps 360° and sits behind almost every cone at a linear 0.8 to 1.0, so a lavender cone on a
lavender wall has very little contrast; the reference has its cones against a near-black ceiling
void. At 1.5 they are invisible. This is the first beam knob to re-tune once the wall and the
light rig settle.

## Helpers, exposed because they are testable without a GPU

```rust
pub struct BeamSpec { name: String, apex: Vec3, axis: Vec3, length: f32, half_angle: f32,
                      color: [f32; 3] }
pub struct Beam { spec: BeamSpec, object: Gm<Mesh, BeamMaterial> }

// Resolves every cone the scene data supports: the manifest's spots, then each MH_nn_Lens the
// closure can find. Pure.
pub fn beam_specs(&Manifest, node_transform: impl Fn(&str) -> Option<Mat4>) -> Vec<BeamSpec>
pub fn moving_head_lens_name(index: u32) -> String                     // "MH_07_Lens"
pub fn swing_into_arena(apex: Vec3, aim: Vec3, target: Vec3, up: Vec3, lean_scale: f32) -> Vec3
pub fn cone_transformation(&BeamSpec) -> Mat4                          // unit cone -> world
pub fn cone_mesh(segments: u32) -> CpuMesh                             // the one authored mesh
pub struct BeamMaterial { apex, axis, length, tan_half_angle, color, strength, edge_softness,
                          length_falloff, apex_fade }                  // impl Material
pub fn BeamMaterial::new(&BeamSpec, strength: f32) -> BeamMaterial
```

`FIXTURE_LOCAL_AIM` is `(0, -1, 0)`: Blender fixtures aim down local -Z and the export maps
`(x, y, z) -> (x, z, -y)`. Checked against the GLB — every `MH_nn_Yoke` gives exactly `(0, -1, 0)`
before its head's tilt.

Eight unit tests cover it, all GPU-free (`cargo test --bins postfx`): the spots match the manifest
verbatim, all twelve lenses resolve and aim downward, the cones lean 18-36° off vertical and head
for the stage with more than one distinct lean, the cone transform keeps its handedness and lands
on the axis, the mesh is wound outward, the tints split left/right, and the bloom targets are never
degenerate.

## Traps found the hard way, kept here so nobody pays for them twice

- **`pow(0.0, y)` returns NaN on this driver.** The beam shader's falloffs hit an exact zero over
  a large area, one NaN fragment poisoned the whole bloom through the blur, and the frame printed
  hard black wedges over the floor and the podium. Every `pow` base in this file is
  `max(x, POW_FLOOR)`, and the bright pass drops any non-finite fragment before the blur can smear
  it.
- **A cone shell cannot carry a radial coordinate.** Every point of a cone's lateral surface is at
  the cone's edge, so "distance from the axis over the radius here" is 1 everywhere and the cone
  renders black. The radial falloff is `|dot(normal, toEye)|` instead, with the normal derived
  analytically from the cone's own definition, so the mesh needs no normals.
- **`apply_screen_effect` draws through `viewer.viewport()`.** An intermediate pass at half
  resolution needs a viewer whose viewport is the *destination* size, or it writes a quarter of the
  target and leaves the rest black. That is what the private `PassViewer` is for; the scene camera
  cannot be used for the bloom passes.
- **`program.use_uniform` panics on a uniform the shader does not declare.** The composite has two
  shader variants, with and without bloom, so the three bloom uniforms are sent only in the variant
  that declares them — and the variants have different `EffectMaterialId`s, or the program cache
  hands back the wrong compiled program.
- **`Blend::ADD` adds alpha too.** The cones write alpha 0 so the frame's alpha is left alone.
- **`Cull::Back`, not `Cull::None`, on the cones.** With both faces drawn the same pixel is shaded
  twice and drops to half brightness wherever geometry hides the far side of the shell.
