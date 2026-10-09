import * as THREE from "three";
import savedOverrides from "../scene/scene-overrides.json";
import { editorHint, inspectorRevision, redoCount, renamingUuid, saveStatus, selectedUuid, structureRevision, undoCount } from "../state";
import { createPrimitive, isAddKind, labelOf } from "./primitives";
import type { AddKind } from "./primitives";

// Edits made in the editor are stored as overrides on top of the scene that the code builds.
// Only values that differ from the code defaults go into src/scene/scene-overrides.json.
//
// Identity: at startup every named object of the code gets a stable id in `userData.docId`: its path of names
// from the root, like "Props/Host Desk" (a second object with the same path gets "#2" and so on).
// The id never changes afterwards, so a rename or a move in the editor keeps the overrides of the object.
// An object added in the editor gets an id like "added:k3f9x2".
//
// The file holds the state, not a history of edits:
// - `objects`: per code object, the fields that differ from the code. `name` is a rename. `parent` (the id of the
//   new parent, "" for the root) and `index` (the place among the named children) are a move; they always come together.
// - `added`: the objects added in the editor, with all their fields and their material.
// - `deleted`: the ids of the deleted code objects. Their children go with them.
// - `materials`: the shared materials by name.
// Load applies the structure first (adds, deletes, moves, renames) and the per-object fields after it.
// A file without `version` (the format before structural edits) has the same keys and loads as is.

type Vector = [number, number, number];

interface ObjectState {
  name?: string;
  // Id of the parent object; "" is the root.
  parent?: string;
  // The place among the named children of the parent.
  index?: number;
  position?: Vector;
  // Degrees, XYZ order.
  rotation?: Vector;
  scale?: Vector;
  visible?: boolean;
  color?: string;
  intensity?: number;
}

interface MaterialState {
  color?: string;
  emissive?: string;
  emissiveIntensity?: number;
  roughness?: number;
  metalness?: number;
}

interface AddedState extends ObjectState {
  kind: AddKind;
  // The name of a shared material, or the values of the own material of the object.
  material?: string | MaterialState;
}

interface SceneOverrides {
  version?: number;
  objects?: Record<string, ObjectState>;
  materials?: Record<string, MaterialState>;
  added?: Record<string, AddedState>;
  deleted?: string[];
}

interface Insert {
  object: THREE.Object3D;
  parent: string;
  index: number;
  // A code object goes back to this parent when its new parent is missing.
  fallback: THREE.Object3D | null;
}

const VERSION = 2;
const ROOT_ID = "";
const SAVE_URL = "/__scene/overrides";
const EPSILON = 1e-5;
const HISTORY_LIMIT = 200;
const HINT_SECONDS = 4;

function round(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

function same(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) < EPSILON;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => same(value, b[index]));
  }
  return a === b;
}

function objectPath(object: THREE.Object3D, root: THREE.Object3D): string | null {
  const names: string[] = [];
  let current: THREE.Object3D | null = object;
  while (current && current !== root) {
    if (current.name === "") {
      return null;
    }
    names.unshift(current.name);
    current = current.parent;
  }
  return current === root ? names.join("/") : null;
}

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

// Shared lit materials, by name. The editor can tune them; unlit glow colors stay in code.
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

function collectMaterials(root: THREE.Object3D): Map<string, THREE.MeshStandardMaterial> {
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  root.traverse((object) => {
    for (const material of editableMaterials(object)) {
      if (!material.userData.own && !materials.has(material.name)) {
        materials.set(material.name, material);
      }
    }
  });
  return materials;
}

function readObject(object: THREE.Object3D): ObjectState {
  const state: ObjectState = { name: object.name };
  // An animated object gets its transform from the animation every frame; saving it means nothing.
  if (!object.userData.animated) {
    state.position = object.position.toArray().map(round) as Vector;
    state.rotation = [object.rotation.x, object.rotation.y, object.rotation.z].map((value) => round(THREE.MathUtils.radToDeg(value))) as Vector;
    state.scale = object.scale.toArray().map(round) as Vector;
  }
  state.visible = object.visible;
  const light = object as THREE.Light;
  if (light.isLight) {
    state.color = `#${light.color.getHexString()}`;
    state.intensity = round(light.intensity);
  }
  return state;
}

