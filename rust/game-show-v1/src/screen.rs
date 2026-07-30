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
//! # What this module does with the texture path
//!
//! Look-dev round 1 changed the answer to this. The wall is now drawn by a shader of this
//! module's own, [`SCREEN_FRAGMENT`]: the author's picture as **emission only**, at
//! [`SCREEN_EMISSION_GAIN`] times the declared strength, plus [`SCREEN_LIT_FRACTION`] of the
//! rig so a beam can still pool on the cyclorama. What it no longer does is draw the picture as
//! lit base colour *and* ambient *and* emission — two and a half copies of the same image added
//! together and clipped, which `renders/verdict_r1.json` identified as the reason a saturated
//! indigo-to-coral sunset rendered as "one flat pale lavender-pink field".
//!
//! The lighting is still three-d's: `lights_shader_source` is the crate's own function, the one
//! `PhysicalMaterial` calls, so `calculate_lighting` in that shader is the crate's model with
//! the crate's lights.
//!
//! The original reason a custom [`Material`] existed for the textured case still holds, and is
//! why the emissive factor is written by hand: **the declared emissive strength of 1.5.**
//! `three-d-asset` 0.10 never reads
//! `KHR_materials_emissive_strength` — I grepped its source for `emissive_strength` and got
//! no hits — so the import leaves the factor at the glTF's `emissiveFactor`, `(1, 1, 1)`.
//! `PhysicalMaterial::emissive` is an `Srgba`, four `u8`s, and cannot hold 1.5 either.
//! `PhysicalMaterial::use_uniforms` writes `emissive` with `use_uniform`, and
//! `shaders/physical_material.frag` always declares `uniform vec4 emissive` and always uses
//! it, so a wrapper can overwrite the uniform afterwards with a float value above 1.0.
//! [`SkyMaterial`] does exactly that and delegates everything else, including
//! `fragment_shader_source` and `id`, so the shader source stays byte-identical and the
//! program cache entry stays shared with the rest of the scene's `PhysicalMaterial`s.
//!
//! The headroom above 1.0 is only visible if the intermediate render target is floating
//! point; that is `src/postfx.rs`'s job (`docs/three_d_api.md` §5, option b, and §6).
//! Nothing here breaks if the target is `RGBA8` — the wall simply clips at white where it
//! would otherwise bloom.
//!
//! The lighting term is deliberately kept in the texture path. `docs/look_target.md`
//! §"Region 4" asks for a violet beam pool spilling into the crop's upper-right corner, and
//! that is a spot light landing on the wall. Emission alone would lose it.
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

/// Blender material that identifies the screen. On `Wall_Screen` and on slot 0 of
/// `Podium_Riser`.
pub const SCREEN_MATERIAL: &str = "MAT_LED_Screen";

/// Emissive strength `MAT_LED_Screen` declares, from
/// `KHR_materials_emissive_strength.emissiveStrength` in `assets/wheel_stage.glb` and from
/// `emission_strength` in `assets/scene.json`. Both paths emit at this strength, so the
/// fallback is as bright as the author's art. The unit test below asserts the two agree.
pub const EMISSIVE_STRENGTH: f32 = 1.5;

/// Look-dev gain on the author's texture, on top of [`EMISSIVE_STRENGTH`].
///
/// Below 1.0. Round 1's verdict on the wall was "the screen is milky ... one flat pale
/// lavender-pink field with soft low-contrast wisps and no blue anywhere", and it had already
/// established that the art itself is good: 4096x1024, saturated indigo zenith, magenta
/// midband, coral and cream cloud tops. The wash was arithmetic. The wall used to be drawn as
/// `albedo_texture * (key + rims + fill + ambient) + 1.5 * emissive_texture`, i.e. the same
/// picture added to itself two and a half times, and past 1.0 a sum of copies clips channel by
/// channel — which is exactly how a saturated indigo becomes pale lavender.
///
/// [`Art::Texture`] now emits the texture and nothing else, so the only question left is the
/// level. 0.72 x 1.5 = 1.08 puts the indigo top at about 0.15 linear, dark enough to read as
/// night, and leaves only the cream cloud tops over `BLOOM_THRESHOLD` — the reference's "cloud tops at the
/// crop's left, which read cream-peach and approach white" with everything below them holding
/// its colour.
/// Round 2 took it from 0.72 to 1.55, i.e. from below 1.0 to above it, and the reasoning above is
/// what got reversed. 0.72 x 1.5 = 1.08 was chosen to keep the indigo zenith at 0.15 linear and let
/// only the cream cloud tops clip — and the verdict on it was that the wall "is a muted mauve dusk
/// with soft airbrushed white-grey wisps ... It is the largest surface in the frame, so its
/// greyness drains the whole image". `docs/look_target.md` §"Region 4" is explicit the other way:
/// "The screen is brighter and more saturated than everything except the wheel. It must not be
/// dimmed into a backdrop."
///
/// 1.10 x 1.5 = 1.65 puts the peach cloud tops just over [`crate::postfx::BLOOM_THRESHOLD`], so
/// they carry the reference's 10-20 px halo while staying peach rather than blowing to white, the
/// magenta midband's red channel at about 1.1 and its green at 0.16, and the violet between the
/// lobes at 0.4. Filmic's shoulder is per channel, so a red that clips over a green that has not
/// keeps its hue — the reference's "highlights clip, and they clip warm" — and that is also why
/// [`SCREEN_SATURATION`] is applied before the gain rather than after. Measured up and back down:
/// at 1.55 the pale cloud tops all three channels clipped together and the lobes read white.
///
/// Round 3 took it from 0.85 to 1.28, i.e. `1.28 x 1.5 = 1.92`. The verdict: "The wall is also dimmer
/// than the reference, which wants it second-brightest after the wheel", against
/// `docs/look_target.md` region 4's "The screen is brighter and more saturated than everything except
/// the wheel. It must not be dimmed into a backdrop." At 1.92 the art's peach cloud tops land at
/// about 2.3 linear in red and 1.0 in green, so they clip warm and carry the reference's 10-20 px
/// halo, while the art's navy — now inside the window, see [`SCREEN_UV_WINDOW`] — lands at 1.8 in blue
/// and 0.15 in red, which is the cobalt the round asked for and not a washed lavender. Filmic's
/// shoulder is per channel, so a red that clips over a green that has not keeps its hue.
///
/// It is also the ceiling on `crate::postfx::FLARE_THRESHOLD`: 2.3 in red is the brightest thing on
/// the wall, and the streak pass must not be seeded by the largest surface in the frame.
///
/// Round 4 took it from 1.18 to 1.72, i.e. `1.72 x 1.5 = 2.58`. The verdict, on both sides at once:
/// the left is "a pale baby-pink field" and the right "a dark navy band ... plainly darker than the
/// floor, where the reference ... wants the wall second-brightest after the wheel". Held against
/// `renders/d_f1/ref_sky_right.png` the reference's right wall is a *bright* cobalt carrying
/// cyan-white lobes that read near-white, and the render's was about a third of that.
///
/// The headroom for it came from `crate::postfx::FLARE_THRESHOLD`, which round 4 raised from 2.9 to
/// 3.7 for the podium's desk band. The art's peach tops now land at about 3.4 linear in red, which is
/// still under the streak pass, so the wall can be this bright without smearing itself sideways
/// across the frame. That coupling is why the two constants have to be read together.
///
/// Round 5 took it back down from 1.58 to 1.38, and it is the one constant of this file the round
/// asked to *lower*: "Widen the value range rather than the gain." Four rounds have raised this and
/// four verdicts have called the wall flat, which is what a gain has to do. A gain is a multiplier, so
/// it moves every pixel of the art up the same number of stops and then Filmic's shoulder squeezes the
/// top of the range back together — the brighter the wall gets, the more of it sits on the shoulder and
/// the less range survives. Round 5's own words: "a flat high-chroma magenta-pink field ... near-uniform
/// in value across the lower two thirds of the crop". [`SCREEN_CONTRAST`] is the term that widens the
/// range instead, and it is what makes room for this to come down. Measured through 1.02 first, which was
/// too far: with the contrast expansion in place at 1.02 the wall read as a pale dusk, and
/// `docs/look_target.md` region 4 wants it "brighter and more saturated than everything except the
/// wheel". 1.38 is the level at which the cloud tops still clip and the sky between them does not.
pub const SCREEN_EMISSION_GAIN: f32 = 1.38;

