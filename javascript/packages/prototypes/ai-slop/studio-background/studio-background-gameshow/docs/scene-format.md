# Scene file format

The scene lives in versions: `src/scene/versions/001.json`, `002.json`, ... Each version file is a whole scene in the format below. The file is the single source of truth: the code is a library of component types, and the file says which objects exist, where they stand and what they are made of. Humans and agents edit the same files. How they share them is in [Versions and merging](#versions-and-merging).

## Top level

```json
{
  "format": "gameshow-studio-scene",
  "version": 2,
  "settings": { ...render settings },
  "materials": { "<name>": { ...material values } },
  "objects": { "<id>": { ...object record } }
}
```

- `settings` holds the render settings of the whole scene (see below).
- `objects` is a map from a stable id to one object record. The writer sorts it by id.
- `materials` holds the editable values of the shared materials, by material name. The writer sorts it by name.
- The writer always writes the keys of a record in the same order. Arrays of plain values stay on one line. So a change to one object changes only a few lines.

## Settings

```json
"settings": {
  "background": "#010209",
  "environment": "studio",
  "environmentIntensity": 0.8,
  "toneMapping": "ACESFilmic",
  "toneMappingExposure": 1,
  "shadowMap": "PCF",
  "samples": 4,
  "bloom": { "strength": 0.25, "radius": 0.2, "threshold": 1.2 }
}
```

| key | meaning |
| --- | --- |
| `background` | The colour behind everything. |
| `environment` | The environment map that lit materials reflect: `studio` (a dark room with warm and blue panels) or `casino` (the warm casino room). The balcony and casino materials reflect the casino room as their own map anyway. |
| `environmentIntensity` | The strength of the environment map. |
| `toneMapping`, `toneMappingExposure` | `ACESFilmic`, `AgX`, `Neutral`, `Reinhard`, `Cineon`, `Linear` or `None`, and the exposure. |
| `shadowMap` | `PCF`, `PCFSoft`, `VSM`, `Basic` or `None`. |
| `samples` | MSAA samples of the render target that the scene draws into. |
| `bloom` | The bloom pass: `strength`, `radius`, `threshold`. `null` leaves it out. `?bloom=0` in the URL leaves it out too. |

The editor does not change the settings. Save writes them back as they are.

## Ids

- An id never changes. A rename or a move keeps it.
- The id is any string. The baked objects got the path of names they had in the old code (`Props/Host Desk`), so the old overrides keep their ids. An unnamed object got `<parent id>/#<n>`.
- An object added in the editor gets `<parent id>/<name>`, with `#2`, `#3` when the id is taken.
- Do not reuse the id of a deleted object for a different object.

## Object record

```json
"Props/Host Desk": {
  "name": "Host Desk",
  "parent": "Props",
  "order": 0,
  "position": [12.58769, 0, 0.57768],
  "rotation": [0, -63.47778, 0],
  "rotationOrder": "YXZ",
  "scale": [1, 1, 1],
  "visible": false,
  "flags": { "seated": true },
  "components": { "meshRenderer": { ... } }
}
```

| key | meaning | default |
| --- | --- | --- |
| `name` | Name in the Hierarchy. `""` is an internal part: the Hierarchy does not list it. | required |
| `parent` | Id of the parent. `""` is the scene root. | required |
| `order` | Place among the siblings. Siblings sort by `order`, then by id. Gaps and fractions are fine: a move changes only the order of the moved object. | required |
| `position` | Local position in metres. | `[0, 0, 0]` |
| `rotation` | Local Euler angles in degrees. | `[0, 0, 0]` |
| `rotationOrder` | Euler order. | `"XYZ"` |
| `scale` | Local scale. | `[1, 1, 1]` |
| `visible` | Only written when false. | `true` |
| `flags` | See below. | none |
| `components` | Map from component type to its data. | none |

An object with `flags.animated` gets its transform from a component every frame. The file keeps its start transform, and Save does not write the animated pose.

## Flags

| flag | meaning |
| --- | --- |
| `folder` | A pure grouping node. A click in the Scene view selects its children, not the folder. |
| `selectable` | Listed in the Hierarchy and pickable. Default: true for a named object, false for an unnamed one. Written only when it differs. |
| `animated` | A component writes the transform every frame. The editor cannot move or delete the object. |
| `seated` | Mounted into a curved surface on purpose. The blocking audit allows the overlap. |
| `auditIgnore` | Not part of the set. The blocking audit and the pivot rule skip the subtree. |
| `editorMatte` | Editor Lighting swaps the material of this mesh for a matte one (the floor over the mirror). |

## Values

- A colour is `"#rrggbb"` (sRGB), or `[r, g, b]` in linear space when the hex form cannot hold it (an HDR glow colour above 1).
- A material reference is a key of the material library (`src/scene/materialLibrary.ts`), or an object with the values of an own material (a mesh added in the editor).
- Material values: `color`, `emissive`, `emissiveIntensity`, `roughness`, `metalness`. Only these are editable. Textures, shaders and the other settings stay in the code of the material library.
- Numbers keep full precision. The writer only removes float noise (`15.000000000000002` becomes `15`).

## Body components

A body component says what the object is. An object has at most one. An object without a body is an empty group.

### meshRenderer

```json
"meshRenderer": {
  "geometry": { "type": "cylinder", "radiusTop": 0.44, "radiusBottom": 0.44, "height": 0.8, "ops": [["translate", 0, 0.4, 0]] },
  "material": "navy",
  "castShadow": true,
  "receiveShadow": true,
  "renderOrder": 1,
  "frustumCulled": false,
  "instances": [[x, y, z], [16 matrix elements]],
  "instanceColors": [[r, g, b]]
}
```

- `material`: one reference, or an array with one reference per geometry group (a box has six faces, a cylinder side, top and bottom).
- `instances`: the mesh is instanced. Each entry is a translation `[x, y, z]` or a full column-major matrix.
- `instanceColors`: linear colours per instance.

### Geometry recipes

A recipe builds one geometry. The same recipe always builds the same vertices, and meshes with equal recipes share one geometry.

- Primitives: `box`, `sphere`, `cylinder`, `cone`, `torus`, `plane`, `circle`, `ring`, `capsule`. The parameters have the three.js constructor names. A parameter equal to the three.js default is left out.
- `lathe`: `points` as `[[x, y], ...]`, `segments`, `phiStart`, `phiLength`.
- `extrude`: `shapes` and `options` (`depth`, `bevelEnabled`, `curveSegments`, ...). `shape`: `shapes` and `curveSegments`.
  A shape is `{ "curves": [...], "holes": [...] }`. A curve is `["line", x1, y1, x2, y2]`, `["arc", x, y, rx, ry, start, end, clockwise, rotation]`, `["ellipse", ...]`, `["spline", [[x, y], ...]]`, `["quadratic", ...]` or `["cubic", ...]`.
- `tube`: `path` (a Catmull-Rom curve: `points`, `closed`, `curveType`, `tension`), `tubularSegments`, `radius`, `radialSegments`, `closed`.
- `edges`: the edges of `geometry` (a recipe), with `thresholdAngle`.
- `merge`: `parts` (recipes) merged into one geometry; `groups: true` keeps one draw group per part.
- Procedural: `drape` (`width`, `height`: a velvet drape with folds), `frond` (`width`, `length`, `segments`: a bent palm frond),
  `wallSlab` (`length`, `height`, `thickness`, `apothem`, `curveSegments`, optional `arch`: [half width, sill, spring]):
  the wall slab of one colonnade bay with its arch opening, pushed along the radius from the studio centre, so both
  ends lie on the radial planes through the joints.
- `ops`: steps after the build, in order: `["rotateX", a]`, `["rotateY", a]`, `["rotateZ", a]` (radians), `["translate", x, y, z]`, `["scale", x, y, z]`, `["applyMatrix4", ...16]`, `["applyQuaternion", x, y, z, w]`, `["lookAt", x, y, z]`, `["center"]`, `["computeVertexNormals"]`, `["toNonIndexed"]`.

### lineRenderer

`geometry` and `material`, like a meshRenderer. The object is a set of line segments.

### light

`type` (`spot`, `point`, `hemisphere`, `directional`), `color`, `intensity`; `distance`, `decay` (spot, point); `angle` in degrees, `penumbra` (spot); `groundColor` (hemisphere); `target`: the id of the object the light aims at (spot, directional); `castShadow` and `shadow` (`mapSize`, `bias`, `normalBias`, `radius`, `near`, `far`).

### camera

`fov` (degrees, the base for the 16:9 frame), `near`, `far`.

### mirror

A reflecting surface: `geometry` (a recipe), `color`, `textureScale` (the reflection target size as a part of the canvas size).

### beam

An additive cone that fakes the visible beam of a stage light: `color`, `intensity`, `bottomRadius`, `length`. The editor lighting hides it, and clicks pass through it.

### Casino props

The casino hall (`Casino`) is made of objects with procedural bodies (`src/scene/casino.ts`). A body builds the
geometry of its object in the local frame of the object: one mesh with a draw group per casino material. Lit pieces
carry a vertex tint, emitters carry their HDR colour, glow kind and phase for the glow material. Every colour and
phase is in the component data. Colours here are linear `[r, g, b]`.

| type | data | what |
| --- | --- | --- |
| `casinoBoxes` | `boxes`: `[material, x0, x1, y0, y1, z0, z1]`, with an optional tint `r, g, b`, or for an emitter `r, g, b, kind, phase` | Boxes between two corners: walls, piers, the entablature, pilasters, rods, the bar counter. |
| `casinoPlanFace` | `plan` (`[u, v]` points), `up`, `material` | A flat polygon at the height of the object: the floor and the flat ceilings. |
| `casinoPlanPrism` | `plan`, `height`, `material` | An upright prism over a polygon: the gallery slabs. |
| `casinoVault` | `length`, `half`, `rise`, `segmentsU`, `segmentsA` | The barrel vault of the nave. |
| `casinoArchBand` | `left`, `right`, `rise`, `width`, `depth`, `material` | A band along an elliptic arch: the vault ribs. |
| `casinoArchFace` | `width`, `height`, `rise`, `material` | A face in the shape of an arch: the tympana at the vault ends. |
| `casinoArch` | `width`, `rise`, `top`, `depth`, `band` | The marble panel over an arch between two columns, with its gold band. |
| `casinoDrape` | `width`, `height`, `tie`, `side`, `folds`, `columns`, `rows`, `color` | A velvet drape tied back to one side. |
| `casinoColumn` | `radius`, `plinth`, heights, `bands`, `fins` | A nave column; its candelabra are child objects. |
| `casinoCandelabrum` | `size`, `phases` (one per candle), `candle`, `flame` | A candelabrum on a wall or a column. |
| `casinoBalustrade` | `length`, `side`, `slab`, `railTop`, `balusters`, `spacing` | The gallery front: fascia mouldings, plinth, balusters, rail. |
| `casinoFasciaLamp` | `side`, `color`, `phase` | A lamp under a gallery front. |
| `casinoStatue` | `height` | A gold statue on a marble pedestal. |
| `casinoWindow` | `width`, `height`, `rise`, `color`, `phase`, `frame`, optional `sill`, `mullion`, `mullions`, `transom`, `transoms` | A night window with its gold frame. |
| `casinoLantern` | `color`, `phase` | A lantern on a marble post. |
| `casinoTable` | `radius`, `top`, `lamp`, `baseColor`, `color`, `phase` | A gaming table with its lamp. |
| `casinoChair`, `casinoBarStool` | none | A chair, a bar stool. |
| `casinoPerson` | `height`, `color` | A guest, a player, a dealer. |
| `casinoSlotMachine` | `tint`, `phase` | A slot machine; screen and topper glow in `tint`. |
| `casinoPalm` | `height`, `fronds` (`[turn, lightness]` per frond) | A palm in a gold pot. |
| `casinoFlowerUrn` | `color`, `flowers` (points) | The flower urn on the aisle. |
| `casinoBackBar` | `width`, `bottom`, `spring`, `rise`, `color`, `phase`, `frame` | The back bar with the shelves picture. |
| `casinoChandelier` | `diameter`, `drop`, `seed`, `crystal`, `candle`, `flame` | A crystal chandelier under its canopy. `seed` scatters the crystals. |

The editor does not change the data of a procedural body. Save writes it back as it is.

## Behaviour components

A behaviour finds its targets by id. An object deleted in the editor stays in memory, so a behaviour that points at it keeps running on it.

| type | on | data |
| --- | --- | --- |
| `cameraRig` | the Main Camera | `wide` and `close` poses of the hero wheel shot (`position`, `target`), `dollyPeriod`, and `stations`: per bonus game shot (`dice`, `show`, `luck`) the game object id (`object`), and `camera`, `target`, `push`, `period` in the frame of that object. |
| `wheelSpin` | the hero wheel body | `rotor`, `bulbs` (ids), `sectors`, `spinTime`, `restTime`, `bulbColor`. |
| `spotSweep` | a spot light | `beam` (id of its beam cone), `base` (the rest point on the floor, in the frame of the light's parent), `path` (frequencies, amplitudes, phases). |
| `followTarget` | any object | `target` (id) and `offset`: the object stays at `offset` in the frame of the target (its pivot, its turn about y). |
| `cityBackdrop` | the city backdrop | none: animates the skyline and water materials. |
| `sway` | a chandelier fixture | `amplitude` (radians), `rate` and `phase` about x and z: a slow sway. The object is `animated`. |
| `staticBatch` | a folder | none: draws the static meshes under the folder per material (see Static batching). |
| `casinoLighting` | `Casino` | The settings of the casino shader: `ambientLow`, `ambientHigh` (linear colours), `floorY`, `ceilingY`, and the pattern places `aisle`, `outer`, `vaultSpring`, `vaultRise`, `vaultHalf`, `bay`, `firstColumn`. It also reads the virtual lamps under `Casino`. |

## Data components

A data component holds data that the engine or a behaviour reads. It does nothing by itself.

| type | data |
| --- | --- |
| `lightZone` | A room for the light zones (`src/engine/lightZones.ts`): `name`, `min` and `max` (a box in the frame of the object: the space the camera must see for the lights of the room to be on), `default: true` on the room of the lights that are under no zone (the amphitheatre on `Studio`). Every light under the object belongs to its room (the annex on `Annex`). |
| `virtualLamp` | A lamp that lights the casino in the shader of its materials: `position` (in the frame of the object), `color` (linear), `intensity` (default 1), `radius`, `row`. Lamps with the same `row` form a row along the nave; a lamp without a row (a chandelier) lights the whole hall. |
| `virtualLine` | A line of lamps so close that they act as one line: `from`, `to` (in the frame of the object), `color`, `intensity`, `radius`. |

The casino shader (`src/scene/casinoShading.ts`) evaluates every lamp per fragment, so it is written for the lamp layout:

- Each half of the hall (each sign of v) has its own copy of every row. A point sees the chandeliers, and the rows and lines of its own half: the columns stand between the halves.
- A point takes the two lamps of a row on both sides of it along u. It finds them in closed form on the grid of the row (first lamp, period). A row lamp off that grid (moved alone) lights its half as a stray lamp.
- The places of the lamps are uniforms: a moved lamp needs no compile. A lamp added, deleted, hidden or moved off its grid changes the layout and compiles the casino materials again.

## Static batching

A folder with `staticBatch` draws the static meshes under it with one draw call per material (and shadow flags and render order). `Studio/Walls` (the colonnade) and the casino folders `Architecture`, `Gaming Floor` and `Bar` have it.

- A built-in material (the colonnade gold and wall) draws as a three.js BatchedMesh: one multi-draw call that still culls every part on its own.
- A material with shader code of its own (the casino materials) draws as one merged mesh: the vertices of its parts, moved into the frame of the folder.
- The source meshes stay in the tree. The Hierarchy lists them, a click in the Scene view picks them, the gizmo moves them, Save writes them. No camera renders their layer.
- After an edit the batch moves only the changed parts. A part added, deleted, hidden, moved in or out, or given another material rebuilds the batch.
- Left out of a batch (they draw by themselves): animated subtrees, a nested batch, instanced meshes, mirrors, beams, transparent materials.
- The batch meshes have no id: Save does not write them, and the audit skips them.

## Not in the file

Every object of the scene is in the file. Code holds only the component types and these:

- The material library: which materials exist, their textures and shaders (`src/scene/materialLibrary.ts`). The file holds only the editable values.
- The shader code of the casino materials and the glow kinds (`src/scene/casinoShading.ts`, `shaders/casinoGlow.*`). Their settings and lamps are in the file.
- The environment rooms behind the `studio` and `casino` environment maps (`src/scene/materials.ts`).
- Editor tooling: the editor camera, the editor lighting, the grid and the gizmos.

## Versions and merging

### Where the versions live

```
src/scene/versions/
  index.json     the list of versions and the latest one
  001.json       version 1: a whole scene file
  002.json       ...
```

`index.json`:

```json
{
  "latest": 2,
  "versions": [
    { "id": 1, "label": "Baked scene", "created": "2026-10-10T22:22:00.000Z" },
    { "id": 2, "label": "Copy of v1", "created": "2026-10-11T09:00:00.000Z", "from": 1 }
  ]
}
```

- A new version is a byte copy of the latest version. It gets the next id and becomes the latest.
- The folder keeps at most 10 versions. A new version past 10 removes the oldest one (the lowest id). The editor says so before it happens.
- Ids only grow. An id never comes back after its version is removed.
- The editor opens the latest version. `?v=3` opens version 3. The toolbar under the main toolbar shows the open version, marks it when it is not the latest, and makes a new version.
- A tab on the latest version moves onto a new version at once and keeps its unsaved edits. A tab on an old version opens the new version with a page load.
- `yarn dev` serves the files at `scene/versions/`. `yarn build` copies them into `dist/scene/versions/`. The built page opens the latest version read-only (no Save, no live changes).

### The agent rule

- An agent edits the latest version. It edits another version only when the user names it.
- An agent edits through `yarn scene` (`scripts/scene.mjs`). `yarn scene help` lists the commands. Examples:

```sh
yarn scene find "host desk"
yarn scene get "Props/Host Desk"
yarn scene set "Props/Host Desk" position "[12.5, 0, 0.6]"
yarn scene set "Annex/Lights/Bonus Show Key" components.light.intensity 120
yarn scene move "Props/Palm 2" "Game Props"
yarn scene add "Props/Crate" '{"name": "Crate", "parent": "Props", "components": {"meshRenderer": {"geometry": {"type": "box"}, "material": "navy"}}}'
yarn scene delete "Props/Crate"
yarn scene patch changes.json
yarn scene new-version "before the lighting pass"
```

- Every command reads the version, changes it in memory and saves only the units it changed. The save goes through the same merge as the editor Save.
- A careful hand edit of a version file is safe too: the dev server sees the change and the open tabs merge it. A hand edit must change only the records it means to change. It must never write back a whole file from an old copy: that throws away the edits of others.

### Units and fields

The merge works on units and fields:

- A unit is one object record (by id), one entry of `materials` (by name), or the `settings`.
- A field is one key of the unit. Each component of an object is a field of its own (`components.light`, `components.followTarget`).

Two edits merge when they change different fields. Two edits conflict when they change the same field to different values, or when one deletes a unit and the other changes it.

### The editor tab

- The tab keeps a base: the file on disk as the tab saw it last. The edits of the tab are the difference between the base and the scene in the tab.
- The dev server watches the versions folder and tells every tab when a version file changes (server-sent events at `__scene/events`).
- When the file of the open version changes, the tab reads it and merges its own edits onto it. The unsaved edits of the human stay on top. Only the changed objects change in the scene: a new body (geometry, material, light values) goes into the same object when it can; a behaviour with new data starts again; settings, bloom and MSAA follow.
- A field that both sides changed is a conflict. The tab keeps the human value and lists the conflict under the toolbar. "Keep mine" keeps the human value: the next Save writes it over the disk. "Take disk" puts the value on disk into the tab. Save is off while a conflict is open.
- Undo does not take back a change from disk. The change goes into every undo step, field by field, so undo steps only through the edits made in the tab. Revert goes back to the file as it was last read from disk.
- A file event with the hash of the base is the echo of the own save: the tab ignores it.

### Save

- Save sends only the edits of the tab: each changed unit with its value in the base (`POST __scene/save` with `{ version, changes }`).
- The dev server takes the lock of the folder, reads the file as it is on disk now and merges the edits into it. It writes the result to a temp file and renames it over the file, so no reader sees half a file.
- When the disk changed the same field in the meantime, the server writes nothing and answers with the conflicts. The tab then reads the file and shows them.
- `yarn scene` saves the same way, so the editor, the tool and the dev server never write over each other.

## Tests

`SCENE_DIR=/path/copy yarn dev` serves and saves a copy of the versions folder. `SCENE_DIR=/path/copy yarn scene ...` edits the copy. Every test that saves must use a copy.
