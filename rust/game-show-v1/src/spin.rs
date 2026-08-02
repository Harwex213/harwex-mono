//! Wheel spin state and the flapper deflecting against the pegs.
//!
//! Owner: agent K. Created by agent F with a constant-rate spin; K added the dynamics and
//! the flapper.
//!
//! # What moves
//!
//! `Wheel_Root` is a mesh-less pivot at scene-frame `(0, 3.5, -1.2)` and it turns about
//! `(0, 0, -1)`, which is Blender's `+Y`. Its 56 children — rim, hub, spokes, bulbs, pegs,
//! back plate and the 48 sectors — are 57 parts, because `Wheel_Pegs` carries two material
//! slots. [`Stage::wheel_indices`] is exactly that set, so this module never filters by
//! name: `Wheel_Legs`, `Wheel_Axle`, `Wheel_BasePlate` and `Wheel_CrossBar` share the
//! `Wheel_` prefix but hang off `Wheel_Stand` and are not in the subtree. `Crest_Root` and
//! its children never move either, apart from the one rotation this module gives
//! `Pointer_Flapper` about its own hinge.
//!
//! Every part's [`Part::base_transformation`] is its world transform as imported. The spin
//! is composed on the left of it and never replaces it.
//!
//! # Two drives, one state
//!
//! [`Wheel::update`] is the **constant-rate drive**: a pure function of absolute `seconds`
//! at the manifest's idle rate. `--shot` calls `update(stage, 0.0)`, which puts the wheel at
//! angle 0 and the flapper at rest, so the shot is reproducible.
//!
//! [`Wheel::advance`] is the **free-running drive**: a delta-time step with friction, so the
//! wheel coasts down and stops. [`Wheel::kick`] spins it back up from a key press. The two
//! drives write the same state and only one of them may drive a given frame, because
//! `update` re-derives the angle from absolute time and would overwrite a kick. Both are
//! deterministic: `advance` is a pure function of the starting state and the delta-time
//! sequence, and clamps a single step to [`MAX_ADVANCE`] so a stalled frame cannot fling the
//! wheel.
//!
//! # The tick
//!
//! Measured in `docs/scene_audit.md` section 3 and carried in `assets/scene.json`:
//!
//! - 48 pegs at `3.75 deg + k * 7.5 deg`, every centre at radius 2.245 m, each peg a
//!   0.112 m stud.
//! - The flapper's hinge is 2.72 m above the wheel axis; its striker tab hangs 0.515 m below
//!   the hinge, which puts the tab at radius 2.205 m and at wheel-local angle 0.
//! - So the flapper sits over a *sector centre* at wheel angle 0, with a peg 3.75 deg either
//!   side, and a peg reaches the tab every 7.5 deg of wheel rotation: the tick rate is
//!   `peg_count` per revolution, straight out of the manifest.
//! - The tab and the pegs miss each other by 0.006 m along the axis, so there is no contact
//!   to resolve. The audit says it in as many words: drive the deflection kinematically from
//!   the wheel angle.
//!
//! The curve, per peg, is not a sine. `q` is how far the wheel has turned past the last peg
//! pass, signed so that `q < 0` means the peg is still approaching:
//!
//! 1. `-window <= q <= 0`: the peg drives the tab. The deflection follows the contact
//!    profile, which rises to the full amplitude at `q = 0`.
//! 2. `q > 0`: the tab has slipped off the peg. The deflection is the free response of a
//!    damped spring released from the amplitude at zero velocity — a snap back, one small
//!    overshoot, then rest.
//! 3. The two are combined with `max`, because a peg cannot pull the blade down, only push
//!    it up. At speed the blade has not returned before the next peg arrives, so the `max`
//!    holds it out and the tick becomes a wobble against a standing deflection, which is
//!    what a fast wheel looks like. At low speed the ring finishes and the blade rests.
//!
//! The contact window comes out of the geometry: the peg drives the tab through one stud
//! width of arc, `peg_stud_size / peg_ring_radius` = 0.0499 rad, 38% of the 7.5 deg pitch.
//! The amplitude, the ring frequency and the damping are look-dev choices with the bound the
//! audit gives: 32.2 deg is the deflection at which the tab clears a peg tip entirely, so
//! the tick has to stay under it. See [`TICK_AMPLITUDE`], [`RING_CYCLES_PER_PEG`],
//! [`RING_DAMPING`].
//!
//! # Which way the flapper leans
//!
//! `docs/scene_audit.md` section 3 contradicts itself here, so this is derived rather than
//! quoted. In the scene frame the wheel disc lies in XY and both the spin axis and the
//! flapper's deflection axis are `(0, 0, -1)`, so a rotation of `phi` about either is
//! `Rz(-phi)`. A peg at the top of the disc, offset `(0, +r, 0)` from the axis, moves to
//! `(+r sin phi, ...)`: positive `phi` carries the top of the wheel toward `+x`, which is
//! screen right from the hero camera, i.e. clockwise. The blade hangs *below* its hinge,
//! offset `(0, -L, 0)`, and rotating it by `psi` moves its tip to `(-L sin psi, ...)`. The
//! peg pushes the tab the way the wheel is turning, so a positive wheel angle drags the
//! blade to a **negative** `psi` about the same axis. The audit's sentence "a wheel turning
//! positive about +Y drags the flapper to positive psi" follows from its own slip one
//! paragraph earlier ("positive psi pushes the tip toward +X"), which the same rotation
//! matrix contradicts. [`Wheel::deflection`] returns the signed angle with the sign above.
//!
//! # Notes on the three-d API (`docs/three_d_api.md` section 9)
//!
//! - `Mesh::update_positions` and `update_normals` are gone in 0.19; the replacements are
//!   `set_positions` and `set_normals`. Nothing here needs them: both the spin and the tick
//!   are rigid transforms, so `set_transformation` does all of it and no vertex data is
//!   touched per frame.
//! - `Mesh::aabb()` applies the transformation and `RenderTarget::render` frustum-culls on
//!   the aabb, so a part this module rotates out of view is dropped correctly.

