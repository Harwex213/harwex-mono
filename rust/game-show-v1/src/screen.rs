//! The LED wall: the author's exported sky texture, with a procedural GLSL sky behind it.
//!
//! Owner: agent J.
//!
//! # Two paths, and which one is live
//!
//! `MAT_LED_Screen` is texture-driven. An Image Texture node holding `T_LEDWall_Sky` — a
//! 4096x1024 sunset painted by the scene's author — feeds both Base Color and Emission
//! Color through a UV Map node, and the fixed export embeds it. Measured in
//! `assets/wheel_stage.glb`: 1 image named `T_LEDWall_Sky`, 2 textures, and
//!
//! ```json
//! "name": "MAT_LED_Screen",
//! "doubleSided": true,
//! "emissiveFactor": [1, 1, 1],
//! "emissiveTexture": { "index": 0 },
//! "extensions": { "KHR_materials_emissive_strength": { "emissiveStrength": 1.5 } },
//! "pbrMetallicRoughness": {
//!   "baseColorTexture": { "index": 1 }, "metallicFactor": 0, "roughnessFactor": 0.25
//! }
//! ```
//!
//! Both `Wall_Screen` and `Podium_Riser` use it, and both carry `TEXCOORD_0` — the mesh's
//! `UVMap` — so the author's art is the primary path. [`ScreenArt::AuthorTexture`] is that
//! path and it is what [`SkyScreen::new`] picks by default. The procedural sky,
//! [`ScreenArt::ProceduralSky`], is the fallback: it draws only when the GLB carries no
//! texture for the surface, or when [`FORCE_PROCEDURAL_SKY`] is set. See `docs/api/screen.md`
//! for how to switch and what every constant does.
//!
//! # What this module does with the texture path: one uniform, nothing else
//!
//! The texture path adds exactly one thing to the imported material: **the emissive strength
//! of 1.5 that the glTF declares.** `three-d-asset` 0.10 never reads
//! `KHR_materials_emissive_strength` — its source has no hit for `emissive_strength` — so the
//! import leaves the factor at the glTF's `emissiveFactor`, `(1, 1, 1)`. And
//! `PhysicalMaterial::emissive` is an `Srgba`, four `u8`s, so it could not hold 1.5 anyway.
//! `PhysicalMaterial::use_uniforms` writes `emissive` with `use_uniform`, and
//! `shaders/physical_material.frag` always declares `uniform vec4 emissive` and always uses
//! it, so a wrapper can overwrite that uniform afterwards with a value above 1.0.
//! [`SkyMaterial`] does exactly that and delegates everything else — `id`,
//! `fragment_shader_source`, `render_states`, `material_type` and the whole of
//! `use_uniforms` — so the shader source stays byte-identical to
//! `PhysicalMaterial`'s and the program cache entry stays shared with the rest of the scene.
//!
//! What draws the wall is therefore three-d's own PBR shader:
//! `emissive * emissiveTexture(uvs)` added to `calculate_lighting` over
//! `albedo * albedoTexture(uvs)`, where `uvs` is the mesh's own `TEXCOORD_0`, i.e. the
//! `UVMap` the author's UV Map node reads. That is the same pair of terms Blender's
//! Principled BSDF evaluates, so the wall shows the author's picture where the author put it,
//! at the strength the author set, lit by the same rig as everything else.
//!
//! The headroom above 1.0 is only visible if the intermediate render target is floating
//! point; that is `src/postfx.rs`'s job (`docs/three_d_api.md` §5, option b, and §6).
//! Nothing here breaks if the target is `RGBA8` — the wall simply clips at white where it
//! would otherwise bloom.
//!
//! ## What the cleanup pass took out, and why nothing replaced it
//!
//! Five look-dev rounds grew a shader of this module's own around the author's art: a
//! re-windowed and magnified UV sample (`SCREEN_UV_WINDOW`), a per-side split-tone grade with
//! its crossfade hidden behind the wheel (`SCREEN_SIDE_*`, `SCREEN_TONE_*`,
//! `SCREEN_SIDE_BLEND_M`), a gain (`SCREEN_EMISSION_GAIN`), a contrast expansion, a chroma
//! pass, an unsharp mask, a posterise, a star-killer, and a fraction of the rig
//! (`SCREEN_LIT_FRACTION`) standing in for the diffuse term the emission-only shader had
//! dropped. Seventeen constants, none of them in `wheel_stage.blend`.
//!
//! `docs/agent_plan.md` §"Cleanup pass" items 1 and 2 remove the window and the per-side
//! grade by name. The rest went with them because each existed only to serve or to compensate
//! for those two: the unsharp mask and the posterise inverted the 1.5x downsample the window
//! caused, the contrast expansion widened the range that downsample had averaged flat, and
//! `SCREEN_LIT_FRACTION` scaled a hand-written copy of a lighting term that the delegated
//! shader now computes in full. `assets/scene.json`'s `screen` block says the same in the
//! manifest's own words: show the texture as the mesh's `uv_map` addresses it, "with no
//! re-windowing, no magnification and no per-side grade: none of that is in the .blend".
//!
//! The frame moves as a result and that is the intended trade. Nothing here compensates for
//! it, and no surviving constant was re-tuned to win any of it back.
//!
//! # Why the procedural sky uses world position, not UVs
//!
//! The fallback exists for an export with no image in it. Such an export may well have no
//! usable `TEXCOORD_0` either, and even when it does, nothing tells this module which way up
//! the author's UVs run. So the procedural shader takes its gradient from the wall's world
//! height and its clouds from the wall's angular sweep about its own centre, both measured
//! from the part's world AABB at construction. There is no UV guess to get wrong and no
//! flip constant to tune.
//!
//! `docs/look_target.md` §"Region 4" is explicit that smooth fractal noise reads wrong here:
//! "Aim for banded, posterised lobes." So the cloud density is quantised into
//! [`CLOUD_STEPS`] flat steps after a domain warp, which is what gives hard-edged
//! cauliflower lobes with flat colour interiors instead of photographic gradients.

