//! GLB load, model construction, material mapping and the hero camera.
//!
//! Owner: agent G.
//!
//! # Why this file walks a `Scene` instead of loading a `CpuModel`
//!
//! The glTF importer in `three-d-asset` names every *primitive* node the literal string
//! `"node"`, and `three_d::Model::new` drops names entirely. The Blender object names live
//! one level up in the `Scene` tree, so the tree is walked by hand and each primitive is
//! built into its own `Gm<Mesh, PhysicalMaterial>` tagged with the nearest named ancestor.
//! See `docs/three_d_api.md` §2.
//!
//! The walk also records the world transform of every *named* node, including the three
//! mesh-less pivot empties `Wheel_Root`, `Wheel_Stand` and `Crest_Root`, and the chain of
//! named ancestors of every part. That is how [`Stage::wheel_indices`] can be exact:
//! `Wheel_Root`'s subtree, not a name prefix. `Wheel_Legs`, `Wheel_Axle`,
//! `Wheel_BasePlate` and `Wheel_CrossBar` share the `Wheel_` prefix but hang off
//! `Wheel_Stand` and must not spin.
//!
//! # Why the GLB's own materials are overwritten
//!
//! Measured, not assumed. `three_d_asset::io::gltf::parse_material` does
//! `albedo: base_color_factor.into()`, and `impl From<[f32; 4]> for Srgba` is
//! `(value * 255.0) as u8` — a truncation with **no sRGB encode**. glTF base colours are
//! linear, `Srgba` is sRGB-encoded, and `PhysicalMaterial::use_uniforms` sends
//! `albedo.to_linear_srgb()`, so every imported colour is decoded a second time and comes
//! out far too dark. The same applies to `emissive_factor`, which additionally arrives
//! divided by `KHR_materials_emissive_strength` — an extension `three-d-asset` 0.10 never
//! reads. `metallic_factor` and `roughness_factor` do survive as plain floats, but they are
//! re-applied anyway so that one table, `assets/scene.json`, is the only authority.
//!
//! # Why one material keeps what the GLB carried
//!
//! `MAT_LED_Screen` is texture-driven: an Image Texture node holding `T_LEDWall_Sky` feeds its
//! Base Color and its Emission Color, the fixed export embeds that PNG, and `three-d-asset`
//! does import it — one image, two textures, confirmed with `GS_MATERIAL_AUDIT=1`. The shader
//! multiplies `albedo` by `albedoTexture` and `emissive` by `emissiveTexture`, so for a
//! textured material the manifest's flat `base_color` and `effective_emission` are *not* the
//! values to write: they are what the shader nodes held before the texture was wired up.
//! Those two factors become white instead, and the picture comes through. Every other
//! material is untextured and takes the manifest's numbers.
//!
//! Set `GS_MATERIAL_AUDIT=1` to print what the GLB carried next to what was applied.
//!
//! # The five metals need an environment, and that is not a material bug
//!
//! `MAT_Gold_Trim`, `MAT_Gold_Dark`, `MAT_Metal_Polished`, `MAT_Truss_Metal` and
//! `MAT_Peg_Metal` all have `metallic = 1.0` in `wheel_stage.blend`, and `assets/scene.json`
//! carries that value with `glb_metallic` beside it to show transport kept it. In three-d a
//! fully metallic surface has no diffuse term at all, and its ambient term is
//! `occlusion * ambientColor * mix(surface_color, vec3(0.0), metallic)`
//! (`three-d-0.19.0/src/renderer/light/ambient_light.rs`), which is exactly zero at
//! `metallic = 1`. So with a plain `AmbientLight` those five materials only ever show a direct
//! specular highlight and read as black. EEVEE gathers indirect light for them and three-d
//! does not: that is a difference between two renderers, not a wrong number in the table.
//!
//! Lowering `metallic` fixes the symptom and loses the table, so nothing in this file does it.
//! The fix belongs to `src/lighting.rs`:
//! `AmbientLight::new_with_environment(&context, intensity, color, &cube)` takes the other
//! branch of that shader, which computes an IBL diffuse *and* specular from a `TextureCubeMap`.
//! There is no HDRI in the .blend and no network at run time, so the cube map has to be
//! generated — `T_LEDWall_Sky` from the GLB, or a gradient built from
//! `RenderSpec::world_background`, are both to hand.
//!
//! # One table decides every material
//!
//! `assets/scene.json` is the only authority for a material's base colour, metallic,
//! roughness, alpha and emission, and this file holds no constant that repeats one of those
//! numbers. It also holds no per-node override of them. An override is a repair only when it
//! restores something glTF transport lost, and the manifest's `glb_base_color_factor`,
//! `glb_metallic` and `glb_roughness` record that transport loses none of the three on any of
//! the 19 materials. What transport does lose is emission, and [`hdr_emissive`] restores it.