use crate::manifest::Manifest;
use crate::scene::Stage;
use std::f32::consts::TAU;
use three_d::*;

/// The Blender object the flapper deflection applies to. Used when the manifest does not
/// name one; `assets/scene.json` does (`flapper.node`).
pub const FLAPPER: &str = "Pointer_Flapper";

/// Angular velocity one [`Wheel::kick`] adds, radians per second. 12 rad/s is 1.9
/// revolutions per second; with the friction below it coasts about 9 turns in 11 seconds,
/// and spends the last 2.5 of them slow enough to read peg by peg.
pub const KICK_RATE: f32 = 12.0;

/// Ceiling on the angular velocity, radians per second. Repeated kicks stop here. At
/// 26 rad/s the wheel turns 9.5 deg per frame at 60 fps, which is 1.3 pegs: past this the
/// tick is aliasing and there is no point spinning faster.
pub const MAX_RATE: f32 = 26.0;

/// Viscous drag, per second. Dominates while the wheel is fast.
pub const AIR_DRAG: f32 = 0.10;

/// Dry bearing friction, radians per second squared. Speed-independent, so it is what
/// actually brings the wheel to a stop in finite time; viscous drag alone never does.
pub const BEARING_FRICTION: f32 = 0.55;

/// Detent stiffness, radians per second squared per radian of offset.
///
/// The flapper leans on whichever peg it is nearest, which pulls the wheel toward the pose
/// where the blade hangs in a gap between two pegs — a sector centred under the flapper,
/// which is where a real prize wheel comes to rest. Modelled as a spring toward the nearest
/// multiple of the peg pitch. It must beat [`BEARING_FRICTION`] at half a pitch or the wheel
/// could stall off-centre: 24 * 0.0654 = 1.57 rad/s^2 against 0.55. What is left is a dead
/// band of `BEARING_FRICTION / DETENT_STIFFNESS` = 0.023 rad = 1.3 deg of a 7.5 deg sector,
/// which is not visible. At speed the spring is a zero-mean ripple; it only bites at the end.
pub const DETENT_STIFFNESS: f32 = 24.0;

/// Angular velocity below which the wheel is called stopped, radians per second.
pub const REST_RATE: f32 = 0.01;

/// Longest integration substep, seconds. [`Wheel::advance`] splits its step into substeps no
/// longer than this so that the friction integration does not depend on the frame rate.
pub const MAX_SUBSTEP: f32 = 1.0 / 120.0;

/// Longest single step [`Wheel::advance`] will simulate, seconds. A frame that takes longer
/// than this — a stall, a window drag, a breakpoint — advances the wheel by this much and
/// loses the rest. Without the clamp a one-second hitch would jump the wheel a third of a
/// turn and skip 25 ticks.
pub const MAX_ADVANCE: f32 = 0.25;

