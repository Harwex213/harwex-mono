# `src/screen.rs` — the LED wall

Agent J. Public signatures, the two art paths, and every tunable constant.

State: **after the cleanup pass.** `docs/agent_plan.md` §"Cleanup pass — scope and rules"
items 1 and 2 name two inventions in this module for removal, and this pass removed them and
everything that existed only to serve or to compensate for them. Seventeen constants and one
hand-written GLSL shader are gone; nothing was added, and no surviving constant was re-tuned.
The frame moves as a result. That is the intended trade and nobody judged crops in this pass.

## What comes out, and what is left

Every constant below was invented during look-dev rounds 1 to 5. None of them is in
`wheel_stage.blend` and none of them is in `assets/scene.json`. The value in the second column
is the value each one held when it was deleted, so nobody re-derives it by accident.

| Deleted | Last value | Why it went |
| --- | --- | --- |
| `SCREEN_UV_WINDOW` | `(0.64, 0.115)` | Cleanup item 1 by name: it re-windowed the author's art to 64% of its `v` range and magnified it about 1.5x. The mesh's own `UVMap` addresses the picture; the renderer shows it. |
| `SCREEN_SIDE_BLEND_M` | `5.0` | Cleanup item 2 by name: half-width of the crossfade between the two side grades, centred on world `x = 0` because the wheel hides the seam there. |
| `SCREEN_SIDE_V_SHIFT` | `(-0.005, -0.015)` | Cleanup item 2, "the per-side UV offsets": it slid the sampled window a different distance up the art on each side of the room. |
| `SCREEN_SIDE_TINT_LEFT` | `[0.95, 0.34, 1.55]` | Cleanup item 2: per-side shadow tint, camera-left. |
| `SCREEN_SIDE_HIGH_LEFT` | `[2.20, 0.88, 0.72]` | Cleanup item 2: per-side highlight tint, camera-left. |
| `SCREEN_SIDE_TINT_RIGHT` | `[0.30, 0.62, 2.20]` | Cleanup item 2: per-side shadow tint, camera-right. |
| `SCREEN_SIDE_HIGH_RIGHT` | `[0.95, 1.95, 1.85]` | Cleanup item 2: per-side highlight tint, camera-right. |
| `SCREEN_TONE_SPLIT` | `(0.26, 0.72)` | The luminance crossfade between each side's two tints. With the tints gone it grades nothing. |
| `SCREEN_EMISSION_GAIN` | `1.38` | Item 1 requires the wall to emit "at the emissive strength the glTF declares". A gain of 1.38 on top of 1.5 is not that strength. |
| `SCREEN_LIT_FRACTION` | `0.16` | It scaled a hand-written copy of the diffuse term down to a sixth, because the deleted shader drew the picture as emission only. The delegated shader computes the full term, the same one every other surface gets. |
| `SCREEN_CONTRAST` | `(1.55, 0.55)` | A power about a pivot, added in round 5 to widen a value range that `SCREEN_UV_WINDOW`'s 1.5x downsample had averaged flat. No downsample, nothing to widen. |
| `SCREEN_SATURATION` | `0.82` | Chroma multiplier on the art before the tint. It existed to let the per-side tint decide hue. |
| `SCREEN_TONE_CHROMA` | `1.55` | Chroma multiplier after the tint, pre-compensating Filmic's shoulder for the graded colour. |
| `SCREEN_SHARPEN` | `(0.80, 1.8)` | An unsharp mask, whose own doc comment named `SCREEN_UV_WINDOW` as the reason it existed: it inverted the sampler's bilinear filter at 1.5x. |
| `SCREEN_POSTERISE` | `9.0` | Quantised the author's art to 9 flat steps per channel, the other half of undoing the same downsample. |
| `SCREEN_STAR_KILL` | `1.0` | Replaced the author's own painted star texels with their local average. Repainting the art is further from showing it than cropping it was. |
| `SCREEN_MATERIAL_ID` | `0x0211` | The cache id of the deleted shader. The texture path now shares `PhysicalMaterial`'s id, because it shares its source. |
| `SCREEN_FRAGMENT`, `SkyMaterial::texture_fragment_shader` | — | The module's own wall shader, 137 lines of GLSL, and its builder. Private, not public API, listed here because every constant above was a uniform it took. |