use crate::scene::Part;
use three_d::*;

// The material that identifies the screen is not a constant here either. `src/main.rs` reads
// `manifest.screen.material`, which is `MAT_LED_Screen`, carried on `Wall_Screen` and on slot 0
// of `Podium_Riser`. The tests below read the same field.
//
// The emissive strength `MAT_LED_Screen` declares is not a constant in this module. It comes
// in as an argument to `SkyScreen::new`, out of `manifest.screen.emission_strength`, which is
// derived from `KHR_materials_emissive_strength.emissiveStrength` in the GLB. A `const` here
// would duplicate a manifest value, and two copies of one number drift.

/// Set to `true` to draw the procedural sky even when the GLB carries the author's texture.
///
/// `false` is the shipped value: the author's `T_LEDWall_Sky` is the primary path. Flip this
/// to `true` only for look-dev, if the author's art turns out to fight
/// `docs/wheel_stage.png`. A texture-less export falls back on its own without this.
pub const FORCE_PROCEDURAL_SKY: bool = false;

/// `EffectMaterialId` for the procedural sky shader. The public range is `0x0000..=0x4FFF`;
/// everything three-d uses itself is `>= 0x5000`. `src/postfx.rs` holds `0x0A01..=0x0A06`, so
/// this does not collide with a pass of its own.
pub const SKY_MATERIAL_ID: u16 = 0x0210;

/// Linear RGB at the very bottom of the wall: the hot peach of the sun's own band.
/// sRGB `#FF9682`.
pub const SKY_HORIZON: [f32; 3] = [1.0, 0.305, 0.2232];

/// Linear RGB through the lower third: hot magenta-pink. sRGB `#F65FA8`.
pub const SKY_LOW: [f32; 3] = [0.9216, 0.1144, 0.3916];

/// Linear RGB through the upper third: royal blue-violet. sRGB `#5B4BD6`.
pub const SKY_HIGH: [f32; 3] = [0.1046, 0.0704, 0.6724];

/// What `MAT_LED_Screen`'s own flat base colour is multiplied by to give the colour at the
/// very top of the wall. The base colour is `(0.35, 0.3, 0.6)`, a deep violet, which is
/// already the right hue for a zenith; this only takes it down to a night value. Keeping the
/// zenith tied to the material means the fallback follows the author if that colour changes.
pub const SKY_ZENITH_GAIN: f32 = 0.34;

/// Linear RGB of a cloud's thickest core, lit from within. sRGB `#FFE8D2`.
pub const CLOUD_CORE: [f32; 3] = [1.0, 0.807, 0.6445];

/// Linear RGB of a cloud's lit body. sRGB `#FFA8C4`.
pub const CLOUD_LIT: [f32; 3] = [1.0, 0.3916, 0.552];

/// Linear RGB of a cloud's thin unlit edge. sRGB `#8A5AA8`.
pub const CLOUD_SHADOW: [f32; 3] = [0.2542, 0.1022, 0.3916];

