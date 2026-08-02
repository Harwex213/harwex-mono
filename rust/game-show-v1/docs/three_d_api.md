PINNED: three-d = "0.19.0", three-d-asset = "0.10.0", features = ["three-d/window", "three-d-asset/gltf", "three-d-asset/png"]

# three-d API notes for wheel_stage

Agent A. Every claim below was read out of the published source of `three-d` 0.19.0 and
`three-d-asset` 0.10.0, unpacked from the crates.io tarballs
(`https://static.crates.io/crates/three-d/three-d-0.19.0.crate` and
`.../three-d-asset-0.10.0.crate`). Where a line number is quoted it is a line in that
tarball.

**Nothing here has been compiled.** No Rust toolchain was installed at the time this was
written (`cargo` was not on `PATH`). Every snippet was written against the real type
signatures, but the first agent to run `cargo check` should expect to fix small things.
"Gaps I am admitting to" at the end lists what I could not settle from source alone; read
it before you trust section 7.

## 1. Versions and features

### Cargo.toml for agent F

```toml
[dependencies]
three-d = "0.19.0"                # default features = ["window"], which is what we want
three-d-asset = { version = "0.10.0", features = ["gltf", "png"] }
```

Facts behind that:

| Crate | Latest published | Published on |
| --- | --- | --- |
| `three-d` | 0.19.0 | 2026-04-17 |
| `three-d-asset` | 0.10.0 | 2026-04-17 |

- `three-d` 0.19.0 features are exactly `default`, `window`, `egui-gui`, `text`.
  `default = ["window"]`. `window` pulls in `glutin 0.30`, `winit 0.28` and
  `raw-window-handle 0.5`. We need `window` (see section 7), so plain
  `three-d = "0.19.0"` is correct. Do not add `default-features = false`.
- `three-d` 0.19.0 depends on `three-d-asset = "0.10"` and re-exports its types. Our
  direct dependency **must** be `0.10.x` or the types will not unify.
- GLB/glTF loading is a `three-d-asset` feature, not a `three-d` feature: `gltf =
  ["dep:gltf"]`. `three-d` itself never enables it, so we must.
- PNG output is also a `three-d-asset` feature: `png = ["image/png"]`. That is what makes
  `three_d_asset::io::save` able to write `.png`.
- `three-d` has an undocumented implicit `image` feature (from an optional `image 0.25`
  dependency). It is used for exactly one thing: a compile-time screenshot hack keyed on
  the `THREE_D_EXIT` / `THREE_D_SCREENSHOT` env vars, read with `option_env!`
  (`src/window/winit_window/frame_input_generator.rs:88-110`). Compile-time env vars are
  useless for our `--shot` flag. **Do not enable `three-d/image`.**
- The `gltf` crate is built by `three-d-asset` with these extensions on:
  `KHR_lights_punctual`, `KHR_materials_pbrSpecularGlossiness`, `KHR_materials_unlit`,
  `KHR_texture_transform`, `KHR_materials_variants`, `KHR_materials_volume`,
  `KHR_materials_specular`, `KHR_materials_transmission`, `KHR_materials_ior`,
  `KHR_materials_emissive_strength`. Read section 2 before you trust that list.
- `three-d` 0.19.0 has **no `headless` feature**. 0.18.2 had one. See section 7.

### Namespace note

`three_d` re-exports `three_d::core::*` and the whole `three_d_asset::prelude`, so
`use three_d::*;` gives you `Mat4`, `Vec3`, `vec3`, `Srgba`, `degrees`, `radians`,
`SquareMatrix`, `Viewport`, `RenderTarget`, `ClearState`, `Interpolation`, `Wrapping`,
`Mipmap` and the rest.

Watch the two `Texture2D`s. `three_d::Texture2D` is the GPU texture.
`three_d_asset::Texture2D` is the CPU-side image, and `three-d` re-exports it under the
alias `CpuTexture`. Same for `three_d_asset::TriMesh` = `three_d::CpuMesh`,
`three_d_asset::Model` = `three_d::CpuModel`, `three_d_asset::PbrMaterial` =
`three_d::CpuMaterial`.

## 2. Loading the .glb

`three-d-asset` parses the GLB into a `Scene` tree, or into a flat `Model`. `three-d`
turns a `Model` into GPU objects.

```rust
use three_d::*;

let cpu_model: CpuModel = three_d_asset::io::load_and_deserialize("assets/wheel_stage.glb")?;
let model = Model::<PhysicalMaterial>::new(&context, &cpu_model)?;
// `model` derefs to Vec<ModelPart<PhysicalMaterial>>; `&model` is IntoIterator<Item = &dyn Object>.
```

`load_and_deserialize` is `#[cfg(not(target_arch = "wasm32"))]` and returns
`three_d_asset::Result<T>`. It resolves the GLB's external dependencies (buffers,
textures) relative to the GLB path, so a self-contained `.glb` needs no extra files.

### Materials do come across

`three_d_asset::io::gltf::parse_material` reads, for every glTF material:
`base_color_factor` -> `albedo`, `metallic_factor`, `roughness_factor`, the base-colour /
metallic-roughness / normal / occlusion / emissive textures, `emissive_factor` ->
`emissive`, `transmission_factor`, `ior` -> `index_of_refraction`, `alpha_cutoff`. It hard-codes
`lighting_model: LightingModel::Cook(TrowbridgeReitzGGX, SmithSchlickGGX)`, which is the
best model three-d has. Material **names** survive (`material.name()`).

`Model::<PhysicalMaterial>::new` calls `PhysicalMaterial::from_cpu_material`, which calls
`PhysicalMaterial::new`, which guesses opacity from the alpha channel
(`is_transparent(cpu_material)` at `src/renderer/material.rs`: true when
`albedo.a != 255`, or when the albedo texture has any non-255 alpha). For
`MAT_Crystal` (alpha 0.55) that guess is right. See section 5 for what it sets.

**Not carried across:** `KHR_materials_emissive_strength`. The feature flag is on in the
`gltf` dependency, but `parse_material` never calls `emissive_strength_factor()`; I
grepped the whole of `three-d-asset/src` for `emissive_strength` and got zero hits. Our
emission strengths of 1.2, 1.5, 3.0 and 6.0 are lost at import. Section 5 says what to
do instead.

### KHR_lights_punctual lights do NOT survive. Cameras do NOT survive.

This is the load-bearing finding of this section. `deserialize_gltf`
(`three-d-asset-0.10.0/src/io/gltf.rs:33-178`) walks `document.materials()`,
`document.nodes()`, `document.animations()` and `document.scenes()`. It never calls
`node.light()`, `document.lights()` or `node.camera()`. I grepped the file for
`light`, `camera` and `punctual`: the only hit is the string `LightingModel` on line 323.