/// Peak tick deflection, as a fraction of the manifest's `clearance_deflection_deg`.
///
/// That angle, 32.2 deg, is where the striker tab clears a peg tip entirely, so it is an
/// upper bound and not a target: a tick that reached it would look like the blade jumping
/// over the pegs. 0.62 of it is 20 deg, which at the tab's 0.515 m lever arm is 0.18 m of
/// travel — clearly visible in the `rim_top` crop without swinging the blade off the ring.
pub const TICK_AMPLITUDE: f32 = 0.62;

/// Natural frequency of the flapper's return, in cycles per peg pitch at the manifest's idle
/// rate. A look-dev choice: 1.6 cycles across the 145 ms a peg takes at 0.9 rad/s is
/// 11 Hz, so the blade snaps back and settles inside one pitch and the tick reads as one
/// event per peg. Lower and the blade never comes home between pegs; higher and the return
/// is a single-frame pop at 60 fps.
pub const RING_CYCLES_PER_PEG: f32 = 1.6;

/// Damping ratio of the flapper's return. 0.55 leaves one overshoot at 13% of the amplitude
/// and kills the second, which is a metal blade on a stop, not a pendulum.
pub const RING_DAMPING: f32 = 0.55;

/// Where the contact profile starts, as a fraction of the amplitude, at the near edge of the
/// contact window.
///
/// Negative on purpose. The blade can still be swung past rest by the previous overshoot
/// when the next peg arrives, and the profile is combined with `max`, so a profile starting
/// at 0 would snap the blade up by that much in one frame. Starting below the deepest
/// overshoot the ring can reach (-0.126 of the amplitude at [`RING_DAMPING`] 0.55) makes the
/// deflection continuous at the edge of the window at every speed.
pub const CONTACT_START: f32 = -0.35;

/// Spin state for the parts under `Wheel_Root`, plus the flapper deflection that follows
/// from it.
pub struct Wheel {
    /// Indices into `Stage::parts` that turn with the wheel: `Stage::wheel_indices`.
    spinning: Vec<usize>,
    /// Indices of the `Pointer_Flapper` parts. Three of them: the blade uses `MAT_Crystal`,
    /// `MAT_Gold_Trim` and `MAT_Metal_Polished`, and one part is built per material slot.
    flapper: Vec<usize>,
    /// Scene-frame pivot of `Wheel_Root`.
    pivot: Vec3,
    /// Scene-frame spin axis, normalised.
    axis: Vec3,
    /// Scene-frame hinge of `Pointer_Flapper`.
    hinge: Vec3,
    /// Scene-frame deflection axis of the flapper, normalised.
    flapper_axis: Vec3,
    /// Idle rate from the manifest, radians per second. The rate [`Wheel::update`] drives at.
    idle_rate: f32,
    /// Pegs on the rim. The flapper ticks once per peg.
    peg_count: u32,
    /// Wheel angle between two pegs, radians.
    pitch: f32,
    /// Wheel angle at which a peg sits exactly on the striker tab, modulo [`Wheel::pitch`].
    pass: f32,
    /// Width of the contact window in wheel angle, radians.
    window: f32,
    /// Peak tick deflection, radians.
    amplitude: f32,
    /// Undamped natural frequency of the flapper's return, radians per second.
    natural: f32,
    /// Damped natural frequency of the flapper's return, radians per second.
    damped: f32,
    /// Current wheel angle in radians, wrapped to `0..TAU`.
    angle: f32,
    /// Current angular velocity, radians per second.
    velocity: f32,
    /// Seconds since the last peg released the flapper.
    ring_time: f32,
    /// False until the first peg has passed, so a wheel that has not moved has its blade
    /// hanging straight rather than part-way through a ring.
    ringing: bool,
    /// Direction of travel, `+1.0` or `-1.0`. Held over a stop so the blade rings out the
    /// way it was pushed.
    drive: f32,
}

impl Wheel {
    /// Collects the parts that turn, the parts of the flapper, and the geometry the tick
    /// follows.
    pub fn new(stage: &Stage, manifest: &Manifest) -> Self {
        let node = if manifest.flapper.node.is_empty() {
            FLAPPER
        } else {
            manifest.flapper.node.as_str()
        };
        let mut wheel = Wheel::detached(manifest);
        wheel.spinning = stage.wheel_indices().to_vec();
        wheel.flapper = stage.indices_under(node);
        wheel
    }

