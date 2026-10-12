import * as THREE from "three";
import type { MaterialLibrary } from "../scene/materialLibrary";
import { editorHint, inspectorRevision, redoCount, renamingUuid, saveStatus, selectedUuid, structureRevision, undoCount } from "../state";
import { labelOf, primitiveComponents } from "./primitives";
import type { AddKind } from "./primitives";
import { FORMAT, ROOT_ID, VERSION } from "./sceneFormat";
import type { ComponentData, MaterialValues, ObjectRecord, SceneFile, SceneSettings } from "./sceneFormat";
import { SceneLoader, applyRecord, loadScene, namedStandardMaterials, startComponents, writeMaterialValues } from "./sceneLoader";
import type { Behaviour, BehaviourEntry, BodyBuilder, ComponentType, StartContext } from "./sceneLoader";
import { diffScene, same } from "./sceneMerge";
import { readMaterialValues, serializeObject } from "./sceneSerializer";

// The scene document: one version of the scene file (src/scene/versions/, format in docs/scene-format.md) loaded
// into three.js, and the editor operations on it. SceneSync (sceneSync.ts) loads and saves the file.
//
// Every object of the file has a stable id in `userData.docId`. A rename or a move keeps the id.
// An object without an id (the merged mesh of a static batch) is not part of the file: Save skips it.
//
// Undo works on snapshots of the editable state of every object (name, parent, order, transform, visibility,
// light colour and intensity, the material of an own-material mesh) and of the shared material values.
// A deleted or undone object stays in the document, out of the tree, so redo brings back the same object.
//
// `applyFile` brings the document to another file: a change on disk merged with the edits of this tab.
// Such an external change is not an edit of this tab: it goes into every undo step too, so undo and redo
// never take it back. Undo only steps through the edits made in this tab.

interface ObjectState {
  name: string;
  parent: string;
  order: number;
  position: number[];
  rotation: [number, number, number, string];
  scale: number[];
  visible: boolean;
  light?: [number, number, number, number];
  material?: unknown;
}

interface Snapshot {
  objects: Map<string, string>;
  materials: string;
}

const HISTORY_LIMIT = 200;
const HINT_SECONDS = 4;

// The Hierarchy lists only named children.
function namedChildren(parent: THREE.Object3D): THREE.Object3D[] {
  return parent.children.filter((child) => child.name !== "");
}

function namedIndex(object: THREE.Object3D): number {
  return object.parent ? namedChildren(object.parent).indexOf(object) : -1;
}

// Moves `object`, already a child of `parent`, to the place `index` among the named children.
function placeAt(parent: THREE.Object3D, object: THREE.Object3D, index: number): void {
  const children = parent.children;
  children.splice(children.indexOf(object), 1);
  const anchor = namedChildren(parent)[index];
  children.splice(anchor ? children.indexOf(anchor) : children.length, 0, object);
}

function isInside(object: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current === ancestor) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

// Shared lit materials, by name. The editor can tune them; unlit glow colours stay in code.
// The own material of an added mesh is listed too, but it is not a shared material.
function editableMaterials(object: THREE.Object3D): THREE.MeshStandardMaterial[] {
  const mesh = object as THREE.Mesh;
  if (!mesh.isMesh) {
    return [];
  }
  const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const result: THREE.MeshStandardMaterial[] = [];
  for (const material of list) {
    const standard = material as THREE.MeshStandardMaterial;
    if (standard.isMeshStandardMaterial && standard.name !== "" && !result.includes(standard)) {
      result.push(standard);
    }
  }
  return result;
}

