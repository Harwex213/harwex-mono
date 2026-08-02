# `src/lighting.rs` — public API, units and constants

Owner: agent H. The six Blender lamps as three-d lights, one IBL ambient term, the shadow map on
the key light, and one stand-in lamp set for the wheel's emissive bulbs.

**State of this document.** Rewritten during the cleanup pass, against the code as it stands. Every
value below was read out of `src/lighting.rs` and `assets/scene.json` at the same time. The previous
version had drifted: it gave `AMBIENT_INTENSITY` as 0.45 and `KEY_WHEEL_CUTOFF` as 1.0 where the
code says 0.18 and 0.8, it said every light keeps `Attenuation::default()` where three of them now
fall off with distance, it said the environment map has no azimuthal variation while the code had
one, it listed 7 lights where `lights()` returns 15, and it did not mention the bulb-ring stand-in
at all.

Verified three ways. `cargo check --all-targets` passes on the crate as it stands. `cargo test
--bins` passes all nine of this module's tests; the one failure in that run is
`spin::tests::geometry_comes_from_the_manifest`, which asserts a hardcoded 0.112 against the
manifest's new `peg_stud_size` and has nothing to do with this file. And
`GS_LIGHT_AUDIT=1 cargo run --bin game-show-v1 -- --shot renders/cleanup_i/shot.png` prints the
built rig: `Key_Wheel` 900 W × 0.007123 = 6.411, `Rim_L` and `Rim_R` 400 W × 0.004594 = 1.838,
`Fill_Front` 120 W × 0.004084 = 0.490 — the conversion and nothing else, where the shipped values
were 5.64, 5.24 and 0.078 — plus `8 PointLights ... colour Some([1.0, 0.93, 0.74]) (stand-in for
MAT_Bulb_Glass on the wheel's bulbs)` and `AmbientLight intensity 0.180`. The frame was not judged:
this pass does not do look-dev.

**On the ambient level.** The code, this file and the module's own doc comment disagreed: 0.18 in
code, 0.45 here, 0.28 in the doc comment. **0.18 is the real value** — it is the constant the
renderer reads — and the other two have been corrected to it. Nothing was retuned to reach it.

## What the cleanup pass removed

`docs/agent_plan.md` §"Cleanup pass" pulls the renderer back to faithful. Removed from this module,
each one a thing that existed only to move the frame toward `docs/wheel_stage.png`:

| Removed | Was | Why it went |
| --- | --- | --- |
| `KEY_LOOK_GAIN` | 0.88 on `Key_Wheel` | A per-lamp multiplier on top of the watt conversion. |
| `RIM_LOOK_GAIN` | 2.85 on `Rim_L` and `Rim_R` | Same, and the largest of the three: the rims ended up at 5.3 against a physical 1.84. |
| `FILL_LOOK_GAIN` | 0.16 on `Fill_Front` | Same. |
| `look_gain(name)` | the function applying them | Nothing left to apply. |
| `ENVIRONMENT_LEFT_TINT` | `(1.55, 0.50, 1.05)` | An azimuthal hue swing on the environment probe. The .blend's world is one flat Background node; the swing came from `docs/look_target.md`'s left/right split. |
| `ENVIRONMENT_RIGHT_TINT` | `(0.86, 0.66, 1.42)` | Same. |
| `azimuth_tint`, `modulate` | the helpers applying them | Nothing left to apply. |
| `ENVIRONMENT_CEILING` | `(0.22, 0.058, 0.27)` | An invented violet-magenta ceiling radiance that replaced the Blender world background overhead. Its hue was chosen twice by verdicts to make truss rim highlights read violet-brown. The zenith is `render.world_background` again. |
| `ENVIRONMENT_BAND_GAIN` | 2.6 | A gain on the probe's wall band alone, argued from the radiance `src/screen.rs` was drawing the wall at after its own look-dev gains, and chosen to make the pillars read. The probe is the manifest's `effective_emission` again, with `AMBIENT_INTENSITY` as the one scalar that sets its level. |
| `BULB_RING_COLOR` | `[1.0, 0.9, 0.62]` | Documented as `MAT_Bulb_Glass`'s emission colour normalised, but that is `(1, 0.93, 0.74)`. The colour is read from the manifest now, so it cannot drift. |