    /// The state and the geometry without the part indices, so the tick can be exercised
    /// without a GPU context.
    fn detached(manifest: &Manifest) -> Self {
        let axis = manifest.to_scene_dir(manifest.wheel.axis());
        let flapper_axis = manifest.to_scene_dir(manifest.flapper.axis());
        let peg_count = manifest.wheel.peg_count.max(1);
        let pitch = TAU / peg_count as f32;
        // Pegs sit at `first + k * pitch` in the wheel-local frame and the striker tab sits
        // at 0, and turning the wheel by `phi` adds `phi` to a peg's angle, so a peg is on
        // the tab when `phi == -first` modulo the pitch. With `first` at half a pitch, as
        // the manifest has it, that is half a pitch either way round.
        let first = manifest.wheel.peg_first_angle_deg.to_radians();
        let radius = if manifest.wheel.peg_ring_radius > 0.0 {
            manifest.wheel.peg_ring_radius
        } else {
            1.0
        };
        // One stud width of arc, converted to wheel angle: how far the peg drives the tab.
        let window = (manifest.wheel.peg_stud_size / radius).clamp(1.0e-4, pitch * 0.5);
        let idle_rate = manifest.wheel.rate;
        // Cycles per peg at the idle rate -> radians per second.
        let natural = RING_CYCLES_PER_PEG * TAU * idle_rate.abs().max(1.0e-3) / pitch;
        debug_assert!(
            DETENT_STIFFNESS * pitch * 0.5 > BEARING_FRICTION,
            "the detent has to beat dry friction at half a pitch or the wheel stalls off-centre"
        );
        Wheel {
            spinning: Vec::new(),
            flapper: Vec::new(),
            pivot: manifest.to_scene_point(manifest.wheel.pivot()),
            axis: unit_or(axis, manifest.scene_up()),
            hinge: manifest.to_scene_point(manifest.flapper.pivot()),
            flapper_axis: unit_or(flapper_axis, manifest.scene_up()),
            idle_rate,
            peg_count,
            pitch,
            pass: (-first).rem_euclid(pitch),
            window,
            amplitude: TICK_AMPLITUDE * manifest.flapper.clearance_deflection_deg.to_radians(),
            natural,
            damped: natural * (1.0 - RING_DAMPING * RING_DAMPING).max(1.0e-6).sqrt(),
            angle: 0.0,
            velocity: idle_rate,
            ring_time: 0.0,
            ringing: false,
            drive: if idle_rate < 0.0 { -1.0 } else { 1.0 },
        }
    }

    // -- the two drives ---------------------------------------------------------------

    /// Constant-rate drive: puts the wheel at the idle rate's angle for absolute time
    /// `seconds` and writes every transform.
    ///
    /// Pure in `seconds`. `update(stage, 0.0)` leaves the wheel at angle 0 and the flapper
    /// hanging straight, which is the frame `--shot` writes. Do not mix it with
    /// [`Wheel::advance`] in the same frame loop: this one re-derives the angle from absolute
    /// time, so it would undo a [`Wheel::kick`].
    pub fn update(&mut self, stage: &mut Stage, seconds: f32) {
        self.drive_to(seconds);
        self.apply(stage);
    }

    /// The state half of [`Wheel::update`], for a caller that applies the transforms itself.
    pub fn drive_to(&mut self, seconds: f32) {
        self.reset(0.0);
        self.velocity = self.idle_rate;
        let travelled = self.idle_rate * seconds;
        self.angle = travelled.rem_euclid(TAU);
        self.track_pegs(travelled, seconds);
    }

    /// Free-running drive: advances the wheel by `dt` seconds under friction.
    ///
    /// Deterministic in the starting state and the sequence of `dt` values. Long steps are
    /// split into substeps of at most [`MAX_SUBSTEP`] so the coast-down does not depend on
    /// the frame rate, and a single step is clamped to [`MAX_ADVANCE`].
    pub fn advance(&mut self, dt: f32) {
        if !(dt > 0.0) {
            return;
        }
        let dt = dt.min(MAX_ADVANCE);
        let steps = (dt / MAX_SUBSTEP).ceil().max(1.0) as u32;
        let h = dt / steps as f32;
        // Integrated unwrapped, so the travelled angle survives the wrap at the end.
        let start = self.angle;
        let mut angle = self.angle;
        for _ in 0..steps {
            // The detent pulls the nearest sector under the flapper; drag scales with speed.
            let pull = -DETENT_STIFFNESS * detent_offset(angle, self.pitch) - AIR_DRAG * self.velocity;
            self.velocity += pull * h;
            // Dry friction, clamped so one step can never push the wheel backwards through
            // zero. This is what stops the wheel, and what holds it inside the detent's dead
            // band once it has stopped.
            let dry = BEARING_FRICTION * h;
            if self.velocity.abs() <= dry {
                self.velocity = 0.0;
            } else {
                self.velocity -= dry * self.velocity.signum();
            }
            self.velocity = self.velocity.clamp(-MAX_RATE, MAX_RATE);
            angle += self.velocity * h;
        }
        self.angle = angle.rem_euclid(TAU);
        self.track_pegs(angle - start, dt);
    }

