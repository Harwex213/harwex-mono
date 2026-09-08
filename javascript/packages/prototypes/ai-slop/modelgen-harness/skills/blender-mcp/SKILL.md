---
name: blender-mcp
description: How to build and inspect a Blender scene through the Blender MCP tool set when the tools talk to a background (headless) Blender process.
---
# Blender MCP tools

You control one live Blender process. It runs as `blender -b` (background mode) with the
Blender MCP add-on's TCP server. There is no window, no 3D viewport, and no UI.
Every tool below sends Python code to that process and returns JSON.

## How the tools work

Each tool call is one TCP request to the add-on. The add-on runs the code on Blender's
main thread with `exec()`. It sends back one JSON object and closes the connection.
Requests are handled one at a time. A long request blocks the next one.

`execute_blender_code` runs your own Python. The other tools run fixed code that the
server bundles. Both paths return the same envelope:

```json
{"status": "ok", "result": {...}, "stdout": "...", "stderr": "..."}
{"status": "error", "message": "<traceback or message>", "stdout": "...", "stderr": "..."}
```

Rules for `execute_blender_code`:

- The code runs in a fresh namespace. `result` starts as `{}`. Names do not survive
  between calls. Re-import `bpy` every time.
- Assign a dict to `result` to return data. The last expression is NOT returned.
  A non-dict `result` is an error: `The result variable must be a dict`.
- `print()` output is captured. It comes back in `stdout` (and `stderr`). Output also goes
  to Blender's terminal. Prefer `result` over prints; the server prompt says so too.
- Values that are not JSON (Blender objects, Vectors, sets) are converted with `repr()`.
  Convert vectors with `list(v)` and matrices with `[list(r) for r in m]` yourself.
- An exception returns `status: "error"` with the full Python traceback in `message`.
  Nothing is rolled back. Inspect the scene after an error before retrying.
- `sys.exit()` is blocked. `bpy.ops.wm.quit_blender`, `wm.read_factory_settings`,
  `wm.read_factory_userpref` and `wm.read_userpref` are blocked. Use
  `bpy.ops.wm.read_homefile(use_empty=True)` for a clean scene.
- Limits: a request may be at most 10 MiB. The MCP client waits up to 300 s for a reply.
  Background mode has no deferred results: setting `check_is_finished` is rejected.
  Finish the work inside the call.
- Blender itself has no memory limit on `result`, but keep results small. Return
  counts and names, not whole vertex arrays.

Bundled tools run the same way. Their `result` is a fixed dict described below.
The bundled tools always have a `status` key inside `result` as well.

## Tools

### Execute

**`execute_blender_code`** — run Python with `bpy` in the live Blender.

- `code: str` — Python source. Assign a dict to `result`.
- Returns the envelope above. `result` is your dict (non-JSON values as `repr` strings).

```json
{"code": "import bpy\nobjs = [o.name for o in bpy.data.objects]\nresult = {'objects': objs, 'count': len(objs)}"}
```

### Scene inspection

**`get_objects_summary`** — the collection tree of the current view layer with its objects.
Call this first. No parameters.

`result`: `status`, `scene_name`, `active_workspace` (always `null` headless),
`active_object`, `object_mode`, `camera_object`, `collections`.
`collections` is a list with one root entry. Each entry has `name`, `exclude`,
`hide_viewport`, `objects`, `children`. Each object has `name`, `type`, `parent`,
`data_name`, `selected`, `visible`, `hide_viewport`, and `instance_collection` for
collection instances. Lists are sorted by name. Large scenes return large results;
follow up with `execute_blender_code` filters instead of re-calling this.

```json
{}
```

**`get_object_detail_summary`** — one object in detail.

- `name: str` — exact object name.

`result` on success: `status`, `name`, `type`, `location`, `rotation` (Euler, radians),
`scale`, `dimensions`, `parent`, `children`, `modifiers` (`name`, `type`,
`show_viewport`, `show_render`), `constraints` (`name`, `type`, `enabled`),
`materials` (slot list, `null` for empty slots), `visibility` (`hide_viewport`,
`hide_render`, `hide_get`), `data_name`, `collections`.
On a missing name: `status: "error"` and a `message` that lists all object names.