function writeObject(object: THREE.Object3D, state: ObjectState): void {
  if (state.name !== undefined && state.name !== "") {
    object.name = state.name;
  }
  if (state.position && !object.userData.animated) {
    object.position.fromArray(state.position);
  }
  if (state.rotation && !object.userData.animated) {
    const [x, y, z] = state.rotation.map((value) => THREE.MathUtils.degToRad(value));
    object.rotation.set(x ?? 0, y ?? 0, z ?? 0);
  }
  if (state.scale && !object.userData.animated) {
    object.scale.fromArray(state.scale);
  }
  if (state.visible !== undefined) {
    object.visible = state.visible;
  }
  const light = object as THREE.Light;
  if (light.isLight) {
    if (state.color !== undefined) {
      light.color.set(state.color);
    }
    if (state.intensity !== undefined) {
      light.intensity = state.intensity;
    }
  }
}

function readMaterial(material: THREE.MeshStandardMaterial): MaterialState {
  return {
    color: `#${material.color.getHexString()}`,
    emissive: `#${material.emissive.getHexString()}`,
    emissiveIntensity: round(material.emissiveIntensity),
    roughness: round(material.roughness),
    metalness: round(material.metalness),
  };
}

function writeMaterial(material: THREE.MeshStandardMaterial, state: MaterialState): void {
  if (state.color !== undefined) {
    material.color.set(state.color);
  }
  if (state.emissive !== undefined) {
    material.emissive.set(state.emissive);
  }
  if (state.emissiveIntensity !== undefined) {
    material.emissiveIntensity = state.emissiveIntensity;
  }
  if (state.roughness !== undefined) {
    material.roughness = state.roughness;
  }
  if (state.metalness !== undefined) {
    material.metalness = state.metalness;
  }
}

// Keeps the fields of `state` that differ from `baseline`. Returns null when nothing differs.
function difference<T extends object>(state: T, baseline: T): Partial<T> | null {
  const result: Partial<T> = {};
  let changed = false;
  for (const key of Object.keys(state) as (keyof T)[]) {
    if (!same(state[key], baseline[key])) {
      result[key] = state[key];
      changed = true;
    }
  }
  return changed ? result : null;
}

// The own material of an added mesh (primitives.ts), or null for any other object.
function ownMaterial(object: THREE.Object3D): THREE.MeshStandardMaterial | null {
  return (object.userData.ownMaterial as THREE.MeshStandardMaterial | undefined) ?? null;
}

class SceneDocument {
  private readonly root: THREE.Object3D;
  // Every named object of the code, by id. A deleted object stays here, out of the tree, for undo.
  private readonly codeObjects = new Map<string, THREE.Object3D>();
  // Every object added in this session, by id. A deleted or undone one stays here, so redo brings back the same object.
  private readonly addedObjects = new Map<string, THREE.Object3D>();
  private readonly objectBaseline = new Map<string, ObjectState>();
  private readonly baselineParent = new Map<THREE.Object3D, THREE.Object3D>();
  // All children (named or not) of the root and of every code object, as the code built them.
  private readonly baselineChildren = new Map<THREE.Object3D, THREE.Object3D[]>();
  // The named code children of each parent, in code order.
  private readonly baselineOrder = new Map<THREE.Object3D, THREE.Object3D[]>();
  private readonly sharedMaterials: Map<string, THREE.MeshStandardMaterial>;
  private readonly materialBaseline = new Map<string, MaterialState>();
  // Undo history: each entry is the JSON of `diff()` at that moment, so an entry stays small.
  private readonly undoStack: string[] = [];
  private readonly redoStack: string[] = [];
  private hintTimer = 0;