    /// Adds [`KICK_RATE`] to the angular velocity, in the direction the wheel already turns.
    /// Wire this to a key press.
    pub fn kick(&mut self) {
        self.kick_with(KICK_RATE * self.drive);
    }

    /// Adds `delta` radians per second to the angular velocity, clamped to [`MAX_RATE`].
    /// A negative `delta` spins the wheel the other way.
    pub fn kick_with(&mut self, delta: f32) {
        if !delta.is_finite() {
            return;
        }
        self.velocity = (self.velocity + delta).clamp(-MAX_RATE, MAX_RATE);
    }

    /// Stops the wheel where it stands. The flapper still rings out.
    pub fn stop(&mut self) {
        self.velocity = 0.0;
    }

    /// Puts the wheel at `angle` radians, at rest, with the flapper hanging straight.
    pub fn reset(&mut self, angle: f32) {
        self.angle = angle.rem_euclid(TAU);
        self.velocity = 0.0;
        self.ring_time = 0.0;
        self.ringing = false;
        self.drive = if self.idle_rate < 0.0 { -1.0 } else { 1.0 };
    }

    // -- transforms -------------------------------------------------------------------

    /// Writes the wheel and flapper transforms into the stage.
    ///
    /// Each part is `matrix * base_transformation`: the imported world transform is composed
    /// with, never replaced by, the animation.
    pub fn apply(&self, stage: &mut Stage) {
        let spin = self.spin_matrix();
        for &i in &self.spinning {
            let part = &mut stage.parts[i];
            part.object.set_transformation(spin * part.base_transformation);
        }
        let flap = self.flapper_matrix();
        for &i in &self.flapper {
            let part = &mut stage.parts[i];
            part.object.set_transformation(flap * part.base_transformation);
        }
    }

    /// The matrix the caller applies to every part under `Wheel_Root`: the current rotation
    /// about the spin axis through the pivot. Identity at angle 0.
    pub fn spin_matrix(&self) -> Mat4 {
        Mat4::from_translation(self.pivot)
            * Mat4::from_axis_angle(self.axis, radians(self.angle))
            * Mat4::from_translation(-self.pivot)
    }

    /// The matrix the caller applies to every `Pointer_Flapper` part: the current deflection
    /// about the deflection axis through the hinge. Identity when the blade hangs straight.
    pub fn flapper_matrix(&self) -> Mat4 {
        Mat4::from_translation(self.hinge)
            * Mat4::from_axis_angle(self.flapper_axis, radians(self.deflection()))
            * Mat4::from_translation(-self.hinge)
    }

    // -- readings ---------------------------------------------------------------------

    /// Current wheel angle in radians, `0..TAU`.
    pub fn angle(&self) -> f32 {
        self.angle
    }

    /// Current angular velocity in radians per second. Signed.
    pub fn velocity(&self) -> f32 {
        self.velocity
    }

    /// The manifest's idle rate in radians per second, which [`Wheel::update`] drives at.
    pub fn idle_rate(&self) -> f32 {
        self.idle_rate
    }

    /// Whether the wheel has stopped turning.
    pub fn at_rest(&self) -> bool {
        self.velocity.abs() < REST_RATE
    }

    /// Wheel angle between two pegs, radians. `TAU / peg_count`.
    pub fn peg_pitch(&self) -> f32 {
        self.pitch
    }

    /// Pegs on the rim, from the manifest.
    pub fn peg_count(&self) -> u32 {
        self.peg_count
    }

    /// How far the wheel has turned past the last peg, in `0.0..1.0` of a pitch. 0 the
    /// instant a peg releases the flapper.
    pub fn peg_phase(&self) -> f32 {
        self.travel_since_pass() / self.pitch
    }