use crate::manifest::{Manifest, MaterialSpec};
use std::collections::HashMap;
use three_d::*;
use three_d_asset::{Geometry as CpuGeometry, Node, Scene as CpuScene};

/// Path of the exported model, relative to the crate root. The manifest's own `glb` field
/// wins; this is the fallback and the documented default.
pub const MODEL_PATH: &str = "assets/wheel_stage.glb";

/// World up in the exported geometry, `(0, 1, 0)`. The orbit control keeps it fixed.
pub const WORLD_UP: Vec3 = vec3(0.0, 1.0, 0.0);

/// A [`PhysicalMaterial`] with the one thing this scene needs that it cannot express:
/// emission above linear 1.0.
///
/// `PhysicalMaterial::emissive` is four `u8`s, so it saturates at linear 1.0, while
/// `assets/scene.json` gives `MAT_Lens_Glow` an effective emission of `(6.0, 5.7, 4.92)`,
/// `MAT_Bulb_Glass` `(3.0, 2.79, 2.22)` and `MAT_Crystal` `(1.02, 0.72, 1.14)` at alpha 0.55,
/// which has to reach the frame as `(1.85, 1.31, 2.07)`. The shader's `emissive` uniform is a
/// `vec4` and takes the real value happily, so the fix is to write over what the inner
/// material sent — `docs/three_d_api.md` §5 option (b). Without it all three arrive at exactly
/// 1.0 and the emission strengths the .blend declares are lost in transport.
pub struct StageMaterial {
    /// The material as the manifest and the GLB describe it. Public because `src/screen.rs`
    /// needs the LED wall's imported texture set off it.
    pub inner: PhysicalMaterial,
    /// Linear RGB emission that may exceed 1.0. `None` leaves the inner material's own
    /// `u8`-clamped value alone, which is right for everything that does not glow.
    pub emissive_hdr: Option<Vec3>,
}

impl StageMaterial {
    /// Wraps an imported material. `emissive_hdr` comes from the manifest; see
    /// [`hdr_emissive`].
    pub fn new(inner: PhysicalMaterial, emissive_hdr: Option<Vec3>) -> Self {
        StageMaterial {
            inner,
            emissive_hdr,
        }
    }
}

impl Material for StageMaterial {
    fn id(&self) -> EffectMaterialId {
        // Byte-identical source, so the cache entry stays shared with every other
        // `PhysicalMaterial` of the same texture set. Only the `emissive` uniform moves.
        self.inner.id()
    }

    fn fragment_shader_source(&self, lights: &[&dyn Light]) -> String {
        self.inner.fragment_shader_source(lights)
    }

    fn use_uniforms(&self, program: &Program, viewer: &dyn Viewer, lights: &[&dyn Light]) {
        self.inner.use_uniforms(program, viewer, lights);
        if let Some(emissive) = self.emissive_hdr {
            // Over the top of the `u8`-clamped value the inner material just sent.
            program.use_uniform("emissive", emissive.extend(1.0));
        }
    }

    fn render_states(&self) -> RenderStates {
        self.inner.render_states()
    }

    fn material_type(&self) -> MaterialType {
        self.inner.material_type()
    }
}