  constructor(root: THREE.Object3D) {
    this.root = root;
    root.userData.docId = ROOT_ID;
    root.traverse((object) => {
      const path = object === root ? null : objectPath(object, root);
      if (path === null) {
        return;
      }
      let id = path;
      for (let n = 2; this.codeObjects.has(id); n++) {
        id = `${path}#${n}`;
      }
      object.userData.docId = id;
      this.codeObjects.set(id, object);
    });
    for (const parent of [root, ...this.codeObjects.values()]) {
      this.baselineChildren.set(parent, [...parent.children]);
      this.baselineOrder.set(parent, parent.children.filter((child) => child.userData.docId !== undefined && child.name !== ""));
    }
    for (const [id, object] of this.codeObjects) {
      this.objectBaseline.set(id, readObject(object));
      if (object.parent) {
        this.baselineParent.set(object, object.parent);
      }
    }
    this.sharedMaterials = collectMaterials(root);
    for (const [name, material] of this.sharedMaterials) {
      this.materialBaseline.set(name, readMaterial(material));
    }
    this.apply(savedOverrides as unknown as SceneOverrides);

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
    return this.codeObjects.get(id) ?? this.addedObjects.get(id);
  }

  // True when the object hangs in the scene tree, false when it is deleted (or under a deleted parent).
  isAttached(object: THREE.Object3D): boolean {
    return isInside(object, this.root);
  }

  // Shared materials by name, for the material picker of an added mesh.
  materialNames(): string[] {
    return [...this.sharedMaterials.keys()].sort();
  }

  // Why the object cannot be deleted or moved, or null when it can.
  // Code holds these objects and writes them every frame, so they stay where the code put them.
  lockReason(object: THREE.Object3D): string | null {
    if (object === this.root) {
      return "the root holds the whole scene";
    }
    if ((object as THREE.Camera).isCamera) {
      return "the Game view renders through the Main Camera";
    }
    if (object.userData.animated) {
      return "the animation writes its transform every frame";
    }
    if (this.idOf(object) === undefined) {
      return "it is not part of the scene document";
    }
    return null;
  }

