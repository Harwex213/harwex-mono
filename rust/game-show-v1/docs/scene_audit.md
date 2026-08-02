# Scene audit — `wheel_stage.blend`

Agent B. Measured with `blender --background <file> --python <script>` on Blender 5.1.2
(`ec6e62d40fa9`). The file was never saved. Scripts are throwaway; every number below comes
from evaluated geometry (modifiers applied) unless the text says "raw".

Conventions used throughout:

- Blender world axes. **Z is up**, the camera sits at −Y and looks toward +Y.
- "Wheel-local" means the coordinate frame of `Wheel_Root`, that is `Wheel_Root.matrix_world⁻¹ · p`.
- Wheel angle `θ = atan2(x_local, z_local)`. `θ = 0` points at wheel-local +Z (straight up),
  and `θ` grows toward wheel-local +X (screen right). See section 3.
- Triangle counts are `Σ (loop_count − 2)` over evaluated polygons, which is what a triangulating
  exporter produces.

This document supplements `agent_plan.md`. Section 11 lists the places where the measured scene
disagrees with the plan. Those corrections win.

## 1. Scale and bounding boxes

Unit system metric, `scale_length = 1.0`, so **one Blender unit is one metre**. No object carries a
scale other than 1 (section 7), so metres are metres all the way down to the vertex data.

Whole scene, world space, evaluated geometry of all 153 meshes:

| | X | Y | Z |
| --- | --- | --- | --- |
| min | −11.9800 | −11.9800 | −0.1400 |
| max | 11.9800 | 11.9800 | 8.2160 |
| size | 23.9600 | 23.9600 | 8.3560 |

The scene is a cylindrical set roughly **24 m across and 8.4 m tall**. The bottom −0.14 m is the
underside of the floor disc. The set is a full 360° ring, not a facade: the wall, the truss and the
floor rings wrap all the way round, so a camera orbit past ±90° stays inside a closed room.

Per collection, world space, geometry only:

| Collection | min | max | size | meshes | tris |
| --- | --- | --- | --- | --- | --- |
| `10_Floor` | (−11.9800, −11.9800, −0.1400) | (11.9800, 11.9800, 0.0160) | (23.9600, 23.9600, 0.1560) | 2 | 6 784 |
| `20_Wall` | (−11.3400, −11.3400, 0.0000) | (11.3400, 11.3400, 7.9500) | (22.6800, 22.6800, 7.9500) | 5 | 25 984 |
| `30_Wheel` | (−2.6000, 0.2500, 0.0000) | (2.6000, 2.6500, 6.7900) | (5.2000, 2.4000, 6.7900) | 64 | 59 904 |
| `40_Pillars` | (−7.2900, 5.1600, 0.0040) | (7.2900, 6.2400, 6.1600) | (14.5800, 1.0800, 6.1560) | 8 | 8 624 |
| `50_Podium` | (−4.4998, 0.6089, 0.0022) | (−2.7002, 2.0911, 1.4368) | (1.7995, 1.4822, 1.4346) | 7 | 4 008 |
| `60_Rig` | (−10.5580, −10.0580, 5.9324) | (10.5580, 11.0580, 8.2160) | (21.1160, 21.1160, 2.2836) | 67 | 48 088 |
| `00_Ref` | — | — | empty | 0 | 0 |
| `70_Lights` | origins (−8, −7.5, 2) | origins (8, 3.5, 7.2) | no geometry | 0 lights=6 | 0 |
| `90_Camera` | origin (0, −6.4, 1) | same | no geometry | 0 cams=1 | 0 |

Collections are a flat list under `Scene Collection`; there is no nesting. No collection has
`hide_viewport` or `hide_render` set. `00_Ref` holds nothing at all — an empty collection, safe for
the exporter to skip.

Notes on individual pieces, for anyone who needs to sanity-check a render:

| Object | world bbox min | world bbox max | tris |
| --- | --- | --- | --- |
| `Floor_Disc` | (−11.9800, −11.9800, −0.1400) | (11.9800, 11.9800, 0.0000) | 640 |
| `Floor_Rings` | (−9.8600, −8.6600, 0.0000) | (9.8600, 11.0600, 0.0160) | 6 144 |
| `Wall_Screen` | (−11.3000, −11.3000, 0.8000) | (11.3000, 11.3000, 6.3500) | 2 048 |
| `Wall_Band_Mid` | (−11.3000, −11.3000, 2.4000) | (11.3000, 11.3000, 3.0200) | 3 264 |
| `Wall_Band_Up` | (−11.3000, −11.3000, 4.7000) | (11.3000, 11.3000, 5.1200) | 3 264 |
| `Wall_Fascia` | (−11.3400, −11.3400, 6.3000) | (11.3400, 11.3400, 7.9500) | 11 968 |
| `Wall_Plinth` | (−11.1800, −11.1800, 0.0000) | (11.1800, 11.1800, 0.8000) | 5 440 |
| `Wheel_Rim` | (−2.6000, 0.9300, 0.9000) | (2.6000, 1.4070, 6.1000) | 12 480 |
| `Wheel_Bulbs` | (−2.4843, 0.8700, 1.0157) | (2.4843, 0.9300, 5.9843) | 16 128 |
| `Wheel_Pegs` | (−2.2962, 1.0140, 1.2038) | (2.2962, 1.1260, 5.7962) | 14 976 |
| `Wheel_Hub` | (−0.4617, 1.0184, 3.0383) | (0.4617, 1.2336, 3.9617) | 288 |
| `Wheel_Legs` | (−2.0757, 1.4845, 0.6800) | (2.0757, 1.9950, 3.4700) | 3 412 |
| `Crest_Crystal` | (−0.2850, 0.3289, 5.7500) | (0.2850, 0.8711, 6.7900) | 280 |
| `Pointer_Flapper` | (−0.2139, 0.5024, 5.0880) | (0.2139, 1.0200, 6.1870) | 172 |
| `Truss_Ring` | (−10.5580, −10.0580, 6.7420) | (10.5580, 11.0580, 7.4580) | 7 680 |
| `Truss_Ring_Inner` | (−6.4660, −5.9660, 7.6840) | (6.4660, 6.9660, 8.2160) | 6 144 |

`Wall_Screen` is the cyclorama: a cylinder of radius 11.30 m spanning z 0.80 to 6.35 m, so the sky
shader in `src/screen.rs` paints a full 360° band 5.55 m tall. Its UV layer is present and named
`UVMap`.

The wall, truss and floor rings are centred on `(0, 1.2)` in XY, not on the origin: their Y bounds
are asymmetric by exactly +1.2, which is the Y of `Wheel_Root`. The wheel is the centre of the set.

## 2. `Wheel_Root` and the spin axis

`Wheel_Root` is an `EMPTY` at the top level, no parent, no constraints, no animation.

```
matrix_world = [ 1 0 0 0.0 ]
               [ 0 1 0 1.2 ]
               [ 0 0 1 3.5 ]
               [ 0 0 0 1.0 ]
```

That is a **pure translation to `(0, 1.2, 3.5)`**. Rotation is identity (quaternion `(1,0,0,0)`),
scale `(1,1,1)`, `matrix_parent_inverse` identity, all delta transforms identity. `matrix_local`
equals `matrix_world` because there is no parent.

The wheel-local extents of the wheel parts show which plane the wheel lies in:

| Object | local X | local Y | local Z |
| --- | --- | --- | --- |
| `Wheel_Rim` | −2.6000 … 2.6000 | −0.2700 … 0.2070 | −2.6000 … 2.6000 |
| `Wheel_Bulbs` | −2.4843 … 2.4843 | −0.3300 … −0.2700 | −2.4843 … 2.4843 |
| `Wheel_Pegs` | −2.2962 … 2.2962 | −0.1860 … −0.0740 | −2.2962 … 2.2962 |
| `Wheel_BackPlate` | −2.2503 … 2.2503 | 0.0359 … 0.1233 | −2.2503 … 2.2503 |
| `Wheel_Spokes` | −2.2470 … 2.2470 | −0.0784 … −0.0336 | −2.2470 … 2.2470 |
| `Wheel_Hub` | −0.4617 … 0.4617 | −0.1816 … 0.0336 | −0.4617 … 0.4617 |

X and Z span ±2.6 m; Y spans 0.477 m at the widest. **The wheel disc lies in the local XZ plane and
its thin axis is local Y.**

> **The wheel must spin about `Wheel_Root`'s local +Y axis.** Because `Wheel_Root`'s rotation is
> identity, local +Y is also **world +Y**. Rotating about any other axis tips the disc out of its
> own plane.

Sense of rotation. A rotation `Ry(φ)` maps a wheel-local point at angle `θ` to angle `θ + φ`, so it
carries the top of the wheel toward local +X. Local +X is screen right for `Cam_Hero`, which sits at
−Y and looks toward +Y. So **positive `φ` about +Y reads as clockwise from the hero camera**; use
negative `φ` for the conventional anticlockwise game-show spin, or negate it in `src/spin.rs` and say
so there.

Everything the wheel needs is already a child of `Wheel_Root` with an identity `matrix_local`
(`Wheel_Rim`, `Wheel_Hub`, `Wheel_HubRing`, `Wheel_HubRivets`, `Wheel_Spokes`, `Wheel_Bulbs`,
`Wheel_Pegs`, `Wheel_BackPlate`, `Wheel_Sector_01..48` — 56 meshes, `parent_type` `OBJECT`).
Applying one rotation matrix at `Wheel_Root` therefore moves all of them and nothing else.

The two other empties are also pure translations and both are top-level, not children of
`Wheel_Root`:

| Empty | world location | children |
| --- | --- | --- |
| `Wheel_Root` | (0, 1.2, 3.5) | the 56 spinning meshes |
| `Wheel_Stand` | (0, 1.2, 0.0) | `Wheel_Legs`, `Wheel_Axle`, `Wheel_BasePlate`, `Wheel_CrossBar` |
| `Crest_Root` | (0, 0.55, 6.1) | `Crest_Crystal`, `Crest_Chevron`, `Crest_Stalk`, `Pointer_Flapper` |

`Wheel_Stand` and `Crest_Root` do not spin. That matches the plan.

### Sector angles

Every `Wheel_Sector_nn` has an identity transform; the wedge is baked into the mesh at its own
angle. Measuring the centroid angle of all 48 gives a clean result:

**Sector `nn` is centred at `θ = (nn − 1) × 7.5°`**, exactly, for all 48. Sector 1 points straight
up at rest, sector 13 points at screen right, sector 25 straight down. Every sector has the same
radial span 0.6948 to 2.2279 m, the same local Y span −0.0392 to 0.0336 m, one material slot, and
36 triangles.

So a spin that should land on sector `nn` needs a final wheel angle of `−(nn − 1) × 7.5°` about
local +Y, plus whatever offset the winning position is (top of the wheel, under the flapper).

## 3. `Pointer_Flapper` and the peg ring

### Pivot and rest orientation

`Pointer_Flapper` is a `MESH` parented to `Crest_Root` with `parent_type` `OBJECT` and an identity
`matrix_parent_inverse`.

| | value |
| --- | --- |
| `matrix_local` | translation `(0, 0.245, 0.120)`, rotation identity, scale 1 |
| `matrix_world` | translation `(0, 0.795, 6.22)`, rotation identity, scale 1 |
| pivot in world | **(0, 0.795, 6.22)** |
| pivot in wheel-local | **(0, −0.405, 2.72)** — radius 2.72 m, directly above the axis |
| rest rotation | **identity**; object axes are the world axes |

The object origin is the hinge. All of the flapper's geometry lies below it in object-local Z
(bbox `(−0.2139, −0.2926, −1.1320)` to `(0.2139, 0.2250, −0.0330)`), so **the blade hangs along
object-local −Z** and is 1.132 m long. It is 0.428 m wide in X and 0.518 m thick in Y.

> **Deflection axis: the flapper's local +Y, which at rest is world +Y — the same axis the wheel
> spins about.** Rotating the blade by `ψ` about +Y swings its tip to `(−L sin ψ, 0, −L cos ψ)` in
> object space, i.e. sideways inside the wheel plane, which is what a tick looks like. Positive `ψ`
> pushes the tip toward +X (screen right), so a wheel turning positive about +Y drags the flapper to
> positive `ψ`.

The blade is five loose parts, three materials:

| verts | material | object-local Z | wheel-local radius | wheel-local Y | what it is |
| --- | --- | --- | --- | --- | --- |
| 31 | `MAT_Crystal` | −0.9670 … −0.0330 | 1.7530 … 2.6932 | −0.6976 … −0.4724 | translucent blade body |
| 24 | `MAT_Gold_Trim` | −0.9649 … −0.0372 | 1.7552 … 2.6892 | −0.5990 … −0.5710 | right edge rail |
| 24 | `MAT_Gold_Trim` | −0.9649 … −0.0372 | 1.7552 … 2.6892 | −0.5990 … −0.5710 | left edge rail |
| 12 | `MAT_Metal_Polished` | −0.5350 … −0.4950 | **2.1867 … 2.2270** | −0.4200 … −0.1800 | **striker tab** |
| 5 | `MAT_Gold_Trim` | −1.1320 … −0.9570 | 1.5880 … 1.7632 | −0.6150 … −0.5550 | tip finial |

The 12-vertex `MAT_Metal_Polished` part is the piece that meets the pegs: it is the only part that
reaches back toward the wheel face (wheel-local Y up to −0.18) and it sits exactly at the peg radius.
Its centre is **0.515 m below the pivot** along object −Z, half-width 0.0946 m in X.

### Peg ring

`Wheel_Pegs` is one mesh with two material slots. Split into loose parts it is 96 islands, which are
48 pairs at 48 distinct angles:

| part | count | material | radius of centre | radial span | wheel-local Y | verts |
| --- | --- | --- | --- | --- | --- | --- |
| peg body | 48 | `MAT_Peg_Metal` | **2.2450** | 2.1890 … 2.3010 | −0.1860 … −0.0740 | 146 |
| collar at its base | 48 | `MAT_Gold_Trim` | 2.1300 | 2.0000 … 2.2600 | −0.1390 … −0.1210 | 14 |

- **Peg count: 48.**
- **Peg ring radius: 2.2450 m** to the peg centre; the body spans 2.1890 to 2.3010 m, so the
  outermost point of a peg is at radius 2.3010 m.
