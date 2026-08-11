---
name: blender-to-unity-models
description: Rules for authoring Blender models that survive an FBX export into a Unity URP project — face winding, units, pivot hierarchy, materials — plus the audit scripts that catch each defect. Use when building or editing geometry in Blender for Unity, when exporting FBX, or when an imported model shows see-through surfaces, wrong scale, or flat grey materials.
---

# Blender → Unity models

Blender forgives things Unity does not. Blender's viewport and its renderers draw both sides of every face, so a mesh can be badly built and still look perfect on screen. Unity's URP Lit shader culls back faces. The defects below are all invisible in Blender and obvious in Unity.

Never judge a model by how it looks in Blender. Audit it with the scripts at the bottom.

## Face winding must point outward

This is the defect that bites hardest. A face wound inward is not drawn in Unity, so you see straight through the solid into whatever is behind it.

Script-built geometry is the usual source. Extrusions, spun profiles and hand-assembled boxes all produce inconsistent winding unless the script is careful.

- Every face of a closed mesh must be wound outward.
- Recalculate winding before every export, not once at the end.
- `bmesh.ops.recalc_face_normals` is the fix. It is shape-preserving: it reverses faces and changes nothing else.

Two preconditions make the recalculation trustworthy. Check both first.

- **The mesh must be closed.** On an open shell "outward" has no meaning, and a recalculation picks an arbitrary side. Measure boundary edges: an edge with one linked face is a boundary edge, and a closed mesh has none.
- **No object may have negative scale.** A negative scale mirrors the object, which turns outward-in-local into inward-in-world. Recalculating a mirrored object makes it worse. Apply the mirror into the mesh data instead, then recalculate.

## Leave text and curves alone

Blender converts FONT and CURVE objects to mesh at export. Those meshes are open shells — a glyph's caps and side walls do not share edges, so they carry thousands of boundary edges.

Do not recalculate winding on them. Their front faces are already correct, and a recalculation can flip them and make the text vanish. Restrict the recalculation to `o.type == "MESH"`.

Text also needs `object_types={'EMPTY', 'MESH', 'OTHER'}` in the export call. `OTHER` is what carries FONT and CURVE. Omit it and every label silently disappears.

## Build at real-world metres

Both Blender and Unity treat one unit as one metre. Keep `scene.unit_settings.scale_length` at 1 and model at true size.

FBX declares its own unit scale in the file header, and Blender bakes a matching 100× scale into the root object. The two cancel out, but only if the Unity importer is left consistent.

- Unity `ModelImporter`: `useFileScale = true`, `globalScale = 1`.
- **Aim for an identity root.** `apply_scale_options="FBX_SCALE_ALL"` puts the metre→centimetre factor in the FBX header, so Unity reports `fileScale = 1` and the root imports at `localScale = 1`. `FBX_SCALE_NONE` bakes that factor into the object transforms instead, and the root arrives at `localScale = 100` with children whose `localPosition` reads in centimetres.
- **Verify world bounds, never local transforms.** A child's `localPosition` reads in the root's scaled units. Encapsulate every `MeshRenderer.bounds` and check the total size in metres.

## Bake the up-axis conversion, or the root arrives rotated

Blender is Z-up and Unity is Y-up. Left alone, the exporter emits that conversion as a **270.02° X rotation on the root object** — not 270°, so the model is also slightly tilted. Code that writes the root's rotation then fights the conversion, and the set cannot be dropped in at identity.

- `bake_space_transform=True` bakes the conversion into the mesh data and the root imports at identity. It is a pure rotation, so face winding is preserved.
- Blender marks the option experimental because it misbehaves with deep hierarchies and animation. It is safe for a flat hierarchy of identity-transform meshes under one empty. Re-run the winding audit after changing it, every time.
- Unity's importer-side `bakeAxisConversion = true` is **not** an equivalent. Measured on this project it left a 89.98° rotation on the root and perturbed vertices enough to make the audit flag triangles that were clean before.

## Put moving parts under their own empty

Anything Unity code will rotate or slide needs a dedicated pivot.

- Add an EMPTY at the exact centre of rotation. Parent only the moving geometry to it.
- Keep static geometry on a sibling or on the parent root. A wheel's rim, face and pegs belong under the spin empty; its stand, mast and pointer do not.
- Give the empty a stable name. Unity code finds it by name, so renaming it breaks the controller.
- Leave the empty's own transform meaningful. Unity code overwrites its rotation, so any authored angle on the spin axis is lost.