/// Exponent and pivot of the contrast expansion applied to the sampled art, before the chroma and the
/// gain. `1.0` in the exponent switches it off.
///
/// `art = pivot * pow(art / pivot, exponent)`, per channel. Above the pivot the art gets brighter,
/// below it darker, and the pivot itself does not move — so this widens the picture's value range
/// without changing how bright it is on average, which is exactly the difference between it and
/// [`SCREEN_EMISSION_GAIN`].
///
/// This is round 5's answer to the wall, and the round's own diagnosis of what was missing:
/// "The reference has coral and peach cauliflower tops over violet with cobalt through the upper
/// middle on the left, and big cyan-white and pink lobes over bright cobalt on the right ... what is
/// missing is the value range." `T_LEDWall_Sky` is a painted sunset with a wide range of its own —
/// near-black cloud undersides up to near-white tops — but it arrives at the wall downsampled 1.5x by
/// [`SCREEN_UV_WINDOW`] and every downsample averages, so the range comes out compressed before
/// anything else touches it. 1.55 at a pivot of 0.55 puts a cloud underside at 0.11 where the raw
/// sample had 0.20, and a cloud top at 1.4 where the raw sample had 1.0, which is 13:1 against the
/// sample's 5:1.
///
/// The pivot is also what decides where the split tone changes hands: everything under it takes the
/// side's shadow tint and everything over it the side's highlight tint. See
/// [`SCREEN_SIDE_TINT_LEFT`].
pub const SCREEN_CONTRAST: (f32, f32) = (1.55, 0.55);

/// Chroma multiplier on the author's texture, applied before [`SCREEN_EMISSION_GAIN`].
///
/// `1.0` is the art as painted. Round 2's verdict was that the wall "is far less saturated than the
/// source art" and that only "cream and white should be desaturated and in the render everything
/// is". Two things desaturate it and neither is the art: the wall carries
/// [`SCREEN_LIT_FRACTION`] of a near-white rig on top of its own picture, which is an additive
/// white term over a saturated colour, and Filmic's shoulder pulls the channels of a bright pixel
/// together. 1.45 is the pre-compensation, taken about the pixel's own luminance so a cream cloud
/// top stays cream and only the coral, magenta and cobalt gain.
///
/// Round 4 took it from 1.45 to 1.80, because [`SCREEN_EMISSION_GAIN`] went up by half and the two
/// pull against each other: a brighter wall puts more of the art onto Filmic's shoulder, the shoulder
/// is per channel, and so it converges the channels of every cloud top. The round-4 verdict — "The
/// lobes have hard edges now, which is right; they carry almost no chroma" — is that convergence. The
/// chroma has to go in before the gain for any of it to survive the gain.
///
/// **Round 5 took it from 1.80 to 0.82, i.e. below 1.0, and moved the chroma job to
/// [`SCREEN_TONE_CHROMA`].** This operator runs on the art *before* the tint, so what it amplifies is
/// the art's own hue — and the art's clouds are pale pink. At 1.80 a cloud arrived at the tint with its
/// red near ten times its green, so the right side's cyan multiplier could not turn it cyan: the
/// reference's right wall has "big cyan-white and pink lobes" and the round-5 render had magenta ones,
/// and this constant is why. Under 1.0 it pushes the art toward its own luminance, which leaves the split
/// tone free to decide hue; [`SCREEN_TONE_CHROMA`] then puts the chroma back after the tint, where what
/// gets amplified is the *tint's* hue. Measured down to 0.60 and back up: at 0.60 the wall lost the art's
/// own variation inside a lobe and read as flat tinted grey.
pub const SCREEN_SATURATION: f32 = 0.82;

