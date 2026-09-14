---
name: blender-mcp
description: What the Blender MCP tool schemas do not tell you — how a background (headless) Blender differs from one in a window, and which calls fail there.
---
# Headless Blender

Every tool here talks to one `blender -b` process. There is no window, no 3D viewport
and no UI.

The tool list already says what each tool takes and returns. This file covers what it
cannot: the ways a background Blender differs from the one you know.

## A call to `execute_blender_code`

- The code runs in a fresh namespace. `result` starts as `{}`. Names do not survive
  between calls. Re-import `bpy` every time.
- Assign a dict to `result` to return data. The last expression is not returned. A
  non-dict `result` is an error.
- Values that are not JSON — Blender objects, Vectors, sets — come back as `repr()`
  strings. Convert vectors with `list(v)` and matrices with `[list(r) for r in m]`.
- `print()` output comes back in `stdout`. Prefer `result`.
- An exception returns the full traceback. Nothing is rolled back. Inspect the scene
  after an error before you retry.
- `sys.exit()` is blocked, and so are `bpy.ops.wm.quit_blender`,
  `wm.read_factory_settings`, `wm.read_factory_userpref` and `wm.read_userpref`. For a
  clean scene call `bpy.ops.wm.read_homefile(use_empty=True)`.
- A request may be at most 10 MiB, and the client waits 300 s for the answer. Return
  counts and names, not whole vertex arrays.

## There is no window, so context is half missing

`bpy.context.window`, `screen`, `area` and `region` are `None`. Screen-level members do
not exist at all: `bpy.context.active_object` and `bpy.context.selected_objects` raise
`AttributeError`, and `hasattr` is False for both. `bpy.context.view_layer.objects.active`,
`bpy.context.scene` and `bpy.context.view_layer` still work.

Prefer `bpy.data` over `bpy.ops`. It needs no context:

```python
import bpy
mesh = bpy.data.meshes.new("Part")
mesh.from_pydata(verts, [], faces)
mesh.update()
obj = bpy.data.objects.new("Part", mesh)
bpy.context.scene.collection.objects.link(obj)   # an unlinked object is invisible
obj.modifiers.new("Bevel", 'BEVEL')
result = {"created": obj.name}
```

Operators that need only `scene` and `view_layer` work as they are:
`bpy.ops.mesh.primitive_*_add`, `object.modifier_apply`, `object.transform_apply`,
`object.mode_set`, `object.join`, `object.parent_set`, `render.render`,
`wm.save_mainfile`.

Operators that read `context.active_object` or `context.selected_objects` fail with
`AttributeError`. `bpy.ops.export_scene.gltf` is one of them (verified on Blender
5.1.2). Override the context with the window stored in the file. This is the general
fix for any operator that reports a missing context member:

```python
import bpy
wm = bpy.data.window_managers[0]
win = wm.windows[0]
with bpy.context.temp_override(window=win, screen=win.screen):
    bpy.ops.export_scene.gltf(filepath="/abs/path/out.glb", export_format="GLB", use_selection=False)
result = {"exported": "/abs/path/out.glb"}
```

Operators that read the viewport or the mouse fail even with the override:
`bpy.ops.view3d.*` and `bpy.ops.screen.*`. Call `bpy.ops.<op>.poll()` when you are
unsure.

## Values you read back can be stale

`matrix_world`, `dimensions`, bounding boxes and modifier results lag behind a change.
Update the depsgraph first:

```python
import bpy
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
ob_eval = bpy.data.objects["Part"].evaluated_get(dg)
me_eval = ob_eval.to_mesh()          # modifiers applied
result = {"polys": len(me_eval.polygons), "world": [list(r) for r in ob_eval.matrix_world]}
ob_eval.to_mesh_clear()
```

## Editing a mesh

Edit in object mode with bmesh. That path needs no mode switch:

```python
import bpy, bmesh
me = bpy.data.objects["Part"].data
bm = bmesh.new()
bm.from_mesh(me)
bmesh.ops.inset_region(bm, faces=bm.faces[:], thickness=0.02)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
bm.to_mesh(me)      # forget this line and every edit is lost
bm.free()
me.update()
result = {"verts": len(me.vertices), "faces": len(me.polygons)}
```

Never touch `mesh.vertices` while the object is in edit mode. If you do enter edit
mode, use `bmesh.from_edit_mesh`, call `bmesh.update_edit_mesh`, and leave the object
in object mode at the end of the call.

## Files and paths

- Nothing reaches disk on its own. `save_blend_file` is the only thing that writes the
  open file. Save before any risky step.
- Ignore `is_dirty` in `get_blendfile_summary_path_info`. It mirrors the window state,
  which a background Blender never maintains. Your edits leave it False. Read
  `age_seconds` to see how long ago the file was written.
- Use absolute paths everywhere. A relative path resolves against the current `.blend`,
  which may never have been saved.
- Exporters move between Blender versions: OBJ, USD, STL and PLY live under
  `bpy.ops.wm.*` in some releases and under `bpy.ops.export_scene.*` in others. Find
  the name with `get_python_api_docs("bpy.ops.export_scene.*")` before you call it.

## Rendering a preview

`render_thumbnail_to_path` is the way to see the scene. A render needs a camera:
create one and set `scene.camera`, or the call fails.

```python
import bpy, math
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 16
cam = bpy.data.objects.new("PreviewCam", bpy.data.cameras.new("PreviewCam"))
scene.collection.objects.link(cam)
cam.location = (6, -6, 4)
cam.rotation_euler = (math.radians(60), 0, math.radians(45))
scene.camera = cam
result = {"engine": scene.render.engine, "camera": cam.name}
```

- Blender 5.1 has three engine ids: `'BLENDER_EEVEE'`, `'BLENDER_WORKBENCH'` and
  `'CYCLES'`. `BLENDER_EEVEE_NEXT` was 4.2-4.5 and is gone. All three render headless.
- `BLENDER_WORKBENCH` is the cheapest look-check and needs no lights. `CYCLES` with
  `cycles.device = 'CPU'` is the safe choice on a machine without a usable GPU.
- `render_thumbnail_to_path` lowers the sample count for Cycles only. On EEVEE set
  `scene.eevee.taa_render_samples` yourself first.
- `render_viewport_to_path` is a full `bpy.ops.render.render`, not a viewport capture,
  and it uses the scene's own resolution and samples. Lower both yourself or the call
  runs past the 300 s timeout.

## Small traps

- Blender renames on collision: a second `Part` becomes `Part.001`. Capture the
  reference the moment you create an object. Never look one up by a name you assumed.
- Check `scene.unit_settings` before you create sized geometry. The default is meters.
- Check `obj.rotation_mode` before you write `rotation_euler` or `rotation_quaternion`.
  The wrong property is ignored in silence.
- Check `mesh.users` before you edit a mesh. Shared data changes every user.
- Delete with `bpy.data.objects.remove(obj, do_unlink=True)`, so the object leaves
  every collection.
- The API changes between versions. One `search_api_docs` call costs less than one
  failed operator call.
