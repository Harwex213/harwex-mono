//! Serde types for `assets/scene.json`.
//!
//! Owner: agent G.
//!
//! The manifest carries everything the `.glb` cannot: the camera, the six lights, the
//! authoritative material table, the spin pivot and the flapper geometry. `three-d-asset`
//! 0.10 reads neither cameras nor lights out of a glTF file (`docs/three_d_api.md` §2), so
//! this file is mandatory, not a convenience.
//!
//! # Frames
//!
//! **Every vector at the top level of `assets/scene.json` is already in the exported glTF
//! +Y-up frame**, the same frame as the geometry in `assets/wheel_stage.glb`. That is
//! option A of `docs/export_notes.md` §4, and the file says so in its own `doc` block and
//! in `vectors_in: "gltf_y_up"`. `up_axis: "Y"` describes the geometry; it does *not* mean
//! a Blender-to-glTF conversion is still owed.
//!
//! The Blender Z-up source numbers sit beside each entry under a `blender` object, for
//! cross-checking against `docs/agent_plan.md` and `docs/scene_audit.md`, which are Z-up.
//! They are parsed into [`CameraBlender`], [`LightBlender`], [`WheelBlender`] and
//! [`FlapperBlender`] and are *not* used to build anything.
//!
//! [`Manifest::to_scene_point`] and [`Manifest::to_scene_dir`] exist for callers that hold
//! a *Blender-frame* value. With `vectors_in: gltf_y_up` they are the identity on anything
//! that came out of this file, so passing a top-level vector through them is harmless but
//! pointless; passing a `blender` value through them converts it.
//!
//! # What is parsed
//!
//! Every key that carries data. The prose arrays (`doc`, `notes`, `lighting_notes`,
//! `material_notes`, `crop_notes`, `serde_hint`) are ignored: serde skips unknown keys, so
//! adding or editing a note never breaks the load. There is no `Default` impl on purpose —
//! `assets/scene.json` is the single source of these numbers, and a fallback copy of them
//! in Rust would silently diverge from the export.
//!
//! A few keys the manifest records purely for cross-checking are also skipped, for the same
//! reason a `Default` impl is: a field nothing reads is dead weight. `camera.blender.angle_y_rad`,
//! `wheel.blender.rotation_euler` and `flapper.blender.local_min` / `local_max` are in the file
//! and not in these structs.
//!
//! # The manifest is the single source of the material table
//!
//! `assets/scene.json` was regenerated in the cleanup pass of 2026-07-30 from two ground
//! truths and nothing else: a read-only `blender --background` run over `wheel_stage.blend`,
//! and a parse of `assets/wheel_stage.glb`. No look-dev value survives in it. Every field of
//! [`MaterialSpec`] is what the .blend holds, so a constant in Rust that duplicates one of
//! them is a defect even when the two agree — they will drift.
//!
//! The `glb_*` fields of [`MaterialSpec`] say what glTF transport actually did to each value.
//! `glb_base_color_factor`, `glb_metallic` and `glb_roughness` equal the .blend's own
//! `base_color`, `metallic` and `roughness` for all 19 materials, so transport loses none of
//! the three and no per-node override of them can be justified as a repair. What transport
//! does lose is emission: the exporter normalises the emissive factor to a maximum of 1 and
//! puts the rest into `KHR_materials_emissive_strength`, which `three-d-asset` 0.10 ignores.

use serde::{Deserialize, Serialize};
use std::path::Path;
use three_d::*;

/// Path of the manifest, relative to the crate root. Resolve it with [`crate::asset_path`].
pub const MANIFEST_PATH: &str = "assets/scene.json";

/// Which axis points up in the exported geometry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum UpAxis {
    /// The exporter's Y-up conversion ran: Blender `(x, y, z)` became `(x, z, -y)`.
    /// `docs/export_notes.md` §3 confirms `export_yup=True`.
    Y,
    /// The geometry is still in Blender's Z-up frame.
    Z,
}

/// Which frame the top-level vectors of the manifest are written in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VectorFrame {
    /// Same frame as the geometry in the GLB. Nothing to convert.
    #[serde(rename = "gltf_y_up")]
    GltfYUp,
    /// Blender's own Z-up frame. Needs [`Manifest::to_scene_point`].
    #[serde(rename = "blender_z_up")]
    BlenderZUp,
}

/// Blender render settings, for the shot resolution and the world background.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderSpec {
    pub width: u32,
    pub height: u32,
    /// `width / height` = 1.77683316. The hero FOV is only exact at this aspect.
    pub aspect: f32,
    /// Blender view transform, `Filmic`. `src/postfx.rs` owns the tone map.
    pub view_transform: String,
    pub exposure: f32,
    /// Linear RGB of the plain world background. No HDRI in the scene.
    pub world_background: [f32; 3],
    pub world_strength: f32,
}

impl RenderSpec {
    /// The world background as a linear RGB vector.
    pub fn background(&self) -> Vec3 {
        Vec3::from(self.world_background) * self.world_strength
    }
}