One value was restored rather than removed: `ENVIRONMENT_BAND_TOP` shipped at 0.52 with its own doc
comment deriving 0.2445 from the wall's measured geometry, and no note explaining the difference.
0.52 put the coloured band over 31° of sky instead of 14°, which raises what reaches every
upward-facing surface in the room. The measured value is back.

The frame is further from the reference for all of this. That is the intended trade, and nothing
else in the module was raised to compensate.

## Entry point

```rust
pub fn Rig::build(context: &Context, manifest: &Manifest) -> crate::Result<Rig>
```

One call takes the three-d context and the manifest and returns the whole assembled rig.
`src/main.rs` already calls it exactly this way. It fails, rather than rendering a rig with a piece
missing, when the manifest has no light named `Key_Wheel`.

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

- `lights()` returns **15** entries for this scene, ambient first: 1 `AmbientLight`,
  3 `DirectionalLight` (`Rim_L`, `Rim_R`, `Fill_Front`), 8 `PointLight` (the bulb-ring stand-in,
  `BULB_RING_LAMPS` of them), 3 `SpotLight` (`Key_Wheel`, `Beam_L`, `Beam_R`). Rebuild it per
  frame; `&[&dyn Light]` is what `RenderTarget::render` wants and the reborrow is cheap next to the
  draw calls. It returns 7 when the manifest says the bulbs do not emit — see the stand-in section.
- `generate_shadow_maps` is the **start-up** call, made inside `World::build`. Keep it there:
  attaching a shadow map changes `Light::id()` from `LightId::SpotLight(false)` to
  `LightId::SpotLight(true)`, which changes the shader cache key and recompiles every material
  shader. Paying that during start-up is the point.
- `update` is the **per-frame** hook. It refreshes the key light's shadow map so the spinning
  wheel's shadow moves with it, and returns `true` when it re-rendered. Throttled to
  `SHADOW_REFRESH_INTERVAL` (0.05 s, 20 Hz), because each refresh re-renders every caster into a
  freshly allocated `DepthTexture2D`. `update(0.0, ..)` always refreshes, and refreshes again
  whenever `seconds` moves backwards, so the deterministic `--shot` frame gets the shadow for wheel
  rotation zero regardless of what ran before it.

## Units

| Quantity | Unit | Where it comes from |
| --- | --- | --- |
| `LightSpec::energy` | Blender watts | `assets/scene.json`, `energy_watts` |
| `*_WATTS_TO_INTENSITY` | whatever makes the product dimensionless, i.e. `1 / (steradian · metre²)` | this module |
| three-d `intensity` | dimensionless multiplier on the linear light colour | the product of those two, and nothing else |
| `color * intensity` in the shader | **irradiance arriving at the surface**, linear, arbitrary scale | derived below |
| `AMBIENT_INTENSITY` | multiplier on the environment map's radiance | this module |
| environment cube map texels | linear radiance, same scale | `assets/scene.json` material emissions and world background |
| `KEY_WHEEL_CUTOFF`, `cone_outer_half_angle_rad` | radians, **half** angle | this module / manifest |
| `BULB_RING_INTENSITY` | the same dimensionless intensity, for the whole ring | this module |
| `SHADOW_REFRESH_INTERVAL`, `Rig::update`'s `seconds` | seconds (not the `f64` milliseconds `FrameInput` carries) | this module / caller |

### Why `color * intensity` is irradiance

`three-d`'s `intensity` is documented as a bare multiplier and three-d never divides by 4π or by an
area. The shader fixes the unit anyway. `light_shared.frag`:

```glsl
vec3 diffuse = diffuse_fresnel * mix(surface_color, vec3(0.0), metallic) / PI;
return (diffuse + specular) * light_color * NdL;
```

A Lambertian surface facing the light leaves with radiance `albedo * intensity * color / PI`.
Blender's own answer is `albedo * E / PI`. Same expression, so `color * intensity` sits exactly
where `E` sits: it is the irradiance in whatever linear unit the renderer works in. That is what
makes the watt conversion a derivation rather than a guess.