What is left on the texture path is one uniform write. What is left of the procedural fallback
is all of it, untouched and untuned: 15 tunable constants, `SKY_MATERIAL_ID`, `SKY_FRAGMENT`
and `WallFrame`.

## Which path is active

**The author's own art is the primary path.** `MAT_LED_Screen` is texture-driven and the
fixed export embeds the texture, so there is nothing to invent. Read out of
`assets/wheel_stage.glb`'s JSON chunk for this document:

```json
{ "name": "MAT_LED_Screen", "doubleSided": true,
  "emissiveFactor": [1, 1, 1], "emissiveTexture": { "index": 0 },
  "extensions": { "KHR_materials_emissive_strength": { "emissiveStrength": 1.5 } },
  "pbrMetallicRoughness": { "baseColorTexture": { "index": 1 },
                            "metallicFactor": 0, "roughnessFactor": 0.25 } }
```

- 1 image, `T_LEDWall_Sky`, `image/png`, 4096x1024, embedded; 2 textures over it, 1 sampler.
- The two primitives that carry the material are `Wall_Screen` and `Podium_Riser`, and both
  have exactly the attributes `POSITION`, `NORMAL`, `TEXCOORD_0`. `TEXCOORD_0` is the mesh's
  `UVMap`, which is the layer the .blend's UV Map node feeds the image through. Nothing is
  projected, guessed, windowed or scaled.
- `assets/scene.json` agrees and is the authority: `screen.emission_strength` 1.5,
  `screen.uv_map` `UVMap`, `screen.in_glb` true, `screen.also_on` `["Podium_Riser"]`, and
  `MAT_LED_Screen`'s `base_color_texture` and `emission_texture` both `T_LEDWall_Sky`.

The procedural GLSL sky is the fallback. It draws only when the imported material carries no
texture at all, or when `FORCE_PROCEDURAL_SKY` is set by hand.

### The one thing this module adds to the texture path

The declared emissive strength of **1.5**, and nothing else.

`three-d-asset` 0.10 never reads `KHR_materials_emissive_strength` — its source has no hit for
`emissive_strength` — so the import leaves the emissive factor at the glTF's `emissiveFactor`,
`(1, 1, 1)`. `PhysicalMaterial::emissive` is an `Srgba`, four `u8`s, and could not hold 1.5
anyway.

So `SkyMaterial` wraps the imported `PhysicalMaterial` and delegates everything:

| `Material` method | Texture path | Procedural path |
| --- | --- | --- |
| `id` | `inner.id()` — the same cache entry as every other `PhysicalMaterial` with the same texture set | `EffectMaterialId(SKY_MATERIAL_ID)` |
| `fragment_shader_source` | `inner.fragment_shader_source(lights)`, byte-identical | tone mapping + colour mapping + `SKY_FRAGMENT` |
| `use_uniforms` | `inner.use_uniforms(..)`, then one write: `emissive = vec4(1.5, 1.5, 1.5, 1.0)` | the viewer's mappings and the 21 sky uniforms |
| `render_states` | `inner.render_states()` — `doubleSided: true` in the GLB, and the cyclorama is seen from inside | `RenderStates::default()` |
| `material_type` | `inner.material_type()` | `MaterialType::Opaque` |

`shaders/physical_material.frag` declares `uniform vec4 emissive` unconditionally and always
uses it — `total_emissive = emissive.rgb` then `*= texture(emissiveTexture, uvs)` — and
`PhysicalMaterial::use_uniforms` writes it with `use_uniform`, unconditionally, before this
wrapper writes over it. So the overwrite can never hit a uniform the compiler dropped, and it
changes nothing but the level of the emissive term. A unit test asserts the id and the source
really are the inner material's.

