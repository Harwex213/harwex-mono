import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import type { MaterialLibrary } from "../scene/materialLibrary";
import { createBeam } from "../scene/lights";
import type { BeamData } from "../scene/lights";
import { buildGeometry } from "./geometryRecipes";
import type { Recipe } from "./geometryRecipes";
import { ROOT_ID, decodeColor } from "./sceneFormat";
import type { ColorValue, ComponentData, MaterialValues, ObjectRecord, SceneFile } from "./sceneFormat";
import { BODY_COMPONENTS } from "./sceneSerializer";
import type { TransformState } from "./sceneSerializer";

// Scene file -> three.js objects.
// 1. Every record becomes an object: its body component (meshRenderer, lineRenderer, mirror, light, camera, beam,
//    or a procedural body such as a casino prop) picks the three.js type, a record without one becomes a Group.
// 2. Every object goes under its parent; siblings sort by `order`, then by id.
// 3. Links by id resolve (the target of a light).
// 4. The other components start: behaviours get their targets by id, a static batch merges its subtree.
// 5. The `materials` section writes its values into the shared materials by name.

// Something a component keeps running. The engine calls the hooks it has.
interface Behaviour {
  // A small step of the scene clock. `spinning`: the spin channel is on (the wheel).
  step?: (dt: number, time: number, spinning: boolean) => void;
  // The scene clock moved to `time` (Play, or a seek).
  update?: (time: number) => void;
  // Right before every render, also while paused.
  beforeRender?: (renderer: THREE.WebGLRenderer, time: number) => void;
  // The component stops: its object left the scene, or its data changed on disk and it starts again.
  dispose?: () => void;
}

// A running behaviour, with the object id and the component type it came from.
interface BehaviourEntry {
  id: string;
  component: string;
  behaviour: Behaviour;
}

interface StartContext {
  library: MaterialLibrary;
  objectById: (id: string) => THREE.Object3D | undefined;
}

// A component type that is not a body: a behaviour, or plain data that a behaviour reads (a virtual lamp).
interface ComponentType {
  start: (object: THREE.Object3D, data: ComponentData, context: StartContext) => Behaviour | null;
}

// A procedural body: builds the geometry of its object from the component data, with one draw group per material.
// `materials` holds the material key of each group. Equal data gives the same shared geometry.
type BodyBuilder = (data: ComponentData) => { geometry: THREE.BufferGeometry; materials: string[] };

type MaterialRef = string | MaterialValues;

// Viewport size for the first mirror target; the engine resizes it with the canvas.
const MIRROR_BASE = { width: 1280, height: 720 };

function writeMaterialValues(material: THREE.MeshStandardMaterial, values: MaterialValues): void {
  if (values.color !== undefined) {
    decodeColor(values.color, material.color);
  }
  if (values.emissive !== undefined) {
    decodeColor(values.emissive, material.emissive);
  }
  if (values.emissiveIntensity !== undefined) {
    material.emissiveIntensity = values.emissiveIntensity;
  }
  if (values.roughness !== undefined) {
    material.roughness = values.roughness;
  }
  if (values.metalness !== undefined) {
    material.metalness = values.metalness;
  }
}

// The own material of one mesh (a mesh added in the editor). The Inspector lists only named materials;
// `own` keeps it out of the list of shared materials.
function createOwnMaterial(values: MaterialValues): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xb4b4b4, roughness: 0.5, metalness: 0 });
  material.name = "Own Material";
  material.userData.own = true;
  writeMaterialValues(material, values);
  return material;
}

class SceneLoader {
  private readonly library: MaterialLibrary;
  private readonly bodies: Record<string, BodyBuilder>;
  private readonly bodyCache = new Map<string, { geometry: THREE.BufferGeometry; materials: string[] }>();

  constructor(library: MaterialLibrary, bodies: Record<string, BodyBuilder>) {
    this.library = library;
    this.bodies = bodies;
  }

  // True for a component that says what the object is (a mesh, a light, a casino prop), false for a behaviour or data.
  isBody(name: string): boolean {
    return BODY_COMPONENTS.includes(name) || this.bodies[name] !== undefined;
  }

