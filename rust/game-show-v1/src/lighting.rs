//! The six Blender lights as three-d lights, an ambient environment term, and the shadow
//! map on the key light.
//!
//! Owner: agent H. The public surface is [`Rig::build`], [`Rig::lights`],
//! [`Rig::generate_shadow_maps`] and [`Rig::update`]. `docs/api/lighting.md` states the
//! signatures and the units; agent L wires the module from that file.
//!
//! # What three-d gives us to work with
//!
//! Read out of `three-d` 0.19.0's own source, not assumed:
//!
//! - There is no area light. Four of the six Blender lights are AREA, so four substitutions
//!   have to be chosen. [`Rig::build`] documents each one.
//! - `intensity` is a plain multiplier on the linear light colour. Every light does
//!   `program.use_uniform("colorN", self.color.to_linear_srgb().truncate() * self.intensity)`
//!   and nothing divides by 4π, by area, or by anything else.
//! - `light_shared.frag`'s `calculate_light` returns
//!   `(diffuse + specular) * light_color * NdL` with `diffuse = albedo / PI`. So for a
//!   Lambertian surface facing the light the outgoing radiance is `intensity * color / PI`,
//!   which is exactly Blender's `albedo * E / PI`. **That fixes the unit: `color * intensity`
//!   is the irradiance `E` arriving at the surface, in whatever linear unit the renderer
//!   works in.** The watt conversion below follows from that identity and is not a guess.
//! - `Attenuation::default()` is no falloff at all, and the shader's `max(1.0, att)` means
//!   attenuation can only ever dim. See [`Rig::build`] for why every light keeps the default.
//! - Only `DirectionalLight` and `SpotLight` can carry a shadow map.
//! - `SpotLight::cutoff` is the HALF angle. Blender's `spot_size` is the FULL angle, and
//!   `assets/scene.json` already halves it into `cone_outer_half_angle_rad`.
//! - Light colours are `Srgba`, four `u8`s holding sRGB-encoded values, so they go through
//!   [`crate::scene::linear_to_srgba`]. The `u8` round trip costs about 0.2% on the darkest
//!   channel of `Beam_L`; nothing in `PhysicalMaterial` or `Light` takes a float colour.
//!
//! # The watt-to-intensity conversion
//!
//! `calculate_light` puts `color * intensity` in the place of irradiance, so the conversion
//! is the irradiance a Blender lamp of `P` watts delivers at one reference distance `d`:
//!
//! | Blender lamp | Emission model | On-axis irradiance at `d` |
//! | --- | --- | --- |
//! | AREA, total flux `P` | Lambertian emitter, peak radiant intensity `P / PI` | `P / (PI * d²)` |
//! | SPOT, total flux `P` | point source over the full sphere, masked by the cone | `P / (4 * PI * d²)` |
//!
//! The spot divides by `4 * PI` because Blender spreads a spot's power over the whole sphere
//! and then masks it with the cone, which is why narrowing a Blender spot does not brighten
//! it.
//!
//! `d` is the distance from the lamp to `Wheel_Root`, `(0, 3.5, -1.2)` in the glTF frame,
//! for every light. One reference point keeps the rule readable, and the wheel is what the
//! reference image is exposed for. The cost is that three-d then applies no falloff away
//! from that distance, which is the price of having no area light and of
//! `Attenuation`'s `max(1.0, att)` clamp.
//!
//! The six constants below are the result. Each one is `1 / (PI * d²)` or
//! `1 / (4 * PI * d²)` with the arithmetic spelled out, and each is the single number
//! look-dev retunes for that light.
//!
//! # The ambient term
//!
//! Blender's world is a plain Background node at `(0.01, 0.008, 0.02)` linear, so there is
//! no HDRI and the ambient level is a judgement call. It is still not optional, for the
//! reason `src/scene.rs` sets out at length: a plain `AmbientLight` computes
//! `occlusion * ambientColor * mix(surface_color, vec3(0.0), metallic)`, which is exactly
//! zero at `metallic = 1`, and five of the nineteen materials are fully metallic. With a
//! plain ambient the hub, the rim pegs and the truss render black except for direct
//! specular, and `docs/wheel_stage.png` has them bright.
//!
//! So the ambient light gets an environment map, which takes the other branch of that
//! shader and computes an IBL diffuse *and* specular. There is no HDRI and no network, so
//! [`environment_cube_map`] generates one: a horizon band holding the LED wall's own
//! emission, the Blender world background above it, and the wall colour times the floor
//! albedo below it. Every colour and every angle in it comes out of `assets/scene.json` or
//! out of `docs/scene_audit.md`'s measurements of the wall. [`AMBIENT_INTENSITY`] is the one
//! scalar that sets the level, and its doc comment says why it is 0.28.
//!
//! # What look-dev round 1 changed here
//!
//! Four things, each behind a named constant so the physical derivation above is still what the
//! numbers come from:
//!
//! - [`RIM_LOOK_GAIN`], [`KEY_LOOK_GAIN`] and [`FILL_LOOK_GAIN`] scale three of the six lamps.
//!   The rims carry the reference's left/right colour split and were too weak to;
//!   the key and the fill were between them making the frame read as pastel daylight.
//! - [`AMBIENT_INTENSITY`] came down from 0.45.
//! - [`ENVIRONMENT_LEFT_TINT`] and [`ENVIRONMENT_RIGHT_TINT`] give the environment cube map an
//!   azimuthal hue swing, which is what puts that split onto the metals.
//! - [`BULB_RING_INTENSITY`] adds a seventh light that is not in the .blend: the wheel's own
//!   96-bulb channel, which `docs/look_target.md` names as the source of the truss's rim light
//!   and of the floor's bright patch.

use crate::manifest::{LightSpec, Manifest};
use crate::scene::linear_to_srgba;
use three_d::*;

// ---------------------------------------------------------------------------------------
// Watts to intensity: one constant per light. These are what look-dev retunes.
//
// Every constant is `intensity = CONSTANT * energy_watts`, with `energy_watts` read from
// `assets/scene.json`. The module docs derive the two formulas; the arithmetic for each
// light is in its own comment so a changed number can be checked against it.
// ---------------------------------------------------------------------------------------

/// `Key_Wheel`, AREA, 900 W. Lamp at `(0, 6, 5)`, wheel at `(0, 3.5, -1.2)`, so
/// `d = 6.6851 m` and `d² = 44.690`. `1 / (PI * 44.690) = 0.007123`.
///
/// Gives `intensity = 6.411`, i.e. a white Lambertian surface facing the key comes out at
/// radiance `6.411 / PI = 2.04`, well into Filmic's shoulder. The reference has the cream
/// and white sectors reading near-white, so that is the intent.
pub const KEY_WHEEL_WATTS_TO_INTENSITY: f32 = 0.007_123;

/// `Beam_L`, SPOT, 2500 W. Lamp at `(-6.5, 7.2, 3)`, so `d = 8.5779 m` and
/// `d² = 73.580`. `1 / (4 * PI * 73.580) = 0.001082`. Gives `intensity = 2.705`.
pub const BEAM_L_WATTS_TO_INTENSITY: f32 = 0.001_082;

/// `Beam_R`, SPOT, 2500 W. Mirror of `Beam_L` at `(6.5, 7.2, 3)`, same `d`, same value.
/// Kept as its own constant so the two beams can be tuned apart: the reference's two
/// upper-right cones are amber and brighter than the left-hand ones.
pub const BEAM_R_WATTS_TO_INTENSITY: f32 = 0.001_082;

/// `Rim_L`, AREA, 400 W. Lamp at `(-8, 3.5, -3.5)`, so `d = 8.3241 m` and `d² = 69.290`.
/// `1 / (PI * 69.290) = 0.004594`. Gives `intensity = 1.838`.
pub const RIM_L_WATTS_TO_INTENSITY: f32 = 0.004_594;

/// `Rim_R`, AREA, 400 W. Mirror of `Rim_L` at `(8, 3.5, -3.5)`, same `d`, same value.
pub const RIM_R_WATTS_TO_INTENSITY: f32 = 0.004_594;

/// `Fill_Front`, AREA, 120 W. Lamp at `(0, 2, 7.5)`, so `d = 8.8284 m` and `d² = 77.940`.
/// `1 / (PI * 77.940) = 0.004084`. Gives `intensity = 0.490`, a sixth of the front key,
/// which is what a 120 W fill against a 900 W key should be.
pub const FILL_FRONT_WATTS_TO_INTENSITY: f32 = 0.004_084;

// ---------------------------------------------------------------------------------------
// Look-dev round 1 gains. These sit on top of the physical conversion above rather than
// replacing it, so `the_constants_match_the_documented_arithmetic` still checks the physics
// and every deviation from the .blend is one named multiplier.
// ---------------------------------------------------------------------------------------