/// How much of the wall the cloud decks cover, 0 to 1. Raising it thickens the lobes and
/// closes the gaps between them.
pub const CLOUD_COVER: f32 = 0.52;

/// Number of flat steps the cloud density is quantised into. This is what makes the lobes
/// read as painted rather than photographic; `docs/look_target.md` §"Region 4" requires it.
/// Below about 3 the clouds turn into cut-outs, above about 10 they go smooth again.
pub const CLOUD_STEPS: f32 = 5.0;

/// Cloud noise frequency, in cycles per metre of wall. One cycle is roughly one lobe, so
/// 0.45 puts the low deck's lobes at about 2.2 m across — about 100 px of the 1672-wide
/// frame, which is the lobe size `renders/ref_crops/screen_left.png` shows. Measured, not
/// guessed: at 0.09 the whole 24 m wall fell inside one noise cell and the sky came out as a
/// single flat lavender wash with no lobes in it at all.
pub const CLOUD_SCALE: f32 = 0.45;

/// Sideways cloud drift, in metres per second, for the fastest deck. The two lower decks
/// move at 35% and 60% of it, which reads as parallax. Zero freezes the sky.
pub const CLOUD_DRIFT: f32 = 0.14;

/// Star grid, in cells per metre of wall. One star to a cell at most. The wall renders at
/// roughly 82 px per metre in the 1672-wide frame, so 3.0 puts the cells 27 px apart.
pub const STAR_DENSITY: f32 = 3.0;

/// A cell holds a star when its hash clears this. 0.86 lights one cell in seven, which is
/// about 15 stars across the `screen_left` crop.
pub const STAR_RARITY: f32 = 0.86;

/// Star radius, as a fraction of a cell. 0.10 of a 27 px cell is a dot 5 px across, which is
/// the size `docs/look_target.md` gives for the reference's sparkles. Measured: at 0.14 of a
/// 55 px cell the stars came out as 15 px blobs and read as snow, not sky.
pub const STAR_SIZE: f32 = 0.10;

/// Peak linear radiance of a star, before the scene's emissive strength. Faint by instruction, but
/// not below the violet it sits on: at 0.55 the stars were invisible in the render.
pub const STAR_INTENSITY: f32 = 1.4;

/// Which art draws `MAT_LED_Screen`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScreenArt {
    /// The author's `T_LEDWall_Sky` as `assets/wheel_stage.glb` carries it, sampled from the
    /// mesh's `UVMap`, emitting at the strength the scene declares. The default.
    AuthorTexture,
    /// The procedural GLSL sky in this module. Only when the GLB carries no texture for the
    /// surface, or when [`FORCE_PROCEDURAL_SKY`] is set.
    ProceduralSky,
}

impl ScreenArt {
    /// The name used in the start-up line and in `docs/lookdev_log.md`.
    pub fn label(self) -> &'static str {
        match self {
            ScreenArt::AuthorTexture => "T_LEDWall_Sky from the GLB",
            ScreenArt::ProceduralSky => "procedural GLSL sky",
        }
    }
}

/// The wall's own extent in world space, measured from the part's AABB at construction.
///
/// The procedural sky maps its gradient onto `bottom..top` and its clouds onto the angular
/// sweep about `center`, so it needs no UVs. `radius` turns that angle back into metres, so
/// that a cloud lobe is the same size horizontally as it is vertically.
#[derive(Debug, Clone, Copy)]
struct WallFrame {
    /// Centre of the wall's world AABB with the height dropped; only `x` and `z` are read.
    center: Vec3,
    /// World `y` of the wall's bottom edge.
    bottom: f32,
    /// World `y` of the wall's top edge.
    top: f32,
    /// Half the wall's larger horizontal extent, in metres.
    radius: f32,
}

impl WallFrame {
    /// Derives the frame from a world-space bounding box.
    fn of(aabb: AxisAlignedBoundingBox) -> Self {
        let (min, max, center) = (aabb.min(), aabb.max(), aabb.center());
        let radius = 0.5 * (max.x - min.x).max(max.z - min.z);
        WallFrame {
            center: vec3(center.x, 0.0, center.z),
            bottom: min.y,
            // A degenerate wall would divide by zero in the shader, so keep a floor here
            // rather than a guard in GLSL.
            top: max.y.max(min.y + 0.01),
            radius: radius.max(0.01),
        }
    }
}