- Angular pitch **7.5°** exactly (`360/48`), no gaps and no doubles.
- Peg angles are **`θ_k = 3.75° + k × 7.5°`, `k = 0..47`**. Sector centres are at `(nn−1) × 7.5°`,
  so **the pegs sit on the sector boundaries**, offset half a sector from the sector centres. A
  wheel at rotation 0 has sector 1 straight up and a peg 3.75° either side of it.
- Peg body bbox is 0.112 m in all three axes, so treat a peg as a 0.112 m stud: tangential
  half-width ≈ 0.056 m, depth 0.112 m along Y.
- The pegs point forward, toward the camera. They occupy wheel-local Y −0.186 to −0.074, in front of
  the back plate (0.036 … 0.123) and the spokes (−0.078 … −0.034), but still behind the rim's front
  flange at −0.270. So the studs stand off the sector face and stay inside the rim's depth; the
  flapper's tab passes in front of that flange to meet them. Radially, the rim occupies 2.236 to
  2.600 m and the tab occupies 2.187 to 2.227 m, so the tab stays just inside the rim's inner edge
  while the pegs straddle it.

### Contact geometry

The striker tab and the pegs do **not** intersect in the rest pose. Along Y the pegs occupy
−0.1860 … −0.0740 and the tab occupies −0.4200 … −0.1800, so there is a **0.006 m gap** between the
tab's rear face and the peg's front tip. Radially they overlap fully. Two consequences:

1. The tick has to be driven kinematically. There is no penetration to resolve and no rigid-body
   contact to detect; drive `ψ` from the wheel angle.
2. Nothing in the source scene stops the two passing through each other, so a bad tick curve will
   show as the tab clipping a peg rather than as an obvious collision.

Useful derived numbers for `src/spin.rs`:

- Pivot radius from the wheel axis: `R_p = 2.72 m`.
- Tab lever arm from the pivot: `L = 0.515 m` (band 0.495 … 0.535 m).
- Peg outer radius: `R_o = 2.3010 m`. `R_p − R_o = 0.419 m < L`, so the tab does sweep through the
  peg circle; the interference depth is 0.096 m.
- Solving `|P + Ry(ψ)·(0,0,−L)| = R_o` with `P = (0, 0, 2.72)` gives `ψ = ±32.2°`. That is the
  deflection at which the tab clears the peg tips entirely, so it is the upper bound on a tick
  amplitude. A realistic tick rides a fraction of it and drops back; the peak angle is a look-dev
  choice, not a measurement.
- One peg passes the top every `7.5°` of wheel rotation, so the tick frequency is
  `48 × (spin rate in revolutions per second)` Hz.

## 4. Material to object map

The file contains **19 materials, not 20** (see section 11). Every one of them is used. Triangle
counts are over evaluated geometry, summed by polygon material index.

| Material | objects | tris |
| --- | --- | --- |
| `MAT_Bulb_Glass` | `Wheel_Bulbs` | 16 128 |
| `MAT_Crystal` | `Crest_Chevron`\*, `Crest_Crystal`\*, `Pointer_Flapper`\* | 302 |
| `MAT_Dark_Trim` | `Podium_Body`, `Podium_Desk`\*, `Podium_Monitor`\*, `Podium_Panels`\*, `Podium_Top`\*, `Wall_Plinth`, `Wheel_BackPlate`, `Wheel_BasePlate`\*, `Wheel_CrossBar`\*, `Wheel_HubRing` | 10 844 |
| `MAT_Fixture_Body` | `Blinder_01..06_Body`, `Blinder_01..06_Lens`\*, `MH_01..12_Base`, `MH_01..12_Head`, `MH_01..12_Yoke`, `Truss_Par_Body` (49 objects) | 13 608 |
| `MAT_Floor_Gloss` | `Floor_Disc` | 640 |
| `MAT_Gold_Dark` | `Crest_Stalk`, `Pillar_L_Base`\*, `Pillar_R_Base`\*, `Podium_Panels`\*, `Podium_Riser`\*, `Podium_Trim`\*, `Wall_Fascia`\*, `Wheel_Axle`\*, `Wheel_CrossBar`\*, `Wheel_Legs`\* | 10 792 |
| `MAT_Gold_Trim` | `Crest_Chevron`\*, `Crest_Crystal`\*, `Floor_Rings`, `Pillar_L_Base`\*, `Pillar_L_Cap`\*, `Pillar_L_Collar`, `Pillar_R_Base`\*, `Pillar_R_Cap`\*, `Pillar_R_Collar`, `Podium_Desk`\*, `Podium_Monitor`\*, `Podium_Top`\*, `Podium_Trim`\*, `Pointer_Flapper`\*, `Wall_Band_Mid`, `Wall_Band_Up`, `Wall_Fascia`\*, `Wheel_BasePlate`\*, `Wheel_Pegs`\*, `Wheel_Rim`, `Wheel_Spokes` (21 objects) | 39 878 |
| `MAT_LED_Screen` | `Podium_Riser`\*, `Wall_Screen` | 2 092 |
| `MAT_Lens_Glow` | `Blinder_01..06_Lens`\*, `MH_01..12_Lens`, `Truss_Par_Lens` (19 objects) | 5 376 |
| `MAT_Metal_Polished` | `Pointer_Flapper`\*, `Wheel_Axle`\*, `Wheel_Hub`, `Wheel_HubRivets`, `Wheel_Legs`\* | 4 684 |
| `MAT_Peg_Metal` | `Wheel_Pegs`\* | 13 824 |
| `MAT_Pillar_Body` | `Pillar_L_Cap`\*, `Pillar_L_Core`, `Pillar_R_Cap`\*, `Pillar_R_Core` | 4 392 |
| `MAT_Sector_Blue` | sectors 08, 20, 32, 44 | 144 |
| `MAT_Sector_Cream` | sectors 04, 12, 16, 24, 28, 36, 40, 48 | 288 |
| `MAT_Sector_Cyan` | sectors 05, 11, 17, 23, 29, 35, 41, 47 | 288 |
| `MAT_Sector_Gold` | sectors 03, 09, 15, 21, 27, 33, 39, 45 | 288 |
| `MAT_Sector_Pink` | sectors 01, 07, 13, 19, 25, 31, 37, 43 | 288 |
| `MAT_Sector_White` | sectors 02, 06, 10, 14, 18, 22, 26, 30, 34, 38, 42, 46 | 432 |
| `MAT_Truss_Metal` | `Truss_Brace`, `Truss_Brace_Inner`, `Truss_Links`, `Truss_Ring`, `Truss_Ring_Inner` | 29 104 |