/// Multiplier on `Rim_L` and `Rim_R`'s converted intensity.
///
/// `renders/verdict_r1.json`: "the frame has no left/right colour split ... Rim_L (blue) and
/// Rim_R (pink) are only a sixth of the key's strength, so nothing puts the split onto the
/// metals or the wall". `docs/look_target.md` calls that split load-bearing. The two rims are
/// the only lamps whose colour differs by side — `(0.35, 0.55, 1)` against `(1, 0.3, 0.65)` —
/// so they are what carries it, and at 1.84 against the key's 6.41 they could not. 2.4 puts
/// them at 4.4, which is the same order as the key and still under it: the key stays the
/// light that shapes the wheel and the rims tint the sides.
///
/// Round 2 took it from 2.4 to 1.30. The round's severity-5 defect was that nothing in the set is
/// dark — "the pillar in `screen_left` is a pale grey-lavender fluted column, plainly brighter
/// than the wall behind it ... the podium body panels read mid-brown and half translucent ... the
/// truss chords read as fully shaded solid tubes" — and the rims are half of the cause. They are
/// `DirectionalLight`s, so they cannot fall off with distance the way [`spot_attenuation`] now
/// makes the three spots do: a rim at 4.4 lights the pillar half a metre from it exactly as hard
/// as it lights the wheel 8 m away, and `MAT_Pillar_Body`'s albedo is 0.09. At 1.30 the pair land
/// at 2.4, which still tints the side of every metal and no longer form-shades the set.
///
/// Round 3 took it from 1.30 to 1.95, and it is the one constant of this file the round asked to move.
/// Round 2 cut this and [`AMBIENT_INTENSITY`] together and the verdict was that only half of what it
/// asked for landed: "Both pillars lost their highlights. Each is a flat near-black fluted column with
/// only a faint bronze collar ... ours reads as a hole cut in the wall. Round 2 asked for a pillar
/// darker than the screen that keeps that gold highlight and got only the first half."
///
/// The two terms are not interchangeable and that is why the fix is to separate them. The ambient is
/// an environment probe: it reaches every surface from every direction, so it can only raise a form's
/// general level and can never draw a line on it. The rims are two `DirectionalLight`s from `(-8, 3.5,
/// 3.5)` and `(8, 3.5, 3.5)`, so what they make is a specular — the pillar's vertical gold stripe just
/// right of its centre, the podium's rib highlights, the small white specular on the upper left of each
/// chrome peg. Round 2's ambient cut was right and is kept; this is the specular put back without it.
/// At 1.95 the pair land at 3.6, still under the key's 5.6 and well under the 4.4 round 1 shipped,
/// where they form-shaded the whole set.
///
/// Round 5 took it from 1.95 to 2.85, and this is the fourth-asking pillar highlight finally landing. The
/// verdict offered this constant or the environment band; the band was ruled out by measurement, because
/// at [`ENVIRONMENT_BAND_GAIN`] = 20, eight times what ships, the pillar was still black. What draws the
/// reference's vertical stripe on a chrome cylinder is a *punctual* specular, and the two rims are the
/// only lamps placed to put one down a pillar's front-inner face. `crate::scene::NODE_LIFTS` widened
/// `MAT_Pillar_Body`'s roughness in the same edit so that lobe is broad enough to read as a stripe rather
/// than a hairline. Round 2's reason for cutting this — that the rims form-shaded the whole set — is
/// answered by the metallic in the same lift: the surfaces this now reaches hardest are metals, whose
/// ambient diffuse is zero, so what it adds to them is a highlight and not a fill. The pair land at 5.3,
/// just under the key's 5.6.
pub const RIM_LOOK_GAIN: f32 = 2.85;

/// Multiplier on `Key_Wheel`'s converted intensity.
///
/// Below 1.0. The physical conversion puts a white sector at radiance 2.04, well into Filmic's
/// shoulder, and round 1 was judged "a pale pastel daylight render": on the shoulder a gold
/// sector's red and green channels converge and `(0.95, 0.64, 0.08)` reads khaki instead of
/// gold. Pulling the key back to 4.5 keeps the cream and white sectors near-white while the
/// coloured ones stay off the shoulder, which is where their saturation lives. The reference's
/// own note is that the run from a lit metal edge to its shadow side is short and that
/// saturation is high.
///
/// Round 2 took it from 0.70 to 0.95. Nothing about the shoulder argument changed; what changed
/// under it is [`spot_attenuation`], which now divides the key by `(d / 6.685)²` past the wheel.
/// The wheel itself sits at the reference distance and is undimmed, so the sectors need the gain
/// back to stay where round 2 judged them ("much improved ... the cobalt sector is back"), while
/// the wall 17 m away now takes a sixth of what it used to and the pillars at 11 m a third.
pub const KEY_LOOK_GAIN: f32 = 0.88;

/// Multiplier on `Fill_Front`'s converted intensity. The reference's blacks are lifted and
/// plum-tinted rather than crushed, but 0.49 of flat frontal fill on top of a full ambient was
/// part of what flattened the pillars and the podium panels — the reference reads both as dark
/// silhouettes drawn with gold lines. A third of it still keeps the hub and the pegs off black,
/// which is the fill's stated job.
///
/// Round 2 took it from 0.35 to 0.16. It is the last flat term in the rig — a `DirectionalLight`
/// pointed straight at the camera-facing side of everything — so it is what was left holding the
/// podium panels, the moving-head bodies and the pillars off black once the ambient came down.
/// 0.16 of 0.49 is 0.08, which still keeps the chrome pegs and the hub off pure black (its stated
/// job) and no longer form-shades a 0.05-albedo fixture body into a pale grey box.
pub const FILL_LOOK_GAIN: f32 = 0.16;

/// Intensity of the `BULB_RING` point light, the wheel's own bulb channel acting as a lamp.
///
/// This light is not in `wheel_stage.blend` and it is not invented either: 96 emissive spheres
/// of `MAT_Bulb_Glass` ring the wheel at radius 2.48 m, and after look-dev round 1 raised that
/// material to an emission of 9.0 they are by far the brightest thing in the room.
/// `docs/look_target.md` §"Light directions" is explicit about what they do — "The truss tubes
/// are rim-lit from below and in front, and the source for that is the wheel's own bulb ring
/// rather than any lamp. The floor's brightest area sits directly under the wheel, so the
/// wheel's bulb ring plus the front key dominate what reaches the floor" — and
/// `renders/verdict_r1.json` asks for exactly that: "let that ring be what rim-lights the
/// underside of the rim, the pegs and the floor".
///
/// **Round 2 stopped collapsing the ring to one point.** The paragraph below describes what round 1
/// did and what it cost: a single lamp on the wheel's axis 0.35 m in front of the hub, whose
/// attenuation `max(1.0, 1 + q·d²)` cannot dim anything nearer than its reference distance, so the
/// hub and the inner ends of the 48 sectors took the full intensity head-on from 0.35 m while the
/// rim 2.5 m away took a fraction of it. That is a flat frontal white term over saturated albedo,
/// exactly the thing round 2's verdict named for the sector fan — "the reference's hot magenta is a
/// dusty rose here, its cobalt a slate periwinkle, its cyan a mint, its gold a khaki" — and it is
/// also why the round found the hub's lobe "centred and radially symmetric, reading as a small lamp
/// behind the middle of the disc". It was one.
///
/// The ring is now [`BULB_RING_LAMPS`] point lights spaced round a circle of
/// [`BULB_RING_RADIUS`], which is where the 96 bulbs are. The intensity below is the ring's total
/// and each lamp takes a [`BULB_RING_LAMPS`]-th of it. Same flux at the floor and at the truss,
/// where the ring's own extent does not matter; at the hub the light now arrives from 2.45 m out on
/// every side instead of from 0.35 m in front, so the disc is lit across rather than flooded, and
/// the sectors keep their chroma.
///
/// A ring cannot be a point source, so the ring is collapsed to its centre and the intensity
/// starts from what the ring delivers at the floor 3.5 m below: 96 bulbs of area ~0.0113 m² at
/// radiance 1.7 is a flux of about 1.8 W-equivalent, which over the hemisphere it can reach is
/// `1.8 / (PI * 3.5²) = 0.047`. It is 0.9 rather than that, and the factor is not free: the
/// collapse to a point throws away the ring's 5 m span, [`BULB_RING_ATTENUATION`] dims it again
/// by 1.6 at that distance, and the bulbs also carry the frame's bloom, which the derivation of
/// a Lambertian flux does not. This is the light every gold surface in the frame is read by, so
/// it is judged on the rim_top, floor and podium crops rather than on that number.
///
/// Round 2 took it from 0.9 to 2.1 and raised [`BULB_RING_ATTENUATION`] with it. The reference
/// gives every gold surface in the frame a bright warm line with a dark side, and after round 2
/// cut the ambient and the fill there is nothing else warm and local in the room to make one:
/// `MAT_Gold_Trim` is `metallic = 0.75`, and a metal with no light on it is black, which is what
/// round 1 was judged on ("the podium desk band ... a dark maroon-brown rim", "the floor inlays
/// thin cool cyan lines rather than crisp warm gold arcs"). Raising the ring and steepening its
/// falloff together is what puts a warm highlight on the rim, the base plate, the podium trim and
/// the floor inlays while leaving the LED wall and the pillars where the reference has them.
pub const BULB_RING_INTENSITY: f32 = 0.95;