/// What a given surface is drawn with, plus the data that path needs.
enum Art {
    /// The author's texture, drawn by the imported material's own shader. Everything is
    /// delegated to it; this wrapper only raises the `emissive` uniform to the strength the
    /// manifest declares.
    Texture(PhysicalMaterial),
    /// The procedural sky, on the wall's own frame, fading to `zenith` at the top.
    Sky { frame: WallFrame, zenith: Vec3 },
}

/// The material `MAT_LED_Screen` is drawn with.
///
/// One type covers both paths so that `src/main.rs` holds one `Vec<SkyScreen>` either way.
/// The variant is chosen once, in [`SkyScreen::new`], and never changes: `id()` differs
/// between the two, and changing it at run time would thrash the shader cache.
pub struct SkyMaterial {
    art: Art,
    /// Linear emissive multiplier, `manifest.screen.emission_strength` on both paths. The texture path
    /// writes it over the `emissive` uniform; the procedural path multiplies its own colour by
    /// it, so the fallback is as bright as the author's art.
    pub emissive_strength: f32,
    /// Seconds since start. Drives the procedural cloud drift and nothing else, so the
    /// texture path is unaffected by it. Fixed at 0.0 for `--shot`.
    pub time: f32,
}

impl SkyMaterial {
    /// The author's texture path: the imported material exactly as `src/scene.rs` built it,
    /// with the emissive factor raised to the strength the glTF declares.
    fn textured(material: PhysicalMaterial, emissive_strength: f32) -> Self {
        SkyMaterial {
            art: Art::Texture(material),
            emissive_strength,
            time: 0.0,
        }
    }

    /// The procedural path. `base` is `MAT_LED_Screen`'s flat base colour in linear RGB,
    /// which becomes the zenith after [`SKY_ZENITH_GAIN`].
    fn procedural(frame: WallFrame, base: [f32; 3], emissive_strength: f32) -> Self {
        SkyMaterial {
            art: Art::Sky {
                frame,
                zenith: Vec3::from(base) * SKY_ZENITH_GAIN,
            },
            emissive_strength,
            time: 0.0,
        }
    }

    /// Which path this material draws.
    pub fn art(&self) -> ScreenArt {
        match self.art {
            Art::Texture(_) => ScreenArt::AuthorTexture,
            Art::Sky { .. } => ScreenArt::ProceduralSky,
        }
    }

    /// The procedural sky's fragment shader.
    ///
    /// Built by concatenation rather than `format!` so that no GLSL brace has to be doubled.
    /// Every tunable arrives as a uniform, so the constants at the top of this file are the
    /// only place to edit.
    fn sky_fragment_shader() -> String {
        let mut shader = String::new();
        shader.push_str(ToneMapping::fragment_shader_source());
        shader.push_str(ColorMapping::fragment_shader_source());
        shader.push_str(SKY_FRAGMENT);
        shader
    }
}

/// The procedural sky, in GLSL. `pos` is the world position, which `shaders/mesh.vert`
/// always emits.
const SKY_FRAGMENT: &str = r#"
uniform vec3 skyCenter;
uniform float skyBottom;
uniform float skyTop;
uniform float skyRadius;
uniform float time;

uniform vec3 horizonColor;
uniform vec3 lowColor;
uniform vec3 highColor;
uniform vec3 zenithColor;
uniform vec3 cloudCore;
uniform vec3 cloudLit;
uniform vec3 cloudShadow;
uniform float cloudCover;
uniform float cloudSteps;
uniform float cloudScale;
uniform float cloudDrift;
uniform float starDensity;
uniform float starRarity;
uniform float starSize;
uniform float starIntensity;
uniform float emissiveStrength;

in vec3 pos;
layout (location = 0) out vec4 outColor;

// Hash of a lattice point, in 0..1. One multiply-add chain, no texture lookup.
float hash12(vec2 p) {
    vec3 q = fract(vec3(p.x, p.y, p.x) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}

// Value noise: bilinear between four hashed lattice points, smoothstep-weighted.
float value_noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 w = f * f * (3.0 - 2.0 * f);
    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

// Five octaves, each half the amplitude and twice the frequency of the last. The 2.03 and
// the offset stop the octaves lining up into a grid.
float fbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 5; i++) {
        sum += amp * value_noise(p);
        p = p * 2.03 + vec2(17.3, 9.1);
        amp *= 0.5;
    }
    return sum;
}