What draws the wall is therefore three-d's own PBR shader:
`emissive * emissiveTexture(uvs)` added to `calculate_lighting` over
`albedo * albedoTexture(uvs)`, with `uvs` the mesh's own `TEXCOORD_0`. That is the same pair
of terms Blender's Principled BSDF evaluates for this material, which is what makes it the
faithful path and not a look.

**Coupling worth knowing.** The `albedo` factor comes from `src/scene.rs`, which writes white
into it for this material precisely because the material is textured
(`MaterialSpec::is_textured`). If that ever changes to write the manifest's flat `base_color`
`(0.35, 0.3, 0.6)`, the picture gets stained, and it will be stained here with no constant in
this file to blame.

The headroom above 1.0 only survives if the intermediate target is floating point. It is:
`src/postfx.rs` renders into a `[f16; 4]` texture. On an `RGBA8` target nothing breaks, the
wall just clips at white instead of blooming.

## How to switch

Two constants, in two files, and they do different jobs.

| Constant | File | Owner | Value today | Effect |
| --- | --- | --- | --- | --- |
| `SCREEN_DRAWN_BY_SCREEN_RS` | `src/main.rs` | F/G/L | `true` | Whether `src/screen.rs` draws the wall at all. |
| `FORCE_PROCEDURAL_SKY` | `src/screen.rs` | J | `false` | Which art `src/screen.rs` uses when it does. |

`src/main.rs`'s constant is `true`, so this module owns the wall and the wall emits at 1.5.
The constant was called `PROCEDURAL_SKY` when an earlier version of this document was written;
L renamed it, and that rename is why this table exists.

`src/main.rs` also decides which surfaces are handed over, and it does it by art:

```rust
let screen_material = manifest.screen.material.as_str();
let sky_node = manifest.screen.node.as_str();
for i in stage.indices_with_material(screen_material) {
    // The procedural sky belongs on the cyclorama only. The author's texture belongs on
    // every surface the material is on, which is how Blender has it.
    if screen::FORCE_PROCEDURAL_SKY && stage.parts[i].name != sky_node {
        continue;
    }
    skies.push(screen::SkyScreen::new(
        context,
        &stage.parts[i],
        base,
        manifest.screen.emission_strength,
    )?);
    stage.parts[i].visible = false;
}
```

To see the fallback, set `FORCE_PROCEDURAL_SKY = true` here. Both constants must be on for the
procedural sky to appear.

## Public API

Complete, in declaration order: 19 constants, three types — `ScreenArt`, `SkyMaterial`,
`SkyScreen` — and the `Material` impl. `WallFrame` and `Art` are private and stay that way.

