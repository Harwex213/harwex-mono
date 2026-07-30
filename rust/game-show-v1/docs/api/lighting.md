# `src/lighting.rs` — public API, units and constants

Agent H. This file is the contract agent L wires the module from. Everything below is
compiled: `cargo check --all-targets` passes and the module's six unit tests pass.

**Nothing here has been seen on screen.** The lights cannot be judged until integration, so
no claim about the look is made. What is verified is that it compiles, that the constants
match the arithmetic they document, and that the arithmetic matches `assets/scene.json`.

## Entry point

```rust
pub fn Rig::build(context: &Context, manifest: &Manifest) -> crate::Result<Rig>
```

One call takes the three-d context and the manifest and returns the whole assembled rig.
`src/main.rs` already calls it exactly this way, so no change is needed there.

It fails, rather than rendering a rig with a piece missing, when the manifest has no light
named `Key_Wheel`.

## The rest of the surface

```rust
pub fn Rig::lights(&self) -> Vec<&dyn Light>
pub fn Rig::generate_shadow_maps(&mut self, casters: &[&dyn Object]) -> crate::Result<()>
pub fn Rig::update(&mut self, seconds: f32, casters: &[&dyn Object]) -> crate::Result<bool>
pub fn Rig::len(&self) -> usize
pub fn Rig::is_empty(&self) -> bool
pub fn environment_cube_map(context: &Context, manifest: &Manifest) -> TextureCubeMap
```

`Rig`'s fields are private. `lights()` is the only way the render call sees them.

- `lights()` returns 7 entries for this scene, ambient first: 1 `AmbientLight`,
  3 `DirectionalLight`, 3 `SpotLight`. Rebuild it per frame; `&[&dyn Light]` is what
  `RenderTarget::render` wants and the reborrow is cheap next to the draw calls.
- `generate_shadow_maps` is the **start-up** call. `src/main.rs` already makes it, inside
  `World::build`, with `stage.objects()` plus the sky screens. Keep it there: attaching a
  shadow map changes `Light::id()` from `LightId::SpotLight(false)` to
  `LightId::SpotLight(true)`, which changes the shader cache key and recompiles every
  material shader. Paying that during start-up is the point.
- `update` is the **per-frame** hook, and it is the one thing not wired yet. It refreshes
  the key light's shadow map so the spinning wheel's shadow moves with it. Returns `true`
  when it re-rendered. It is throttled to `SHADOW_REFRESH_INTERVAL` (0.05 s, 20 Hz) because
  each refresh re-renders every caster into a freshly allocated `DepthTexture2D`.

### For agent L: where `update` goes

It needs `&mut Rig` and the object list at the same time, and `World::frame()` hands both
out of disjoint fields already. In `World::update`, after `self.wheel.update(..)` has moved
the wheel so the shadow matches the frame being drawn:

```rust
pub fn update(&mut self, seconds: f32) -> Result<()> {
    self.wheel.update(&mut self.stage, seconds);
    for sky in &mut self.skies {
        sky.set_time(seconds);
    }
    let World { stage, skies, rig, .. } = self;
    let mut casters = stage.objects();
    casters.extend(skies.iter().map(|s| s.object()));
    rig.update(seconds, &casters)?;
    Ok(())
}
```

That changes `World::update`'s return type to `Result<()>`, so the viewer loop and
`src/shot.rs` need a `?` or an `if let Err(..)`. If L would rather not change the signature,
calling `rig.update(..)` from the render loop right before `world.frame()` works just as
well — the only ordering rule is that the wheel has already been moved.

`update(0.0, ..)` always refreshes, and refreshes again whenever `seconds` moves backwards,
so the deterministic `--shot` frame gets the shadow for wheel rotation zero regardless of
what ran before it. Leaving `update` unwired is safe: the start-up shadow map stays, and the
wheel's shadow is then frozen at rotation zero while the wheel spins.

## Units

| Quantity | Unit | Where it comes from |
| --- | --- | --- |
| `LightSpec::energy` | Blender watts | `assets/scene.json`, `energy_watts` |
| `*_WATTS_TO_INTENSITY` | 1 / (watt · metre²) · steradian⁻¹, i.e. whatever makes the product dimensionless | this module |
| three-d `intensity` | dimensionless multiplier on the linear light colour | product of the two above |
| `color * intensity` in the shader | **irradiance arriving at the surface**, linear, arbitrary scale | derived below |
| `AMBIENT_INTENSITY` | multiplier on the environment map's radiance | this module |
| environment cube map texels | linear radiance, same scale | `assets/scene.json` material emissions |
| `KEY_WHEEL_CUTOFF`, `cone_outer_half_angle_rad` | radians, **half** angle | this module / manifest |
| `SHADOW_REFRESH_INTERVAL` | seconds | this module |
| `Rig::update`'s `seconds` | seconds (not the `f64` milliseconds `FrameInput` carries) | caller |