// One cloud deck. `p` is (metres along the wall, metres up). The domain warp is what turns
// fbm into cauliflower lobes; the quantisation is what makes their interiors flat.
float deck(vec2 p, float drift, float cover) {
    vec2 q = p + vec2(drift, 0.0);
    vec2 warp = vec2(fbm(q * 0.5), fbm(q * 0.5 + vec2(5.2, 1.3)));
    float d = fbm(q + 2.0 * warp);
    d = smoothstep(1.0 - cover, 1.0 - cover + 0.30, d);
    // Round rather than truncate, or the top band is never reached and the cloud cores never
    // light up: truncating 5 steps caps the density at 0.8.
    return floor(d * cloudSteps + 0.5) / cloudSteps;
}

// A cloud lit from inside: the thicker it is the brighter it gets, and the thin edge keeps
// the violet of the sky it sits in. Warm low down, cool aloft, like the author's own art.
vec3 cloud_shade(float d, float h) {
    vec3 c = mix(cloudShadow, cloudLit, smoothstep(0.10, 0.70, d));
    c = mix(c, cloudCore, smoothstep(0.68, 1.0, d));
    return c * mix(vec3(1.08, 0.94, 0.88), vec3(0.84, 0.88, 1.10), smoothstep(0.15, 0.85, h));
}

// A sparse field of small round dots, jittered inside their cells so they do not read as a
// grid. `starDensity` cells per metre; a cell is lit when its hash clears `starRarity`.
float star_field(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    vec2 jitter = vec2(hash12(cell + 3.1), hash12(cell + 7.7));
    float lit = step(starRarity, hash12(cell + 1.7));
    float magnitude = 0.4 + 0.6 * hash12(cell + 13.3);
    return lit * magnitude * (1.0 - smoothstep(0.0, starSize, length(f - jitter)));
}

void main() {
    // Height up the wall, 0 at the bottom edge and 1 at the top.
    float h = clamp((pos.y - skyBottom) / (skyTop - skyBottom), 0.0, 1.0);
    // Metres along the wall, from its angular sweep about its own centre. Monotonic across
    // the whole arc; the seam at +-PI sits behind the wall, out of shot.
    vec3 r = pos - skyCenter;
    float arc = atan(r.x, r.z) * skyRadius;
    vec2 p = vec2(arc, pos.y) * cloudScale;

    // Gradient: peach, magenta, royal blue, then the material's own violet at the top.
    vec3 col = mix(horizonColor, lowColor, smoothstep(0.00, 0.30, h));
    col = mix(col, highColor, smoothstep(0.28, 0.68, h));
    col = mix(col, zenithColor, smoothstep(0.66, 1.00, h));

    // Stars go in before the clouds, so a cloud hides the stars behind it.
    float stars = star_field(vec2(arc, pos.y) * starDensity);
    col += vec3(stars * starIntensity) * smoothstep(0.32, 0.85, h);

    // Three decks. The low one is the biggest and slowest, the high one thin and fastest.
    float low = deck(p, time * cloudDrift * 0.35, cloudCover * 1.15);
    float mid = deck(p * 1.60 + vec2(31.0, 3.0), time * cloudDrift * 0.60, cloudCover);
    float high = deck(p * 2.60 + vec2(7.0, 19.0), time * cloudDrift, cloudCover * 0.60);

    low *= 1.0 - smoothstep(0.10, 0.62, h);
    mid *= (1.0 - smoothstep(0.34, 0.86, h)) * smoothstep(0.02, 0.22, h);
    high *= smoothstep(0.30, 0.78, h);

    col = mix(col, cloud_shade(low, h), clamp(low, 0.0, 1.0));
    col = mix(col, cloud_shade(mid, h), clamp(mid, 0.0, 1.0));
    col = mix(col, cloud_shade(high, h), clamp(high, 0.0, 1.0) * 0.75);

    // Emissive: the wall is lit from within and stays bright in shadow.
    outColor.rgb = tone_mapping(col * emissiveStrength);
    outColor.rgb = color_mapping(outColor.rgb);
    outColor.a = 1.0;
}
"#;

impl Material for SkyMaterial {
    fn id(&self) -> EffectMaterialId {
        match &self.art {
            // The inner material's own id, because the source below is the inner material's
            // own source. The cache entry is shared with every other `PhysicalMaterial` of the
            // same texture set, which is what it should be: only a uniform differs.
            Art::Texture(inner) => inner.id(),
            Art::Sky { .. } => EffectMaterialId(SKY_MATERIAL_ID),
        }
    }

    fn fragment_shader_source(&self, lights: &[&dyn Light]) -> String {
        match &self.art {
            Art::Texture(inner) => inner.fragment_shader_source(lights),
            Art::Sky { .. } => SkyMaterial::sky_fragment_shader(),
        }
    }