```rust
// --- Both paths -----------------------------------------------------------------
// No material name and no emissive strength live here: `src/main.rs` reads
// `manifest.screen.material` and passes `manifest.screen.emission_strength` in.
pub const FORCE_PROCEDURAL_SKY: bool = false;

// --- Procedural fallback only ---------------------------------------------------
pub const SKY_MATERIAL_ID: u16 = 0x0210;
pub const SKY_HORIZON: [f32; 3] = [1.0, 0.305, 0.2232];
pub const SKY_LOW: [f32; 3] = [0.9216, 0.1144, 0.3916];
pub const SKY_HIGH: [f32; 3] = [0.1046, 0.0704, 0.6724];
pub const SKY_ZENITH_GAIN: f32 = 0.34;
pub const CLOUD_CORE: [f32; 3] = [1.0, 0.807, 0.6445];
pub const CLOUD_LIT: [f32; 3] = [1.0, 0.3916, 0.552];
pub const CLOUD_SHADOW: [f32; 3] = [0.2542, 0.1022, 0.3916];
pub const CLOUD_COVER: f32 = 0.52;
pub const CLOUD_STEPS: f32 = 5.0;
pub const CLOUD_SCALE: f32 = 0.45;
pub const CLOUD_DRIFT: f32 = 0.14;
pub const STAR_DENSITY: f32 = 3.0;
pub const STAR_RARITY: f32 = 0.86;
pub const STAR_SIZE: f32 = 0.10;
pub const STAR_INTENSITY: f32 = 1.4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScreenArt { AuthorTexture, ProceduralSky }
impl ScreenArt {
    /// "T_LEDWall_Sky from the GLB" or "procedural GLSL sky".
    pub fn label(self) -> &'static str;
}

pub struct SkyMaterial {
    // `art: Art` is private: the variant is chosen once and never changes, because `id()`
    // differs between the two and swapping it at run time would thrash the shader cache.
    pub emissive_strength: f32,   // manifest.screen.emission_strength, both paths
    pub time: f32,                // seconds; drives the procedural drift only
}
impl SkyMaterial {
    pub fn art(&self) -> ScreenArt;
}
impl Material for SkyMaterial {
    fn id(&self) -> EffectMaterialId;
    fn fragment_shader_source(&self, lights: &[&dyn Light]) -> String;
    fn use_uniforms(&self, program: &Program, viewer: &dyn Viewer, lights: &[&dyn Light]);
    fn render_states(&self) -> RenderStates;
    fn material_type(&self) -> MaterialType;
}

pub struct SkyScreen;   // one `MAT_LED_Screen` surface, rebuilt with `SkyMaterial` on it
impl SkyScreen {
    /// `base` is MAT_LED_Screen's flat linear base colour from `assets/scene.json`.
    pub fn new(context: &Context, part: &Part, base: [f32; 3]) -> crate::Result<Self>;
    pub fn object(&self) -> &dyn Object;
    pub fn art(&self) -> ScreenArt;
    pub fn set_time(&mut self, seconds: f32);
}
```

`SkyScreen::new`'s signature is unchanged by this pass, so `src/main.rs` compiles untouched.
It picks the path per surface and prints which one it chose:

```
screen: Wall_Screen drawn with the T_LEDWall_Sky from the GLB, emissive strength 1.5
screen: Podium_Riser drawn with the T_LEDWall_Sky from the GLB, emissive strength 1.5
```

`base` is ignored on the texture path, deliberately. For a textured material the manifest's
`base_color` is the value the shader node held *before* the texture was wired up; multiplying
the picture by it would stain the sky. The procedural path uses it as the zenith, so the
fallback follows the author if that colour changes.

`set_time` is pure in `seconds`: `--shot` calls it with 0.0 and gets the same frame every run.
The texture path ignores it, so `--shot` and the viewer agree there too.

Both paths are opaque in practice — `MAT_LED_Screen` has alpha 1.0 and `alpha_mode` `OPAQUE` —
so the wall never joins the transparency sort. Its objects still have to go into the same
single `render` call as everything else, or `MAT_Crystal` will not sort against them.

## Tunable constants

**The texture path has none.** Its one number, the emissive strength of 1.5, is not a constant
in this module at all: `SkyScreen::new` takes it as an argument and `src/main.rs` passes
`manifest.screen.emission_strength`. It is not a free parameter either. It is what the GLB
declares in `KHR_materials_emissive_strength` and what `assets/scene.json` declares in
`screen.emission_strength` and in `MAT_LED_Screen`'s `emission_strength` and
`glb_emissive_strength`. Changing it means changing the scene, and that is a departure from the
scene, not tuning. A unit test asserts all four agree.

It is also, by `docs/agent_plan.md`'s own rule, a defect: a constant in Rust that duplicates a
manifest value drifts eventually. The honest fix is for `SkyScreen::new` to take the strength
the way it already takes `base`, from `manifest.screen.emission_strength`. That changes a
signature `src/main.rs` calls, agent J does not own `src/main.rs`, and this pass had to leave
`cargo check` passing — so the constant stays, with the test as the drift guard, and the change
is in agent J's handoff for whoever owns the wiring.