/// The linear emission to write over `PhysicalMaterial`'s `u8`-clamped `emissive`, or `None`
/// when the clamped value is already right.
///
/// Straight from `assets/scene.json`: [`MaterialSpec::emitted_radiance`] is the radiance the
/// .blend's shader emits, corrected for the two things three-d does to it.
///
/// 1. `Srgba` saturates at linear 1.0, so anything brighter has to come through the uniform.
/// 2. A blended material is multiplied by its own alpha by `Blend::TRANSPARENCY`, emission
///    included, so `MAT_Crystal` at alpha 0.55 would put only 55% of its declared radiance on
///    the frame. `emitted_radiance` divides by alpha for exactly that reason.
///
/// A material with an emission texture is left alone. There the radiance is the image times
/// `emission_strength`, the shader multiplies the `emissive` uniform by the texture, and
/// `effective_emission` is only the socket default behind the image — writing it here would
/// stain the picture. `MAT_LED_Screen` is the only one.
pub fn hdr_emissive(spec: &MaterialSpec) -> Option<Vec3> {
    if !spec.emits() || !spec.emission_texture.is_empty() {
        return None;
    }
    let e = spec.emitted_radiance();
    if e.x <= 1.0 && e.y <= 1.0 && e.z <= 1.0 {
        return None;
    }
    Some(e)
}

/// One drawable piece of the imported scene, tagged with its Blender object name.
///
/// A Blender object with several materials produces several parts that share one `name`.
/// 153 meshes and 26 extra material slots make 179 parts.
pub struct Part {
    /// Blender object name, e.g. `Wheel_Rim`.
    pub name: String,
    /// Blender material name, e.g. `MAT_Gold_Trim`. Empty if the glTF carried none.
    pub material_name: String,
    /// Named nodes from the scene root down to this part's own node, inclusive. Used by
    /// [`Stage::indices_under`]; `["Wheel_Root", "Wheel_Rim"]` for a rim primitive.
    pub node_path: Vec<String>,
    /// World transform as imported, before any animation. Agent K composes the wheel spin
    /// on top of this and must not overwrite it.
    pub base_transformation: Mat4,
    /// The CPU mesh, kept so another module can rebuild this part with its own material.
    /// Agent J needs it to rebuild `Wall_Screen` with the screen material of `src/screen.rs`.
    pub cpu_mesh: CpuMesh,
    /// The GPU object drawn for this part.
    pub object: Gm<Mesh, StageMaterial>,
    /// Set to false to drop the part from the render list without deleting it.
    pub visible: bool,
}

/// The imported stage: every drawable part, plus the node transforms the meshes hang from.
///
/// The camera is deliberately *not* in here. `src/main.rs` keeps it in a sibling field of
/// `World` so it can be mutated for tone mapping while the parts are borrowed for the
/// render call. Build it with [`hero_camera`].
pub struct Stage {
    pub parts: Vec<Part>,
    /// World transform of every *named* node in the GLB, including the mesh-less pivots.
    nodes: HashMap<String, Mat4>,
    /// Indices into `parts` that hang below the wheel pivot node. Precomputed because
    /// agent K rotates exactly this set every frame.
    wheel: Vec<usize>,
}

