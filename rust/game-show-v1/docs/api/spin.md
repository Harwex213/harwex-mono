# `src/spin.rs` — wheel motion and the flapper tick

Owner: agent K. This file documents the public surface of `src/spin.rs`. Nothing else in the
crate is described here.

Everything is in the **scene frame** (glTF, Y up), radians and seconds. Vectors read out of
the manifest go through `Manifest::to_scene_point` / `to_scene_dir`, which are the identity
while `vectors_in` is `gltf_y_up` and stay correct if that changes.

## What moves and what does not

| Node | Motion |
| --- | --- |
| `Wheel_Root` subtree — 57 parts | rotates about `wheel.axis` `(0, 0, -1)` through `wheel.pivot` `(0, 3.5, -1.2)` |
| `Pointer_Flapper` — 3 parts | rotates about `flapper.deflection_axis` `(0, 0, -1)` through `flapper.pivot` `(0, 6.22, -0.795)` |
| `Wheel_Stand` and its four children | never |
| `Crest_Root`, `Crest_Crystal`, `Crest_Chevron`, `Crest_Stalk` | never |
| everything else | never |

The turning set is `Stage::wheel_indices()` verbatim, so `Wheel_Legs`, `Wheel_Axle`,
`Wheel_BasePlate` and `Wheel_CrossBar` are excluded by the node tree rather than by a name
list. 57 parts for 56 children, because `Wheel_Pegs` has two material slots. The flapper is
three parts, one per material slot (`MAT_Crystal`, `MAT_Gold_Trim`, `MAT_Metal_Polished`),
collected with `Stage::indices_under`; `Stage::index_of` would have found only the first.

Each part is set to `matrix * part.base_transformation`. The imported world transform is
composed with, never replaced.

## Public API

```rust
pub const FLAPPER: &str;              // "Pointer_Flapper", used when the manifest names none

pub struct Wheel;

impl Wheel {
    // build
    pub fn new(stage: &Stage, manifest: &Manifest) -> Self;

    // drive A: constant rate, pure in absolute time. What --shot uses.
    pub fn update(&mut self, stage: &mut Stage, seconds: f32);
    pub fn drive_to(&mut self, seconds: f32);

    // drive B: free running, delta time, friction. What a kickable viewer uses.
    pub fn advance(&mut self, dt: f32);
    pub fn kick(&mut self);
    pub fn kick_with(&mut self, delta_rad_per_s: f32);
    pub fn stop(&mut self);
    pub fn reset(&mut self, angle: f32);

    // transforms
    pub fn apply(&self, stage: &mut Stage);
    pub fn spin_matrix(&self) -> Mat4;
    pub fn flapper_matrix(&self) -> Mat4;

    // readings
    pub fn angle(&self) -> f32;          // radians, 0..TAU
    pub fn velocity(&self) -> f32;       // radians per second, signed
    pub fn idle_rate(&self) -> f32;      // radians per second, from the manifest
    pub fn at_rest(&self) -> bool;
    pub fn peg_pitch(&self) -> f32;      // radians between two pegs, TAU / peg_count
    pub fn peg_count(&self) -> u32;
    pub fn peg_phase(&self) -> f32;      // 0.0..1.0 of a pitch since the last peg
    pub fn deflection(&self) -> f32;     // flapper angle, radians, signed
    pub fn wheel_parts(&self) -> &[usize];
    pub fn flapper_parts(&self) -> &[usize];
}
```

`update` is `drive_to` followed by `apply`, and its signature is unchanged from agent F's
stub, so `src/main.rs` and `src/shot.rs` need no edit for the wheel to spin.

## The two drives

**Constant rate.** `update(stage, seconds)` and `drive_to(seconds)` put the wheel at
`idle_rate * seconds` and derive everything else from that. A pure function of `seconds`: no
wall clock, no accumulation, calls in any order give the same answer. `update(stage, 0.0)`
is angle 0 with the flapper hanging straight, which is the frame `--shot` writes.

**Free running.** `advance(dt)` integrates one step of

```
angular acceleration = -DETENT_STIFFNESS * offset_from_nearest_sector
                       -AIR_DRAG * velocity
                       -BEARING_FRICTION * sign(velocity)     // clamped, cannot reverse
```