/// How many point lights stand in for the ring of 96 bulbs. See [`BULB_RING_INTENSITY`].
///
/// 8. The bulbs are effectively continuous — 96 of them 3.8° apart — so what this number has to be
/// large enough for is the *near* field: a lamp every 45° puts one 1.93 m from the next, and the
/// rim, the pegs and the crest are all within 0.3 m of the ring, so each of them is lit mostly by
/// its nearest one or two. That gives the rim a highlight that varies round its circumference,
/// which is what `docs/look_target.md` §"Region 2" asks for — "the apex of the rim reads slightly
/// cooler and dimmer than the rim at ten o'clock and two o'clock". It also costs eight lights in
/// every material's shader, which is the reason not to make it 24.
pub const BULB_RING_LAMPS: usize = 8;

/// Radius of the bulb ring, in metres, measured from `Wheel_Bulbs` in the GLB: its vertices span
/// local radius 2.424 to 2.484 about the wheel's own axis, so the channel's centre line is 2.454.
pub const BULB_RING_RADIUS: f32 = 2.454;

/// Colour of the `BULB_RING` light: `MAT_Bulb_Glass`'s own emission colour, normalised.
/// Warm lemon, the hue the reference's rim channel and its gold speculars clip to.
pub const BULB_RING_COLOR: [f32; 3] = [1.0, 0.9, 0.62];

/// Attenuation of the `BULB_RING` light: `constant`, `linear`, `quadratic`.
///
/// The only light in the rig that gets one, and it needs it for the reason the module docs give
/// for everyone else keeping the default: `attenuate` divides by `max(1.0, att)`, so a
/// quadratic term can only dim, and it dims by distance from the wheel's centre. That is
/// exactly right here — the bulb ring is a local source 2.5 m across in a 24 m room, and it
/// must fall off before it reaches the LED wall or the pillars, which the reference keeps as
/// dark silhouettes. At the floor under the wheel (3.5 m) this divides by 1.6, at the truss
/// ring (5.5 m) by 2.5, and at the wall (11 m) by 7.1.
///
/// Round 2 took the quadratic term from 0.05 to 0.09, which is `1 / 3.33²`: the ring is now
/// normalised at the floor directly under the wheel rather than a little short of it. At the floor
/// (3.5 m) this divides by 2.1, at the truss ring (5.5 m) by 3.7, at the pillars (8 m) by 6.8 and
/// at the wall (11 m) by 11.9. That last number is the point of the change — the ring got 2.3x
/// brighter to light the gold, and the wall and the pillars must not get 2.3x brighter with it.
pub const BULB_RING_ATTENUATION: [f32; 3] = [1.0, 0.0, 0.09];

/// How far in front of the wheel's pivot the `BULB_RING` light sits, in metres along +Z.
///
/// The bulbs face the camera on the front of the rim, so their light belongs in front of the
/// pivot rather than at it: at the pivot the wheel's own back plate would take half of it and
/// the rim would be lit from inside. 0.35 m is the rim channel's own offset from the wheel
/// plane (`docs/scene_audit.md` §1: `Wheel_Bulbs` spans y −0.33 to −0.27 in Blender, i.e.
/// 0.27 to 0.33 m toward the camera in the exported frame).
///
/// Round 4 took it from 0.35 to 0.80, which is further forward than any bulb actually is, and the
/// reason is the `N-L` gradient across the sector fan rather than the bulbs' own position. Eight point
/// lights sitting 0.35 m in front of a ring of radius 2.45 m are nearly *in the plane* of the fan: a
/// wedge's outer end has a lamp 0.4 m away and almost face-on, its inner end has one 2.5 m away and at
/// 8 degrees of grazing, so the fan is lit about ten times harder at the rim than at the hub. That
/// gradient is what the round-4 verdict saw as "a wide warm halo washes about 40 px up into the lower
/// sectors" and as "the magenta washes toward salmon on its inner half" - one wash, read twice. At
/// 0.80 m the same ratio is 2.8, so the fan keeps its chroma from rim to hub, and the ring still
/// reaches the truss underside and the floor, which is this light's stated job.
pub const BULB_RING_FORWARD: f32 = 0.80;

/// Whether the three spot lights fall off with distance past the reference distance their
/// watts-to-intensity constant was calibrated at. See [`spot_attenuation`].
///
/// `true`, and this is the round-2 fix for the frame's biggest defect. Every lamp used to carry
/// `Attenuation::default()`, i.e. none, on the argument that the conversion constants already bake
/// `1 / d²` in at one distance. They do — and that is the whole problem, because one distance is
/// the *wheel's*. With no falloff `Key_Wheel` puts the same 4.5 on the LED wall 17 m away that it
/// puts on the wheel 6.7 m away, and the reference has nothing of the kind: it lights the wheel and
/// leaves the set black.
///
/// It is also what drew the artefact round 2 attributed to the SPOT cones — "a lighter-value
/// quadrilateral crosses the wall band and the floor to the right of the wheel with a crisp
/// vertical boundary at about frame x 1270, and a mirrored one sits left of the wheel". Rendering
/// with `Stages::beams` off leaves it exactly where it was, so it is not a cone. It is
/// `Key_Wheel`'s own lit cone landing on the cyclorama: the key's axis meets the floor 11.6 m out
/// and [`KEY_WHEEL_CUTOFF`] of 0.8 rad puts the cone's edge 4.9 m either side of it, which projects
/// to frame x 366 and x 1306 through a 22 mm lens. The wheel hides the middle, so one wedge reads
/// as two. Falling the key off past the wheel is what removes it.
pub const SPOT_DISTANCE_FALLOFF: bool = true;

// ---------------------------------------------------------------------------------------
// Shape and level constants.
// ---------------------------------------------------------------------------------------

/// Half-angle of the cone that stands in for `Key_Wheel`'s 4 m square area light, radians.
///
/// Two things ride on this number and they pull in the same direction.
///
/// 1. The lit cone. three-d's spot shader lights a fragment when the angle off the axis is
///    below `cutoff` and softens it with `smoothstep(0.75 * cutoff, cutoff, angle)`. At 0.8 rad
///    the flat core reaches 0.6 rad, i.e. 34° off axis. The wheel subtends 21° from this lamp,
///    so it sits entirely inside the core; the two pillars sit at 35°, just past it, and take
///    the soft edge instead of the full beam.
///
///    That last number is why this is 0.8 and not the 1.0 it was. At 1.0 the core reached 43°
///    and both pillars were inside it at full strength, which is what round 1's verdict called
///    out: "the render pillar is a pale pink-grey cylinder lighter than the screen, fully
///    form-shaded, with no dark side at all", where the reference reads it as a dark silhouette
///    drawn with two gold stripes. `MAT_Pillar_Body`'s albedo is 0.09; nothing but a lamp
///    pointed straight at it can make it read as mid-grey, and measured against the ambient and
///    the rims by rendering with each turned down, the key was the lamp doing it.
/// 2. The shadow frustum. `SpotLight::generate_shadow_map` builds its shadow camera with
///    `field_of_view_y = cutoff`, so the frustum's half-angle is `cutoff / 2`, half the lit
///    cone. At 0.4 rad that is a 2.85 m radius at the wheel's 6.69 m, which still covers the
///    2.6 m wheel, and 5.0 m where the axis meets the floor. This is the floor under the
///    cutoff: a tighter cone would clip the shadow map, and `is_visible` returns unshadowed
///    outside it, so the clip would show as a shadow that stops mid-floor.
pub const KEY_WHEEL_CUTOFF: f32 = 0.8;

/// Ambient environment level: the multiplier on the generated environment map.
///
/// The map holds the room's own linear radiance, so 1.0 would be the fully physical answer
/// and needs no free gain at all. It is 0.45 because the band radiance the map is built
/// from, `MAT_LED_Screen`'s `effective_emission` of `(0.525, 0.45, 0.9)`, is the *pre-texture*
/// node value: the shader multiplies emission by `T_LEDWall_Sky`, whose mean is well below
/// 1.0 (dark cobalt over most of its area, bright only in the cloud tops). 0.45 is a mid
/// estimate of that mean, and it also covers the truss, the pillars and the fascia
/// occluding part of the wall.
///
/// The consequence to check on a crop: gold at roughness 0.22 whose reflection vector points
/// at the band comes out near `0.28 * 0.9 * 0.7 = 0.18` and reads as a dark warm-violet
/// tint, while gold facing the ceiling void reflects `0.28 * 0.02 = 0.006` and stays black.
/// Shadowed metal stays dark; it just stops being pure black. Raising this washes the
/// metals out flat, which is the failure mode to watch for.
///
/// Look-dev round 1 took it from 0.45 to 0.28. That failure mode is what the round was judged
/// on: "the sector fan is pastel", "a saturated albedo plus a large white additive term always
/// reads pastel", and a hub that had become "a violet-magenta ball" because a near-mirror metal
/// in a violet room can be nothing else. Two things changed under it at the same time, and both
/// argue for less: `src/screen.rs` stopped drawing the LED wall as albedo *plus* emission, so
/// the room is genuinely darker than the band value suggests, and [`BULB_RING_INTENSITY`] now
/// supplies the warm local light the ambient was standing in for.
/// Round 2 took it from 0.28 to 0.10, and the failure mode named above is exactly what the round
/// was judged on again, one step further along: "Nothing in the set is dark ... All four use dark
/// materials in scene.json already, so the light reaching them is wrong, not their albedo." An
/// environment term is the one term in the rig that reaches every surface from every direction at
/// once, so it is the term that cannot make a silhouette. The reference's whole contrast structure
/// is saturated coloured light on near-black forms, and 0.10 is the level at which
/// `MAT_Pillar_Body` at albedo 0.09 goes back to reading as a form with a dark side.
pub const AMBIENT_INTENSITY: f32 = 0.18;