impl Stage {
    /// Loads the model named by the manifest and builds one GPU object per primitive.
    pub fn load(context: &Context, manifest: &Manifest) -> crate::Result<Self> {
        let relative = if manifest.glb.is_empty() {
            MODEL_PATH
        } else {
            manifest.glb.as_str()
        };
        let path = crate::asset_path(relative);
        let cpu_scene: CpuScene = three_d_asset::io::load_and_deserialize(&path)
            .map_err(|e| crate::Error::from(format!("{}: {e}", path.display())))?;

        let materials: Vec<(String, PhysicalMaterial, Option<Vec3>)> = cpu_scene
            .materials
            .iter()
            .map(|m| {
                (
                    m.name.clone(),
                    physical_material(context, manifest, m),
                    manifest.material(&m.name).and_then(hdr_emissive),
                )
            })
            .collect();

        let walked = walk_scene(&cpu_scene);
        let mut parts = Vec::with_capacity(walked.parts.len());
        for named in walked.parts {
            let (material_name, inner, emissive_hdr) = named
                .material_index
                .and_then(|i| materials.get(i))
                .cloned()
                .unwrap_or_else(|| (String::new(), PhysicalMaterial::default(), None));
            let mut object = Gm::new(
                Mesh::new(context, &named.mesh),
                StageMaterial::new(inner, emissive_hdr),
            );
            object.set_transformation(named.transformation);
            parts.push(Part {
                name: named.name,
                material_name,
                node_path: named.node_path,
                base_transformation: named.transformation,
                cpu_mesh: named.mesh,
                object,
                visible: true,
            });
        }

        // The three nodes other modules look up by name, taken from the manifest rather than
        // written here: the spin pivot, the LED wall and the flapper hinge. A GLB without one of
        // them is a broken export, so this fails instead of rendering a scene with a piece
        // missing.
        let required = [
            manifest.wheel.pivot_node.as_str(),
            manifest.screen.node.as_str(),
            manifest.flapper.node.as_str(),
        ];
        let missing: Vec<&str> = required
            .iter()
            .copied()
            .filter(|n| !walked.nodes.contains_key(*n))
            .collect();
        if !missing.is_empty() {
            return Err(format!(
                "{} is missing the node(s) {:?}; re-run tools/export_gltf.py and \
                 tools/validate_export.py",
                path.display(),
                missing
            )
            .into());
        }

        let pivot = &manifest.wheel.pivot_node;
        let wheel: Vec<usize> = parts
            .iter()
            .enumerate()
            .filter(|(_, p)| p.node_path.iter().any(|n| n == pivot))
            .map(|(i, _)| i)
            .collect();

        let stage = Stage {
            parts,
            nodes: walked.nodes,
            wheel,
        };
        eprintln!(
            "loaded {}: {} parts, {} named nodes, {} materials, {} parts under {}",
            path.display(),
            stage.parts.len(),
            stage.nodes.len(),
            materials.len(),
            stage.wheel.len(),
            pivot
        );
        // A warning, not an error: the author edits the .blend while this runs, so a re-export
        // may legitimately change these counts before anyone updates the manifest. It is still
        // worth saying out loud, because every number in `assets/scene.json` was measured
        // against one particular export. `tools/validate_export.py` is the strict check.
        let audit = &manifest.glb_audit;
        if stage.parts.len() as u32 != audit.primitives || materials.len() as u32 != audit.materials
        {
            eprintln!(
                "warning: {} holds {} primitives and {} materials; assets/scene.json's \
                 glb_audit says {} and {}. Re-run tools/validate_export.py.",
                path.display(),
                stage.parts.len(),
                materials.len(),
                audit.primitives,
                audit.materials
            );
        }
        Ok(stage)
    }

    /// Every visible part, as one `Vec` for a single `render` call. Transparency is sorted
    /// inside `RenderTarget::render`, so all parts must go through one call or `MAT_Crystal`
    /// will not sort against the wheel behind it.
    pub fn objects(&self) -> Vec<&dyn Object> {
        self.parts
            .iter()
            .filter(|p| p.visible)
            .map(|p| &p.object as &dyn Object)
            .collect()
    }

    /// Index of the first part with this Blender object name.
    ///
    /// Returns `None` for a mesh-less node such as `Wheel_Root`: it exists in the tree but
    /// never as a primitive. Use [`Stage::node_transform`] for those.
    pub fn index_of(&self, name: &str) -> Option<usize> {
        self.parts.iter().position(|p| p.name == name)
    }

    /// Indices of every part whose Blender object name starts with `prefix`.
    pub fn indices_with_prefix(&self, prefix: &str) -> Vec<usize> {
        self.parts
            .iter()
            .enumerate()
            .filter(|(_, p)| p.name.starts_with(prefix))
            .map(|(i, _)| i)
            .collect()
    }

    /// Indices of every part built from this Blender material.
    pub fn indices_with_material(&self, material_name: &str) -> Vec<usize> {
        self.parts
            .iter()
            .enumerate()
            .filter(|(_, p)| p.material_name == material_name)
            .map(|(i, _)| i)
            .collect()
    }

