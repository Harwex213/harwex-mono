//! Bloom, tone mapping, vignette and the additive beam cones.
//!
//! Owner: agent I.
//!
//! # The chain
//!
//! [`PostFx::render`] draws one frame end to end and is what `src/main.rs` and
//! `src/shot.rs` call. In order:
//!
//! 1. The scene, plus the beam cones, into a floating-point intermediate target
//!    (`Texture2D::new_empty::<[f16; 4]>`). An RGBA8 target clamps at 1.0 and throws away
//!    every bit of headroom the bloom needs, and this scene deliberately pushes emission
//!    above 1.0 (`MAT_Lens_Glow` is 6.0 in Blender, see `src/scene.rs`).
//! 2. The floor reflection, which reads that target plus its depth and writes a second
//!    full-resolution target. Everything after this reads the reflected frame.
//! 3. Bright pass with a soft knee, at 1/[`BLOOM_DOWNSAMPLE`] resolution.
//! 4. Four separable Gaussian blur passes, two sigmas, ping-ponging between two half-res
//!    targets. Two sigmas because the reference has *wide soft halos* around the rim bulbs
//!    and the lens glows, not a thin fringe (`docs/look_target.md`, regions 2, 3 and 5),
//!    and one narrow blur cannot produce a 30 px halo without going to a mip chain.
//! 5. Composite: exposure, additive bloom, shadow toe, vignette, tone map, sRGB encode, into
//!    `target`.
//!
//! [`PostFx::apply`] is step 3 to 5 alone, over any colour texture the caller has already
//! rendered; the reflection needs the scene depth and so runs only inside [`PostFx::render`].
//! [`PostFx::beams`] hands the cone geometry to whoever wants to draw it in their own main
//! pass instead; see [`Stages::beams`] before using it.
//!
//! The five stages the chain has are the five [`Stages`] fields. Bloom, the additive beam
//! cones, the floor reflection, the vignette and the tone map are the whole effect set this
//! module is sanctioned to have (`docs/agent_plan.md`, "Cleanup pass"). The anamorphic streak,
//! the crest spike and the sparkle-dust layers that look-dev added are gone: none of them is
//! in `wheel_stage.blend`, and the sparkle layer gated itself to a screen-space y band, which
//! is a per-region hack by construction. Nothing that stayed was retuned to compensate.
//!
//! The tone/colour-mapping rule: every intermediate pass runs with
//! `camera.disable_tone_and_color_mapping()`, and the tone curve and the sRGB encode happen
//! exactly once, in the composite pass. `PhysicalMaterial`'s own shader calls
//! `tone_mapping()` and `color_mapping()`, so leaving them on for the pass into the HDR
//! target would tone-map twice and clamp the headroom at 1.0 before the bloom ever sees it.
//!
//! # Why the beam cones are hand-authored geometry
//!
//! `docs/agent_plan.md` invariant 2 says no mesh is modelled in Rust. A beam cone is the one
//! documented exception, because it is not scene modelling: it is a light effect, the volume
//! of haze a fixture lights up. `wheel_stage.blend` has no such geometry to export — the
//! reference image's ten visible cones are painted, not rendered (`docs/look_target.md`,
//! "The reference is a painting"). Everything that positions a cone still comes out of the
//! scene: the two spot cones are built from `Beam_L` and `Beam_R` in `assets/scene.json`
//! (position, aim and `cone_outer_half_angle_rad`), and the twelve truss cones are built
//! from the world transforms of `MH_01_Lens` .. `MH_12_Lens` in the GLB. Nothing is placed
//! by hand; only the cone's triangles, its colour grade and its aim are authored here.
//!
//! The aim is the one real deviation and it is deliberate: the author points all twelve moving
//! heads outward into the wall, which is 0.5 m away, so their cones are invisible. See
//! [`BEAM_AIM_INWARD`] and [`BEAM_HEAD_LEAN_SCALE`], which both switch back off.
//!
//! # Custom shader IDs
//!
//! Custom `Effect` and `Material` implementations must pick an id in `0x0000..=0x4FFF`;
//! everything the crate itself uses is `>= 0x5000`. Ours are the `*_SHADER_ID` constants.

use crate::manifest::Manifest;
use crate::scene::Stage;
use three_d::*;
use three_d_asset::Scene as CpuScene;

// ===========================================================================================
// LOOK-DEV TUNABLES — this block is the whole tuning surface of this file.
//
// Every strength, radius, falloff and tint the look is judged on is here. Nothing below this
// block hides a magic number. Judge each change on the crops in `renders/crops_*` against
// `renders/ref_crops`, per `docs/agent_plan.md` invariant 4: never on a histogram.
// ===========================================================================================

/// Tone curve applied in the composite pass.
///
/// Blender rendered this scene with view transform Filmic at exposure 0
/// (`assets/scene.json`, `render.view_transform`). three-d's [`ToneMapping::Filmic`] is the
/// Hable "Uncharted 2" curve with white point 11.2. It is not Blender's Filmic log encode,
/// but it is the same family and it is the right choice here for one measurable reason: its
/// shoulder is per channel and gentle, so a saturated pink or cyan rolls off keeping its hue,
/// whereas [`ToneMapping::Aces`] pulls hot saturated colour towards white. The reference's
/// sector pinks and screen cyans stay saturated right up to their clip
/// (`docs/look_target.md`, "Colour grade": "Highlights clip, and they clip warm").
pub const TONE_MAPPING: ToneMapping = ToneMapping::Filmic;

/// Linear multiplier on the scene colour before the tone curve. Blender's exposure is 0,
/// which is a factor of 1.0, so this starts neutral.
pub const EXPOSURE: f32 = 1.0;

/// Multiplier on `assets/scene.json`'s `render.world_background` when clearing the frame.
/// The background is a plain Background node, linear `(0.01, 0.008, 0.02)`, which is the
/// plum-tinted near-black the reference keeps in its ceiling void.
pub const BACKGROUND_GAIN: f32 = 1.0;

/// Luminance above which a pixel contributes to the bloom, in linear units.
///
/// 1.20, and it is a real ceiling now rather than an artefact of a clamped uniform.
/// `PhysicalMaterial::emissive` is four `u8`s, so every glowing material used to arrive clamped
/// at exactly 1.0 and a threshold under that clamp bloomed the whole LED wall into mush. Round 1
/// closed that gap — `src/scene.rs`'s [`crate::scene::StageMaterial`] writes the real linear
/// emission over the clamped uniform, so the manifest's own numbers reach the frame:
/// `MAT_Bulb_Glass` at `(3.0, 2.79, 2.22)`, `MAT_Lens_Glow` at `(6.0, 5.7, 4.92)` and `MAT_Crystal`
/// at its alpha-compensated `(1.85, 1.31, 2.07)` (`assets/scene.json`, via
/// `MaterialSpec::emitted_radiance`). `src/screen.rs` drives `Wall_Screen` from the author's own
/// `T_LEDWall_Sky` texture at emissive strength 1.5, lit by the same shader as every other
/// material rather than as a flat emission gain.
///
/// So at 1.20 the things that bloom are the things the reference blooms: the bulb dashes, the
/// crest, the lens cores, the gold speculars, the podium's hot desk band and the wall's cloud
/// tops. Everything the frame is *made* of sits below it. Round 1's verdict was that nothing
/// glowed at all — "every hot feature the reference blooms has a hard edge and nothing around
/// it" — and this is half of the fix; [`BLOOM_STRENGTH`] and [`BLOOM_BLUR_SPREADS`] are the rest.
pub const BLOOM_THRESHOLD: f32 = 1.20;

/// Width of the soft knee under [`BLOOM_THRESHOLD`], in the same linear units. A hard
/// threshold makes the halo boundary crawl as the wheel turns.
pub const BLOOM_KNEE: f32 = 0.35;

/// How much of the *tight* blur round is added back in the composite.
///
/// This is the halo width the reference gives the bulb dashes (4 to 8 px), the peg speculars (1
/// to 2 px) and the podium's desk band (8 to 15 px) — the tightest of its three glow widths, and
/// the one most of the frame's hot features have.
pub const BLOOM_STRENGTH: f32 = 0.38;

/// How much of the *wide* blur round is added back.
///
/// Well under [`BLOOM_STRENGTH`], and that ratio is the point. The reference has exactly three
/// glow widths and they are not equal in weight: the crest carries "the widest glow in the frame,
/// a soft magenta halo about 25 to 40 px in radius", the gold band on the base plate spreads "20
/// to 35 px vertically", and everything else is tight. A wide wing at full strength turns the
/// bulb channel into one continuous blown band and buries the rim's concentric gold bands under
/// it, which is what the first two attempts of this round did.
///
/// Round 1 could not set this ratio at all, and that is a bug this round fixed rather than a
/// value it tuned: the two blur rounds ran in series into the same target, so the second round
/// blurred the first round's output and the composite only ever saw the wide result. There was no
/// tight halo anywhere in the frame. The rounds now end in separate targets.
///
/// Round 2 took it from 0.30 to 0.09 and the sentence above is why: the failure mode it warns about
/// is the one the round was judged on. "The bulb ring has fused ... The render has one continuous
/// glowing gold tube about 14 px thick with a wide soft halo above it, plus a second broad halo
/// ringing the whole wheel. The rim's band-and-groove structure is gone entirely." The 96 bulbs sit
/// 20 px apart on screen, so any wing wider than about 10 px joins them whatever its weight; what
/// the weight controls is whether the joined wing is visible, and at 0.09 it is not. The same tap
/// is what "ate" the crest — "a soft pale-pink mushroom: no facets, no readable silhouette" — and
/// what put a halo round the whole wheel at a radius nothing in the reference glows at.
///
/// Round 3 took it from 0.09 to 0.032, together with the wide sigma below, and the round-3 verdict
/// is the paragraph above one step further on: "The rim reads as two thin bright gold lines with one
/// continuous glowing strip between them, about 20 px tall, wrapped in a broad warm halo that washes
/// roughly 40 px up into the sector fan and out into the void as a brown haze." Two separate things
/// were wrong with the wing and only one of them was its weight. At sigma 5.0 half-res texels the
/// wing reached 60 frame pixels, which is three times the bulbs' 20 px pitch, so the ring merged into
/// a tube *and* the merged tube's own wing was still 40 px wide when it arrived at the sectors. The
/// sigma is what fixes the merge and the weight is what fixes the veil, so both moved.
///
/// The brown haze in the top corners was the same term: a warm wing 60 px wide off a ring of 96
/// bulbs adds a low warm floor over a very large area, and `BLOOM_TINT` is near-neutral, so what it
/// laid over the void was neutral-warm rather than the reference's plum-violet. The toe
/// ([`SHADOW_LIFT`]) can only tint what is left after this term, which is why the two had to be
/// changed in that order.
pub const BLOOM_WIDE_STRENGTH: f32 = 0.055;

/// Tint applied to the bloom. Slightly warm and slightly magenta, because the reference's
/// hot cores read pale lemon and pale pink rather than neutral white.
pub const BLOOM_TINT: [f32; 3] = [1.0, 0.95, 0.98];

/// The bright pass and the blurs run at `1 / BLOOM_DOWNSAMPLE` of the frame size. 2 keeps
/// the bulb dashes' small 4 to 8 px halos readable while making the wide halos cheap.
pub const BLOOM_DOWNSAMPLE: u32 = 2;

/// Gaussian sigma of the two blur rounds, in half-res texels. The pair is what produces two halo
/// widths at once: the tight core halo from the first round and the 25 to 40 px wing the crest
/// crystal and the podium's gold band need from the second.
///
/// A Gaussian is down to a fortieth at 3 sigma, so a sigma of `s` half-res texels reads as a halo
/// about `6 * s` frame pixels across. `[1.8, 5.0]` is therefore an 11 px halo for the bulb dashes
/// and the podium's band and a 30 px one for the crest, which are the reference's measured widths.
///
/// **This used to be a tap *spacing*, and that is what drew round 2's worst artefact.** The kernel
/// was 9 taps reaching 4 out, so a spread of 5.0 put its samples 40 frame pixels apart. The bulb
/// dashes sit 20 px apart on the rim, so each tap produced its own displaced copy of the whole bulb
/// ring: the "second broad halo ringing the whole wheel" round 2 objected to was a tap ghost at
/// ±40 px, and beside it lay six more at multiples of that, reading as radial dashes fanning out of
/// the rim. [`BLUR_TAPS_HALF`] is the fix — the kernel now samples every texel — and the constant's
/// meaning changed with it.
///
/// Round 3 took the pair to `[1.1, 3.2]`. The wide sigma is the constant that decides whether the
/// 96 bulbs stay 96 bulbs: they sit 20 px apart on the rim, and a Gaussian of sigma `s` half-res
/// texels is still at a fifth of its peak `2s` half-res texels out, i.e. `4s` frame pixels. At 5.0
/// that is 20 px — exactly the pitch, so every bulb's wing reached its neighbour's core and the
/// channel fused into one strip. At 3.2 it reaches 13 px, so a bulb's wing has died before the next
/// bulb and the dark groove between them survives to the frame. The tight sigma came down with it,
/// from 1.3 to 1.1, which is a 7 px halo: `docs/look_target.md` gives the bulb dashes 4 to 8 px.
/// Round 5 took the tight sigma from 1.1 to 1.9 half-res texels, i.e. from about 4 to about 8 frame
/// pixels of visible halo. `docs/look_target.md` region 5 gives every moving-head lens "a blown core,
/// then a halo about one and a half to two lens diameters wide", and a lens is 14 to 20 px across, so
/// the halo is 20 to 40 px. The round-5 verdict: "The lens cores are small white capsules with a tight
/// halo; the reference cores are round blown discs inside a halo one and a half to two diameters wide."
/// The wide sigma is 5.5, which is the wheel's wing and a further step past round 3's 3.2 that this
/// history does not otherwise record; at 5.5 half-res texels the wing is about 33 frame pixels, inside
/// the 25 to 40 px [`BLOOM_WIDE_STRENGTH`] gives the crest's own halo.
pub const BLOOM_BLUR_SPREADS: [f32; 2] = [1.9, 5.5];

/// Taps either side of centre in one separable blur pass. The kernel is
/// `2 * BLUR_TAPS_HALF + 1` taps at one half-res texel apiece.
///
/// One texel per tap is the whole point: a Gaussian sampled more coarsely than the features it is
/// blurring produces displaced copies of them instead of a halo, which is what
/// [`BLOOM_BLUR_SPREADS`] describes. 16 taps reach 3.2 sigma at the wider of the two sigmas, where
/// the Gaussian is down to a fiftieth, so nothing is clipped off the tail that would show as a ring
/// at the kernel's edge. Cost is 33 taps over a 836x470 target, four times per frame.
pub const BLUR_TAPS_HALF: i32 = 16;

/// Corner darkening, 0.0 for off and 1.0 for black corners.
///
/// Agent C measured the reference's vignette as "gentle, and asymmetric", with no symmetric
/// radial darkening in the image at all: the dark top corners are the unlit ceiling void and
/// the bottom-right corner is bright violet floor. The instruction is a mild vignette only —
/// enough to hold the far edges of the screen band below each screen's centre and to stop the
/// floor brightening into the bottom corners — and an explicit warning that a strong vignette
/// kills the bright bottom-right floor and is a visible failure (`docs/look_target.md`,
/// "Vignette"). 0.18 at the corner is that: about a fifth of a stop, invisible as an effect.
pub const VIGNETTE_CORNER_STRENGTH: f32 = 0.18;

/// Radius where the darkening starts, in units of half-diagonal. 1.0 is the corner.
pub const VIGNETTE_INNER_RADIUS: f32 = 0.55;

/// Radius where the darkening reaches [`VIGNETTE_CORNER_STRENGTH`].
pub const VIGNETTE_OUTER_RADIUS: f32 = 1.0;