### Why `color * intensity` is irradiance

`three-d`'s `intensity` is documented as a bare multiplier, and three-d never divides by 4π
or by an area. But the shader fixes the unit anyway. `light_shared.frag`:

```glsl
vec3 diffuse = diffuse_fresnel * mix(surface_color, vec3(0.0), metallic) / PI;
return (diffuse + specular) * light_color * NdL;
```

A Lambertian surface facing the light therefore leaves with radiance
`albedo * intensity * color / PI`. Blender's own answer is `albedo * E / PI`. The two are the
same expression, so `color * intensity` sits exactly where `E` sits: it is the irradiance in
whatever linear unit the renderer works in. That is what makes the watt conversion below a
derivation rather than a guess.

## The watts-to-intensity constants — one per light

`intensity = CONSTANT * energy_watts`. These six are the numbers look-dev retunes, and they
are the most likely thing in the module to need retuning.

| Constant | Light | Watts | d to `Wheel_Root` | Formula | Value | Resulting intensity |
| --- | --- | --- | --- | --- | --- | --- |
| `KEY_WHEEL_WATTS_TO_INTENSITY` | `Key_Wheel` | 900 | 6.6851 m | `1 / (π · 44.690)` | 0.007123 | 6.411 |
| `BEAM_L_WATTS_TO_INTENSITY` | `Beam_L` | 2500 | 8.5779 m | `1 / (4π · 73.580)` | 0.001082 | 2.705 |
| `BEAM_R_WATTS_TO_INTENSITY` | `Beam_R` | 2500 | 8.5779 m | `1 / (4π · 73.580)` | 0.001082 | 2.705 |
| `RIM_L_WATTS_TO_INTENSITY` | `Rim_L` | 400 | 8.3241 m | `1 / (π · 69.290)` | 0.004594 | 1.838 |
| `RIM_R_WATTS_TO_INTENSITY` | `Rim_R` | 400 | 8.3241 m | `1 / (π · 69.290)` | 0.004594 | 1.838 |
| `FILL_FRONT_WATTS_TO_INTENSITY` | `Fill_Front` | 120 | 8.8284 m | `1 / (π · 77.940)` | 0.004084 | 0.490 |

The two formulas:

- **AREA lamp of total flux P.** A Lambertian emitter of flux `P` has peak radiant intensity
  `P / π` along its normal, so the on-axis irradiance at distance `d` is `P / (π d²)`.
- **SPOT lamp of total flux P.** Blender spreads a spot's flux over the whole sphere and then
  masks it with the cone, which is why narrowing a Blender spot does not brighten it. So the
  irradiance is `P / (4π d²)`.

`d` is the distance from the lamp to `Wheel_Root` at `(0, 3.5, -1.2)` in the glTF frame, for
all six. One reference point keeps the rule readable and the wheel is what the reference
image is exposed for. The cost: three-d applies no falloff away from that distance, so a
surface much closer to a lamp than the wheel is under-lit and one much further is over-lit.
That is the price of having no area light — see "attenuation" below.

`Beam_L` and `Beam_R` get separate constants despite being numerically equal, because
`docs/look_target.md` wants the two upper-right cones amber and brighter than the left-hand
ones, so they will diverge.

Two tests hold this table honest:
`the_constants_match_the_documented_arithmetic` recomputes every constant from the formula,
and `the_documented_distances_match_the_manifest` re-measures every `d²` from
`assets/scene.json`. Changing a constant on purpose fails the first test; that is the signal
to update the reasoning beside it rather than to silence the test.

## Blender lamp to three-d light

three-d has no area light, and four of the six lamps are AREA.