    /// Indices of every part in the subtree of the named node, itself included.
    ///
    /// Exact where a name prefix is not: `indices_under("Wheel_Root")` leaves out the four
    /// `Wheel_*` objects that hang off `Wheel_Stand`.
    pub fn indices_under(&self, node_name: &str) -> Vec<usize> {
        self.parts
            .iter()
            .enumerate()
            .filter(|(_, p)| p.node_path.iter().any(|n| n == node_name))
            .map(|(i, _)| i)
            .collect()
    }

    /// The parts that turn with the wheel: the subtree of `Wheel_Root`, precomputed at load.
    /// Agent K rotates exactly these about the pivot.
    pub fn wheel_indices(&self) -> &[usize] {
        &self.wheel
    }

    /// World transform of a named node as the GLB holds it, mesh-less pivots included.
    /// `node_transform("Wheel_Root")` is the translation `(0, 3.5, -1.2)`.
    pub fn node_transform(&self, name: &str) -> Option<Mat4> {
        self.nodes.get(name).copied()
    }

    /// World position of a named node.
    pub fn node_position(&self, name: &str) -> Option<Vec3> {
        self.node_transform(name)
            .map(|m| (m * vec4(0.0, 0.0, 0.0, 1.0)).truncate())
    }

    /// Whether the GLB carried a node with this name.
    pub fn has_node(&self, name: &str) -> bool {
        self.nodes.contains_key(name)
    }

    /// The axis-aligned bounding box of every visible part, in world space. Used to check
    /// that the import put the stage where `wheel_stage.blend` has it.
    pub fn aabb(&self) -> AxisAlignedBoundingBox {
        let mut bounds = AxisAlignedBoundingBox::EMPTY;
        for part in self.parts.iter().filter(|p| p.visible) {
            bounds.expand_with_aabb(part.object.aabb());
        }
        bounds
    }
}

/// A primitive pulled out of the `Scene` tree with its world transform resolved.
pub struct NamedPart {
    pub name: String,
    /// Named nodes from the root down to this primitive's own node, inclusive.
    pub node_path: Vec<String>,
    /// World transform, already accumulated down the tree.
    pub transformation: Mat4,
    /// Index into `CpuScene::materials`.
    pub material_index: Option<usize>,
    pub mesh: CpuMesh,
}

/// Everything one walk of the imported tree yields.
pub struct WalkedScene {
    /// One entry per glTF primitive.
    pub parts: Vec<NamedPart>,
    /// World transform of every named node, mesh-less ones included.
    pub nodes: HashMap<String, Mat4>,
}

/// Flattens the imported scene tree, keeping the nearest named ancestor of each primitive
/// and the world transform of every named node.
pub fn walk_scene(scene: &CpuScene) -> WalkedScene {
    let mut walked = WalkedScene {
        parts: Vec::new(),
        nodes: HashMap::new(),
    };
    for child in &scene.children {
        walk(child, Mat4::identity(), &scene.name, &[], &mut walked);
    }
    walked
}

fn walk(node: &Node, parent: Mat4, inherited: &str, path: &[String], out: &mut WalkedScene) {
    let world = parent * node.transformation;
    // three-d-asset names every primitive node "node", so keep the nearest named ancestor.
    let named = node.name != "node";
    let name = if named { node.name.as_str() } else { inherited };
    let mut path_here = path.to_vec();
    if named {
        out.nodes.insert(node.name.clone(), world);
        path_here.push(node.name.clone());
    }
    if let Some(CpuGeometry::Triangles(mesh)) = &node.geometry {
        out.parts.push(NamedPart {
            name: name.to_string(),
            node_path: path_here.clone(),
            transformation: world,
            material_index: node.material_index,
            mesh: mesh.clone(),
        });
    }
    for child in &node.children {
        walk(child, world, name, &path_here, out);
    }
}