/// Radiance added at a beam cone's core, before the tone curve.
///
/// 1.8, down from 3.0, and the shape of the cone changed more than the number did. Round 1's
/// value was the frame's worst-ranked defect, at severity 5: "Two enormous
/// cream-white washes cover the upper half of the frame ... bright enough to be nearly opaque
/// ... The washes destroy the near-black violet ceiling void in both top corners and desaturate
/// everything they cross." Three of those words matter. *Cream*: at 3.0 the additive integral
/// through the shell clips, and a clipped additive term loses its tint, so a lavender cone and an
/// amber cone both arrive white. *Opaque*: a cone that clips hides what is behind it instead of
/// tinting it. *Desaturate*: a large white additive term over a saturated albedo is the
/// definition of pastel, which is why the sector fan and the pillars could not be judged until
/// this came down.
///
/// The reason it was 3.0 has gone away with it. The note used to be that the LED wall sits behind
/// every cone at a linear 0.8 to 1.0 and a cone the same hue as the wall has no contrast against it;
/// `src/screen.rs` now drives the wall from the author's own texture at emissive strength 1.5, lit
/// by the same shader as every other material rather than as a flat emission gain, and the cones
/// are short enough that they no longer cross it at all.
///
/// Round 3 took it from 1.8 to 1.15, and the *cream* half of the paragraph above is why: "The five
/// cones in top_right read grey-lavender, dull amber and grey-teal against the reference's saturated
/// violet-magenta, amber-gold and cyan-blue." A cone is an additive term over a near-black void, so
/// its own tint is the only colour it can have, and a tint whose brightest channel has run into
/// Filmic's shoulder arrives with its other channels pulled up toward it. 1.15 keeps the brightest
/// channel of each cone off the shoulder over most of the cone's length.
///
/// The value in force is 1.0, a further step down that this history does not otherwise record;
/// nothing below re-tunes anything to make up the difference.
pub const BEAM_STRENGTH: f32 = 1.0;

/// What a truss moving-head cone multiplies [`BEAM_STRENGTH`] by.
///
/// Round 2's regression was that the twelve head cones went from oversized washes to nothing at
/// all: "The truss crop shows blown white lens dots on a black starfield with nothing descending
/// from them. The upper half of the frame is empty black where the reference's cones are what make
/// it read as a lit stage." One number cannot serve both kinds — the two SPOT cones sit 5 m from
/// the camera and fill hundreds of pixels each, the head cones sit 12 to 15 m away and are 0.9 m
/// across — so the strength is split. 2.1 is what makes a head cone read against the void at that
/// distance; [`BEAM_SPOT_STRENGTH_SCALE`] takes the two spots down at the same time, which is
/// the other half of round 2's cone complaint.
/// Round 3 took it from 2.1 to 1.75, so a head cone lands at 2.0 rather than 3.8. See
/// [`BEAM_STRENGTH`]: at 3.8 a head cone's brightest channel was well past Filmic's shoulder over
/// its whole first third, which is the part of the cone `docs/look_target.md` describes as the
/// brightest and the part the verdict found desaturated.
/// Round 5 took it from 1.55 to 1.28, which is the cut the verdict asked for: "Per-cone strength still
/// carries the visibility, so the tint has no chroma left at the bright end ... the amber ones read pale
/// khaki at their brightest third." An additive cone is summed through its own shell twice and then
/// tone-mapped, so at 1.55 the amber tint's red and green both cleared Filmic's shoulder over the cone's
/// first third and arrived together, which is a khaki. The loss went into the tint tables of the
/// time; those are gone now, and a cone's colour comes straight off its own fixture in
/// `assets/scene.json` instead (see [`beam_specs`]). Measured down to
/// 1.05 first and back up: at 1.05 with [`BEAM_EDGE_SOFTNESS`] raised at the same time, the cones lost so
/// much body that `docs/look_target.md`'s "each cone still reads as a cone with a discernible boundary"
/// stopped holding.
pub const BEAM_HEAD_STRENGTH_SCALE: f32 = 1.28;

/// What a `Beam_L` / `Beam_R` cone multiplies [`BEAM_STRENGTH`] by.
///
/// Under 1.0. `docs/look_target.md` gives the frame about ten cones of roughly equal weight, all
/// from moving heads under the truss; the two Blender SPOTs are not among them, and at full
/// strength they are the two biggest things in the upper half of the frame. 0.5 leaves each as a
/// faint wedge near its own fixture rather than a translucent veil across the wall.
pub const BEAM_SPOT_STRENGTH_SCALE: f32 = 0.5;

/// How far a `Beam_L` / `Beam_R` cone reaches, in metres.
///
/// 2.5. At 8.0 a spot apex 13 m from the camera put about 640 px of cone on screen with a hard
/// curved rim where its base circle turned away. The reference's cones are "brightest over the
/// first third and gone before the floor", 55 to 75 px wide after 180 px of travel, and none of
/// them reaches the fascia. 2.5 m from an apex at y 7.2 ends the cone around y 5.3, high in the
/// frame, and the half-angle is untouched: round 1 checked it and found it right.
/// Round 2 took it from 2.5 to 1.5, together with [`BEAM_SPOT_LENGTH_FALLOFF`]. The verdict was
/// that "the two SPOT cones still reach the floor, and now that they are dim they read as a flat
/// translucent grey veil with hard straight edges rather than as light", against a target that is
/// explicit that no cone lands a pool of light on the floor and only the two in the upper right
/// brush the fascia. 1.5 m from an apex at y 7.2 ends the cone at y 6.0, above the top of the LED
/// wall at 6.35 and nowhere near the floor.
pub const BEAM_SPOT_LENGTH: f32 = 1.5;

/// Exponent of the length fade for the two SPOT cones only, replacing [`BEAM_LENGTH_FALLOFF`].
///
/// Higher than the heads', because a spot cone is the one cone in the frame whose base circle is
/// large enough on screen for its silhouette to read: `docs/look_target.md` has no cone edge that
/// is a straight line across a wall, and at 2.0 the base circle terminated rather than faded. At
/// 3.5 the cone is down to a twentieth of its core radiance over the last third of its length, so
/// there is nothing left at the base to have an edge.
pub const BEAM_SPOT_LENGTH_FALLOFF: f32 = 3.5;

/// How far a truss moving-head cone reaches, in metres. The lenses hang at y 6.34 and lean about
/// 27° off vertical, so 2.2 m ends the cone around y 4.4 — well above the floor and short of the
/// wall, which is where the reference's cones stop.
/// Round 2 took it from 2.2 to 4.2. See [`BEAM_AIM_INWARD`], which had to flip with it: at 2.2 m
/// aimed *outward* from a lens 10.3 m from the room's axis, a cone reached 11.2 m and was buried
/// in the LED wall at 11.3 m, so the depth test cut off whatever the frame would have shown of it.
/// The heads the hero camera actually sees are the ones on the far side of the ring, and those aim
/// straight into the nearest metre of wall. Aimed inward instead, 4.2 m at 23° to 31° off vertical
/// drops a cone 3.8 m — from the lens at y 6.34 down to y 2.5, which is over 350 px on screen at
/// that distance through a 22 mm lens and still well above the floor.
pub const BEAM_HEAD_LENGTH: f32 = 4.2;

/// Exponent of the radial falloff across the cone, from core to edge. Higher is a tighter core
/// and a wider soft edge. The reference's cones read as cones with a discernible boundary rather
/// than diffuse smudges, so this stays low; above about 2.5 only a thin line down each cone
/// survives.
/// Round 5 took it from 1.6 to 2.0. The verdict: "The cones read as flat translucent triangles with
/// straight hard side edges and an even fill", against a reference whose cones are "soft-edged, clearly
/// brightest over their first third". This is the exponent on the across-the-cone term, so raising it
/// pushes the radiance toward the axis and away from the silhouette - a soft edge and a bright middle
/// are the same change. Measured down from 2.6, which narrowed the cone's readable width past the 55 to
/// 75 px `docs/look_target.md` gives it after 180 px of travel.
pub const BEAM_EDGE_SOFTNESS: f32 = 2.0;

/// Exponent of the fade along the cone's length. The reference's cones are brightest over
/// their first third and fade to nothing well before the floor.
///
/// 2.0. It went up to 3.5 first, on the reasoning that a shorter cone should also fade harder,
/// and that was wrong on the crop: at 3.5 a cone is down to a tenth of its core radiance a third
/// of the way along, so all that is left on screen is a short glow at the lens and there is no
/// cone at all. `docs/look_target.md` wants the cone visible over its whole length and gone by
/// the end of it — "brightest over their first third and fade to nothing well before the floor" —
/// and at 2.0 over a 2.2 m cone that is what it does. [`BEAM_SPOT_LENGTH`] is what keeps a cone
/// off the fascia now, not this.
/// Round 5 took it from 2.3 to 3.2, so a head cone is down to a tenth of its core radiance by half its
/// length. `docs/look_target.md`: "Cones are brightest over their first third and fade to nothing well
/// before the floor ... Only the two in the upper right brush the fascia."
pub const BEAM_LENGTH_FALLOFF: f32 = 3.2;

/// Fraction of the cone length over which the beam ramps up out of the lens, so the apex is
/// not a hard bright disc sitting on the fixture. The lens's own halo comes from the bloom.
pub const BEAM_APEX_FADE: f32 = 0.06;

/// Whether a truss cone is swung round to point at the stage instead of where its fixture
/// actually looks. Measured twice, and the answer flipped in round 1; this is the one place the
/// beams leave the scene data.
///
/// **`false`, and the reason is that the camera sits inside the truss ring.** Aiming the cones at
/// `wheel.pivot` points the ones on the far side of the ring straight at the lens, and a cone seen
/// end-on has almost no cone in it: the shell's normal faces the viewer only in a thin ring at the
/// silhouette, so what reaches the frame is a small smudge at the fixture. Rendered at 25x the
/// shipping strength, exactly two of the fourteen cones read, both of them side fixtures whose
/// bearing happened to be across the view. That is why round 1 was judged to have "broad
/// overlapping cone haze rather than discrete cones".
///
/// So each cone keeps the *bearing* its fixture has — outward, as the author aimed it — and only
/// its lean off vertical is scaled, by [`BEAM_HEAD_LEAN_SCALE`]. That is also what the reference
/// describes: "All cones point downward. The ones nearer the frame edges lean outward as well,
/// roughly 20 to 35 degrees off vertical." Seen from a camera inside the ring, a cone leaning
/// outward and down is side-on and reads as a cone.
///
/// The reason this was `true` before was the wall: `MH_01_Lens` sits 10.04 m out, the LED wall is
/// at 11.3 m, and at the old [`BEAM_HEAD_LENGTH`] of 5 m an outward cone was buried in it. At
/// 2.2 m and 27° a cone travels 1.0 m outward, ending at 11.0 m — inside the wall with 0.3 m to
/// spare. Shortening the cones is what made the author's own aim usable.
/// **Round 2 flipped it back to `true`, because the shader argument above is stale.** The failure
/// it describes — "a cone seen end-on has almost no cone in it: the shell's normal faces the viewer
/// only in a thin ring at the silhouette" — is the `|dot(normal, toEye)|` radial term, and
/// [`BeamMaterial::fragment_shader_source`] does not use that term any more. It uses the sight
/// ray's miss distance from the cone axis over the cone's radius there, and its own doc note says
/// in as many words: "This term does not care which way a cone points." The 25x test that decided
/// `false` was run before that change and does not survive it.
///
/// What decides it now is the wall. The heads this camera sees are the far-side ones, and the
/// author aimed every head radially outward, so an outward cone from a lens 10.3 m out has 1.0 m of
/// room before the cyclorama at 11.3 m. Aimed inward the same cone has 10 m of open arena, and its
/// lean of 23° to 31° off vertical means nine tenths of its travel is downward — fully across the
/// view, not along it — so it reads as a shaft descending from its lens. That is also the direction
/// the reference draws: its top-right amber cone descends to the *left*, and its top-left violet
/// cones descend to the right. Both converge on the stage.
pub const BEAM_AIM_INWARD: bool = true;

/// Fraction of a truss fixture's own lean off vertical that its cone keeps.
///
/// The ring's heads alternate 38° and 52° off vertical. Agent C measured the reference's cones
/// at 20 to 35 degrees off vertical, so 0.6 maps the pair onto 23° and 31° — inside the measured
/// band, and still two different angles rather than one. It matters for more than the angle: a
/// cone leaning 52° from a fixture 10 m out reaches 1.7 m outward over its 2.2 m and pokes
/// through the LED wall, where the depth test cuts it off mid-shaft.
pub const BEAM_HEAD_LEAN_SCALE: f32 = 0.6;

/// Half-angle used for the truss cones when `assets/scene.json` carries no spot light to
/// take one from. 0.16 rad is the 9° half-angle agent C measured off the reference: a cone
/// 15 to 20 px wide at the lens widening to 55 to 75 px after 180 px.
pub const BEAM_HEAD_HALF_ANGLE_FALLBACK: f32 = 0.16;

/// Radial segments per cone. 28 is smooth at the reference resolution; the silhouette is
/// where the radial falloff has already reached zero, so it is never a hard edge.
pub const BEAM_CONE_SEGMENTS: u32 = 28;

// ---------------------------------------------------------------------------------------
// The PAR cans on the inner truss ring. New in round 2, and the reason is arithmetic rather
// than taste.
//
// Round 2's severity-5 defect 3 asks for the reference's five cones in the top-right corner
// alone. Projecting all fourteen fixtures the module knew about through `Cam_Hero` says the
// frame cannot hold them: `MH_07` to `MH_12` hang behind the camera, `MH_01` and `MH_06` land
// 106 px outside the left and right edges, and `MH_03` and `MH_04` sit at frame (989, 441) and
// (683, 441), which is inside the wheel disc and therefore behind it. Exactly two moving-head
// cones can ever reach this frame — `MH_02` and `MH_05` — and rendering the cones at 25x their
// shipping strength confirmed it: two cones, no more.
//
// The lamps the frame actually shows along the two truss arcs are the PAR cans, and they had no
// cones. `Truss_Par_Lens` is one baked mesh of 24 islands on a ring of radius 5.96 m at y 7.59,
// so there is no node transform per can to read; the apexes are measured out of the mesh by
// clustering its vertices, which is the same "measure it, do not guess it" the rest of this file
// does with `MH_nn_Lens`. Six to eight of the 24 are in frame and above the wheel, which is where
// `docs/look_target.md` puts the cones: "All originate at moving-head lenses hanging under the
// truss ring, in an arc across the upper half of the frame between about y 90 and y 300."
// ---------------------------------------------------------------------------------------

/// The node whose mesh holds every PAR can lens. One baked mesh, 24 islands.
pub const PAR_LENS_NODE: &str = "Truss_Par_Lens";

/// How close two of that mesh's vertices have to be to count as the same lamp, in metres.
///
/// The cans sit 1.55 m apart on their ring and each lens is about 0.22 m across, so anything
/// between 0.3 and 0.7 separates them. 0.5 is the middle of that.
pub const PAR_CLUSTER_RADIUS_M: f32 = 0.5;

/// Most lamps [`par_lamp_apexes`] will return. A guard on the clustering, not a measurement: the
/// mesh has 24 islands, and a malformed one must not turn into hundreds of cones.
pub const PAR_LAMP_LIMIT: usize = 48;

/// How far a PAR can's cone reaches, in metres.
///
/// The cans hang at y 7.59 on a ring of radius 5.96 m. 4.6 m at [`PAR_BEAM_LEAN`] drops a cone to
/// y 3.4 and pulls it 1.9 m in toward the axis, ending at radius 4.1 — clear of the wheel's 2.6 m
/// and clear of the cyclorama's 11.3 m, and fading out about 3.4 m above the floor, which is
/// `docs/look_target.md`'s "gone before the floor".
pub const PAR_BEAM_LENGTH: f32 = 4.6;