Rotation sign flips across the export. Blender is right-handed and Unity is left-handed, so a child's local Y rotation in Unity is the negation of Blender's. Derive the mapping by measuring one known landmark in Unity rather than by reasoning about axes.

## Materials do not cross the FBX

An FBX carries a material name and a diffuse colour. It carries none of a Principled BSDF's metallic, roughness, coat or emission. A model built with procedural PBR and no textures arrives in Unity looking flat.

Plan for a rebuild step:

- Export the Blender values first: base colour, metallic, roughness, emission colour, emission strength, per material.
- Import with `materialImportMode = ImportStandard` so Unity generates one URP Lit material per Blender material name, then set the values on those assets.
- `materialLocation = External` is deprecated and spams warnings. Use `materialLocation = InPrefab` plus `importer.AddRemap(new AssetImporter.SourceAssetIdentifier(typeof(Material), name), mat)` to point the model at material assets you control.
- **Base colour needs converting.** Blender's base colour is linear. Unity treats a material `Color` property as gamma. Pass `blenderColor.gamma`.
- **A base map replaces the colour in Blender but multiplies it in Unity.** A texture linked into Principled's Base Color socket overrides the constant. URP Lit computes albedo as `_BaseMap * _BaseColor`. Carry the Blender constant across only for materials with no base map; set `_BaseColor` to white wherever a base map exists, or every textured surface arrives double-darkened.
- **A Blender roughness map has no URP socket.** URP Lit reads metallic from `_MetallicGlossMap.r` and smoothness from its alpha. Pack an RGBA map with `r = metallic` and `a = 1 - roughness`, then `EnableKeyword("_METALLICSPECGLOSSMAP")`. Import it with `sRGBTexture = false` and `alphaSource = FromInput`, or the alpha is discarded.
- **Emission does not.** `_EmissionColor` is an `[HDR]` property and stays linear. Pass the linear colour multiplied by the Blender strength, then `EnableKeyword("_EMISSION")` and set `globalIlluminationFlags = RealtimeEmissive`.
- Smoothness is the inverse of roughness: `1 - roughness`.

## Known-good export call

```python
bpy.ops.export_scene.fbx(
    filepath=out,
    check_existing=False,
    use_selection=False,
    object_types={"EMPTY", "MESH", "OTHER"},  # OTHER carries FONT and CURVE
    global_scale=1.0,
    apply_unit_scale=True,
    apply_scale_options="FBX_SCALE_ALL",   # header carries the unit scale -> root at scale 1
    use_space_transform=True,
    bake_space_transform=True,             # Z-up -> Y-up into the mesh -> root at rotation 0
    use_mesh_modifiers=True,
    mesh_smooth_type="FACE",
    use_triangles=False,        # Unity triangulates on import
    use_custom_props=False,
    bake_anim=False,            # set True only if the model carries animation
    path_mode="COPY",
    embed_textures=False,
    axis_forward="-Z",
    axis_up="Y",
)
```

Lights and cameras are excluded by leaving `LIGHT` and `CAMERA` out of `object_types`. Blender lighting does not translate to Unity, so light rigs must stay in Blender.

## Working in a live Blender session

The MCP tools drive whatever file Blender currently has open, which may not be the file the task names. Confirm they match before exporting — compare `get_blendfile_summary_path_info` against the target path, and compare checksums if the paths differ.

A session is often dirty before the work starts. Fixing geometry in the session fixes the export but not the file on disk, so the next export from disk regresses. Report that the file needs saving. Do not save it unprompted: the session may hold unrelated unsaved edits that saving would commit.

Selection and active object are global state. Snapshot both before running operators and restore them afterwards.

## Audit before export — Blender side

Read-only. Runs the recalculation on a throwaway bmesh and counts what would change.