So `assets/scene.json` is not a convenience, it is mandatory. The camera comes from the
manifest (agent G) and the lights come from the manifest (agent H). Nothing is read out
of the GLB for either.

### Object names do NOT survive into `CpuModel` — read this before writing scene.rs

`Node::default().name` is the literal string `"node"`
(`three-d-asset-0.10.0/src/lib.rs`). Now follow the import:

1. `deserialize_gltf` builds one `Node` per glTF node. It sets `name` from
   `gltf_node.name()`, which is the Blender object name. It sets
   `children = parse_model(&mesh, &buffers)` when the node has a mesh. **It never sets
   `geometry` on that node.**
2. `parse_model` builds one `Node` per glTF *primitive*, with
   `Node { geometry: Some(...), material_index: ..., ..Default::default() }`. The `..Default::default()`
   means every one of those nodes is named `"node"`.
3. `From<Scene> for Model` walks the tree with `visit`, and pushes a `Primitive` only
   `if let Some(geometry) = node.geometry`.

Result: every `Primitive` in a `CpuModel` loaded from glTF is named `"node"`. The Blender
object names are still in the tree, one level above the geometry, but `CpuModel` throws
them away. `three_d::Model::new` then throws away even `Primitive::name` — `Mesh` has no
name field at all.

Nobody can find `Wall_Screen`, `Wheel_Rim` or `Pointer_Flapper` through `CpuModel`. Load
a `Scene` and walk it yourself, keeping the nearest named ancestor:

```rust
use three_d::*;
use three_d_asset::{Geometry as CpuGeometry, Node, Scene as CpuScene};

/// One drawable piece of the imported scene, tagged with its Blender object name.
pub struct NamedPart {
    pub name: String,
    /// World transform, already accumulated down the tree.
    pub transformation: Mat4,
    /// Index into `CpuScene::materials`.
    pub material_index: Option<usize>,
    pub mesh: CpuMesh,
}

fn walk(node: &Node, parent: Mat4, inherited: &str, out: &mut Vec<NamedPart>) {
    let world = parent * node.transformation;
    // three-d-asset names every primitive node "node", so keep the nearest named ancestor.
    let name = if node.name == "node" { inherited } else { node.name.as_str() };
    if let Some(CpuGeometry::Triangles(mesh)) = &node.geometry {
        out.push(NamedPart {
            name: name.to_string(),
            transformation: world,
            material_index: node.material_index,
            mesh: mesh.clone(),
        });
    }
    for child in &node.children {
        walk(child, world, name, out);
    }
}

pub fn named_parts(scene: &CpuScene) -> Vec<NamedPart> {
    let mut out = Vec::new();
    for child in &scene.children {
        walk(child, Mat4::identity(), &scene.name, &mut out);
    }
    out
}

// Then build each object yourself, keeping the name alongside:
let cpu_scene: CpuScene = three_d_asset::io::load_and_deserialize("assets/wheel_stage.glb")?;
let materials: Vec<PhysicalMaterial> = cpu_scene
    .materials
    .iter()
    .map(|m| PhysicalMaterial::new(&context, m))
    .collect();
let mut objects: Vec<(String, Gm<Mesh, PhysicalMaterial>)> = Vec::new();
for part in named_parts(&cpu_scene) {
    let material = part
        .material_index
        .and_then(|i| materials.get(i).cloned())
        .unwrap_or_default();
    let mut gm = Gm::new(Mesh::new(&context, &part.mesh), material);
    gm.set_transformation(part.transformation);
    objects.push((part.name, gm));
}
```

`Gm<Mesh, M>` derefs to `Mesh`, so `gm.set_transformation(m)` reaches
`Mesh::set_transformation`. A Blender object with several materials produces several
`NamedPart`s that share one name; that is correct and expected.

If the Blender exporter is told to keep the hierarchy, `Wheel_Root`'s children arrive as
children in the tree, so `walk` accumulates their world transforms for you. Agent K
needs the *local* transform under `Wheel_Root` to spin the wheel; either walk the tree a
second time and record the pivot's inverse, or record the pivot transform in
`assets/scene.json`. That is agent D's and agent K's call, not mine.

### Colour space trap in the material mapping

`PhysicalMaterial::albedo` is `Srgba`, four `u8`s, holding **sRGB-encoded** values.
`use_uniforms` sends `self.albedo.to_linear_srgb()`, which applies the sRGB decode curve.

The base colours in `agent_plan.md` are **linear** RGB. Feeding a linear value straight
into `Srgba::new((0.72 * 255.0) as u8, ..)` decodes it a second time and comes out far too
dark. Encode first:

```rust
/// Linear sRGB in [0,1] to an `Srgba` that decodes back to the same linear value.
fn linear_to_srgba(rgb: [f32; 3], alpha: f32) -> Srgba {
    let enc = |c: f32| {
        let s = if c <= 0.003_130_8 {
            12.92 * c
        } else {
            1.055 * c.powf(1.0 / 2.4) - 0.055
        };
        (s.clamp(0.0, 1.0) * 255.0).round() as u8
    };
    Srgba::new(enc(rgb[0]), enc(rgb[1]), enc(rgb[2]), (alpha.clamp(0.0, 1.0) * 255.0).round() as u8)
}
```

Check against these three, which I computed with the same formula:

| Material | linear | `Srgba` bytes |
| --- | --- | --- |
| `MAT_Floor_Gloss` | `(0.055, 0.05, 0.075)` | `(66, 63, 77)` |
| `MAT_Gold_Trim` | `(0.72, 0.52, 0.18)` | `(221, 191, 118)` |
| `MAT_Sector_Pink` | `(0.92, 0.05, 0.42)` | `(246, 63, 173)` |

The same trap applies to the Blender **light** colours, which are also linear
(`SpotLight::use_uniforms` sends `self.color.to_linear_srgb().truncate() * self.intensity`).

The `u8` quantisation costs real precision on the dark materials — `MAT_Rubber_Black`
`(0.03, 0.03, 0.03)` lands on 50/255. There is no float albedo in `PhysicalMaterial`.
The section-5 wrapper trick can override the `albedo` uniform the same way it overrides
`emissive`, if look-dev decides the banding shows.

## 3. Perspective camera from position, target, up and vertical FOV

```rust
use three_d::*;

// Cam_Hero in Blender's own Z-up frame. See "Up axis" below before using these numbers.
let position = vec3(0.0, -6.4, 1.0);
let forward = vec3(0.0, 0.961_28, 0.275_59);
let up = vec3(0.0, -0.275_59, 0.961_28);

let camera = Camera::new_perspective(
    Viewport::new_at_origo(1672, 941),
    position,
    position + forward,        // the API wants a target point, not a direction
    up,
    radians(0.863_056_4_f32),  // vertical field of view, derived below
    0.05,                      // z_near, from the Blender clip start
    200.0,                     // z_far, from the Blender clip end
);
```

