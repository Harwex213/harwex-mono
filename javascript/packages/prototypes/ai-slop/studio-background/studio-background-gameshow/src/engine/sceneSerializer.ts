import * as THREE from "three";
import { recipeOf } from "./geometryRecipes";
import { ROOT_ID, clean, cleanVector, encodeColor } from "./sceneFormat";
import type { ComponentData, Flags, MaterialValues, ObjectRecord } from "./sceneFormat";

// Scene -> records. The body component (meshRenderer, light, camera, mirror, beam, lineRenderer) is read from the
// three.js object itself, so an edit in the editor (a light colour, a material pick) is saved as it is.
// A procedural body (a casino prop) keeps its data in `userData.body`; the editor does not change it.
// Every other component (behaviours, data components) keeps its data in `userData.components`.

interface SerializeContext {
  // The reference to `material` in a meshRenderer: a library key, or the values of an own material.
  materialRef: (material: THREE.Material, object: THREE.Object3D, index: number) => string | MaterialValues;
}

const BODY_COMPONENTS = ["meshRenderer", "lineRenderer", "mirror", "light", "camera", "beam"];

function readMaterialValues(material: THREE.MeshStandardMaterial): MaterialValues {
  return {
    color: encodeColor(material.color),
    emissive: encodeColor(material.emissive),
    emissiveIntensity: clean(material.emissiveIntensity),
    roughness: clean(material.roughness),
    metalness: clean(material.metalness),
  };
}

function isIdentityTranslation(matrix: THREE.Matrix4): boolean {
  const e = matrix.elements;
  return e[0] === 1 && e[1] === 0 && e[2] === 0 && e[3] === 0 && e[4] === 0 && e[5] === 1 && e[6] === 0 && e[7] === 0 && e[8] === 0 && e[9] === 0 && e[10] === 1 && e[11] === 0 && e[15] === 1;
}

function geometryRecipe(object: THREE.Object3D, geometry: THREE.BufferGeometry): ComponentData {
  const recipe = recipeOf(geometry);
  if (!recipe) {
    throw new Error(`the geometry of ${object.name || object.uuid} has no recipe`);
  }
  return recipe;
}

function materialRefs(object: THREE.Object3D, material: THREE.Material | THREE.Material[], context: SerializeContext): unknown {
  if (Array.isArray(material)) {
    return material.map((item, index) => context.materialRef(item, object, index));
  }
  return context.materialRef(material, object, 0);
}

function readMeshRenderer(mesh: THREE.Mesh, context: SerializeContext): ComponentData {
  const data: ComponentData = { geometry: geometryRecipe(mesh, mesh.geometry), material: materialRefs(mesh, mesh.material, context) };
  if (mesh.castShadow) {
    data.castShadow = true;
  }
  if (mesh.receiveShadow) {
    data.receiveShadow = true;
  }
  if (mesh.renderOrder !== 0) {
    data.renderOrder = mesh.renderOrder;
  }
  if (!mesh.frustumCulled) {
    data.frustumCulled = false;
  }
  const instanced = mesh as THREE.InstancedMesh;
  if (instanced.isInstancedMesh) {
    const matrix = new THREE.Matrix4();
    const instances: number[][] = [];
    for (let i = 0; i < instanced.count; i++) {
      instanced.getMatrixAt(i, matrix);
      // A pure translation is written as [x, y, z], any other matrix as its 16 elements (column-major).
      instances.push(isIdentityTranslation(matrix) ? cleanVector([matrix.elements[12], matrix.elements[13], matrix.elements[14]]) : cleanVector(matrix.elements));
    }
    data.instances = instances;
    const startColors = mesh.userData.startInstanceColors as number[][] | undefined;
    if (startColors) {
      data.instanceColors = startColors;
    } else if (instanced.instanceColor) {
      const color = new THREE.Color();
      const colors: number[][] = [];
      for (let i = 0; i < instanced.count; i++) {
        instanced.getColorAt(i, color);
        colors.push(cleanVector([color.r, color.g, color.b]));
      }
      data.instanceColors = colors;
    }
  }
  return data;
}

function readLight(light: THREE.Light, idOf: (object: THREE.Object3D) => string | undefined): ComponentData {
  const data: ComponentData = {};
  const spot = light as THREE.SpotLight;
  const point = light as THREE.PointLight;
  const hemisphere = light as THREE.HemisphereLight;
  const directional = light as THREE.DirectionalLight;
  if (spot.isSpotLight) {
    data.type = "spot";
  } else if (point.isPointLight) {
    data.type = "point";
  } else if (hemisphere.isHemisphereLight) {
    data.type = "hemisphere";
  } else if (directional.isDirectionalLight) {
    data.type = "directional";
  } else {
    throw new Error(`unsupported light ${light.type}`);
  }
  data.color = encodeColor(light.color);
  if (hemisphere.isHemisphereLight) {
    data.groundColor = encodeColor(hemisphere.groundColor);
  }
  data.intensity = clean(light.intensity);
  if (spot.isSpotLight || point.isPointLight) {
    data.distance = clean(point.distance);
    data.decay = clean(point.decay);
  }
  if (spot.isSpotLight) {
    data.angle = clean(THREE.MathUtils.radToDeg(spot.angle));
    data.penumbra = clean(spot.penumbra);
  }
  if (spot.isSpotLight || directional.isDirectionalLight) {
    const target = idOf(spot.target);
    if (target === undefined) {
      throw new Error(`the target of ${light.name} is not in the scene file`);
    }
    data.target = target;
  }
  if (light.castShadow) {
    data.castShadow = true;
    const shadow = (light as THREE.SpotLight).shadow as unknown as THREE.LightShadow<THREE.PerspectiveCamera>;
    data.shadow = {
      mapSize: [shadow.mapSize.x, shadow.mapSize.y],
      bias: clean(shadow.bias),
      normalBias: clean(shadow.normalBias),
      radius: clean(shadow.radius),
      near: clean(shadow.camera.near),
      far: clean(shadow.camera.far),
    };
  }
  return data;
}