/// Lean of a PAR can's cone off vertical, in radians. 0.44 rad is 25°.
///
/// The scene cannot supply this one. `Truss_Par_Lens` is baked at identity, so every can's aim
/// reads as exactly straight down and there is no per-can tilt to scale the way
/// [`BEAM_HEAD_LEAN_SCALE`] scales a moving head's. `docs/look_target.md` measures the reference's
/// cones at "roughly 20 to 35 degrees off vertical" and says in its opening section that where the
/// reference and the scene disagree about light, the reference wins. 25° is the low-middle of the
/// measured band, and the bearing is the can's own radial direction turned inward, so no two
/// neighbouring cones come out parallel.
pub const PAR_BEAM_LEAN: f32 = 0.44;

/// What a PAR can's cone multiplies [`BEAM_STRENGTH`] by. Below the moving heads', because the
/// cans are 3 to 5 m nearer the camera and their cones subtend more of the frame each.
pub const PAR_BEAM_STRENGTH_SCALE: f32 = 0.85;

/// Prefix of a PAR can cone's [`BeamSpec::name`], so the kind can be told from the name the way
/// the moving heads' `MH_` prefix already is.
pub const PAR_BEAM_PREFIX: &str = "PAR_";

// ---------------------------------------------------------------------------------------
// The floor reflection. `docs/look_target.md` ranks it second of the five features that make
// the reference read as itself, and round 1 shipped without it: "There is no reflection on the
// floor at all ... nothing in the lower third of the frame carries light."
//
// How it is done, and why not the other way. The reference is explicit that no inverted
// geometry is recognisable in it — "Only a vertical column of gold is visible where the wheel
// is, and vertical magenta streaks where the beam pools are" — so a second mirrored render of
// the whole stage would be paying for detail the target does not have, and it cannot be done
// here anyway: mirroring the view matrix flips every triangle's winding, and `Cull::Back` lives
// in each material's own render states, which this file does not own.
//
// What it does instead is exact for a flat mirror seen from a level camera, which is what this
// is: for a pixel on the floor plane, the mirror image of whatever stands there is the frame
// itself reflected about that object's contact line. So the pass reconstructs each pixel's world
// position from the depth buffer, keeps the ones on the floor plane, walks up the column to find
// the contact line, and samples the colour buffer mirrored about it, blurred vertically and
// faded with distance. The floor's own gold ring inlays are already in the colour buffer at that
// pixel and are added to, never blurred, which is `docs/look_target.md`'s "crisp inlays over a
// blurred reflection is the signature of this region".
// ---------------------------------------------------------------------------------------

/// How much of the mirrored frame is added at the contact line, where the reflection is
/// strongest. `docs/look_target.md`: "Opacity is high at the contact line, where the reflection
/// nearly matches the object's own brightness."
///
/// Round 3 took it from 0.85 to 1.15. The verdict was that "the floor reads as a void the set stands
/// in rather than a lit stage floor", with the reflection column "milky grey-pink where the reference
/// has a warm gold one". "Nearly matches the object's own brightness" is the target and the object
/// here is the wheel's bulb channel, which sits four times further up the column than the contact
/// line thanks to [`REFLECTION_SQUASH`]; the vertical and horizontal blurs then average that hot
/// gold against the dark base plate either side of it, so what the column carries is well under the
/// object's own value however high the blur's peak was. Over 1.0 is what puts it back, and it can be:
/// the term is added to a floor whose own radiance is a fifth of the wheel's, so a strength over
/// unity is still a reflection that is darker than what it reflects.
pub const REFLECTION_STRENGTH: f32 = 1.15;

/// Chroma multiplier on the reflection, taken about the reflection's own luminance and applied
/// before [`REFLECTION_STRENGTH`].
///
/// The round-3 verdict: "Its reflection column is milky grey-pink where the reference has a warm
/// gold one ... The reflection is tinted by the floor albedo rather than carrying the reflected
/// object's own warm hue." The diagnosis is right about the symptom and the cause is arithmetic
/// rather than the floor: this pass averages 369 samples spread over 96 x 14 frame pixels, and an
/// average of a hot gold bulb against the dark violet base plate beside it is a desaturated pink,
/// because averaging two hues always lands between them. Every heavy blur does this and the standard
/// answer is the one used here — put the chroma back about the blurred luminance, so the column's
/// *value* stays what the blur produced and its *hue* returns to the hue of the brightest thing in
/// the kernel. 1.9 is what makes the gold column gold and the beam pools magenta rather than pink.
pub const REFLECTION_SATURATION: f32 = 1.9;

/// Distance below the contact line over which the reflection falls to `1/e`, in frame pixels.
///
/// Measured off the reference by agent C: the wheel's gold column runs about 110 px and is cut
/// off by the frame's bottom edge rather than fading, and the podium's runs 70 to 90 px and does
/// fade out. 95 px sits between the two, which is what a single decay length has to do.
pub const REFLECTION_FADE_PX: f32 = 95.0;

/// How far up the column the pass looks for the contact line, in frame pixels.
///
/// A little over [`REFLECTION_FADE_PX`], because a pixel further below the line than the fade
/// length contributes nothing anyway. It also bounds the cost: this is the loop count of the
/// only pass in the chain that is not a fixed number of taps. Floor well away from any object —
/// the open floor between the podium and the wheel — finds no contact line inside the search and
/// takes no reflection, which is right.
pub const REFLECTION_SEARCH_PX: u32 = 130;

/// Vertical blur half-width of the reflection at the contact line and at the end of the fade, in
/// frame pixels. The reference's reflections are "stretched vertically and heavily blurred", and
/// a blur that grows with depth is what dissolves the shape as it goes down: the gold column
/// stays a column, but nothing in it is recognisable.
/// Round 2 took the pair from `(2.5, 22.0)` toward wider blur. The verdict: "The render gives thin
/// hard-edged coloured lines instead of smears — the reflected bulbs read as a row of discrete
/// dashes, the reflected pillar as a bundle of separate vertical wires". `docs/look_target.md` is
/// absolute about this: "No inverted geometry is recognisable. The wheel's shape cannot be read in
/// its reflection." 22 px of vertical blur cannot dissolve a 20 px bulb pitch, and 2.5 px at the
/// contact line leaves everything there readable. The pair now in force is `(10.0, 48.0)`, a step
/// back down from a wider figure this history does not otherwise record; 10 px at the contact line
/// and 48 px at the end of the fade still dissolve the bulb pitch and the pillar's flutes.
pub const REFLECTION_BLUR_PX: (f32, f32) = (10.0, 48.0);

/// Horizontal blur half-width of the reflection, in frame pixels. Constant with depth, unlike the
/// vertical pair.
///
/// New in round 2, and the verdict asked for it directly: "Raise the vertical blur well past 22 px
/// and the horizontal blur too — the reference lets no inverted geometry be recognisable at all".
/// The old pass blurred vertically only, on the argument that horizontal detail is what keeps the
/// gold column a column. It is, and 10 px does not threaten it: the column is 130 px wide. What
/// 10 px does is join the bulb dashes sideways as well as up and down, so the row of dashes becomes
/// one continuous smear.
pub const REFLECTION_BLUR_H_PX: f32 = 14.0;

/// Number of taps in the reflection's vertical blur. Odd, so one tap sits on the mirrored
/// position itself. Round 2 raised it off too few, on the same reasoning
/// [`REFLECTION_BLUR_PX`] documents: too few taps over a wide blur read as separate lines rather
/// than a smear. 41 is the value in force, a further step this history does not otherwise record.
/// Each tap is also sampled at nine horizontal offsets (see the shader's own
/// `for (int k = -4; k <= 4; k++)`), so this is 369 samples per floor pixel and nothing else in
/// the frame pays for it — see [`REFLECTION_SATURATION`] and [`REFLECTION_JITTER`], which both
/// depend on that count.
pub const REFLECTION_TAPS: u32 = 41;

/// Whether each pixel's reflection taps are offset by a deterministic per-pixel fraction of one
/// tap stride.
///
/// `true`, and it is the round-3 fix for the only part of the frame the verdict called broken rather
/// than merely wrong: "A regular checkerboard stipple covers part of the floor reflection, clearly
/// visible at about frame x 480-600, y 845-940 ... It reads as a rendering artifact, a fixed dither
/// pattern, not as a blurred mirror."
///
/// The arithmetic behind it. The vertical kernel spans `4 * blur` in uv over [`REFLECTION_TAPS`]
/// taps, so at the far end of [`REFLECTION_BLUR_PX`] the stride is `4 * 48 / 40 = 4.8` frame pixels;
/// the nine horizontal taps sit [`REFLECTION_BLUR_H_PX`] `* 0.25 = 3.5` px apart. Every pixel of the
/// floor used the *same* offsets, so all 369 samples landed on one 4.8 x 3.5 lattice and the source
/// pixels between the lattice points were never read by anybody — which is a fixed dither pattern,
/// exactly as the verdict describes it. Raising the tap count cannot fix that, because the artefact
/// is the stride being shared, not the stride being long.
///
/// A per-pixel phase fixes it without more samples: neighbouring pixels then read different source
/// rows, so the lattice averages out over any two pixels and what is left is a little noise instead
/// of a grid. The phase is a hash of `gl_FragCoord`, so it is fixed for a given pixel and `--shot`
/// stays byte-deterministic.
pub const REFLECTION_JITTER: bool = true;

/// Vertical scale of the mirrored image. 1.0 is the true mirror for a level camera; the hero
/// camera tilts up 16°, so the reflection is very slightly compressed in the reference and 1.05
/// stretches it back. Small on purpose: this is the one constant here that has no measurement
/// behind it, only the reference's word "stretched".
/// Round 2 took it from 1.05 to 4.0, which turns a near-true mirror into a compressed one, and that
/// is the change that produces the reference's gold column.
///
/// The arithmetic a true mirror cannot satisfy: `docs/look_target.md` measures the wheel at 825 px
/// tall above the floor and its reflection at 110 px, an eighth of the object. A mirror puts the
/// whole object in the reflection, so at 1.05 the 110 px below the contact line hold only the
/// bottom 110 px of the wheel — the base plate's dark front face — and the verdict was exactly
/// that: "the gold column under the wheel is missing entirely". At 4.0 the same 110 px hold the
/// bottom 440 px, which reaches the rim's lower bulb channel, so what smears down the floor is
/// gold. The reference's own word for its reflections is "stretched vertically", and a reflection
/// that holds four times the object in the same height is what that looks like from a camera this
/// low.
///
/// Round 4 took it back from 4.0 to 1.6, and the 4x pair `renders/d_f9/z_refl_4x.png` against
/// `renders/d_f8/ref_refl_4x.png` is why. At 4.0 a floor pixel 100 px below a contact line reads the
/// frame 400 px above it, and 400 px above the podium is not the podium — it is the LED wall. So the
/// floor to the right of the podium was reflecting the wall's midband, and reflecting it *four times
/// magnified vertically*, which turned the flat colour steps of a posterise pass `src/screen.rs`
/// carried at the time (`SCREEN_POSTERISE`, since removed by the cleanup pass) into six hard
/// hot-magenta horizontal stripes across the floor with visibly stepped edges. That is the round-4
/// verdict's "stepped horizontal bands rather than a smooth vertical smear", and it also explains the
/// grain beside them: the jitter's residual noise is proportional to the contrast the taps average
/// over, and a posterised wall magnified 4x is nothing but contrast.
///
/// The round-2 arithmetic above is still right about the *wheel*, whose reflection is an eighth of its
/// height, and 1.6 does not reach the rim's bulb channel. The paragraph this constant used to justify
/// itself by claimed the floor instead picked up the base plate's own blown gold top edge, lifted there
/// by a `NODE_LIFTS` entry on `Wheel_BasePlate` — that entry is gone, the cleanup pass having found no
/// glTF-transport defect it was restoring, and `Wheel_BasePlate` is a flat dark slab with no lifted
/// highlight left for the reflection to carry. 1.6 therefore has no verified source of gold left to
/// point at; it is the figure the cleanup pass inherited from look-dev, kept because this pass does not
/// retune a surviving constant to compensate for what was removed out from under it.
pub const REFLECTION_SQUASH: f32 = 1.6;

/// World `y` of the floor plane, in metres. `Floor_Disc` spans Blender z −0.14 to 0.00
/// (`docs/scene_audit.md` §1), so its top face is the exported frame's `y = 0`.
pub const FLOOR_PLANE_Y: f32 = 0.0;

/// How far off [`FLOOR_PLANE_Y`] a reconstructed world position may be and still count as floor,
/// in metres. `Floor_Rings` sits 16 mm above the disc and must be included — it is what the
/// crisp gold inlays are — and the lowest thing that must be excluded is the wheel's base plate
/// at 0.14 m, so 0.06 m clears both by a wide margin.
pub const FLOOR_PLANE_TOLERANCE: f32 = 0.06;

/// Linear radiance added to the darkest pixels of the frame, before the tone curve, and the hue it
/// is added in.
///
/// `docs/look_target.md` §"Colour grade": "Blacks are lifted and tinted plum. They are never
/// neutral and never fully crushed. Even the darkest ceiling void keeps a violet tint." Round 1 had
/// the opposite defect, a milky lavender void; round 2 crossed over to "a neutral near-black" and
/// asked for the toe lifted and tinted rather than either. This is that toe: a fixed radiance in
/// plum-violet, weighted to zero as a pixel's own luminance approaches [`SHADOW_LIFT_RANGE`], so
/// nothing above the void is touched.
///
/// 0.016 in this tint is `(0.0088, 0.0038, 0.016)` linear, which sits just above the Blender world
/// background of `(0.01, 0.008, 0.02)` the frame is cleared to, and about a fortieth of the LED
/// wall's midband. The void reads dark violet and stays far below the screen band, which is what
/// the round asked for.
///
/// Round 3 took it from 0.016 to 0.026 and [`SHADOW_LIFT_RANGE`] with it. The verdict was that "the top
/// corners read near-neutral with a brown haze bleeding in from the rim bloom, where the reference keeps
/// a lifted plum-violet". The haze is [`BLOOM_WIDE_STRENGTH`]'s and is dealt with there; what is left for
/// this constant is that at 0.016 the lift was below the haze it was competing with, so the hue that
/// reached the corners was the bloom's and not this one. With the wing cut the corners hold the world
/// background alone, `(0.01, 0.008, 0.02)`, and 0.026 in plum-violet is `(0.0143, 0.0062, 0.026)` — the
/// same order as the background, so the void reads as a violet that is lifted rather than as either a
/// crushed black or a haze.
/// Round 5 took it from 0.026 to 0.044 and [`SHADOW_LIFT_RANGE`] with it: the void's "black is brown
/// rather than plum." The brown is what is left of
/// the wheel's wide bloom wing after round 4 cut it, and it is warm; this term is the only violet in
/// the void, so it has to be the larger of the two for the void to read plum. 0.044 in this tint is
/// `(0.024, 0.011, 0.044)` linear, against the wing's contribution of about 0.02 in warm grey at the
/// top corners.
pub const SHADOW_LIFT: f32 = 0.044;

/// Hue of the toe lift, normalised so its largest channel is 1.0. Plum-violet. See
/// [`SHADOW_LIFT`].
pub const SHADOW_LIFT_TINT: [f32; 3] = [0.55, 0.24, 1.0];