```json
{"name": "Cube"}
```

### Blend-file summaries

All five take no parameters and read the file that is open in the live Blender.

**`get_blendfile_summary_datablocks`** — `datablock_counts` (only non-empty
`bpy.data` collections, e.g. `{"meshes": 3, "objects": 5}`), `render_engine`,
`scene_name`, `workspaces`, `active_workspace` (`null` headless).

**`get_blendfile_summary_path_info`** — `filepath` (empty string when never saved),
`is_saved`, `is_dirty`, `age_seconds`, `file_size_bytes`, `backups`
(list of `path`, `age_seconds`, `size_bytes` for `.blend1`, `.blend2`, ...).
Cheap. Ignore `is_dirty`: it mirrors Blender's window state, which a
`--background` Blender never maintains. Your edits leave it False, and some
files report True however often they are saved. Use `age_seconds` to see how
long ago the file was written instead.

**`get_blendfile_summary_missing_files`** — `missing_files` (list of `id_type`,
`id_name`, `path`), `total_checked`. Packed files and weak references are skipped.

**`get_blendfile_summary_of_linked_libraries`** — `direct_libraries`,
`indirect_libraries` (each item: `filepath`, `name`, `linked_datablocks_count`,
plus `parent_library` for indirect), `total_library_count`.

**`get_blendfile_summary_usage_guess`** — `usage_guesses`: a dict keyed by use-case
name (`Animation`, `Modeling`, `Rendering`, ...). Each value has `score` and
`certainty`, both 0-100. A heuristic. Do not treat it as fact.

```json
{}
```

### Rendering

Both render tools write a PNG and return its path. Neither returns image bytes.
In background mode the render runs synchronously inside the request.

The output path you pass is NOT used as-is. Only `os.path.basename(output_path)` is
kept; any directory you give is dropped. The file lands in
`<bpy.app.tempdir>/blender_mcp/<basename>` (e.g.
`/var/folders/.../T/blender_a1b2c3/blender_mcp/preview.png` on macOS). The returned
`filepath` is the real location. Read it from there. If you need the image somewhere
else, copy it with `execute_blender_code` (`shutil.copy(src, dst)`) after the render.

**`render_thumbnail_to_path`** — fast low-quality preview.

- `output_path: str` — file name, e.g. `"preview.png"`.

It temporarily sets: longest side 320 px (aspect kept), `resolution_percentage` 100,
simplify on with render subdivision 1, 16 samples for Cycles or EEVEE. It restores the
settings afterwards. Uses the scene's current camera and render engine.

`result`: `status`, `filepath`, `message` (on error).

```json
{"output_path": "preview.png"}
```

**`render_viewport_to_path`** — full render with the scene's own settings.
Despite the name it is `bpy.ops.render.render`, not a viewport capture.

- `output_path: str` — file name.

`result`: `status`, `filepath`, `message` (on error). Set resolution and samples
yourself first, or the render may exceed the 300 s client timeout.

```json
{"output_path": "final.png"}
```

### Documentation

These three read RST files bundled with the MCP server. They never touch Blender.

**`get_python_api_docs`** — exact lookup by dotted name.

- `identifier: str` — e.g. `"bpy.types.Object"`, `"bpy.ops.mesh.primitive_cube_add"`,
  `"bpy.props.IntProperty"`. `"*"` lists top-level modules. `"bpy.*"` lists children.

Returns `kind`, `found`, `identifier` plus extra keys by `kind`:
`"exact"` (`content` RST text, `examples` list of `{path, content}`),
`"namespace"` (`submodules`), `"definition"` (`content`, `examples`),
`"partial"` (`parent`, `available`, `submodules`), `"suggestions"` (`suggestions`),
`"missing"`. Files over 32 KB come back as a list of member names; query a member next
(`bpy.ops.object` is one such file).

