import * as THREE from "three";
import savedOverrides from "../scene/scene-overrides.json";
import { inspectorRevision, redoCount, saveStatus, undoCount } from "../state";

// Edits made in the editor are stored as overrides on top of the scene that the code builds.
// An object is addressed by its path of names from the root, like "Props/Host Desk".
// Only values that differ from the code defaults go into src/scene/scene-overrides.json.

type Vector = [number, number, number];

interface ObjectState {
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

interface SceneOverrides {
  objects?: Record<string, ObjectState>;
  materials?: Record<string, MaterialState>;
}

const SAVE_URL = "/__scene/overrides";
const EPSILON = 1e-5;
const HISTORY_LIMIT = 200;

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

function collectObjects(root: THREE.Object3D): Map<string, THREE.Object3D> {
  const objects = new Map<string, THREE.Object3D>();
  root.traverse((object) => {
    // An animated object gets its transform from the animation every frame; saving it means nothing.
    const path = object === root || object.userData.animated ? null : objectPath(object, root);
    if (path !== null && !objects.has(path)) {
      objects.set(path, object);
    }
  });
  return objects;
}

// Shared lit materials, by name. The editor can tune them; unlit glow colors stay in code.
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
      if (!materials.has(material.name)) {
        materials.set(material.name, material);
      }
    }
  });
  return materials;
}

function readObject(object: THREE.Object3D): ObjectState {
  const state: ObjectState = {
    position: object.position.toArray().map(round) as Vector,
    rotation: [object.rotation.x, object.rotation.y, object.rotation.z].map((value) => round(THREE.MathUtils.radToDeg(value))) as Vector,
    scale: object.scale.toArray().map(round) as Vector,
    visible: object.visible,
  };
  const light = object as THREE.Light;
  if (light.isLight) {
    state.color = `#${light.color.getHexString()}`;
    state.intensity = round(light.intensity);
  }
  return state;
}

function writeObject(object: THREE.Object3D, state: ObjectState): void {
  if (state.position) {
    object.position.fromArray(state.position);
  }
  if (state.rotation) {
    const [x, y, z] = state.rotation.map((value) => THREE.MathUtils.degToRad(value));
    object.rotation.set(x ?? 0, y ?? 0, z ?? 0);
  }
  if (state.scale) {
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

class SceneDocument {
  private readonly root: THREE.Object3D;
  private readonly objectBaseline = new Map<string, ObjectState>();
  private readonly materialBaseline = new Map<string, MaterialState>();
  // Undo history: each entry is the JSON of `diff()` at that moment, so an entry stays small.
  private readonly undoStack: string[] = [];
  private readonly redoStack: string[] = [];

  constructor(root: THREE.Object3D) {
    this.root = root;
    for (const [path, object] of collectObjects(root)) {
      this.objectBaseline.set(path, readObject(object));
    }
    for (const [name, material] of collectMaterials(root)) {
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

  apply(overrides: SceneOverrides): void {
    const objects = collectObjects(this.root);
    for (const [path, state] of Object.entries(overrides.objects ?? {})) {
      const object = objects.get(path);
      if (object) {
        writeObject(object, state);
      } else {
        console.warn(`[scene] override for a missing object: ${path}`);
      }
    }
    const materials = collectMaterials(this.root);
    for (const [name, state] of Object.entries(overrides.materials ?? {})) {
      const material = materials.get(name);
      if (material) {
        writeMaterial(material, state);
      }
    }
  }

  diff(): SceneOverrides {
    const objects: Record<string, ObjectState> = {};
    for (const [path, object] of collectObjects(this.root)) {
      const baseline = this.objectBaseline.get(path);
      const changed = baseline ? difference(readObject(object), baseline) : null;
      if (changed) {
        objects[path] = changed;
      }
    }
    const materials: Record<string, MaterialState> = {};
    for (const [name, material] of collectMaterials(this.root)) {
      const baseline = this.materialBaseline.get(name);
      const changed = baseline ? difference(readMaterial(material), baseline) : null;
      if (changed) {
        materials[name] = changed;
      }
    }
    return { objects, materials };
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
    this.applyBaseline();
    inspectorRevision.value += 1;
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
      this.applyBaseline();
      this.apply(JSON.parse(target) as SceneOverrides);
      inspectorRevision.value += 1;
    }
    this.publishHistory();
  }

  private applyBaseline(): void {
    const objects: Record<string, ObjectState> = {};
    for (const [path, state] of this.objectBaseline) {
      objects[path] = state;
    }
    const materials: Record<string, MaterialState> = {};
    for (const [name, state] of this.materialBaseline) {
      materials[name] = state;
    }
    this.apply({ objects, materials });
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

export { SAVE_URL, SceneDocument, editableMaterials, objectPath };
export type { SceneOverrides };