Signature (`three-d-0.19.0/src/renderer/viewer/camera.rs:74`):

```rust
pub fn new_perspective(
    viewport: Viewport,
    position: Vec3,
    target: Vec3,
    up: Vec3,
    field_of_view_y: impl Into<Radians>,
    z_near: f32,
    z_far: f32,
) -> Self
```

`Radians` is `cgmath::Rad<f32>`; `Degrees` is `cgmath::Deg<f32>`. Both `radians(x)` and
`degrees(x)` are `const fn` in the prelude and both satisfy `Into<Radians>`.

`Viewport { x: i32, y: i32, width: u32, height: u32 }`. `y` counts up from the **bottom**
edge. `Viewport::aspect()` is `width / height`.

`up` does not have to be orthogonal to the view direction; `set_view` orthogonalises it.
`Camera::up()` returns what you passed in, `Camera::up_orthogonal()` returns the
orthogonalised one.

### The vertical FOV for Cam_Hero

Blender's sensor fit `AUTO` applies `sensor_width` to the **larger** image dimension.
1672 > 941, so 36 mm is the horizontal extent.

```
aspect = 1672 / 941            = 1.7768331562
hfov   = 2 * atan(36 / (2*22)) = 1.3714590218 rad = 78.5788 deg
vfov   = 2 * atan(tan(hfov/2) / aspect)
       = 2 * atan(0.8181818182 / 1.7768331562)
       = 0.8630563850 rad      = 49.4495 deg
```

Use `0.863_056_4` radians. Do not hard-code degrees; the viewport aspect must match
1672/941 or the projection changes.

`Camera::set_viewport(viewport) -> bool` re-derives the projection from the stored
`field_of_view_y` whenever the viewport changes, and returns whether it changed. Call it
every frame in the interactive viewer. It preserves the vertical FOV, so the horizontal
FOV follows the window. That matches Blender's `AUTO` fit only at the reference aspect.

### Up axis

three-d has no up-axis convention of its own. `Camera::new_perspective` takes `up`
explicitly, so a Z-up scene works with `up = vec3(0.0, 0.0, 1.0)`. Nothing else in
three-d assumes Y is up either — I checked `compute_up_direction` in
`src/renderer/light.rs`, which picks a perpendicular from the light direction alone.

The Blender glTF exporter converts to Y-up by default (`+Y up`). Whoever writes
`tools/export_gltf.py` must record in `docs/export_notes.md` whether that conversion ran,
and `assets/scene.json` must state the camera and lights in the same frame as the geometry.
I am not deciding that here.

For reference, in Blender's own Z-up frame, `Cam_Hero` with rotation euler XYZ
`(1.85, 0, 0)` gives (Blender cameras look down local -Z, local +Y is up):

```
forward = Rx(1.85) * (0, 0, -1) = (0,  sin(1.85), -cos(1.85)) = (0,  0.96128,  0.27559)
up      = Rx(1.85) * (0, 1,  0) = (0,  cos(1.85),  sin(1.85)) = (0, -0.27559,  0.96128)
target  = (0, -6.4, 1) + forward
```

## 4. Lights

Four light types, all in `three_d::renderer::light`. There is **no area light**. That
matters: four of the six Blender lights are AREA.

| Type | Constructor | Shadow map? |
| --- | --- | --- |
| `AmbientLight` | `new(&Context, intensity: f32, color: Srgba)` | no |
| `AmbientLight` with IBL | `new_with_environment(&Context, f32, Srgba, &TextureCubeMap)` | no |
| `DirectionalLight` | `new(&Context, intensity: f32, color: Srgba, direction: Vec3)` | **yes** |
| `PointLight` | `new(&Context, intensity: f32, color: Srgba, position: Vec3, attenuation: Attenuation)` | no |
| `SpotLight` | `new(&Context, intensity: f32, color: Srgba, position: Vec3, direction: Vec3, cutoff: impl Into<Radians>, attenuation: Attenuation)` | **yes** |

`PointLight::new` and `AmbientLight::new` ignore the `&Context` argument entirely
(`_context`), but it is still in the signature.

### The intensity unit

**`intensity` is a dimensionless multiplier, not watts, not lumens, not candela.** Every
light does exactly this in `use_uniforms`:

```rust
program.use_uniform(
    &format!("color{}", i),
    self.color.to_linear_srgb().truncate() * self.intensity,
);
```

So the shader sees `linear_rgb(color) * intensity` as a raw radiance triple. Nothing in
three-d divides by 4π, by area, or by anything else. There is no physical relation to
Blender watts at all.

Consequence for agent H: **the watt-to-intensity conversion is a free scale factor that
look-dev has to find.** Do not invent a physical formula; there is none to be faithful to.
A defensible starting point is one constant `k` applied to every light,
`intensity = k * energy / 1000.0`, with `k` tuned once against the reference crops. Record
the constant in a comment in `src/lighting.rs` as invariant 4 requires.

### Attenuation

```rust
pub struct Attenuation { pub constant: f32, pub linear: f32, pub quadratic: f32 }
// Default: constant 1.0, linear 0.0, quadratic 0.0 — i.e. no falloff at all.
```

The shader (`src/renderer/light/shaders/light_shared.frag`) is:

```glsl
vec3 attenuate(vec3 light_color, vec3 attenuation, float distance) {
    float att = attenuation.x + attenuation.y * distance + attenuation.z * distance * distance;
    return light_color / max(1.0, att);
}
```

Note the `max(1.0, att)`. Attenuation can only ever **dim**, never brighten. Inverse-square
falloff needs `quadratic = 1.0` and gives `1/d²` only for `d > 1`.

### Spot cone

`SpotLight::cutoff` is the **half-angle** of the cone. The shader computes
`angle = acos(dot(-light_direction, normalize(direction)))` and lights the fragment when
`angle < cutoff`, with a `smoothstep(0.75 * cutoff, cutoff, angle)` soft edge that is
roughly Blender's spot blend of 0.25.

Blender's `spot_size` is the **full** cone angle. Our beams have `spot_size = 0.38397`
rad (22.0°), so `cutoff = 0.191_985` rad (11.0°).

**Quirk to know about:** `generate_shadow_map` builds its shadow camera with
`field_of_view_y = self.cutoff`, i.e. a half-FOV of `cutoff / 2`. The shadow frustum is
therefore half as wide as the lit cone. `is_visible` returns 1.0 (unshadowed) for any uv
outside `[0,1]`, so the outer half of each beam simply casts no shadow rather than going
black. Acceptable for us; do not be surprised by it.

### Attaching a shadow map

Only `DirectionalLight` and `SpotLight` have it. Same signature on both:

```rust
pub fn generate_shadow_map(
    &mut self,
    texture_size: u32,
    geometries: impl IntoIterator<Item = impl Geometry> + Clone,
) -> Result<(), RendererError>
```

```rust
let mut key = SpotLight::new(
    &context,
    intensity,
    linear_to_srgba([1.0, 0.93, 0.82], 1.0),
    vec3(0.0, -5.0, 6.0),
    direction,
    radians(0.5_f32),
    Attenuation::default(),
);
// The iterable itself must be Clone, so pass a slice, not a consuming iterator.
let casters: Vec<&dyn Object> = objects.iter().map(|(_, o)| o as &dyn Object).collect();
key.generate_shadow_map(2048, casters.as_slice())?;
```

Why `&[&dyn Object]` satisfies `impl IntoIterator<Item = impl Geometry> + Clone`:
`&[T]: IntoIterator<Item = &T>`, so `Item = &&dyn Object`. `dyn Object` implements
`Geometry` because `Object: Geometry` is a supertrait. `impl<T: Geometry + ?Sized> Geometry for &T`
then gives `&dyn Object: Geometry`, and applying it again gives `&&dyn Object: Geometry`.
`&[T]` is `Copy`, so the `Clone` bound holds. `casters.iter().copied()` also works:
`Copied<slice::Iter<'_, _>>` is `Clone` and yields `&dyn Object`, which is `Geometry`.

Call it once for a static scene, or every frame for the spinning wheel if the wheel must
cast a moving shadow. It allocates a fresh `DepthTexture2D` on every call, so per-frame
use is not free. `clear_shadow_map()` turns the shadow off again. `shadow_map()` returns
`Option<&DepthTexture2D>`.

Adding or removing a shadow map changes `Light::id()`
(`LightId::SpotLight(bool)`), which changes the shader cache key, which recompiles the
material shaders. Decide shadows once at startup, not per frame.

### Mapping the six Blender lights

three-d has no area light, so agent H must choose substitutes. My reading of the options,
not a decision:

- `Key_Wheel` (AREA, size 4, needs to cast the shadow) -> `SpotLight` with a wide cutoff
  and `generate_shadow_map`. It is the only light in the scene where a shadow is worth
  paying for.
- `Beam_L` / `Beam_R` (SPOT) -> `SpotLight`, `cutoff = spot_size / 2 = 0.191985`.
- `Rim_L` / `Rim_R` (AREA, far off to the sides) -> `DirectionalLight`. An area light at
  8 m reads as directional, and `DirectionalLight` has no attenuation to fight.
- `Fill_Front` (AREA size 6, energy 120, soft frontal fill) -> `AmbientLight`, or a second
  wide `SpotLight`. `AmbientLight` with no environment map is flat:
  `occlusion * ambientColor * mix(surface_color, vec3(0.0), metallic)`. It contributes
  **nothing to metals**, and 12 of our 20 materials are `metallic = 1`. A soft
  `SpotLight` or `DirectionalLight` is probably the better fill.

The world background is a plain Background node with no HDRI, so there is no
`TextureCubeMap` to build an `Environment` from and no reason to use
`AmbientLight::new_with_environment`.

### Lighting model

`PhysicalMaterial::lighting_model` comes from the glTF importer as
`LightingModel::Cook(NormalDistributionFunction::TrowbridgeReitzGGX, GeometryFunction::SmithSchlickGGX)`,
which is GGX plus Smith-Schlick. That is the right choice; leave it alone.

## 5. Emissive materials and transparency

### Emission

`PhysicalMaterial` exposes emission as two fields:

```rust
pub emissive: Srgba,
pub emissive_texture: Option<Texture2DRef>,
```

`use_uniforms` sends `program.use_uniform("emissive", self.emissive.to_linear_srgb())`,
and the shader does:

```glsl
vec3 total_emissive = emissive.rgb;
#ifdef USE_EMISSIVE_TEXTURE
total_emissive *= texture(emissiveTexture, ...).rgb;
#endif
outColor.rgb = total_emissive + calculate_lighting(...);
outColor.rgb = tone_mapping(outColor.rgb);
outColor.rgb = color_mapping(outColor.rgb);
```

So emission is added, not multiplied, and it is affected by tone mapping. There is no
separate emissive strength scalar.

**`Srgba` is four `u8`s**, so `emissive` cannot express a linear value above 1.0. Our
scene needs 1.2, 1.5, 3.0 and 6.0. Two ways out.

**(a) Bright but clamped.** Set `emissive` to the fully saturated colour and let the
bloom pass in `src/postfx.rs` supply the glow. Cheap, and probably enough for the bulbs.

**(b) Override the uniform.** `PhysicalMaterial::use_uniforms` writes `emissive`
unconditionally with `use_uniform`, and the shader always declares `uniform vec4 emissive`,
so a wrapper can write over it afterwards. The shader source is byte-identical, so
delegating `id()` keeps the shader cache shared.

```rust
use three_d::*;

/// A `PhysicalMaterial` whose emission may exceed 1.0 in linear space.
pub struct HdrEmissive {
    pub inner: PhysicalMaterial,
    /// Linear RGB emission. Values above 1.0 are the point of this type.
    pub emissive: Vec3,
}

impl Material for HdrEmissive {
    fn id(&self) -> EffectMaterialId {
        self.inner.id()
    }

    fn fragment_shader_source(&self, lights: &[&dyn Light]) -> String {
        self.inner.fragment_shader_source(lights)
    }

    fn use_uniforms(&self, program: &Program, viewer: &dyn Viewer, lights: &[&dyn Light]) {
        self.inner.use_uniforms(program, viewer, lights);
        // Overwrite the u8-clamped value the inner material just sent.
        program.use_uniform("emissive", self.emissive.extend(1.0));
    }

    fn render_states(&self) -> RenderStates {
        self.inner.render_states()
    }

    fn material_type(&self) -> MaterialType {
        self.inner.material_type()
    }
}
```

`Vec3::extend(w) -> Vec4` is cgmath 0.18. `Material` has exactly these five methods and
no others; I checked the trait in `src/renderer/material.rs` and it is unchanged from
0.18.2.

Option (b) only pays off if the intermediate render target is floating point. An
RGBA8 target clamps at 1.0 and throws the headroom away. See section 6.

`MAT_Bulb_Glass` (3.0), `MAT_Lens_Glow` (6.0) and `MAT_LED_Screen` (1.5) are the
materials that need this. `MAT_LED_Screen` is being replaced by agent J's sky shader
anyway.

### Transparency: no separate pass, but one render call

Transparency is handled by sort order inside a single render call, not by a second pass.

`PhysicalMaterial` signals it two ways at once, and both must agree:

```rust
// what PhysicalMaterial::new_transparent sets:
is_transparent: true,
render_states: RenderStates {
    write_mask: WriteMask::COLOR,   // no depth write
    blend: Blend::TRANSPARENCY,
    ..Default::default()
},
```