/// Multiplier on the wall's emission at the camera-left end of the room, `-X`. Coral-magenta.
///
/// `docs/look_target.md` §"Light colour, left versus right" makes the split load-bearing and says
/// the wall is where it mostly lives: "The left screen shows coral clouds on violet ... The right
/// screen is cooler and bluer, with cyan-white cloud tops on cobalt." Round 2's verdict was that
/// the render's two sides are "identical on both sides", which "erases the left/right split".
///
/// Graded rather than re-windowed. The alternative the verdict offered — sampling a different
/// horizontal region of the 4096-wide texture per side — needs a `u` discontinuity somewhere in
/// the wall, and the wall wraps a full 360° with its own seam behind the camera, so the only place
/// to put a second seam is inside the frame. A tint that crossfades over
/// [`SCREEN_SIDE_BLEND_M`] metres has no seam at all, and the crossfade centre sits at world
/// `x = 0`, which the wheel covers.
/// Round 3 pulled both tints back toward neutral, from `(1.15, 0.74, 0.55)` and `(0.20, 0.60, 2.00)` to
/// `(1.10, 0.78, 0.72)` and `(0.42, 0.80, 1.55)`, because [`SCREEN_SIDE_V_SHIFT`] now carries most of
/// the split out of the art itself. A tint strong enough to make the split on its own is also strong
/// enough to be the only hue on its side, which is what the round-3 verdict objected to: "the split
/// reads as one hue rotation of the same flat wall". The left tint's blue is what was crushing the
/// reference's cobalt out of the left wall, and it is up from 0.55 to 0.72; the right tint's red is what
/// was crushing the coral out of the right wall, and it is up from 0.20 to 0.42.
/// Round 4 took it from `(1.18, 0.72, 0.68)` to `(1.25, 0.64, 0.36)`. The verdict wanted the left
/// wall's "coral, salmon and peach tops over magenta-violet" where the render had "a pale baby-pink field";
/// pink is what a peach becomes when its blue is left near its green. Cutting the blue to a bit over
/// half the green is what turns the same art coral. The cobalt the round-3 note was protecting comes
/// from the art's own top rows, whose red is near zero, so a blue at 0.36 still leaves them blue.
///
/// **Round 5 made this a split tone: this constant is now the camera-left side's tint for everything
/// *under* [`SCREEN_CONTRAST`]'s pivot, and [`SCREEN_SIDE_HIGH_LEFT`] is its tint for everything over
/// it.** One tint per side cannot draw the reference's wall and the arithmetic says why. The art's sky
/// is violet-blue and its clouds are pale pink, so on the left the sky has to arrive violet with cobalt
/// in it and the clouds have to arrive coral — a hue rotation *toward* warm for the bright pixels and
/// *toward* cool for the dark ones. A single multiplier cannot do both: raise its red enough to turn a
/// pale cloud coral and the violet sky under it turns magenta too, which is the round-5 verdict word for
/// word ("a flat high-chroma magenta-pink field ... with no cobalt, coral, salmon or peach anywhere").
/// Rounds 3 and 4 both tried to settle the same tension by moving one tint's red up and down and both
/// landed on a wall of one hue.
///
/// The left side's shadow tint is a violet-blue, blue well over red, which is what
/// turns the art's sky into `docs/look_target.md`'s "Magenta-violet through the middle" with "Cobalt and
/// royal blue at the upper right". The crossfade between the two tints is the pixel's own luminance over
/// [`SCREEN_TONE_SPLIT`], not a position on the wall, so a cloud lobe carries the warm tint wherever it
/// is and the sky between two lobes stays cool.
///
/// `(0.95, 0.34, 1.55)` as shipped, measured up from `(0.72, 0.42, 1.20)` once [`SCREEN_SATURATION`]
/// came under 1.0: with the art pushed toward neutral the tint carries the whole hue, so both of the left
/// pair had their ratios widened rather than their levels raised.
pub const SCREEN_SIDE_TINT_LEFT: [f32; 3] = [0.95, 0.34, 1.55];

/// Multiplier on the camera-left wall's emission for everything *over* [`SCREEN_CONTRAST`]'s pivot:
/// the cloud tops. Coral-peach, red well over blue.
///
/// `docs/look_target.md` region 4: "Coral, salmon, and peach cloud tops at the left ... The cloud tops
/// at the crop's left, roughly crop (60-260, 60-140), which read cream-peach and approach white." Red
/// at 2.20 puts them over Filmic's shoulder and blue at 0.72 keeps blue off it, so they clip warm — the
/// reference's "highlights clip, and they clip warm. The hot cores read pale lemon or pale pink, not
/// neutral white."
pub const SCREEN_SIDE_HIGH_LEFT: [f32; 3] = [2.20, 0.88, 0.72];

/// Multiplier on the wall's emission at the camera-right end of the room, `+X`. Cobalt-cyan.
/// See [`SCREEN_SIDE_TINT_LEFT`]. Its average with the left tint is close to neutral, so the split
/// swings hue without changing how bright the wall is.
/// Measured after the first round-3 render: the red went 0.42 to 0.62 and the green 0.80 to 0.95,
/// because at 0.42 the right wall came out a flat monochrome cobalt with no cloud in it at all, where
/// `renders/x3/sky_right_ref.png` has cyan-white and pink lobes all over its cobalt. A tint that crushes
/// red crushes the cloud, because the cloud is the warm part of the art.
///
/// Round 4 took it from `(0.62, 0.95, 1.55)` to `(0.82, 1.18, 1.98)`, which is the same hue a third
/// brighter. The verdict asked for it directly: "raise the right side's gain until the right wall is at
/// least as bright as the left". Its luminance is 1.13 against the left tint's 0.82, so the right wall
/// is now the brighter of the two — which is what `renders/d_f1/ref_sky_right.png` shows, a bright
/// cobalt field with near-white cyan lobes, against the left's coral on violet.
///
/// Round 5 made this the camera-right side's *shadow* tint; see [`SCREEN_SIDE_TINT_LEFT`] for why the
/// grade is a split tone now. `(0.30, 0.62, 2.20)` is a bright cobalt, which is what the reference's
/// right wall is between its lobes: "big cyan-white and pink lobes over bright cobalt on the right".
pub const SCREEN_SIDE_TINT_RIGHT: [f32; 3] = [0.30, 0.62, 2.20];

/// Multiplier on the camera-right wall's emission for the cloud tops. Cyan-white, green and blue over
/// red.
///
/// `docs/look_target.md` §"Light colour, left versus right": "The right screen is cooler and bluer,
/// with cyan-white cloud tops on cobalt." The round-5 verdict on the right side was that it had no
/// cloud at all — "the upper band is flat electric indigo with no cloud beyond a few pale specks" —
/// which was half [`SCREEN_UV_WINDOW`] sampling the art's empty zenith and half the single tint
/// crushing the art's warm cloud out of that side. Green at 1.95 against red at 0.95 is what makes the
/// same painted lobe read cyan-white instead of vanishing.
pub const SCREEN_SIDE_HIGH_RIGHT: [f32; 3] = [0.95, 1.95, 1.85];

/// Luminance of the contrast-expanded art at which the side's shadow tint has fully handed over to its
/// highlight tint, and where the handover starts. See [`SCREEN_SIDE_TINT_LEFT`].
///
/// `(0.26, 0.72)` straddles [`SCREEN_CONTRAST`]'s pivot of 0.55. Measured down from `(0.30, 0.95)`,
/// where a cloud body at 0.6 got only a third of the way to the warm tint and so came out pink rather
/// than coral: the crossfade has to be finished by the time a lobe's body is reached, not by the time its
/// brightest top is.
pub const SCREEN_TONE_SPLIT: (f32, f32) = (0.26, 0.72);