| Blender lamp | Type | three-d light | Why |
| --- | --- | --- | --- |
| `Key_Wheel` | AREA, 4 m, 900 W | `SpotLight`, cutoff 1.0 rad, shadow map | Only `SpotLight` and `DirectionalLight` can shadow, and the spot keeps the lamp's position — it is 5 m in front of the wheel, and a directional would light the far side of the room equally hard. The spot's shadow frustum also concentrates on the wheel: a directional shadow map spans `frustum_height = 35 m` over this 24 m set, 17 mm per texel at 2048, against the spot's 3.6 mm. And `smoothstep(0.75 · cutoff, cutoff, angle)` is the softest edge three-d offers, which is the part of an area light worth keeping. |
| `Beam_L` | SPOT | `SpotLight`, cutoff `cone_outer_half_angle_rad` = 0.19199 rad | Direct match. |
| `Beam_R` | SPOT | `SpotLight`, same cutoff | Direct match. |
| `Rim_L` | AREA, 3 m, 400 W | `DirectionalLight` | 8.3 m from the wheel, so a 3 m source subtends about 20° and its irradiance varies well under a stop across the 5.2 m wheel. Rim light is about direction, not distance, and a directional has no attenuation to fight. |
| `Rim_R` | AREA, 3 m, 400 W | `DirectionalLight` | Same. |
| `Fill_Front` | AREA, 6 m, 120 W | `DirectionalLight` | The tempting answer is to fold a soft frontal fill into the ambient, and it is wrong: a non-environment `AmbientLight` contributes nothing at all to a metal, and this fill's job includes lifting the polished hub and the chrome pegs off black. |

`direction` passes straight through. `assets/scene.json`'s `direction` is the propagation
direction and three-d's `DirectionalLight`/`SpotLight` shaders use `-direction` as the vector
towards the light, so no sign flip is owed. Positions and directions still go through
`Manifest::to_scene_point` / `to_scene_dir`, which are the identity today and stay correct if
`vectors_in` ever changes.

Blender's spot blend of 0.25 puts the inner cone at `0.75 × outer`, which is exactly where
three-d's `smoothstep` starts. The cone softness needs nothing done to it, and
`the_beam_cone_softness_matches_three_ds_smoothstep` asserts the manifest still says so.

### Every light keeps `Attenuation::default()`

That is no falloff at all. Two reasons, and they agree:

1. The conversion constants already carry `1 / d²` at one reference distance. A quadratic
   attenuation term would count the falloff twice.
2. It could not be compensated by raising the constants. `attenuate` is
   `light_color / max(1.0, att)`, so attenuation can only ever dim, and never below the
   1 m mark. With `quadratic = 1.0` a lamp 8.6 m away dims by 74× while the truss tubes
   within a metre of the beam lamps are not dimmed at all. Raising the constants 74× to
   compensate would blow those out.

## The ambient term

`AmbientLight::new_with_environment(context, AMBIENT_INTENSITY, Srgba::WHITE, &cube)`.

Blender's world is a plain Background node at `(0.01, 0.008, 0.02)` linear with no HDRI, so
the level is a judgement call. The *environment* is not optional, though, for the reason
`src/scene.rs`'s module docs set out: a plain `AmbientLight` computes
`occlusion * ambientColor * mix(surface_color, vec3(0.0), metallic)`, which is exactly zero
at `metallic = 1`, and `MAT_Gold_Trim`, `MAT_Gold_Dark`, `MAT_Metal_Polished`,
`MAT_Truss_Metal` and `MAT_Peg_Metal` are all fully metallic. Without an environment the hub,
the rim pegs and the truss render black except for direct specular, and the reference has
them bright. `new_with_environment` takes the other branch of that shader, which computes an
IBL diffuse *and* specular.

The colour is `Srgba::WHITE` on purpose: the hue lives in the cube map, so tinting the light
as well would apply it twice.

### The generated cube map

`environment_cube_map(&Context, &Manifest) -> TextureCubeMap`. There is no HDRI and no
network, so it is generated. Six 64×64 `[f16; 4]` faces, `ClampToEdge`, mip maps on —
`prefilter.frag` samples the source with `textureLod`, and a three-channel float format would
silently skip mip generation.

The map is a function of elevation only. Every colour is manifest data and every angle is a
measurement:

| Region | Value | Source |
| --- | --- | --- |
| Horizon band | `MAT_LED_Screen`'s `effective_emission` = `(0.525, 0.45, 0.9)` | `assets/scene.json` |
| Above `ENVIRONMENT_BAND_TOP` = 0.2445 | fades to `RenderSpec::background()` = `(0.01, 0.008, 0.02)` | `assets/scene.json` |
| Below `ENVIRONMENT_BAND_BOTTOM` = 0.2322 | fades to band × `MAT_Floor_Gloss.base_color` = `(0.029, 0.023, 0.068)` | one floor bounce |