    fn use_uniforms(&self, program: &Program, viewer: &dyn Viewer, lights: &[&dyn Light]) {
        match &self.art {
            Art::Texture(inner) => {
                // The whole uniform set, from the material that owns the shader: the tone and
                // colour mapping, the lighting model, the camera, every light, both texture
                // samplers with their own transforms, and the albedo, metallic and roughness
                // factors. Nothing is re-derived here, so nothing can disagree with
                // `src/scene.rs`.
                inner.use_uniforms(program, viewer, lights);
                // Then the one value neither `three-d-asset` nor `Srgba` can carry: the
                // strength `KHR_materials_emissive_strength` declares. `PhysicalMaterial`
                // writes `emissive` with `use_uniform` above, unconditionally, and
                // `physical_material.frag` multiplies it by `emissiveTexture`, so overwriting
                // it here raises the author's picture to 1.5x and changes nothing else.
                let s = self.emissive_strength;
                program.use_uniform("emissive", vec4(s, s, s, 1.0));
            }
            Art::Sky { frame, zenith } => {
                viewer.tone_mapping().use_uniforms(program);
                viewer.color_mapping().use_uniforms(program);
                program.use_uniform_if_required("skyCenter", frame.center);
                program.use_uniform_if_required("skyBottom", frame.bottom);
                program.use_uniform_if_required("skyTop", frame.top);
                program.use_uniform_if_required("skyRadius", frame.radius);
                program.use_uniform_if_required("time", self.time);
                program.use_uniform_if_required("horizonColor", Vec3::from(SKY_HORIZON));
                program.use_uniform_if_required("lowColor", Vec3::from(SKY_LOW));
                program.use_uniform_if_required("highColor", Vec3::from(SKY_HIGH));
                program.use_uniform_if_required("zenithColor", *zenith);
                program.use_uniform_if_required("cloudCore", Vec3::from(CLOUD_CORE));
                program.use_uniform_if_required("cloudLit", Vec3::from(CLOUD_LIT));
                program.use_uniform_if_required("cloudShadow", Vec3::from(CLOUD_SHADOW));
                program.use_uniform_if_required("cloudCover", CLOUD_COVER);
                program.use_uniform_if_required("cloudSteps", CLOUD_STEPS);
                program.use_uniform_if_required("cloudScale", CLOUD_SCALE);
                program.use_uniform_if_required("cloudDrift", CLOUD_DRIFT);
                program.use_uniform_if_required("starDensity", STAR_DENSITY);
                program.use_uniform_if_required("starRarity", STAR_RARITY);
                program.use_uniform_if_required("starSize", STAR_SIZE);
                program.use_uniform_if_required("starIntensity", STAR_INTENSITY);
                program.use_uniform_if_required("emissiveStrength", self.emissive_strength);
            }
        }
    }

    fn render_states(&self) -> RenderStates {
        match &self.art {
            // `doubleSided: true` in the GLB, and the cyclorama is seen from the inside, so
            // the imported states already have `Cull::None`. Keep them as they are.
            Art::Texture(inner) => inner.render_states(),
            Art::Sky { .. } => RenderStates::default(),
        }
    }

    fn material_type(&self) -> MaterialType {
        match &self.art {
            // Whatever the imported material is, so the type can never disagree with the
            // render states above. `MAT_LED_Screen` has alpha 1.0 and `alpha_mode` OPAQUE in
            // `assets/scene.json`, so in practice this is `Opaque` and the wall does not join
            // the transparency sort.
            Art::Texture(inner) => inner.material_type(),
            Art::Sky { .. } => MaterialType::Opaque,
        }
    }
}

/// One `MAT_LED_Screen` surface, rebuilt from the imported mesh with [`SkyMaterial`] on it.
///
/// The `Part` it was built from stays in the `Stage` but must be hidden, or the original
/// surface draws over this one. `src/main.rs` does that.
pub struct SkyScreen {
    object: Gm<Mesh, SkyMaterial>,
}