## The watts-to-intensity constants — one per light

`intensity = CONSTANT * energy_watts`. **No other factor.** These six are the whole conversion.

| Constant | Light | Watts | d to `Wheel_Root` | Formula | Value | Intensity |
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
- **SPOT lamp of total flux P.** Blender spreads a spot's flux over the whole sphere and then masks
  it with the cone, which is why narrowing a Blender spot does not brighten it. So the irradiance
  is `P / (4π d²)`.

`d` is the distance from the lamp to `Wheel_Root` at `(0, 3.5, -1.2)` in the glTF frame, for all
six. One reference point keeps the rule readable and the wheel is what the reference image is
exposed for. A light the table does not name falls back to the same rule evaluated at its own
distance, and prints a line saying so — that is a real conversion, and it reproduces all six named
values exactly.

Two tests hold the table honest: `the_constants_match_the_documented_arithmetic` recomputes every
constant from the formula, and `the_documented_distances_match_the_manifest` re-measures every `d²`
from `assets/scene.json`. Changing a constant fails the first test; that is the signal to update
the reasoning beside it rather than to silence the test.

## Blender lamp to three-d light

three-d has no area light, and four of the six lamps are AREA.

| Blender lamp | Type | three-d light | Why |
| --- | --- | --- | --- |
| `Key_Wheel` | AREA, 4 m, 900 W | `SpotLight`, cutoff `KEY_WHEEL_CUTOFF` = 0.8 rad, shadow map | Only `SpotLight` and `DirectionalLight` can shadow, and the spot keeps the lamp's position — it is 5 m in front of the wheel, and a directional would light the far side of the room equally hard. The spot's shadow frustum also concentrates on the wheel: a directional shadow map spans `frustum_height = 35 m` over this 24 m set, 17 mm per texel at 2048, against the spot's 3.6 mm. And `smoothstep(0.75 · cutoff, cutoff, angle)` is the softest edge three-d offers, which is the part of an area light worth keeping. |
| `Beam_L` | SPOT | `SpotLight`, cutoff `cone_outer_half_angle_rad` = 0.19199 rad | Direct match. |
| `Beam_R` | SPOT | `SpotLight`, same cutoff | Direct match. |
| `Rim_L` | AREA, 3 m, 400 W | `DirectionalLight` | 8.3 m from the wheel, so a 3 m source subtends about 20° and its irradiance varies well under a stop across the 5.2 m wheel. Rim light is about direction, not distance. |
| `Rim_R` | AREA, 3 m, 400 W | `DirectionalLight` | Same. |
| `Fill_Front` | AREA, 6 m, 120 W | `DirectionalLight` | The tempting answer is to fold a soft frontal fill into the ambient, and it is wrong: a non-environment `AmbientLight` contributes nothing at all to a metal, and this fill's job includes lifting the polished hub and the chrome pegs off black. |

`direction` passes straight through. `assets/scene.json`'s `direction` is the propagation direction
and three-d's shaders use `-direction` as the vector toward the light, so no sign flip is owed.
Positions and directions still go through `Manifest::to_scene_point` / `to_scene_dir`, which are the
identity today and stay correct if `vectors_in` ever changes.

Blender's spot blend of 0.25 puts the inner cone at `0.75 × outer`, exactly where three-d's
`smoothstep` starts, so the cone softness needs nothing done to it.
`the_beam_cone_softness_matches_three_ds_smoothstep` asserts the manifest still says so.

Known and unresolved: `Rim_L` and `Rim_R` are AREA lamps built as `DirectionalLight`s, which carry a
direction and no position, so `Rim_L`'s blue lands on every surface whose normal faces camera-left
wherever it is in the room. Confining each rim to its own side needs them rebuilt as positional
lights with an attenuation. That is a change to the rig, not to a constant, and this pass did not
make it.

### Attenuation: the three spots fall off, the rest cannot

| Constant | Value | Meaning |
| --- | --- | --- |
| `SPOT_DISTANCE_FALLOFF` | `true` | Whether the three spots fall off past their own reference distance. |