```python
import bpy, bmesh

dg = bpy.context.evaluated_depsgraph_get()
bad, totals = [], {"faces": 0, "flipped": 0, "boundary": 0}

mirrored = [o.name for o in bpy.data.objects
            if o.type == "MESH" and o.scale.x * o.scale.y * o.scale.z < 0]

for o in bpy.data.objects:
    if o.type != "MESH":
        continue
    ev = o.evaluated_get(dg)
    me = ev.to_mesh()
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.normal_update()
    before = [f.normal.copy() for f in bm.faces]
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.normal_update()
    flipped = sum(1 for f, n in zip(bm.faces, before) if f.normal.dot(n) < 0.0)
    boundary = sum(1 for e in bm.edges if len(e.link_faces) == 1)
    totals["faces"] += len(bm.faces)
    totals["flipped"] += flipped
    totals["boundary"] += boundary
    if flipped or boundary:
        bad.append({"obj": o.name, "faces": len(bm.faces),
                    "flipped": flipped, "boundary": boundary})
    bm.free()
    ev.to_mesh_clear()

result = {"mirrored_objects": mirrored, "totals": totals, "problems": bad}
```

`flipped` and `boundary` must both be 0, and `mirrored_objects` must be empty. To apply the fix, repeat the loop over `{o.data for o in bpy.data.objects if o.type == "MESH"}` and add `bm.to_mesh(me)` plus `me.update()` when `flipped` is non-zero.

## Audit after import — Unity side

This is the check that proves the export and the import both preserved the winding. A front face in Unity is wound clockwise, so `Cross(b - a, c - a)` is its outward normal, and it must agree with the imported vertex normals.

```csharp
var importer = (ModelImporter)AssetImporter.GetAtPath(path);
importer.isReadable = true;          // required to read triangles; restore afterwards
importer.SaveAndReimport();

var go = AssetDatabase.LoadAssetAtPath<GameObject>(path);
long tris = 0, against = 0;
int examined = 0, skipped = 0;

foreach (var mf in go.GetComponentsInChildren<MeshFilter>(true))
{
    var mesh = mf.sharedMesh;
    if (mesh == null || !mesh.isReadable) { skipped++; continue; }
    var verts = mesh.vertices;
    var norms = mesh.normals;
    if (norms.Length != verts.Length) { skipped++; continue; }
    examined++;
    for (int sub = 0; sub < mesh.subMeshCount; sub++)
    {
        var idx = mesh.GetTriangles(sub);
        for (int i = 0; i + 2 < idx.Length; i += 3)
        {
            Vector3 a = verts[idx[i]], b = verts[idx[i + 1]], c = verts[idx[i + 2]];
            Vector3 geo = Vector3.Cross(b - a, c - a);
            Vector3 shaded = norms[idx[i]] + norms[idx[i + 1]] + norms[idx[i + 2]];
            if (geo.sqrMagnitude < 1e-16f || shaded.sqrMagnitude < 1e-12f) { continue; }
            tris++;
            if (Vector3.Dot(geo.normalized, shaded.normalized) < 0f) { against++; }
        }
    }
}
// against must be 0, and skipped must be 0 — a skipped mesh is an unaudited mesh.
importer.isReadable = false;
importer.SaveAndReimport();
```

Always report `examined` and `skipped` alongside the triangle count. A `0%` failure rate over a partial sweep proves nothing. Set the degenerate-triangle threshold low (`1e-16f`), because a coarse threshold discards the small text triangles and shrinks coverage without saying so.

**Judge a failure by how negative the dot product is, not by its sign.** A genuinely inverted face gives a dot near `-1`. A dot between `-0.05` and `0` means the face is *perpendicular* to its smoothed normal, which is what happens on the small triangles rounding a tight corner of a swept moulding — the vertex normals there average across a near-90° bend. Those are shading artifacts, not winding errors. Report the dot range and the triangle areas before concluding anything, and cross-check against the Blender-side audit: `flipped = 0` with `boundary = 0` on a closed mesh already proves the winding is outward.

## Checklist

Before export:

- [ ] `flipped` is 0 and `boundary` is 0 across all MESH objects
- [ ] no object has negative scale
- [ ] moving geometry sits under a named EMPTY at its rotation centre
- [ ] `scene.unit_settings.scale_length` is 1 and the model is at true size
- [ ] material values (base colour, metallic, roughness, emission) are recorded for the Unity rebuild

After import:

- [ ] Unity winding audit reports 0 failures with 0 meshes skipped
- [ ] world bounds match the intended real-world size in metres
- [ ] renderer count matches the exported object count, and no material slot is null
- [ ] captured from the front, the back, and close up on any thin or stacked geometry