  // The material of a reference: a library key, or the values of an own material (new each time).
  material(ref: MaterialRef, object: THREE.Object3D): THREE.Material {
    if (typeof ref !== "string") {
      const own = createOwnMaterial(ref);
      object.userData.ownMaterial = own;
      return own;
    }
    const material = this.library.get(ref);
    if (!material) {
      throw new Error(`[scene] unknown material ${ref} on ${object.name}`);
    }
    return material;
  }

  private materials(refs: unknown, object: THREE.Object3D): THREE.Material | THREE.Material[] {
    if (Array.isArray(refs)) {
      return refs.map((ref) => this.material(ref as MaterialRef, object));
    }
    return this.material(refs as MaterialRef, object);
  }

  // The object of a record, without parent and without the links by id.
  create(record: ObjectRecord): THREE.Object3D {
    const components = record.components ?? {};
    const procedural = Object.keys(components).find((name) => this.bodies[name] !== undefined);
    const body = procedural ?? BODY_COMPONENTS.find((name) => components[name] !== undefined);
    const data = body ? (components[body] as ComponentData) : {};
    let object: THREE.Object3D;
    if (procedural) {
      object = this.createProcedural(procedural, data);
    } else if (body === "meshRenderer") {
      object = this.createMesh(data);
    } else if (body === "lineRenderer") {
      object = new THREE.LineSegments(buildGeometry(data.geometry as Recipe));
      (object as THREE.LineSegments).material = this.materials(data.material, object);
    } else if (body === "mirror") {
      const scale = (data.textureScale as number | undefined) ?? 0.5;
      object = new Reflector(buildGeometry(data.geometry as Recipe), {
        textureWidth: MIRROR_BASE.width * scale,
        textureHeight: MIRROR_BASE.height * scale,
        color: decodeColor(data.color as ColorValue, new THREE.Color()),
      });
      object.userData.textureScale = scale;
    } else if (body === "light") {
      object = createLight(data);
    } else if (body === "camera") {
      object = new THREE.PerspectiveCamera(data.fov as number, 16 / 9, data.near as number, data.far as number);
    } else if (body === "beam") {
      object = createBeam(data as unknown as BeamData);
    } else {
      object = new THREE.Group();
    }
    const stored: Record<string, ComponentData> = {};
    for (const [name, value] of Object.entries(components)) {
      if (!BODY_COMPONENTS.includes(name) && name !== procedural) {
        stored[name] = value;
      }
    }
    object.userData.components = stored;
    applyRecord(object, record);
    return object;
  }

  // The mesh of a procedural body. The serializer writes `userData.body` back as it is.
  private createProcedural(type: string, data: ComponentData): THREE.Mesh {
    const key = `${type}:${JSON.stringify(data)}`;
    let built = this.bodyCache.get(key);
    if (!built) {
      built = this.bodies[type]!(data);
      this.bodyCache.set(key, built);
    }
    const mesh = new THREE.Mesh(built.geometry);
    mesh.material = built.materials.map((ref) => this.material(ref, mesh));
    mesh.userData.body = { type, data };
    return mesh;
  }

  private createMesh(data: ComponentData): THREE.Mesh {
    const geometry = buildGeometry(data.geometry as Recipe);
    const instances = data.instances as number[][] | undefined;
    const mesh = instances ? new THREE.InstancedMesh(geometry, undefined, instances.length) : new THREE.Mesh(geometry);
    mesh.material = this.materials(data.material, mesh);
    mesh.castShadow = Boolean(data.castShadow);
    mesh.receiveShadow = Boolean(data.receiveShadow);
    mesh.renderOrder = (data.renderOrder as number | undefined) ?? 0;
    mesh.frustumCulled = data.frustumCulled !== false;
    if (instances) {
      const instanced = mesh as THREE.InstancedMesh;
      const matrix = new THREE.Matrix4();
      instances.forEach((values, index) => {
        if (values.length === 3) {
          matrix.makeTranslation(values[0]!, values[1]!, values[2]!);
        } else {
          matrix.fromArray(values);
        }
        instanced.setMatrixAt(index, matrix);
      });
      const colors = data.instanceColors as number[][] | undefined;
      if (colors) {
        // A component may animate the colours (the wheel bulbs): a save writes these start colours.
        mesh.userData.startInstanceColors = colors;
        const color = new THREE.Color();
        colors.forEach((values, index) => {
          instanced.setColorAt(index, color.setRGB(values[0]!, values[1]!, values[2]!, THREE.LinearSRGBColorSpace));
        });
      }
    }
    return mesh;
  }