/// Builds the GPU material for one imported material, correcting it against the manifest's
/// table. See the module docs for what the import gets wrong and why.
fn physical_material(
    context: &Context,
    manifest: &Manifest,
    cpu_material: &CpuMaterial,
) -> PhysicalMaterial {
    let mut material = PhysicalMaterial::new(context, cpu_material);
    let Some(spec) = manifest.material(&cpu_material.name) else {
        eprintln!(
            "warning: material {:?} is in the GLB but not in assets/scene.json; \
             using the imported values",
            cpu_material.name
        );
        return material;
    };
    if std::env::var_os("GS_MATERIAL_AUDIT").is_some() {
        audit(cpu_material, &material, spec);
    }

    // Linear to sRGB-encoded, because `use_uniforms` sends `albedo.to_linear_srgb()`.
    //
    // A material whose Base Color comes from an image keeps the image. The shader multiplies
    // `albedo` by `albedoTexture`, so writing the manifest's flat colour over it would stain
    // the picture. `MAT_LED_Screen` is the only one: an Image Texture node holding
    // `T_LEDWall_Sky` feeds its Base Color and its Emission Color, and its `base_color`
    // `(0.35, 0.3, 0.6)` in the manifest is the value the node had before the texture was
    // wired up. `PhysicalMaterial::new` has already decoded the texture to linear sRGB.
    material.albedo = if material.albedo_texture.is_some() {
        Srgba::new(255, 255, 255, alpha_byte(spec.alpha))
    } else {
        linear_to_srgba(spec.base_color, spec.alpha)
    };
    // The manifest's own two floats, with no override of either. `glb_metallic` and
    // `glb_roughness` in `assets/scene.json` equal `metallic` and `roughness` on all 19
    // materials, so the import already carries them; re-applying them keeps one table the only
    // authority instead of two that agree today.
    material.metallic = spec.metallic;
    material.roughness = spec.roughness;
    // `Srgba` is four u8s and saturates at linear 1.0, so MAT_Bulb_Glass (3.0) and
    // MAT_Lens_Glow (6.0) come out as the fully saturated colour. That is deliberate:
    // the headroom above 1.0 belongs to the HDR target and the bloom pass in
    // `src/postfx.rs` (`docs/three_d_api.md` §5, option a).
    //
    // With an emissive texture the shader multiplies by it, so the factor is white when the
    // material glows at all and black when it does not. `MAT_LED_Screen` is the only textured
    // one; its Blender emission is `T_LEDWall_Sky * 1.5`, and the 0.5 above the `Srgba`
    // ceiling is again postfx's headroom.
    material.emissive = match (material.emissive_texture.is_some(), spec.emits()) {
        (true, true) => Srgba::new(255, 255, 255, 255),
        (true, false) => Srgba::new(0, 0, 0, 255),
        (false, _) => linear_to_srgba(spec.effective_emission, 1.0),
    };

    if spec.is_blend() {
        // `MAT_Crystal`, alpha 0.55, is the only one. Both flags must agree: `is_transparent`
        // drives `material_type()`, which is what `cmp_render_order` sorts on, and the render
        // states are what actually blend. No depth write, or a crystal facet would occlude
        // the facet behind it.
        material.is_transparent = true;
        material.render_states.write_mask = WriteMask::COLOR;
        material.render_states.blend = Blend::TRANSPARENCY;
        material.render_states.depth_test = DepthTest::Less;
    } else {
        // The importer guesses transparency from the albedo alpha byte. Undo the guess
        // wherever the manifest says the material is opaque.
        material.is_transparent = false;
        material.render_states.write_mask = WriteMask::COLOR_AND_DEPTH;
        material.render_states.blend = Blend::Disabled;
    }
    material
}

/// Prints what the GLB carried next to what the manifest applied, for one material.
fn audit(cpu_material: &CpuMaterial, imported: &PhysicalMaterial, spec: &MaterialSpec) {
    let a = imported.albedo;
    let e = imported.emissive;
    let want_albedo = if imported.albedo_texture.is_some() {
        Srgba::new(255, 255, 255, alpha_byte(spec.alpha))
    } else {
        linear_to_srgba(spec.base_color, spec.alpha)
    };
    let want_emissive = match (imported.emissive_texture.is_some(), spec.emits()) {
        (true, true) => Srgba::new(255, 255, 255, 255),
        (true, false) => Srgba::new(0, 0, 0, 255),
        (false, _) => linear_to_srgba(spec.effective_emission, 1.0),
    };
    eprintln!(
        "audit {:<20} textures albedo {:<5} emissive {:<5} | glb albedo \
         ({:3},{:3},{:3},{:3}) metallic {:.2} roughness {:.2} \
         emissive ({:3},{:3},{:3}) transparent {:<5} | applied albedo \
         ({:3},{:3},{:3},{:3}) metallic {:.2} roughness {:.2} emissive ({:3},{:3},{:3}) \
         blend {}",
        cpu_material.name,
        imported.albedo_texture.is_some(),
        imported.emissive_texture.is_some(),
        a.r,
        a.g,
        a.b,
        a.a,
        imported.metallic,
        imported.roughness,
        e.r,
        e.g,
        e.b,
        imported.is_transparent,
        want_albedo.r,
        want_albedo.g,
        want_albedo.b,
        want_albedo.a,
        spec.metallic,
        spec.roughness,
        want_emissive.r,
        want_emissive.g,
        want_emissive.b,
        spec.is_blend(),
    );
}