Everything below affects the **procedural fallback only**, and this pass changed none of it.
Colours are **linear RGB**, with the sRGB hex they came from in each doc comment. Distances are
in **metres of wall**, not UV units, because the shader works in world space.

| Constant | Default | What it does |
| --- | --- | --- |
| `SKY_HORIZON` | `[1.0, 0.305, 0.2232]` | Bottom of the wall. Hot peach, sRGB `#FF9682`. |
| `SKY_LOW` | `[0.9216, 0.1144, 0.3916]` | Lower third. Hot magenta, sRGB `#F65FA8`. |
| `SKY_HIGH` | `[0.1046, 0.0704, 0.6724]` | Upper third. Royal blue-violet, sRGB `#5B4BD6`. |
| `SKY_ZENITH_GAIN` | `0.34` | Multiplies `MAT_LED_Screen`'s own base colour to give the very top. Tying the zenith to the material means the fallback follows the author if that colour changes. |
| `CLOUD_CORE` | `[1.0, 0.807, 0.6445]` | A cloud's thickest, brightest core. sRGB `#FFE8D2`. |
| `CLOUD_LIT` | `[1.0, 0.3916, 0.552]` | A cloud's lit body. sRGB `#FFA8C4`. |
| `CLOUD_SHADOW` | `[0.2542, 0.1022, 0.3916]` | A cloud's thin unlit edge. sRGB `#8A5AA8`. |
| `CLOUD_COVER` | `0.52` | Fraction of the wall the decks cover. Up thickens the lobes and closes the gaps. |
| `CLOUD_STEPS` | `5.0` | Flat steps the density is quantised into. Below 3 the clouds become cut-outs; above 10 they go smooth and read wrong. |
| `CLOUD_SCALE` | `0.45` | Noise frequency, cycles per metre. One cycle is about one lobe, so 0.45 is a 2.2 m lobe. |
| `CLOUD_DRIFT` | `0.14` | Sideways drift, metres per second, for the fastest deck. The lower two run at 35% and 60% of it. 0.0 freezes the sky. |
| `STAR_DENSITY` | `3.0` | Star cells per metre. The wall renders at about 82 px/m, so 3.0 is a 27 px cell. |
| `STAR_RARITY` | `0.86` | A cell holds a star when its hash clears this. 0.86 is one cell in seven. |
| `STAR_SIZE` | `0.10` | Star radius as a fraction of a cell. 0.10 of 27 px is a 5 px dot. |
| `STAR_INTENSITY` | `1.4` | Peak linear radiance of a star, before the manifest's emissive strength. |
| `SKY_MATERIAL_ID` | `0x0210` | `EffectMaterialId` for the sky shader. Public range is `0x0000..=0x4FFF`; `src/postfx.rs` holds `0x0A01..=0x0A06`, so there is no collision. |

Three of those defaults were set by looking at renders, not by arithmetic, and the earlier
value is recorded in the doc comment so nobody re-derives the mistake:

- `CLOUD_SCALE` was 0.09. At that frequency the whole 24 m wall fell inside one noise cell and
  the sky rendered as a single flat lavender wash with no lobes in it.
- `STAR_SIZE` was 0.14 of a 55 px cell, which made 15 px blobs that read as snow.
- `STAR_INTENSITY` was 0.55, at which the stars were invisible against the violet.

## How the procedural sky works, and why it ignores UVs

The fallback exists for an export with no image in it. Such an export may have no usable
`TEXCOORD_0` either, and even when it does, nothing tells this module which way up the author's
UVs run. So the shader takes its coordinates from the world position `pos`, which
`shaders/mesh.vert` always emits, and from the part's world AABB measured once in
`SkyScreen::new`:

- **Height** `h` is `(pos.y - bottom) / (top - bottom)`, 0 at the wall's bottom edge and 1 at
  its top. It drives the gradient and the per-deck height masks.