/// Multiplier on the wall band of the environment probe, and on that band alone.
///
/// The band's radiance comes from `MAT_LED_Screen`'s `effective_emission`, `(0.525, 0.45, 0.9)`, and
/// [`AMBIENT_INTENSITY`]'s own note explains why 0.18 was chosen on top of it: that emission is the
/// *pre-texture* node value and the picture that multiplies it has a mean well below 1.0. Both halves
/// of that reasoning are right and the conclusion from them was wrong, because `src/screen.rs` does
/// not draw the wall at the node value either. It draws it at
/// `art * EMISSIVE_STRENGTH * SCREEN_EMISSION_GAIN * sideTint` with a contrast expansion before that,
/// so the wall's own midband arrives on the frame at 1.5 to 2.5 linear — three to five times the
/// number the probe is built from. The probe has been understating the room's largest light source by
/// that factor for four rounds.
///
/// Which matters for exactly one class of surface, and it is the class that keeps failing: a metal has
/// no diffuse term, so the environment *is* its light, and a metal whose reflection vector points at
/// the wall can be no brighter than the band. Both pillars are that surface —
/// `renders/j5/skyright.png` and the `screen_left` crop have them as black silhouettes for the fourth
/// round running — and so are the rim's inner chrome band and the truss's inward faces.
///
/// This multiplies the band and the floor bounce under it, and leaves [`ENVIRONMENT_CEILING`] alone.
/// The floor bounce is `band * MAT_Floor_Gloss`'s albedo, so it has to move with the wall that lights
/// it — and it is what a downward-facing mirror sees, which is most of the wheel's base plate:
/// `docs/look_target.md` region 3 calls that face "a dark chrome" and it can only ever be as bright as
/// what it reflects. The ceiling stays put, which is what keeps this from becoming another
/// [`AMBIENT_INTENSITY`] rise: the void is not lit by the wall, a truss tube's upper face still
/// reflects near-black, and round 2's lesson — that a term reaching every surface from every direction
/// cannot make a silhouette — is not undone. 2.6 rather than the 3 to 5 the arithmetic above allows,
/// because the truss and the fascia occlude part of the wall from most of the room.
pub const ENVIRONMENT_BAND_GAIN: f32 = 2.6;

/// Multiplier on the environment band toward camera-left, `-X`. Magenta-coral.
///
/// `docs/look_target.md` §"Light colour, left versus right": "The two sides do not match, and
/// the mismatch is load-bearing ... the frame reads magenta and coral on the left, cobalt and
/// cyan on the right". The generated environment used to vary with elevation only, which
/// `renders/verdict_r1.json` names as the reason no metal picks up a different hue depending on
/// which side of the frame it is on. Multiplying the band by these two tints by azimuth is what
/// puts the split onto the rim, the pillars and the truss, because for a metal the environment
/// is the only thing there is to reflect.
///
/// The pair is normalised by eye so that their average is close to neutral: the split shifts
/// hue, it does not change the room's level.
///
/// Round 3 dropped the green of both tints, from `(1.45, 0.62, 1.0)` and `(0.5, 0.9, 1.5)` to
/// `(1.55, 0.50, 1.05)` and `(0.55, 0.72, 1.55)`. The pair's *average* is what a surface facing the
/// middle of the room reflects, and the truss is such a surface: at the old values the average was
/// `(0.975, 0.76, 1.25)`, whose green is three quarters of its blue, and the round-3 verdict on the
/// truss was "its chords are steel-grey-blue tubes rim-lit from a cool source, where the reference
/// lights the whole lattice violet-magenta". Green is what separates a steel blue from a violet, and
/// nothing else in the pair had to change to fix it. The new average is `(1.05, 0.61, 1.30)`.
pub const ENVIRONMENT_LEFT_TINT: [f32; 3] = [1.55, 0.50, 1.05];

/// Multiplier on the environment band toward camera-right, `+X`. Cobalt-cyan. See
/// [`ENVIRONMENT_LEFT_TINT`].
///
/// Round 5 took it from `(0.55, 0.72, 1.55)` to `(0.86, 0.66, 1.42)`, which is the same blue with half
/// again as much red and a touch less green. The verdict: "The truss rim light is the right
/// violet-magenta on the left of the frame but reads cool steel-blue-white on the right: in
/// `renders/j5/void.png` every tube's rim highlight is a pale blue-grey line ... The reference
/// rim-lights the right-hand truss in violet-brown with warm amber where the two amber cones sit." The
/// verdict guessed `Rim_R` was innocent and it is: `Rim_R` is a `DirectionalLight` from `(8, 3.5, 3.5)`
/// aimed into the arena, so what it lights on a truss tube 5.5 m up is the tube's *lower* face, and the
/// rim line the crop shows on the tube's upper face can only be the probe. A tint whose red is a third
/// of its blue makes that line a steel blue however bright it is; at 0.86 against 1.42 it is a
/// violet-brown, which is what the reference draws. The pair's average moves from `(1.05, 0.61, 1.30)`
/// to `(1.20, 0.58, 1.24)`, so the middle of the room stays violet and gains a little warmth.
///
/// What this cannot fix, and what a later round should take up: `Rim_L` and `Rim_R` are Blender AREA
/// lights and this file builds them as `DirectionalLight`s, which carry a direction and no position. So
/// `Rim_L`'s blue lands on every surface whose normal faces camera-left, the right-hand truss tubes
/// included, and no change to the probe can stop it. Confining each rim to its own side of the room needs
/// them rebuilt as positional lights with an attenuation, which is a change to the rig rather than to a
/// constant.
pub const ENVIRONMENT_RIGHT_TINT: [f32; 3] = [0.86, 0.66, 1.42];

/// Linear radiance of the environment probe above [`ENVIRONMENT_BAND_TOP`]: the ceiling void as the
/// truss sees it.
///
/// This used to be `RenderSpec::background()`, the Blender world colour `(0.01, 0.008, 0.02)`, on the
/// argument that the void is what a tube pointing up reflects and the void is near-black. That is
/// right about the *frame's* void, which is still cleared to exactly that colour, and wrong about what
/// reaches the truss. The round-3 verdict: "The environment probe's azimuthal tint reaches the wall
/// band but not the ceiling: `ENVIRONMENT_BAND_TOP` 0.2445 and `ENVIRONMENT_BAND_BOTTOM` 0.2322
/// confine the coloured band to a narrow elevation, so a tube up at the truss ring sees the neutral
/// part of the probe and takes its colour from `MAT_Truss_Metal`'s neutral (0.55, 0.56, 0.58)."
///
/// `docs/look_target.md` region 5 says the truss is edge-lit only and that the fix must keep it "nine
/// parts silhouette to one part rim light", so the answer is not to widen the band — that would raise
/// what reaches every surface in the room and undo round 2's darkening. It is to give the part of the
/// probe a tube's *upper* face reflects a colour, and the honest colour for it is the light the
/// twenty-four PAR cans and the twelve moving heads throw up into the ceiling. `(0.15, 0.045, 0.24)` is
/// a fifth of the wall band's luminance in violet-magenta: enough to put the frame's dominant hue on
/// the rim line of every tube, one seventieth of the band on a diffuse surface elsewhere, and
/// `MAT_Pillar_Body` at albedo 0.09 gains 0.0015 from it.
///
/// Round 5 took it from `(0.15, 0.045, 0.24)` to `(0.22, 0.058, 0.27)`: the same violet-magenta with more
/// red in it. The verdict was that the right-hand truss tubes' rim highlights "read cool
/// steel-blue-white" where the reference has violet-brown. A tube's *upper* face reflects this and
/// nothing else, so this is half of what those highlights are made of and
/// [`ENVIRONMENT_RIGHT_TINT`] is the other half. Neither is the whole cause; see that constant's note.
pub const ENVIRONMENT_CEILING: [f32; 3] = [0.22, 0.058, 0.27];

/// Edge length of one face of the generated environment cube map, in texels.
///
/// The map is a smooth elevation gradient with no detail in it, and `Environment::new`
/// resamples it into a 32-texel irradiance map and a 128-texel prefilter map, so 64 is
/// already more than the consumers can use. `[f16; 4]` data, so mip maps are generated —
/// `prefilter.frag` samples the source with `textureLod` and needs them.
pub const ENVIRONMENT_FACE_SIZE: u32 = 64;

/// Sine of the elevation of the LED wall's top edge, seen from the wheel centre.
///
/// `Wall_Screen` is a cylinder of radius 11.30 m spanning Blender z 0.80 to 6.35
/// (`docs/scene_audit.md` §1), and `Wheel_Root` is 3.5 m up. So the top edge is at
/// `atan((6.35 - 3.5) / 11.3) = 14.15°` and `sin(14.15°) = 0.2445`. Above it the
/// environment fades to the Blender world background.
pub const ENVIRONMENT_BAND_TOP: f32 = 0.52;