/// Chroma multiplier applied *after* the split tone and the gain, about the graded pixel's own
/// luminance. `1.0` switches it off.
///
/// [`SCREEN_SATURATION`] and this one are not the same operator applied twice, and the round-5 split
/// tone is why both are needed. That one runs on the art before the tint, so it amplifies the *art's*
/// hue: at 1.80 it made a warm cloud so pink that the right side's cyan tint could not overcome it —
/// the right wall's lobes came out magenta with a cyan multiplier on them. It has to be near 1.0 for
/// the tint to be the thing that decides hue. This one runs after the tint, so what it amplifies is the
/// hue the tint chose, which is the violet or the cobalt or the coral the reference asks for.
///
/// Filmic is the reason a multiplier is not enough on its own. Its shoulder is per channel and it
/// compresses hard above 1.0, so a graded pixel at `(1.5, 0.5, 2.0)` arrives at the frame with its
/// channels much closer together than it left with, and `docs/look_target.md` is explicit that the wall
/// is the most saturated thing in the frame after the wheel. 1.55 is the pre-compensation for that
/// convergence, taken about luminance so it changes no pixel's value.
pub const SCREEN_TONE_CHROMA: f32 = 1.55;

/// How hard the author's own painted stars are pushed back into the sky they sit on. `0.0` leaves them
/// as painted.
///
/// `T_LEDWall_Sky` has single bright texels sprinkled through its navy zenith and down into its violet
/// midband — stars, which belong in a painted sky and do not belong on an indoor LED wall.
/// `docs/look_target.md` region 4 has no stars in the reference's wall, and rounds 4 and 5 both asked
/// for them dropped: "the lower band is violet-magenta with soft white blobs ... The pale specks are the
/// stars round 4 asked to be dropped."
///
/// Round 4 weighted the *unsharp mask* out over them, which stopped the sharpen turning a speck into a
/// hard dot but left the speck. This replaces the sample itself with its own local average wherever the
/// texel is an isolated maximum — brighter than its neighbourhood by half again — which is a property no
/// cloud boundary has, because a cloud boundary always has a lobe on one side of it. 1.0 is a full
/// replacement: the star is gone and the sky behind it is what the art painted there.
pub const SCREEN_STAR_KILL: f32 = 1.0;

/// Half-width of the crossfade between the two side tints, in metres of world `x`.
///
/// The wheel spans about ±2.6 m and stands at `x = 0`, so a crossfade that is complete by ±5 m is
/// hidden behind the wheel where it is fastest and gone by the pillars at ±8 m, where each side
/// must already read as its own colour.
pub const SCREEN_SIDE_BLEND_M: f32 = 5.0;

/// What the direct lights are still allowed to add to the wall, as a fraction of a full
/// Lambertian term.
///
/// Not zero, and the reason is in `docs/look_target.md` §"Region 4": "A violet beam pool spills
/// in from the crop's upper-right corner". That pool is `Beam_R` landing on the cyclorama, and
/// pure emission would lose it. This is a plain `N·L` sum over the rig with no ambient and no
/// specular, at a sixth strength, so a beam can put a soft wedge on the wall without the wall
/// picking up a second copy of its own picture.
pub const SCREEN_LIT_FRACTION: f32 = 0.16;

/// Vertical window of `T_LEDWall_Sky` the wall shows: how much of the texture's `v` range is
/// stretched over the wall's height, and where that window starts.
///
/// `(1.0, 0.0)` is the mesh's own UVs, and that is what round 1 rendered. The art is 4096x1024
/// with its indigo zenith across the top, its magenta midband through the middle and its coral
/// and cream cloud tops in the lower half, so at 1:1 the wall's upper half is empty sky and the
/// clouds are a band along the bottom. The reference's wall is *packed* with cloud from top to
/// bottom — `renders/ref_crops/screen_left.png` is one continuous field of coral and magenta
/// lobes on blue — and its lobes are bigger than the texture's own. `(0.68, 0.32)` shows the top
/// 68% of the art over the whole wall height, which keeps the indigo top and brings the cloud
/// deck up into the frame at about 1.5x the size.
///
/// Vertical only. The wall wraps a full 360° and its `u` runs once around it, so any horizontal
/// scale other than 1.0 puts a seam or a repeat inside the frame.
/// Round 2 took it from `(0.62, 0.22)` to `(0.30, 0.52)`. Two separate misses, one in each
/// component.
///
/// **Which way `v` runs, measured rather than assumed.** `uvs.y` is 0 at the wall's *bottom* edge
/// and the sampler reads the art upside down relative to it, so the texture row a fragment shows is
/// `1 - (uvs.y * height + offset)`. In art terms: the wall's bottom edge shows row `1 - offset` and
/// its top edge row `1 - offset - height`. A *larger* offset therefore slides the window *up* the
/// art, toward the navy. Round 2's first attempt at this constant moved the offset the other way,
/// on the assumption that `v` runs down the art, and the whole wall came out navy-blue.
///
/// The offset. At 0.22 the wall's bottom edge showed row 0.78 and its top edge row 0.16 — the art's
/// navy zenith across most of the visible height with the coral only in the last strip, which the
/// plinth cuts off. Hence "the coral-peach zone never appears anywhere in the frame, where the
/// reference's left wall IS that coral-peach zone". At 0.05 the bottom edge shows row 0.95, deep
/// peach, and the top edge row 0.62, the pink cloud deck. The navy is cropped off above the fascia
/// entirely and the warm half of the art is the half the frame shows.
///
/// The height. 0.62 of a 1024-tall art stretched over a wall 330 px tall on screen is a 1.9x
/// *downsample*, and the verdict was that the lobes read "much softer than the source art's, losing
/// the hard cauliflower edges and flat interior steps" — a downsampled painted edge is a soft edge.
/// 0.33 is 338 texels over those 330 px, so the art lands about 1:1 and its hard lobe boundaries
/// survive to the frame. It also magnifies the lobes 1.9x against round 2, toward the size
/// `renders/ref_crops/screen_left.png` shows.
///
/// Round 3 took it from `(0.36, 0.14)` to `(0.74, 0.13)`, which is the *opposite* direction to the one
/// the verdict suggested, and the measurement is why. The verdict asked to "shrink SCREEN_UV_WINDOW so
/// the lobes return to the source art's size with hard edges", reading the render's oversized lobes as
/// magnification. The window's first component is how much of the art's `v` is stretched over the
/// wall, so *shrinking* it magnifies further; enlarging it is what makes a lobe smaller.
///
/// The other half of the same measurement is the hue. `T_LEDWall_Sky` was pulled off disk and looked
/// at again: navy zenith across the top quarter, violet-magenta through the middle, coral and peach
/// cloud tops across the bottom half. At `(0.36, 0.14)` the wall's bottom edge showed art row `1 -
/// 0.14 = 0.86` and its top edge row `1 - 0.50 = 0.50`, so the visible band was the magenta-to-peach
/// zone alone — which is exactly the render the verdict describes: "a flat field, salmon-pink left and
/// violet-purple right ... There is no cobalt on the left and no cyan on the right." The reference's
/// left wall is coral cloud *under* a cobalt sky, so the window has to hold the whole art, not a slice
/// of it.
///
/// At `(0.74, 0.13)` the bottom edge shows row 0.87, deep peach, and the top edge row 0.13, the navy
/// zenith. 758 texels then land on a wall about 500 px tall, a 1.5x downsample, and a downsampled
/// painted edge is a soft edge — which is what [`SCREEN_SHARPEN`] and [`SCREEN_POSTERISE`] exist to
/// undo. Holding the whole picture and restoring its edges arithmetically is cheaper than choosing
/// between the cobalt and the hard lobes.
///
/// Round 4 took the offset from 0.13 to 0.055 and left the height alone. The verdict: "Slide the
/// sampled window down on both sides so the coral and peach tops land in the visible band", with the
/// left showing "a full-width cobalt cap covering the whole top of the crop" where the reference
/// "keeps cobalt to the upper right only". A *smaller* offset slides the window down the art, toward
/// the peach (see the paragraph above on which way `v` runs). At 0.055 the wall's bottom edge shows art
/// row 0.945 and its top edge row 0.205, so the navy zenith's lower fringe is all that is left above
/// the cloud deck instead of the whole top quarter of the art.
///
/// The height came down with it, from 0.74 to 0.66, after the first round-4 render put a band of
/// flat featureless royal blue across the top of the right wall where `renders/d_f1/ref_top_right.png`
/// has bright cobalt *with cloud lobes in it*. The art's top 15% is empty navy — its clouds start at
/// about row 0.29 — so a window that reaches row 0.20 spends a fifth of the wall's height on sky with
/// nothing painted in it. At `(0.66, 0.05)` the wall's top edge shows row 0.29 and its bottom edge
/// row 0.95, which is the whole of the art that has cloud in it and none of the part that has not.
///
/// Round 5 took the height from 0.46 to 0.64 and the offset from 0.18 to 0.115. At `(0.46, 0.18)` the
/// wall's bottom edge showed art row `1 - 0.15 = 0.85` on the left and its top edge row `1 - 0.61 =
/// 0.39` — the art's violet-to-pink middle and nothing else, with the whole cobalt zenith cropped off
/// above the fascia. That is the round-5 verdict: "no cobalt, coral, salmon or peach anywhere" on the
/// left and "flat electric indigo with no cloud" on the right, the second being the same window slid up
/// 6% by `SCREEN_SIDE_V_SHIFT` into the art's empty top.
///
/// At `(0.64, 0.115)` the left wall shows rows 0.885 down to 0.245 and the right rows 0.865 to 0.225.
/// Row 0.24 is where the art's cloud deck starts, so the whole visible band has cloud in it and none of
/// it is the empty navy above; row 0.88 is the deep warm pink at the bottom. That is the full sunset,
/// which is what a split tone needs to work on — see [`SCREEN_SIDE_TINT_LEFT`].
pub const SCREEN_UV_WINDOW: (f32, f32) = (0.64, 0.115);