The two band edges are the sines of the elevations of the LED wall's top and bottom edges
seen from the wheel centre: `Wall_Screen` is a cylinder of radius 11.30 m spanning Blender z
0.80 to 6.35 (`docs/scene_audit.md` §1) and `Wheel_Root` is 3.5 m up, so
`atan((6.35 − 3.5) / 11.3) = 14.15°`, `sin = 0.2445`, and
`atan((3.5 − 0.8) / 11.3) = 13.43°`, `sin = 0.2322`.

`AMBIENT_INTENSITY = 0.45`. The map holds real radiance, so 1.0 would be the fully physical
answer and needs no free gain. It is 0.45 because the band value is the *pre-texture* node
emission: the shader multiplies emission by `T_LEDWall_Sky`, whose mean is well below 1.0 —
dark cobalt over most of its area, bright only in the cloud tops — and because the truss, the
pillars and the fascia occlude part of the wall.

What to check on a crop: gold at roughness 0.22 whose reflection vector points at the band
comes out near `0.45 × 0.9 × 0.7 = 0.28`, a dark warm-violet tint, while gold facing the
ceiling void reflects `0.45 × 0.02 = 0.009` and stays black. Shadowed metal stays dark; it
stops being *pure* black. Raising this washes the metals out flat, which is the failure mode
to watch for. `shadowed_metal_stays_dark` pins both bounds.

The map has **no azimuthal variation**, and that is the obvious next look-dev step:
`docs/look_target.md` says the reference is magenta and coral on the left and cobalt and cyan
on the right, and a hue that swings with azimuth would put that split onto the metals. It
needs two colours that are in neither the manifest nor the .blend, so it is a look-dev call
and this module does not invent it.

## The shadow map

On `Key_Wheel` only. It is the one lamp above and in front of the wheel, and
`docs/look_target.md` has the wheel's shadow on the floor behind it.

| Constant | Value | Meaning |
| --- | --- | --- |
| `SHADOW_MAP_SIZE` | 2048 | texels per side |
| `KEY_WHEEL_CUTOFF` | 1.0 rad | half-angle of the lit cone |
| `SHADOW_REFRESH_INTERVAL` | 0.05 s | 20 Hz throttle in `Rig::update` |

`KEY_WHEEL_CUTOFF` is load-bearing twice over, and both readings pull the same way.
`SpotLight::generate_shadow_map` builds its shadow camera with
`field_of_view_y = self.cutoff`, so the **shadow frustum's half-angle is `cutoff / 2`**, half
the lit cone. At 0.5 rad that is a 3.65 m radius at the wheel's 6.69 m — the 2.6 m wheel fits
— and a 6.4 m radius where the light's axis meets the floor at `z = −5.0`, which covers the
patch the shadow lands on. Tightening the cutoff clips the shadow, and `is_visible` returns
*unshadowed* for anything outside the map, so the clip shows up as a shadow that stops
mid-floor rather than as a black edge. Widening it softens the lit pool and coarsens the
shadow.

The lit cone at 1.0 rad has its flat core out to 0.75 rad, a 6.4 m radius at the wheel, with
the `smoothstep` edge falling off over the rest of the set. A 4 m area light 6.7 m away is
that broad.

## Debugging

`GS_LIGHT_AUDIT=1` prints one line per light: the Blender type, the three-d type it became,
the watts, the conversion constant, the resulting intensity, and the position and direction
actually used, plus `[shadow]` on the one that casts. Mirrors `GS_MATERIAL_AUDIT` in
`src/scene.rs`.

## Known discrepancy for look-dev, not resolved here

The manifest gives `Rim_L` at `x = −8` the cool blue `(0.35, 0.55, 1.0)` and `Rim_R` at
`x = +8` the pink `(1.0, 0.3, 0.65)`. A lamp on the left rims the left-facing surfaces, so the
scene data puts **blue on the left and pink on the right**. `docs/look_target.md` reads the
reference the other way round: "the frame reads magenta and coral on the left, cobalt and cyan
on the right", and it also says that where the two disagree on light colour the reference
wins.

This module takes the colours from the manifest verbatim and does not second-guess them. The
fix, if look-dev agrees the reference wins, is to swap the two `color` arrays on `Rim_L` and
`Rim_R` in `assets/scene.json` — look-dev owns that file, and nothing in `src/lighting.rs`
needs to change.

## What is not done

- No light is animated. If the moving heads should sweep, that is new work and it belongs
  either here or in `src/postfx.rs`, which owns the visible cone geometry.
- The ten cones the reference shows are additive geometry in `src/postfx.rs`, not lights.
  This module builds two beam spots because the .blend has two; it does not try to make ten.
- Nothing here has been looked at on screen. Every number is derived or measured, and the
  first look-dev round is where they get judged.