/// Sine of the elevation of the LED wall's bottom edge, seen from the wheel centre:
/// `atan((3.5 - 0.8) / 11.3) = 13.43°`, `sin(13.43°) = 0.2322`. Below it the environment
/// fades to the wall colour times the floor albedo.
pub const ENVIRONMENT_BAND_BOTTOM: f32 = 0.2322;

/// Shadow map resolution for the key light, in texels per side.
///
/// The shadow frustum's half-angle is `KEY_WHEEL_CUTOFF / 2 = 0.5 rad`, so at the wheel's
/// 6.69 m it spans 7.3 m and 2048 texels put a texel at 3.6 mm there. The pegs are 112 mm
/// studs, so they still cast. `generate_shadow_map` allocates a fresh `DepthTexture2D` on
/// every call, so this is also the per-refresh allocation size.
pub const SHADOW_MAP_SIZE: u32 = 2048;

/// Shortest gap between two shadow map refreshes, in seconds. 20 Hz.
///
/// [`Rig::update`] is called every frame but refreshes no faster than this, because
/// `generate_shadow_map` re-renders every caster into a freshly allocated depth texture.
/// The wheel spins at about 0.6 rad/s, so 20 Hz moves the shadow 1.7° between refreshes.
pub const SHADOW_REFRESH_INTERVAL: f32 = 0.05;

/// Set `GS_LIGHT_AUDIT=1` in the environment to print the rig this module built: one line
/// per light with the Blender type, the three-d type it became, the watts, the conversion
/// constant, the resulting intensity and the position and direction actually used.
const AUDIT_ENV: &str = "GS_LIGHT_AUDIT";

/// The name of the one light that casts a shadow.
///
/// The reference image shows the wheel's shadow on the floor behind it, and this is the
/// light that puts it there: it is the only lamp above and in front of the wheel.
const KEY_LIGHT: &str = "Key_Wheel";

/// The material whose emission drives the environment map's horizon band. The LED wall is
/// the brightest thing in the room and it is what the polished metal reflects.
const ENVIRONMENT_BAND_MATERIAL: &str = "MAT_LED_Screen";

/// The material whose albedo tints the environment map below the horizon: the floor bounces
/// the wall back up at the underside of everything.
const ENVIRONMENT_FLOOR_MATERIAL: &str = "MAT_Floor_Gloss";

/// The assembled light rig: one ambient light with an IBL environment, three directional
/// lights and three spot lights, one of which casts a shadow.
///
/// Fields are private. [`Rig::lights`] is the only way the render call sees them, so the
/// mapping from Blender lamps to three-d lights can change without touching `src/main.rs`.
pub struct Rig {
    /// The IBL ambient term. Always present, always first in [`Rig::lights`].
    ambient: AmbientLight,
    /// `Rim_L`, `Rim_R` and `Fill_Front`, in manifest order.
    directionals: Vec<DirectionalLight>,
    /// The wheel's own bulb channel as a lamp. One entry; see [`BULB_RING_INTENSITY`].
    points: Vec<PointLight>,
    /// `Key_Wheel`, `Beam_L` and `Beam_R`, in manifest order.
    spots: Vec<SpotLight>,
    /// Indices into `spots` that carry a shadow map. Exactly one entry, `Key_Wheel`.
    shadow_casters: Vec<usize>,
    /// Time of the last shadow refresh, in the same seconds [`Rig::update`] is given.
    /// `None` until the first refresh.
    last_shadow_refresh: Option<f32>,
}

impl Rig {
    /// Builds the whole rig from the manifest's light table. This is the entry point.
    ///
    /// # The four area lights
    ///
    /// three-d has no area light, so each of the four AREA lamps becomes the closest thing
    /// three-d has. The choices, and why:
    ///
    /// - **`Key_Wheel` (AREA, 4 m, 900 W) becomes a `SpotLight`** with cutoff
    ///   [`KEY_WHEEL_CUTOFF`]. It has to be a spot or a directional, because those are the
    ///   only two that can carry the shadow map the reference needs. A `SpotLight` keeps the
    ///   lamp's position, which matters here: the lamp is 6.7 m from the wheel and 5 m in
    ///   front of it, and a directional light would light the far side of the room just as
    ///   hard as the front. It also concentrates the shadow frustum on the wheel instead of
    ///   spreading an orthographic map over the whole 24 m set — a directional shadow map
    ///   would be `frustum_height = 35 m` wide, so 17 mm per texel at 2048 against the spot's
    ///   3.6 mm. And the spot shader's `smoothstep(0.75 * cutoff, cutoff, angle)` edge is
    ///   the softest falloff three-d offers, which is the part of an area light worth keeping.
    /// - **`Rim_L` and `Rim_R` (AREA, 3 m, 400 W) become `DirectionalLight`s.** They sit
    ///   8 m out to the sides and 8.3 m from the wheel. A 3 m source at 8.3 m subtends about
    ///   20°, and its irradiance varies by well under a stop across the 5.2 m wheel, so it
    ///   reads as directional already. Rim light is about direction, not distance. The cost
    ///   is that they also light the far wall, which the Blender lamps would not.
    /// - **`Fill_Front` (AREA, 6 m, 120 W) becomes a `DirectionalLight`.** The temptation is
    ///   to fold a soft frontal fill into the ambient term, and that would be wrong: a
    ///   non-environment `AmbientLight` contributes nothing at all to a metal, and the fill's
    ///   job includes lifting the polished hub and the chrome pegs off black. A flat frontal
    ///   directional does that. The ambient term is a separate thing, built below.
    ///
    /// The two SPOT lamps map straight across, with `cutoff = cone_outer_half_angle_rad`
    /// from the manifest. Blender's spot blend of 0.25 puts the inner cone at
    /// `0.75 * outer`, which is exactly where three-d's `smoothstep` starts, so the cone
    /// softness needs nothing done to it.
    ///
    /// # Attenuation
    ///
    /// The three spots fall off as `1 / d²` past their own distance to the wheel, and the two
    /// directionals and the ambient cannot fall off at all. See [`spot_attenuation`] for the
    /// arithmetic and for what it fixed. Round 1 gave every light `Attenuation::default()`, on
    /// the argument that the conversion constants already bake `1 / d²` in at one reference
    /// distance and a second term would count it twice. That is true only at that one distance:
    /// past it, no falloff means the LED wall 17.7 m from the key takes the same radiance the
    /// wheel does 6.7 m from it, and round 2's severity-5 defect was that nothing in the set is
    /// dark. Normalising the quadratic term at the reference distance keeps the calibration
    /// exact where it was measured and restores the falloff everywhere else.
    pub fn build(context: &Context, manifest: &Manifest) -> crate::Result<Self> {
        let mut directionals = Vec::new();
        let mut spots = Vec::new();
        let mut shadow_casters = Vec::new();
        let audit = std::env::var(AUDIT_ENV).is_ok_and(|v| v != "0");

        for spec in &manifest.lights {
            let color = linear_to_srgba(spec.color, 1.0);
            let factor = watts_to_intensity(spec, manifest);
            let intensity = factor * spec.energy * look_gain(&spec.name);
            // Top-level manifest vectors are already in the geometry's frame; going through
            // these two keeps the code correct if `vectors_in` ever changes.
            let position = manifest.to_scene_point(spec.position());
            let direction = manifest.to_scene_dir(spec.direction());

            let is_key = spec.name == KEY_LIGHT;
            let cutoff = if is_key {
                Some(KEY_WHEEL_CUTOFF)
            } else if spec.kind == "SPOT" {
                Some(spec.cone_outer_half_angle_rad)
            } else {
                None
            };

            match cutoff {
                Some(cutoff) => {
                    spots.push(SpotLight::new(
                        context,
                        intensity,
                        color,
                        position,
                        direction,
                        radians(cutoff),
                        spot_attenuation(spec, manifest),
                    ));
                    if is_key {
                        shadow_casters.push(spots.len() - 1);
                    }
                    if audit {
                        println!(
                            "light {:11} {:5} -> SpotLight       {:7.1} W * {:.6} = {:6.3}  \
                             cutoff {:.5} rad  pos {:?}  dir {:?}{}",
                            spec.name,
                            spec.kind,
                            spec.energy,
                            factor,
                            intensity,
                            cutoff,
                            round3(position),
                            round3(direction),
                            if is_key { "  [shadow]" } else { "" },
                        );
                    }
                }
                None => {
                    directionals.push(DirectionalLight::new(context, intensity, color, direction));
                    if audit {
                        println!(
                            "light {:11} {:5} -> DirectionalLight {:7.1} W * {:.6} = {:6.3}  \
                             dir {:?}",
                            spec.name,
                            spec.kind,
                            spec.energy,
                            factor,
                            intensity,
                            round3(direction),
                        );
                    }
                }
            }
        }

        if shadow_casters.is_empty() {
            return Err(crate::Error::from(format!(
                "no light named {KEY_LIGHT} in the manifest, so nothing casts the wheel's \
                 shadow; assets/scene.json must hold all six lights"
            )));
        }

        // The wheel's own bulb ring as a lamp. See [`BULB_RING_INTENSITY`] for why it exists
        // and `docs/look_target.md` §"Light directions" for what it is doing in the frame.
        let ring_centre = manifest.to_scene_point(manifest.wheel.pivot())
            + vec3(0.0, 0.0, BULB_RING_FORWARD);
        let lamps = BULB_RING_LAMPS.max(1);
        let per_lamp = BULB_RING_INTENSITY / lamps as f32;
        let attenuation = Attenuation {
            constant: BULB_RING_ATTENUATION[0],
            linear: BULB_RING_ATTENUATION[1],
            quadratic: BULB_RING_ATTENUATION[2],
        };
        let points: Vec<PointLight> = (0..lamps)
            .map(|k| {
                // The wheel disc lies in the exported frame's XY plane and spins about Z
                // (`assets/scene.json`, `wheel.spin_axis`), so the ring is a circle in x and y.
                // The half-step offset keeps a lamp off the ring's apex, where the crest crystal
                // and its bloom already are.
                let angle = std::f32::consts::TAU * (k as f32 + 0.5) / lamps as f32;
                let offset = vec3(
                    BULB_RING_RADIUS * angle.cos(),
                    BULB_RING_RADIUS * angle.sin(),
                    0.0,
                );
                PointLight::new(
                    context,
                    per_lamp,
                    linear_to_srgba(BULB_RING_COLOR, 1.0),
                    ring_centre + offset,
                    attenuation,
                )
            })
            .collect();
        if audit {
            println!(
                "light {:11} {:5} -> {} PointLights   total intensity {:.3} ({:.3} each)  \
                 ring centre {:?} radius {:.3}  attenuation {:?}  (MAT_Bulb_Glass as a lamp)",
                "BULB_RING",
                "-",
                lamps,
                BULB_RING_INTENSITY,
                per_lamp,
                round3(ring_centre),
                BULB_RING_RADIUS,
                BULB_RING_ATTENUATION,
            );
        }

        let environment = environment_cube_map(context, manifest);
        let ambient =
            AmbientLight::new_with_environment(context, AMBIENT_INTENSITY, Srgba::WHITE, &environment);
        if audit {
            println!(
                "light {:11} {:5} -> AmbientLight    intensity {:.3}, environment {}x{} f16 cube \
                 from {ENVIRONMENT_BAND_MATERIAL}",
                "(ambient)", "IBL", AMBIENT_INTENSITY, ENVIRONMENT_FACE_SIZE, ENVIRONMENT_FACE_SIZE,
            );
        }

        Ok(Rig {
            ambient,
            directionals,
            points,
            spots,
            shadow_casters,
            last_shadow_refresh: None,
        })
    }