/// How much the sampled art is sharpened against its own local average, and the tap radius of that
/// average in texels of the source.
///
/// `docs/look_target.md` region 4 is explicit that this matters more than the colour: "The clouds are
/// painterly. Their lobes are hard-edged cauliflower shapes and their interiors are flat colour steps.
/// They are not soft photographic gradients. A sky shader that produces smooth fractal noise will read
/// wrong here even at the right colour." Every round so far has been judged on the same miss — round 3's
/// was "soft airbrushed wisps rather than hard-lobed cauliflower with flat interior steps".
///
/// The cause is [`SCREEN_UV_WINDOW`]: the whole art has to fit the wall, so it arrives downsampled 1.5x
/// and the sampler's own bilinear filter is what softens the lobe boundaries. An unsharp mask is the
/// exact inverse of that filter — `art + (art - blur(art)) * amount` — and it is applied before the
/// saturation and the gain so what clips is the sharpened colour.
///
/// Measured down from 0.9 at 2.5 texels to 0.55 at 1.6 after the first round-3 render. The art carries
/// its own fine dither — it is a painted PNG, not a synthetic gradient — and a sharpen wide enough to
/// find a lobe boundary also amplifies that dither into a visible stipple across the whole wall. 1.6
/// texels is inside the art's own grain and still outside the sampler's bilinear footprint at 1.5x.
///
/// Round 5 took it to 0.80 at 1.8 texels, because [`SCREEN_UV_WINDOW`] widened and the art therefore
/// arrives more downsampled than it did: a wider sampler footprint needs a wider unsharp radius to
/// invert. [`SCREEN_STAR_KILL`] now removes the painted specks the round-3 note was protecting, which is
/// what makes the stronger amount safe.
pub const SCREEN_SHARPEN: (f32, f32) = (0.80, 1.8);

/// Number of flat steps the sampled art is quantised into per channel, after [`SCREEN_SHARPEN`] and
/// before the saturation. `0.0` switches it off.
///
/// The other half of "hard-edged cauliflower shapes and their interiors are flat colour steps", and the
/// half the sharpen cannot do: a sharpened gradient is still a gradient. Quantising each channel to a
/// fixed number of levels turns a lobe's interior into flat plateaus with hard boundaries between them,
/// which is what a painted cloud is. `docs/look_target.md` asks for it in those words — "Aim for
/// banded, posterised lobes" — and the procedural fallback in this file has had [`CLOUD_STEPS`] for the
/// same reason since round 1; this is the author's-texture path finally getting it too.
///
/// 9 steps, down from 13 in round 5, which is a coarser plateau: `docs/look_target.md` asks for
/// "posterised flat steps inside the hard-edged lobes" and the round-5 verdict still had a lobe's
/// interior reading as a gradient. The visible cost is that the sky's own vertical gradient bands as well
/// as the clouds, at about 60 px a step over a 500 px wall, and the reference's sky does show steps of
/// that order.
pub const SCREEN_POSTERISE: f32 = 9.0;

