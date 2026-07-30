# `src/screen.rs` — the LED wall

Agent J. Public signatures, the two art paths, and every tunable constant.

## Which path is active

**The author's own art is the primary path.** `MAT_LED_Screen` is texture-driven and the
fixed export embeds the texture, so there is nothing to invent. Measured from
`assets/wheel_stage.glb` (10.16 MiB), not taken from a table:

- 1 image, `T_LEDWall_Sky`, `image/png`, 4096x1024, embedded in buffer view 12.
- 2 textures over that one image, 1 sampler.
- `MAT_LED_Screen` holds `baseColorTexture`, `emissiveTexture`,
  `emissiveFactor: [1, 1, 1]`, `KHR_materials_emissive_strength.emissiveStrength: 1.5`,
  `metallicFactor: 0`, `roughnessFactor: 0.25`, `doubleSided: true`.
- Both `Wall_Screen` and `Podium_Riser` use the material, and both primitives carry
  `TEXCOORD_0` — the mesh's `UVMap`. Nothing is projected or guessed.

The procedural GLSL sky is the fallback. It draws only when the GLB carries no texture for
the surface, or when `FORCE_PROCEDURAL_SKY` is set by hand.

### The one thing this module adds to the texture path

The declared emissive strength of **1.5**. Everything else about the author's material is
already right after `src/scene.rs` corrects it. `three-d-asset` 0.10 never reads
`KHR_materials_emissive_strength`, so the import leaves the emissive factor at
`(1, 1, 1)`, and `PhysicalMaterial::emissive` is four `u8`s and cannot hold 1.5 anyway.
`SkyMaterial` wraps the imported material, delegates `fragment_shader_source` and `id` so
the shader source stays byte-identical and the program cache entry stays shared, and
overwrites the `emissive` uniform with `vec4(1.5, 1.5, 1.5, 1.0)` after the inner material
has written it. `shaders/physical_material.frag` multiplies that by `emissiveTexture`, so
the author's sky comes through at 1.5x and the wall stays bright where no light reaches it.

The headroom above 1.0 only survives if the intermediate target is floating point. It is:
`src/postfx.rs` renders into `Texture2D::new_empty::<[f16; 4]>`. On an RGBA8 target nothing
breaks, the wall just clips at white instead of blooming.

The lighting term is kept. `docs/look_target.md` region 4 asks for a violet beam pool
spilling into the crop's upper-right corner, which is a spot light landing on the wall.
Emission alone would lose it.

## How to switch

Two constants, in two files, and they do different jobs.

| Constant | File | Owner | Effect |
| --- | --- | --- | --- |
| `PROCEDURAL_SKY` | `src/main.rs` | F/G/L | Whether `src/screen.rs` draws the wall at all. |
| `FORCE_PROCEDURAL_SKY` | `src/screen.rs` | J | Which art `src/screen.rs` uses when it does. |

`src/main.rs` currently has `PROCEDURAL_SKY = false`, so **`src/screen.rs` is inert and the
wall renders at emissive strength 1.0, not 1.5.** Agent J does not own `src/main.rs` and did
not change it. The wiring change is one word:

```rust
// src/main.rs
const PROCEDURAL_SKY: bool = true;
```

That constant's name is now wrong and L should rename it — it no longer selects *procedural*,
it selects *screen.rs owns the wall*. `SCREEN_DRAWN_BY_SCREEN_RS` says what it does.

While editing that block, the `Podium_Riser` filter should become conditional. `src/main.rs`
skips every `MAT_LED_Screen` part except `Wall_Screen`, because painting the podium riser
front with a *procedural* sky is wrong. Painting it with the *author's own texture* is not
wrong — that is what the author's material does, and what the GLB already does today. So:

```rust
for i in stage.indices_with_material(screen::SCREEN_MATERIAL) {
    // The procedural sky belongs on the cyclorama only. The author's texture belongs on
    // every surface the material is on, which is how Blender has it.
    if screen::FORCE_PROCEDURAL_SKY && stage.parts[i].name != scene::SCREEN_NODE {
        continue;
    }
    skies.push(screen::SkyScreen::new(context, &stage.parts[i], base)?);
    stage.parts[i].visible = false;
}
```

Nothing else in `src/main.rs` needs touching: `skies` already goes into the shadow-caster
list and into the single `render` call, and `World::update` already calls `set_time`.

To see the fallback instead, set `FORCE_PROCEDURAL_SKY = true` in `src/screen.rs`. Both
constants must be on for the procedural sky to appear.

## Public API

