# The GPU baker

`src/bin/bake.rs` with the modules in `src/bin/bake/` bakes the lightmap and the reflection probes on the GPU with wgpu ray queries (`EXPERIMENTAL_RAY_QUERY`, Metal). It runs headless, without a Bevy app. It reads `assets/hall/hall.bin`, `assets/materials.json`, `assets/textures/` and `scene/lighting.json`.

Baker-only switches: `NO_NORMAL_MAPS=1` bakes without normal maps. `ONLY_LIGHTS=PL_Vault,EM_` keeps the lights with these name prefixes. The emissive triangles stay only with `EM_` in the list. `BACKGROUND=1` lets the world color light the lightmap. `NO_HAZE=1` bakes the probes without haze.

Switches for probe experiments: `PROBE_OUT=dir` writes the cubemaps to another directory. `ONLY_PROBES=0,3` bakes these probes only. `PROBE_CENTER=x,y,z` moves the capture point. `HIDE_MATERIAL=BLK_Glass` lets every ray pass through that material. The app loads another bake with `PROBES=dir`.

## Shared parts

- `geometry.rs` turns `hall.bin` into GPU buffers. Each merged mesh gets one BLAS. One TLAS holds them with identity transforms. The instance custom index is the mesh index.
- `materials.rs` reduces each material to 512² layers of one texture array:
  - albedo: base color × (1 − metallic) × (1 − transmission). The scene renders with reflective and refractive caustics off, so a path after the baked surface only scatters diffusely. Metal and glass therefore act as black diffuse surfaces.
  - emission;
  - specular: F0 and roughness, for the probes.

  The probes also read the glass weight, the IOR, the tint and the clear coat. A glass reflects with the F0 of its IOR, scaled by Blender's Specular IOR Level. The crystal is glass in the bake only (`bake_transmission` in `materials.json`).

  The normal maps keep their full 2048² size in a second texture array. The plants keep their alpha: their BLAS is not opaque, and the shader tests the alpha of every candidate hit.
- `lights.rs` builds the light sources and a light tree. The sources are the 329 lights and the 97 K emissive triangles. The tree follows PBRT-v4's light BVH: bounds, an orientation cone and a power per node. The shader picks one source per sample with one random choice per level. PBRT floors the distance at half the box diagonal. That starved a large emitter next to the point, so the importance also uses the distance to the box with a smaller floor.

## Lightmap

- `raster.rs` rasterizes the triangles of one 4096² page through the lightmap UVs. A texel belongs to the triangle that holds its center. An edge texel without such a triangle belongs to the nearest triangle that touches it. Each texel keeps its triangle, the barycentric coordinates and their change per texel.
- `trace.wgsl` (`trace_texels`) path-traces each texel: one light sample with a shadow ray, then up to 4 cosine-weighted diffuse bounces with a light sample at each hit. Each sample starts at a random point of the texel's square. The point folds back into the triangle at its edges, like Cycles' `bake_clamp_mirror_repeat`. Emission counts only through light sampling, so a bounce ray that hits an emitter adds nothing. Each dispatch adds a few samples. The batch size adapts to about a quarter second, because Metal kills long command buffers.
- `filter.wgsl` divides by the sample count and runs 4 passes of an edge-aware à-trous filter. The weights use the position plane, the normal and the luminance noise (SVGF). `post.rs` dilates 4 texels into the gutter and encodes Rgb9e5.

A page has about 12.6 M (page 0) and 7.9 M (page 1) texels. 1024 samples take about 130 s per page.

## Probes

`trace_probe` renders one cubemap per probe box, from the box center, in Bevy's layout: faces +X −X +Y −Y +Z −Z, v down each face, z negated at lookup. A texel holds the radiance that reaches the center from its direction. A path follows the specular lobes for up to `--probe-bounces` (4) scattering events. Every surface it hits adds:
- its emission;
- its diffuse color × the baked lightmap;
- the highlight of one light, picked by a light sample;
- the light along one lobe sample: a GGX reflection off the base layer or the clear coat, or a GGX refraction through glass.

The light sample and the lobe sample share the lights by multiple importance sampling (balance heuristic). One pass over the lights picks the light in proportion to intensity / distance² × the GGX density of its half vector × the cosine. The lobe is widened by the light's angular radius, so every light that can contribute gets a positive weight. The same pass finds the light sphere that the lobe sample's ray meets before the next surface, and its MIS weight.

Light visibility follows Blender's ray visibility: the camera ray sees no light (`visible_camera` off everywhere). A reflection sees the lights with `glossy: true`. A refraction sees every light (`visible_transmission` on everywhere).

The last vertex reflects the lightmap with its diffuse color plus its F0 instead of tracing on. That is exact in an even light field. A glass at the last vertex keeps only its reflection: its lightmap holds the lamp right behind it, and the glass would show as a lit white wall.