so the wheel coasts down and stops. Deterministic in the starting state and the sequence of
`dt` values. The step is split into substeps of at most `MAX_SUBSTEP` so the coast-down does
not depend on the frame rate, and one call simulates at most `MAX_ADVANCE` seconds so a
stalled frame cannot fling the wheel.

Pick one drive per frame. `update` re-derives the angle from absolute time and would undo a
kick.

`kick()` from a `12 rad/s` start coasts about 9 turns in 11 seconds and spends the last
2.5 of them slow enough to read peg by peg.

## Tunable constants

| Constant | Value | Unit | Where it comes from |
| --- | --- | --- | --- |
| `KICK_RATE` | 12.0 | rad/s | look-dev: 1.9 rev/s, an 11 s coast |
| `MAX_RATE` | 26.0 | rad/s | 9.5 deg per frame at 60 fps, 1.3 pegs: past this the tick aliases |
| `AIR_DRAG` | 0.10 | 1/s | look-dev |
| `BEARING_FRICTION` | 0.55 | rad/s² | look-dev; speed-independent, so the wheel stops in finite time |
| `DETENT_STIFFNESS` | 24.0 | rad/s² per rad | look-dev; must exceed `BEARING_FRICTION / (pitch/2)` = 8.4 |
| `REST_RATE` | 0.01 | rad/s | threshold for `at_rest` |
| `MAX_SUBSTEP` | 1/120 | s | integration |
| `MAX_ADVANCE` | 0.25 | s | ceiling on one `advance` call |
| `TICK_AMPLITUDE` | 0.62 | fraction | of `flapper.clearance_deflection_deg` = 32.2 deg, so 20 deg |
| `RING_CYCLES_PER_PEG` | 1.6 | cycles | look-dev; 11 Hz at the idle rate |
| `RING_DAMPING` | 0.55 | ratio | look-dev; one overshoot at 13% of the amplitude |
| `CONTACT_START` | -0.35 | fraction | must sit below the ring's deepest overshoot, -0.126 |

Taken from `assets/scene.json` and never hard-coded: `wheel.pivot`, `wheel.axis`,
`wheel.rate` (0.9 rad/s), `wheel.peg_count` (48), `wheel.peg_first_angle_deg` (3.75),
`wheel.peg_ring_radius` (2.245), `wheel.peg_stud_size` (0.112), `flapper.pivot`,
`flapper.deflection_axis`, `flapper.clearance_deflection_deg` (32.2), `flapper.node`.

## The tick

The striker tab hangs 0.515 m below a hinge that sits 2.72 m above the wheel axis, which
puts it at radius 2.205 m and at wheel-local angle 0. The pegs are at `3.75 deg + k*7.5 deg`.
So at wheel angle 0 the flapper is over a sector centre with a peg 3.75 deg either side, and
one peg reaches the tab every `peg_pitch()` of rotation: **the tick rate is `peg_count` per
revolution**, straight out of the manifest, 48 ticks per turn.

`q` is the wheel angle past the last peg pass, signed so `q < 0` means the peg is still
approaching. The deflection magnitude is the larger of two terms:

1. **Contact**, only for `-window <= q <= 0`: `1 + (CONTACT_START - 1) * (q/window)²`, rising
   to the full amplitude at `q = 0`, where the peg is on the tab and the blade lets go.
   `window = peg_stud_size / peg_ring_radius` = 0.0499 rad, one stud width of arc, 38% of the
   pitch — geometry, not a choice.
2. **Ring**, for the rest: the free response of a damped spring released from the amplitude
   at zero velocity, `e^(-zt)(cos + (z/wd) sin)`. A snap back, one overshoot at 13%, then
   rest.

The larger of the two, because a peg can push the blade out and never pull it down. That one
`max` is what makes the tick read mechanically across the speed range: below about 1 rad/s
the ring finishes and the blade rests between pegs; by 6 rad/s it has not come home before
the next peg arrives, so the blade stands out at 15 to 20 deg and wobbles, which is what a
fast wheel looks like. `CONTACT_START` is negative so that the contact profile always starts
below wherever the blade happens to be, and the deflection stays continuous at the edge of
the window at every speed.

The only state the tick keeps is how long ago a peg let the blade go. When the wheel stops,
that clock keeps running, so the blade rings out instead of freezing mid-swing.

`clearance_deflection_deg` = 32.2 deg is the deflection at which the tab clears a peg tip
entirely. It is an upper bound, not a target: the tick peaks at 62% of it and a test asserts
the deflection never reaches it.