// The body component of an object: what the object is. Null for a plain group.
function readBody(object: THREE.Object3D, context: SerializeContext, idOf: (object: THREE.Object3D) => string | undefined): [string, ComponentData] | null {
  const procedural = object.userData.body as { type: string; data: ComponentData } | undefined;
  if (procedural) {
    return [procedural.type, procedural.data];
  }
  const reflector = object as THREE.Mesh & { isReflector?: boolean; userData: { mirror?: ComponentData } };
  if (reflector.isReflector) {
    const uniforms = (reflector.material as THREE.ShaderMaterial).uniforms;
    const color = uniforms.color?.value as THREE.Color;
    return ["mirror", { geometry: geometryRecipe(object, reflector.geometry), color: encodeColor(color), textureScale: (object.userData.textureScale as number | undefined) ?? 0.5 }];
  }
  const light = object as THREE.Light;
  if (light.isLight) {
    return ["light", readLight(light, idOf)];
  }
  const camera = object as THREE.PerspectiveCamera;
  if (camera.isPerspectiveCamera) {
    return ["camera", { fov: clean(camera.fov), near: clean(camera.near), far: clean(camera.far) }];
  }
  const mesh = object as THREE.Mesh;
  if (mesh.isMesh && object.userData.beam) {
    const uniforms = (mesh.material as THREE.ShaderMaterial).uniforms;
    const parameters = (mesh.geometry as THREE.CylinderGeometry).parameters;
    return ["beam", {
      color: encodeColor(uniforms.uColor?.value as THREE.Color),
      intensity: clean(uniforms.uIntensity?.value as number),
      bottomRadius: clean(parameters.radiusBottom),
      length: clean(parameters.height),
    }];
  }
  const line = object as THREE.LineSegments;
  if (line.isLineSegments) {
    return ["lineRenderer", { geometry: geometryRecipe(object, line.geometry), material: materialRefs(object, line.material, context) }];
  }
  if (mesh.isMesh) {
    return ["meshRenderer", readMeshRenderer(mesh, context)];
  }
  return null;
}

function readFlags(object: THREE.Object3D): Flags | undefined {
  const flags: Flags = {};
  const data = object.userData;
  if (data.folder) {
    flags.folder = true;
  }
  if (Boolean(data.selectable) !== (object.name !== "")) {
    flags.selectable = Boolean(data.selectable);
  }
  if (data.animated) {
    flags.animated = true;
  }
  if (data.seated) {
    flags.seated = true;
  }
  if (data.auditIgnore) {
    flags.auditIgnore = true;
  }
  if (data.editorMatte) {
    flags.editorMatte = true;
  }
  return Object.keys(flags).length > 0 ? flags : undefined;
}

interface TransformState {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
}

function writeTransform(record: ObjectRecord, transform: TransformState, fileRotation?: { degrees: [number, number, number]; radians: number[] }): void {
  const { position, rotation, scale } = transform;
  if (position.x !== 0 || position.y !== 0 || position.z !== 0) {
    record.position = cleanVector(position.toArray()) as [number, number, number];
  }
  if (rotation.x !== 0 || rotation.y !== 0 || rotation.z !== 0) {
    const unturned = fileRotation && fileRotation.radians[0] === rotation.x && fileRotation.radians[1] === rotation.y && fileRotation.radians[2] === rotation.z;
    record.rotation = unturned ? fileRotation.degrees : ([rotation.x, rotation.y, rotation.z].map((value) => clean(THREE.MathUtils.radToDeg(value))) as [number, number, number]);
  }
  if (rotation.order !== "XYZ") {
    record.rotationOrder = rotation.order;
  }
  if (scale.x !== 1 || scale.y !== 1 || scale.z !== 1) {
    record.scale = cleanVector(scale.toArray()) as [number, number, number];
  }
}

// The record of one object. `idOf` gives the id of any object in the file.
function serializeObject(object: THREE.Object3D, context: SerializeContext, idOf: (object: THREE.Object3D) => string | undefined): ObjectRecord {
  const parent = object.parent ? idOf(object.parent) : undefined;
  const record: ObjectRecord = {
    name: object.name,
    parent: parent ?? ROOT_ID,
    order: clean((object.userData.order as number | undefined) ?? 0),
  };
  // An animated object gets its transform from a component every frame: the file keeps the start transform.
  const start = object.userData.animated ? (object.userData.startTransform as TransformState | undefined) : undefined;
  writeTransform(record, start ?? object, object.userData.fileRotation as { degrees: [number, number, number]; radians: number[] } | undefined);
  if (!object.visible) {
    record.visible = false;
  }
  const flags = readFlags(object);
  if (flags) {
    record.flags = flags;
  }
  const components: Record<string, ComponentData> = {};
  const body = readBody(object, context, idOf);
  if (body) {
    components[body[0]] = body[1];
  }
  const stored = object.userData.components as Record<string, ComponentData> | undefined;
  for (const name of Object.keys(stored ?? {}).sort()) {
    if (!BODY_COMPONENTS.includes(name)) {
      components[name] = stored![name]!;
    }
  }
  if (Object.keys(components).length > 0) {
    record.components = components;
  }
  return record;
}

export { BODY_COMPONENTS, readMaterialValues, serializeObject };
export type { SerializeContext, TransformState };