    /// The flapper's deflection in radians, signed about [`Wheel::flapper_matrix`]'s axis.
    ///
    /// Negative while a wheel turning positive drags the blade, per the derivation in the
    /// module docs. Never exceeds [`TICK_AMPLITUDE`] of the manifest's clearance angle.
    pub fn deflection(&self) -> f32 {
        -self.drive * self.tick()
    }

    /// The parts this module turns: `Stage::wheel_indices`.
    pub fn wheel_parts(&self) -> &[usize] {
        &self.spinning
    }

    /// The `Pointer_Flapper` parts this module deflects.
    pub fn flapper_parts(&self) -> &[usize] {
        &self.flapper
    }

    // -- the tick ---------------------------------------------------------------------

    /// Wheel angle travelled since the last peg passed the tab, `0.0..pitch`.
    fn travel_since_pass(&self) -> f32 {
        (self.drive * (self.angle - self.pass)).rem_euclid(self.pitch)
    }

    /// Signed position within the current peg, radians in `-pitch/2 ..= pitch/2`. Negative
    /// while the next peg is still approaching the tab, positive after it has released.
    fn peg_offset(&self) -> f32 {
        let travel = self.travel_since_pass();
        if travel > self.pitch * 0.5 {
            travel - self.pitch
        } else {
            travel
        }
    }

    /// Book-keeps the flapper after the wheel has turned `travelled` radians over `dt`
    /// seconds. Call it with the new angle already in place.
    ///
    /// The only state the tick needs is how long ago a peg let the blade go. That is exact
    /// for the step: the last peg passed `travel_since_pass()` radians ago, so if the step
    /// covered at least that much, the release happened inside it and the elapsed time
    /// follows from the step's mean rate. Otherwise the blade is still ringing from an
    /// earlier release and the clock just runs on — which is what keeps the ring going after
    /// the wheel itself has stopped.
    fn track_pegs(&mut self, travelled: f32, dt: f32) {
        if travelled > 0.0 {
            self.drive = 1.0;
        } else if travelled < 0.0 {
            self.drive = -1.0;
        }
        let travel = self.travel_since_pass();
        // The slack matters. `travel` comes out of two `rem_euclid`s, so when a peg sits
        // exactly on the edge of a step the rounding can put it a few ulps beyond the step
        // and the release is missed — one whole tick dropped. Over-firing is harmless:
        // `travel / rate` is the right elapsed time whenever the rate is steady, which is the
        // only case that can over-fire.
        let slack = self.pitch * 1.0e-3;
        if travel <= travelled.abs() + slack && dt > 0.0 {
            let rate = (travelled.abs() / dt).max(REST_RATE);
            self.ring_time = travel / rate;
            self.ringing = true;
        } else {
            self.ring_time += dt.max(0.0);
        }
    }

    /// Deflection magnitude in radians, always positive-going: 0 at rest, [`Wheel::amplitude`]
    /// at the moment a peg releases the blade.
    fn tick(&self) -> f32 {
        let q = self.peg_offset();
        let mut level = if self.ringing { self.ring(self.ring_time) } else { 0.0 };
        if q <= 0.0 && q >= -self.window {
            let x = q / self.window;
            let contact = 1.0 + (CONTACT_START - 1.0) * x * x;
            if contact > level {
                level = contact;
            }
        }
        level * self.amplitude
    }

    /// Free response of the blade, released from 1.0 at zero velocity `t` seconds ago, as a
    /// fraction of the amplitude. Standard under-damped step-release: it starts at 1.0 with
    /// zero slope, so it meets the contact profile smoothly, dips to -0.126 and dies.
    fn ring(&self, t: f32) -> f32 {
        if t <= 0.0 {
            return 1.0;
        }
        let decay = -RING_DAMPING * self.natural * t;
        if decay < -40.0 {
            return 0.0;
        }
        let phase = self.damped * t;
        decay.exp() * (phase.cos() + (RING_DAMPING * self.natural / self.damped) * phase.sin())
    }
}

/// Signed offset of `angle` from the nearest multiple of `pitch`, in `-pitch/2 ..= pitch/2`.
fn detent_offset(angle: f32, pitch: f32) -> f32 {
    let mut e = angle.rem_euclid(pitch);
    if e > pitch * 0.5 {
        e -= pitch;
    }
    e
}

