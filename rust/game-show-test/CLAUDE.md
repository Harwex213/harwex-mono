# game-show-test

A real-time lighting test: the Luxury Casino hall from `lc-game-show/GameShow_v2/Assets/blender/LuxuryCasino_V6.blend`, rendered natively with Bevy 0.20 (wgpu on Metal). The target is the Cycles client renders in `lc-game-show/GameShow_v2/Assets/references/render/luxury-casino/client/`. Those renders come from `modeling-scripts/LuxuryCasino/presentation/render_presentation.py`: Cycles with full GI, lit by `ZZ_PresentationLights` only, framed by `ZZ_PresentationCameras`. Some client renders predate V6. For example, `PC_05_Table` has moved since.

## Run

```sh
cargo run --release                                   # window: keys 1-8 = presentation cameras, free fly camera
cargo run --release -- --shot out.png --camera PC_03_Chandelier --size 1920x1080 --frames 300
```

`--shot` renders headless, writes the PNG and logs the average frame time. Check visuals with `--shot`. Do not open the window from an agent.

To find light that pops in while the camera moves, add a path:

```sh
cargo run --release -- --shot out.png --camera PC_02_AisleEye --size 1280x720 --path 0,0,-90 --steps 90 [--every 4]
```

After `--frames`, the camera moves by the world offset `dx,dy,dz` a little every frame. It writes `out_000.png` to `out_090.png`, one PNG every `--every` frames. Diff consecutive PNGs to find a jump. A big jump is often the camera passing through a mesh, so look at the frames before blaming the lighting.

Frame times share the GPU with whatever else runs. An open Unreal Editor, Blender viewport, Chrome tab or VM skews them, so re-run an outlier before trusting it. At 1920x1080 on an M4 Max, a frame takes 4–7 ms on a quiet machine and 5.5–7.7 ms with a busy VM and Chrome beside it.

What a frame spends at 1920x1080 on PC_02_AisleEye (measured by switching each part off, with a VM running): SSR 1.7 ms, the probes 1.9 ms, the 230 live lights 1.6 ms, bloom 1.5 ms, SSAO 0.6 ms, TAA 0.6 ms, the normal maps 0.3 ms. None of them has a cheap cut that keeps the look.

## Pipeline

Blender provides geometry and materials only. Everything else comes from this project.

```sh
B=/Applications/Blender.app/Contents/MacOS/Blender
BLEND=~/Projects/lc-game-show/GameShow_v2/Assets/blender/LuxuryCasino_V6.blend
$B -b $BLEND --python tools/export_blend.py -- assets   # casino.glb, materials.json, textures/ (~25 s)
cargo run --release --bin bake                          # hall/, probes/ (~9 min)
```

| Step | Input | Output | Time |
|---|---|---|---|
| `tools/export_blend.py` | the .blend | `assets/casino.glb`, `assets/materials.json`, `assets/textures/` | 25 s |
| bake `hall` | `casino.glb` | `assets/hall/hall.bin` | 15 s |
| bake `lightmap` | `hall.bin`, materials, `scene/lighting.json` | `assets/hall/lightmap.rgb9e5` | 275 s at 1024 spp |
| bake `probes` | the above and the lightmap | `assets/probes/` | 250 s at 512 spp |

`--steps hall,lightmap,probes` runs a subset. Each step reads the output of the steps before it. Other flags: `--density 12 --pages 2` (lightmap texels per metre, 4096² pages), `--samples 1024 --bounces 4 --filter 4 --clamp 6 --fixup` (lightmap), `--probe-samples 512 --probe-size 512 --probe-bounces 4` (probes).