/// Luminance at which the toe lift has faded to nothing, in linear units.
///
/// Small. The lift is for the ceiling void and the deep shadow inside the truss, not for the
/// midtones: a pixel at 0.06 gets none of it, and the gold groove between two rim bands, at about
/// 0.15, is nowhere near it. Raising this is how the round-1 milky haze comes back.
/// Round 3 took it from 0.06 to 0.085, so the lift reaches the deep shadow inside the truss lattice as
/// well as the empty void beside it. The reference's top half is a "near-black violet void" that "still
/// lets the truss read faintly", and a tube's shadow side sits around 0.07 linear — just outside the old
/// range, which is why the void lifted and the truss in it did not.
/// Round 5 took it to 0.115, so the lift still reaches the void once the wheel's bloom wing has put
/// 0.02 of warm grey on top of it: a range that stops at 0.085 leaves the corners the wing lights
/// unlifted, which is the "brown rather than plum" the round-5 verdict found.
pub const SHADOW_LIFT_RANGE: f32 = 0.115;

// `BEAM_TINTS_LEFT` and `BEAM_TINTS_RIGHT` used to sit here: four hand-graded tints per side,
// cycled by fixture index and keyed off which side of the frame centre a cone's apex fell on.
// The cleanup pass removed them (`docs/agent_plan.md` §"Cleanup pass"): keying a cone's hue off
// the sign of `apex.x` is per-side differentiation invented from the reference image, the same
// hack the pass took out of `src/screen.rs`'s per-side sky grade. A cone's colour now comes
// straight off the scene data instead — the manifest's own light for `Beam_L` / `Beam_R`, and
// `MAT_Lens_Glow` for every truss fixture — in [`beam_specs`] and [`par_beam_specs`]. `Beam_L`
// and `Beam_R` carry the identical colour `(0.72, 0.36, 1.0)` in `assets/scene.json`, so the two
// spot cones are now the same hue; that is the trade the author chose in ending look-dev.

// ======================= end of the look-dev tunables =======================

/// Manifest light names that get a cone of their own. Both are Blender SPOTs.
pub const SPOT_BEAM_LIGHTS: [&str; 2] = ["Beam_L", "Beam_R"];

/// How many moving heads hang off the truss ring: `MH_01` .. `MH_12`, four objects each
/// (`Base`, `Yoke`, `Head`, `Lens`). See `docs/scene_audit.md` §6.
pub const MOVING_HEAD_COUNT: u32 = 12;

/// The direction a fixture points, in its own node space, in the *exported* frame.
///
/// Blender lamps and Blender's moving-head bodies both aim down local -Z. The glTF export
/// maps `(x, y, z) -> (x, z, -y)`, so Blender's local -Z is `(0, -1, 0)` here. Checked
/// against the GLB: every `MH_nn_Yoke` gives exactly `(0, -1, 0)` (no tilt yet) and every
/// `MH_nn_Lens` gives a downward, outward-splayed aim, e.g. `MH_01_Lens` at
/// `(9.852, 6.34, -3.14)` aims `(0.593, -0.788, -0.165)`.
pub const FIXTURE_LOCAL_AIM: Vec3 = vec3(0.0, -1.0, 0.0);

/// Shader id of the bright pass. Public range is `0x0000..=0x4FFF`.
pub const BRIGHT_PASS_SHADER_ID: u16 = 0x0A01;
/// Shader id of the separable blur.
pub const BLUR_SHADER_ID: u16 = 0x0A02;
/// Shader id of the composite, without bloom.
pub const COMPOSITE_SHADER_ID: u16 = 0x0A03;
/// Shader id of the composite, with bloom. A different source needs a different id or the
/// program cache hands back the wrong compiled program.
pub const COMPOSITE_BLOOM_SHADER_ID: u16 = 0x0A04;
/// Shader id of the additive beam cone material.
pub const BEAM_SHADER_ID: u16 = 0x0A05;
/// Shader id of the floor reflection pass.
pub const REFLECTION_SHADER_ID: u16 = 0x0A06;

/// Which stages of the chain run. Each one is independently switchable at run time; the
/// constants above are what each stage is worth when it is on.
///
/// Five fields, and they are the five stages the chain has. Nothing else is switchable because
/// nothing else is there.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stages {
    /// Bright pass, the two blur rounds and the additive composite.
    pub bloom: bool,
    /// The floor reflection. Needs the scene depth, so it only runs inside
    /// [`PostFx::render`]; [`PostFx::apply`] has a colour texture and nothing else.
    pub reflection: bool,
    /// The tone curve in the composite pass. With this off the composite still encodes sRGB,
    /// because the target expects sRGB either way; only the curve is skipped.
    pub tone_map: bool,
    /// Corner darkening in the composite pass.
    pub vignette: bool,
    /// Whether [`PostFx::render`] adds the beam cones to its own render call. Set it to
    /// `false` if the caller has put [`PostFx::beams`] into its main pass instead, or the
    /// cones are drawn twice and read twice as bright.
    pub beams: bool,
}

impl Default for Stages {
    fn default() -> Self {
        Stages {
            bloom: true,
            reflection: true,
            tone_map: true,
            vignette: true,
            beams: true,
        }
    }
}

/// One beam cone, resolved out of the scene data. Geometry-free: this is what
/// [`beam_specs`] measures, and it can be inspected without a GPU.
#[derive(Debug, Clone, PartialEq)]
pub struct BeamSpec {
    /// Fixture the cone belongs to, e.g. `Beam_L` or `MH_07_Lens`.
    pub name: String,
    /// Where the cone starts, world space, exported frame.
    pub apex: Vec3,
    /// Unit vector the cone points along.
    pub axis: Vec3,
    /// Length in metres.
    pub length: f32,
    /// Half-angle in radians. Blender's `spot_size` is the full angle; this is half of it.
    pub half_angle: f32,
    /// Linear RGB tint.
    pub color: [f32; 3],
}

/// One beam cone on the GPU: its spec and the additive cone it draws.
pub struct Beam {
    pub spec: BeamSpec,
    pub object: Gm<Mesh, BeamMaterial>,
}

/// The post-process chain. Owns its intermediate targets, so it has to be told the size.
pub struct PostFx {
    width: u32,
    height: u32,
    /// Floating-point scene target. `[f16; 4]`, so emission above 1.0 survives to the bloom.
    hdr: Texture2D,
    /// The scene plus its floor reflection, at full resolution. A second target because the
    /// reflection pass reads the whole frame to write one pixel and cannot write into what it is
    /// reading. Everything downstream — bright pass, blurs, composite — reads this one, so the
    /// reflection blooms and tone-maps exactly like the geometry that cast it.
    mirrored: Texture2D,
    /// Depth for the scene pass. The reflection pass needs it to tell floor from not-floor.
    depth: DepthTexture2D,
    /// Half-res bloom target A. The bright pass writes it and the tight blur round ends in it.
    bloom_a: Texture2D,
    /// Half-res bloom target B, the other half of the ping-pong.
    bloom_b: Texture2D,
    /// Half-res target the *wide* blur round ends in, so the tight round survives in
    /// `bloom_a` and the composite can weight the two halo widths apart.
    bloom_wide: Texture2D,
    /// The colour the frame is cleared to, linear RGBA, from the manifest's world background.
    clear_color: [f32; 4],
    /// The beam cones, one per fixture that resolved.
    beams: Vec<Beam>,
    /// Which stages run.
    pub stages: Stages,
    /// Tone curve of the composite pass. Starts at [`TONE_MAPPING`].
    pub tone_mapping: ToneMapping,
    /// Linear exposure of the composite pass. Starts at [`EXPOSURE`].
    pub exposure: f32,
    /// Tight-halo bloom mix of the composite pass. Starts at [`BLOOM_STRENGTH`].
    pub bloom_strength: f32,
    /// Wide-wing bloom mix of the composite pass. Starts at [`BLOOM_WIDE_STRENGTH`].
    pub bloom_wide_strength: f32,
    /// Corner darkening of the composite pass. Starts at [`VIGNETTE_CORNER_STRENGTH`].
    pub vignette_strength: f32,
}

impl PostFx {
    /// Allocates the chain for a `width` x `height` frame and builds the beam cones.
    ///
    /// The two spot cones come from `assets/scene.json`. The twelve truss cones need the world
    /// transform of each `MH_nn_Lens`, which only the GLB has, so this constructor loads the
    /// GLB's node tree itself — the same file `src/scene.rs` loads, parsed a second time for
    /// twelve matrices. Call [`PostFx::new_with_stage`] instead when a [`Stage`] is already
    /// built and the second parse is not worth paying for.
    pub fn new(
        context: &Context,
        manifest: &Manifest,
        width: u32,
        height: u32,
    ) -> crate::Result<Self> {
        let relative = if manifest.glb.is_empty() {
            crate::scene::MODEL_PATH
        } else {
            manifest.glb.as_str()
        };
        let path = crate::asset_path(relative);
        let cpu_scene: CpuScene = three_d_asset::io::load_and_deserialize(&path)
            .map_err(|e| crate::Error::from(format!("{}: {e}", path.display())))?;
        let walked = crate::scene::walk_scene(&cpu_scene);
        let par_positions = par_lens_positions(walked.parts.iter().filter_map(|p| {
            (p.name == PAR_LENS_NODE).then_some((&p.mesh, p.transformation))
        }));
        let nodes = walked.nodes;
        Ok(Self::build(
            context,
            manifest,
            |name| nodes.get(name).copied(),
            &par_positions,
            width,
            height,
        ))
    }

    /// Allocates the chain, taking the moving-head transforms off an already loaded [`Stage`].
    /// Identical to [`PostFx::new`] except that it does not re-read the GLB.
    // `src/main.rs`'s viewer calls this, so it needs no `#[allow(dead_code)]`.
    pub fn new_with_stage(
        context: &Context,
        manifest: &Manifest,
        stage: &Stage,
        width: u32,
        height: u32,
    ) -> crate::Result<Self> {
        let par_positions = par_lens_positions(
            stage
                .parts
                .iter()
                .filter(|p| p.name == PAR_LENS_NODE)
                .map(|p| (&p.cpu_mesh, p.base_transformation)),
        );
        Ok(Self::build(
            context,
            manifest,
            |name| stage.node_transform(name),
            &par_positions,
            width,
            height,
        ))
    }

    fn build(
        context: &Context,
        manifest: &Manifest,
        node_transform: impl Fn(&str) -> Option<Mat4>,
        par_positions: &[Vec3],
        width: u32,
        height: u32,
    ) -> Self {
        let mut specs = beam_specs(manifest, node_transform);
        specs.extend(par_beam_specs(manifest, par_positions));
        let cone = cone_mesh(BEAM_CONE_SEGMENTS);
        let beams = specs
            .into_iter()
            .map(|spec| {
                let mut mesh = Mesh::new(context, &cone);
                mesh.set_transformation(cone_transformation(&spec));
                let mut material = BeamMaterial::new(&spec, beam_strength(&spec.name));
                if is_spot_beam(&spec.name) {
                    material.length_falloff = BEAM_SPOT_LENGTH_FALLOFF;
                }
                Beam {
                    spec,
                    object: Gm::new(mesh, material),
                }
            })
            .collect::<Vec<_>>();
        eprintln!(
            "postfx: {} beam cones ({} spots, {} truss heads, {} PAR cans), bloom at {}x{}",
            beams.len(),
            beams
                .iter()
                .filter(|b| SPOT_BEAM_LIGHTS.contains(&b.spec.name.as_str()))
                .count(),
            beams
                .iter()
                .filter(|b| b.spec.name.starts_with("MH_"))
                .count(),
            beams
                .iter()
                .filter(|b| b.spec.name.starts_with(PAR_BEAM_PREFIX))
                .count(),
            bloom_size(width, height).0,
            bloom_size(width, height).1,
        );

        let background = manifest.render.background() * BACKGROUND_GAIN;
        let (bw, bh) = bloom_size(width, height);
        PostFx {
            width,
            height,
            hdr: hdr_texture(context, width, height),
            mirrored: hdr_texture(context, width, height),
            depth: depth_texture(context, width, height),
            bloom_a: hdr_texture(context, bw, bh),
            bloom_b: hdr_texture(context, bw, bh),
            bloom_wide: hdr_texture(context, bw, bh),
            clear_color: [background.x, background.y, background.z, 1.0],
            beams,
            stages: Stages::default(),
            tone_mapping: TONE_MAPPING,
            exposure: EXPOSURE,
            bloom_strength: BLOOM_STRENGTH,
            bloom_wide_strength: BLOOM_WIDE_STRENGTH,
            vignette_strength: VIGNETTE_CORNER_STRENGTH,
        }
    }

    /// Reallocates the intermediate targets when the window changes size.
    pub fn resize(&mut self, context: &Context, width: u32, height: u32) {
        if (width, height) == (self.width, self.height) {
            return;
        }
        let (bw, bh) = bloom_size(width, height);
        self.width = width;
        self.height = height;
        self.hdr = hdr_texture(context, width, height);
        self.mirrored = hdr_texture(context, width, height);
        self.depth = depth_texture(context, width, height);
        self.bloom_a = hdr_texture(context, bw, bh);
        self.bloom_b = hdr_texture(context, bw, bh);
        self.bloom_wide = hdr_texture(context, bw, bh);
    }