`three-d`'s `attenuate` divides by `max(1.0, c + l·d + q·d²)`, so a quadratic term can only ever
dim. `spot_attenuation` sets `q = 1 / d_ref²` with `d_ref` the same lamp-to-pivot distance the
lamp's conversion constant was derived at, so the divisor is exactly 1 at the wheel and `(d / d_ref)²`
beyond it. The calibration stays exact where it was measured and the falloff is physical everywhere
else. For `Key_Wheel` at `d_ref = 6.685 m`: the wheel takes 1.0, the pillars at 11 m take 1/2.7, the
cyclorama at 17.7 m takes 1/7.0.

Without it the key put the same irradiance on a wall 17.7 m away that it put on the wheel 6.7 m
away, which is what left nothing in the set dark. The two directionals and the ambient cannot fall
off at all — a directional has no position and the ambient is a probe — which is the cost of having
no area light.

## The bulb-ring stand-in — the one lamp set that is not in the .blend

`three-d` gives emissive geometry no ability to light anything. `Wheel_Bulbs` carries
`MAT_Bulb_Glass`, which really is emissive in `wheel_stage.blend`: emission strength **3.0**, colour
`(1, 0.93, 0.74)`, so an effective radiance of `(3.0, 2.79, 2.22)`, all of it recorded in
`assets/scene.json`. In EEVEE those 96 spheres are a real source; here they would be 96 bright dots
that light nothing. So the renderer **stands them in with lamps**, and every place that describes
these lights says so — this section, the `BULB_RING_INTENSITY` doc comment, the `GS_LIGHT_AUDIT`
line, and `assets/scene.json`'s own `lighting_notes`, which sets the rule and requires the
documentation.

The rule is conditional and the code enforces the condition: `bulb_ring_colour` reads
`BULB_RING_MATERIAL` out of the manifest and returns `None` if the material is missing or its
emission strength is zero, and `Rig::build` then builds **no ring at all** and prints a warning. A
lamp standing in for geometry that does not emit would be an invention, not a stand-in.

| Constant | Value | Meaning |
| --- | --- | --- |
| `BULB_RING_MATERIAL` | `"MAT_Bulb_Glass"` | The material stood in for. Its emission colour, normalised to a largest channel of 1.0, is the lamps' colour — read from the manifest, never repeated in Rust. |
| `BULB_RING_INTENSITY` | 0.95 | The **whole ring's** intensity; each lamp gets a `BULB_RING_LAMPS`-th of it. |
| `BULB_RING_LAMPS` | 8 | How many point lights the ring becomes. A ring, not a point: one axial lamp floods the hub and the inner ends of the 48 sectors from 0.35 m, because attenuation cannot dim anything nearer than the reference distance, and a flat frontal white term over a saturated albedo is the definition of pastel. Eight lamps also cost eight light slots in every material shader, which is the reason not to make it 24. |
| `BULB_RING_RADIUS` | 2.454 m | Measured from `Wheel_Bulbs` in the GLB: local radius 2.424 to 2.484, so the channel's centre line. |
| `BULB_RING_FORWARD` | 0.80 m | How far in front of the wheel's pivot the ring sits, along +Z. Further forward than any bulb actually is: at 0.35 m the lamps are nearly in the plane of the sector fan, which lights a wedge's outer end about ten times harder than its inner end. |
| `BULB_RING_ATTENUATION` | `[1.0, 0.0, 0.09]` | Constant, linear, quadratic. The only light in the rig with an attenuation table of its own, and it needs one: the ring is a local source 5 m across in a 24 m room and must fall off before it reaches the cyclorama. It divides by 2.1 at the floor 3.5 m below, 3.7 at the truss ring, 11.9 at the wall. |

Where 0.95 comes from, and what is honest about it: 96 bulbs of area about 0.0113 m² at the .blend's
radiance of 3.0 carry roughly 3.3 W-equivalent, which over the hemisphere they reach is
`3.3 / (π · 3.5²) = 0.086` at the floor. 0.95 is an order over that, and the gap is what the
stand-in costs rather than a free gain: collapsing 96 emitters onto 8 points throws away the
channel's 5 m span, the attenuation dims the result again by 2.1 at that distance, and the bulbs'
own bloom is not in a Lambertian flux derivation. The number is where look-dev left it. This pass
did not move it in either direction.