    /// Renders the shadow maps once, at start-up, before the first frame.
    ///
    /// `casters` is every object that should block light. Pass the whole scene: the wheel
    /// blocks the floor, and the truss and the pillars block each other.
    ///
    /// Call this before [`Rig::update`]. Attaching a shadow map changes `Light::id()` from
    /// `LightId::SpotLight(false)` to `LightId::SpotLight(true)`, which changes the shader
    /// cache key and recompiles every material shader. Doing it here means that cost is paid
    /// once during start-up instead of on the first frame that calls `update`.
    pub fn generate_shadow_maps(&mut self, casters: &[&dyn Object]) -> crate::Result<()> {
        for i in &self.shadow_casters {
            self.spots[*i].generate_shadow_map(SHADOW_MAP_SIZE, casters)?;
        }
        self.last_shadow_refresh = None;
        Ok(())
    }

    /// Per-frame hook: refreshes the key light's shadow map so the spinning wheel's shadow
    /// moves with it. Returns whether it actually re-rendered this frame.
    ///
    /// `seconds` is the same animation clock `World::update` uses, in seconds. `casters` is
    /// the same list [`Rig::generate_shadow_maps`] takes.
    ///
    /// Throttled to [`SHADOW_REFRESH_INTERVAL`], because each refresh re-renders every
    /// caster into a newly allocated depth texture. It refreshes on the first call, whenever
    /// the interval has elapsed, and whenever `seconds` moves backwards — so
    /// `update(0.0, ..)` in the deterministic `--shot` path always produces the shadow for
    /// wheel rotation zero, no matter what ran before it.
    pub fn update(&mut self, seconds: f32, casters: &[&dyn Object]) -> crate::Result<bool> {
        let due = match self.last_shadow_refresh {
            None => true,
            Some(last) => seconds < last || seconds - last >= SHADOW_REFRESH_INTERVAL,
        };
        if !due {
            return Ok(false);
        }
        for i in &self.shadow_casters {
            self.spots[*i].generate_shadow_map(SHADOW_MAP_SIZE, casters)?;
        }
        self.last_shadow_refresh = Some(seconds);
        Ok(true)
    }

    /// Every light, reborrowed for one `render` call. The ambient light is first.
    pub fn lights(&self) -> Vec<&dyn Light> {
        let mut out: Vec<&dyn Light> = vec![&self.ambient];
        out.extend(self.directionals.iter().map(|l| l as &dyn Light));
        out.extend(self.points.iter().map(|l| l as &dyn Light));
        out.extend(self.spots.iter().map(|l| l as &dyn Light));
        out
    }

    /// How many lights [`Rig::lights`] returns. Fifteen for this scene: one ambient, three
    /// directional, [`BULB_RING_LAMPS`] points for the bulb ring, three spot.
    pub fn len(&self) -> usize {
        1 + self.directionals.len() + self.points.len() + self.spots.len()
    }

    /// Always false: the rig always has at least the ambient light. Present because clippy
    /// asks for it next to [`Rig::len`].
    pub fn is_empty(&self) -> bool {
        false
    }
}

/// Inverse-square falloff for one spot light, normalised at its own distance to the wheel pivot.
///
/// `three-d`'s `attenuate` divides the light by `max(1.0, c + l·d + q·d²)`, so a quadratic term can
/// only ever dim. Setting `q = 1 / d_ref²` makes the divisor exactly 1 at `d_ref` and `(d / d_ref)²`
/// beyond it, where `d_ref` is the same lamp-to-pivot distance the lamp's
/// `*_WATTS_TO_INTENSITY` constant was derived at. So the intensity that constant computes is
/// delivered unchanged at the wheel, the falloff past the wheel is the physical one, and nothing
/// nearer than the wheel is boosted — which is what the clamp at 1.0 costs us and why the
/// conversion is still calibrated at the wheel rather than at the lamp.
///
/// Numbers for `Key_Wheel`, at `d_ref = 6.685 m`: the wheel takes 1.0, the pillars at 11 m take
/// 1/2.7, the LED wall at 17.7 m takes 1/7.0, the floor under the wheel at 7.8 m takes 1/1.4.
///
/// Returns `Attenuation::default()` when [`SPOT_DISTANCE_FALLOFF`] is off, so the old behaviour is
/// one constant away.
fn spot_attenuation(spec: &LightSpec, manifest: &Manifest) -> Attenuation {
    if !SPOT_DISTANCE_FALLOFF {
        return Attenuation::default();
    }
    let pivot = manifest.to_scene_point(manifest.wheel.pivot());
    let position = manifest.to_scene_point(spec.position());
    // A lamp sitting on the pivot has no reference distance to normalise at; 1 m keeps the
    // quadratic term finite and the light unchanged out to 1 m.
    let reference_squared = (position - pivot).magnitude2().max(1.0);
    Attenuation {
        constant: 0.0,
        linear: 0.0,
        quadratic: 1.0 / reference_squared,
    }
}

/// The look-dev gain that sits on top of one light's physical conversion. 1.0 for anything the
/// round did not move, so the physical rule is still what every number is derived from.
fn look_gain(name: &str) -> f32 {
    match name {
        "Key_Wheel" => KEY_LOOK_GAIN,
        "Rim_L" | "Rim_R" => RIM_LOOK_GAIN,
        "Fill_Front" => FILL_LOOK_GAIN,
        _ => 1.0,
    }
}

/// The watts-to-intensity constant for one light.
///
/// Looks the light up by name, so the six constants above are the whole story for this
/// scene. A light the table does not name — a seventh lamp added to the .blend, say — falls
/// back to the same physical rule the constants encode, evaluated against its own distance
/// to the wheel pivot, and prints one line saying so. That is a real conversion, not a
/// placeholder: it produces the identical number for all six named lights.
fn watts_to_intensity(spec: &LightSpec, manifest: &Manifest) -> f32 {
    match spec.name.as_str() {
        "Key_Wheel" => return KEY_WHEEL_WATTS_TO_INTENSITY,
        "Beam_L" => return BEAM_L_WATTS_TO_INTENSITY,
        "Beam_R" => return BEAM_R_WATTS_TO_INTENSITY,
        "Rim_L" => return RIM_L_WATTS_TO_INTENSITY,
        "Rim_R" => return RIM_R_WATTS_TO_INTENSITY,
        "Fill_Front" => return FILL_FRONT_WATTS_TO_INTENSITY,
        _ => {}
    }

    let pivot = manifest.to_scene_point(manifest.wheel.pivot());
    let position = manifest.to_scene_point(spec.position());
    // Guard the degenerate case of a lamp sitting on the pivot; 1 m keeps it finite.
    let distance_squared = (position - pivot).magnitude2().max(1.0);
    let solid_angle = if spec.kind == "SPOT" || spec.kind == "POINT" {
        4.0 * std::f32::consts::PI
    } else {
        std::f32::consts::PI
    };
    let factor = 1.0 / (solid_angle * distance_squared);
    eprintln!(
        "warning: light {:?} is not in src/lighting.rs's constant table; using the physical \
         rule at d = {:.3} m, factor {:.6}",
        spec.name,
        distance_squared.sqrt(),
        factor,
    );
    factor
}