/// `Cam_Hero`, in the glTF frame, already reduced to what `Camera::new_perspective` wants.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CameraSpec {
    /// Blender object name, `Cam_Hero`.
    pub name: String,
    /// Eye position, glTF frame.
    pub position: [f32; 3],
    /// The point on the camera axis closest to `Wheel_Root`. `look_at(position, target,
    /// (0, 1, 0))` reproduces Cam_Hero's framing exactly.
    pub target: [f32; 3],
    /// The camera's own up vector, glTF frame. Not needed for `look_at`: world up
    /// `(0, 1, 0)` gives the same basis, because the camera has no roll.
    pub up: [f32; 3],
    /// View direction, glTF frame.
    pub forward: [f32; 3],
    /// `|target - position|` = 7.994683 m. The orbit radius of the hero view.
    pub orbit_radius: f32,
    pub fov_y_deg: f32,
    /// Vertical field of view in radians at [`RenderSpec::aspect`]. 0.8630564, which is also
    /// the `yfov` the exporter wrote into the GLB, recorded as `glb_yfov_rad`.
    pub fov_y_rad: f32,
    pub z_near: f32,
    pub z_far: f32,
    pub lens_mm: f32,
    /// `HORIZONTAL`, so the 36 mm sensor spans the width. Blender's `camera.angle_y` is
    /// wrong for this fit; see the manifest's own note.
    pub sensor_fit: String,
    pub sensor_width_mm: f32,
    /// Horizontal field of view in radians, 1.371459. Hold this, not `fov_y_rad`, to keep
    /// the framing when the window aspect changes.
    pub fov_x_rad: f32,
    /// The `yfov` the exporter wrote into the GLB. Equal to `fov_y_rad`; recorded so a test
    /// can prove the derivation and the export agree.
    pub glb_yfov_rad: f32,
    /// The `aspectRatio` the exporter wrote into the GLB. Equal to [`RenderSpec::aspect`].
    pub glb_aspect_ratio: f32,
    /// The Blender Z-up source values, for cross-checking only.
    pub blender: CameraBlender,
}

impl CameraSpec {
    /// Eye position in the glTF frame.
    pub fn position(&self) -> Vec3 {
        Vec3::from(self.position)
    }

    /// Look-at target in the glTF frame.
    pub fn target(&self) -> Vec3 {
        Vec3::from(self.target)
    }

    /// The camera's own up vector in the glTF frame.
    pub fn up(&self) -> Vec3 {
        Vec3::from(self.up)
    }

    /// View direction in the glTF frame.
    pub fn forward(&self) -> Vec3 {
        Vec3::from(self.forward)
    }
}

/// `Cam_Hero` as Blender states it, Z-up. Recorded, never used to build the camera.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CameraBlender {
    pub location: [f32; 3],
    /// Euler XYZ, radians.
    pub rotation_euler: [f32; 3],
    pub forward: [f32; 3],
    pub up: [f32; 3],
    pub target: [f32; 3],
}

/// One Blender light, in the glTF frame.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LightSpec {
    /// Blender object name, e.g. `Key_Wheel`.
    pub name: String,
    /// Blender light type: `AREA` or `SPOT` in this scene. Renamed from the JSON key
    /// `type`, which is a Rust keyword.
    #[serde(rename = "type")]
    pub kind: String,
    /// Position, glTF frame.
    pub position: [f32; 3],
    /// The direction the light points, normalised, glTF frame. Blender and glTF punctual
    /// lights both emit down local -Z, so this needs no sign flip.
    pub direction: [f32; 3],
    /// Linear RGB. `three-d` light colours are `Srgba`; encode with
    /// [`crate::scene::linear_to_srgba`].
    #[serde(rename = "energy_watts")]
    pub energy: f32,
    pub color: [f32; 3],
    /// Full edge length of a SQUARE AREA light, in metres. Zero for SPOT.
    pub size: f32,
    /// Blender area shape, `SQUARE` on all four AREA lights. Empty for SPOT.
    pub shape: String,
    /// Blender `spot_size`, the FULL cone angle, radians. Zero for AREA.
    #[serde(rename = "spot_size_rad")]
    pub spot_size: f32,
    /// Blender spot blend, 0..1.
    pub spot_blend: f32,
    /// `spot_size / 2`. This is what `SpotLight::cutoff` wants.
    pub cone_outer_half_angle_rad: f32,
    /// `outer * (1 - blend)`.
    pub cone_inner_half_angle_rad: f32,
    /// Blender's own shadow flag, true on all six. Which lights actually get a shadow map is
    /// `src/lighting.rs`'s decision, because `three-d` takes one map per light.
    pub casts_shadow: bool,
    /// False for the four AREA lights: `KHR_lights_punctual` has no area light, so the
    /// exporter wrote their nodes without light data.
    pub in_glb: bool,
    /// Candela written into the GLB for the two spots. Traceability only — never feed it
    /// to `three-d`, whose intensity is a dimensionless multiplier.
    pub exported_candela: f32,
    /// The Blender Z-up source values, for cross-checking only.
    pub blender: LightBlender,
}

impl LightSpec {
    /// Position in the glTF frame.
    pub fn position(&self) -> Vec3 {
        Vec3::from(self.position)
    }

    /// The direction the light points, in the glTF frame, normalised.
    pub fn direction(&self) -> Vec3 {
        let d = Vec3::from(self.direction);
        if d.magnitude() > 0.0 {
            d.normalize()
        } else {
            vec3(0.0, -1.0, 0.0)
        }
    }
}

/// One Blender light as Blender states it, Z-up. Recorded, never used to build a light.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LightBlender {
    pub location: [f32; 3],
    /// Euler XYZ, radians.
    pub rotation_euler: [f32; 3],
    pub direction: [f32; 3],
}