    /// Size the chain is currently allocated for.
    pub fn size(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    /// The beam cones, for a caller that would rather draw them in its own main pass.
    ///
    /// Additive geometry has to be in the same `render` call as everything else it must sort
    /// against, so this exists for `src/main.rs` to append to `World::frame`'s object list.
    /// Set [`Stages::beams`] to `false` if you do, or [`PostFx::render`] draws them again.
    pub fn beams(&self) -> Vec<&dyn Object> {
        self.beams
            .iter()
            .map(|b| &b.object as &dyn Object)
            .collect()
    }

    /// What each cone was built from. Nothing here is authored by hand; see the module docs.
    // For look-dev and for whoever debugs a cone that points the wrong way; see the note on
    // `new_with_stage` for why this is allowed to be unused.
    #[allow(dead_code)]
    pub fn beam_specs(&self) -> Vec<&BeamSpec> {
        self.beams.iter().map(|b| &b.spec).collect()
    }

    /// Rescales every cone's core radiance, for a look-dev sweep without a recompile.
    /// [`BEAM_STRENGTH`] is the value this starts at and the one to edit for good.
    /// The two per-kind scales still apply, so a sweep moves both kinds together and keeps the
    /// ratio [`BEAM_HEAD_STRENGTH_SCALE`] and [`BEAM_SPOT_STRENGTH_SCALE`] set.
    #[allow(dead_code)]
    pub fn set_beam_strength(&mut self, strength: f32) {
        for beam in &mut self.beams {
            beam.object.material.strength = strength * beam_kind_scale(&beam.spec.name);
        }
    }

    /// Draws the whole frame into `target`.
    ///
    /// The scene and the beam cones go through one `render` call, because
    /// `cmp_render_order` only sorts the objects handed to a single call and `MAT_Crystal`
    /// has to sort against the wheel behind it.
    ///
    /// `camera`'s tone and colour mapping are turned off for the scene pass and restored on
    /// the way out. The curve is applied once, in the composite.
    pub fn render(
        &mut self,
        context: &Context,
        target: &RenderTarget<'_>,
        camera: &mut Camera,
        objects: &[&dyn Object],
        lights: &[&dyn Light],
    ) -> crate::Result<()> {
        self.resize(context, target.width(), target.height());
        camera.disable_tone_and_color_mapping();

        {
            let scene = RenderTarget::new(
                self.hdr.as_color_target(None),
                self.depth.as_depth_target(),
            );
            let mut all: Vec<&dyn Object> = objects.to_vec();
            if self.stages.beams {
                all.extend(self.beams());
            }
            scene
                .clear(ClearState::color_and_depth(
                    self.clear_color[0],
                    self.clear_color[1],
                    self.clear_color[2],
                    self.clear_color[3],
                    1.0,
                ))
                .render(&*camera, all.iter().copied(), lights);
        }

        // The floor reflection, if it is on: the frame plus its reflection into `mirrored`, and
        // the rest of the chain reads that instead of the raw scene.
        let source = if self.stages.reflection {
            let reflection = ReflectionEffect {
                view_projection_inverse: (camera.projection() * camera.view())
                    .invert()
                    .unwrap_or_else(Mat4::identity),
                texel: texel_size(self.width, self.height),
                height: self.height as f32,
            };
            let viewer = PassViewer::intermediate(self.width, self.height);
            self.mirrored.as_color_target(None).apply_screen_effect(
                &reflection,
                &viewer,
                &[],
                Some(ColorTexture::Single(&self.hdr)),
                Some(DepthTexture::Single(&self.depth)),
            );
            &self.mirrored
        } else {
            &self.hdr
        };
        self.apply(context, target, source)?;

        camera.set_default_tone_and_color_mapping();
        camera.tone_mapping = self.tone_mapping;
        Ok(())
    }

    /// Runs bloom, tone mapping and the vignette over an already rendered colour texture and
    /// writes the result to `target`.
    ///
    /// `color` must hold linear, un-tone-mapped values, and wants to be floating point:
    /// bloom over an RGBA8 texture has no headroom to work with. It does not have to be this
    /// chain's own target — pass any `Texture2D` of the frame size.
    pub fn apply(
        &self,
        context: &Context,
        target: &RenderTarget<'_>,
        color: &Texture2D,
    ) -> crate::Result<()> {
        let bloom = if self.stages.bloom {
            Some(self.bloom(color))
        } else {
            None
        };
        let composite = CompositeEffect {
            exposure: self.exposure,
            bloom,
            bloom_strength: self.bloom_strength,
            bloom_wide_strength: self.bloom_wide_strength,
            bloom_tint: Vec3::from(BLOOM_TINT),
            vignette_strength: if self.stages.vignette {
                self.vignette_strength
            } else {
                0.0
            },
            vignette_inner: VIGNETTE_INNER_RADIUS,
            vignette_outer: VIGNETTE_OUTER_RADIUS,
        };
        // The colour mapping stays on whether or not the tone curve does: the target is
        // written for display or for a PNG either way, and a linear image looks washed out.
        let viewer = PassViewer {
            viewport: Viewport::new_at_origo(target.width(), target.height()),
            tone_mapping: if self.stages.tone_map {
                self.tone_mapping
            } else {
                ToneMapping::None
            },
            color_mapping: ColorMapping::ComputeToSrgb,
        };
        target.apply_screen_effect(
            &composite,
            &viewer,
            &[],
            Some(ColorTexture::Single(color)),
            None,
        );
        let _ = context;
        Ok(())
    }

    /// Bright pass plus the four blur passes. Returns the two textures the composite adds back:
    /// the tight halo and the wide wing.
    fn bloom(&self, color: &Texture2D) -> (&Texture2D, &Texture2D) {
        let (bw, bh) = (self.bloom_a.width(), self.bloom_a.height());
        let half = PassViewer::intermediate(bw, bh);

        // Bright pass: full-res HDR, 4-tap box downsample, soft-knee threshold -> A.
        //
        // The viewer is the *half-res* one, and getting that wrong is what round 1's worst
        // defect actually was. `apply_screen_effect` draws through `viewer.viewport()`, so a
        // full-res viewport writing into a half-res target maps target pixel `(x, y)` to source
        // uv `(x / width, y / height)` — half the uv it should be. The composite then reads the
        // bloom at the full uv, so what it gets is the bottom-left quarter of the frame
        // magnified 2x and offset to the top right. That is the "cream-white band about 240 px
        // wide and 640 px long" the round-1 verdict blamed on the beam cones: a doubled, blurred
        // copy of the wheel's own bulb ring lying across the upper right of the frame, complete
        // with the rim's bulb dashes visible in it. Verified by rendering with the bloom at zero
        // strength, which removes the band while leaving the cones in place.
        //
        // The `texel` uniform is a different thing and stays full-res: it is the spacing of the
        // 4-tap box the bright pass averages over, in the *source* texture.
        let bright = BrightPassEffect {
            threshold: BLOOM_THRESHOLD,
            knee: BLOOM_KNEE,
            texel: texel_size(self.width, self.height),
        };
        self.bloom_a.as_color_target(None).apply_screen_effect(
            &bright,
            &half,
            &[],
            Some(ColorTexture::Single(color)),
            None,
        );

        // Two rounds of separable Gaussian. The tight round ends in A, replacing the bright
        // pass; the wide round reads A and ends in its own target, so both widths survive to the
        // composite and can be weighted apart. Running them in series into one target — which is
        // what round 1 did — leaves only the wide one.
        let texel = texel_size(bw, bh);
        for (round, spread) in BLOOM_BLUR_SPREADS.into_iter().enumerate() {
            let horizontal = BlurEffect {
                direction: vec2(1.0, 0.0),
                spread,
                texel,
            };
            self.bloom_b.as_color_target(None).apply_screen_effect(
                &horizontal,
                &half,
                &[],
                Some(ColorTexture::Single(&self.bloom_a)),
                None,
            );
            let vertical = BlurEffect {
                direction: vec2(0.0, 1.0),
                spread,
                texel,
            };
            let destination = if round == 0 {
                &self.bloom_a
            } else {
                &self.bloom_wide
            };
            destination.as_color_target(None).apply_screen_effect(
                &vertical,
                &half,
                &[],
                Some(ColorTexture::Single(&self.bloom_b)),
                None,
            );
        }

        (&self.bloom_a, &self.bloom_wide)
    }
}

/// Resolves every beam cone the scene data supports: the manifest's spot lights first, then
/// the truss moving heads whose lens node `node_transform` can find.
///
/// Pure and GPU-free, so the geometry can be checked in a test. A moving head whose lens node
/// is missing from the GLB is skipped with a warning rather than guessed at.
pub fn beam_specs(
    manifest: &Manifest,
    node_transform: impl Fn(&str) -> Option<Mat4>,
) -> Vec<BeamSpec> {
    let mut specs = Vec::new();

    for name in SPOT_BEAM_LIGHTS {
        let Some(light) = manifest.light(name) else {
            eprintln!("postfx: assets/scene.json has no light {name:?}; no cone for it");
            continue;
        };
        let apex = manifest.to_scene_point(light.position());
        specs.push(BeamSpec {
            name: light.name.clone(),
            apex,
            axis: manifest.to_scene_dir(light.direction()),
            length: BEAM_SPOT_LENGTH,
            half_angle: light.cone_outer_half_angle_rad,
            // The fixture's own colour, straight off the manifest. `Beam_L` and `Beam_R` carry
            // the identical violet `(0.72, 0.36, 1)` (`assets/scene.json`), so the two cones come
            // out the same hue now; splitting them by the sign of `apex.x` was the per-side hack
            // the cleanup pass removed. See the note above [`BEAM_SPOT_STRENGTH_SCALE`].
            color: light.color,
        });
    }

    // The truss cones. Their half-angle is the scene's own spot cone: `docs/look_target.md`
    // measured 8 to 10 degrees off the reference and noted that it agrees with Blender's
    // spot_size of 0.38397 rad, i.e. a half-angle of 0.19199.
    let stage_centre = manifest.to_scene_point(manifest.wheel.pivot());
    // Every truss fixture's own colour: `MH_nn_Lens` and `Truss_Par_Lens` both carry
    // `MAT_Lens_Glow` in `assets/scene.json`, so this is read once and shared rather than
    // keyed off which fixture or which side of the frame a cone belongs to.
    let truss_color = truss_fixture_color(manifest);
    let head_half_angle = manifest
        .lights
        .iter()
        .find(|l| l.cone_outer_half_angle_rad > 0.0)
        .map(|l| l.cone_outer_half_angle_rad)
        .unwrap_or(BEAM_HEAD_HALF_ANGLE_FALLBACK);
    for i in 1..=MOVING_HEAD_COUNT {
        let name = moving_head_lens_name(i);
        let Some(transform) = node_transform(&name) else {
            eprintln!("postfx: the GLB has no node {name:?}; no cone for it");
            continue;
        };
        let apex = (transform * vec4(0.0, 0.0, 0.0, 1.0)).truncate();
        let aim = (transform * FIXTURE_LOCAL_AIM.extend(0.0)).truncate();
        if aim.magnitude() <= 0.0 {
            eprintln!("postfx: {name:?} has a degenerate transform; no cone for it");
            continue;
        }
        let axis = if BEAM_AIM_INWARD {
            swing_into_arena(
                apex,
                aim,
                stage_centre,
                crate::scene::WORLD_UP,
                BEAM_HEAD_LEAN_SCALE,
            )
        } else {
            scale_lean(aim, crate::scene::WORLD_UP, BEAM_HEAD_LEAN_SCALE)
        };
        specs.push(BeamSpec {
            name,
            apex,
            axis,
            length: BEAM_HEAD_LENGTH,
            half_angle: head_half_angle,
            color: truss_color,
        });
    }
    specs
}

/// Colour every truss fixture cone takes: `MH_nn_Lens` and `Truss_Par_Lens` both carry
/// `MAT_Lens_Glow` in `assets/scene.json`. Falls back to white with a warning if the manifest
/// ever loses that material, rather than inventing a hue.
fn truss_fixture_color(manifest: &Manifest) -> [f32; 3] {
    const TRUSS_FIXTURE_MATERIAL: &str = "MAT_Lens_Glow";
    manifest
        .material(TRUSS_FIXTURE_MATERIAL)
        .map(|m| m.base_color)
        .unwrap_or_else(|| {
            eprintln!(
                "postfx: assets/scene.json has no material {TRUSS_FIXTURE_MATERIAL:?}; \
                 truss cones fall back to white"
            );
            [1.0, 1.0, 1.0]
        })
}

/// Whether a resolved cone belongs to one of the two Blender SPOT lamps rather than to a truss
/// moving head. The two kinds differ in length, in strength and in length falloff.
fn is_spot_beam(name: &str) -> bool {
    SPOT_BEAM_LIGHTS.contains(&name)
}

/// The per-kind multiplier on [`BEAM_STRENGTH`] for one cone.
fn beam_kind_scale(name: &str) -> f32 {
    if is_spot_beam(name) {
        BEAM_SPOT_STRENGTH_SCALE
    } else if name.starts_with(PAR_BEAM_PREFIX) {
        PAR_BEAM_STRENGTH_SCALE
    } else {
        BEAM_HEAD_STRENGTH_SCALE
    }
}

/// Core radiance of one cone: [`BEAM_STRENGTH`] times its kind's scale.
fn beam_strength(name: &str) -> f32 {
    BEAM_STRENGTH * beam_kind_scale(name)
}

/// Every vertex of every primitive of [`PAR_LENS_NODE`], transformed to world space.
///
/// Takes the meshes as an iterator of `(mesh, world transform)` so that both constructors can feed
/// it — [`PostFx::new`] from its own walk of the GLB and [`PostFx::new_with_stage`] from the
/// [`Stage`]'s kept CPU meshes — without either of them knowing how the clustering works.
fn par_lens_positions<'a>(
    meshes: impl Iterator<Item = (&'a CpuMesh, Mat4)>,
) -> Vec<Vec3> {
    let mut out = Vec::new();
    for (mesh, transform) in meshes {
        let Positions::F32(positions) = &mesh.positions else {
            eprintln!(
                "postfx: {PAR_LENS_NODE} has f64 positions; no PAR cones. Re-export with f32."
            );
            continue;
        };
        out.extend(
            positions
                .iter()
                .map(|p| (transform * p.extend(1.0)).truncate()),
        );
    }
    if out.is_empty() {
        eprintln!("postfx: the GLB has no mesh under {PAR_LENS_NODE:?}; no PAR can cones");
    }
    out
}

/// The centre of every lamp island in one baked lens mesh, in the order the islands are first
/// met.
///
/// Greedy single-pass clustering: a vertex joins the first cluster whose *first* vertex is within
/// [`PAR_CLUSTER_RADIUS_M`] of it, and starts a new one otherwise; the apex is then the mean of the
/// cluster. That is enough here because the islands are 1.55 m apart and 0.22 m across, an order of
/// magnitude of separation, and it needs no island count told to it in advance.
/// [`PAR_LAMP_LIMIT`] bounds the result so a malformed mesh cannot turn into hundreds of cones.
///
/// `positions` must already be in world space.
pub fn par_lamp_apexes(positions: &[Vec3]) -> Vec<Vec3> {
    let radius_squared = PAR_CLUSTER_RADIUS_M.max(1.0e-3).powi(2);
    let mut seeds: Vec<Vec3> = Vec::new();
    let mut sums: Vec<Vec3> = Vec::new();
    let mut counts: Vec<f32> = Vec::new();
    for p in positions {
        let mut joined = false;
        for (i, seed) in seeds.iter().enumerate() {
            // Against the cluster's *first* vertex, not its running centroid. A running centroid
            // chains: it drifts toward whichever side has been absorbed so far, then reaches
            // another 0.5 m from where it started, and the measured drift was 0.4 m on a ring
            // whose lamps are 0.22 m across. A fixed seed cannot chain.
            if (seed - p).magnitude2() <= radius_squared {
                sums[i] += *p;
                counts[i] += 1.0;
                joined = true;
                break;
            }
        }
        if !joined {
            if sums.len() >= PAR_LAMP_LIMIT {
                eprintln!(
                    "postfx: {PAR_LENS_NODE} clustered past {PAR_LAMP_LIMIT} lamps; the rest are \
                     dropped. Check PAR_CLUSTER_RADIUS_M against the mesh."
                );
                break;
            }
            seeds.push(*p);
            sums.push(*p);
            counts.push(1.0);
        }
    }
    sums.iter()
        .zip(&counts)
        .map(|(sum, count)| *sum / *count)
        .collect()
}

/// One cone per PAR can, from the lens mesh's own world-space vertices.
///
/// Each cone keeps its can's radial bearing, turned inward toward the wheel, and leans
/// [`PAR_BEAM_LEAN`] off vertical. See the constant block for why the lean cannot come out of the
/// scene and what says the reference's number wins.
pub fn par_beam_specs(manifest: &Manifest, positions: &[Vec3]) -> Vec<BeamSpec> {
    let stage_centre = manifest.to_scene_point(manifest.wheel.pivot());
    let half_angle = manifest
        .lights
        .iter()
        .find(|l| l.cone_outer_half_angle_rad > 0.0)
        .map(|l| l.cone_outer_half_angle_rad)
        .unwrap_or(BEAM_HEAD_HALF_ANGLE_FALLBACK);
    // `Truss_Par_Lens` carries `MAT_Lens_Glow`, same as every `MH_nn_Lens`; see
    // `truss_fixture_color`.
    let color = truss_fixture_color(manifest);
    par_lamp_apexes(positions)
        .into_iter()
        .enumerate()
        .map(|(i, apex)| {
            // `swing_into_arena` scales a measured lean; here the lean is the constant itself, so
            // the aim handed to it is one already at that angle off vertical and the scale is 1.
            let up = crate::scene::WORLD_UP;
            let inward = {
                let to_centre = stage_centre - apex;
                let bearing = to_centre - up * up.dot(to_centre);
                if bearing.magnitude() < 1.0e-4 {
                    -up
                } else {
                    bearing.normalize() * PAR_BEAM_LEAN.sin() - up * PAR_BEAM_LEAN.cos()
                }
            };
            BeamSpec {
                name: format!("{PAR_BEAM_PREFIX}{:02}", i + 1),
                apex,
                axis: inward.normalize(),
                length: PAR_BEAM_LENGTH,
                half_angle,
                color,
            }
        })
        .collect()
}

/// `MH_07_Lens` for 7. The lens is the last link of `Base -> Yoke -> Head -> Lens` and sits
/// at zero offset from the head, so it carries the head's pan and tilt.
pub fn moving_head_lens_name(index: u32) -> String {
    format!("MH_{index:02}_Lens")
}

/// Keeps a fixture's own bearing and scales only its lean off vertical. `up` must be a unit
/// vector.
///
/// This is what [`BEAM_AIM_INWARD`] `== false` uses, and it is not the same as "the author's aim":
/// the bearing is the author's, the steepness is not. The ring's heads lean 38° and 52° off
/// vertical, which over a 2.2 m cone would carry it through the LED wall; scaled to 23° and 31° a
/// cone stays inside the room, and those are the angles agent C measured off the reference.
pub fn scale_lean(aim: Vec3, up: Vec3, lean_scale: f32) -> Vec3 {
    let aim = if aim.magnitude() > 0.0 {
        aim.normalize()
    } else {
        return -up;
    };
    let vertical = up.dot(aim);
    let horizontal = aim - up * vertical;
    if horizontal.magnitude() < 1.0e-4 {
        // Straight down already: there is no lean to scale.
        return -up;
    }
    let lean = (horizontal.magnitude().atan2(-vertical) * lean_scale)
        .clamp(0.0, std::f32::consts::FRAC_PI_2 * 0.98);
    (horizontal.normalize() * lean.sin() - up * lean.cos()).normalize()
}

/// Swings a fixture's aim into the arena: bearing toward `target`, lean off vertical scaled by
/// `lean_scale`. `up` must be a unit vector.
///
/// The fixture's own lean is measured, scaled and reused, so the ring's alternating 38° and 52°
/// tilts stay different from each other and no two neighbouring cones come out parallel — which
/// is what the reference shows. At the default scale they land on 23° and 31°, inside the 20 to
/// 35 degrees off vertical agent C measured. See [`BEAM_AIM_INWARD`] and
/// [`BEAM_HEAD_LEAN_SCALE`].
pub fn swing_into_arena(apex: Vec3, aim: Vec3, target: Vec3, up: Vec3, lean_scale: f32) -> Vec3 {
    let aim = if aim.magnitude() > 0.0 {
        aim.normalize()
    } else {
        return -up;
    };
    let vertical = up.dot(aim);
    let horizontal = (aim - up * vertical).magnitude();
    // Angle off straight down, so a fixture pointing at the floor is 0.
    let lean = (horizontal.atan2(-vertical) * lean_scale)
        .clamp(0.0, std::f32::consts::FRAC_PI_2 * 0.98);
    let to_target = target - apex;
    let bearing = to_target - up * up.dot(to_target);
    if bearing.magnitude() < 1.0e-4 {
        // The fixture hangs directly over the target: there is no bearing to turn to.
        return -up;
    }
    (bearing.normalize() * lean.sin() - up * lean.cos()).normalize()
}

/// Local-to-world transform that puts the unit cone from [`cone_mesh`] on a [`BeamSpec`].
///
/// The columns are the cone's own axes scaled: two perpendicular radii of
/// `length * tan(half_angle)` and the axis itself of `length`, with the apex as the
/// translation. The basis is right-handed and the scales are positive, so the winding
/// survives and `Cull::Back` still keeps the outward faces.
pub fn cone_transformation(spec: &BeamSpec) -> Mat4 {
    let axis = if spec.axis.magnitude() > 0.0 {
        spec.axis.normalize()
    } else {
        vec3(0.0, -1.0, 0.0)
    };
    // Any vector not parallel to the axis will do for the first cross product.
    let helper = if axis.y.abs() < 0.99 {
        vec3(0.0, 1.0, 0.0)
    } else {
        vec3(1.0, 0.0, 0.0)
    };
    let right = helper.cross(axis).normalize();
    let up = axis.cross(right);
    let radius = spec.length * spec.half_angle.tan();
    Mat4::from_cols(
        (right * radius).extend(0.0),
        (up * radius).extend(0.0),
        (axis * spec.length).extend(0.0),
        spec.apex.extend(1.0),
    )
}

/// The one hand-authored mesh in this crate: an open cone, apex at the origin, base ring of
/// radius 1 at z = 1, `segments` triangles, no cap and no normals.
///
/// Allowed by `docs/agent_plan.md` only because a beam is a light effect and not scene
/// modelling; see the module docs. A flat triangle soup, so nothing is shared between
/// segments and there is no index buffer to get wrong. Winding is `(apex, base[i+1],
/// base[i])`, which faces outward: with `(apex, base[i], base[i+1])` the cross product comes
/// out pointing back at the axis and `Cull::Back` would drop every triangle a viewer outside
/// the cone can see.
pub fn cone_mesh(segments: u32) -> CpuMesh {
    let segments = segments.max(3);
    let mut positions = Vec::with_capacity(segments as usize * 3);
    let step = std::f32::consts::TAU / segments as f32;
    for i in 0..segments {
        let a = step * i as f32;
        let b = step * (i + 1) as f32;
        positions.push(vec3(0.0, 0.0, 0.0));
        positions.push(vec3(b.cos(), b.sin(), 1.0));
        positions.push(vec3(a.cos(), a.sin(), 1.0));
    }
    CpuMesh {
        positions: Positions::F32(positions),
        ..Default::default()
    }
}

/// Half-res size of the bloom targets, never zero.
fn bloom_size(width: u32, height: u32) -> (u32, u32) {
    let d = BLOOM_DOWNSAMPLE.max(1);
    ((width / d).max(1), (height / d).max(1))
}

/// One texel of a `width` x `height` texture, in uv units.
fn texel_size(width: u32, height: u32) -> Vec2 {
    vec2(1.0 / width.max(1) as f32, 1.0 / height.max(1) as f32)
}

/// A floating-point colour texture. `[f16; 4]` keeps emission above 1.0, which is the whole
/// reason the chain has an intermediate target at all.
fn hdr_texture(context: &Context, width: u32, height: u32) -> Texture2D {
    Texture2D::new_empty::<[f16; 4]>(
        context,
        width.max(1),
        height.max(1),
        Interpolation::Linear,
        Interpolation::Linear,
        None,
        Wrapping::ClampToEdge,
        Wrapping::ClampToEdge,
    )
}

fn depth_texture(context: &Context, width: u32, height: u32) -> DepthTexture2D {
    DepthTexture2D::new::<f32>(
        context,
        width.max(1),
        height.max(1),
        Wrapping::ClampToEdge,
        Wrapping::ClampToEdge,
    )
}

/// A [`Viewer`] for a full-screen pass.
///
/// `apply_screen_effect` draws through `full_screen_draw(.., viewer.viewport())`, so the
/// viewport has to match the *destination* texture, not the camera's. That is why the
/// intermediate passes do not use the scene camera: at half resolution it would write a
/// quarter of the bloom target and leave the rest black. No pass here reads a matrix, so the
/// view and projection are the identity.
struct PassViewer {
    viewport: Viewport,
    tone_mapping: ToneMapping,
    color_mapping: ColorMapping,
}

impl PassViewer {
    /// A viewer for an intermediate pass: no tone curve, no colour encode.
    fn intermediate(width: u32, height: u32) -> Self {
        PassViewer {
            viewport: Viewport::new_at_origo(width.max(1), height.max(1)),
            tone_mapping: ToneMapping::None,
            color_mapping: ColorMapping::None,
        }
    }
}

impl Viewer for PassViewer {
    fn position(&self) -> Vec3 {
        vec3(0.0, 0.0, 0.0)
    }
    fn view(&self) -> Mat4 {
        Mat4::identity()
    }
    fn projection(&self) -> Mat4 {
        Mat4::identity()
    }
    fn viewport(&self) -> Viewport {
        self.viewport
    }
    fn z_near(&self) -> f32 {
        0.0
    }
    fn z_far(&self) -> f32 {
        1.0
    }
    fn color_mapping(&self) -> ColorMapping {
        self.color_mapping
    }
    fn tone_mapping(&self) -> ToneMapping {
        self.tone_mapping
    }
}

/// Render states shared by every full-screen pass: write colour, ignore depth.
fn screen_pass_states() -> RenderStates {
    RenderStates {
        write_mask: WriteMask::COLOR,
        depth_test: DepthTest::Always,
        cull: Cull::Back,
        ..Default::default()
    }
}

/// Downsamples and keeps only what is brighter than [`BLOOM_THRESHOLD`], with a soft knee.
struct BrightPassEffect {
    threshold: f32,
    knee: f32,
    /// Texel size of the *source* texture, for the 4-tap box downsample.
    texel: Vec2,
}

impl Effect for BrightPassEffect {
    fn id(
        &self,
        _color_texture: Option<ColorTexture>,
        _depth_texture: Option<DepthTexture>,
    ) -> EffectMaterialId {
        EffectMaterialId(BRIGHT_PASS_SHADER_ID)
    }