impl SkyScreen {
    /// Rebuilds `part` with the LED-wall material.
    ///
    /// Picks [`ScreenArt::AuthorTexture`] when the imported material carries the author's
    /// texture, which it does for both `Wall_Screen` and `Podium_Riser` in the current
    /// export. Falls back to [`ScreenArt::ProceduralSky`] when it does not, or when
    /// [`FORCE_PROCEDURAL_SKY`] is set.
    ///
    /// `base` is `MAT_LED_Screen`'s flat base colour in linear RGB, straight from
    /// `assets/scene.json`. The texture path ignores it — for a textured material that value
    /// is what the shader node held before the texture was wired up, and multiplying the
    /// picture by it would stain the sky. The procedural path uses it as the zenith.
    /// `emissive_strength` is `manifest.screen.emission_strength`, the strength the scene
    /// declares. Both paths emit at it, so the fallback is as bright as the author's art. It
    /// arrives as an argument rather than as a constant in this module, because a second copy
    /// of a manifest number drifts from the first.
    pub fn new(
        context: &Context,
        part: &Part,
        base: [f32; 3],
        emissive_strength: f32,
    ) -> crate::Result<Self> {
        let imported = &part.object.material.inner;
        let has_texture = imported.albedo_texture.is_some() || imported.emissive_texture.is_some();
        let material = if FORCE_PROCEDURAL_SKY || !has_texture {
            SkyMaterial::procedural(
                WallFrame::of(part.object.aabb()),
                base,
                emissive_strength,
            )
        } else {
            SkyMaterial::textured(imported.clone(), emissive_strength)
        };
        eprintln!(
            "screen: {} drawn with the {}, emissive strength {}",
            part.name,
            material.art().label(),
            material.emissive_strength
        );
        let mut object = Gm::new(Mesh::new(context, &part.cpu_mesh), material);
        object.set_transformation(part.base_transformation);
        Ok(SkyScreen { object })
    }

    /// The drawable, for the one shared `render` call.
    pub fn object(&self) -> &dyn Object {
        &self.object
    }

    /// Which path this surface is drawn with.
    pub fn art(&self) -> ScreenArt {
        self.object.material.art()
    }