/// How far the sampled window slides up the art on the camera-left side of the room and on the
/// camera-right side, added to [`SCREEN_UV_WINDOW`]'s offset.
///
/// The round-3 verdict asked for the split to come from the art rather than from a multiplier: "Sample
/// a different horizontal region of the 4096-wide texture per side rather than tinting the same region,
/// so the left keeps coral over violet with cobalt above it and the right gets real cyan-white tops on
/// cobalt." Horizontal is the one axis this cannot use — the wall wraps 360° with `u` running once
/// around it, so any `u` offset that differs by side puts a seam in the wall — but the axis the art's
/// hue actually runs along is `v`, so that is the axis to shift. `T_LEDWall_Sky` is a sunset: warm at
/// the bottom, cobalt at the top, near-uniform left to right.
///
/// A larger `v` is further up the art, toward the navy (see [`SCREEN_UV_WINDOW`] on which way `v` runs).
/// So the right side takes `+0.03` and the left `-0.03`. Both are small, and measured: `+0.09` was tried
/// first and it slid the right wall's whole visible band into the art's empty navy zenith, which
/// `renders/x3/sky_right_ref.png` is emphatically not — the reference's right wall is as full of cloud as
/// its left one and only the cloud's *hue* is cooler. So the shift moves the deck a little and
/// [`SCREEN_SIDE_TINT_RIGHT`] does the hue. The crossfade is [`SCREEN_SIDE_BLEND_M`] wide and centred
/// on `x = 0`, which the wheel stands in front of, so the shift has no visible boundary either.
///
/// Round 4 took it from `(-0.03, 0.03)` to `(-0.02, 0.0)`. The `+0.03` on the right is half of why the
/// round-4 verdict found the right wall "a dark navy band with small pale-lavender clouds, plainly
/// darker than the floor": the shift slid the right side's window three per cent further up the art,
/// into the navy, and the navy is the darkest part of the picture. The reference's two sides differ in
/// hue, not in how much sky they show, so the hue is left to [`SCREEN_SIDE_TINT_RIGHT`] and the shift
/// now only keeps the left side's coral deck a little lower.
///
/// Round 5 took it from `(-0.03, 0.06)` to `(-0.005, -0.015)`. The `+0.06` on the right is why
/// `renders/j5/skyright.png` has no cloud at all in its upper band: it slid that side's window six per
/// cent up the art, into the zenith the painter left empty. Both sides now show almost the same band and
/// the whole of the split is left to the two pairs of tints, which is where the reference puts it — its
/// two sides differ in hue, not in how much sky they show.
pub const SCREEN_SIDE_V_SHIFT: (f32, f32) = (-0.005, -0.015);

/// `EffectMaterialId` of the emission-only wall shader. Distinct from
/// [`SKY_MATERIAL_ID`] and from anything `PhysicalMaterial` uses.
pub const SCREEN_MATERIAL_ID: u16 = 0x0211;

/// Set to `true` to draw the procedural sky even when the GLB carries the author's texture.
///
/// `false` is the shipped value: the author's `T_LEDWall_Sky` is the primary path. Flip this
/// to `true` only for look-dev, if the author's art turns out to fight
/// `docs/wheel_stage.png`. A texture-less export falls back on its own without this.
pub const FORCE_PROCEDURAL_SKY: bool = false;

/// `EffectMaterialId` for the procedural sky shader. The public range is `0x0000..=0x4FFF`;
/// everything three-d uses itself is `>= 0x5000`. `src/postfx.rs` owns `0x0001..=0x00FF`.
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

/// Peak linear radiance of a star, before [`EMISSIVE_STRENGTH`]. Faint by instruction, but
/// not below the violet it sits on: at 0.55 the stars were invisible in the render.
pub const STAR_INTENSITY: f32 = 1.4;

/// Which art draws `MAT_LED_Screen`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScreenArt {
    /// The author's `T_LEDWall_Sky` as `assets/wheel_stage.glb` carries it, sampled from the
    /// mesh's `UVMap`, emitting at [`EMISSIVE_STRENGTH`]. The default.
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
    /// The author's texture, drawn as emission at [`SCREEN_EMISSION_GAIN`] plus
    /// [`SCREEN_LIT_FRACTION`] of the rig. The `PhysicalMaterial` is kept for the texture
    /// reference, the render states and the albedo factor; its shader is not used.
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
    /// Linear emissive multiplier. [`EMISSIVE_STRENGTH`] unless look-dev moves it.
    pub emissive_strength: f32,
    /// Seconds since start. Drives the procedural cloud drift and nothing else, so the
    /// texture path is unaffected by it. Fixed at 0.0 for `--shot`.
    pub time: f32,
}

impl SkyMaterial {
    /// The author's texture path: the GLB's material with the emissive factor raised to the
    /// strength the glTF declares.
    fn textured(material: PhysicalMaterial) -> Self {
        SkyMaterial {
            art: Art::Texture(material),
            emissive_strength: EMISSIVE_STRENGTH,
            time: 0.0,
        }
    }