    fn fragment_shader_source(
        &self,
        _lights: &[&dyn Light],
        color_texture: Option<ColorTexture>,
        _depth_texture: Option<DepthTexture>,
    ) -> String {
        format!(
            "{}
            in vec2 uvs;
            uniform float threshold;
            uniform float knee;
            uniform vec2 texel;
            layout (location = 0) out vec4 outColor;

            void main() {{
                // 4-tap box, so the half-res bright pass does not alias the bulb dashes.
                vec3 c = sample_color(uvs + texel * vec2(-0.5, -0.5)).rgb;
                c += sample_color(uvs + texel * vec2(0.5, -0.5)).rgb;
                c += sample_color(uvs + texel * vec2(-0.5, 0.5)).rgb;
                c += sample_color(uvs + texel * vec2(0.5, 0.5)).rgb;
                c *= 0.25;

                // One bad fragment anywhere in the frame would otherwise be smeared over the
                // whole bloom by the four blur passes, and NaN survives every arithmetic
                // operation after it. Stop it here rather than trusting every material in the
                // scene to be finite.
                if (any(isnan(c)) || any(isinf(c))) {{
                    c = vec3(0.0);
                }}

                float b = max(max(c.r, c.g), c.b);
                float soft = clamp(b - threshold + knee, 0.0, 2.0 * knee);
                soft = soft * soft / (4.0 * knee + 0.0001);
                float contribution = max(soft, b - threshold) / max(b, 0.0001);
                outColor = vec4(c * contribution, 1.0);
            }}",
            color_texture
                .expect("the bright pass needs a color texture")
                .fragment_shader_source()
        )
    }

    fn use_uniforms(
        &self,
        program: &Program,
        _viewer: &dyn Viewer,
        _lights: &[&dyn Light],
        color_texture: Option<ColorTexture>,
        _depth_texture: Option<DepthTexture>,
    ) {
        color_texture
            .expect("the bright pass needs a color texture")
            .use_uniforms(program);
        program.use_uniform("threshold", self.threshold);
        program.use_uniform("knee", self.knee);
        program.use_uniform("texel", self.texel);
    }

    fn render_states(&self) -> RenderStates {
        screen_pass_states()
    }
}

/// One separable Gaussian pass along `direction`, sampling every texel out to
/// [`BLUR_TAPS_HALF`].
struct BlurEffect {
    /// `(1, 0)` for the horizontal pass, `(0, 1)` for the vertical one.
    direction: Vec2,
    /// Gaussian sigma in texels. This is what widens the halo.
    spread: f32,
    /// Texel size of the source texture.
    texel: Vec2,
}

impl Effect for BlurEffect {
    fn id(
        &self,
        _color_texture: Option<ColorTexture>,
        _depth_texture: Option<DepthTexture>,
    ) -> EffectMaterialId {
        // Direction and spread are uniforms, not source, so both passes share one program.
        EffectMaterialId(BLUR_SHADER_ID)
    }

    fn fragment_shader_source(
        &self,
        _lights: &[&dyn Light],
        color_texture: Option<ColorTexture>,
        _depth_texture: Option<DepthTexture>,
    ) -> String {
        format!(
            "{}
            in vec2 uvs;
            uniform vec2 direction;
            uniform vec2 texel;
            uniform float spread;
            layout (location = 0) out vec4 outColor;

            void main() {{
                // One tap per texel. The weight is the Gaussian itself rather than a fixed table,
                // because `spread` is a sigma now and the table was what forced a tap spacing.
                float sigma = max(spread, 0.35);
                float denominator = 2.0 * sigma * sigma;
                vec3 sum = sample_color(uvs).rgb;
                float weight = 1.0;
                for (int i = 1; i <= TAPS_HALF; i++) {{
                    float w = exp(-float(i * i) / denominator);
                    vec2 offset = direction * texel * float(i);
                    sum += (sample_color(uvs + offset).rgb + sample_color(uvs - offset).rgb) * w;
                    weight += 2.0 * w;
                }}
                outColor = vec4(sum / weight, 1.0);
            }}",
            color_texture
                .expect("the blur needs a color texture")
                .fragment_shader_source()
        )
        .replace("TAPS_HALF", &BLUR_TAPS_HALF.max(1).to_string())
    }

    fn use_uniforms(
        &self,
        program: &Program,
        _viewer: &dyn Viewer,
        _lights: &[&dyn Light],
        color_texture: Option<ColorTexture>,
        _depth_texture: Option<DepthTexture>,
    ) {
        color_texture
            .expect("the blur needs a color texture")
            .use_uniforms(program);
        program.use_uniform("direction", self.direction);
        program.use_uniform("texel", self.texel);
        program.use_uniform("spread", self.spread);
    }

    fn render_states(&self) -> RenderStates {
        screen_pass_states()
    }
}

/// The floor reflection: the frame, plus the frame mirrored in the floor plane wherever the
/// floor is.
///
/// Reads the colour buffer and the depth buffer and writes a full-res copy of the frame with the
/// reflection added. See the constant block above for why it is done in screen space and for
/// what every number means.
struct ReflectionEffect {
    /// `(projection * view)` inverted, for `world_pos_from_depth`. The scene camera's, not a
    /// pass viewer's: this is the one pass in the chain that needs to know where things are.
    view_projection_inverse: Mat4,
    /// Texel size of the full-res frame.
    texel: Vec2,
    /// Frame height in pixels, so the constants above can be written in pixels.
    height: f32,
}

impl Effect for ReflectionEffect {
    fn id(
        &self,
        _color_texture: Option<ColorTexture>,
        _depth_texture: Option<DepthTexture>,
    ) -> EffectMaterialId {
        EffectMaterialId(REFLECTION_SHADER_ID)
    }