```json
{"identifier": "bpy.ops.mesh.primitive_cube_add"}
```

**`search_api_docs`** — full-text search over the API reference.

- `query: str` — whitespace tokens, AND-matched, case-insensitive. Stop words dropped.
- `max_results: int = 20`
- `context: int = 0` — extra paragraphs on each side of a hit.
- `index: int | None = None` — re-run the same query and expand one hit to its section.

Returns `hits` (each: `path`, `text`, `breadcrumb`, `index`, `score`) and `truncated`.

```json
{"query": "bmesh from_edit_mesh", "max_results": 5}
```

**`search_manual_docs`** — same parameters and result shape, over the user manual.
Use it for concepts and workflows, not signatures.

```json
{"query": "boolean modifier solver", "max_results": 5}
```

### Background-only variants (`*_for_cli`) — fallbacks

Each of these spawns a NEW `blender --background <blend_file>` process, runs the code
there, and exits. It reopens the .blend on every call. It takes seconds per call and
sees only what is saved on disk (if the live Blender has the same file open with
unsaved changes, the server first saves a numbered copy and uses that).

You already have a live Blender. Prefer the tools above. Use these only when the live
process is stuck, or when you need to inspect a different .blend without opening it.

- `execute_blender_code_for_cli(blend_file: str, code: str)` — returns your `result`
  dict directly (no `status`/`stdout` envelope). Errors raise.
- `get_blendfile_summary_datablocks_for_cli(blend_file: str)`
- `get_blendfile_summary_missing_files_for_cli(blend_file: str)`
- `get_blendfile_summary_of_linked_libraries_for_cli(blend_file: str)`
- `get_blendfile_summary_path_info_for_cli(blend_file: str)`
- `get_blendfile_summary_usage_guess_for_cli(blend_file: str)`

Result shapes match the live variants but without the outer envelope. Timeout 120 s.

```json
{"blend_file": "/abs/path/scene.blend", "code": "import bpy\nresult = {'n': len(bpy.data.objects)}"}
```

### Not available in background mode

These need a window. The add-on returns `status: "error"` with
"not available in background mode" for each. Do not call them.

- `get_screenshot_of_window_as_image`
- `get_screenshot_of_area_as_image`
- `get_screenshot_of_window_as_json`
- `jump_to_tab_by_name`
- `jump_to_tab_by_space_type`
- `jump_to_view3d_object_by_name`
- `jump_to_view3d_object_data_by_name`

To see the scene, render a thumbnail with `render_thumbnail_to_path` instead.

## Working practices

### Inspect before you act

- Never assume the scene state. Call `get_objects_summary` first. Then
  `get_object_detail_summary` for objects you will touch.
- Respect existing names and collection structure. Do not delete or overwrite objects
  the user did not ask about.
- Names get `.001`, `.002` on collision. Capture the reference right after creation.
  Never look an object up by a name you assumed.
- Check `scene.unit_settings` before you create sized geometry. Default is meters.
- Check `obj.rotation_mode` before you write `rotation_euler` or
  `rotation_quaternion`. The wrong property is silently ignored.
- Check `mesh.users` before editing a mesh. Shared data changes every user.

### `bpy.data` first, `bpy.ops` with care

`bpy.data` works everywhere and has no context needs. Prefer it for creation, linking,
materials, modifiers and transforms:

```python
import bpy
mesh = bpy.data.meshes.new("Part")
mesh.from_pydata(verts, [], faces)
mesh.update()
obj = bpy.data.objects.new("Part", mesh)
bpy.context.scene.collection.objects.link(obj)   # unlinked objects are invisible
mod = obj.modifiers.new("Bevel", 'BEVEL')
result = {"created": obj.name}
```

`bpy.ops` operators need context. In background mode `bpy.context.window`,
`screen`, `area` and `region` are `None`. Screen-level context members do not exist
at all: `bpy.context.active_object` and `bpy.context.selected_objects` raise
`AttributeError` (`hasattr` is False). `bpy.context.view_layer.objects.active`,
`bpy.context.scene` and `bpy.context.view_layer` still work. What that means:

- Operators that only need `scene` and `view_layer` work as-is:
  `bpy.ops.mesh.primitive_*_add`, `bpy.ops.object.modifier_apply`,
  `bpy.ops.object.transform_apply`, `bpy.ops.object.mode_set`,
  `bpy.ops.object.join`, `bpy.ops.object.parent_set`, `bpy.ops.render.render`,
  `bpy.ops.wm.save_mainfile`.
- Operators that read `context.active_object` or `context.selected_objects` fail
  with `AttributeError: 'Context' object has no attribute 'active_object'`.
  `bpy.ops.export_scene.gltf` is one (verified on Blender 5.1.2). Fix: override the
  window with the one stored in the .blend file. This is the general fix; use it
  for any operator that fails with a missing context attribute:

```python
import bpy
wm = bpy.data.window_managers[0]
win = wm.windows[0]
with bpy.context.temp_override(window=win, screen=win.screen):
    bpy.ops.export_scene.gltf(filepath="/abs/path/out.glb", export_format="GLB", use_selection=False)
result = {"exported": "/abs/path/out.glb"}
```

- Operators that read the viewport or the mouse fail with "context is incorrect"
  even with the override: `bpy.ops.view3d.*`, `bpy.ops.screen.*`,
  `bpy.ops.transform.*` (mostly), `bpy.ops.object.origin_set` sometimes.
  Set transforms directly instead (`obj.location = ...`, `obj.matrix_world = ...`,
  edit vertices with bmesh).
- Set active object and selection explicitly before every operator call.
  Selection and active object are separate. Operators change both as a side effect.

```python
import bpy
for o in bpy.context.view_layer.objects:
    o.select_set(False)
obj = bpy.data.objects["Part"]
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
bpy.ops.object.modifier_apply(modifier="Bevel")
```

- `temp_override` also accepts data-level keys. Combine them with the window when
  an operator wants a specific object or selection:

```python
with bpy.context.temp_override(window=win, screen=win.screen,
                               object=obj, active_object=obj, selected_objects=[obj]):
    bpy.ops.object.shade_smooth()
```

- Check `bpy.ops.<op>.poll()` before calling when you are unsure.

### Depsgraph and evaluated data

Reading `matrix_world`, `dimensions`, modifier results or bounding boxes right after a
change can give stale values. Update first:

```python
import bpy
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
ob_eval = bpy.data.objects["Part"].evaluated_get(dg)
me_eval = ob_eval.to_mesh()          # modifiers applied
result = {"polys_after_modifiers": len(me_eval.polygons),
          "world_matrix": [list(r) for r in ob_eval.matrix_world]}
ob_eval.to_mesh_clear()
```

### Mesh editing with bmesh

Do not use `mesh.vertices` while an object is in edit mode. Use bmesh, and write back.
In background mode prefer the object-mode path; it needs no mode switch:

```python
import bpy, bmesh
me = bpy.data.objects["Part"].data
bm = bmesh.new()
bm.from_mesh(me)
bmesh.ops.inset_region(bm, faces=bm.faces[:], thickness=0.02)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
bm.to_mesh(me)      # forgetting this loses every edit
bm.free()
me.update()
result = {"verts": len(me.vertices), "faces": len(me.polygons)}
```

If you must use edit mode: `bpy.ops.object.mode_set(mode='EDIT')`, then
`bmesh.from_edit_mesh(me)`, edit, `bmesh.update_edit_mesh(me)`, then
`mode_set(mode='OBJECT')`. Leave the object in object mode at the end of the call.

### Saving and exporting

The live Blender keeps state between calls, but nothing reaches disk until you save.
Save often, and save before any risky operation.

```python
import bpy
bpy.ops.wm.save_as_mainfile(filepath="/abs/path/out.blend")   # first save, or save-as
bpy.ops.wm.save_mainfile()                                     # later saves, same file
bpy.ops.wm.save_as_mainfile(filepath="/abs/path/copy.blend", copy=True)  # copy, keep current path
result = {"saved": bpy.data.filepath}
```