`*` marks an object with more than one material slot; that object appears under every material it
uses.

Total 153 392 tris, which matches section 9.

### Objects with more than one material slot

25 objects. Every one of them actually uses every slot — no slot is dead, so a per-object single
material assignment would lose geometry. Slot order matters because polygons index into it.

| Object | slot 0 | slot 1 | slot 2 |
| --- | --- | --- | --- |
| `Blinder_01_Lens` … `Blinder_06_Lens` (6) | `MAT_Fixture_Body` | `MAT_Lens_Glow` | |
| `Crest_Chevron` | `MAT_Crystal` | `MAT_Gold_Trim` | |
| `Crest_Crystal` | `MAT_Crystal` | `MAT_Gold_Trim` | |
| `Pillar_L_Base`, `Pillar_R_Base` | `MAT_Gold_Dark` | `MAT_Gold_Trim` | |
| `Pillar_L_Cap`, `Pillar_R_Cap` | `MAT_Pillar_Body` | `MAT_Gold_Trim` | |
| `Podium_Desk` | `MAT_Dark_Trim` | `MAT_Gold_Trim` | |
| `Podium_Monitor` | `MAT_Dark_Trim` | `MAT_Gold_Trim` | |
| `Podium_Panels` | `MAT_Gold_Dark` | `MAT_Dark_Trim` | |
| `Podium_Riser` | `MAT_LED_Screen` | `MAT_Gold_Dark` | |
| `Podium_Top` | `MAT_Dark_Trim` | `MAT_Gold_Trim` | |
| `Podium_Trim` | `MAT_Gold_Dark` | `MAT_Gold_Trim` | |
| `Pointer_Flapper` | `MAT_Crystal` | `MAT_Gold_Trim` | `MAT_Metal_Polished` |
| `Wall_Fascia` | `MAT_Gold_Dark` | `MAT_Gold_Trim` | |
| `Wheel_Axle` | `MAT_Metal_Polished` | `MAT_Gold_Dark` | |
| `Wheel_BasePlate` | `MAT_Dark_Trim` | `MAT_Gold_Trim` | |
| `Wheel_CrossBar` | `MAT_Dark_Trim` | `MAT_Gold_Dark` | |
| `Wheel_Legs` | `MAT_Metal_Polished` | `MAT_Gold_Dark` | |
| `Wheel_Pegs` | `MAT_Peg_Metal` | `MAT_Gold_Trim` | |

Consequence for the export and for `src/scene.rs`: a glTF export splits each of these into one
primitive per material, so **the GLB has more primitives than the scene has objects**. Anything that
matches materials by object name has to cope with an object owning two or three of them.
`Podium_Riser` is the awkward one: it carries `MAT_LED_Screen`, the same material as `Wall_Screen`.
If `src/screen.rs` binds the sky shader by material name it will also paint the front of the podium
riser. Bind by primitive or by object name, not by material alone.

### Objects with no material

**None.** All 153 meshes have at least one slot, no slot is empty, and every slot holds a real
material. Nothing needs a fallback material.

Other mesh data facts the exporter will care about: all 153 meshes have exactly one UV layer named
`UVMap`; no mesh has a colour attribute and no mesh has a vertex group; no mesh datablock is shared
between objects, so there is nothing to instance. 74 of the 153 meshes have at least one
smooth-shaded polygon, but **no mesh carries custom split normals** (`has_custom_normals` is false
everywhere), so smooth shading comes purely from the per-polygon `use_smooth` flag. The export must
write per-vertex normals and must not force flat shading; a flat-shaded export would faceted every
bulb, every peg and the whole truss.