/// One Blender material, exactly as the .blend's Principled BSDF holds it. Authoritative:
/// nothing in Rust may hold a second copy of any of these numbers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MaterialSpec {
    pub name: String,
    /// Linear RGB. `PhysicalMaterial::albedo` is sRGB-encoded — encode before assigning.
    /// On a material whose Base Color is textured this is the socket default *behind* the
    /// image, so it is the fallback and not the picture. See [`MaterialSpec::is_textured`].
    pub base_color: [f32; 3],
    pub metallic: f32,
    pub roughness: f32,
    /// Below 1.0 only on `MAT_Crystal`.
    pub alpha: f32,
    /// `OPAQUE` or `BLEND`, as the GLB declares it. `MAT_Crystal` is the only `BLEND`.
    /// Blender 5's `material.blend_method` reads `HASHED` on all 19 and is no signal.
    pub alpha_mode: String,
    pub emission_strength: f32,
    /// Linear RGB. Also a socket default behind an image when `emission_texture` is set.
    pub emission_color: [f32; 3],
    /// `emission_color * emission_strength`, linear RGB. The radiance the Blender shader
    /// emits, and the one to use for a material with no emission texture.
    pub effective_emission: [f32; 3],
    /// Blender image driving Base Color, empty when the socket holds a flat colour.
    /// `T_LEDWall_Sky` on `MAT_LED_Screen`, which is the only textured material.
    pub base_color_texture: String,
    /// Blender image driving Emission Color, empty when the socket holds a flat colour.
    pub emission_texture: String,
    /// The mesh UV layer the texture is addressed through, `UVMap`. Empty when untextured.
    pub uv_map: String,
    /// Every object and slot in the .blend that carries this material. Read this instead of
    /// hardcoding a node name: `MAT_Metal_Polished` carries `Wheel_Hub`, and
    /// `MAT_LED_Screen` carries `Podium_Riser` as well as `Wall_Screen`.
    pub used_by: Vec<MaterialUse>,
    /// RGBA `baseColorFactor` in the GLB. Equal to `base_color` plus `alpha` on every
    /// untextured material, and `(1, 1, 1, 1)` on the textured one.
    pub glb_base_color_factor: [f32; 4],
    /// `metallicFactor` in the GLB. Equal to `metallic` on all 19.
    pub glb_metallic: f32,
    /// `roughnessFactor` in the GLB. Equal to `roughness` on all 19.
    pub glb_roughness: f32,
    /// `alphaMode` in the GLB, where `alpha_mode` comes from.
    pub glb_alpha_mode: String,
    /// What the GLB holds. The exporter normalised the factor to a maximum of 1 and put the
    /// rest into `KHR_materials_emissive_strength`, which `three-d-asset` ignores.
    pub glb_emissive_factor: [f32; 3],
    /// The strength that goes with `glb_emissive_factor`.
    pub glb_emissive_strength: f32,
    /// True when the GLB gives this material a `baseColorTexture`.
    pub glb_has_base_color_texture: bool,
    /// True when the GLB gives this material an `emissiveTexture`.
    pub glb_has_emissive_texture: bool,
}

/// One object slot that carries a material.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MaterialUse {
    /// Blender object name, e.g. `Wall_Screen`.
    pub node: String,
    /// Material slot index on that object.
    pub slot: u32,
}

impl MaterialSpec {
    /// True when the material glows.
    pub fn emits(&self) -> bool {
        self.emission_strength > 0.0 && self.effective_emission.iter().any(|c| *c > 0.0)
    }

    /// True when the material must be blended rather than written opaquely.
    pub fn is_blend(&self) -> bool {
        self.alpha_mode == "BLEND" || self.alpha < 1.0
    }

    /// True when an image, not a flat colour, drives Base Color or Emission Color.
    /// The shader multiplies the factor by the image, so writing a flat colour over one
    /// stains the picture.
    pub fn is_textured(&self) -> bool {
        !self.base_color_texture.is_empty() || !self.emission_texture.is_empty()
    }

    /// The radiance that has to reach the frame, linear RGB.
    ///
    /// `effective_emission` for an opaque material. A blended one is multiplied by its own
    /// alpha by `Blend::TRANSPARENCY`, emission included, so `MAT_Crystal` at alpha 0.55
    /// would otherwise put only 55% of its declared radiance on the frame. Meaningless for a
    /// material with an emission texture, where the radiance is the image times
    /// `emission_strength`.
    pub fn emitted_radiance(&self) -> Vec3 {
        let e = Vec3::from(self.effective_emission);
        if self.is_blend() {
            e / self.alpha.clamp(0.05, 1.0)
        } else {
            e
        }
    }

    /// True when this material is on that object, whatever the slot.
    pub fn is_on(&self, node: &str) -> bool {
        self.used_by.iter().any(|u| u.node == node)
    }
}

/// The one image the .blend uses, as the .blend and the GLB both hold it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextureSpec {
    /// Blender image name, `T_LEDWall_Sky`, which is also the GLB image name.
    pub name: String,
    /// The source PNG, relative to the monorepo root. Authored by the scene's author; it is
    /// not in this crate, and the app never reads it — the GLB carries the pixels.
    pub source_png: String,
    pub width: u32,
    pub height: u32,
    /// Blender colour space, `sRGB`.
    pub colorspace: String,
    pub mime_type: String,
    /// True when the GLB embeds the pixels in its binary chunk, as this one does.
    pub embedded_in_glb: bool,
    /// The GLB texture indices that point at this image: `[0, 1]`, one per sampler use.
    pub glb_texture_indices: Vec<u32>,
    /// Blender's Image Texture extension, `REPEAT`.
    pub wrap: String,
    /// Blender's Image Texture interpolation, `Linear`.
    pub interpolation: String,
    /// The UV layer the texture is addressed through, `UVMap`.
    pub uv_map: String,
}

/// The LED wall: which node shows the author's sky, and how.
///
/// The .blend drives `MAT_LED_Screen`'s Base Color and Emission Color from `T_LEDWall_Sky`
/// through a UV Map node, and the fixed export carries the image. So the texture is the
/// primary path: show it as the mesh's own `uv_map` addresses it, with no re-windowing, no
/// magnification and no per-side grade, because none of that is in the scene.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenSpec {
    /// The object the sky belongs to, `Wall_Screen`.
    pub node: String,
    /// Its material, `MAT_LED_Screen`.
    pub material: String,
    /// The image driving it, `T_LEDWall_Sky`.
    pub texture: String,
    /// The UV layer that addresses the image, `UVMap`.
    pub uv_map: String,
    /// Blender emission strength, 1.5, which is also what the GLB declares.
    pub emission_strength: f32,
    /// True when the GLB carries the image, as it now does.
    pub in_glb: bool,
    /// Other objects on the same material: `Podium_Riser`. Bind a screen-specific treatment
    /// by object, never by material name alone, or the podium riser gets painted with sky.
    pub also_on: Vec<String>,
}