Source of truth:
- `scene/lighting.json` is hand-edited and under version control. It holds the world color and haze, the 8 presentation cameras, the 8 probe boxes and the 329 lights. It was converted once from the old Blender export. Blender no longer exports lights or cameras. Coordinates are Bevy's (Y-up, metres). Power, colors and emission use Blender's units.
- A light color in `lighting.json` includes Blender's color temperature. 290 of the 329 Blender lights use one (2300–9000 K). Blender multiplies the light color by the blackbody color, scaled to a luminance of 1. A 2300 K candle is (2.224, 0.728, 0.089). The first conversion dropped the temperature and left the lights white. Luminance stayed the same, but red carpet, gold and marble came out too dark and too cold.
- Everything in `assets/` is generated. Do not edit it by hand. The PNG, GLB, `.bin`, `.rgb9e5` and `.rgba16f` files are stored in Git LFS.

`export_blend.py` evaluates each Blender node graph per texel into plain PBR maps. Graph inputs driven by object-space procedural noise become their average. Blender's glTF exporter cannot compute tangents for some n-gon meshes. The hall step fills them in with Bevy's MikkTSpace.

Normal maps are 16-bit PNGs. The marble's normal map has a strength of 0.25. In 8 bits, its X held only 4 values, and the steps sparkled in the highlights of the glossy floor. The crystal carries `bake_transmission`: the baker refracts through it like Cycles, and the app keeps it opaque.

The hall step:
- moves every glTF primitive into world space;
- unwraps lightmap UVs with xatlas (`xatlas-rs-v2`). Every object instance gets its own charts;
- packs the charts into at most 2 pages of 4096², side by side in one 8192x4096 lightmap. The density starts at 12 texels per metre and drops until the charts fit;
- merges all primitives of one material into one mesh: 28 meshes, 1.3 M vertices, 0.97 M triangles.

How the lightmap and probe bakes work: [docs/baker.md](docs/baker.md).

## The app

The hall is 28 meshes with one lightmap image. Diffuse light comes from the lightmap. The live lights are the point lights of `lighting.json` with `glossy: true` (230). They add highlights only (`affects_lightmapped_mesh_diffuse = false`) and have no shadow maps. The reflection probes add reflections only. There is no volumetric haze and no shader patch.

Normal maps load as Rg16Unorm (Bevy rebuilds Z), with mipmaps built on the CPU. A normal map mip holds the renormalized average normal, so the bumps inside it vanish. The roughness mips take them up instead (Toksvig, in the vMF form of Neubelt and Pettineo): see `materials.rs`.

Debug switches (environment variables):

| Variable | Effect |
|---|---|
| `ONLY_LIGHTS=PL_Chand` | Keeps only the live lights whose names start with these prefixes. |
| `SKIP_LIGHTS=PL_Moon` | Drops the live lights whose names start with these prefixes. |
| `NO_SSR`, `NO_SSAO`, `NO_TAA`, `NO_BLOOM`, `NO_PROBES` | Turns that effect off. |
| `NO_NORMAL_MAPS` | Leaves the tangents out, so Bevy skips the normal maps. |
| `NO_TOKSVIG` | Keeps the roughness mips as they are. |
| `PROBES=dir` | Loads the probes of another bake, to compare two bakes. |
| `FORWARD` | Renders forward instead of deferred. |
| `MIN_LUX=20` | Shortens light ranges (cheaper, darker). |
| `MIRROR_MATERIAL=BLK_BlackMarble` | Turns that material into chrome, to check what probes and SSR reflect. |
| `HIDE_MATERIAL=BLK_Gold` | Hides the mesh of that material. |
| `GPU_PROFILE=1` | Logs per-pass render timings. Metal reports CPU time only. |
| `SMALL_CLUSTERS=1` | Keeps Bevy's small GPU cluster lists, to reproduce the light pop below. |

## Bevy traps

