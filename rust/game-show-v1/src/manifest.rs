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
    /// `|target - position|` = 7.99468291 m. The orbit radius of the hero view.
    pub orbit_radius: f32,
    pub fov_y_deg: f32,
    /// Vertical field of view in radians at [`RenderSpec::aspect`]. 0.86305638, which is
    /// also the `yfov` the exporter wrote into the GLB.
    pub fov_y_rad: f32,
    pub z_near: f32,
    pub z_far: f32,
    pub lens_mm: f32,
    /// `HORIZONTAL`, so the 36 mm sensor spans the width. Blender's `camera.angle_y` is
    /// wrong for this fit; see the manifest's own note.
    pub sensor_fit: String,
    pub sensor_width_mm: f32,
    /// Horizontal field of view in radians, 1.37145902. Hold this, not `fov_y_rad`, to keep
    /// the framing when the window aspect changes.
    pub fov_x_rad: f32,
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
    /// Blender `spot_size`, the FULL cone angle, radians. Zero for AREA.
    #[serde(rename = "spot_size_rad")]
    pub spot_size: f32,
    /// Blender spot blend, 0..1.
    pub spot_blend: f32,
    /// `spot_size / 2`. This is what `SpotLight::cutoff` wants.
    pub cone_outer_half_angle_rad: f32,
    /// `outer * (1 - blend)`.
    pub cone_inner_half_angle_rad: f32,
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

/// One Blender material. Authoritative: the GLB's own values arrive wrong, see
/// `src/scene.rs`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MaterialSpec {
    pub name: String,
    /// Linear RGB. `PhysicalMaterial::albedo` is sRGB-encoded — encode before assigning.
    pub base_color: [f32; 3],
    pub metallic: f32,
    pub roughness: f32,
    /// Below 1.0 only on `MAT_Crystal`.
    pub alpha: f32,
    /// `OPAQUE` or `BLEND`. `MAT_Crystal` is the only `BLEND`.
    pub alpha_mode: String,
    pub emission_strength: f32,
    /// Linear RGB.
    pub emission_color: [f32; 3],
    /// `emission_color * emission_strength`, linear RGB. This is the value the Blender
    /// shader emits, and the one to use.
    pub effective_emission: [f32; 3],
    /// What the GLB holds. The exporter normalised the factor to a maximum of 1 and put the
    /// rest into `KHR_materials_emissive_strength`, which `three-d-asset` ignores.
    pub glb_emissive_factor: [f32; 3],
    /// The strength that goes with `glb_emissive_factor`.
    pub glb_emissive_strength: f32,
}

impl MaterialSpec {
    /// True when the material glows.
    pub fn emits(&self) -> bool {
        self.effective_emission.iter().any(|c| *c > 0.0)
    }

    /// True when the material must be blended rather than written opaquely.
    pub fn is_blend(&self) -> bool {
        self.alpha_mode == "BLEND" || self.alpha < 1.0
    }
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
    /// Outer radius of a peg body, 2.301 m.
    pub peg_outer_radius: f32,
    pub peg_pitch_deg: f32,
    /// Angle of peg 0, 3.75 deg: the pegs sit on the sector boundaries.
    pub peg_first_angle_deg: f32,
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
    pub blade_length: f32,
    pub striker_lever_arm: f32,
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
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CropRect {
    pub name: String,
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
    /// What the look-dev rounds check in this rectangle.
    pub checks: String,
}

/// Counts measured from the GLB. `tools/validate_export.py` asserts them.
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
    pub images: u32,
    pub textures: u32,
    pub animations: u32,
    pub extensions_used: Vec<String>,
    pub extensions_required: Vec<String>,
}

/// Everything `assets/scene.json` holds.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub generated_by: String,
    pub source_blend: String,
    pub blender_version: String,
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
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest() -> Manifest {
        Manifest::load(crate::asset_path(MANIFEST_PATH)).expect("assets/scene.json")
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
        assert_eq!(m.glb_audit.nodes, 163);
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
        // The yfov the exporter wrote into the GLB is 0.86305637.
        assert!((m.camera.fov_y_rad - 0.863_056_4).abs() < 1.0e-6);
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

    /// The four materials that glow and the one that blends, per the plan's table.
    #[test]
    fn material_table_matches_the_plan() {
        let m = manifest();
        let emitting: Vec<&str> = m
            .materials
            .iter()
            .filter(|s| s.emits())
            .map(|s| s.name.as_str())
            .collect();
        assert_eq!(
            emitting,
            [
                "MAT_Bulb_Glass",
                "MAT_Lens_Glow",
                "MAT_Crystal",
                "MAT_LED_Screen"
            ]
        );
        let blending: Vec<&str> = m
            .materials
            .iter()
            .filter(|s| s.is_blend())
            .map(|s| s.name.as_str())
            .collect();
        assert_eq!(blending, ["MAT_Crystal"]);

        let crystal = m.material("MAT_Crystal").unwrap();
        assert_eq!(crystal.alpha, 0.55);
        assert_eq!(crystal.alpha_mode, "BLEND");
        assert_eq!(crystal.effective_emission, [1.02, 0.72, 1.14]);

        let gold = m.material("MAT_Gold_Trim").unwrap();
        assert_eq!(gold.base_color, [0.72, 0.52, 0.18]);
        assert_eq!(gold.metallic, 1.0);
        assert_eq!(gold.roughness, 0.22);
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