/// The spinning part of the wheel. Vectors are glTF frame.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WheelSpec {
    /// The mesh-less pivot node, `Wheel_Root`.
    pub pivot_node: String,
    /// World position of `Wheel_Root`, glTF frame: `(0, 3.5, -1.2)`.
    pub pivot: [f32; 3],
    /// Spin axis, glTF frame: `(0, 0, -1)`, i.e. Blender +Y. Renamed from `spin_axis`.
    /// A rotation of `phi` about Blender +Y equals `Rz(-phi)` in glTF; positive `phi` reads
    /// clockwise from the hero camera in both frames.
    #[serde(rename = "spin_axis")]
    pub axis: [f32; 3],
    /// Children of `Wheel_Root` in the GLB: 56.
    pub child_count: u32,
    pub sector_count: u32,
    pub sector_pitch_deg: f32,
    /// Pegs on the rim: 48. The flapper ticks once per peg.
    pub peg_count: u32,
    /// Radius of the peg-body island centres, 2.245 m.
    pub peg_ring_radius: f32,
    /// Inner radius of a peg body, 2.189 m.
    pub peg_inner_radius: f32,
    /// Outer radius of a peg body, 2.301 m.
    pub peg_outer_radius: f32,
    pub peg_pitch_deg: f32,
    /// Angle of peg 0, 3.75 deg: the pegs sit on the sector boundaries.
    pub peg_first_angle_deg: f32,
    /// Radial span of a peg body, `peg_outer_radius - peg_inner_radius`.
    pub peg_stud_size: f32,
    /// Idle spin rate, radians per second. A look-dev choice, not a measurement;
    /// `src/spin.rs` owns it. Renamed from `idle_rate_rad_per_s`.
    #[serde(rename = "idle_rate_rad_per_s")]
    pub rate: f32,
    /// The Blender Z-up source values, for cross-checking only.
    pub blender: WheelBlender,
}

impl WheelSpec {
    /// Pivot in the glTF frame.
    pub fn pivot(&self) -> Vec3 {
        Vec3::from(self.pivot)
    }

    /// Spin axis in the glTF frame, normalised.
    pub fn axis(&self) -> Vec3 {
        let a = Vec3::from(self.axis);
        if a.magnitude() > 0.0 {
            a.normalize()
        } else {
            vec3(0.0, 0.0, -1.0)
        }
    }
}

/// `Wheel_Root` as Blender states it, Z-up.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WheelBlender {
    pub pivot: [f32; 3],
    pub spin_axis: [f32; 3],
}

/// `Pointer_Flapper`, the blade that ticks against the pegs. Vectors are glTF frame.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlapperSpec {
    /// Blender object name, `Pointer_Flapper`.
    pub node: String,
    /// Its parent, `Crest_Root`, which does not spin.
    pub parent: String,
    /// Hinge position in world space, glTF frame: `(0, 6.22, -0.795)`.
    pub pivot: [f32; 3],
    /// Its local translation under `Crest_Root`, glTF frame.
    pub local_translation: [f32; 3],
    /// Deflection axis, glTF frame: the same axis the wheel spins about.
    pub deflection_axis: [f32; 3],
    /// Hinge-to-tip distance, 1.132 m.
    pub blade_length: f32,
    pub striker_lever_arm: f32,
    /// Distance from the hinge to `Wheel_Root`, 2.75 m.
    pub hinge_to_wheel_centre: f32,
    /// The deflection at which the striker tab clears a peg tip, 32.2 deg. An upper bound
    /// on a tick amplitude, not a target.
    pub clearance_deflection_deg: f32,
    /// The Blender Z-up source values, for cross-checking only.
    pub blender: FlapperBlender,
}

impl FlapperSpec {
    /// Hinge position in the glTF frame.
    pub fn pivot(&self) -> Vec3 {
        Vec3::from(self.pivot)
    }

    /// Deflection axis in the glTF frame, normalised.
    pub fn axis(&self) -> Vec3 {
        let a = Vec3::from(self.deflection_axis);
        if a.magnitude() > 0.0 {
            a.normalize()
        } else {
            vec3(0.0, 0.0, -1.0)
        }
    }
}

/// `Pointer_Flapper` as Blender states it, Z-up.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlapperBlender {
    pub pivot: [f32; 3],
    pub local_translation: [f32; 3],
    pub deflection_axis: [f32; 3],
}

/// One crop rectangle at 1672x941. `x, y` is the top-left corner and y grows downward.
///
/// `src/shot.rs` cuts `--crops` from these and holds no copy of them.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CropRect {
    pub name: String,
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
    /// What this rectangle is cut out to look at.
    pub checks: String,
}