The world haze (Blender's principled volume: scattering = color × density, extinction = density, Henyey-Greenstein anisotropy) dims every segment. `trace_haze` renders the glow at an eighth of the resolution and adds it bilinearly:
- Single scattering of the analytic lights. One light per sample, by weighted reservoir sampling over all lights, in proportion to power × ∫ 1 / distance² along the ray. A point light then takes equiangular distance sampling (Kulla and Fajardo 2012). A panel takes a uniform distance and its radiance × solid angle.
- The haze lit by the surfaces, like Cycles' volume bounce: a uniform distance, a direction from the phase function, and the emission and lightmapped light of the surface there. This covers the emissive meshes and the light that the walls send back.
- One GGX reflection off the first surface, with the single scattering along it.

The world volume fills all space, so a ray that leaves the hall never reaches the background.

Clamps follow Cycles: emission and lights reached by the camera ray or by the first scattered ray, and the light sample at the first vertex, are not clamped. Everything else is clamped to `--clamp` by the sum of its channels. The clamp makes the estimator matter. A light seen through glass only by lobe hits comes in rare large values, and the clamp cuts most of it. Many small light samples keep more of it, as in Cycles. That is why the light sample covers refractions too.

## Units, as Cycles has them

- A lightmap texel holds irradiance / π in Blender units, which is the Cycles DIFFUSE pass without color. A probe texel holds radiance.
- A point light of P watts has an intensity of P / 4π W/sr. It is a sphere with the light's radius and a radiance of P / (4π × πr²). A Cycles render of a 4 W, 2 cm light shows 253, as this formula gives.
- A point inside a light sphere takes the light of the whole sphere around it, as in Cycles: a cosine-weighted direction to the sphere's surface. The candle flames sit inside their lights. A shadow ray to the light's center would hit the flame itself.
- The light colors include Blender's color temperature (see CLAUDE.md).
- An area light of P watts and area A has a radiance of P / (π A).
- An emission strength of S is a radiance of S. Mesh emission leaves both faces.
- Large or close emissive triangles are sampled by solid angle, as in Cycles. Their uniform area samples carried huge values, and the indirect clamp cut most of that light.
- The indirect clamp works like Cycles' `sample_clamp_indirect = 6`. It acts on each indirect contribution times the color of the baked surface, by the sum of the channels.
- A `spread` below π follows Cycles' softbox profile: radiance ∝ max(tan(spread/2) − tan θ, 0) / (tan(spread/2) − spread/2).

## Normal maps, as Cycles applies them

- Cycles bakes with the normal-mapped normal. A Cycles test bake of one coffer without its normal map came out 11 % brighter.
- The shader samples the tangent-space map at the sample point. The tangent follows material U, and the bitangent follows Blender's V, which is −V in glTF.
- Cycles' bump map correction (`ensure_valid_specular_reflection`) tilts the normal by at most about 45° in a bake.
- Cycles' `bump_shadowing_term` fades the light that reaches a bumped normal at a flatter angle than the true surface.
- Bevy reads the lightmap without the normal, so the normal map counts once.

## Traps

- WGSL reserves `target`. Naga rejects a variable with that name.
- The random numbers must step a PCG state. Feeding the PCG hash its own output falls into short cycles. The probe haze draws hundreds of numbers per sample, and the repeats showed up as speckles.
- The à-trous luminance weight must use the larger noise of the two texels. With the center texel's noise alone, dark texels reject bright noisy neighbours, and the filter lost 60 % of the light at 16 samples.
- `--fixup` moves texels out of solids with short back-face rays along the surface. It stays off. Every mesh here is double-sided, so pleated drapes and folded trim show back faces too. Their texels jumped to the lit side and glowed pink. Cycles does no such move.
- A haze light picked by the light tree at the ray origin, or a uniform haze distance, left the probes full of speckles near the chandelier candles and in the moon beams.
- A second `[[bin]]` makes `cargo run` ambiguous. `default-run` in Cargo.toml keeps the app the default.
- Compare the probes with Cycles by rendering one cube face in Cycles: a 90° camera at the probe center, with the settings of the old `bake_probes.py` (512 samples, clamp 6, glossy bounces 6, transmission bounces 12). Set the camera with `to_track_quat('-Z', 'Y')`. With 'Z' as the up axis the roll is arbitrary. Switch single lights or materials in the scene to split a difference. One face of probe 0 matched the old Cycles probe within 4 %.

## Agreement with Cycles

Measured at 1024 samples against the Cycles lightmap bake, before the Cycles bake was removed (luminance means over texels that both bakes cover):
- Atlas 0: 1.00 in all. The lamp shade panels behind the bar are 12 % darker.
- Atlas 1: 1.11 in all. The coffered ceiling is 1.30, and dark wood is 0.83.
- The two numbers mislead. In app shots, the ceiling rows of PC_03_Chandelier differ by 3 % in linear light, and the whole frames by less than 1 %.
- Coffer texels with metallic below 0.1 agree within 9–11 %. Cycles writes darker values on gold texels near island borders, and Cycles is not additive: all lights together gave 4–11 % less than the sum of separate bakes of the light groups.
- Dark wood center texels agree within 2 %. The trim is thinner than a texel, so most wood texels are edge texels, which Cycles never bakes.

With the Cycles probes kept, the new single-lightmap hall matched the old two-atlas hall within 2 % on 6 of the 8 cameras. PC_04_ColumnBalcony came out 9 % brighter (its drape valance was dark in the old lightmap), and PC_03_Chandelier 4 % darker.

## Agreement of the probes with Cycles

The old Cycles probes came from `bake_probes.py` (equirectangular Cycles panoramas, 128 samples, OIDN). Per probe, the Rust probes reach 0.83–0.99 of their mean luminance; the red/green ratio is 2.37 against 2.49. Before the fixes below they reached 0.75–0.90:
- The light colors had lost Blender's color temperature.
- The probes only followed one GGX reflection, never saw lights through glass, and treated the crystal as opaque.
- The lightmap left the candle flames dark, because their shadow rays to the light's center hit the flame.

The rest sits mostly in the 30 glass lanterns of the lamp posts. In a Cycles face render of one lantern (`PROBE_CENTER=-3.3,2.1,11.0`, face −X), the light sphere seen through the glass shows 481 instead of 253, and the clamp keeps half of it (251). The same light alone, or behind a glass slab in a new Cycles scene, shows 253 and is clamped away. The lantern without its candle material changes nothing. The Rust probe shows 243 and clamps it like the slab. The cause is still open.