    fn fragment_shader_source(
        &self,
        _lights: &[&dyn Light],
        color_texture: Option<ColorTexture>,
        depth_texture: Option<DepthTexture>,
    ) -> String {
        format!(
            "{}
            {}
            in vec2 uvs;
            uniform mat4 viewProjectionInverse;
            uniform vec2 texel;
            uniform float frameHeight;
            uniform float floorY;
            uniform float floorTolerance;
            uniform float strength;
            uniform float fadePx;
            uniform float searchPx;
            uniform vec2 blurPx;
            uniform float blurHPx;
            uniform float squash;
            uniform float saturation;
            uniform float jitter;
            layout (location = 0) out vec4 outColor;

            // Per-pixel phase in 0..1, from the pixel's own coordinate. Fixed for a given pixel,
            // so `--shot` is byte-deterministic; different for its neighbours, which is what
            // breaks the shared tap lattice. See REFLECTION_JITTER.
            float tap_phase(vec2 fragment) {{
                vec3 q = fract(vec3(fragment.x, fragment.y, fragment.x) * 0.1031);
                q += dot(q, q.yzx + 33.33);
                return fract((q.x + q.y) * q.z);
            }}

            // World height of the surface at `uv`, or a value far above the floor where the
            // frame shows background and there is no surface at all.
            float world_height(vec2 uv) {{
                float depth = sample_depth(uv);
                if (depth >= 1.0) {{
                    return 1.0e6;
                }}
                vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
                vec4 world = viewProjectionInverse * clip;
                return world.y / world.w;
            }}

            bool is_floor(vec2 uv) {{
                return abs(world_height(uv) - floorY) < floorTolerance;
            }}

            void main() {{
                vec3 base = sample_color(uvs).rgb;
                if (!is_floor(uvs)) {{
                    outColor = vec4(base, 1.0);
                    return;
                }}

                // Walk up this column for the contact line: the first pixel above that is not
                // floor is where whatever stands here meets its reflection. uv y runs up the
                // frame, so up the image is +y.
                float contact = -1.0;
                int steps = int(searchPx);
                for (int i = 1; i <= steps; i++) {{
                    float y = uvs.y + float(i) * texel.y;
                    if (y >= 1.0) {{
                        break;
                    }}
                    if (!is_floor(vec2(uvs.x, y))) {{
                        contact = y;
                        break;
                    }}
                }}
                if (contact < 0.0) {{
                    // Open floor: nothing within the search distance to reflect.
                    outColor = vec4(base, 1.0);
                    return;
                }}

                float below = contact - uvs.y;
                float belowPx = below * frameHeight;
                float fade = exp(-belowPx / max(fadePx, 1.0));
                float blur = mix(blurPx.x, blurPx.y, clamp(belowPx / max(fadePx, 1.0), 0.0, 1.0))
                    * texel.y;
                float source = contact + below * squash;

                // Mostly vertical, with a narrow horizontal spread on top. The vertical blur is
                // what dissolves the inverted shape; the horizontal one, an order of magnitude
                // narrower, is what joins a row of point features — the 96 bulb dashes, the
                // pillar's flutes — into one smear instead of a set of parallel wires. It stays
                // narrow because the features that must survive are wide: the gold column under
                // the wheel is 130 px across.
                float blurH = blurHPx * texel.x;
                vec3 sum = vec3(0.0);
                float weight = 0.0;
                int taps = TAPS;
                // One stride of each axis, and a phase inside it that is this pixel's own. Without
                // the phase every floor pixel reads the same 4.8 x 3.5 px lattice of source pixels
                // and the ones in between are never read at all, which prints as a fixed dither.
                // The phase is per tap and not per pixel, which matters: one phase shared by all 41
                // taps only slides the comb, so what is left is the comb's own aliasing error and it
                // prints as coarse grain. A phase per tap turns that error into an average over 369
                // independent samples instead, which is a fortieth of the amplitude.
                float strideY = blur * 4.0 / max(float(taps - 1), 1.0);
                float strideX = blurH * 0.25;
                for (int i = 0; i < taps; i++) {{
                    float t = (float(i) - float(taps - 1) * 0.5) / max(float(taps - 1) * 0.5, 1.0);
                    float w = exp(-2.0 * t * t);
                    float phaseY = jitter
                        * (tap_phase(gl_FragCoord.xy + float(i) * 7.31) - 0.5);
                    float phaseX = jitter
                        * (tap_phase(gl_FragCoord.yx + float(i) * 13.17 + 19.7) - 0.5);
                    float y = clamp(source + t * blur * 2.0 + phaseY * strideY, 0.0, 1.0);
                    // Nine horizontal taps at a quarter of the half-width apiece. Three at the full
                    // half-width put their samples 10 px apart, and the reflected bulbs are 20 px
                    // apart, so the comb read as vertical wires in the gold column instead of
                    // dissolving it.
                    for (int k = -4; k <= 4; k++) {{
                        float x = clamp(uvs.x + (float(k) + phaseX) * strideX, 0.0, 1.0);
                        sum += sample_color(vec2(x, y)).rgb * w;
                        weight += w;
                    }}
                }}
                vec3 reflection = sum / max(weight, 1.0e-4);
                if (any(isnan(reflection)) || any(isinf(reflection))) {{
                    reflection = vec3(0.0);
                }}
                // The chroma the averaging took out, put back about the reflection's own luminance:
                // a 369-sample mean of a gold bulb and the dark violet plate beside it is a
                // desaturated pink, and the reference's column is gold. See REFLECTION_SATURATION.
                float reflectionLuma = dot(reflection, vec3(0.2126, 0.7152, 0.0722));
                reflection = max(vec3(0.0),
                    mix(vec3(reflectionLuma), reflection, saturation));

                outColor = vec4(base + reflection * strength * fade, 1.0);
            }}",
            color_texture
                .expect("the reflection needs a color texture")
                .fragment_shader_source(),
            depth_texture
                .expect("the reflection needs a depth texture")
                .fragment_shader_source(),
        )
        .replace("TAPS", &REFLECTION_TAPS.max(3).to_string())
    }

    fn use_uniforms(
        &self,
        program: &Program,
        _viewer: &dyn Viewer,
        _lights: &[&dyn Light],
        color_texture: Option<ColorTexture>,
        depth_texture: Option<DepthTexture>,
    ) {
        color_texture
            .expect("the reflection needs a color texture")
            .use_uniforms(program);
        depth_texture
            .expect("the reflection needs a depth texture")
            .use_uniforms(program);
        program.use_uniform("viewProjectionInverse", self.view_projection_inverse);
        program.use_uniform("texel", self.texel);
        program.use_uniform("frameHeight", self.height);
        program.use_uniform("floorY", FLOOR_PLANE_Y);
        program.use_uniform("floorTolerance", FLOOR_PLANE_TOLERANCE);
        program.use_uniform("strength", REFLECTION_STRENGTH);
        program.use_uniform("fadePx", REFLECTION_FADE_PX);
        program.use_uniform("searchPx", REFLECTION_SEARCH_PX as f32);
        program.use_uniform("blurPx", vec2(REFLECTION_BLUR_PX.0, REFLECTION_BLUR_PX.1));
        program.use_uniform("blurHPx", REFLECTION_BLUR_H_PX);
        program.use_uniform("squash", REFLECTION_SQUASH);
        program.use_uniform("saturation", REFLECTION_SATURATION);
        program.use_uniform("jitter", if REFLECTION_JITTER { 1.0f32 } else { 0.0f32 });
    }

    fn render_states(&self) -> RenderStates {
        screen_pass_states()
    }
}

/// Exposure, additive bloom, the shadow toe, the vignette, the tone curve and the sRGB encode,
/// in that order.
struct CompositeEffect<'a> {
    exposure: f32,
    /// The tight halo and the wide wing, in that order. `None` switches both out of the shader
    /// entirely.
    bloom: Option<(&'a Texture2D, &'a Texture2D)>,
    bloom_strength: f32,
    bloom_wide_strength: f32,
    bloom_tint: Vec3,
    vignette_strength: f32,
    vignette_inner: f32,
    vignette_outer: f32,
}

impl Effect for CompositeEffect<'_> {
    fn id(
        &self,
        _color_texture: Option<ColorTexture>,
        _depth_texture: Option<DepthTexture>,
    ) -> EffectMaterialId {
        if self.bloom.is_some() {
            EffectMaterialId(COMPOSITE_BLOOM_SHADER_ID)
        } else {
            EffectMaterialId(COMPOSITE_SHADER_ID)
        }
    }

    fn fragment_shader_source(
        &self,
        _lights: &[&dyn Light],
        color_texture: Option<ColorTexture>,
        _depth_texture: Option<DepthTexture>,
    ) -> String {
        format!(
            "{}{}{}{}
            in vec2 uvs;
            uniform float exposure;
            uniform float vignetteStrength;
            uniform float vignetteInner;
            uniform float vignetteOuter;
            uniform vec3 shadowLift;
            uniform float shadowLiftRange;
            #ifdef USE_BLOOM
            uniform sampler2D bloomMap;
            uniform sampler2D bloomWideMap;
            uniform float bloomStrength;
            uniform float bloomWideStrength;
            uniform vec3 bloomTint;
            #endif
            layout (location = 0) out vec4 outColor;

            void main() {{
                vec3 c = sample_color(uvs).rgb * exposure;
            #ifdef USE_BLOOM
                c += texture(bloomMap, uvs).rgb * bloomStrength * bloomTint;
                c += texture(bloomWideMap, uvs).rgb * bloomWideStrength * bloomTint;
            #endif
                // The toe. A plum-violet radiance added to the darkest pixels only, weighted out
                // by the pixel's own luminance, so the ceiling void reads as dark violet rather
                // than as a crushed neutral black and nothing above the void is touched.
                // `docs/look_target.md`: blacks are lifted and tinted plum, never neutral and
                // never fully crushed.
                float shadowLuma = dot(c, vec3(0.2126, 0.7152, 0.0722));
                c += shadowLift * (1.0 - smoothstep(0.0, shadowLiftRange, shadowLuma));
                // Vignette before the tone curve, so a darkened corner rolls down the curve
                // instead of being scaled after it.
                float d = length(uvs - vec2(0.5)) * 1.41421356;
                c *= 1.0 - vignetteStrength * smoothstep(vignetteInner, vignetteOuter, d);
                c = tone_mapping(c);
                c = color_mapping(c);
                outColor = vec4(c, 1.0);
            }}",
            if self.bloom.is_some() {
                "#define USE_BLOOM\n"
            } else {
                ""
            },
            color_texture
                .expect("the composite needs a color texture")
                .fragment_shader_source(),
            ToneMapping::fragment_shader_source(),
            ColorMapping::fragment_shader_source(),
        )
    }

    fn use_uniforms(
        &self,
        program: &Program,
        viewer: &dyn Viewer,
        _lights: &[&dyn Light],
        color_texture: Option<ColorTexture>,
        _depth_texture: Option<DepthTexture>,
    ) {
        color_texture
            .expect("the composite needs a color texture")
            .use_uniforms(program);
        viewer.tone_mapping().use_uniforms(program);
        viewer.color_mapping().use_uniforms(program);
        program.use_uniform("exposure", self.exposure);
        program.use_uniform("vignetteStrength", self.vignette_strength);
        program.use_uniform("vignetteInner", self.vignette_inner);
        program.use_uniform("vignetteOuter", self.vignette_outer);
        program.use_uniform("shadowLift", Vec3::from(SHADOW_LIFT_TINT) * SHADOW_LIFT);
        program.use_uniform("shadowLiftRange", SHADOW_LIFT_RANGE.max(1.0e-4));
        // Guarded, not conditional: `use_uniform` panics on a uniform the shader does not
        // declare, and without the bloom these five are not in the source at all.
        if let Some((bloom, wide)) = self.bloom {
            program.use_texture("bloomMap", bloom);
            program.use_texture("bloomWideMap", wide);
            program.use_uniform("bloomStrength", self.bloom_strength);
            program.use_uniform("bloomWideStrength", self.bloom_wide_strength);
            program.use_uniform("bloomTint", self.bloom_tint);
        }
    }

    fn render_states(&self) -> RenderStates {
        screen_pass_states()
    }
}

/// The additive material on a beam cone.
///
/// The cone is a hollow shell, so the radial falloff cannot be a radial coordinate: every point
/// of a cone's lateral surface is exactly at the cone's edge, so any "distance from the axis over
/// the radius here" measure is 1 everywhere and the cone comes out black. Measured the hard way,
/// by writing that version first.
///
/// What the shader does instead: it takes how squarely the shell faces the viewer,
/// `|dot(normal, toEye)|`, as the radial coordinate. Down the middle of the cone in screen space
/// the shell faces the camera and the term is 1; at the silhouette the normal is perpendicular to
/// the view and it falls to 0. That both dissolves the geometric edge and puts the bright core
/// where a real beam has it. The normal is computed analytically from the cone's own definition,
/// so the mesh needs no normals, and the whole thing costs three dot products.
///
/// The length fade is separate and comes from the fragment's own axial position, not from the
/// radial term, so a cone fades along its length exactly as `BEAM_LENGTH_FALLOFF` says.
pub struct BeamMaterial {
    /// Cone apex, world space.
    pub apex: Vec3,
    /// Unit axis.
    pub axis: Vec3,
    /// Length in metres.
    pub length: f32,
    /// `tan(half_angle)`, precomputed.
    pub tan_half_angle: f32,
    /// Linear RGB tint.
    pub color: Vec3,
    /// Core radiance multiplier.
    pub strength: f32,
    /// Radial falloff exponent, [`BEAM_EDGE_SOFTNESS`].
    pub edge_softness: f32,
    /// Length falloff exponent, [`BEAM_LENGTH_FALLOFF`].
    pub length_falloff: f32,
    /// Apex ramp, [`BEAM_APEX_FADE`].
    pub apex_fade: f32,
}

impl BeamMaterial {
    /// The material for one resolved cone.
    pub fn new(spec: &BeamSpec, strength: f32) -> Self {
        BeamMaterial {
            apex: spec.apex,
            axis: spec.axis,
            length: spec.length.max(1.0e-3),
            tan_half_angle: spec.half_angle.tan().max(1.0e-4),
            // The tint is linear RGB and goes into a floating-point target, so there is no
            // `Srgba` round trip and no encode: `src/scene.rs`'s `linear_to_srgba` is for
            // `PhysicalMaterial`, which decodes what it is given.
            color: Vec3::from(spec.color),
            strength,
            edge_softness: BEAM_EDGE_SOFTNESS,
            length_falloff: BEAM_LENGTH_FALLOFF,
            apex_fade: BEAM_APEX_FADE,
        }
    }
}

impl Material for BeamMaterial {
    fn id(&self) -> EffectMaterialId {
        EffectMaterialId(BEAM_SHADER_ID)
    }

    fn fragment_shader_source(&self, _lights: &[&dyn Light]) -> String {
        // `pos` is the world position, written by the crate's own mesh.vert. No normals, no
        // uvs and no lights are used, so nothing else has to be declared.
        "
        const float POW_FLOOR = 1.0e-6;

        in vec3 pos;
        uniform vec3 eyePosition;
        uniform vec3 beamApex;
        uniform vec3 beamAxis;
        uniform float beamLength;
        uniform float beamTanHalfAngle;
        uniform vec3 beamColor;
        uniform float beamStrength;
        uniform float edgeSoftness;
        uniform float lengthFalloff;
        uniform float apexFade;
        layout (location = 0) out vec4 outColor;

        void main() {
            vec3 toEye = normalize(eyePosition - pos);

            // Where this fragment sits on the cone: axial distance from the apex, and the
            // radial direction away from the axis.
            vec3 fromApex = pos - beamApex;
            float axial = dot(fromApex, beamAxis);
            vec3 radialVector = fromApex - beamAxis * axial;
            float radius = length(radialVector);
            vec3 radialDirection = radius > 1.0e-5 ? radialVector / radius : beamAxis;

            // Exact outward normal of a cone surface, no vertex normals needed: the surface is
            // |radial| = axial * tan(half angle), so the gradient is
            // radialDirection - tan(half angle) * axis.
            vec3 normal = normalize(radialDirection - beamAxis * beamTanHalfAngle);

            // Radial falloff. A cone shell cannot carry a radial coordinate — every point of it
            // is at the cone's edge by definition — so the falloff is how close this fragment's
            // line of sight passes to the cone's axis, over the cone's radius there. That is a
            // stand-in for the chord the ray cuts through the cone's volume, which is what a
            // real shaft of haze is bright in proportion to: 1 down the middle of the cone in
            // screen space, 0 at the silhouette, and it dissolves the geometric edge.
            //
            // The obvious cheaper term, `|dot(normal, toEye)|`, is what round 1 shipped and it
            // is wrong in a way that only shows up here: it measures how squarely the shell
            // faces the viewer, so a cone pointing at or away from the lens goes almost black —
            // its shell can only ever face the camera at `sin(half_angle)`, which is 0.19. The
            // camera sits *inside* the truss ring, so most of the twelve cones point roughly
            // along the view axis, and at 25x the shipping strength exactly two of fourteen
            // cones were visible. This term does not care which way a cone points.
            vec3 sight = normalize(pos - eyePosition);
            vec3 perpendicular = cross(sight, beamAxis);
            float perpendicularLength = length(perpendicular);
            float missDistance = perpendicularLength > 1.0e-4
                ? abs(dot(beamApex - eyePosition, perpendicular)) / perpendicularLength
                // Looking exactly along the axis: the miss distance is the same for every
                // fragment, so measure it from the apex directly.
                : length(cross(beamApex - eyePosition, beamAxis));
            float radiusHere = max(clamp(axial, 0.0, beamLength) * beamTanHalfAngle, 1.0e-4);
            float across = pow(
                max(1.0 - clamp(missDistance / radiusHere, 0.0, 1.0), POW_FLOOR), edgeSoftness);

            // Length fade, from the fragment's own axial position. POW_FLOOR, not 0.0, and it
            // is not cosmetic: this driver's `pow(0.0, y)` returns NaN, `1.0 - t` is exactly 0
            // along the cone's far rim, and one NaN fragment was enough for the blur to smear
            // NaN across the whole bloom and print hard black wedges over the frame. Rounding
            // can also push the division an ulp past 1.0, and `pow` of a negative base is
            // undefined in GLSL.
            float t = clamp(axial / beamLength, 0.0, 1.0);
            float along = pow(max(1.0 - t, POW_FLOOR), lengthFalloff)
                * smoothstep(0.0, apexFade, t);

            // Alpha 0: Blend::ADD adds alpha too, and the frame's alpha is not ours to touch.
            outColor = vec4(beamColor * beamStrength * across * along, 0.0);
        }"
        .to_owned()
    }