Two tests: `the_bulb_ring_stands_in_for_emissive_geometry` asserts the manifest really does make
`MAT_Bulb_Glass` emissive, that it is on `Wheel_Bulbs`, and that the lamps' colour is that
material's own emission colour normalised; `the_bulb_ring_falls_off_before_the_wall` and
`the_bulb_ring_is_not_one_lamp_on_the_axis` pin the falloff and the ring's extent.

## The ambient term

`AmbientLight::new_with_environment(context, AMBIENT_INTENSITY, Srgba::WHITE, &cube)`.

The *environment* is not optional. A plain `AmbientLight` computes
`occlusion * ambientColor * mix(surface_color, vec3(0.0), metallic)`, which is exactly zero at
`metallic = 1`, and `MAT_Gold_Trim`, `MAT_Gold_Dark`, `MAT_Metal_Polished`, `MAT_Truss_Metal` and
`MAT_Peg_Metal` are all fully metallic. Without an environment the hub, the rim pegs and the truss
render black except for direct specular. `new_with_environment` takes the other branch of that
shader, which computes an IBL diffuse *and* specular.

The light's colour is `Srgba::WHITE` on purpose: the hue lives in the cube map, so tinting the light
as well would apply it twice.

| Constant | Value | Meaning |
| --- | --- | --- |
| `AMBIENT_INTENSITY` | **0.18** | The one scalar that sets the probe's level. |
| `ENVIRONMENT_FACE_SIZE` | 64 | Texels per cube face. `Environment::new` resamples into a 32-texel irradiance map and a 128-texel prefilter map, so 64 is already more than the consumers can use. |
| `ENVIRONMENT_BAND_TOP` | 0.2445 | Sine of the elevation of the wall's top edge from the wheel centre. |
| `ENVIRONMENT_BAND_BOTTOM` | 0.2322 | Sine of the elevation of its bottom edge. |

Why 0.18 and not 1.0, which is what a probe holding real radiance would want: the band the map is
built from is `MAT_LED_Screen`'s `effective_emission` of `(0.525, 0.45, 0.9)`, the *pre-texture* node
value, and the shader multiplies that emission by `T_LEDWall_Sky`, whose mean is well below 1.0 —
dark cobalt over most of its area, bright only in the cloud tops. The truss, the fascia and the
pillars also occlude part of the wall from most of the room. 0.18 is that estimate, and it is also
the level at which the probe stops filling the set in: an environment term reaches every surface
from every direction at once, so it can raise a form's general level and can never draw a line on
it.

What to check on a crop: gold at roughness 0.22 whose reflection vector points at the band comes out
near `0.18 × 0.9 × 0.7 = 0.11`, a dark warm-violet tint, while gold facing the ceiling void reflects
`0.18 × 0.02 = 0.004` and stays black. Shadowed metal stays dark; it stops being *pure* black.
Raising this washes the metals out flat, which is the failure mode to watch for.
`shadowed_metal_stays_dark` pins both bounds, and it now reads them off the manifest values the
probe is actually built from rather than off numbers written in the test.

### The generated cube map

`environment_cube_map(&Context, &Manifest) -> TextureCubeMap`. There is no HDRI and no network, so
it is generated. Six 64×64 `[f16; 4]` faces, `ClampToEdge`, mip maps on — `prefilter.frag` samples
the source with `textureLod`, and a three-channel float format would silently skip mip generation.

The map is a function of **elevation only**. Every colour is manifest data and every angle is a
measurement:

| Region | Value | Source |
| --- | --- | --- |
| Horizon band | `MAT_LED_Screen`'s `effective_emission` = `(0.525, 0.45, 0.9)` | `assets/scene.json` |
| Above `ENVIRONMENT_BAND_TOP` = 0.2445 | fades to `render.background()` = `(0.01, 0.008, 0.02)` | `assets/scene.json` |
| Below `ENVIRONMENT_BAND_BOTTOM` = 0.2322 | fades to band × `MAT_Floor_Gloss.base_color` = `(0.029, 0.023, 0.068)` | one floor bounce |