    /// Advances the cloud drift. Pure in `seconds`: `--shot` calls it with 0.0 and depends on
    /// the result never varying. The texture path is static, so this is a no-op there.
    pub fn set_time(&mut self, seconds: f32) {
        self.object.material.time = seconds;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::Manifest;

    fn manifest() -> Manifest {
        Manifest::load(crate::asset_path(crate::manifest::MANIFEST_PATH)).expect("assets/scene.json")
    }

    /// The strength both paths emit at is the one the scene declares, and this module now
    /// holds no copy of it to drift. Three places inside the manifest still have to agree:
    /// the `screen` block, the material's own `emission_strength`, and what the GLB carries in
    /// `KHR_materials_emissive_strength`.
    #[test]
    fn emissive_strength_matches_the_manifest() {
        let manifest = manifest();
        let declared = manifest.screen.emission_strength;
        let spec = manifest
            .material(&manifest.screen.material)
            .expect("MAT_LED_Screen in assets/scene.json");
        assert_eq!(spec.emission_strength, declared);
        assert_eq!(spec.glb_emissive_strength, declared);
        assert!(spec.emits());
        // Opaque, which is what `material_type` delegates to on the texture path and asserts
        // outright on the procedural one.
        assert!(!spec.is_blend());
        assert_eq!(spec.alpha, 1.0);
    }

    /// The wall shows the author's art as the mesh addresses it: one image on both the base
    /// colour and the emission socket, through the mesh's own `UVMap`, embedded in the GLB.
    /// Nothing in this module re-windows, magnifies or grades it, and this test pins the three
    /// manifest facts that make that the right thing to do.
    #[test]
    fn the_manifest_says_the_texture_is_addressed_by_the_meshs_own_uvs() {
        let manifest = manifest();
        let spec = manifest
            .material(&manifest.screen.material)
            .expect("MAT_LED_Screen in assets/scene.json");
        assert!(spec.is_textured());
        assert_eq!(spec.base_color_texture, manifest.screen.texture);
        assert_eq!(spec.emission_texture, manifest.screen.texture);
        assert_eq!(spec.uv_map, manifest.screen.uv_map);
        assert!(spec.glb_has_base_color_texture && spec.glb_has_emissive_texture);
        assert!(manifest.screen.in_glb);
        let texture = manifest
            .texture(&manifest.screen.texture)
            .expect("T_LEDWall_Sky in assets/scene.json");
        assert!(texture.embedded_in_glb);
        assert_eq!(texture.uv_map, manifest.screen.uv_map);
        // The material is on the podium riser as well as the cyclorama, which is why
        // `src/main.rs` filters the procedural fallback by object name.
        assert!(spec.is_on(&manifest.screen.node));
        for node in &manifest.screen.also_on {
            assert!(spec.is_on(node));
        }
    }

    /// The texture path is three-d's own `PhysicalMaterial` shader, not a shader of this
    /// module's. That is what "shows the texture as the mesh's `UVMap` addresses it" reduces
    /// to in code: the same source, the same program cache entry, and one uniform overwritten
    /// afterwards. A future edit that forks the source has to change this test to pass.
    #[test]
    fn the_texture_path_draws_with_the_imported_materials_own_shader() {
        let declared = manifest().screen.emission_strength;
        let inner = PhysicalMaterial::default();
        let wall = SkyMaterial::textured(inner.clone(), declared);
        // `EffectMaterialId` is an `open_enum` and implements no `Debug`, so compare it plainly.
        assert!(wall.id() == inner.id());
        assert_eq!(
            wall.fragment_shader_source(&[]),
            inner.fragment_shader_source(&[])
        );
        assert_eq!(wall.art(), ScreenArt::AuthorTexture);
        assert_eq!(wall.emissive_strength, declared);
        // `emissive` is the uniform the wrapper writes over, and `PhysicalMaterial`'s shader
        // declares and uses it unconditionally, so the write can never hit a dropped uniform.
        let source = inner.fragment_shader_source(&[]);
        assert!(source.contains("uniform vec4 emissive;"));
        assert!(source.contains("total_emissive"));
    }

    /// The author's art is the primary path. A change to this constant is a look-dev
    /// decision, and it has to be a deliberate one.
    #[test]
    fn the_authors_texture_is_the_default_path() {
        assert!(!FORCE_PROCEDURAL_SKY);
    }

    /// The procedural zenith comes from the material's own base colour, so it tracks the
    /// author. `(0.35, 0.3, 0.6) * 0.34` is a deep violet, well under the horizon's peach.
    #[test]
    fn the_procedural_zenith_is_darker_than_its_horizon() {
        let manifest = manifest();
        let base = manifest.material(&manifest.screen.material).unwrap().base_color;
        let zenith = Vec3::from(base) * SKY_ZENITH_GAIN;
        let horizon = Vec3::from(SKY_HORIZON);
        assert!(zenith.x < horizon.x && zenith.y < horizon.y);
        // ... and bluer than it, or the gradient runs the wrong way.
        assert!(zenith.z > zenith.x);
        assert!(horizon.x > horizon.z);
    }

    /// The wall frame is what the procedural sky maps onto, and it must survive a degenerate
    /// box without producing a division by zero in GLSL.
    #[test]
    fn wall_frame_is_never_degenerate() {
        let flat = AxisAlignedBoundingBox::new_with_positions(&[vec3(1.0, 2.0, 3.0)]);
        let frame = WallFrame::of(flat);
        assert!(frame.top > frame.bottom);
        assert!(frame.radius > 0.0);

        let wall = AxisAlignedBoundingBox::new_with_positions(&[
            vec3(-12.0, 0.0, -11.0),
            vec3(12.0, 8.0, 2.0),
        ]);
        let frame = WallFrame::of(wall);
        assert_eq!(frame.bottom, 0.0);
        assert_eq!(frame.top, 8.0);
        assert_eq!(frame.radius, 12.0);
        assert_eq!(frame.center.y, 0.0);
    }

    /// Both stages of the shader assembly have to be present, or the sky compiles to a
    /// black wall: `tone_mapping` and `color_mapping` are called by `SKY_FRAGMENT` but
    /// defined by three-d.
    #[test]
    fn the_sky_shader_carries_its_helpers() {
        let source = SkyMaterial::sky_fragment_shader();
        assert!(source.contains("vec3 tone_mapping(vec3 color)"));
        assert!(source.contains("vec3 color_mapping(vec3 color)"));
        assert!(source.contains("void main()"));
        // Every uniform the Rust side sends must be declared, or `use_uniform` would panic.
        for name in [
            "skyCenter",
            "skyBottom",
            "skyTop",
            "skyRadius",
            "time",
            "horizonColor",
            "lowColor",
            "highColor",
            "zenithColor",
            "cloudCore",
            "cloudLit",
            "cloudShadow",
            "cloudCover",
            "cloudSteps",
            "cloudScale",
            "cloudDrift",
            "starDensity",
            "starRarity",
            "starSize",
            "starIntensity",
            "emissiveStrength",
        ] {
            assert!(source.contains(name), "{name} is sent but not declared");
        }
        // The id must stay inside the range three-d reserves for us.
        assert!(SKY_MATERIAL_ID <= 0x4FFF);
    }
}