function sortedById<T>(entries: Iterable<[string, T]>): [string, T][] {
  return [...entries].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

// What an external change touched, for the engine.
interface ExternalChange {
  settings: boolean;
  behaviours: boolean;
  objects: number;
}

// The components of a record split into the body (what the object is) and the others (behaviours, data).
function splitComponents(record: ObjectRecord, loader: SceneLoader): { body: Record<string, ComponentData>; others: Record<string, ComponentData> } {
  const body: Record<string, ComponentData> = {};
  const others: Record<string, ComponentData> = {};
  for (const [name, data] of Object.entries(record.components ?? {})) {
    if (loader.isBody(name)) {
      body[name] = data;
    } else {
      others[name] = data;
    }
  }
  return { body, others };
}

// Gives `object` the body of `fresh` (a new object of the same record) without a new object, so every reference to
// the object stays valid. False when the kind of object differs: the caller then puts `fresh` in its place.
function updateBody(object: THREE.Object3D, fresh: THREE.Object3D): boolean {
  if (object.constructor !== fresh.constructor || (object as { isReflector?: boolean }).isReflector || object.userData.beam || fresh.userData.beam) {
    return false;
  }
  const mesh = object as THREE.Mesh;
  const source = fresh as THREE.Mesh;
  if (mesh.isMesh || (object as THREE.LineSegments).isLineSegments) {
    const instanced = mesh as THREE.InstancedMesh;
    const sourceInstanced = source as THREE.InstancedMesh;
    if (instanced.isInstancedMesh) {
      if (instanced.count !== sourceInstanced.count) {
        return false;
      }
      instanced.instanceMatrix.copy(sourceInstanced.instanceMatrix);
      instanced.instanceMatrix.needsUpdate = true;
      instanced.instanceColor = sourceInstanced.instanceColor;
      instanced.boundingBox = null;
      instanced.boundingSphere = null;
    }
    mesh.geometry = source.geometry;
    mesh.material = source.material;
    mesh.castShadow = source.castShadow;
    mesh.receiveShadow = source.receiveShadow;
    mesh.renderOrder = source.renderOrder;
    mesh.frustumCulled = source.frustumCulled;
    for (const key of ["body", "ownMaterial", "startInstanceColors"]) {
      if (fresh.userData[key] === undefined) {
        delete object.userData[key];
      } else {
        object.userData[key] = fresh.userData[key];
      }
    }
    return true;
  }
  const light = object as THREE.Light;
  if (light.isLight) {
    const from = fresh as THREE.SpotLight;
    const to = object as THREE.SpotLight;
    to.color.copy(from.color);
    to.intensity = from.intensity;
    for (const key of ["distance", "decay", "angle", "penumbra"] as const) {
      if (key in from) {
        to[key] = from[key];
      }
    }
    const hemisphere = object as THREE.HemisphereLight;
    if (hemisphere.isHemisphereLight) {
      hemisphere.groundColor.copy((fresh as THREE.HemisphereLight).groundColor);
    }
    to.castShadow = from.castShadow;
    if (to.shadow && from.shadow) {
      if (!to.shadow.mapSize.equals(from.shadow.mapSize)) {
        to.shadow.map?.dispose();
        to.shadow.map = null;
      }
      to.shadow.mapSize.copy(from.shadow.mapSize);
      to.shadow.bias = from.shadow.bias;
      to.shadow.normalBias = from.shadow.normalBias;
      to.shadow.radius = from.shadow.radius;
      to.shadow.camera.near = from.shadow.camera.near;
      to.shadow.camera.far = from.shadow.camera.far;
      to.shadow.camera.updateProjectionMatrix();
    }
    return true;
  }
  const camera = object as THREE.PerspectiveCamera;
  if (camera.isPerspectiveCamera) {
    const from = fresh as THREE.PerspectiveCamera;
    camera.fov = from.fov;
    camera.near = from.near;
    camera.far = from.far;
    camera.updateProjectionMatrix();
    return true;
  }
  // A plain group has no body.
  return true;
}

class SceneDocument {
  // The running behaviours. The engine steps this array; an external change starts and stops entries in place.
  readonly behaviours: Behaviour[] = [];
  // The render settings of the file. The editor does not change them; Save writes them back.
  settings: SceneSettings;
  // Called after an external change, so the engine can follow it (render settings, a new camera rig).
  onExternalChange: ((change: ExternalChange) => void) | null = null;
  private readonly root: THREE.Object3D;
  private readonly loader: SceneLoader;
  private readonly library: MaterialLibrary;
  private readonly components: Record<string, ComponentType>;
  // Every object of the document by id, also the deleted ones (out of the tree).
  private readonly objects: Map<string, THREE.Object3D>;
  private readonly entries: BehaviourEntry[];
  private readonly sharedMaterials: Map<string, THREE.MeshStandardMaterial>;
  private baseline: Snapshot;
  private readonly undoStack: Snapshot[] = [];
  private readonly redoStack: Snapshot[] = [];
  private hintTimer = 0;

  constructor(root: THREE.Object3D, library: MaterialLibrary, components: Record<string, ComponentType>, bodies: Record<string, BodyBuilder>, file: SceneFile) {
    this.root = root;
    this.library = library;
    this.components = components;
    this.loader = new SceneLoader(library, bodies);
    if (file.format !== FORMAT || file.version !== VERSION) {
      throw new Error(`[scene] the scene file has format ${file.format} ${file.version}, the code reads ${FORMAT} ${VERSION}`);
    }
    this.settings = file.settings;
    const loaded = loadScene(file, root, this.loader, components, library);
    this.objects = loaded.objects;
    this.entries = loaded.behaviours;
    this.behaviours.push(...this.entries.map((entry) => entry.behaviour));
    this.sharedMaterials = namedStandardMaterials(root);
    this.baseline = this.snapshot();

    // Any edit marks the document dirty. The first call is the subscription itself.
    let first = true;
    inspectorRevision.subscribe(() => {
      if (first) {
        first = false;
        return;
      }
      if (saveStatus.peek() !== "saving") {
        saveStatus.value = "dirty";
      }
    });
  }

  idOf(object: THREE.Object3D): string | undefined {
    return object.userData.docId as string | undefined;
  }

  objectById(id: string): THREE.Object3D | undefined {
    if (id === ROOT_ID) {
      return this.root;
    }
    return this.objects.get(id);
  }

  // True when the object hangs in the scene tree, false when it is deleted (or under a deleted parent).
  isAttached(object: THREE.Object3D): boolean {
    return isInside(object, this.root);
  }

  // Shared materials by name, for the material picker of an added mesh.
  materialNames(): string[] {
    return [...this.sharedMaterials.keys()].filter((name) => this.library.get(name) !== undefined).sort();
  }

  // Why the object cannot be deleted or moved, or null when it can.
  lockReason(object: THREE.Object3D): string | null {
    if (object === this.root) {
      return "the root holds the whole scene";
    }
    if ((object as THREE.Camera).isCamera) {
      return "the Game view renders through the Main Camera";
    }
    if (object.userData.animated) {
      return "a component writes its transform every frame";
    }
    if (this.idOf(object) === undefined) {
      return "it is not part of the scene file";
    }
    return null;
  }

  // Adds a new object of `kind` under `parent`, with its origin at the world point `at`.
  add(kind: AddKind, parent: THREE.Object3D, at: THREE.Vector3): THREE.Object3D | null {
    const parentId = this.idOf(parent);
    if (parentId === undefined || !this.isAttached(parent)) {
      this.hint("Pick a parent in the scene to add an object under it.");
      return null;
    }
    this.checkpoint();
    const name = this.uniqueName(parent, labelOf(kind));
    const id = this.uniqueId(`${parentId === ROOT_ID ? "" : `${parentId}/`}${name}`);
    const targetId = `${id}/#1`;
    const record: ObjectRecord = { name, parent: parentId, order: this.nextOrder(parent), flags: kind === "group" ? { folder: true } : undefined, components: primitiveComponents(kind, targetId) };
    const object = this.loader.create(record);
    object.userData.docId = id;
    object.userData.added = kind;
    this.objects.set(id, object);
    if (kind === "spot" || kind === "directional") {
      const target = this.loader.create({ name: "", parent: id, order: 0, position: [0, -1, 0] });
      target.userData.docId = targetId;
      this.objects.set(targetId, target);
      object.add(target);
      (object as THREE.SpotLight).target = target;
    }
    object.position.copy(at);
    parent.updateWorldMatrix(true, false);
    parent.attach(object);
    this.structureChanged();
    selectedUuid.value = object.uuid;
    return object;
  }

  remove(object: THREE.Object3D): boolean {
    const reason = this.lockReason(object);
    if (reason) {
      this.hint(`Cannot delete ${object.name}: ${reason}.`);
      return false;
    }
    this.checkpoint();
    object.removeFromParent();
    this.structureChanged();
    return true;
  }

  // Moves `object` under `parent` at the place `index` among its named children (counted without `object`).
  // The object keeps its place in the world, like a drag in the Unity Hierarchy.
  move(object: THREE.Object3D, parent: THREE.Object3D, index: number): boolean {
    const reason = this.lockReason(object);
    if (reason) {
      this.hint(`Cannot move ${object.name}: ${reason}.`);
      return false;
    }
    if (isInside(parent, object)) {
      this.hint(`Cannot move ${object.name} into itself.`);
      return false;
    }
    if (this.idOf(parent) === undefined || !this.isAttached(parent)) {
      return false;
    }
    const siblings = namedChildren(parent).filter((child) => child !== object);
    const place = Math.max(0, Math.min(index, siblings.length));
    if (object.parent === parent && namedIndex(object) === place) {
      return false;
    }
    this.checkpoint();
    parent.updateWorldMatrix(true, false);
    parent.attach(object);
    placeAt(parent, object, place);
    this.reorder(parent, object);
    this.structureChanged();
    return true;
  }

  rename(object: THREE.Object3D, name: string): boolean {
    const trimmed = name.trim();
    if (trimmed === "" || trimmed === object.name || object === this.root) {
      return false;
    }
    this.checkpoint();
    object.name = trimmed;
    this.structureChanged();
    return true;
  }

  setVisible(object: THREE.Object3D, visible: boolean): void {
    if (object.visible === visible) {
      return;
    }
    this.checkpoint();
    object.visible = visible;
    inspectorRevision.value += 1;
  }

  // Gives a mesh with an own material a shared material by name, or its own material back (null).
  setMaterial(object: THREE.Object3D, name: string | null): void {
    const own = object.userData.ownMaterial as THREE.MeshStandardMaterial | undefined;
    if (!own) {
      return;
    }
    this.checkpoint();
    this.loader.setMaterial(object, name ?? readMaterialValues(own));
    inspectorRevision.value += 1;
  }

  // The scene as a file: every object in the tree, and the values of the shared materials.
  toFile(): SceneFile {
    const objects: Record<string, ObjectRecord> = {};
    const context = {
      materialRef: (material: THREE.Material): string | MaterialValues => {
        if (material.userData.own) {
          return readMaterialValues(material as THREE.MeshStandardMaterial);
        }
        const key = this.library.keyOf(material);
        if (key === undefined) {
          throw new Error(`[scene] material ${material.name || material.type} is not in the material library`);
        }
        return key;
      },
    };
    const idOf = (object: THREE.Object3D) => (object === this.root ? ROOT_ID : this.idOf(object));
    this.root.traverse((object) => {
      const id = this.idOf(object);
      if (object === this.root || id === undefined) {
        return;
      }
      objects[id] = serializeObject(object, context, idOf);
    });
    const materials: Record<string, MaterialValues> = {};
    for (const [name, material] of this.sharedMaterials) {
      materials[name] = readMaterialValues(material);
    }
    return { format: FORMAT, version: VERSION, settings: this.settings, materials, objects };
  }

  // Remembers the current state. Call it right before an edit; undo then returns to this state.
  checkpoint(): void {
    const current = this.snapshot();
    // A checkpoint with no edit since the last one would make an empty undo step.
    const last = this.undoStack.at(-1);
    if (last && sameSnapshot(last, current)) {
      return;
    }
    this.undoStack.push(current);
    if (this.undoStack.length > HISTORY_LIMIT) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
    this.publishHistory();
  }

  undo(): void {
    this.step(this.undoStack, this.redoStack);
  }

  redo(): void {
    this.step(this.redoStack, this.undoStack);
  }

  // Puts every object and material back to the scene file as it was loaded. Undo brings the edits back.
  revert(): void {
    this.checkpoint();
    this.restore(this.baseline);
    this.structureChanged();
  }

  // Brings the document to `target`: the file on disk merged with the edits of this tab (SceneSync).
  // Only the objects, materials and settings that differ from the scene now change. An object whose body changed
  // gets the new body in place when it can (a new geometry, material, light colour), or a new object in its place.
  // A behaviour whose data changed starts again. `current` is `toFile()` when the caller has it already.
  applyFile(target: SceneFile, current: SceneFile = this.toFile()): ExternalChange {
    const changes = diffScene(current, target);
    const result: ExternalChange = { settings: false, behaviours: false, objects: 0 };
    if (changes.length === 0) {
      return result;
    }
    const before = new Map<string, ObjectState | null>();
    const beforeMaterials = this.materialValues();
    const touched = new Set<THREE.Object3D>();
    const placed = new Set<string>();
    const restart = new Set<string>();
    const replaced = new Set<string>();
    const selected = selectedUuid.peek();
    for (const change of changes) {
      if (change.kind === "settings") {
        this.settings = target.settings;
        result.settings = true;
        continue;
      }
      if (change.kind === "material") {
        continue;
      }
      result.objects += 1;
      const id = change.key;
      const record = change.ours as ObjectRecord | null;
      const old = change.base as ObjectRecord | null;
      const object = this.objects.get(id);
      before.set(id, object && this.isAttached(object) ? this.readState(object) : null);
      if (!record) {
        if (object) {
          this.stopBehaviours(id);
          if (object.parent) {
            touched.add(object.parent);
          }
          object.removeFromParent();
          this.objects.delete(id);
          result.behaviours = true;
        }
        continue;
      }
      if (!object || !old || !this.isAttached(object)) {
        // New on disk, or back on disk after a delete: a fresh object. Its children follow in their own changes.
        const created = this.loader.create(record);
        created.userData.docId = id;
        if (object) {
          this.stopBehaviours(id);
          for (const child of [...object.children]) {
            created.add(child);
          }
          object.removeFromParent();
          replaced.add(id);
        }
        this.objects.set(id, created);
        placed.add(id);
        restart.add(id);
        continue;
      }
      const oldParts = splitComponents(old, this.loader);
      const newParts = splitComponents(record, this.loader);
      if (!same(oldParts.body, newParts.body)) {
        const fresh = this.loader.create(record);
        if (!updateBody(object, fresh)) {
          fresh.userData.docId = id;
          for (const child of [...object.children]) {
            fresh.add(child);
          }
          const parent = object.parent;
          object.removeFromParent();
          parent?.add(fresh);
          this.objects.set(id, fresh);
          this.stopBehaviours(id);
          restart.add(id);
          replaced.add(id);
          if (selected === object.uuid) {
            selectedUuid.value = fresh.uuid;
          }
        }
      }
      const live = this.objects.get(id)!;
      if (!same(oldParts.others, newParts.others)) {
        live.userData.components = newParts.others;
        restart.add(id);
      }
      applyRecord(live, record);
      placed.add(id);
    }
    // Parents and the order of the children.
    for (const id of placed) {
      const object = this.objects.get(id)!;
      const record = target.objects[id]!;
      const parent = this.objectById(record.parent);
      if (!parent) {
        console.warn(`[scene] object under a missing parent is left out: ${id} (parent ${record.parent})`);
        object.removeFromParent();
        continue;
      }
      if (object.parent !== parent) {
        if (object.parent) {
          touched.add(object.parent);
        }
        parent.add(object);
      }
      touched.add(parent);
    }
    for (const parent of touched) {
      this.sortChildren(parent);
    }
    // Links by id: the targets of the lights that changed, and of the lights that aim at a replaced object.
    const objectById = (id: string) => this.objectById(id);
    for (const [id, record] of Object.entries(target.objects)) {
      const aim = record.components?.light?.target;
      if (placed.has(id) || (typeof aim === "string" && replaced.has(aim))) {
        const object = this.objects.get(id);
        if (object) {
          this.loader.link(object, record, objectById);
        }
      }
    }
    // A behaviour that points at a replaced object starts again with the new object.
    for (const id of replaced) {
      const quoted = JSON.stringify(id);
      for (const entry of this.entries) {
        const data = (this.objects.get(entry.id)?.userData.components as Record<string, ComponentData> | undefined)?.[entry.component];
        if (data && JSON.stringify(data).includes(quoted)) {
          restart.add(entry.id);
        }
      }
    }
    this.root.updateMatrixWorld(true);
    const context = this.startContext();
    for (const id of restart) {
      this.stopBehaviours(id);
      const object = this.objects.get(id);
      if (object && this.isAttached(object)) {
        const started = startComponents(id, object, this.components, context);
        this.entries.push(...started);
        this.behaviours.push(...started.map((entry) => entry.behaviour));
      }
      result.behaviours = true;
    }
    // Shared materials: new objects may bring materials that no object used before.
    for (const [name, material] of namedStandardMaterials(this.root)) {
      if (!this.sharedMaterials.has(name)) {
        this.sharedMaterials.set(name, material);
      }
    }
    const changedMaterials: string[] = [];
    for (const change of changes) {
      if (change.kind === "material" && change.ours) {
        const material = this.sharedMaterials.get(change.key);
        if (material) {
          writeMaterialValues(material, change.ours as MaterialValues);
          changedMaterials.push(change.key);
        }
      }
    }
    this.rebaseHistory(before, beforeMaterials, changedMaterials);
    this.structureChanged();
    this.onExternalChange?.(result);
    return result;
  }

  // Writes an external change into every undo and redo step and into the baseline (Revert), field by field,
  // so that no step takes the change back. A field the external change did not touch keeps its history.
  private rebaseHistory(before: Map<string, ObjectState | null>, beforeMaterials: Record<string, MaterialValues>, materials: string[]): void {
    const after = new Map<string, ObjectState | null>();
    for (const id of before.keys()) {
      const object = this.objects.get(id);
      after.set(id, object && this.isAttached(object) ? this.readState(object) : null);
    }
    const afterMaterials = this.materialValues();
    const patch = (snapshot: Snapshot) => {
      for (const [id, pre] of before) {
        const post = after.get(id) ?? null;
        if (!post) {
          snapshot.objects.delete(id);
          continue;
        }
        const entry = snapshot.objects.get(id);
        if (!pre || !entry) {
          snapshot.objects.set(id, JSON.stringify(post));
          continue;
        }
        const state = JSON.parse(entry) as Record<string, unknown>;
        for (const key of Object.keys(post) as (keyof ObjectState)[]) {
          if (JSON.stringify(pre[key]) !== JSON.stringify(post[key])) {
            state[key] = post[key];
          }
        }
        snapshot.objects.set(id, JSON.stringify(state));
      }
      if (materials.length > 0) {
        const values = JSON.parse(snapshot.materials) as Record<string, Record<string, unknown>>;
        for (const name of materials) {
          const pre = (beforeMaterials[name] ?? {}) as Record<string, unknown>;
          const post = (afterMaterials[name] ?? {}) as Record<string, unknown>;
          const entry = values[name] ?? {};
          for (const key of Object.keys(post)) {
            if (JSON.stringify(pre[key]) !== JSON.stringify(post[key])) {
              entry[key] = post[key];
            }
          }
          values[name] = entry;
        }
        snapshot.materials = JSON.stringify(values);
      }
    };
    for (const snapshot of [...this.undoStack, ...this.redoStack, this.baseline]) {
      patch(snapshot);
    }
  }

  private materialValues(): Record<string, MaterialValues> {
    const materials: Record<string, MaterialValues> = {};
    for (const [name, material] of this.sharedMaterials) {
      materials[name] = readMaterialValues(material);
    }
    return materials;
  }

  private startContext(): StartContext {
    return { library: this.library, objectById: (id: string) => this.objectById(id) };
  }

  private stopBehaviours(id: string): void {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i]!;
      if (entry.id !== id) {
        continue;
      }
      entry.behaviour.dispose?.();
      this.entries.splice(i, 1);
      const index = this.behaviours.indexOf(entry.behaviour);
      if (index >= 0) {
        this.behaviours.splice(index, 1);
      }
    }
  }

  private readState(object: THREE.Object3D): ObjectState {
    const parent = object.parent ? (this.idOf(object.parent) ?? ROOT_ID) : ROOT_ID;
    const state: ObjectState = {
      name: object.name,
      parent,
      order: (object.userData.order as number | undefined) ?? 0,
      position: object.position.toArray(),
      rotation: [object.rotation.x, object.rotation.y, object.rotation.z, object.rotation.order],
      scale: object.scale.toArray(),
      visible: object.visible,
    };
    const light = object as THREE.Light;
    if (light.isLight) {
      state.light = [light.color.r, light.color.g, light.color.b, light.intensity];
    }
    const own = object.userData.ownMaterial as THREE.MeshStandardMaterial | undefined;
    if (own) {
      const material = (object as THREE.Mesh).material as THREE.Material;
      state.material = material === own ? readMaterialValues(own) : this.library.keyOf(material);
    }
    return state;
  }

  private snapshot(): Snapshot {
    const objects = new Map<string, string>();
    this.root.traverse((object) => {
      const id = this.idOf(object);
      if (object !== this.root && id !== undefined) {
        objects.set(id, JSON.stringify(this.readState(object)));
      }
    });
    const materials: Record<string, MaterialValues> = {};
    for (const [name, material] of this.sharedMaterials) {
      materials[name] = readMaterialValues(material);
    }
    return { objects, materials: JSON.stringify(materials) };
  }

  // Puts the document into the state of `snapshot`.
  private restore(snapshot: Snapshot): void {
    for (const [id, object] of this.objects) {
      if (!snapshot.objects.has(id)) {
        object.removeFromParent();
      }
    }
    const touched = new Set<THREE.Object3D>();
    for (const [id, text] of snapshot.objects) {
      const object = this.objects.get(id);
      if (!object) {
        continue;
      }
      const state = JSON.parse(text) as ObjectState;
      object.name = state.name;
      object.userData.order = state.order;
      object.position.fromArray(state.position);
      object.rotation.set(state.rotation[0], state.rotation[1], state.rotation[2], state.rotation[3] as THREE.EulerOrder);
      object.scale.fromArray(state.scale);
      object.visible = state.visible;
      const light = object as THREE.Light;
      if (light.isLight && state.light) {
        light.color.setRGB(state.light[0], state.light[1], state.light[2], THREE.LinearSRGBColorSpace);
        light.intensity = state.light[3];
      }
      if (state.material !== undefined) {
        this.loader.setMaterial(object, state.material);
      }
      const parent = this.objectById(state.parent);
      if (parent && object.parent !== parent) {
        parent.add(object);
      }
      if (object.parent) {
        touched.add(object.parent);
      }
    }
    for (const parent of touched) {
      this.sortChildren(parent);
    }
    const materials = JSON.parse(snapshot.materials) as Record<string, MaterialValues>;
    for (const [name, values] of Object.entries(materials)) {
      const material = this.sharedMaterials.get(name);
      if (material) {
        writeMaterialValues(material, values);
      }
    }
  }

  // Moves one step from `from` to `to`. Entries equal to the current state are skipped:
  // a checkpoint without a following edit leaves such an entry.
  private step(from: Snapshot[], to: Snapshot[]): void {
    const current = this.snapshot();
    let target = from.pop();
    while (target && sameSnapshot(target, current)) {
      target = from.pop();
    }
    if (target) {
      to.push(current);
      this.restore(target);
      this.structureChanged();
    }
    this.publishHistory();
  }

  // Gives `object` an order between its new neighbours among the file objects of `parent`.
  // Only the moved object changes, so a move is a one-object change in the file. Equal neighbours get renumbered.
  private reorder(parent: THREE.Object3D, object: THREE.Object3D): void {
    const siblings = parent.children.filter((child) => this.idOf(child) !== undefined);
    const index = siblings.indexOf(object);
    const before = siblings[index - 1]?.userData.order as number | undefined;
    const after = siblings[index + 1]?.userData.order as number | undefined;
    if (before !== undefined && after !== undefined) {
      if (after - before > 1e-6) {
        object.userData.order = (before + after) / 2;
        return;
      }
      siblings.forEach((child, place) => {
        child.userData.order = place;
      });
      return;
    }
    if (before !== undefined) {
      object.userData.order = Math.floor(before) + 1;
    } else if (after !== undefined) {
      object.userData.order = Math.ceil(after) - 1;
    } else {
      object.userData.order = 0;
    }
  }

  private nextOrder(parent: THREE.Object3D): number {
    let last = -1;
    for (const child of parent.children) {
      if (this.idOf(child) !== undefined) {
        last = Math.max(last, (child.userData.order as number | undefined) ?? 0);
      }
    }
    return Math.floor(last) + 1;
  }

  private uniqueId(base: string): string {
    let id = base;
    for (let n = 2; this.objects.has(id); n++) {
      id = `${base}#${n}`;
    }
    return id;
  }

  private uniqueName(parent: THREE.Object3D, base: string): string {
    const taken = new Set(parent.children.map((child) => child.name));
    let name = base;
    for (let n = 2; taken.has(name); n++) {
      name = `${base} ${n}`;
    }
    return name;
  }

  // Children in file order: the file objects by order and id, then the objects without an id (merged batch meshes).
  private sortChildren(parent: THREE.Object3D): void {
    const other = parent.children.filter((child) => this.idOf(child) === undefined);
    const own = sortedById(parent.children.filter((child) => this.idOf(child) !== undefined).map((child) => [this.idOf(child)!, child] as [string, THREE.Object3D]));
    own.sort((a, b) => ((a[1].userData.order as number) ?? 0) - ((b[1].userData.order as number) ?? 0));
    parent.children = [...own.map(([, child]) => child), ...other];
  }

  private structureChanged(): void {
    structureRevision.value += 1;
    inspectorRevision.value += 1;
    const selected = selectedUuid.peek();
    if (selected && !this.root.getObjectByProperty("uuid", selected)) {
      selectedUuid.value = null;
    }
    const renaming = renamingUuid.peek();
    if (renaming && !this.root.getObjectByProperty("uuid", renaming)) {
      renamingUuid.value = null;
    }
  }

  private hint(message: string): void {
    console.warn(`[scene] ${message}`);
    editorHint.value = message;
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => {
      editorHint.value = "";
    }, HINT_SECONDS * 1000);
  }

  private publishHistory(): void {
    undoCount.value = this.undoStack.length;
    redoCount.value = this.redoStack.length;
  }
}

function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  if (a.materials !== b.materials || a.objects.size !== b.objects.size) {
    return false;
  }
  for (const [id, text] of a.objects) {
    if (b.objects.get(id) !== text) {
      return false;
    }
  }
  return true;
}

export { SceneDocument, editableMaterials, namedChildren };
export type { ExternalChange };