/// Builds the environment cube map the ambient light shines from.
///
/// Every colour comes from the manifest and every angle from the measured wall geometry:
///
/// - the horizon band is `MAT_LED_Screen`'s `effective_emission`, the radiance the LED wall
///   actually emits in the Blender scene;
/// - above [`ENVIRONMENT_BAND_TOP`] it fades to `RenderSpec::background()`, the Blender
///   world colour, which is the near-black violet ceiling void the reference shows in the
///   top corners;
/// - below [`ENVIRONMENT_BAND_BOTTOM`] it fades to the band times `MAT_Floor_Gloss`'s
///   albedo, a single floor bounce, which is what tints the underside of the rim and the
///   pegs.
///
/// On top of that elevation gradient the band and the floor bounce are tinted by *azimuth*,
/// magenta-coral toward camera-left and cobalt-cyan toward camera-right. That is
/// [`ENVIRONMENT_LEFT_TINT`] and [`ENVIRONMENT_RIGHT_TINT`], and it is the look-dev decision
/// round 1 asked for: the split is load-bearing in the reference and for a metal the
/// environment is the only thing there is to reflect. The zenith is left untinted, because the
/// ceiling void is the one part of the reference that is the same colour on both sides.
///
/// `[f16; 4]` data, so values above 1.0 survive and `TextureCubeMap` generates the mip maps
/// `prefilter.frag`'s `textureLod` needs. A three-channel float format would silently skip
/// them.
pub fn environment_cube_map(context: &Context, manifest: &Manifest) -> TextureCubeMap {
    let band = manifest
        .material(ENVIRONMENT_BAND_MATERIAL)
        .map(|m| Vec3::from(m.effective_emission))
        // The wall's emission if the material table ever loses the entry: the manifest's own
        // base colour for it, unlit. Dark violet, so the metals go dark rather than wrong.
        .unwrap_or_else(|| vec3(0.35, 0.3, 0.6));
    // Not `manifest.render.background()` any more: that is what the *frame* is cleared to and it is
    // still exactly that, but it is not what a truss tube's upper face reflects. See
    // [`ENVIRONMENT_CEILING`].
    let zenith = Vec3::from(ENVIRONMENT_CEILING);
    let floor_albedo = manifest
        .material(ENVIRONMENT_FLOOR_MATERIAL)
        .map(|m| Vec3::from(m.base_color))
        .unwrap_or_else(|| vec3(0.055, 0.05, 0.075));
    // The band, at the radiance `src/screen.rs` actually draws the wall at rather than the pre-texture
    // node value. See [`ENVIRONMENT_BAND_GAIN`]. The floor bounce is taken off the gained value,
    // because the floor is lit by the wall and gets brighter with it; the zenith is not, because the
    // ceiling void is not lit by anything.
    let band = band * ENVIRONMENT_BAND_GAIN;
    let nadir = vec3(
        band.x * floor_albedo.x,
        band.y * floor_albedo.y,
        band.z * floor_albedo.z,
    );

    let size = ENVIRONMENT_FACE_SIZE;
    let faces: Vec<CpuTexture> = (0..6)
        .map(|side| {
            let mut data = Vec::with_capacity((size * size) as usize);
            for row in 0..size {
                for col in 0..size {
                    // GL cube-map texel to direction. `s` and `t` are the face's texture
                    // coordinates and `sc`, `tc` their signed form; `TextureCubeMap::fill`
                    // uploads row 0 of the data at `t = 0`, so `tc` runs -1 to +1 down the
                    // rows and row 0 is the top of the four side faces.
                    let sc = 2.0 * (col as f32 + 0.5) / size as f32 - 1.0;
                    let tc = 2.0 * (row as f32 + 0.5) / size as f32 - 1.0;
                    let dir = face_direction(side, sc, tc).normalize();
                    // The azimuthal split. `+X` is camera-right, because the hero camera looks
                    // down `-Z` (`assets/scene.json`, `camera.forward`). `dir.x` already runs
                    // -1 to +1 across the room, so it is the swing itself.
                    let tint = azimuth_tint(dir.x);
                    let c = environment_radiance(
                        dir.y,
                        modulate(band, tint),
                        zenith,
                        modulate(nadir, tint),
                    );
                    data.push([
                        f16::from_f32(c.x),
                        f16::from_f32(c.y),
                        f16::from_f32(c.z),
                        f16::from_f32(1.0),
                    ]);
                }
            }
            CpuTexture {
                name: format!("GS_Environment_{side}"),
                data: TextureData::RgbaF16(data),
                width: size,
                height: size,
                min_filter: Interpolation::Linear,
                mag_filter: Interpolation::Linear,
                mipmap: Some(Mipmap::default()),
                wrap_s: Wrapping::ClampToEdge,
                wrap_t: Wrapping::ClampToEdge,
            }
        })
        .collect();

    TextureCubeMap::new(
        context, &faces[0], // +X, three-d's `right`
        &faces[1], // -X, `left`
        &faces[2], // +Y, `top`
        &faces[3], // -Y, `bottom`
        &faces[4], // +Z, `front`
        &faces[5], // -Z, `back`
    )
}

/// Channel-by-channel product of two colours. `cgmath`'s `ElementWise` is not in `three_d`'s
/// prelude, and `Vec3 * Vec3` is not defined, so spell it out.
fn modulate(a: Vec3, b: Vec3) -> Vec3 {
    vec3(a.x * b.x, a.y * b.y, a.z * b.z)
}

/// The hue multiplier for one azimuth. `x` is the direction's normalised `x`, so `-1` is fully
/// camera-left and `+1` fully camera-right; `smoothstep` rather than a straight lerp keeps the
/// two sides distinct and hands the middle of the frame the average of the pair.
fn azimuth_tint(x: f32) -> Vec3 {
    let t = smoothstep(-1.0, 1.0, x);
    let left = Vec3::from(ENVIRONMENT_LEFT_TINT);
    let right = Vec3::from(ENVIRONMENT_RIGHT_TINT);
    left + (right - left) * t
}

/// The environment's linear radiance at one elevation, `up` being `+Y`.
///
/// `up_component` is the direction's normalised `y`, i.e. the sine of the elevation.
fn environment_radiance(up_component: f32, band: Vec3, zenith: Vec3, nadir: Vec3) -> Vec3 {
    if up_component >= 0.0 {
        let t = smoothstep(0.0, ENVIRONMENT_BAND_TOP, up_component);
        band + (zenith - band) * t
    } else {
        let t = smoothstep(0.0, ENVIRONMENT_BAND_BOTTOM, -up_component);
        band + (nadir - band) * t
    }
}

/// Direction of the texel at signed face coordinates `(sc, tc)` on cube-map face `side`.
///
/// `side` is three-d's own face order, which is the OpenGL one: 0 `+X`, 1 `-X`, 2 `+Y`,
/// 3 `-Y`, 4 `+Z`, 5 `-Z`. The six expressions invert the OpenGL cube-map lookup table, so
/// `face_direction` is the exact inverse of what `samplerCube` does. Note that the four side
/// faces all give `y = -tc`, which is why the elevation gradient lines up across the seams.
fn face_direction(side: u32, sc: f32, tc: f32) -> Vec3 {
    match side {
        0 => vec3(1.0, -tc, -sc),
        1 => vec3(-1.0, -tc, sc),
        2 => vec3(sc, 1.0, tc),
        3 => vec3(sc, -1.0, -tc),
        4 => vec3(sc, -tc, 1.0),
        _ => vec3(-sc, -tc, -1.0),
    }
}