## 5. Modifiers and geometry nodes

**There are no geometry-nodes modifiers and no node groups in the file** (`bpy.data.node_groups` is
empty). There are five modifiers total, all `BEVEL`, all with `show_render` and `show_viewport`
enabled:

| Object | modifier | width (m) | segments | raw polys → eval polys | raw tris → eval tris |
| --- | --- | --- | --- | --- | --- |
| `Wheel_Legs` | `Bevel` | 0.010000 | 2 | 634 → 1 850 | 980 → 3 412 |
| `Podium_Trim` | `Bevel` | 0.007206 | 1 | 280 → 700 | 532 → 1 260 |
| `Podium_Body` | `Bevel` | 0.014412 | 1 | 70 → 98 | 112 → 168 |
| `Podium_Desk` | `Bevel` | 0.008647 | 1 | 12 → 52 | 24 → 88 |
| `Podium_Riser` | `Bevel` | 0.007206 | 1 | 12 → 52 | 24 → 88 |

**All five must be applied at export.** They are visible in the render, so leaving them out changes
the silhouette of the wheel legs and every podium edge — the `podium` crop region checks exactly
those edges. The standard glTF exporter applies modifiers by default (`export_apply=True`); the
export just needs to not turn that off. Applying them adds 1 744 polygons and 3 344 triangles to the
scene, which is the whole difference between the raw and evaluated counts in section 9.

Nothing else is procedural. Verified counts: `bpy.data.node_groups` 0, `bpy.data.actions` 0,
`bpy.data.armatures` 0, `bpy.data.particles` 0, `bpy.data.shape_keys` 0, `bpy.data.textures` 0,
`bpy.data.libraries` 0. No object has a constraint, no object has animation data, and no object is
an instancer (`instance_type` is `NONE` and `is_instancer` false on all 163). There is one scene,
`Stage`. The geometry is static and fully baked into mesh data plus these five bevels.

## 6. Transform hygiene

The scene is clean. Checked across all 163 objects:

- **Non-uniform scale: none.** Every object's `scale` is exactly `(1.0, 1.0, 1.0)`.
- **Negative scale: none.** No mirrored object, so no winding order or normal flips to fix.
- **Non-unit world scale: none.** Every `matrix_world` decomposes to scale `(1,1,1)`.
- **Non-identity delta transforms: none.** `delta_location` is `(0,0,0)`, `delta_rotation_euler` is
  `(0,0,0)`, `delta_rotation_quaternion` is `(1,0,0,0)` and `delta_scale` is `(1,1,1)` for every
  object.
- **Non-identity `matrix_parent_inverse`: none.** Every parented object's `matrix_local` is exactly
  its `location`/`rotation_euler`/`scale`, so parent-relative transforms are readable straight off
  the object.
- `rotation_mode` is `XYZ` on all 163 objects. No quaternion or axis-angle objects.

So `matrix_world` is a rigid transform for every object, and any exporter or importer that only
handles translation plus rotation is safe here.

### Parenting

57 objects are unparented; the rest hang off six kinds of parent. Every parent link is
`parent_type = OBJECT`, so there are no vertex-parents or bone-parents to translate.

| Parent | children | children's `matrix_local` |
| --- | --- | --- |
| `Wheel_Root` | 56 | all identity |
| `Wheel_Stand` | 4 | all identity |
| `Crest_Root` | 4 | identity except `Pointer_Flapper`, translated `(0, 0.245, 0.120)` |
| `MH_nn_Base` → `MH_nn_Yoke` → `MH_nn_Head` → `MH_nn_Lens` | 3 links × 12 | yoke and lens at zero offset, head offset `(0, 0, −0.42)`; rotations on the yoke and head |
| `Blinder_nn_Body` → `Blinder_nn_Lens` | 1 link × 6 | zero offset, rotation only |

The moving heads are three levels deep. The exporter must either keep the nesting or bake each
child's `matrix_world`; taking `matrix_local` and treating it as a world transform puts twelve
moving heads at the origin.

52 objects have a non-zero local rotation; they are the two beam spots, the four area lights, the
camera, the 12 moving-head yokes and heads, the 6 blinder bodies and lenses, and the 7 podium parts
(all 7 share `rotation_euler.z = 0.464258`, so the podium is one rigid assembly rotated to face the
wheel). Every wheel part, every wall part, the floor and the pillars are at rotation zero.

## 7. Camera `Cam_Hero`

Measured camera data:

| Property | Value |
| --- | --- |
| type | `PERSP` |
| `lens` | 22.0 mm |
| `sensor_fit` | **`HORIZONTAL`** |
| `sensor_width` | 36.0 mm |
| `sensor_height` | 24.0 mm (ignored: fit is horizontal) |
| `shift_x`, `shift_y` | 0.0, 0.0 |
| `clip_start`, `clip_end` | 0.05 m, 200.0 m |
| depth of field | off |
| location | (0, −6.4, 1) |
| `rotation_euler` XYZ | (1.850049, 0, 0) rad = (106.0°, 0, 0) |

