# Game Show Studio

The scene opens in a Unity-like editor (Hierarchy, Scene/Game tabs, Inspector). `?solo` shows only the Game view over the whole window, and `?t=12` freezes the scene at 12 s.

- Code builds the scene. Edits made in the editor are saved as overrides in `src/scene/scene-overrides.json` (Save button or Ctrl+S). The save endpoint exists only in `yarn dev`.
- An override is keyed by the path of names from the root, for example `Props/Host Desk`. Renaming an object or changing its parent drops its saved override. The console warns about the missing path.
- Wrap a new object in `named(object, "Name")` from `src/scene/geometry.ts`, so it shows in the Hierarchy and can be selected. Pass `folder = true` for a pure grouping node. A click in the Scene view skips folders.
- Set `userData.animated = true` on an object whose transform the animation writes every frame (the camera, the wheel rotor, the sweeping blue targets). Its transform is then left out of saves.
- Materials from `createMaterials` are shared and saved by name. A cloned material needs its own `name`.
- Undo works on snapshots of the saved diff (`SceneDocument.checkpoint`). A new kind of edit must call `checkpoint()` right before it changes the scene, or undo skips it.
- Editor Lighting (`src/engine/editorLighting.ts`) changes the scene only for the duration of one render and restores it afterwards. It dims the game lights to 0 instead of hiding them, so the light count stays the same and shaders do not recompile. A new fake-light mesh needs `userData.beam = true` so that this mode hides it.
- Blocking rule: no part may cut into another part, no two faces may z-fight, and every part must touch something that leads down to the floor. Check it with `__studio.audit()` in the browser console (`src/engine/blockingAudit.ts`): all three lists must be empty after a change to the set.
- Mark a mesh `userData.seated = true` only when it is mounted into a curved surface on purpose (a bulb in the wheel ring, a globe on a lamp neck). Mark it `userData.auditIgnore = true` only when it is not part of the set (the mirror, the city backdrop, floor decals).
- The colonnade is a polygon of straight bays (`src/scene/studio.ts`). A part that runs along the wall must use `colonnadeStrip`, so that it ends on the same radial planes as the wall slabs. A round part along a straight wall always leaves a gap or an overlap.