  // Resolves the links by id of a body: the target of a spot or directional light.
  link(object: THREE.Object3D, record: ObjectRecord, objectById: (id: string) => THREE.Object3D | undefined): void {
    const light = record.components?.light;
    if (light && typeof light.target === "string") {
      const target = objectById(light.target);
      if (target) {
        (object as THREE.SpotLight).target = target;
      } else {
        console.warn(`[scene] light target is missing: ${record.name} -> ${light.target}`);
      }
    }
  }

  // Changes the material of a mesh to a reference (the editor material picker and undo).
  setMaterial(object: THREE.Object3D, refs: unknown): void {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || refs === undefined) {
      return;
    }
    if (typeof refs === "object" && refs !== null && !Array.isArray(refs)) {
      // Own values: keep the own material object, so the material picker can switch back to it.
      const own = (object.userData.ownMaterial as THREE.MeshStandardMaterial | undefined) ?? createOwnMaterial({});
      object.userData.ownMaterial = own;
      writeMaterialValues(own, refs as MaterialValues);
      mesh.material = own;
      return;
    }
    mesh.material = this.materials(refs, object);
  }
}

function createLight(data: ComponentData): THREE.Light {
  let light: THREE.Light;
  const type = data.type as string;
  if (type === "spot") {
    light = new THREE.SpotLight(0xffffff, data.intensity as number, data.distance as number, THREE.MathUtils.degToRad(data.angle as number), data.penumbra as number, data.decay as number);
  } else if (type === "point") {
    light = new THREE.PointLight(0xffffff, data.intensity as number, data.distance as number, data.decay as number);
  } else if (type === "hemisphere") {
    const hemisphere = new THREE.HemisphereLight(0xffffff, 0xffffff, data.intensity as number);
    decodeColor(data.groundColor as ColorValue, hemisphere.groundColor);
    light = hemisphere;
  } else if (type === "directional") {
    light = new THREE.DirectionalLight(0xffffff, data.intensity as number);
  } else {
    throw new Error(`[scene] unknown light type ${type}`);
  }
  decodeColor(data.color as ColorValue, light.color);
  if (data.castShadow) {
    light.castShadow = true;
    const shadow = data.shadow as { mapSize: [number, number]; bias: number; normalBias: number; radius: number; near: number; far: number };
    const lightShadow = (light as THREE.SpotLight).shadow as unknown as THREE.LightShadow<THREE.PerspectiveCamera>;
    lightShadow.mapSize.set(shadow.mapSize[0], shadow.mapSize[1]);
    lightShadow.bias = shadow.bias;
    lightShadow.normalBias = shadow.normalBias;
    lightShadow.radius = shadow.radius;
    lightShadow.camera.near = shadow.near;
    lightShadow.camera.far = shadow.far;
  }
  return light;
}

function applyFlags(object: THREE.Object3D, record: ObjectRecord): void {
  const flags = record.flags ?? {};
  const data = object.userData;
  data.selectable = flags.selectable ?? record.name !== "";
  data.folder = Boolean(flags.folder);
  for (const key of ["animated", "seated", "auditIgnore", "editorMatte"] as const) {
    if (flags[key]) {
      data[key] = true;
    } else {
      delete data[key];
    }
  }
}

function applyTransform(object: THREE.Object3D, record: ObjectRecord): void {
  const position = record.position ?? [0, 0, 0];
  const rotation = record.rotation ?? [0, 0, 0];
  const scale = record.scale ?? [1, 1, 1];
  object.position.fromArray(position);
  object.rotation.set(
    THREE.MathUtils.degToRad(rotation[0]),
    THREE.MathUtils.degToRad(rotation[1]),
    THREE.MathUtils.degToRad(rotation[2]),
    (record.rotationOrder ?? "XYZ") as THREE.EulerOrder,
  );
  object.scale.fromArray(scale);
  // The degrees as written in the file: a save of an unturned object writes them back unchanged,
  // without a round trip through radians.
  object.userData.fileRotation = { degrees: rotation, radians: [object.rotation.x, object.rotation.y, object.rotation.z] };
  if (object.userData.animated) {
    const start: TransformState = { position: object.position.clone(), rotation: object.rotation.clone(), scale: object.scale.clone() };
    object.userData.startTransform = start;
  }
}