The two band edges are the sines of the elevations of the wall's top and bottom edges seen from the
wheel centre: `Wall_Screen` is a cylinder of radius 11.30 m spanning Blender z 0.80 to 6.35
(`docs/scene_audit.md` §1) and `Wheel_Root` is 3.5 m up, so `atan((6.35 − 3.5) / 11.3) = 14.15°`,
`sin = 0.2445`, and `atan((3.5 − 0.8) / 11.3) = 13.43°`, `sin = 0.2322`.

Two tests: `the_cube_faces_agree_on_which_way_is_up` catches a flipped `tc` at a face seam, and
`the_environment_gradient_runs_the_right_way` asserts the band at the horizon, the world background
overhead, something darker underfoot, and monotonicity from horizon to zenith so no bright ring
appears in the void.

## The shadow map

On `Key_Wheel` only. It is the one lamp above and in front of the wheel, and the reference has the
wheel's shadow on the floor behind it.

| Constant | Value | Meaning |
| --- | --- | --- |
| `SHADOW_MAP_SIZE` | 2048 | Texels per side. `generate_shadow_map` allocates a fresh `DepthTexture2D` per call, so this is also the per-refresh allocation. |
| `KEY_WHEEL_CUTOFF` | **0.8 rad** | Half-angle of the lit cone. |
| `SHADOW_REFRESH_INTERVAL` | 0.05 s | 20 Hz throttle in `Rig::update`. The wheel spins at about 0.6 rad/s, so this moves the shadow 1.7° between refreshes. |

`KEY_WHEEL_CUTOFF` is load-bearing twice and both readings pull the same way.

1. **The lit cone.** three-d lights a fragment below `cutoff` and softens it with
   `smoothstep(0.75 · cutoff, cutoff, angle)`, so at 0.8 rad the flat core reaches 0.6 rad, 34° off
   axis. The wheel subtends 21° from this lamp and sits entirely inside the core; the two pillars
   sit at 35°, just past it, and take the soft edge instead of the full beam. At 1.0 rad — which is
   what this document used to claim — the core reached 43° and both pillars were inside it at full
   strength, which is what made them read as pale form-shaded cylinders instead of dark
   silhouettes. `MAT_Pillar_Body`'s albedo is 0.09; nothing but a lamp pointed straight at it can
   make it read mid-grey.
2. **The shadow frustum.** `SpotLight::generate_shadow_map` builds its shadow camera with
   `field_of_view_y = cutoff`, so the **frustum half-angle is `cutoff / 2`**, half the lit cone. At
   0.4 rad that is a 2.85 m radius at the wheel's 6.69 m, which still covers the 2.6 m wheel, and
   5.0 m where the axis meets the floor. This is the floor under the cutoff: tighter clips the
   shadow map, and `is_visible` returns *unshadowed* outside it, so the clip shows as a shadow that
   stops mid-floor rather than as a black edge.

## Debugging

`GS_LIGHT_AUDIT=1` prints one line per light: the Blender type, the three-d type it became, the
watts, the conversion constant, the resulting intensity, and the position and direction actually
used, plus `[shadow]` on the one that casts. The bulb-ring line prints its lamp count, its total and
per-lamp intensity, its centre, radius, attenuation and colour, and names itself a stand-in. Mirrors
`GS_MATERIAL_AUDIT` in `src/scene.rs`.

## Known discrepancy, not resolved here

The manifest gives `Rim_L` at `x = −8` the cool blue `(0.35, 0.55, 1.0)` and `Rim_R` at `x = +8` the
pink `(1.0, 0.3, 0.65)`. A lamp on the left rims the left-facing surfaces, so the scene data puts
**blue on the left and pink on the right**, while `docs/look_target.md` reads the reference the other
way round. This module takes the colours from the manifest verbatim and does not second-guess them.
Changing them means editing `assets/scene.json`, which would mean disagreeing with the .blend; the
cleanup pass's direction is that the .blend wins.

## What is not done

- No light is animated. If the moving heads should sweep, that is new work.
- The cones the reference shows are additive geometry in `src/postfx.rs`, not lights. This module
  builds two beam spots because the .blend has two; it does not try to make ten.