/// Counts measured from the GLB. `tools/validate_export.py` asserts them, and so does
/// `the_glb_audit_matches_the_file_on_disk` for the byte count.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlbAudit {
    pub nodes: u32,
    pub meshes: u32,
    /// 179: 153 meshes plus 26 extra material slots. This is the number of parts
    /// `src/scene.rs` builds.
    pub primitives: u32,
    pub triangles: u32,
    pub accessors: u32,
    pub materials: u32,
    pub cameras: u32,
    /// 2: only `Beam_L` and `Beam_R` survived as punctual lights.
    pub punctual_lights: u32,
    /// 1: the embedded `T_LEDWall_Sky` PNG. Zero before the export was fixed.
    pub images: u32,
    /// 2: `MAT_LED_Screen`'s `baseColorTexture` and `emissiveTexture`, both on that one image.
    pub textures: u32,
    pub samplers: u32,
    pub animations: u32,
    /// Size of `assets/wheel_stage.glb` on disk. A test compares it against the real file, so
    /// a re-export that changes the model fails the suite until this file is regenerated.
    pub file_bytes: u64,
    pub extensions_used: Vec<String>,
    pub extensions_required: Vec<String>,
}

/// Everything `assets/scene.json` holds.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub generated_by: String,
    /// The date the file was last regenerated from the .blend and the GLB.
    pub generated_on: String,
    pub source_blend: String,
    pub blender_version: String,
    /// Blender render engine, `BLENDER_EEVEE`.
    pub render_engine: String,
    /// Path of the model, relative to the crate root.
    pub glb: String,
    /// Blender scene name, `Stage`.
    pub scene_name: String,
    /// Frame of the geometry in the GLB.
    pub up_axis: UpAxis,
    /// Frame of every top-level vector in this file.
    pub vectors_in: VectorFrame,
    pub render: RenderSpec,
    pub camera: CameraSpec,
    /// All six Blender lights. Four of them are in no GLB.
    pub lights: Vec<LightSpec>,
    /// All 19 materials. `MAT_Rubber_Black` from `docs/agent_plan.md` does not exist in the
    /// .blend and must not be created.
    pub materials: Vec<MaterialSpec>,
    /// The one image the scene uses. The GLB embeds it.
    pub textures: Vec<TextureSpec>,
    /// The LED wall and the author's own sky on it.
    pub screen: ScreenSpec,
    pub wheel: WheelSpec,
    pub flapper: FlapperSpec,
    pub crops: Vec<CropRect>,
    pub glb_audit: GlbAudit,
}

impl Manifest {
    /// Reads and parses the manifest at `path`.
    pub fn load(path: impl AsRef<Path>) -> crate::Result<Manifest> {
        let path = path.as_ref();
        let text = std::fs::read_to_string(path)
            .map_err(|e| crate::Error::from(format!("{}: {e}", path.display())))?;
        let manifest: Manifest = serde_json::from_str(&text)
            .map_err(|e| crate::Error::from(format!("{}: {e}", path.display())))?;
        Ok(manifest)
    }

    /// Reads `assets/scene.json`, resolved from the executable's location.
    pub fn load_from_assets() -> crate::Result<Manifest> {
        Manifest::load(crate::asset_path(MANIFEST_PATH))
    }

    /// Moves a position **out of the frame this manifest declares** and into the frame of the
    /// exported geometry.
    ///
    /// Today that is the identity: `vectors_in` is `gltf_y_up`, so every top-level vector is
    /// already in the geometry frame. Pass top-level manifest vectors through it anyway and
    /// the code keeps working if the manifest ever goes back to `blender_z_up`.
    ///
    /// It is **not** the conversion for a `blender` sub-object — those are Z-up whatever
    /// `vectors_in` says. Use [`Manifest::blender_to_scene_point`] for them.
    pub fn to_scene_point(&self, v: Vec3) -> Vec3 {
        match (self.vectors_in, self.up_axis) {
            (VectorFrame::GltfYUp, _) | (_, UpAxis::Z) => v,
            (VectorFrame::BlenderZUp, UpAxis::Y) => vec3(v.x, v.z, -v.y),
        }
    }

    /// Moves a direction out of the declared frame into the geometry frame. The conversion is
    /// a rotation, so it is the same map as for positions.
    pub fn to_scene_dir(&self, v: Vec3) -> Vec3 {
        self.to_scene_point(v)
    }

    /// Moves a **Blender Z-up** position into the frame of the exported geometry, the
    /// exporter's own map `(x, y, z) -> (x, z, -y)`.
    ///
    /// This is what the `blender` sub-objects and every number in `docs/agent_plan.md` and
    /// `docs/scene_audit.md` need. It converts whatever `vectors_in` says, and is only the
    /// identity when the geometry itself is still Z-up.
    pub fn blender_to_scene_point(&self, v: Vec3) -> Vec3 {
        match self.up_axis {
            UpAxis::Y => vec3(v.x, v.z, -v.y),
            UpAxis::Z => v,
        }
    }

    /// Moves a **Blender Z-up** direction into the frame of the exported geometry.
    pub fn blender_to_scene_dir(&self, v: Vec3) -> Vec3 {
        self.blender_to_scene_point(v)
    }

    /// World up in the frame of the exported geometry.
    pub fn scene_up(&self) -> Vec3 {
        match self.up_axis {
            UpAxis::Z => vec3(0.0, 0.0, 1.0),
            UpAxis::Y => vec3(0.0, 1.0, 0.0),
        }
    }

    /// The material entry with this name, if the manifest has one.
    pub fn material(&self, name: &str) -> Option<&MaterialSpec> {
        self.materials.iter().find(|m| m.name == name)
    }

    /// The light entry with this name, if the manifest has one.
    pub fn light(&self, name: &str) -> Option<&LightSpec> {
        self.lights.iter().find(|l| l.name == name)
    }

    /// The crop rectangle with this name, if the manifest has one.
    pub fn crop(&self, name: &str) -> Option<&CropRect> {
        self.crops.iter().find(|c| c.name == name)
    }

    /// The texture entry with this name, if the manifest has one.
    pub fn texture(&self, name: &str) -> Option<&TextureSpec> {
        self.textures.iter().find(|t| t.name == name)
    }