### Field of view at 1672 × 941

`sensor_fit` is `HORIZONTAL`, so the 36 mm sensor dimension is the **horizontal** one regardless of
the render aspect, and the horizontal FOV is fixed by the lens alone:

```
hfov = 2 · atan(36 / (2 · 22)) = 1.37145901 rad = 78.578813°
```

Pixel aspect is 1:1 (`pixel_aspect_x = pixel_aspect_y = 1.0`) and `resolution_percentage` is 100, so
the render aspect is `1672 / 941 = 1.77683316`. The vertical FOV follows:

```
vfov = 2 · atan( tan(hfov / 2) / aspect )
     = 2 · atan( 0.81818182 / 1.77683316 )
     = 2 · atan( 0.46047194 )
```

> **`vfov = 0.86305637 rad = 49.449488°`** at 1672 × 941.
> `tan(vfov / 2) = 0.46047194`.

Do not use `camera.angle_y`. Blender computes that from `sensor_height = 24 mm`, giving 57.220921°,
which is the FOV of a 3:2 frame and is **wrong for this render**. `three-d`'s
`Camera::new_perspective` takes the vertical field of view, so pass 0.86305637 rad, or recompute it
from `hfov` and the actual viewport aspect so that resizing the window keeps the horizontal framing.

### Orientation

From `matrix_world`, with the Blender convention that a camera looks down its local −Z and its local
+Y is up:

| Axis | Vector |
| --- | --- |
| right (local +X) | (1, 0, 0) |
| up (local +Y) | (0, −0.275637, 0.961262) |
| **forward (local −Z)** | **(0, 0.961262, 0.275637)** |

The forward vector is 16.0000° above the horizon, exactly. The camera stands 1 m off the floor at
6.4 m in front of the wheel plane and tilts up at the wheel.

### Orbit target

The wheel centre is `Wheel_Root` at `(0, 1.2, 3.5)`, 8.000625 m from the camera. The camera axis
does not pass through it: the closest point on the axis to the wheel centre is
`(0, 1.284982, 3.203633)`, 7.994682 m along forward, which sits 0.296 m below the wheel centre and
0.085 m past the wheel plane — a total miss of 0.308 m. The hero shot deliberately places the wheel
centre above the middle of the frame.

Two usable targets, pick by what matters:

1. **Framing-exact hero target `(0, 1.285, 3.204)` with radius 7.9947 m.** Building the view as
   `look_at(position = target − forward · radius, target, up = (0, 0, 1))` reproduces
   `Cam_Hero.matrix_world` exactly: the position comes back to `(0, −6.4, 1)` and, because the
   camera has no roll, the derived right and up axes come back to `(1, 0, 0)` and
   `(0, −0.275637, 0.961262)`. So the default shot matches `docs/wheel_stage.png` framing for
   framing. Use this for `--shot` and for the default view.
2. Wheel centre `(0, 1.2, 3.5)` with radius 8.0006 m, if the orbit must feel centred on the wheel
   while the user drags. Switching to it shifts the framing up by 0.308 m, which is 8.4% of the
   half-frame height at that distance — visible against the reference, so do not use it for `--shot`.

At the hero distance the frame covers ±3.684 m vertically and ±6.546 m horizontally, so the 5.2 m
wheel fills about 71% of the frame height.

Sensible orbit limits, given the set: the wall is a closed cylinder of radius 11.3 m and the floor
starts at z = 0, so keep the orbit radius under about 9.5 m and the elevation between roughly 0° and
50° to stay inside the room and above the floor. `clip_start = 0.05` and `clip_end = 200` are
generous for a 24 m set; a near plane of 0.05 m over a 200 m range wastes depth precision, so
tightening the far plane to about 60 m is free.

## 8. Render versus viewport visibility

**No mismatch anywhere.** For all 163 objects:

- `hide_viewport` is false;
- `hide_render` is false;
- `hide_get()` (the per-view-layer eye toggle) is false;
- no collection has `hide_viewport` or `hide_render` set;
- the single view layer `ViewLayer` is enabled.

The only non-default visibility flag in the file is `visible_camera = False` on the six light
objects. That is Blender's factory default for lights — verified against a fresh
`--factory-startup` scene, where a newly added area light also reports `visible_camera = False`
while a new mesh reports `True`. It is not an authored override and it does not affect any geometry.

So the exporter can take the whole scene without a visibility filter, and every mesh that shows in
the viewport also shows in the render.

## 9. Triangle count

Evaluated, with the five bevel modifiers applied, summing `loop_count − 2` per polygon:

| Measure | Raw mesh data | After modifier evaluation |
| --- | --- | --- |
| Vertices | 77 380 | 79 052 |
| Polygons | 85 047 | 86 791 |
| **Triangles** | **150 048** | **153 392** |