// Writes the fields of a record that are not components: name, order, transform, visibility, flags.
function applyRecord(object: THREE.Object3D, record: ObjectRecord): void {
  object.name = record.name;
  object.userData.order = record.order;
  applyFlags(object, record);
  applyTransform(object, record);
  object.visible = record.visible !== false;
}

// Siblings in file order: by `order`, then by id.
function compareSiblings(a: [string, ObjectRecord], b: [string, ObjectRecord]): number {
  if (a[1].order !== b[1].order) {
    return a[1].order - b[1].order;
  }
  return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
}

function namedStandardMaterials(root: THREE.Object3D): Map<string, THREE.MeshStandardMaterial> {
  const result = new Map<string, THREE.MeshStandardMaterial>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const standard = material as THREE.MeshStandardMaterial;
      if (standard.isMeshStandardMaterial && standard.name !== "" && !standard.userData.own && !result.has(standard.name)) {
        result.set(standard.name, standard);
      }
    }
  });
  return result;
}

interface LoadedScene {
  objects: Map<string, THREE.Object3D>;
  behaviours: BehaviourEntry[];
}

// Starts the components of one object that are not its body.
function startComponents(id: string, object: THREE.Object3D, components: Record<string, ComponentType>, context: StartContext): BehaviourEntry[] {
  const result: BehaviourEntry[] = [];
  const stored = object.userData.components as Record<string, ComponentData>;
  for (const [name, data] of Object.entries(stored)) {
    const type = components[name];
    if (!type) {
      console.warn(`[scene] unknown component ${name} on ${id}`);
      continue;
    }
    const behaviour = type.start(object, data, context);
    if (behaviour) {
      result.push({ id, component: name, behaviour });
    }
  }
  return result;
}

// Builds the scene of `file` under `root`.
function loadScene(file: SceneFile, root: THREE.Object3D, loader: SceneLoader, components: Record<string, ComponentType>, library: MaterialLibrary): LoadedScene {
  const records = Object.entries(file.objects);
  const children = new Map<string, [string, ObjectRecord][]>();
  for (const entry of records) {
    const list = children.get(entry[1].parent) ?? [];
    list.push(entry);
    children.set(entry[1].parent, list);
  }
  for (const list of children.values()) {
    list.sort(compareSiblings);
  }
  const objects = new Map<string, THREE.Object3D>();
  root.userData.docId = ROOT_ID;
  // Tree order, parents first, so the objects get their ids in a stable order.
  const visit = (parentId: string, parent: THREE.Object3D) => {
    for (const [id, record] of children.get(parentId) ?? []) {
      const object = loader.create(record);
      object.userData.docId = id;
      objects.set(id, object);
      parent.add(object);
      visit(id, object);
    }
  };
  visit(ROOT_ID, root);
  for (const [id, record] of records) {
    if (!objects.has(id)) {
      console.warn(`[scene] object under a missing parent is left out: ${id} (parent ${record.parent})`);
    }
  }
  const objectById = (id: string) => (id === ROOT_ID ? root : objects.get(id));
  for (const [id, record] of records) {
    const object = objects.get(id);
    if (object) {
      loader.link(object, record, objectById);
    }
  }
  root.updateMatrixWorld(true);
  const behaviours: BehaviourEntry[] = [];
  const context: StartContext = { library, objectById };
  for (const [id, object] of objects) {
    behaviours.push(...startComponents(id, object, components, context));
  }
  const shared = namedStandardMaterials(root);
  for (const [name, values] of Object.entries(file.materials)) {
    const material = shared.get(name);
    if (material) {
      writeMaterialValues(material, values);
    } else {
      console.warn(`[scene] values for a material that no object uses: ${name}`);
    }
  }
  return { objects, behaviours };
}

export { SceneLoader, applyRecord, compareSiblings, createOwnMaterial, loadScene, namedStandardMaterials, startComponents, writeMaterialValues };
export type { Behaviour, BehaviourEntry, BodyBuilder, ComponentType, LoadedScene, MaterialRef, StartContext };