    /// The procedural path. `base` is `MAT_LED_Screen`'s flat base colour in linear RGB,
    /// which becomes the zenith after [`SKY_ZENITH_GAIN`].
    fn procedural(frame: WallFrame, base: [f32; 3]) -> Self {
        SkyMaterial {
            art: Art::Sky {
                frame,
                zenith: Vec3::from(base) * SKY_ZENITH_GAIN,
            },
            emissive_strength: EMISSIVE_STRENGTH,
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

    /// The author's-texture fragment shader: the picture as emission, plus a fraction of the
    /// rig so a beam can still pool on the wall.
    ///
    /// `lights_shader_source` is three-d's own, the same function `PhysicalMaterial` calls, so
    /// `calculate_lighting` here is the crate's lighting model with the crate's lights and not a
    /// re-implementation. What this shader leaves out is the second and third copy of the
    /// picture: the full-strength diffuse term and the ambient term.
    fn texture_fragment_shader(lights: &[&dyn Light]) -> String {
        let mut shader = lights_shader_source(lights);
        shader.push_str(ToneMapping::fragment_shader_source());
        shader.push_str(ColorMapping::fragment_shader_source());
        shader.push_str(SCREEN_FRAGMENT);
        shader
    }
}

/// The emission-only wall, in GLSL.
///
/// Every uniform here is one `PhysicalMaterial` also sends, with the same name and meaning, so
/// the two paths can be compared directly. `albedo`, `emissive`, `metallic`, `roughness` and
/// `cameraPosition` must all be declared *and used*: `Program::use_uniform` panics on a uniform
/// the compiler has dropped, and [`SkyMaterial::use_uniforms`] sends all five.
const SCREEN_FRAGMENT: &str = r#"
uniform sampler2D emissiveTexture;
uniform mat3 emissiveTexTransform;
uniform vec4 albedo;
uniform vec4 emissive;
uniform float metallic;
uniform float roughness;
uniform vec3 cameraPosition;
uniform float screenGain;
uniform float litFraction;
uniform vec2 uvWindow;
uniform float screenSaturation;
uniform vec3 sideTintLeft;
uniform vec3 sideTintRight;
uniform vec3 sideHighLeft;
uniform vec3 sideHighRight;
uniform vec2 toneSplit;
uniform vec2 screenContrast;
uniform float starKill;
uniform float sideBlend;
uniform vec2 sideVShift;
uniform vec2 screenSharpen;
uniform float screenPosterise;
uniform float toneChroma;
uniform vec2 emissiveTexel;

in vec2 uvs;
in vec3 pos;
in vec3 nor;
layout (location = 0) out vec4 outColor;

vec3 sample_art(vec2 uv) {
    return texture(emissiveTexture, (emissiveTexTransform * vec3(uv, 1.0)).xy).rgb;
}

void main() {
    // Which side of the room this fragment is on, once, because both the window and the tint use it.
    // `pos.x` is world x and +X is camera-right; the crossfade is centred on x = 0, which the wheel
    // stands in front of, so neither has a visible boundary.
    float side = smoothstep(-sideBlend, sideBlend, pos.x);

    // The vertical window, slid up the art per side so the left wall keeps its coral deck low and the
    // right wall pulls the cobalt down into it. See SCREEN_SIDE_V_SHIFT.
    float vOffset = uvWindow.y + mix(sideVShift.x, sideVShift.y, side);
    vec2 uv = vec2(uvs.x, uvs.y * uvWindow.x + vOffset);
    vec3 art = sample_art(uv);
    vec3 normal = normalize(gl_FrontFacing ? nor : -nor);

    // Four taps at the sharpen radius, in a cross rather than a box: a cross is what sharpens an edge
    // of any orientation without ringing on a corner.
    vec2 r = emissiveTexel * max(screenSharpen.y, 0.5);
    vec3 blurred = 0.25 * (
        sample_art(uv + vec2(r.x, 0.0)) + sample_art(uv - vec2(r.x, 0.0)) +
        sample_art(uv + vec2(0.0, r.y)) + sample_art(uv - vec2(0.0, r.y)));
    vec3 detail = art - blurred;

    // The sharpen is weighted out where the local average is dark, and that is the star field.
    // `T_LEDWall_Sky` has its own painted stars sprinkled through its navy zenith — single bright
    // texels on a near-black ground — and an unsharp mask is exactly the operator that turns one of
    // those into a hard white dot. The round-4 verdict: "The wall's upper blue band carries a field of
    // small white dots that read as night-sky stars on an indoor LED screen. The reference wall has no
    // stars." The art is the author's and is not ours to repaint, so what changes is how hard this pass
    // pulls on it. A cloud lobe's boundary sits between two bright plateaus and keeps its full sharpen;
    // a speck on the navy is left as the art painted it, which at this magnification is invisible.
    float detailFloor = dot(blurred, vec3(0.2126, 0.7152, 0.0722));
    detail *= smoothstep(0.06, 0.24, detailFloor);

    // And weighted out again where this texel is an isolated maximum: brighter than the local average
    // by more than half again is a painted star, because a cloud lobe's boundary always has a lobe on
    // one side of it and so never clears its own neighbourhood by that much. This is the part of the
    // star field that survives the test above, the specks the author sprinkled down into the violet
    // midband where the local average is not dark at all.
    float artLuma = dot(art, vec3(0.2126, 0.7152, 0.0722));
    float isolated = smoothstep(1.5, 2.2, artLuma / max(detailFloor, 1.0e-4));
    detail *= 1.0 - isolated;

    // Round 5: the sample itself, not only the detail. Weighting the unsharp mask out over a star
    // stops the mask hardening it and leaves the star there, and rounds 4 and 5 both asked for the
    // specks gone. Replacing an isolated maximum with its own local average puts the sky the painter
    // put behind it back. See SCREEN_STAR_KILL.
    art = mix(art, blurred, clamp(isolated * starKill, 0.0, 1.0));

    // The posterise runs on the *smoothed* value and the detail is added back after it, which is not
    // cosmetic ordering. `T_LEDWall_Sky` is a painted PNG and carries its own fine dither; quantising
    // the raw sample turns every dithered pixel into a step of its own, and the wall printed a dense
    // dot matrix across its whole midband. Quantising the local average instead gives the flat interior
    // plateaus `docs/look_target.md` asks for with no dither to trip over, and the detail term then puts
    // the lobe boundaries back on top of them. See SCREEN_POSTERISE and SCREEN_SHARPEN.
    vec3 base = blurred;
    if (screenPosterise > 0.0) {
        base = floor(base * screenPosterise + 0.5) / screenPosterise;
    }
    art = max(vec3(0.0), base + detail * (1.0 + screenSharpen.x));

    // The value range. A power about a fixed pivot, so the pivot does not move, the cloud undersides go
    // down and the cloud tops go up. This is what a gain cannot do — see SCREEN_CONTRAST — and it runs
    // before the chroma and the tint so both work on the widened range.
    float pivot = max(screenContrast.y, 1.0e-3);
    art = pivot * pow(max(art, vec3(0.0)) / pivot, vec3(screenContrast.x));

    // Chroma next, about the pixel's own luminance, so a cream cloud top keeps its value and
    // only the coral, magenta and cobalt gain. Before the gain, so what clips is the saturated
    // colour and not a washed one.
    float luma = dot(art, vec3(0.2126, 0.7152, 0.0722));
    art = max(vec3(0.0), mix(vec3(luma), art, screenSaturation));

    // The split tone. Each side has two tints, one for what sits under the pivot and one for what sits
    // over it, and the crossfade is the pixel's own luminance. A single tint per side cannot put coral
    // clouds on a violet sky, because the art's sky and its clouds need the hue rotated in opposite
    // directions; see SCREEN_SIDE_TINT_LEFT.
    float toneT = smoothstep(toneSplit.x, toneSplit.y, dot(art, vec3(0.2126, 0.7152, 0.0722)));
    vec3 sideTint = mix(
        mix(sideTintLeft, sideTintRight, side),
        mix(sideHighLeft, sideHighRight, side),
        toneT);

    // The picture, once. `emissive` carries the strength the glTF declares and `screenGain` the
    // look-dev level; nothing multiplies the texture by itself.
    vec3 col = art * emissive.rgb * screenGain * sideTint;

    // The chroma of the *graded* colour, about its own luminance, as pre-compensation for Filmic's
    // per-channel shoulder. See SCREEN_TONE_CHROMA for why this is not the same operator as
    // SCREEN_SATURATION run twice.
    float gradedLuma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = max(vec3(0.0), mix(vec3(gradedLuma), col, toneChroma));

    // A fraction of the rig, so `Beam_R`'s violet pool still lands in the upper right of the
    // screen_left crop. `litFraction` is well under 1, which is what stops this becoming a
    // second copy of the art.
    col += litFraction * calculate_lighting(
        cameraPosition, art * albedo.rgb, pos, normal, metallic, roughness, 1.0);

    outColor.rgb = tone_mapping(col);
    outColor.rgb = color_mapping(outColor.rgb);
    outColor.a = 1.0;
}
"#;

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
            // Its own id: the source is no longer `PhysicalMaterial`'s, so sharing that cache
            // entry would hand this material the wrong compiled program.
            Art::Texture(_) => EffectMaterialId(SCREEN_MATERIAL_ID),
            Art::Sky { .. } => EffectMaterialId(SKY_MATERIAL_ID),
        }
    }

    fn fragment_shader_source(&self, lights: &[&dyn Light]) -> String {
        match &self.art {
            Art::Texture(_) => SkyMaterial::texture_fragment_shader(lights),
            Art::Sky { .. } => SkyMaterial::sky_fragment_shader(),
        }
    }

    fn use_uniforms(&self, program: &Program, viewer: &dyn Viewer, lights: &[&dyn Light]) {
        match &self.art {
            Art::Texture(inner) => {
                // Sent by hand rather than by delegating to `inner.use_uniforms`, because that
                // would bind the albedo texture and the sampler set this shader does not
                // declare, and `use_uniform` panics on a uniform the shader has not got.
                viewer.tone_mapping().use_uniforms(program);
                viewer.color_mapping().use_uniforms(program);
                // `LightingModel::Blinn` is 2 in `light_shared.frag`'s own numbering and is what
                // `PhysicalMaterial::default` uses, so the wall's small lit term is shaded the
                // same way as the rest of the scene.
                program.use_uniform_if_required("lightingModel", 2u32);
                program.use_uniform("cameraPosition", viewer.position());
                for (i, light) in lights.iter().enumerate() {
                    light.use_uniforms(program, i as u32);
                }
                let texture = inner
                    .emissive_texture
                    .as_ref()
                    .or(inner.albedo_texture.as_ref())
                    .expect("Art::Texture is only chosen when the GLB carried a texture");
                program.use_uniform("emissiveTexTransform", texture.transformation);
                program.use_texture("emissiveTexture", texture);
                program.use_uniform("albedo", inner.albedo.to_linear_srgb());
                program.use_uniform("metallic", inner.metallic);
                program.use_uniform("roughness", inner.roughness);
                // The strength `KHR_materials_emissive_strength` declares, which neither
                // `three-d-asset` nor `Srgba` can carry. The shader multiplies the texture by it.
                let s = self.emissive_strength;
                program.use_uniform("emissive", vec4(s, s, s, 1.0));
                program.use_uniform("screenGain", SCREEN_EMISSION_GAIN);
                program.use_uniform("litFraction", SCREEN_LIT_FRACTION);
                program.use_uniform(
                    "uvWindow",
                    vec2(SCREEN_UV_WINDOW.0, SCREEN_UV_WINDOW.1),
                );
                program.use_uniform("screenSaturation", SCREEN_SATURATION);
                program.use_uniform("sideTintLeft", Vec3::from(SCREEN_SIDE_TINT_LEFT));
                program.use_uniform("sideTintRight", Vec3::from(SCREEN_SIDE_TINT_RIGHT));
                program.use_uniform("sideHighLeft", Vec3::from(SCREEN_SIDE_HIGH_LEFT));
                program.use_uniform("sideHighRight", Vec3::from(SCREEN_SIDE_HIGH_RIGHT));
                program.use_uniform("toneSplit", vec2(SCREEN_TONE_SPLIT.0, SCREEN_TONE_SPLIT.1));
                program.use_uniform(
                    "screenContrast",
                    vec2(SCREEN_CONTRAST.0, SCREEN_CONTRAST.1),
                );
                program.use_uniform("starKill", SCREEN_STAR_KILL);
                program.use_uniform("sideBlend", SCREEN_SIDE_BLEND_M.max(1.0e-3));
                program.use_uniform(
                    "sideVShift",
                    vec2(SCREEN_SIDE_V_SHIFT.0, SCREEN_SIDE_V_SHIFT.1),
                );
                program.use_uniform(
                    "screenSharpen",
                    vec2(SCREEN_SHARPEN.0, SCREEN_SHARPEN.1),
                );
                program.use_uniform("screenPosterise", SCREEN_POSTERISE);
                program.use_uniform("toneChroma", SCREEN_TONE_CHROMA);
                // One texel of the source, for the unsharp mask's four taps. `Texture2DRef` carries
                // the texture it wraps, so the size is known without a second lookup.
                program.use_uniform(
                    "emissiveTexel",
                    vec2(
                        1.0 / texture.texture.width().max(1) as f32,
                        1.0 / texture.texture.height().max(1) as f32,
                    ),
                );
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
        // `MAT_LED_Screen` has alpha 1.0 and `alpha_mode` OPAQUE in `assets/scene.json`, so
        // both paths are opaque and neither joins the transparency sort.
        MaterialType::Opaque
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
    pub fn new(context: &Context, part: &Part, base: [f32; 3]) -> crate::Result<Self> {
        let imported = &part.object.material.inner;
        let has_texture = imported.albedo_texture.is_some() || imported.emissive_texture.is_some();
        let material = if FORCE_PROCEDURAL_SKY || !has_texture {
            SkyMaterial::procedural(WallFrame::of(part.object.aabb()), base)
        } else {
            SkyMaterial::textured(imported.clone())
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

    /// The strength both paths emit at is the one the scene declares, not a number picked
    /// here. `assets/wheel_stage.glb` carries the same 1.5 in
    /// `KHR_materials_emissive_strength`.
    #[test]
    fn emissive_strength_matches_the_manifest() {
        let manifest = manifest();
        let spec = manifest
            .material(SCREEN_MATERIAL)
            .expect("MAT_LED_Screen in assets/scene.json");
        assert_eq!(spec.emission_strength, EMISSIVE_STRENGTH);
        assert!(spec.emits());
        // Opaque, so `material_type` is right to be unconditional.
        assert!(!spec.is_blend());
        assert_eq!(spec.alpha, 1.0);
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
        let base = manifest.material(SCREEN_MATERIAL).unwrap().base_color;
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

    /// The emission-only wall shader has to declare every uniform its `use_uniforms` sends, or
    /// `Program::use_uniform` panics at the first frame — and it has to *use* each one, or the
    /// compiler drops it and the panic happens anyway.
    #[test]
    fn the_screen_shader_declares_and_uses_what_it_is_sent() {
        for name in [
            "emissiveTexture",
            "emissiveTexTransform",
            "albedo",
            "emissive",
            "metallic",
            "roughness",
            "cameraPosition",
            "screenGain",
            "litFraction",
            "uvWindow",
            "screenSaturation",
            "sideTintLeft",
            "sideTintRight",
            "sideBlend",
            "sideVShift",
            "screenSharpen",
            "screenPosterise",
            "emissiveTexel",
        ] {
            assert!(
                SCREEN_FRAGMENT.contains(name),
                "{name} is sent but not declared"
            );
            // Once for the declaration and at least once in `main`.
            assert!(
                SCREEN_FRAGMENT.matches(name).count() >= 2,
                "{name} is declared but never used, so the compiler will drop it"
            );
        }
        assert!(SCREEN_MATERIAL_ID <= 0x4FFF);
        assert_ne!(SCREEN_MATERIAL_ID, SKY_MATERIAL_ID);
        // Emission only means the lit term is a fraction, not a full copy of the picture.
        assert!(SCREEN_LIT_FRACTION < 0.5);
        assert!(SCREEN_EMISSION_GAIN > 0.0);
    }
}