/// The usual smooth Hermite ramp, clamped to `0..1`. `edge1` must be above `edge0`.
fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// A vector rounded to three decimals, for the audit print only.
fn round3(v: Vec3) -> [f32; 3] {
    [
        (v.x * 1000.0).round() / 1000.0,
        (v.y * 1000.0).round() / 1000.0,
        (v.z * 1000.0).round() / 1000.0,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The six constants must be the physical rule evaluated at each lamp's own distance to
    /// `Wheel_Root`. If a look-dev round changes one on purpose this test fails and the new
    /// number goes in beside the old reasoning; that is the intended way to notice.
    #[test]
    fn the_constants_match_the_documented_arithmetic() {
        let pi = std::f32::consts::PI;
        let cases = [
            ("Key_Wheel", KEY_WHEEL_WATTS_TO_INTENSITY, pi, 44.690_f32),
            ("Beam_L", BEAM_L_WATTS_TO_INTENSITY, 4.0 * pi, 73.580),
            ("Beam_R", BEAM_R_WATTS_TO_INTENSITY, 4.0 * pi, 73.580),
            ("Rim_L", RIM_L_WATTS_TO_INTENSITY, pi, 69.290),
            ("Rim_R", RIM_R_WATTS_TO_INTENSITY, pi, 69.290),
            ("Fill_Front", FILL_FRONT_WATTS_TO_INTENSITY, pi, 77.940),
        ];
        for (name, constant, solid_angle, distance_squared) in cases {
            let want = 1.0 / (solid_angle * distance_squared);
            assert!(
                (constant - want).abs() < 5e-7,
                "{name}: constant {constant} but 1/({solid_angle} * {distance_squared}) = {want}"
            );
        }
    }

    /// The distances the constants are derived from must be the distances in the manifest.
    /// This is what catches a moved lamp.
    #[test]
    fn the_documented_distances_match_the_manifest() {
        let manifest = match Manifest::load_from_assets() {
            Ok(m) => m,
            Err(e) => panic!("assets/scene.json must load: {e}"),
        };
        let pivot = manifest.to_scene_point(manifest.wheel.pivot());
        let expected = [
            ("Key_Wheel", 44.690_f32),
            ("Beam_L", 73.580),
            ("Beam_R", 73.580),
            ("Rim_L", 69.290),
            ("Rim_R", 69.290),
            ("Fill_Front", 77.940),
        ];
        for (name, distance_squared) in expected {
            let spec = manifest
                .light(name)
                .unwrap_or_else(|| panic!("manifest has no light {name}"));
            let measured =
                (manifest.to_scene_point(spec.position()) - pivot).magnitude2();
            assert!(
                (measured - distance_squared).abs() < 0.01,
                "{name}: manifest gives d^2 = {measured}, lighting.rs assumes {distance_squared}"
            );
        }
    }

    /// The manifest's own spot blend must be the 0.75 ratio three-d's `smoothstep` hard-codes,
    /// or the beam edges need work that `build` does not do.
    #[test]
    fn the_beam_cone_softness_matches_three_ds_smoothstep() {
        let manifest = Manifest::load_from_assets().expect("assets/scene.json must load");
        for name in ["Beam_L", "Beam_R"] {
            let spec = manifest.light(name).expect("beam in the manifest");
            let ratio = spec.cone_inner_half_angle_rad / spec.cone_outer_half_angle_rad;
            assert!(
                (ratio - 0.75).abs() < 1e-4,
                "{name}: inner/outer = {ratio}, three-d softens from 0.75 * cutoff"
            );
            assert!(
                (spec.cone_outer_half_angle_rad - spec.spot_size * 0.5).abs() < 1e-6,
                "{name}: cone_outer_half_angle_rad must be half of spot_size"
            );
        }
    }

    /// The four side faces of the cube map must agree on elevation at their shared seams, and
    /// the top and bottom faces must be fully above and below the band. A flipped `tc` shows
    /// up here as an inverted gradient.
    #[test]
    fn the_cube_faces_agree_on_which_way_is_up() {
        for side in [0u32, 1, 4, 5] {
            let top = face_direction(side, 0.0, -1.0).normalize();
            let bottom = face_direction(side, 0.0, 1.0).normalize();
            assert!(top.y > 0.7, "side {side}: tc = -1 must look up, got {top:?}");
            assert!(
                bottom.y < -0.7,
                "side {side}: tc = +1 must look down, got {bottom:?}"
            );
        }
        assert!(face_direction(2, 0.0, 0.0).normalize().y > 0.99, "+Y face");
        assert!(face_direction(3, 0.0, 0.0).normalize().y < -0.99, "-Y face");
    }

    /// The gradient must put the wall's own emission at the horizon, the near-black world
    /// background overhead, and something darker than either underfoot.
    #[test]
    fn the_environment_gradient_runs_the_right_way() {
        let band = vec3(0.525, 0.45, 0.9);
        let zenith = vec3(0.01, 0.008, 0.02);
        let nadir = vec3(0.029, 0.0225, 0.0675);

        let horizon = environment_radiance(0.0, band, zenith, nadir);
        assert!((horizon.z - band.z).abs() < 1e-6, "horizon is the band");

        let overhead = environment_radiance(1.0, band, zenith, nadir);
        assert!(
            (overhead.z - zenith.z).abs() < 1e-6,
            "straight up is the world background, got {overhead:?}"
        );

        let underfoot = environment_radiance(-1.0, band, zenith, nadir);
        assert!(
            (underfoot.z - nadir.z).abs() < 1e-6,
            "straight down is the floor bounce, got {underfoot:?}"
        );

        // Monotonic from the horizon to the zenith, so no bright ring appears in the void.
        let mut previous = horizon.z;
        for step in 1..=16 {
            let e = step as f32 / 16.0;
            let here = environment_radiance(e, band, zenith, nadir).z;
            assert!(here <= previous + 1e-6, "not monotonic at e = {e}");
            previous = here;
        }
    }

    /// The azimuthal split must run magenta-coral to camera-left and cobalt-cyan to
    /// camera-right, and it must not change the room's overall level. A sign error here would
    /// mirror the reference's two sides, which is worse than having no split at all.
    #[test]
    fn the_azimuth_split_runs_left_to_right() {
        let left = azimuth_tint(-1.0);
        let right = azimuth_tint(1.0);
        assert_eq!(left, Vec3::from(ENVIRONMENT_LEFT_TINT));
        assert_eq!(right, Vec3::from(ENVIRONMENT_RIGHT_TINT));
        // Left is the warm side: more red than blue. Right is the cool side: more blue than red.
        assert!(left.x > left.z, "camera-left must be the magenta-coral side");
        assert!(right.z > right.x, "camera-right must be the cobalt-cyan side");
        // The middle of the frame is the average of the two, and the pair is level-neutral to
        // within a fifth of a stop, so the split shifts hue rather than brightness.
        let middle = azimuth_tint(0.0);
        let mean = (middle.x + middle.y + middle.z) / 3.0;
        assert!((mean - 1.0).abs() < 0.15, "the split changes the level: {mean}");
    }

    /// The bulb-ring light is a local source, so it must be dimmed by distance — otherwise it
    /// lights the LED wall and the pillars, which the reference keeps as dark silhouettes.
    #[test]
    fn the_bulb_ring_falls_off_before_the_wall() {
        let att = |d: f32| {
            (BULB_RING_ATTENUATION[0] + BULB_RING_ATTENUATION[1] * d + BULB_RING_ATTENUATION[2] * d * d)
                .max(1.0)
        };
        // Floor under the wheel, 3.5 m: dimmed, but by well under a stop and a half.
        assert!(att(3.5) < 2.5, "the floor is barely reached: {}", att(3.5));
        // The LED wall at 11 m: a small fraction of it, and it has to be a much smaller fraction
        // than the floor's, or the ring is not behaving as a local source at all.
        assert!(att(11.0) > 5.0, "the wall is still lit: {}", att(11.0));
        assert!(
            att(11.0) / att(3.5) > 4.0,
            "the wall takes {} of the floor's share, so the falloff is doing nothing",
            att(3.5) / att(11.0)
        );
    }

    /// The ring is a ring. One point light on the wheel's axis floods the hub and the inner ends
    /// of the 48 sectors from 0.35 m, which is what round 2 judged as a pastel sector fan; the
    /// same total intensity spread round [`BULB_RING_RADIUS`] reaches the hub from 2.45 m instead.
    /// See [`BULB_RING_INTENSITY`].
    #[test]
    fn the_bulb_ring_is_not_one_lamp_on_the_axis() {
        assert!(BULB_RING_LAMPS >= 6, "{BULB_RING_LAMPS} lamps is a point, not a ring");
        // The measured channel centre line of `Wheel_Bulbs`, so the lamps sit where the bulbs are.
        assert!((BULB_RING_RADIUS - 2.454).abs() < 0.06, "{BULB_RING_RADIUS}");
        let att = |d: f32| {
            (BULB_RING_ATTENUATION[0] + BULB_RING_ATTENUATION[1] * d + BULB_RING_ATTENUATION[2] * d * d)
                .max(1.0)
        };
        // What one lamp of the ring delivers at the hub, summed over the ring, against what a
        // single axial lamp 0.35 m in front of the hub delivered.
        let ring_at_hub = BULB_RING_INTENSITY / att(BULB_RING_RADIUS);
        let axial_at_hub = BULB_RING_INTENSITY / att(BULB_RING_FORWARD);
        assert!(
            ring_at_hub < axial_at_hub * 0.8,
            "the ring puts {ring_at_hub} on the hub against an axial lamp's {axial_at_hub}"
        );
    }

    /// The ambient level has to leave shadowed metal dark. A metal only ever reflects the
    /// environment, so its shadow-side radiance is bounded by the ambient times the void.
    #[test]
    fn shadowed_metal_stays_dark() {
        // The ceiling term is what a tube's upper face reflects; it carries the frame's violet, and
        // the bound it must respect is that it stays a rim line rather than filling the tube in.
        let zenith_radiance = AMBIENT_INTENSITY * ENVIRONMENT_CEILING[2];
        assert!(
            zenith_radiance < 0.06,
            "metal facing the ceiling void would read at {zenith_radiance}, not a rim line"
        );
        let band_radiance = AMBIENT_INTENSITY * 0.9;
        assert!(
            band_radiance < 0.5,
            "metal facing the LED wall would read at {band_radiance}, which washes the hub"
        );
    }
}