/// Linear sRGB in [0,1] to an `Srgba` that decodes back to the same linear value.
///
/// `PhysicalMaterial::use_uniforms` sends `albedo.to_linear_srgb()`, which applies the
/// sRGB decode curve. Feeding a linear value in raw decodes it twice and comes out dark.
/// Check values: `(0.72, 0.52, 0.18)` -> `(221, 191, 118)`,
/// `(0.055, 0.05, 0.075)` -> `(66, 63, 77)`, `(0.92, 0.05, 0.42)` -> `(246, 63, 173)`.
/// Values above 1.0 saturate; `src/postfx.rs` owns the headroom above that ceiling.
pub fn linear_to_srgba(rgb: [f32; 3], alpha: f32) -> Srgba {
    let enc = |c: f32| {
        let s = if c <= 0.003_130_8 {
            12.92 * c
        } else {
            1.055 * c.powf(1.0 / 2.4) - 0.055
        };
        (s.clamp(0.0, 1.0) * 255.0).round() as u8
    };
    Srgba::new(enc(rgb[0]), enc(rgb[1]), enc(rgb[2]), alpha_byte(alpha))
}

/// Alpha in [0,1] to the byte `Srgba` holds. Alpha is linear, never sRGB-encoded.
pub fn alpha_byte(alpha: f32) -> u8 {
    (alpha.clamp(0.0, 1.0) * 255.0).round() as u8
}

/// `Cam_Hero`, exactly: eye, look-at target and field of view straight from the manifest.
///
/// Up is world up `(0, 1, 0)` rather than the camera's own up vector. The two give the same
/// basis — `Cam_Hero` has no roll, and `set_view` orthogonalises whatever it is given — and
/// world up is what `OrbitControl::rotate_around_with_fixed_up` then keeps fixed.
pub fn hero_camera(manifest: &Manifest, viewport: Viewport) -> Camera {
    let spec = &manifest.camera;
    Camera::new_perspective(
        viewport,
        spec.position(),
        spec.target(),
        WORLD_UP,
        fov_y_for_aspect(manifest, aspect_of(viewport)),
        spec.z_near,
        spec.z_far,
    )
}

/// Puts an existing camera back on the hero view, keeping its current viewport.
pub fn reset_to_hero(camera: &mut Camera, manifest: &Manifest) {
    let spec = &manifest.camera;
    camera.set_view(spec.position(), spec.target(), WORLD_UP);
    fit_projection(camera, manifest);
}

/// Re-derives the projection for the camera's current viewport.
///
/// `Camera::set_viewport` preserves the *vertical* field of view, so a window that is not
/// 1672x941 would crop or widen the sides. Blender's sensor fit is `HORIZONTAL`, so the
/// horizontal field of view is the thing to hold: call this after every viewport change.
pub fn fit_projection(camera: &mut Camera, manifest: &Manifest) {
    let spec = &manifest.camera;
    let fov_y = fov_y_for_aspect(manifest, aspect_of(camera.viewport()));
    camera.set_perspective_projection(fov_y, spec.z_near, spec.z_far);
}