`material_type()` returns `MaterialType::Transparent` when `is_transparent` is true.
`RenderTarget::render` then partitions objects into deferred and forward, and sorts the
forward set with `cmp_render_order`:

- opaque first, nearest to farthest from the viewer;
- transparent second, farthest to nearest.

**The sort only covers objects passed to one `render` call.** If you render the wheel with
one call and `Crest_Crystal` with another, `Crest_Crystal` will not sort against the wheel
and the blend will be wrong. Put every object in one iterator:

```rust
let all: Vec<&dyn Object> = objects.iter().map(|(_, o)| o as &dyn Object).collect();
target.render(&camera, all.iter().copied(), &lights);
```

Objects outside the viewer frustum are dropped by `Frustum::contains(o.aabb())` inside
`render`, so a correct `aabb()` matters. `Mesh::aabb()` transforms the stored AABB by
`transformation * animation_transformation`, so it tracks the spinning wheel.

`MaterialType::Deferred` exists and `DeferredPhysicalMaterial` implements it. It runs a
G-buffer pass into an RGBA8 `Texture2DArray` before the forward pass. Deferred shading
cannot do transparency and the U8 G-buffer loses HDR, so **use `PhysicalMaterial`, not
`DeferredPhysicalMaterial`.**

Blend constants available: `Blend::TRANSPARENCY` (premultiplied-style: `One` /
`OneMinusSrcAlpha`), `Blend::STANDARD_TRANSPARENCY` (`SrcAlpha` / `OneMinusSrcAlpha`),
`Blend::ADD`. `Blend::ADD` is what the additive beam cones in `src/postfx.rs` want, with
`write_mask: WriteMask::COLOR` and `depth_test: DepthTest::Less` so the cones are occluded
by geometry but do not occlude each other.

## 6. A custom full-screen post-process pass

Implement the `Effect` trait and call `apply_screen_effect`. Five methods:

```rust
pub trait Effect {
    fn fragment_shader_source(&self, lights: &[&dyn Light],
        color_texture: Option<ColorTexture>, depth_texture: Option<DepthTexture>) -> String;
    fn id(&self, color_texture: Option<ColorTexture>,
        depth_texture: Option<DepthTexture>) -> EffectMaterialId;
    fn use_uniforms(&self, program: &Program, viewer: &dyn Viewer, lights: &[&dyn Light],
        color_texture: Option<ColorTexture>, depth_texture: Option<DepthTexture>);
    fn render_states(&self) -> RenderStates;
}
```

The vertex shader is not yours. `apply_screen_effect` pairs your fragment shader with the
crate's `full_screen_vertex_shader_source()`, which is `pub(crate)`. It draws one
oversized triangle and gives the fragment shader `in vec2 uvs;` and `in vec4 col;`.
`uvs` runs 0..1 across the target, y up.

### Sampling the colour and depth textures

You do not write the samplers yourself. `ColorTexture::fragment_shader_source()` and
`DepthTexture::fragment_shader_source()` emit them, and `use_uniforms` binds them. For
`ColorTexture::Single` you get:

```glsl
uniform sampler2D colorMap;
vec4 sample_color(vec2 uv) { return texture(colorMap, uv); }
```

and for `DepthTexture::Single`:

```glsl
uniform sampler2D depthMap;
float sample_depth(vec2 uv) { return texture(depthMap, uv).x; }
```

`sample_depth` returns the non-linear depth-buffer value in `[0,1]`. To get a world
position, `shared.frag` gives you
`world_pos_from_depth(mat4 viewProjectionInverse, float depth, vec2 uv)`, and `FogEffect`
shows how to supply that uniform:

```rust
program.use_uniform("viewProjectionInverse", (viewer.projection() * viewer.view()).invert().unwrap());
```

`ColorTexture` and `DepthTexture` are `Copy` enums with `Single`, `Array` and `CubeMap`
variants. **`CubeMap` is `todo!()` in `fragment_shader_source`, `id` and `use_uniforms` —
it panics.** Use `Single` or `Array`.

### The shader ID range

`EffectMaterialId` is an `open_enum`, i.e. `pub struct EffectMaterialId(pub u16)` with
associated consts. IDs `0x0000..=0x4FFF` are reserved for public use; everything the crate
uses is `>= 0x5000`. Two effects that return the same ID and different sources will get
the wrong cached program, so give each of ours its own constant.

### Working example: vignette

```rust
use three_d::*;

/// Darkens the corners. Reads only the colour texture.
pub struct VignetteEffect {
    /// Radius at which darkening starts, in units of half-diagonal. 0.0 to 1.0.
    pub inner: f32,
    /// Radius at which darkening reaches full strength.
    pub outer: f32,
    /// 0.0 = off, 1.0 = corners go black.
    pub strength: f32,
}

impl Effect for VignetteEffect {
    fn id(
        &self,
        _color_texture: Option<ColorTexture>,
        _depth_texture: Option<DepthTexture>,
    ) -> EffectMaterialId {
        // Public range is 0x0000..=0x4FFF.
        EffectMaterialId(0x0001)
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
            uniform float innerRadius;
            uniform float outerRadius;
            uniform float strength;
            layout (location = 0) out vec4 outColor;
            void main() {{
                outColor = sample_color(uvs);
                float d = length(uvs - vec2(0.5)) * 1.41421356;
                float v = 1.0 - strength * smoothstep(innerRadius, outerRadius, d);
                outColor.rgb *= v;
            }}",
            color_texture
                .expect("VignetteEffect needs a color texture")
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
            .expect("VignetteEffect needs a color texture")
            .use_uniforms(program);
        program.use_uniform("innerRadius", self.inner);
        program.use_uniform("outerRadius", self.outer);
        program.use_uniform("strength", self.strength);
    }

    fn render_states(&self) -> RenderStates {
        RenderStates {
            write_mask: WriteMask::COLOR,
            depth_test: DepthTest::Always,
            cull: Cull::Back,
            ..Default::default()
        }
    }
}
```

Apply it:

```rust
target.apply_screen_effect(
    &effect,
    &camera,
    &[],                                        // no lights needed
    Some(ColorTexture::Single(&scene_color)),
    None,
);
```

`apply_screen_effect` is available on `RenderTarget`, `ColorTarget`, `DepthTarget`,
`RenderTargetMultisample`, `ColorTargetMultisample` and `DepthTargetMultisample`. It wraps
the draw in `write_partially` for you, so do **not** nest it inside another `write` closure.
The free function `three_d::apply_screen_effect(&context, ...)` is the version you call
from inside a `write` closure.

`program.use_uniform` **panics** if the named uniform is absent or was optimised out
("the uniform {} is sent to the shader but not defined or never used"). Use
`use_uniform_if_required` for anything conditional.