    /// The material on that object's slot, if the manifest knows of one.
    ///
    /// This is the honest way to ask "what is `Wheel_Hub` made of": the .blend's own slot
    /// table, not a node name written into Rust.
    pub fn material_on(&self, node: &str, slot: u32) -> Option<&MaterialSpec> {
        self.materials
            .iter()
            .find(|m| m.used_by.iter().any(|u| u.node == node && u.slot == slot))
    }
}

/// What these tests may and may not assert
///
/// Two kinds of assertion are legitimate here, and one is not.
///
/// Legitimate: the manifest against **ground truth** — the .blend, or `assets/wheel_stage.glb`,
/// or its own internal arithmetic. Legitimate: the manifest against what the **renderer
/// actually applies**, by calling the renderer's own function and comparing.
///
/// Not legitimate: pinning a manifest number that nothing reads. A test like that is green
/// while the frame is drawn from a different number somewhere in Rust, which is the exact
/// failure the cleanup pass was called to fix. The old `material_table_matches_the_plan`
/// asserted `MAT_Gold_Trim`'s metallic 1.0 and `MAT_Crystal`'s emission while `src/scene.rs`
/// drew both from constants of its own, and it passed for five look-dev rounds.
#[cfg(test)]
mod tests {
    use super::*;

    fn manifest() -> Manifest {
        Manifest::load(crate::asset_path(MANIFEST_PATH)).expect("assets/scene.json")
    }

    /// Compares two linear RGB triples at f32 precision.
    fn close(a: Vec3, b: Vec3, what: &str) {
        let d = (a - b).magnitude();
        assert!(d < 1.0e-5, "{what}: {a:?} vs {b:?}, distance {d}");
    }

    /// The real file on disk must deserialise. It is a hard error in `World::build`, so a
    /// key renamed in the manifest has to fail here rather than at run time.
    #[test]
    fn the_file_on_disk_deserialises() {
        let m = manifest();
        assert_eq!(m.scene_name, "Stage");
        assert_eq!(m.up_axis, UpAxis::Y);
        assert_eq!(m.vectors_in, VectorFrame::GltfYUp);
        assert_eq!(m.glb, "assets/wheel_stage.glb");
        assert_eq!((m.render.width, m.render.height), (1672, 941));
        assert_eq!(m.lights.len(), 6);
        // 19, not the 20 of docs/agent_plan.md: MAT_Rubber_Black does not exist.
        assert_eq!(m.materials.len(), 19);
        assert!(m.material("MAT_Rubber_Black").is_none());
        assert_eq!(m.crops.len(), 6);
        assert_eq!(m.textures.len(), 1);
        assert_eq!(m.glb_audit.nodes, 163);
        assert_eq!(m.glb_audit.materials as usize, m.materials.len());
        // The fixed export carries the author's sky: 1 image, 2 textures. Both were 0 in the
        // manifest this pass replaced, which is what misled a reviewer into calling the
        // screen procedural.
        assert_eq!((m.glb_audit.images, m.glb_audit.textures), (1, 2));
    }

    /// `glb_audit` describes the GLB that is on disk right now, not an older export.
    #[test]
    fn the_glb_audit_matches_the_file_on_disk() {
        let m = manifest();
        let path = crate::asset_path(&m.glb);
        let len = std::fs::metadata(&path)
            .unwrap_or_else(|e| panic!("{}: {e}", path.display()))
            .len();
        assert_eq!(
            len, m.glb_audit.file_bytes,
            "{} is {len} bytes and the manifest says {}; regenerate assets/scene.json",
            path.display(),
            m.glb_audit.file_bytes
        );
    }

    /// The camera is the hero camera of `docs/export_notes.md` §5, in the glTF frame.
    #[test]
    fn camera_is_cam_hero_in_the_gltf_frame() {
        let m = manifest();
        assert_eq!(m.camera.name, "Cam_Hero");
        assert_eq!(m.camera.position, [0.0, 1.0, 6.4]);
        assert_eq!(m.camera.blender.location, [0.0, -6.4, 1.0]);
        assert_eq!(m.camera.z_near, 0.05);
        assert_eq!(m.camera.z_far, 200.0);
        // The derived fov_y and the yfov the exporter wrote into the GLB must agree, or one
        // of the two is wrong about the sensor fit.
        assert!((m.camera.fov_y_rad - m.camera.glb_yfov_rad).abs() < 1.0e-6);
        assert!((m.camera.glb_aspect_ratio - m.render.aspect).abs() < 1.0e-6);
        // fov_y follows from the 22 mm lens on the 36 mm HORIZONTAL sensor at this aspect.
        let fov_x = 2.0 * (m.camera.sensor_width_mm / (2.0 * m.camera.lens_mm)).atan();
        let fov_y = 2.0 * ((fov_x * 0.5).tan() / m.render.aspect).atan();
        assert!((m.camera.fov_x_rad - fov_x).abs() < 1.0e-6);
        assert!((m.camera.fov_y_rad - fov_y).abs() < 1.0e-6);
        // Not Blender's camera.angle_y, 0.9987 rad, which is the wrong fit for this sensor.
        assert!((m.camera.fov_y_rad - 0.998_693_5).abs() > 0.1);
        // A top-level vector is already in the geometry frame, so the map is the identity.
        assert_eq!(m.to_scene_point(m.camera.position()), m.camera.position());
        // The Blender sub-object is not, and converts to exactly the top-level value.
        assert_eq!(
            m.blender_to_scene_point(Vec3::from(m.camera.blender.location)),
            m.camera.position()
        );
        assert_eq!(
            m.blender_to_scene_dir(Vec3::from(m.camera.blender.forward)),
            m.camera.forward()
        );
        assert_eq!(m.scene_up(), vec3(0.0, 1.0, 0.0));
    }