- **Deferred lightmap batching.** Bevy 0.20's deferred prepass batch key (`OpaqueNoLightmap3dBatchSetKey`, `bevy_pbr` `prepass/mod.rs`) ignores `lightmap_slab`. Meshes with different lightmap images get batched together and read the wrong image. The gallery floor showed a mosaic of foreign islands. The whole hall therefore uses one lightmap image.
- **Draw calls.** 4500 small draws in three passes cost Metal about 25 ms whatever the resolution. The hall step merges the static meshes per material.
- **Light clusters.** Bevy's GPU light clustering starts with a Z-slice list of 1024 entries and an index list of 65536 entries. The 230 glossy lights need up to 4096 and 262144 (PC_08_Gallery at 1080p). An overflowing frame drops lights from many clusters, and a Z-slice overflow can black out whole screen tiles. The GPU readback grows the lists several frames later, and the lost highlights come back at once. It looked like light being added while flying. Bevy logs "Resizing the view clustering ..." when it happens. `grow_cluster_lists` in `main.rs` starts both lists 4 times larger (about 4 MB). Raise the sizes when the light count grows.
- **Probe filtering.** `GeneratedEnvironmentMapLight` re-filters its cubemap every frame. `probes::freeze` removes the generator after the first frames.
- **Emission exposure.** Emission needs `emissive_exposure_weight = 1`. With Bevy's default of 0, emission ignores the camera exposure and comes out 683 times too bright.
- **Tangents.** A mesh without tangents silently disables normal maps. The old Blender-merged hall had none, so its normal maps never showed.
- **Deferred and emissive textures.** Opaque materials render deferred, which SSR needs. Materials with an emissive texture render forward, because the G-buffer drops that texture.
- **Crystal.** Bevy's screen-space transmission makes the thin strands vanish, so the crystal is an opaque glossy emitter.
- **Bevy probes.** Bevy blends at most 8 reflection probes per view. The floor tier of boxes covers only the nave, because the side aisles under the gallery must stay dark.

## How the Cycles look is matched

- **Units.** One Blender watt is 683 lm, and an emission strength of 1 is 683 nits (see `units.rs`). The lightmap and the probes hold Blender radiance, so `lightmap_exposure` and the probe intensity are 683.
- **Color temperature.** The light colors include it (see Pipeline).
- **Glossy visibility.** Most Blender lights here have `visible_glossy = False`. Cycles then drops their highlights. The app keeps only the glossy lights live, and the probe bake gives only them highlights.
- **Spread.** Cycles squeezes the power of a narrow area light `spread` into its cone. On-axis gain against a plain Lambertian panel, measured in Cycles with a 1 m panel 2 m above a plane:

  | spread (rad) | 0.52 | 0.61 | 1.05 | 1.22 | 1.57 | 2.09 | 2.50 | π |
  |---|---|---|---|---|---|---|---|---|
  | gain | 13.19 | 12.52 | 7.04 | 5.62 | 3.72 | 2.23 | 1.59 | 1.0 |

  The baker follows Cycles' softbox profile and matches this table within 3 %.

## Known gaps

- The app has no volumetric haze and no dynamic shadows. A moving object would need shadowed live lights.
- Glossy-invisible lights lose their broad highlights on rough metal. Only the probes reflect them.
- The probes come out 1–17 % darker than the old Cycles probes (per probe). Whole frames come out 1–5 % darker than with the Cycles probes; PC_02_AisleEye loses the most. Most of the rest are the 30 glass lanterns on the lamp posts and their images in the marble floor. Cycles shows their light sphere twice as bright as the same light alone, and keeps half of it under the indirect clamp. A synthetic slab test in Cycles shows neither effect. The cause is unknown; see [docs/baker.md](docs/baker.md).
- The gold coffers of PC_03_Chandelier are less orange than in the Cycles reference. This does not come from the probes: the frame looks the same with the Cycles probes.
- The marble floor reflects less crisply than in Cycles.
- The carpet (sheen 0.3) and the red velvet (sheen 1.0) have a Cycles sheen layer. Neither the lightmap nor the app has one. A Cycles test of a sheen of roughness 0.5 under a white sky reflects 2 % head-on and 15 % at 60°.
- The lamp shade panels behind the bar are 12 % darker than in the Cycles bake.
- `docs/compare-rt-lightmaps.png` shows the Cycles reference (left) and the app (right) on PC_01_Hero.