### Multi-pass chain and tone mapping

Ping-pong between two `Texture2D`s. The crate ships `CopyEffect` (no tone/colour mapping)
and `ScreenEffect` (applies the viewer's tone and colour mapping) for the blit.

Tone and colour mapping live on the **camera**, not the render target:

```rust
pub struct Camera { camera: three_d_asset::Camera, pub tone_mapping: ToneMapping, pub color_mapping: ColorMapping }
```

`ToneMapping` is `None | Reinhard | Aces | Filmic`, default `Aces`. `ColorMapping` is
`None | ComputeToSrgb`, default `ComputeToSrgb`. Both are applied inside the material and
effect fragment shaders, not by OpenGL.

The rule the crate documents: `camera.disable_tone_and_color_mapping()` before rendering
into an intermediate target, `camera.set_default_tone_and_color_mapping()` before the
final pass. Get this wrong and you tone-map twice.

Blender's view transform on this scene is **Filmic**, so `ToneMapping::Filmic` is the
closer match to the reference than the default `Aces`. That is look-dev's call, but it is
the obvious first thing to try.

For bloom to have anything to work with, the intermediate target must be floating point:

```rust
let hdr = Texture2D::new_empty::<[f16; 4]>(   // or [f32; 4]
    &context, width, height,
    Interpolation::Linear, Interpolation::Linear, None,
    Wrapping::ClampToEdge, Wrapping::ClampToEdge,
);
```

`f16` is reachable as a bare `f16` through `use three_d::*`.
`three_d_asset/src/prelude.rs:14` is `pub use half::f16;`, and `three-d` re-exports the
whole prelude. No `half` dependency of our own is needed.

MSAA offscreen is available if the edges need it: `RenderTargetMultisample::<C, D>::new(&context, w, h, samples)`,
then `resolve()` -> `(Texture2D, DepthTexture2D)`, or `resolve_to(&target)`.

## 7. Offscreen render at an explicit resolution, PNG out, and the headless question

### The plain answer on macOS

**A hidden window is required. There is no headless path on macOS with these versions.**

Evidence:

1. `three-d` 0.18.2 had `src/window/headless.rs` with `HeadlessContext::new()`, behind a
   `headless` feature. **Both the file and the feature are gone in 0.19.0.** The crates.io
   feature list for 0.18.2 contains `headless`; the list for 0.19.0 does not. `window.rs`
   in 0.19.0 declares only the `winit_window` module, and its doc comment no longer
   mentions `HeadlessContext`.
2. Rolling our own with glutin does not help on macOS. `three-d`'s `window` feature uses
   `glutin 0.30`, whose macOS backend is CGL. In glutin 0.30.10,
   `src/api/cgl/surface.rs:35-40` is:
   ```rust
   pub(crate) unsafe fn create_pbuffer_surface(...) -> Result<Surface<PbufferSurface>> {
       Err(ErrorKind::NotSupported("pbuffers are not supported with CGL").into())
   }
   ```
   and `make_current_surfaceless` exists only in `src/api/egl/context.rs`, never in the
   CGL backend. So a CGL context cannot be made current without a window surface.
3. Downgrading to `three-d 0.18.2` to get `headless` back would also pin
   `three-d-asset 0.9`, `glow 0.14` and `egui 0.29`, and would pull in a second copy of
   glutin (0.29 *and* 0.30, aliased as `glutin_029`). Not worth it for one flag.

A hidden window still satisfies the CLI contract: `--shot` must not require a *visible*
window, and nothing appears on screen. The catch is macOS's own rule that `EventLoop::new()`
and window creation must happen on the **main thread**. `src/shot.rs` must therefore run
on the main thread, which it does if `main` calls it directly.

### The recipe

Create a hidden winit window purely to own the GL context, then never touch it again.
Render into your own textures at whatever size you like; the window's own size is
irrelevant.

```rust
use three_d::*;

/// Owns everything an offscreen render needs. Drop it only when the render is finished.
pub struct HiddenContext {
    pub context: Context,
    gl: WindowedContext,
    window: winit::window::Window,
    event_loop: winit::event_loop::EventLoop<()>,
}

impl HiddenContext {
    /// Creates an OpenGL context with no window visible on screen.
    /// Must be called on the main thread on macOS.
    pub fn new() -> Result<Self, WindowError> {
        let event_loop = winit::event_loop::EventLoop::new();
        let window = winit::window::WindowBuilder::new()
            .with_visible(false)
            .with_inner_size(winit::dpi::LogicalSize::new(32.0, 32.0))
            .build(&event_loop)?;
        let gl = WindowedContext::from_winit_window(&window, SurfaceSettings::default())?;
        let context = (*gl).clone();
        Ok(Self { context, gl, window, event_loop })
    }
}
```

Keeping `gl`, `window` and `event_loop` in the struct is not defensive padding, it is
required. `three_d::Context` holds only `Arc<glow::Context>` (a table of function
pointers), a VAO name and the program cache (`src/core/context.rs:15-20`). It does **not**
own the GL context. `WindowedContext` owns the `PossiblyCurrentContext` and the
`Surface<WindowSurface>`. Drop it and the CGL context and the surface are destroyed, so
every later GL call goes through dangling state. The surface wraps the window's NSView, so
the winit `Window` must outlive it too, and on macOS the `EventLoop` must outlive the
window.

`WindowedContext` derefs to `Context`, and `Context` is `Clone`.
`winit 0.28`'s `WindowBuilder` has `with_visible(bool)` (`src/window.rs:308`) and
`build<T>(&EventLoopWindowTarget<T>)` (`src/window.rs:461`); `EventLoop<()>` derefs to
`EventLoopWindowTarget<()>`, which is why `.build(&event_loop)` compiles.
`WindowError` and `WindowedContext` are both exported from `three_d` behind the `window`
feature, which is on by default.

The `event_loop` field is never run. `winit` will warn about unused fields, not about the
loop never starting. Never calling `run` is exactly what we want: no frames, no events,
no window ever shown.

`winit` 0.28 and `raw-window-handle` 0.5 are optional dependencies of `three-d`, so
`three-d` re-exports neither `winit` nor `WindowBuilder`. Agent F must add
`winit = "0.28"` to `Cargo.toml` for `src/shot.rs` to name those types. **The version must
be exactly 0.28** or `WindowedContext::from_winit_window` will reject the type.

### Render and save

```rust
use three_d::*;
use three_d_asset::io::Serialize;

/// Renders one frame at an explicit resolution and returns it as a CPU image.
pub fn render_to_cpu_texture(
    context: &Context,
    camera: &Camera,
    objects: &[&dyn Object],
    lights: &[&dyn Light],
    width: u32,
    height: u32,
) -> CpuTexture {
    let color = Texture2D::new_empty::<[u8; 4]>(
        context,
        width,
        height,
        Interpolation::Linear,
        Interpolation::Linear,
        None,
        Wrapping::ClampToEdge,
        Wrapping::ClampToEdge,
    );
    let depth = DepthTexture2D::new::<f32>(
        context,
        width,
        height,
        Wrapping::ClampToEdge,
        Wrapping::ClampToEdge,
    );
    let target = RenderTarget::new(color.as_color_target(None), depth.as_depth_target());
    let pixels = target
        .clear(ClearState::color_and_depth(0.0, 0.0, 0.0, 1.0, 1.0))
        .render(camera, objects.iter().copied(), lights)
        .read_color::<[u8; 4]>();
    CpuTexture {
        data: TextureData::RgbaU8(pixels),
        width,
        height,
        ..Default::default()
    }
}

/// Writes a PNG. Needs three-d-asset's `png` feature.
pub fn save_png(image: &CpuTexture, path: &str) -> three_d_asset::Result<()> {
    three_d_asset::io::save(&image.serialize(path)?)
}
```

Details that matter:

- The camera's viewport must be `Viewport::new_at_origo(width, height)`, or the render
  covers only part of the texture. `RenderTarget::render` uses `viewer.viewport()`.
- `as_color_target` and `as_depth_target` take `&self` in 0.19.0. In 0.18.2 they took
  `&mut self`. Code copied from 0.18 examples will have spurious `mut`s.
- `clear` and `render` both return `&Self`, so the chain above works.
- `read_color::<T>` requires `T`'s base type to match the target's. `[u8; 4]` for an
  RGBA8 texture, `[f32; 4]` for an f32 texture. Wrong pairing gives garbage, not an error.
- `read_color` already calls `flip_y`, and `serialize_img` writes rows top-down, so the
  PNG comes out the right way up. Do not flip it yourself.
- `CpuTexture` is `three_d_asset::Texture2D`. `..Default::default()` gives
  `name: "default"`, `Interpolation::Linear` filters, `Some(Mipmap::default())`,
  `Wrapping::Repeat`. Harmless for a file being written out.
- `serialize` picks the format from the file extension. `.png` needs the `png` feature or
  it returns `Error::FeatureMissing("png")` at runtime.
- The last pass must have `ColorMapping::ComputeToSrgb` on the camera, or the PNG will be
  linear and look washed out. That is the default, so just do not disable it on the final
  pass.
- `--shot` must not depend on wall-clock time. Call `model.animate(0.0)` (or skip
  `animate` entirely) and pass a fixed wheel rotation, never `frame_input.accumulated_time`.
- For the crops, `read_color_partially(scissor_box)` reads a sub-rectangle directly. Note
  `ScissorBox` y counts from the **bottom**, while `agent_plan.md`'s crop table counts from
  the top. Converting in `src/bin/crop.rs` over the `image` crate is simpler and less
  error-prone.

## 8. Orbit camera, events, frame time

```rust
use three_d::*;

let window = Window::new(WindowSettings {
    title: "wheel_stage".to_string(),
    max_size: Some((1672, 941)),
    ..Default::default()
})?;
let context = window.gl();

let mut camera = Camera::new_perspective(
    window.viewport(),
    vec3(0.0, -6.4, 1.0),
    vec3(0.0, 0.0, 1.0),
    vec3(0.0, 0.0, 1.0),
    radians(0.863_056_4_f32),
    0.05,
    200.0,
);
let mut control = OrbitControl::new(camera.target(), 1.0, 60.0);

// `objects: Vec<(String, Gm<Mesh, PhysicalMaterial>)>` from section 2.
// `lights: Vec<Box<dyn Light>>` from section 4.
window.render_loop(move |mut frame_input| {
    camera.set_viewport(frame_input.viewport);
    control.handle_events(&mut camera, &mut frame_input.events);

    let seconds = (frame_input.accumulated_time * 0.001) as f32;
    // ... update spin state from `seconds` ...

    let drawables: Vec<&dyn Object> = objects.iter().map(|(_, o)| o as &dyn Object).collect();
    let light_refs: Vec<&dyn Light> = lights.iter().map(|l| l.as_ref()).collect();

    frame_input
        .screen()
        .clear(ClearState::color_and_depth(0.0, 0.0, 0.0, 1.0, 1.0))
        .render(&camera, drawables.iter().copied(), &light_refs);

    FrameOutput::default()
});
```

The `lights` argument is `&[&dyn Light]`, so a `Vec<Box<dyn Light>>` has to be reborrowed
into a `Vec<&dyn Light>` each frame. Building those two `Vec`s per frame is cheap next to
the draw calls, but if it shows up in a profile, hold the `&dyn` slices in a struct that
also owns the objects.

`OrbitControl`:

```rust
pub struct OrbitControl { pub target: Vec3, pub min_distance: f32, pub max_distance: f32 }
pub fn new(target: Vec3, min_distance: f32, max_distance: f32) -> Self
pub fn handle_events(&mut self, camera: &mut three_d_asset::Camera, events: &mut [Event]) -> bool
```

Note the parameter type: `&mut three_d_asset::Camera`, **not** `&mut three_d::Camera`.
Passing `&mut camera` works by deref coercion through `impl DerefMut for Camera`. In
0.18.2 the parameter was `&mut Camera`, so this is a silent signature change. The return
value is `true` when the camera moved; use it to skip redraws if you want.

What it handles, and nothing else: left-drag -> `rotate_around_with_fixed_up`, mouse wheel
-> `zoom_towards`, trackpad pinch -> `zoom_towards`. It sets `handled = true` on each event
it consumes. There is no pan. `FreeOrbitControl` orbits without a fixed up vector.
`Control2D` (new in 0.19.0) has pan and zoom for 2D. `FlyControl` and
`FirstPersonControl` are the other options.

`Event` variants: `MousePress`, `MouseRelease`, `MouseMotion`, `MouseWheel`,
`PinchGesture`, `RotationGesture`, `MouseEnter`, `MouseLeave`, `KeyPress`, `KeyRelease`,
`ModifiersChange`, `Text`. Every mouse variant carries `handled: bool`, `modifiers` and a
`position: PhysicalPoint`. `MouseMotion::delta` is in **logical** pixels while `position` is
in **physical** pixels — an easy trap on a Retina display.

`FrameInput`:

| Field | Meaning |
| --- | --- |
| `events: Vec<Event>` | events since the last frame |
| `elapsed_time: f64` | **milliseconds** since last frame |
| `accumulated_time: f64` | **milliseconds** since start |
| `viewport: Viewport` | window size in physical pixels |
| `window_width` / `window_height: u32` | logical pixels |
| `device_pixel_ratio: f32` | physical per logical |
| `first_frame: bool` | also true after the window becomes visible again |
| `context: Context` | the graphics context |

Both times are **milliseconds and `f64`**. Multiply by 0.001 for seconds. `FrameInput::screen()`
is `RenderTarget::screen(&context, viewport.width, viewport.height)`.

`FrameOutput { exit: bool, swap_buffers: bool, wait_next_event: bool }`, default
`(false, true, false)`. Set `exit: true` to close the window and end `render_loop`.

`render_loop` takes `self` by value and never returns on desktop; it drives
`winit::EventLoop::run`. Any state the closure uses must be moved into it.

Fixed hero view for `--shot`: build the camera from the manifest and never call
`handle_events`. `src/shot.rs` does not need a `Window` at all, only the hidden context
from section 7.

## 9. Things that changed and will break code copied from older examples

I diffed every `pub fn`, `pub struct`, `pub enum`, `pub trait` and `pub use` in
0.18.2 against 0.19.0. There is no published changelog for either version — the GitHub
releases API returns nothing newer than 0.10.0 — so this diff is the record.

**Removed in 0.19.0:**

| Gone | Replacement |
| --- | --- |
| `HeadlessContext`, `HeadlessError`, the `headless` feature, `src/window/headless.rs` | hidden window (section 7) |
| `IndexBuffer` | renamed `TriangleBuffer`; `Mesh::indices_mut()` now returns `&mut TriangleBuffer` |
| `Mesh::update_positions(&[Vec3])` | `Mesh::set_positions(&[Vec3]) -> Result<(), RendererError>` |
| `Mesh::update_normals(&[Vec3])` | `Mesh::set_normals(&[Vec3]) -> Result<(), RendererError>` |

**Signature changes in 0.19.0:**

- `Texture2D::as_color_target`, `*::as_depth_target` and `*::fill` now take `&self`, not
  `&mut self`. Old code carries `mut` bindings the borrow checker will now flag as unused.
- `OrbitControl::handle_events` takes `&mut three_d_asset::Camera` instead of
  `&mut Camera`. Deref coercion saves most call sites.
- New `Mesh` methods: `set_uvs`, `set_tangents`, `set_colors`, and a `_partially` variant
  of each setter taking an offset. All return `Result`.

**Added in 0.19.0:** `Control2D`, `Wireframe`, `WireframeMaterial` (with
`Wireframe::new_from_cpu_mesh` and `new_from_cpu_model`), `EnvironmentOptions` and
`Environment::new_with_options`, `Program::draw_with`, `Program::draw_elements_with`,
`GeometryId::Wireframe`, `EffectMaterialId::WireframeMaterial`.

**Dependency bumps 0.18.2 -> 0.19.0:** `glow` 0.14 -> 0.17, `three-d-asset` 0.9 -> 0.10,
`egui`/`egui_glow` 0.29 -> 0.34, `swash` 0.1 -> 0.2. The second `glutin_029` dependency is
gone. `winit` stays at 0.28 and `glutin` at 0.30.

**Older than 0.19 but still a trap in examples on the web.** These landed in 0.18.0, so
any example written for 0.17 or earlier is wrong:

- The `Viewer` trait replaced `&Camera` throughout. `Material::use_uniforms`,
  `Effect::use_uniforms`, `Geometry::draw`, `Geometry::render_with_material`,
  `Object::render`, `apply_screen_effect` and `RenderTarget::render` all take
  `&dyn Viewer` or `impl Viewer` now. `Camera` implements it. `Viewer` also carries
  `color_mapping()` and `tone_mapping()`, which is how tone mapping became a camera
  property.
- `Geometry::vertex_shader_source()` takes no arguments. Older versions passed the
  required vertex attributes in.
- Tone mapping moved off the render target and onto the camera:
  `Camera::disable_tone_and_color_mapping()` and `set_default_tone_and_color_mapping()`.
- `Color` was renamed `Srgba`, and `Srgba::to_linear_srgb()` replaced the old
  `to_vec4()` for shader use.
- Shader IDs are `open_enum` newtypes (`GeometryId(pub u16)`,
  `EffectMaterialId(pub u16)`, `LightId(pub u8)`) rather than plain enums. `Material::id`,
  `Effect::id`, `Geometry::id` and `Light::id` all return one, and custom implementations
  must pick a value in the documented public range.

**three-d-asset 0.9 -> 0.10:** new `3mf`, `webp` and `svg` features. Nothing that affects
us. `Scene`, `Node`, `Model`, `Primitive`, `PbrMaterial` and the glTF importer's
behaviour are unchanged, including the `"node"` naming problem in section 2.

## Gaps I am admitting to

1. **Nothing compiled.** No Rust toolchain was present when this was written; `cargo`,
   `rustc` and `rustup` were all absent from `PATH`. Every signature and every field name
   was read out of the crate source, and the type reasoning is spelled out where it is not
   obvious, but treat the snippets as drafts until `cargo check` agrees.
2. **Whether a hidden winit window on macOS reliably produces a usable GL context** is
   the one thing to test before any other code is written. Everything in section 7 follows
   from reading the source, but it is a runtime property of the driver, not of the source.
   If it fails the fallbacks are, in order: a visible window moved off-screen;
   `three-d 0.18.2` with the `headless` feature and `three-d-asset 0.9`; a different
   renderer. All three are worse.
3. **The watt-to-intensity factor is not derivable.** three-d's `intensity` has no
   physical unit at all, so there is no correct conversion from Blender watts to find.
   Whoever writes `src/lighting.rs` must pick the constant by looking at crops and record
   it in a comment.
4. **Emission above 1.0 needs a decision, not just a technique.** Section 5 gives a
   wrapper that works, but whether the extra headroom is visible depends on the postfx
   chain being floating point. Agents I and J should agree on the intermediate texture
   format before either writes code.
5. **The `Camera` up axis and the exported coordinate frame are unresolved here on
   purpose.** three-d imposes no convention, so the answer is whatever
   `tools/export_gltf.py` does. Agent D must record it in `docs/export_notes.md`, and
   `assets/scene.json` must be in the same frame as the geometry.

The following were flagged as uncertain in an earlier draft and are now resolved, so do
not treat them as open: `f16` reachability (section 6), the `&[&dyn Object]` trait bounds
(section 4), and the `WindowedContext` lifetime (section 7).

## Dependencies agent F needs to add

```toml
[dependencies]
three-d = "0.19.0"
three-d-asset = { version = "0.10.0", features = ["gltf", "png"] }
winit = "0.28"          # only for src/shot.rs: hidden window for the headless context
image = "0.25"          # only for src/bin/crop.rs
serde = { version = "1", features = ["derive"] }   # assets/scene.json
serde_json = "1"                                    # assets/scene.json
```

`winit` must be exactly 0.28 to match three-d's. `three-d-asset` must be 0.10 to match
three-d's. Both are hard constraints, not preferences.