```rust
pub const SCREEN_MATERIAL: &str = "MAT_LED_Screen";
pub const EMISSIVE_STRENGTH: f32 = 1.5;
pub const FORCE_PROCEDURAL_SKY: bool = false;
pub const SKY_MATERIAL_ID: u16 = 0x0210;

pub enum ScreenArt { AuthorTexture, ProceduralSky }
impl ScreenArt {
    pub fn label(self) -> &'static str;
}

pub struct SkyMaterial {
    pub emissive_strength: f32,   // linear multiplier on the emissive term
    pub time: f32,                // seconds; drives the procedural drift only
}
impl SkyMaterial {
    pub fn art(&self) -> ScreenArt;
}
impl Material for SkyMaterial { /* id, fragment_shader_source, use_uniforms,
                                   render_states, material_type */ }

pub struct SkyScreen;
impl SkyScreen {
    /// `base` is MAT_LED_Screen's flat linear base colour from `assets/scene.json`.
    pub fn new(context: &Context, part: &Part, base: [f32; 3]) -> crate::Result<Self>;
    pub fn object(&self) -> &dyn Object;
    pub fn art(&self) -> ScreenArt;
    pub fn set_time(&mut self, seconds: f32);
}
```

`SkyScreen::new`'s signature is unchanged from agent F's scaffold, so `src/main.rs` compiles
either way. It picks the path per surface and prints which one it chose:

```
screen: Wall_Screen drawn with the T_LEDWall_Sky from the GLB, emissive strength 1.5
```

`base` is ignored on the texture path, deliberately. For a textured material the manifest's
`base_color` is the value the shader node held *before* the texture was wired up;
multiplying the picture by it would stain the sky. The procedural path uses it as the zenith.

`set_time` is pure in `seconds`: `--shot` calls it with 0.0 and gets the same frame every
run. The texture path ignores it, so `--shot` and the viewer agree there too.

`SkyMaterial` is opaque in both paths — `MAT_LED_Screen` has alpha 1.0 and `alpha_mode`
`OPAQUE` — so it never joins the transparency sort. Its objects still have to go into the
same single `render` call as everything else, or `MAT_Crystal` will not sort against them.

## Tunable constants

The texture path has exactly one: `EMISSIVE_STRENGTH`. It is not a free parameter — it is
what the glTF and `assets/scene.json` both declare, and a unit test asserts the two agree.
Moving it is a deliberate departure from the scene, not tuning.

Everything below affects the procedural fallback only. Colours are **linear RGB**, with the
sRGB hex they came from in each doc comment. Distances are in **metres of wall**, not UV
units, because the shader works in world space.

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
| `CLOUD_SCALE` | `0.45` | Noise frequency, cycles per metre. One cycle is about one lobe, so 0.45 is a 2.2 m lobe, about 100 px in the frame. |
| `CLOUD_DRIFT` | `0.14` | Sideways drift, metres per second, for the fastest deck. The lower two run at 35% and 60% of it. 0.0 freezes the sky. |
| `STAR_DENSITY` | `3.0` | Star cells per metre. The wall renders at about 82 px/m, so 3.0 is a 27 px cell. |
| `STAR_RARITY` | `0.86` | A cell holds a star when its hash clears this. 0.86 is one cell in seven. |
| `STAR_SIZE` | `0.10` | Star radius as a fraction of a cell. 0.10 of 27 px is a 5 px dot. |
| `STAR_INTENSITY` | `1.4` | Peak linear radiance of a star, before `EMISSIVE_STRENGTH`. |
| `SKY_MATERIAL_ID` | `0x0210` | `EffectMaterialId` for the sky shader. Public range is `0x0000..=0x4FFF`; `src/postfx.rs` uses `0x0001..=0x00FF`. |

Three of those defaults were set by looking at renders, not by arithmetic, and the earlier
value is recorded in the doc comment so nobody re-derives the mistake:

- `CLOUD_SCALE` was 0.09. At that frequency the whole 24 m wall fell inside one noise cell
  and the sky rendered as a single flat lavender wash with no lobes in it.
- `STAR_SIZE` was 0.14 of a 55 px cell, which made 15 px blobs that read as snow.
- `STAR_INTENSITY` was 0.55, at which the stars were invisible against the violet.

## How the procedural sky works, and why it ignores UVs

The fallback exists for an export with no image in it. Such an export may have no usable
`TEXCOORD_0` either, and even when it does, nothing tells this module which way up the
author's UVs run. So the shader takes its coordinates from the world position `pos`, which
`shaders/mesh.vert` always emits, and from the part's world AABB measured once in
`SkyScreen::new`:

- **Height** `h` is `(pos.y - bottom) / (top - bottom)`, 0 at the wall's bottom edge and 1 at
  its top. It drives the gradient and the per-deck height masks.
- **Distance along the wall** is `atan(r.x, r.z) * radius` in metres, where `r` is `pos`
  measured from the AABB centre. An angular sweep rather than `pos.x`, so the curved ends of
  the cyclorama are not compressed. The seam at ±π sits behind the wall, out of shot.

There is no UV guess to get wrong and no flip constant to tune. A degenerate AABB cannot
divide by zero: `WallFrame::of` floors the height at 0.01 m and the radius at 0.01 m, and a
unit test covers it.

The clouds are value-noise fbm, five octaves, domain-warped by a second fbm — that warp is
what turns smooth fractal noise into cauliflower lobes — and then quantised into
`CLOUD_STEPS` flat steps. The quantisation is required, not decorative:
`docs/look_target.md` region 4 says "A sky shader that produces smooth fractal noise will
read wrong here even at the right colour. Aim for banded, posterised lobes." Three decks run
at 1x, 1.6x and 2.6x the base frequency, drift at 35%, 60% and 100% of `CLOUD_DRIFT`, and are
masked to different heights, which reads as parallax. Each deck is shaded from within: the
thicker it is the brighter it gets, `CLOUD_SHADOW` to `CLOUD_LIT` to `CLOUD_CORE`, warm-tinted
low down and cool-tinted aloft. Stars are drawn before the clouds, so a cloud hides the stars
behind it, and are masked to the wall's upper half.

The result is multiplied by `EMISSIVE_STRENGTH` and then passes through the viewer's own
`tone_mapping()` and `color_mapping()`, exactly as `PhysicalMaterial` does. That matters:
`src/postfx.rs` disables both for the pass into the HDR target and applies them once in the
composite, and the sky follows that rule automatically because it reads them off the viewer.

## The author's sky against `renders/ref_crops/screen_left.png`

Judged by looking at crops, per invariant 4. No histogram was computed.

Same colour family, and close enough that the author's art is clearly the right primary
path. `T_LEDWall_Sky` is a deep indigo zenith, a magenta-violet middle, and a band of
pink-and-cream cauliflower cloud tops along the bottom, all of which the reference also has,
in the same hues. The wall maps it the right way up: indigo at the top of the cyclorama,
clouds at its foot.

Where it differs from the reference:

- **Cloud scale.** The reference fills the screen with lobes 60 to 120 px across and puts
  near-white cream-peach cloud tops at crop (60-260, 60-140), high in the frame. The author's
  clouds are smaller, and they sit in a band across the bottom third of the texture, so the
  upper half of the wall is plain gradient. This is the biggest difference and it is in the
  author's art, not in the renderer. Do not "fix" it by switching to the procedural sky: the
  procedural sky is more abstract still.
- **Saturation and brightness.** The reference's screen is vivid magenta and coral and
  "brighter and more saturated than everything except the wheel". The render's reads paler.
  Raising the emissive strength from 1.0 to 1.5 closed part of that gap and is visible
  side by side. The rest is the tone curve and the bloom, which belong to `src/postfx.rs`.
- **The hot white streak** the reference has at crop (250-380, 330-360) is not in the
  author's texture and is not a sky feature. It is one of the anamorphic flare streaks
  `docs/look_target.md` assigns to postfx.

**Verdict: the fallback is not needed.** Nothing in the author's art fights the reference; it
is the same sunset, painted looser. Keep `FORCE_PROCEDURAL_SKY = false`. The procedural path
is there for a texture-less export and as an escape hatch, and it has been rendered and
looked at so that it works when it is wanted, not just when it is needed.

## Verification

- `cargo check` and `cargo check --all-targets`: clean, no warnings.
- `cargo test screen`: 5 tests pass. They assert `EMISSIVE_STRENGTH` against
  `assets/scene.json`, that the author's texture is the default path, that the procedural
  zenith is darker and bluer than its horizon, that `WallFrame` is never degenerate, and that
  every uniform the Rust side sends is declared in the GLSL — `Program::use_uniform` panics
  on a uniform that is absent or optimised out, so that last one is a real guard.
- Both paths were rendered through `--shot` on a GPU, by temporarily setting
  `src/main.rs`'s `PROCEDURAL_SKY` to `true` and then restoring the file byte-for-byte
  (verified by checksum). The texture path printed `emissive strength 1.5` and produced a
  brighter, more saturated wall than agent G's `renders/crops_g/screen_left.png`. The
  procedural path produced the banded lobes, the pink-to-violet gradient and the faint stars.
  The GLSL compiles and links on this machine's driver.