    /// What agent K spins and where. Blender `(0, 1.2, 3.5)` mapped is glTF `(0, 3.5, -1.2)`.
    #[test]
    fn wheel_pivot_is_in_the_geometry_frame() {
        let m = manifest();
        assert_eq!(m.wheel.pivot_node, "Wheel_Root");
        assert_eq!(m.wheel.pivot, [0.0, 3.5, -1.2]);
        assert_eq!(m.wheel.axis, [0.0, 0.0, -1.0]);
        assert_eq!(m.wheel.child_count, 56);
        assert_eq!(m.wheel.peg_count, 48);
        assert_eq!(
            m.blender_to_scene_point(Vec3::from(m.wheel.blender.pivot)),
            m.wheel.pivot()
        );
        assert_eq!(
            m.blender_to_scene_dir(Vec3::from(m.wheel.blender.spin_axis)),
            m.wheel.axis()
        );
        assert_eq!(m.flapper.node, "Pointer_Flapper");
        assert_eq!(m.flapper.pivot, [0.0, 6.22, -0.795]);
    }

    /// The material table's own arithmetic. Nothing here is transcribed from a document: each
    /// assertion is a relation the file must satisfy whatever the .blend says.
    #[test]
    fn the_material_table_is_internally_consistent() {
        let m = manifest();
        for s in &m.materials {
            assert!(
                (0.0..=1.0).contains(&s.metallic),
                "{}: metallic {}",
                s.name,
                s.metallic
            );
            assert!(
                (0.0..=1.0).contains(&s.roughness),
                "{}: roughness {}",
                s.name,
                s.roughness
            );
            assert!((0.0..=1.0).contains(&s.alpha), "{}: alpha {}", s.name, s.alpha);
            // effective_emission is the product, by definition of the field.
            close(
                Vec3::from(s.effective_emission),
                Vec3::from(s.emission_color) * s.emission_strength,
                &format!("{} effective_emission", s.name),
            );
            assert_eq!(
                s.emission_strength > 0.0,
                s.emits(),
                "{}: emits() disagrees with emission_strength",
                s.name
            );
            // A material blends exactly when it is not fully opaque, so the two signals
            // cannot disagree without one of them being wrong.
            assert_eq!(
                s.alpha_mode == "BLEND",
                s.alpha < 1.0,
                "{}: alpha_mode {} at alpha {}",
                s.name,
                s.alpha_mode,
                s.alpha
            );
            assert_eq!(s.alpha_mode, s.glb_alpha_mode, "{}: alpha mode", s.name);
            // A textured socket has a UV layer and vice versa.
            assert_eq!(
                s.is_textured(),
                !s.uv_map.is_empty(),
                "{}: uv_map {:?}",
                s.name,
                s.uv_map
            );
            assert!(!s.used_by.is_empty(), "{}: no object carries it", s.name);
        }
        // Exactly one material blends, and it is the crystal at the .blend's own alpha.
        let blending: Vec<&str> = m
            .materials
            .iter()
            .filter(|s| s.is_blend())
            .map(|s| s.name.as_str())
            .collect();
        assert_eq!(blending, ["MAT_Crystal"]);
        assert_eq!(m.material("MAT_Crystal").unwrap().alpha, 0.55);
    }

    /// The manifest against `assets/wheel_stage.glb`, which is what the importer reads.
    ///
    /// This is the evidence for the cleanup pass's rule on per-node overrides: an override is
    /// honest only when it restores something glTF transport lost. Transport loses none of the
    /// three PBR factors, so no override of a metallic or a roughness can claim to be a repair.
    #[test]
    fn transport_preserves_every_pbr_factor_except_emission() {
        let m = manifest();
        for s in &m.materials {
            if s.is_textured() {
                // The exporter drops the socket default and writes white, because the image is
                // the colour. MAT_LED_Screen is the only one.
                assert_eq!(
                    s.glb_base_color_factor,
                    [1.0, 1.0, 1.0, 1.0],
                    "{}: textured, so the GLB factor should be white",
                    s.name
                );
                assert!(s.glb_has_base_color_texture, "{}: baseColorTexture", s.name);
                assert_eq!(
                    s.glb_has_emissive_texture,
                    !s.emission_texture.is_empty(),
                    "{}: emissiveTexture",
                    s.name
                );
            } else {
                let f = s.glb_base_color_factor;
                close(
                    vec3(f[0], f[1], f[2]),
                    Vec3::from(s.base_color),
                    &format!("{} base colour", s.name),
                );
                assert!((f[3] - s.alpha).abs() < 1.0e-6, "{}: alpha", s.name);
                assert!(!s.glb_has_base_color_texture, "{}: no texture", s.name);
                assert!(!s.glb_has_emissive_texture, "{}: no texture", s.name);
            }
            assert!(
                (s.glb_metallic - s.metallic).abs() < 1.0e-6,
                "{}: metallic {} in the .blend, {} in the GLB",
                s.name,
                s.metallic,
                s.glb_metallic
            );
            assert!(
                (s.glb_roughness - s.roughness).abs() < 1.0e-6,
                "{}: roughness {} in the .blend, {} in the GLB",
                s.name,
                s.roughness,
                s.glb_roughness
            );
            // Emission survives transport only as a product: the exporter normalises the
            // factor to a maximum of 1 and puts the rest into an extension three-d-asset
            // ignores, so an importer that reads the factor alone sees a fraction of it. On a
            // textured emitter the factor is white and the image carries the colour, so there
            // is no product to compare.
            if !s.is_textured() {
                close(
                    Vec3::from(s.glb_emissive_factor) * s.glb_emissive_strength,
                    Vec3::from(s.effective_emission),
                    &format!("{} glb emission", s.name),
                );
                assert!(
                    s.glb_emissive_factor.iter().all(|c| *c <= 1.0),
                    "{}: the GLB factor is not normalised",
                    s.name
                );
            }
        }
    }