`bpy.data.is_dirty` does not tell you whether there are unsaved changes here —
see `get_blendfile_summary_path_info` above. Keep track of what you changed
since your last save yourself.

Use absolute paths. Relative paths resolve against the current .blend, which may be
unsaved. Export with the file operators, e.g. `bpy.ops.export_scene.gltf(filepath=...)`
and `bpy.ops.export_scene.fbx(filepath=...)`. Exporter names move between Blender
versions (OBJ, USD, STL, PLY live under `bpy.ops.wm.*` in some releases). Find the
one you need first with `get_python_api_docs("bpy.ops.export_scene.*")` or
`execute_blender_code` with `result = {"wm": [n for n in dir(bpy.ops.wm) if "export" in n]}`.
Check the keyword names with `get_python_api_docs` before the call.
For a clean file use `bpy.ops.wm.read_homefile(use_empty=True)`.
To append from another .blend use `bpy.data.libraries.load(path) as (src, dst)`.

### Rendering a preview headless

1. Make sure a camera exists and `scene.camera` is set. Add a light or use a world
   color. A scene with no camera fails to render.
2. Pick an engine. In Blender 5.1 `scene.render.engine` is one of
   `'BLENDER_EEVEE'`, `'BLENDER_WORKBENCH'`, `'CYCLES'`. There is no
   `BLENDER_EEVEE_NEXT` any more (that id was 4.2-4.5). All three render headless
   on macOS (verified on 5.1.2: Workbench ~140 ms, EEVEE ~110 ms, Cycles 16 samples
   ~190 ms at 320x240 for a trivial scene). `BLENDER_WORKBENCH` is the cheapest
   look-check and needs no lights. `CYCLES` with `scene.cycles.device = 'CPU'` is
   the safe choice on machines without a usable GPU.
   Note: `render_thumbnail_to_path` lowers samples only for `CYCLES` on 5.x. For
   EEVEE set `scene.eevee.taa_render_samples` yourself before the call.
3. Keep it small: `render_thumbnail_to_path` already clamps to 320 px and 16 samples.
   For `render_viewport_to_path`, set `resolution_x/y`, `resolution_percentage` and
   `cycles.samples` yourself before the call.
4. Read the returned `filepath`. It is inside Blender's temp dir, not your path.

```python
import bpy, math
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 16
cam_data = bpy.data.cameras.new("PreviewCam")
cam = bpy.data.objects.new("PreviewCam", cam_data)
scene.collection.objects.link(cam)
cam.location = (6, -6, 4)
cam.rotation_euler = (math.radians(60), 0, math.radians(45))
scene.camera = cam
result = {"engine": scene.render.engine, "camera": cam.name}
```

Then call `render_thumbnail_to_path` with `{"output_path": "preview.png"}`.

### Look up the API before guessing

Blender's API changes between versions. Do not guess operator keyword names or enum
values. One lookup costs less than one failed call:

- Signature or property: `get_python_api_docs` with the full dotted name.
- Unknown name: `search_api_docs` with two or three keywords.
- Concept or workflow: `search_manual_docs`.
- At runtime: `execute_blender_code` with `result = {"props": [p.identifier for p in
  bpy.ops.mesh.primitive_cube_add.get_rna_type().properties]}` or
  `dir(obj)` / `type(obj).bl_rna.properties.keys()`.

### Keep calls small and verifiable

- One logical step per `execute_blender_code` call. Return what you changed
  (names, counts, bounds) so you can verify without a second call.
- After a build step, verify with `get_object_detail_summary` or a small
  `execute_blender_code` that returns `dimensions` and `matrix_world`.
- Prefer non-destructive changes: modifiers over applied geometry. Apply only when the
  export format needs it.
- Delete with `bpy.data.objects.remove(obj, do_unlink=True)` so the object leaves
  every collection. Remove orphan meshes with `bpy.data.meshes.remove(me)` when done,
  or leave them for the purge on save.