> **Total triangle count after modifier evaluation: 153 392.**

The five bevels account for the whole difference: +1 672 vertices, +1 744 polygons, +3 344
triangles. The raw numbers 77 380 vertices and 85 047 polygons match the plan's ground truth, which
confirms both readings describe the same file.

Per collection: `30_Wheel` 59 904, `60_Rig` 48 088, `20_Wall` 25 984, `40_Pillars` 8 624,
`10_Floor` 6 784, `50_Podium` 4 008.

Where the triangles go, in case something needs decimating: `MAT_Gold_Trim` 39 878,
`MAT_Truss_Metal` 29 104, `MAT_Bulb_Glass` 16 128, `MAT_Peg_Metal` 13 824, `MAT_Fixture_Body`
13 608. Two objects dominate: `Wheel_Bulbs` is 16 128 triangles for 96 smooth spheres and
`Wheel_Pegs` is 14 976 for 48 studs plus their collars. Both are tiny on screen and are the obvious
first candidates if the frame rate needs help. The 48 sectors together are only 1 728 triangles.

At 153 k triangles the whole scene is one comfortable draw batch for `three-d`; nothing here needs
LODs or culling work.

## 10. Other findings the renderer needs

- Render engine is `BLENDER_EEVEE`, `film_transparent` off, view transform **Filmic**, look `None`,
  exposure 0, gamma 1. Frame range 1–250, current frame 1, and no object is animated, so any frame
  gives the same geometry.
- World is `Stage_World`, a single Background node: colour `(0.01, 0.008, 0.02)` linear, strength
  1.0. No HDRI, no environment texture. In practice a near-black ambient term.
- Images in the file: `T_LEDWall_Sky` pointing at
  `unity/GameShow_v3/Assets/Art/Textures/T_LEDWall_Sky.png`, declared 4096 × 1024, `has_data`
  false — the file does not load. Also `wheel_stage.png` at `//../Ref/wheel_stage.png`, likewise not
  loaded, which is the reference image used as a backdrop while modelling. Neither is available, so
  nothing textured can be recovered from the .blend; this is the known defect from the plan and
  `src/screen.rs` replaces it procedurally.
- No linked libraries, so the file is self-contained apart from those two images.

## 11. Corrections to `agent_plan.md`

These measurements contradict the plan. The plan should be read with these substitutions.

1. **19 materials, not 20.** `bpy.data.materials` holds exactly 19:
   `MAT_Bulb_Glass`, `MAT_Crystal`, `MAT_Dark_Trim`, `MAT_Fixture_Body`, `MAT_Floor_Gloss`,
   `MAT_Gold_Dark`, `MAT_Gold_Trim`, `MAT_LED_Screen`, `MAT_Lens_Glow`, `MAT_Metal_Polished`,
   `MAT_Peg_Metal`, `MAT_Pillar_Body`, `MAT_Sector_Blue`, `MAT_Sector_Cream`, `MAT_Sector_Cyan`,
   `MAT_Sector_Gold`, `MAT_Sector_Pink`, `MAT_Sector_White`, `MAT_Truss_Metal`.
   **`MAT_Rubber_Black` does not exist in the file.** The plan's material table lists it with
   base colour `(0.03, 0.03, 0.03)`, roughness 0.60. It has no users and no objects; whoever wrote
   the plan table either read a stale version or the material was dropped when the file was last
   saved. Do not create it and do not expect it in the GLB.
2. **The missing image is `T_LEDWall_Sky`, not `TEX_LED_Cyclorama.png`.** The defect the plan
   describes is real — `MAT_LED_Screen` references an image whose file will not load — but the
   datablock name and path are
   `T_LEDWall_Sky` → `unity/GameShow_v3/Assets/Art/Textures/T_LEDWall_Sky.png`, 4096 × 1024. The
   conclusion is unchanged: replace it with the procedural sky.
3. **`MAT_LED_Screen` is on two objects, not one.** `Wall_Screen` and also slot 0 of
   `Podium_Riser`. See the warning at the end of section 4.
4. **`30_Wheel` holds 67 objects, of which 64 are meshes.** The plan's listing of `30_Wheel` is
   correct in content; it just reads as though `Wheel_Sector_01..48` plus the named parts were the
   whole collection. Count: 3 empties + 8 wheel parts + 48 sectors + 4 stand parts + 4 crest parts
   (`Crest_Crystal`, `Crest_Chevron`, `Crest_Stalk`, `Pointer_Flapper`) = 67.
5. **The plan's 85 047 polygons is the raw count.** After the five bevels the scene is 86 791
   polygons and 153 392 triangles. Anything comparing an export against the plan's number will see
   a mismatch that is not an error.
6. **The camera's vertical FOV is 49.449488°, not `camera.angle_y` (57.220921°).** `sensor_fit` is
   `HORIZONTAL`, so `sensor_height` never enters the render. Section 7 has the derivation.