## Which way the blade leans

Derived, because `docs/scene_audit.md` section 3 contradicts itself on this point. In the
scene frame a rotation of `phi` about `(0, 0, -1)` is `Rz(-phi)`. It carries a peg at the top
of the disc, offset `(0, +r, 0)` from the axis, to `(+r sin phi, ...)`, so positive `phi`
moves the top of the wheel toward `+x`, screen right from the hero camera, clockwise. The
blade hangs *below* its hinge, offset `(0, -L, 0)`, and a rotation of `psi` about the same
axis moves its tip to `(-L sin psi, ...)`. The peg drags the tab the way the wheel is
turning, so a positive wheel angle deflects the blade to a **negative** `psi`.
`deflection()` returns that signed angle. The audit's "a wheel turning positive about +Y
drags the flapper to positive psi" follows from its own slip one paragraph earlier,
"positive psi pushes the tip toward +X", which the same rotation matrix contradicts.

## Coming to rest

`BEARING_FRICTION` alone would stop the wheel anywhere. The flapper leans on whichever peg
it is nearest, and that pulls the wheel until the blade hangs in a gap — a sector centred
under the flapper, which is where a real prize wheel stops. `DETENT_STIFFNESS` models it as
a spring toward the nearest multiple of the pitch. At speed it is a zero-mean ripple; it
only bites at the end, where it produces a short rock and then a stop. Dry friction leaves a
dead band of `BEARING_FRICTION / DETENT_STIFFNESS` = 1.3 deg of a 7.5 deg sector, and the
blade's residual deflection there is under 0.3 deg.

## Wiring the kick — for whoever owns `src/main.rs`

The wheel already spins with no change at all: `World::update` calls
`Wheel::update(&mut stage, seconds)` and that is the constant-rate drive. To get a kickable,
coasting wheel, switch the viewer to the free-running drive and leave `--shot` alone. In
`World`:

```rust
/// Free-running drive for the viewer. `seconds` is still absolute, for the sky shader.
pub fn advance(&mut self, dt: f32, seconds: f32) {
    self.wheel.advance(dt);
    self.wheel.apply(&mut self.stage);
    for sky in &mut self.skies {
        sky.set_time(seconds);
    }
}
```

In the render loop, replacing the `world.update(...)` call (frame times in three-d are
**f64 milliseconds**):

```rust
world.advance(
    (frame_input.elapsed_time * 0.001) as f32,
    (frame_input.accumulated_time * 0.001) as f32,
);
```

And one event arm, next to the `R` / `Home` arm:

```rust
Event::KeyPress { kind: Key::Space, handled, .. } if !*handled => {
    world.wheel.kick();
    *handled = true;
}
```

`src/shot.rs` keeps `world.update(0.0)` and stays deterministic.

## Tests

`cargo test spin` — ten tests, no GPU context needed; they build the state from
`assets/scene.json` and exercise the maths.

| Test | What it pins down |
| --- | --- |
| `geometry_comes_from_the_manifest` | 48 pegs, 7.5 deg pitch, the window from the stud size, the amplitude from the clearance angle, a pass half a pitch from angle 0 |
| `the_shot_frame_is_the_rest_pose` | `drive_to(0.0)` gives angle 0, deflection 0, and both matrices are the identity |
| `the_constant_rate_drive_is_pure_in_seconds` | same `seconds` gives the same state, in any call order |
| `the_free_drive_is_deterministic` | two runs of the same 600-step `dt` sequence agree exactly |
| `friction_stops_the_wheel_on_a_sector` | a kick coasts 5 to 20 s, stops inside the detent's dead band, blade hanging |
| `one_tick_per_peg_and_never_past_the_clearance_bound` | exactly 48 full deflections per revolution, never past 32.2 deg |
| `the_blade_is_dragged_against_the_wheels_own_rotation_sense` | the sign derivation above, and that reversing the wheel mirrors the tick |
| `the_tick_is_continuous_at_every_speed` | 0.4 to 26 rad/s, no step over 0.02 rad between samples 0.019 deg of wheel apart |
| `a_stalled_frame_cannot_fling_the_wheel` | `advance(60.0)` equals `advance(MAX_ADVANCE)` |
| `a_kick_spins_it_up_and_stop_kills_it` | `kick` adds `KICK_RATE`, repeated kicks clamp at `MAX_RATE`, `stop` rests |