    fn use_uniforms(&self, program: &Program, viewer: &dyn Viewer, _lights: &[&dyn Light]) {
        program.use_uniform("eyePosition", viewer.position());
        program.use_uniform("beamApex", self.apex);
        program.use_uniform("beamAxis", self.axis);
        program.use_uniform("beamLength", self.length);
        program.use_uniform("beamTanHalfAngle", self.tan_half_angle);
        program.use_uniform("beamColor", self.color);
        program.use_uniform("beamStrength", self.strength);
        program.use_uniform("edgeSoftness", self.edge_softness);
        program.use_uniform("lengthFalloff", self.length_falloff);
        program.use_uniform("apexFade", self.apex_fade);
    }

    fn render_states(&self) -> RenderStates {
        RenderStates {
            // No depth write, so the cones are occluded by geometry and never occlude each
            // other. Front faces only: with `Cull::None` the same pixel would be shaded
            // twice and go half as bright wherever geometry hides the far side of the shell.
            write_mask: WriteMask::COLOR,
            blend: Blend::ADD,
            depth_test: DepthTest::Less,
            cull: Cull::Back,
        }
    }

    fn material_type(&self) -> MaterialType {
        // Additive, so it must be drawn after the opaque set. `cmp_render_order` only does
        // that for a material that says it is transparent.
        MaterialType::Transparent
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::MANIFEST_PATH;

    fn manifest() -> Manifest {
        Manifest::load(crate::asset_path(MANIFEST_PATH)).expect("assets/scene.json")
    }

    /// The node table of the exported model. CPU only: no GL context is needed to walk it.
    fn nodes() -> std::collections::HashMap<String, Mat4> {
        let manifest = manifest();
        let path = crate::asset_path(&manifest.glb);
        let scene: CpuScene = three_d_asset::io::load_and_deserialize(&path).expect("the GLB");
        crate::scene::walk_scene(&scene).nodes
    }

    /// Every cone comes out of the scene data, and the two spots come out verbatim.
    #[test]
    fn beam_specs_come_from_the_scene() {
        let manifest = manifest();
        let nodes = nodes();
        let specs = beam_specs(&manifest, |n| nodes.get(n).copied());
        assert_eq!(specs.len(), SPOT_BEAM_LIGHTS.len() + MOVING_HEAD_COUNT as usize);

        let left = specs.iter().find(|s| s.name == "Beam_L").expect("Beam_L");
        let light = manifest.light("Beam_L").expect("Beam_L in the manifest");
        // `to_scene_point` / `to_scene_dir` are what `beam_specs` actually applies; asserting the
        // raw manifest value only reads as correct today because that map is currently the
        // identity.
        assert_eq!(left.apex, manifest.to_scene_point(light.position()));
        assert_eq!(left.axis, manifest.to_scene_dir(light.direction()));
        // The colour is the fixture's own, straight off the manifest, not a per-side tint.
        assert_eq!(left.color, light.color);
        let right = specs.iter().find(|s| s.name == "Beam_R").expect("Beam_R");
        let right_light = manifest.light("Beam_R").expect("Beam_R in the manifest");
        assert_eq!(right.color, right_light.color);
        // `Beam_L` and `Beam_R` carry the identical violet in `assets/scene.json`, so the two
        // cones are the same hue now.
        assert_eq!(left.color, right.color);
        // Blender spot_size 0.38397 is the full angle; the cone takes the half angle.
        assert!((left.half_angle - 0.191_986).abs() < 1.0e-4, "{}", left.half_angle);
        assert!((left.half_angle - light.spot_size * 0.5).abs() < 1.0e-6);
    }

    /// All twelve truss lenses resolve, and every one of them aims downward. A cone pointing
    /// up would mean the local aim axis is wrong for the exported frame.
    #[test]
    fn every_moving_head_aims_down() {
        let manifest = manifest();
        let nodes = nodes();
        let specs = beam_specs(&manifest, |n| nodes.get(n).copied());
        let heads: Vec<&BeamSpec> = specs.iter().filter(|s| s.name.starts_with("MH_")).collect();
        assert_eq!(heads.len(), MOVING_HEAD_COUNT as usize);
        for head in heads {
            assert!(
                head.axis.y < -0.3,
                "{} aims {:?}, which is not downward",
                head.name,
                head.axis
            );
            // The truss ring hangs above the stage; the lens is up there with it.
            assert!(head.apex.y > 5.0, "{} sits at {:?}", head.name, head.apex);
            assert!((head.axis.magnitude() - 1.0).abs() < 1.0e-5);
            assert!(head.half_angle > 0.0);
        }
    }

    /// The cone transform has to keep its handedness, or `Cull::Back` drops every triangle
    /// and the beams vanish.
    #[test]
    fn cone_transformation_is_right_handed_and_lands_on_the_axis() {
        let spec = BeamSpec {
            name: "test".to_string(),
            apex: vec3(1.0, 7.0, -2.0),
            axis: vec3(0.3, -0.9, 0.31).normalize(),
            length: 6.0,
            half_angle: 0.19,
            color: [1.0, 1.0, 1.0],
        };
        let m = cone_transformation(&spec);
        assert!(m.determinant() > 0.0, "handedness flipped");
        // The local apex maps to the spec's apex.
        let apex = (m * vec4(0.0, 0.0, 0.0, 1.0)).truncate();
        assert!((apex - spec.apex).magnitude() < 1.0e-5);
        // The local base centre maps to the far end of the axis.
        let tip = (m * vec4(0.0, 0.0, 1.0, 1.0)).truncate();
        let want = spec.apex + spec.axis * spec.length;
        assert!((tip - want).magnitude() < 1.0e-4, "{tip:?} vs {want:?}");
        // A local rim point maps to the rim: radius = length * tan(half angle) from the axis.
        let rim = (m * vec4(1.0, 0.0, 1.0, 1.0)).truncate();
        let radius = (rim - want).magnitude();
        assert!(
            (radius - spec.length * spec.half_angle.tan()).abs() < 1.0e-4,
            "{radius}"
        );
    }

    /// The mesh is a closed fan of `segments` triangles wound outward.
    #[test]
    fn cone_mesh_is_wound_outward() {
        let mesh = cone_mesh(8);
        assert_eq!(mesh.positions.len(), 24);
        mesh.validate().expect("a valid cone");
        let p = match &mesh.positions {
            Positions::F32(p) => p.clone(),
            _ => panic!("expected f32 positions"),
        };
        // First triangle: apex, then two rim points. Its normal must point away from the axis.
        let normal = (p[1] - p[0]).cross(p[2] - p[1]);
        let outward = (p[1] + p[2]) * 0.5 - vec3(0.0, 0.0, p[1].z);
        assert!(normal.dot(outward) > 0.0, "the cone is wound inward");
        // Degenerate segment counts are clamped, not accepted.
        assert_eq!(cone_mesh(0).positions.len(), 9);
    }

    /// The PAR cans come out of `Truss_Par_Lens`'s own vertices: 24 lamps on one ring, at the
    /// radius and height the mesh has, each with a cone that stays inside the room. This is the
    /// only fixture set in the file whose positions are measured from geometry rather than read
    /// off a node transform, so it is the one that needs a test.
    #[test]
    fn par_cans_cluster_into_one_ring_of_lamps() {
        let manifest = manifest();
        let path = crate::asset_path(&manifest.glb);
        let scene: CpuScene = three_d_asset::io::load_and_deserialize(&path).expect("the GLB");
        let walked = crate::scene::walk_scene(&scene);
        let positions = par_lens_positions(walked.parts.iter().filter_map(|p| {
            (p.name == PAR_LENS_NODE).then_some((&p.mesh, p.transformation))
        }));
        assert!(!positions.is_empty(), "no {PAR_LENS_NODE} in the GLB");

        let apexes = par_lamp_apexes(&positions);
        assert_eq!(apexes.len(), 24, "{PAR_LENS_NODE} is 24 islands");
        // One ring: same height, same radius about the room's axis, and no two lamps closer than
        // the clustering radius.
        // One ring: all 24 at the same height, and every lamp's nearest neighbour one can-pitch
        // away. The pitch is what catches a cluster that has run away or swallowed a neighbour,
        // and it is a better check here than the radius: `Truss_Par_Lens` carries a node
        // translation of `(0, 0, -0.5)`, so the ring is 0.5 m off the room's axis and its lamps
        // sit at radii from 5.9 to 6.45 m by design.
        let radius = |p: Vec3| (p.x * p.x + p.z * p.z).sqrt();
        let mean_radius: f32 =
            apexes.iter().map(|a| radius(*a)).sum::<f32>() / apexes.len() as f32;
        assert!((5.4..6.7).contains(&mean_radius), "ring radius {mean_radius}");
        for a in &apexes {
            assert!((a.y - apexes[0].y).abs() < 0.1, "{a:?} is off the ring's plane");
            let nearest = apexes
                .iter()
                .filter(|b| !std::ptr::eq(*b, a))
                .map(|b| (a - b).magnitude())
                .fold(f32::MAX, f32::min);
            assert!(
                (1.3..1.8).contains(&nearest),
                "{a:?} is {nearest} m from its nearest neighbour, not one can pitch"
            );
        }

        // Every cone points downward, leans by the constant, and dies inside the cyclorama at
        // 11.3 m and above the floor.
        let specs = par_beam_specs(&manifest, &positions);
        assert_eq!(specs.len(), apexes.len());
        let up = crate::scene::WORLD_UP;
        for spec in &specs {
            assert!(spec.axis.y < -0.5, "{} aims {:?}", spec.name, spec.axis);
            let lean = (spec.axis - up * up.dot(spec.axis))
                .magnitude()
                .atan2(-up.dot(spec.axis));
            assert!((lean - PAR_BEAM_LEAN).abs() < 1.0e-4, "{} leans {lean}", spec.name);
            let end = spec.apex + spec.axis * spec.length;
            assert!(radius(end) < 11.3, "{} ends {} m out", spec.name, radius(end));
            assert!(end.y > 1.5, "{} reaches down to {}", spec.name, end.y);
        }
    }

    /// Every truss cone leaves the fixture heading for the stage, at a lean inside the 20 to 35
    /// degrees off vertical agent C measured, and it keeps a per-fixture lean rather than all
    /// twelve coming out parallel.
    #[test]
    fn truss_cones_lean_into_the_arena() {
        let manifest = manifest();
        let nodes = nodes();
        let centre = manifest.wheel.pivot();
        let up = crate::scene::WORLD_UP;
        let mut leans = Vec::new();
        for spec in beam_specs(&manifest, |n| nodes.get(n).copied())
            .iter()
            .filter(|s| s.name.starts_with("MH_"))
        {
            let lean = (spec.axis - up * up.dot(spec.axis))
                .magnitude()
                .atan2(-up.dot(spec.axis))
                .to_degrees();
            assert!(
                (18.0..=36.0).contains(&lean),
                "{} leans {lean} degrees off vertical",
                spec.name
            );
            // Horizontally, the cone turns toward the stage. See `BEAM_AIM_INWARD`: aimed
            // outward, a cone from a lens 10.3 m out has 1.0 m before the cyclorama at 11.3 m and
            // the depth test cuts it off there, which is why round 2 could find no head cone in
            // the frame at 25x strength.
            let horizontal = (spec.axis - up * up.dot(spec.axis)).normalize();
            let to_centre = centre - spec.apex;
            let bearing = (to_centre - up * up.dot(to_centre)).normalize();
            assert!(
                horizontal.dot(bearing) > 0.0,
                "{} points {horizontal:?}, which is outward, not toward the stage",
                spec.name
            );
            // The far end must be inside the LED wall at 11.3 m, so no cone is cut off mid-shaft.
            // Aimed inward this is slack by metres rather than by centimetres.
            let middle = spec.apex + spec.axis * spec.length;
            let radius = (middle - up * up.dot(middle)).magnitude();
            assert!(
                radius < 11.3,
                "{} ends {radius} m out, past the LED wall",
                spec.name
            );
            leans.push((lean * 10.0) as i32);
        }
        leans.sort_unstable();
        leans.dedup();
        assert!(leans.len() > 1, "every cone came out at the same lean");
    }

    /// The swing keeps the fixture's steepness scaled and only turns its bearing.
    #[test]
    fn swing_keeps_the_lean_and_turns_the_bearing() {
        let up = vec3(0.0, 1.0, 0.0);
        let apex = vec3(10.0, 6.0, 0.0);
        // 45 degrees off vertical, pointing away from the origin.
        let aim = vec3(1.0, -1.0, 0.0).normalize();
        let swung = swing_into_arena(apex, aim, vec3(0.0, 0.0, 0.0), up, 1.0);
        assert!((swung.magnitude() - 1.0).abs() < 1.0e-6);
        // Same 45 degrees down, opposite bearing: now heading at the target.
        assert!((swung.y + std::f32::consts::FRAC_1_SQRT_2).abs() < 1.0e-5, "{swung:?}");
        assert!((swung.x + std::f32::consts::FRAC_1_SQRT_2).abs() < 1.0e-5, "{swung:?}");
        // Half the lean is half the angle off vertical, not half the vector.
        let half = swing_into_arena(apex, aim, vec3(0.0, 0.0, 0.0), up, 0.5);
        assert!((half.y + (22.5_f32).to_radians().cos()).abs() < 1.0e-5, "{half:?}");
        // A fixture directly over the target has no bearing to turn to, so it points down.
        assert_eq!(
            swing_into_arena(vec3(0.0, 6.0, 0.0), aim, vec3(0.0, 0.0, 0.0), up, 0.6),
            -up
        );
    }

    /// Every truss fixture's cone takes its colour from `MAT_Lens_Glow`, not from which side of
    /// the frame it hangs on.
    #[test]
    fn truss_cones_take_their_colour_from_the_manifest() {
        let manifest = manifest();
        let want = manifest
            .material("MAT_Lens_Glow")
            .expect("MAT_Lens_Glow")
            .base_color;
        assert_eq!(truss_fixture_color(&manifest), want);

        let nodes = nodes();
        let heads: Vec<BeamSpec> = beam_specs(&manifest, |n| nodes.get(n).copied())
            .into_iter()
            .filter(|s| s.name.starts_with("MH_"))
            .collect();
        assert!(!heads.is_empty(), "no MH_ cones resolved");
        for head in &heads {
            assert_eq!(
                head.color, want,
                "{} did not take MAT_Lens_Glow's colour",
                head.name
            );
        }
    }

    /// The bloom targets are half res and never zero-sized, whatever the window does.
    #[test]
    fn bloom_targets_are_never_degenerate() {
        assert_eq!(bloom_size(1672, 941), (836, 470));
        assert_eq!(bloom_size(1, 1), (1, 1));
        assert_eq!(bloom_size(0, 0), (1, 1));
    }
}