/// `v` normalised, or `fallback` if it has no length.
fn unit_or(v: Vec3, fallback: Vec3) -> Vec3 {
    if v.magnitude() > 0.0 {
        v.normalize()
    } else {
        fallback
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wheel() -> Wheel {
        let manifest = Manifest::load_from_assets().expect("assets/scene.json");
        Wheel::detached(&manifest)
    }

    fn near(a: f32, b: f32, tol: f32) -> bool {
        (a - b).abs() <= tol
    }

    #[test]
    fn geometry_comes_from_the_manifest() {
        let manifest = Manifest::load_from_assets().expect("assets/scene.json");
        let w = Wheel::detached(&manifest);
        assert_eq!(w.peg_count(), 48);
        assert!(near(w.peg_pitch().to_degrees(), 7.5, 1.0e-4));
        // One stud width of arc, 38% of the pitch. Derived from the manifest rather than
        // copied out of it: this assertion held `0.112 / 2.245`, and the rounded stud width
        // failed the moment the manifest was regenerated from the .blend at full precision.
        let window = manifest.wheel.peg_stud_size / manifest.wheel.peg_ring_radius;
        assert!(near(w.window, window, 1.0e-6));
        let amplitude = TICK_AMPLITUDE * manifest.flapper.clearance_deflection_deg;
        assert!(near(w.amplitude.to_degrees(), amplitude, 1.0e-3));
        // The pegs straddle the flapper at angle 0, so a pass is half a pitch away.
        assert!(near(w.pass, w.peg_pitch() * 0.5, 1.0e-6));
    }

    #[test]
    fn the_shot_frame_is_the_rest_pose() {
        let mut w = wheel();
        w.drive_to(0.0);
        assert_eq!(w.angle(), 0.0);
        assert_eq!(w.deflection(), 0.0);
        for m in [w.spin_matrix(), w.flapper_matrix()] {
            let p = m * vec4(1.0, 2.0, 3.0, 1.0);
            assert!(near(p.x, 1.0, 1.0e-5) && near(p.y, 2.0, 1.0e-5) && near(p.z, 3.0, 1.0e-5));
        }
    }

    #[test]
    fn the_constant_rate_drive_is_pure_in_seconds() {
        let mut a = wheel();
        let mut b = wheel();
        for seconds in [0.0, 0.017, 0.5, 3.3, 60.0] {
            a.drive_to(seconds);
            b.drive_to(seconds);
            assert_eq!(a.angle(), b.angle());
            assert_eq!(a.deflection(), b.deflection());
        }
        // Order of calls does not matter either.
        a.drive_to(7.0);
        let after = a.angle();
        a.drive_to(0.25);
        a.drive_to(7.0);
        assert_eq!(a.angle(), after);
    }

    #[test]
    fn the_free_drive_is_deterministic() {
        let steps: Vec<f32> = (0..600).map(|i| 1.0 / 60.0 + (i % 7) as f32 * 1.0e-4).collect();
        let run = || {
            let mut w = wheel();
            w.reset(0.0);
            w.kick();
            let mut trace = Vec::new();
            for dt in &steps {
                w.advance(*dt);
                trace.push((w.angle(), w.velocity(), w.deflection()));
            }
            trace
        };
        assert_eq!(run(), run());
    }

    #[test]
    fn friction_stops_the_wheel_on_a_sector() {
        let mut w = wheel();
        w.reset(0.0);
        w.kick();
        let mut seconds = 0.0;
        let mut still = 0;
        while seconds < 40.0 {
            w.advance(1.0 / 60.0);
            seconds += 1.0 / 60.0;
            // The detent makes the wheel rock as it settles, and the velocity touches zero at
            // every turning point, so wait for it to stay there.
            still = if w.velocity() == 0.0 { still + 1 } else { 0 };
            if still > 60 {
                break;
            }
        }
        assert!(w.at_rest(), "still turning at {} rad/s", w.velocity());
        assert!(seconds > 5.0 && seconds < 20.0, "coast took {seconds} s");
        // The detent leaves it within its dead band of a sector centre, and the blade hangs.
        let dead_band = BEARING_FRICTION / DETENT_STIFFNESS;
        assert!(
            detent_offset(w.angle, w.pitch).abs() <= dead_band + 1.0e-3,
            "rested {} deg off a sector centre",
            detent_offset(w.angle, w.pitch).to_degrees()
        );
        assert!(w.deflection().abs() < 0.02, "blade left at {} rad", w.deflection());
    }

    #[test]
    fn one_tick_per_peg_and_never_past_the_clearance_bound() {
        let manifest = Manifest::load_from_assets().expect("assets/scene.json");
        let bound = manifest.flapper.clearance_deflection_deg.to_radians();
        let mut w = Wheel::detached(&manifest);
        let mut peaks = 0;
        let mut previous = 0.0;
        let mut rising = false;
        // One revolution of the constant-rate drive, sampled 40 times per pitch.
        let samples = 48 * 40;
        let turn = TAU / w.idle_rate();
        for i in 1..=samples {
            w.drive_to(turn * i as f32 / samples as f32);
            let d = w.deflection().abs();
            assert!(d < bound, "deflection {d} rad exceeds the clearance bound {bound}");
            if d > previous {
                rising = true;
            } else if rising && d > 0.9 * w.amplitude {
                peaks += 1;
                rising = false;
            }
            previous = d;
        }
        assert_eq!(peaks, 48, "one full deflection per peg");
    }

    /// Sweeps the wheel at a fixed rate by hand, so the tick curve can be sampled as finely
    /// in wheel angle as the shape needs, independently of any frame rate.
    fn sweep(w: &mut Wheel, rate: f32, samples: usize, pitches: f32) -> Vec<f32> {
        w.reset(0.0);
        let step = w.pitch * pitches / samples as f32;
        let mut out = Vec::with_capacity(samples);
        for i in 1..=samples {
            w.angle = (step * i as f32).rem_euclid(TAU);
            w.velocity = rate;
            w.track_pegs(step, step / rate);
            out.push(w.deflection());
        }
        out
    }


    #[test]
    fn the_blade_is_dragged_against_the_wheels_own_rotation_sense() {
        let mut w = wheel();
        // Sitting exactly on a pass is the peak of the tick.
        w.drive_to(w.pass / w.idle_rate());
        assert!(near(w.deflection(), -w.amplitude, 1.0e-3), "{}", w.deflection());
        // A wheel turning positive drags the blade negative and never the other way, beyond
        // the ring's own overshoot.
        let forward = sweep(&mut w, 4.0, 4000, 6.0);
        let low = forward.iter().cloned().fold(f32::MAX, f32::min);
        let high = forward.iter().cloned().fold(f32::MIN, f32::max);
        assert!(near(low, -w.amplitude, 1.0e-3), "peak {low}");
        assert!(high < 0.2 * w.amplitude, "overshoot {high}");
        // Turning the other way mirrors it.
        let back = sweep(&mut w, -4.0, 4000, -6.0);
        assert_eq!(forward.len(), back.len());
        for (f, b) in forward.iter().zip(back.iter()) {
            assert!(near(*f, -*b, 1.0e-4), "{f} against {b}");
        }
    }

    #[test]
    fn the_tick_is_continuous_at_every_speed() {
        let mut w = wheel();
        for rate in [0.4, 0.9, 2.0, 6.0, 14.0, 26.0] {
            // 400 samples per peg: the steepest part of the curve is the peg lifting the
            // blade, 1.35 amplitudes over 2.9 deg of wheel, which is 0.006 rad per sample.
            let trace = sweep(&mut w, rate, 4000, 10.0);
            let jump = trace
                .windows(2)
                .map(|p| (p[1] - p[0]).abs())
                .fold(0.0, f32::max);
            assert!(
                jump < 0.02,
                "at {rate} rad/s the blade jumped {jump} rad between samples 0.019 deg apart"
            );
        }
    }

    #[test]
    fn a_stalled_frame_cannot_fling_the_wheel() {
        let mut w = wheel();
        w.reset(0.0);
        w.kick();
        let far = w.angle();
        w.advance(60.0);
        let mut clamped = wheel();
        clamped.reset(0.0);
        clamped.kick();
        clamped.advance(MAX_ADVANCE);
        assert_eq!(w.angle(), clamped.angle());
        assert!(w.angle() != far);
    }

    #[test]
    fn a_kick_spins_it_up_and_stop_kills_it() {
        let mut w = wheel();
        w.reset(0.0);
        assert!(w.at_rest());
        w.kick();
        assert!(near(w.velocity(), KICK_RATE, 1.0e-6));
        for _ in 0..40 {
            w.kick();
        }
        assert!(near(w.velocity(), MAX_RATE, 1.0e-6));
        w.stop();
        assert!(w.at_rest());
    }
}