    /// What `src/scene.rs` actually puts on the frame for an emissive material has to be what
    /// this file says. The renderer's own function is called, so a constant in Rust that
    /// overrides the manifest fails here.
    #[test]
    fn the_renderer_emits_what_the_manifest_says() {
        let m = manifest();
        let mut wrong = Vec::new();
        for s in &m.materials {
            if !s.emits() {
                assert!(
                    crate::scene::hdr_emissive(s).is_none(),
                    "{} does not glow, so nothing should be written over its emissive",
                    s.name
                );
                continue;
            }
            // Skipped on purpose: for a textured emitter the radiance is the image times
            // emission_strength, and effective_emission is only the socket-default fallback,
            // so there is no single triple to compare against.
            if !s.emission_texture.is_empty() {
                continue;
            }
            let want = s.emitted_radiance();
            match crate::scene::hdr_emissive(s) {
                Some(got) if (got - want).magnitude() < 1.0e-4 => {}
                Some(got) => wrong.push(format!(
                    "{}: the renderer emits {:?} where the manifest says {:?}",
                    s.name, got, want
                )),
                // No HDR override is right only when the clamped sRGB value already carries
                // the whole radiance, which needs every channel at or under 1.0.
                None if want.x <= 1.0 && want.y <= 1.0 && want.z <= 1.0 => {}
                None => wrong.push(format!(
                    "{}: the renderer clamps to sRGB where the manifest says {:?}",
                    s.name, want
                )),
            }
        }
        assert!(
            wrong.is_empty(),
            "the renderer does not read the manifest for {} of its emissive materials:\n  {}",
            wrong.len(),
            wrong.join("\n  ")
        );
    }

    /// The screen block and `MAT_LED_Screen` must tell the same story, and it must be the
    /// texture-driven one. `images: 0, textures: 0` in the manifest this pass replaced is what
    /// made a reviewer call the screen procedural.
    #[test]
    fn the_screen_is_driven_by_the_authors_texture() {
        let m = manifest();
        let led = m
            .material(&m.screen.material)
            .expect("the screen material is in the table");
        assert_eq!(led.name, "MAT_LED_Screen");
        assert!(led.is_textured());
        assert_eq!(led.base_color_texture, m.screen.texture);
        assert_eq!(led.emission_texture, m.screen.texture);
        assert_eq!(led.uv_map, m.screen.uv_map);
        assert_eq!(led.emission_strength, m.screen.emission_strength);
        assert!(led.glb_has_base_color_texture && led.glb_has_emissive_texture);
        assert!((led.glb_emissive_strength - m.screen.emission_strength).abs() < 1.0e-6);
        // The image is in the GLB, so the app needs no file at run time.
        let tex = m.texture(&m.screen.texture).expect("the texture is recorded");
        assert!(tex.embedded_in_glb && m.screen.in_glb);
        assert_eq!(tex.glb_texture_indices.len(), m.glb_audit.textures as usize);
        assert_eq!(tex.uv_map, led.uv_map);
        // Two objects share the material, so nothing may bind by material name alone.
        assert!(led.is_on(&m.screen.node));
        for other in &m.screen.also_on {
            assert!(led.is_on(other), "{other} is not on {}", led.name);
        }
        assert_eq!(led.used_by.len(), 1 + m.screen.also_on.len());
        // Wheel_Hub is polished metal in the .blend, which is what `used_by` is for.
        let hub = m.material_on("Wheel_Hub", 0).expect("Wheel_Hub has a material");
        assert_eq!(hub.name, "MAT_Metal_Polished");
    }

    /// `src/shot.rs` reads these six rectangles and keeps no copy, so they have to be here and
    /// they have to fit inside the frame.
    #[test]
    fn crops_cover_the_six_named_regions_inside_the_frame() {
        let m = manifest();
        let names: Vec<&str> = m.crops.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(
            names,
            ["hub", "rim_top", "floor", "screen_left", "truss", "podium"]
        );
        for c in &m.crops {
            assert!(c.w > 0 && c.h > 0, "{}: empty rectangle", c.name);
            assert!(
                c.x + c.w <= m.render.width && c.y + c.h <= m.render.height,
                "{} at {},{} {}x{} does not fit in {}x{}",
                c.name,
                c.x,
                c.y,
                c.w,
                c.h,
                m.render.width,
                m.render.height
            );
            assert!(m.crop(&c.name).is_some());
        }
    }

    /// The lights agent H builds: six of them, only two in the GLB, cones are half angles.
    #[test]
    fn lights_carry_all_six_with_gltf_vectors() {
        let m = manifest();
        let names: Vec<&str> = m.lights.iter().map(|l| l.name.as_str()).collect();
        assert_eq!(
            names,
            ["Key_Wheel", "Beam_L", "Beam_R", "Rim_L", "Rim_R", "Fill_Front"]
        );
        assert_eq!(m.lights.iter().filter(|l| l.in_glb).count(), 2);
        let beam = m.light("Beam_L").unwrap();
        assert_eq!(beam.kind, "SPOT");
        assert_eq!(beam.energy, 2500.0);
        assert!((beam.cone_outer_half_angle_rad - beam.spot_size * 0.5).abs() < 1.0e-6);
        assert!((beam.direction().magnitude() - 1.0).abs() < 1.0e-6);
        let key = m.light("Key_Wheel").unwrap();
        assert_eq!(key.kind, "AREA");
        assert_eq!(key.position, [0.0, 6.0, 5.0]);
        assert_eq!(key.size, 4.0);
        assert!(!key.in_glb);
    }
}