  // Adds a new object of `kind` under `parent`, with its origin at the world point `at`.
  add(kind: AddKind, parent: THREE.Object3D, at: THREE.Vector3): THREE.Object3D | null {
    if (this.idOf(parent) === undefined || !this.isAttached(parent)) {
      this.hint("Pick a parent in the scene to add an object under it.");
      return null;
    }
    this.checkpoint();
    let id = "";
    do {
      id = `added:${Math.random().toString(36).slice(2, 8)}`;
    } while (this.addedObjects.has(id));
    const object = this.ensureAdded(id, kind, this.uniqueName(parent, labelOf(kind)));
    object.position.copy(at);
    object.quaternion.identity();
    object.scale.setScalar(1);
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

  // Gives an added mesh a shared material by name, or its own material back (null).
  setMaterial(object: THREE.Object3D, name: string | null): void {
    const own = ownMaterial(object);
    if (!own) {
      return;
    }
    this.checkpoint();
    this.writeAddedMaterial(object, name ?? readMaterial(own));
    inspectorRevision.value += 1;
  }

  apply(overrides: SceneOverrides): void {
    const inserts: Insert[] = [];
    // Added objects first: a move may name one of them as its new parent.
    const added = Object.entries(overrides.added ?? {});
    for (const [id, state] of added) {
      if (!isAddKind(state.kind)) {
        console.warn(`[scene] added object of an unknown kind: ${id} (${String(state.kind)})`);
        continue;
      }
      const object = this.ensureAdded(id, state.kind, state.name ?? labelOf(state.kind));
      object.removeFromParent();
      inserts.push({ object, parent: state.parent ?? ROOT_ID, index: state.index ?? Infinity, fallback: null });
    }
    for (const id of overrides.deleted ?? []) {
      const object = this.codeObjects.get(id);
      if (object) {
        object.removeFromParent();
      } else {
        console.warn(`[scene] delete of a missing object: ${id}`);
      }
    }
    // Every moved object leaves its parent before any of them goes in, then they go in by ascending index:
    // each one then lands on its own place among the objects that stayed.
    for (const [id, state] of Object.entries(overrides.objects ?? {})) {
      const object = this.codeObjects.get(id);
      if (!object || (state.parent === undefined && state.index === undefined)) {
        continue;
      }
      const fallback = this.baselineParent.get(object) ?? null;
      inserts.push({ object, parent: state.parent ?? (fallback ? (this.idOf(fallback) ?? ROOT_ID) : ROOT_ID), index: state.index ?? Infinity, fallback });
      object.removeFromParent();
    }
    inserts.sort((a, b) => a.index - b.index);
    for (const insert of inserts) {
      let parent = this.objectById(insert.parent);
      if (!parent || isInside(parent, insert.object)) {
        console.warn(`[scene] move to a missing parent: ${this.idOf(insert.object) ?? insert.object.name} -> ${insert.parent}`);
        parent = insert.fallback ?? undefined;
      }
      if (!parent) {
        continue;
      }
      parent.add(insert.object);
      placeAt(parent, insert.object, insert.index);
    }

    for (const [id, state] of Object.entries(overrides.objects ?? {})) {
      const object = this.codeObjects.get(id);
      if (object) {
        writeObject(object, state);
      } else {
        console.warn(`[scene] override for a missing object: ${id}`);
      }
    }
    for (const [id, state] of added) {
      const object = this.addedObjects.get(id);
      if (object) {
        writeObject(object, state);
        this.writeAddedMaterial(object, state.material);
      }
    }
    for (const [name, state] of Object.entries(overrides.materials ?? {})) {
      const material = this.sharedMaterials.get(name);
      if (material) {
        writeMaterial(material, state);
      }
    }
    this.structureChanged();
  }

  diff(): SceneOverrides {
    const objects: Record<string, ObjectState> = {};
    const deleted: string[] = [];
    for (const [id, object] of this.codeObjects) {
      const baseline = this.objectBaseline.get(id);
      if (!baseline) {
        continue;
      }
      const baselineParent = this.baselineParent.get(object);
      if (!this.isAttached(object)) {
        // Only the top of a deleted branch is listed: its children go with it.
        if (object.parent === null || object.parent !== baselineParent) {
          deleted.push(id);
        }
        continue;
      }
      const changed: ObjectState = difference(readObject(object), baseline) ?? {};
      const parent = object.parent;
      const index = namedIndex(object);
      if (parent && (parent !== baselineParent || index !== this.baselineIndex(object))) {
        const { name, ...rest } = changed;
        objects[id] = { ...(name === undefined ? {} : { name }), parent: this.idOf(parent) ?? ROOT_ID, index, ...rest };
      } else if (Object.keys(changed).length > 0) {
        objects[id] = changed;
      }
    }
    const added: Record<string, AddedState> = {};
    for (const [id, object] of this.addedObjects) {
      if (!this.isAttached(object) || !object.parent) {
        continue;
      }
      const { name, ...rest } = readObject(object);
      const state: AddedState = {
        kind: object.userData.added as AddKind,
        name: name ?? object.name,
        parent: this.idOf(object.parent) ?? ROOT_ID,
        index: namedIndex(object),
        ...rest,
      };
      const material = this.readAddedMaterial(object);
      if (material !== undefined) {
        state.material = material;
      }
      added[id] = state;
    }
    const materials: Record<string, MaterialState> = {};
    for (const [name, material] of this.sharedMaterials) {
      const baseline = this.materialBaseline.get(name);
      const changed = baseline ? difference(readMaterial(material), baseline) : null;
      if (changed) {
        materials[name] = changed;
      }
    }
    const result: SceneOverrides = { version: VERSION, objects, materials };
    if (Object.keys(added).length > 0) {
      result.added = added;
    }
    if (deleted.length > 0) {
      result.deleted = deleted;
    }
    return result;
  }

  async save(): Promise<void> {
    saveStatus.value = "saving";
    try {
      const response = await fetch(SAVE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: `${JSON.stringify(this.diff(), null, 2)}\n`,
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      saveStatus.value = "saved";
    } catch (error) {
      console.error("[scene] save failed: the save endpoint exists only in `yarn dev`", error);
      saveStatus.value = "failed";
    }
  }

  // Remembers the current state. Call it right before an edit; undo then returns to this state.
  checkpoint(): void {
    const current = this.snapshot();
    // A checkpoint with no edit since the last one would make an empty undo step.
    if (this.undoStack.at(-1) === current) {
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

  // Puts every object and material back to the values from code. Undo brings the edits back.
  revert(): void {
    this.checkpoint();
    this.restoreBaseline();
    this.structureChanged();
  }

  private snapshot(): string {
    return JSON.stringify(this.diff());
  }

  // Moves one step from `from` to `to`. Entries equal to the current state are skipped:
  // a checkpoint without a following edit leaves such an entry.
  private step(from: string[], to: string[]): void {
    const current = this.snapshot();
    let target = from.pop();
    while (target === current) {
      target = from.pop();
    }
    if (target !== undefined) {
      to.push(current);
      this.restoreBaseline();
      this.apply(JSON.parse(target) as SceneOverrides);
    }
    this.publishHistory();
  }

  // Puts the tree back as the code built it: added objects out, code objects back under their parents
  // in code order, with the names, transforms and materials from code.
  private restoreBaseline(): void {
    const added = [...this.addedObjects.values()];
    for (const object of added) {
      object.removeFromParent();
    }
    for (const object of added) {
      object.children = object.children.filter((child) => child.userData.docId === undefined);
    }
    for (const [parent, baseline] of this.baselineChildren) {
      const known = new Set(baseline);
      // Children that code added after startup are not ours: they stay.
      const extra = parent.children.filter((child) => child.userData.docId === undefined && !known.has(child));
      parent.children = [...baseline, ...extra];
      for (const child of parent.children) {
        child.parent = parent;
      }
    }
    for (const [id, state] of this.objectBaseline) {
      const object = this.codeObjects.get(id);
      if (object) {
        writeObject(object, state);
      }
    }
    for (const [name, state] of this.materialBaseline) {
      const material = this.sharedMaterials.get(name);
      if (material) {
        writeMaterial(material, state);
      }
    }
  }

  // The place of a code object among the named children of its code parent, counting only the siblings
  // that are still there. A deleted or moved-out sibling then does not shift the objects after it.
  private baselineIndex(object: THREE.Object3D): number {
    const parent = this.baselineParent.get(object);
    let count = 0;
    for (const sibling of (parent ? this.baselineOrder.get(parent) : undefined) ?? []) {
      if (sibling === object) {
        break;
      }
      if (sibling.parent === parent) {
        count += 1;
      }
    }
    return count;
  }

  private ensureAdded(id: string, kind: AddKind, name: string): THREE.Object3D {
    let object = this.addedObjects.get(id);
    if (!object) {
      object = createPrimitive(kind, name);
      object.userData.docId = id;
      object.userData.added = kind;
      this.addedObjects.set(id, object);
    }
    object.name = name;
    return object;
  }

  private readAddedMaterial(object: THREE.Object3D): string | MaterialState | undefined {
    const own = ownMaterial(object);
    if (!own) {
      return undefined;
    }
    const material = (object as THREE.Mesh).material as THREE.MeshStandardMaterial;
    return material === own ? readMaterial(own) : material.name;
  }

  private writeAddedMaterial(object: THREE.Object3D, value: string | MaterialState | undefined): void {
    const own = ownMaterial(object);
    if (!own) {
      return;
    }
    const mesh = object as THREE.Mesh;
    if (typeof value === "string") {
      const shared = this.sharedMaterials.get(value);
      if (shared) {
        mesh.material = shared;
        return;
      }
      console.warn(`[scene] missing shared material: ${value}`);
    }
    mesh.material = own;
    if (value !== undefined && typeof value !== "string") {
      writeMaterial(own, value);
    }
  }

  private uniqueName(parent: THREE.Object3D, base: string): string {
    const taken = new Set(parent.children.map((child) => child.name));
    let name = base;
    for (let n = 2; taken.has(name); n++) {
      name = `${base} ${n}`;
    }
    return name;
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

// Saving rewrites the JSON file. The scene already holds those values, so the update is swallowed
// here instead of reloading the page.
if (import.meta.webpackHot) {
  import.meta.webpackHot.accept("../scene/scene-overrides.json", () => {});
}

export { SAVE_URL, SceneDocument, editableMaterials, namedChildren, objectPath };
export type { SceneOverrides };