- **Distance along the wall** is `atan(r.x, r.z) * radius` in metres, where `r` is `pos`
  measured from the AABB centre. An angular sweep rather than `pos.x`, so the curved ends of
  the cyclorama are not compressed. The seam at ±π sits behind the wall, out of shot.

There is no UV guess to get wrong and no flip constant to tune. A degenerate AABB cannot divide
by zero: `WallFrame::of` floors the height at 0.01 m and the radius at 0.01 m, and a unit test
covers it.

The clouds are value-noise fbm, five octaves, domain-warped by a second fbm — that warp is what
turns smooth fractal noise into cauliflower lobes — and then quantised into `CLOUD_STEPS` flat
steps. Three decks run at 1x, 1.6x and 2.6x the base frequency, drift at 35%, 60% and 100% of
`CLOUD_DRIFT`, and are masked to different heights, which reads as parallax. Each deck is shaded
from within: the thicker it is the brighter it gets, `CLOUD_SHADOW` to `CLOUD_LIT` to
`CLOUD_CORE`, warm-tinted low down and cool-tinted aloft. Stars are drawn before the clouds, so
a cloud hides the stars behind it, and are masked to the wall's upper half.

The result is multiplied by the manifest's emissive strength and then passes through the viewer's own
`tone_mapping()` and `color_mapping()`, exactly as `PhysicalMaterial` does. That matters:
`src/postfx.rs` disables both for the pass into the HDR target and applies them once in the
composite, and the sky follows that rule automatically because it reads them off the viewer.

## Verification

Done for this pass, on 2026-07-30:

- `cargo check --all-targets` in the crate: clean, no warnings.
  It was first run on a **copy** of the crate in a scratch directory with `src/lighting.rs`
  restored from `git HEAD`, because the real tree would not compile at the time: another agent's
  edits to `src/lighting.rs` were in flight (`ENVIRONMENT_LEFT_TINT`, `ENVIRONMENT_RIGHT_TINT`,
  `ENVIRONMENT_CEILING` unresolved). Every other file in the copy was the working tree's. No
  error or warning in either run named `src/screen.rs`.
- `cargo test --bin game-show-v1 screen`: 7 tests, all pass, in the copy and then in the crate
  itself. They assert
  the manifest's declared emissive strength against three manifest fields, that the manifest really does address the
  texture through the mesh's own `UVMap` on both nodes, that the texture path's `id` and
  fragment shader source are the imported `PhysicalMaterial`'s, that the author's texture is the
  default path, that the procedural zenith is darker and bluer than its horizon, that
  `WallFrame` is never degenerate, and that every sky uniform the Rust side sends is declared in
  the GLSL. That last one is a real guard: `Program::use_uniform` panics on a uniform that is
  absent or optimised out.
- Both paths rendered through `--shot` at 1672x941 on this machine's GPU, in that copy: the
  texture path printed `emissive strength 1.5` for `Wall_Screen` and `Podium_Riser` and wrote a
  frame, and `FORCE_PROCEDURAL_SKY = true` in the copy printed `procedural GLSL sky` and wrote
  one. So both shaders compile and link on a real driver and the delegated uniform set has no
  missing name — `Program::use_uniform` would have panicked on the first frame otherwise. The
  copy's flag was flipped, never the crate's: `src/screen.rs` ships `false`.
- The texture path was then rendered once more from the crate itself, once it compiled again:
  `cargo run --bin game-show-v1 -- --shot renders/j_cleanup_texture.png`, same two lines, frame
  written.
- The `screen_left` crop region of both frames was checked for one thing only — that the wall is
  neither black nor blown white. It is violet-dominant in both. Nothing was tuned from that, and
  no crop was compared against `docs/wheel_stage.png`. This pass does no look-dev.

An earlier version of this document ended with a section comparing the author's sky against
`renders/ref_crops/screen_left.png` and recommending changes. It is gone: it described a
render made by the deleted grade, and the cleanup pass rules out judging crops.