/// The vertical field of view that holds `Cam_Hero`'s horizontal framing at `aspect`.
///
/// At the render aspect 1.77683316 the manifest's own `fov_y_rad` is returned bit for bit,
/// so `--shot` renders the hero view exactly. Away from it,
/// `fov_y = 2 * atan(tan(fov_x / 2) / aspect)`.
pub fn fov_y_for_aspect(manifest: &Manifest, aspect: f32) -> Radians {
    let spec = &manifest.camera;
    if (aspect - manifest.render.aspect).abs() < 1.0e-4 {
        return radians(spec.fov_y_rad);
    }
    radians(2.0 * ((spec.fov_x_rad * 0.5).tan() / aspect.max(1.0e-6)).atan())
}

/// `width / height` of a viewport, guarding the degenerate zero-height case that a
/// minimised window can produce.
fn aspect_of(viewport: Viewport) -> f32 {
    if viewport.height == 0 {
        1.0
    } else {
        viewport.width as f32 / viewport.height as f32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The three check values in `docs/three_d_api.md` §2, computed there independently.
    #[test]
    fn linear_to_srgba_matches_the_documented_values() {
        assert_eq!(
            linear_to_srgba([0.72, 0.52, 0.18], 1.0),
            Srgba::new(221, 191, 118, 255)
        );
        assert_eq!(
            linear_to_srgba([0.055, 0.05, 0.075], 1.0),
            Srgba::new(66, 63, 77, 255)
        );
        assert_eq!(
            linear_to_srgba([0.92, 0.05, 0.42], 1.0),
            Srgba::new(246, 63, 173, 255)
        );
        // Emission above 1.0 saturates; postfx owns the headroom.
        assert_eq!(
            linear_to_srgba([6.0, 5.7, 4.92], 1.0),
            Srgba::new(255, 255, 255, 255)
        );
        // Alpha is linear: MAT_Crystal's 0.55.
        assert_eq!(linear_to_srgba([0.0, 0.0, 0.0], 0.55).a, 140);
    }

    /// `--shot` renders at the manifest's own aspect, where the FOV must be the manifest's
    /// value bit for bit. Away from it the horizontal framing is what is held.
    #[test]
    fn fov_holds_the_horizontal_framing_off_aspect() {
        let manifest = Manifest::load(crate::asset_path(crate::manifest::MANIFEST_PATH))
            .expect("assets/scene.json");
        let render = Viewport::new_at_origo(crate::RENDER_WIDTH, crate::RENDER_HEIGHT);
        assert_eq!(
            fov_y_for_aspect(&manifest, aspect_of(render)).0,
            manifest.camera.fov_y_rad
        );

        // Half as wide: the same horizontal FOV needs twice the tangent vertically.
        let fov_y = fov_y_for_aspect(&manifest, manifest.render.aspect * 0.5).0;
        let want = 2.0 * ((manifest.camera.fov_x_rad * 0.5).tan() / (manifest.render.aspect * 0.5)).atan();
        assert!((fov_y - want).abs() < 1.0e-6, "{fov_y} vs {want}");
        assert!(fov_y > manifest.camera.fov_y_rad);
    }

    /// The hero camera is the manifest's camera, with no conversion applied on the way.
    #[test]
    fn hero_camera_uses_the_manifest_verbatim() {
        let manifest = Manifest::load(crate::asset_path(crate::manifest::MANIFEST_PATH))
            .expect("assets/scene.json");
        let viewport = Viewport::new_at_origo(crate::RENDER_WIDTH, crate::RENDER_HEIGHT);
        // No GPU needed: Camera is CPU-side maths.
        let camera = hero_camera(&manifest, viewport);
        // Every operand comes out of the manifest. Literals here would restate the manifest
        // and pass while the render diverged, which is what this test exists to catch.
        assert_eq!(camera.position(), Vec3::from(manifest.camera.position));
        assert_eq!(camera.target(), Vec3::from(manifest.camera.target));
        assert_eq!(camera.z_near(), manifest.camera.z_near);
        assert_eq!(camera.z_far(), manifest.camera.z_far);
        let forward = (camera.target() - camera.position()).normalize();
        let want = Vec3::from(manifest.camera.forward);
        assert!((forward - want).magnitude() < 1.0e-6, "{forward:?} vs {want:?}");
    }
}
