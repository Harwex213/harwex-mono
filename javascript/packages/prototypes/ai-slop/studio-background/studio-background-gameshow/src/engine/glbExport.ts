import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

// Scene -> GLB, as the scene shows it now (`yarn export-glb`, the Export GLB button).
// The export builds a copy of the tree under the scene root and hands the copy to GLTFExporter:
// - A hidden object and its subtree stay out. The batch render copies (`batchOutput`) stay out: the source meshes
//   go into the file, so it keeps the names and the hierarchy.
// - Every node keeps its Hierarchy name and its id (`extras.id`).
// - glTF has no shader code. A glow (an unlit material brighter than 1) becomes an emissive material with
//   KHR_materials_emissive_strength. A beam cone becomes a faint emissive cone. The mirror becomes a glossy dark metal.
//   Any other shader material becomes an unlit material with its vertex colours, or a grey one.
// - A spot or directional light turns to face its target: a glTF light shines down its local -z.
//   A hemisphere light has no glTF form and stays out (its node stays as an empty node).

interface GlbExport {
  glb: ArrayBuffer;
  // The names of the materials that the export had to approximate, and the light types it left out.
  approximated: string[];
  lost: string[];
}

interface CopyContext {
  materials: Map<THREE.Material, THREE.Material>;
  approximated: Set<string>;
  lost: Set<string>;
  // Light copies with the world position of their target.
  aims: [THREE.Light, THREE.Vector3][];
}

function approximate(context: CopyContext, source: THREE.Material, result: THREE.Material, why: string): THREE.Material {
  result.name = source.name || source.type;
  context.approximated.add(`${result.name} (${why})`);
  return result;
}

// A glow: the colour scaled to 1 and the scale as the emissive strength.
function glowMaterial(source: THREE.Material, color: THREE.Color, map: THREE.Texture | null): THREE.MeshStandardMaterial {
  const strength = Math.max(color.r, color.g, color.b, 1e-6);
  const base = color.clone().multiplyScalar(1 / strength);
  return new THREE.MeshStandardMaterial({
    color: base,
    emissive: base,
    emissiveIntensity: strength,
    map,
    emissiveMap: map,
    roughness: 1,
    metalness: 0,
    transparent: source.transparent,
    opacity: source.opacity,
    side: source.side,
  });
}

function convertMaterial(source: THREE.Material, object: THREE.Object3D, context: CopyContext): THREE.Material {
  const cached = context.materials.get(source);
  if (cached) {
    return cached;
  }
  let result: THREE.Material = source;
  const basic = source as THREE.MeshBasicMaterial;
  const shader = source as THREE.ShaderMaterial;
  if (basic.isMeshBasicMaterial || (source as THREE.LineBasicMaterial).isLineBasicMaterial) {
    const color = (source as THREE.MeshBasicMaterial).color;
    if (Math.max(color.r, color.g, color.b) > 1) {
      if (basic.isMeshBasicMaterial) {
        result = approximate(context, source, glowMaterial(source, color, basic.map), "HDR glow -> emissive strength");
      } else {
        const line = (source as THREE.LineBasicMaterial).clone();
        line.color.multiplyScalar(1 / Math.max(color.r, color.g, color.b));
        result = approximate(context, source, line, "HDR line colour clamped");
      }
    }
  } else if (shader.isShaderMaterial && object.userData.beam) {
    const glow = glowMaterial(source, (shader.uniforms.uColor!.value as THREE.Color).clone().multiplyScalar(shader.uniforms.uIntensity!.value as number), null);
    glow.color.set(0x000000);
    glow.transparent = true;
    // Alpha blending scales the glow by the opacity: the strength makes up for it (the cone averages about half its peak).
    glow.opacity = 0.25;
    glow.emissiveIntensity *= 0.5 / glow.opacity;
    glow.depthWrite = false;
    glow.side = THREE.DoubleSide;
    glow.name = "beam";
    result = approximate(context, glow, glow, "additive beam shader -> faint emissive cone");
  } else if (shader.isShaderMaterial) {
    const geometry = (object as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (geometry?.getAttribute("color")) {
      result = approximate(context, source, new THREE.MeshBasicMaterial({ vertexColors: true, side: source.side }), "shader -> unlit vertex colours");
    } else {
      result = approximate(context, source, new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.6, side: source.side }), "shader -> grey");
    }
  }
  context.materials.set(source, result);
  return result;
}

function convertMaterials(material: THREE.Material | THREE.Material[], object: THREE.Object3D, context: CopyContext): THREE.Material | THREE.Material[] {
  if (Array.isArray(material)) {
    return material.map((item) => convertMaterial(item, object, context));
  }
  return convertMaterial(material, object, context);
}

function copyLight(source: THREE.Light, context: CopyContext): THREE.Object3D {
  const spot = source as THREE.SpotLight;
  const point = source as THREE.PointLight;
  let light: THREE.Light;
  if (spot.isSpotLight) {
    light = new THREE.SpotLight(spot.color, spot.intensity, spot.distance, spot.angle, spot.penumbra, spot.decay);
  } else if (point.isPointLight) {
    light = new THREE.PointLight(point.color, point.intensity, point.distance, point.decay);
  } else if ((source as THREE.DirectionalLight).isDirectionalLight) {
    light = new THREE.DirectionalLight(source.color, source.intensity);
  } else {
    context.lost.add(`${source.type} "${source.name}" (no glTF light type)`);
    return new THREE.Group();
  }
  const target = (source as THREE.SpotLight).target as THREE.Object3D | undefined;
  if (target) {
    target.updateWorldMatrix(true, false);
    context.aims.push([light, new THREE.Vector3().setFromMatrixPosition(target.matrixWorld)]);
  }
  return light;
}

// The copy of one object without its children.
function copyObject(source: THREE.Object3D, context: CopyContext): THREE.Object3D {
  const mesh = source as THREE.Mesh;
  if ((source as { isReflector?: boolean }).isReflector) {
    const tint = ((mesh.material as THREE.ShaderMaterial).uniforms.color?.value as THREE.Color | undefined) ?? new THREE.Color(0x7f7f7f);
    const mirror = new THREE.MeshStandardMaterial({ name: "mirror", color: tint, metalness: 1, roughness: 0.08 });
    context.approximated.add("mirror (Reflector -> glossy metal)");
    return new THREE.Mesh(mesh.geometry, mirror);
  }
  const instanced = source as THREE.InstancedMesh;
  if (instanced.isInstancedMesh) {
    const copy = new THREE.InstancedMesh(instanced.geometry, convertMaterials(instanced.material, source, context), instanced.count);
    // The export only reads them: the copy shares the instance buffers.
    copy.instanceMatrix = instanced.instanceMatrix;
    copy.instanceColor = instanced.instanceColor;
    return copy;
  }
  if (mesh.isMesh) {
    return new THREE.Mesh(mesh.geometry, convertMaterials(mesh.material, source, context));
  }
  const line = source as THREE.LineSegments;
  if (line.isLineSegments) {
    return new THREE.LineSegments(line.geometry, convertMaterials(line.material, source, context));
  }
  if ((source as THREE.Light).isLight) {
    return copyLight(source as THREE.Light, context);
  }
  const camera = source as THREE.PerspectiveCamera;
  if (camera.isPerspectiveCamera) {
    return new THREE.PerspectiveCamera(camera.fov, camera.aspect, camera.near, camera.far);
  }
  return new THREE.Group();
}

function copyTree(source: THREE.Object3D, context: CopyContext): THREE.Object3D | null {
  if (!source.visible || source.userData.batchOutput) {
    return null;
  }
  const copy = copyObject(source, context);
  copy.name = source.name;
  copy.position.copy(source.position);
  copy.quaternion.copy(source.quaternion);
  copy.scale.copy(source.scale);
  const id = source.userData.docId as string | undefined;
  copy.userData = id === undefined ? {} : { id };
  for (const child of source.children) {
    const childCopy = copyTree(child, context);
    if (childCopy) {
      copy.add(childCopy);
    }
  }
  return copy;
}

// Exports the visible part of the scene under `root` as a GLB.
async function exportGlb(root: THREE.Object3D): Promise<GlbExport> {
  root.updateMatrixWorld(true);
  const context: CopyContext = { materials: new Map(), approximated: new Set(), lost: new Set(), aims: [] };
  const copy = copyTree(root, context) ?? new THREE.Group();
  const scene = new THREE.Scene();
  scene.add(copy);
  scene.updateMatrixWorld(true);
  for (const [light, target] of context.aims) {
    light.lookAt(target);
  }
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: true });
  return { glb: glb as ArrayBuffer, approximated: [...context.approximated].sort(), lost: [...context.lost].sort() };
}

// Saves the GLB of the scene as a file download: `scene-v001.glb`.
async function downloadGlb(root: THREE.Object3D, version: number): Promise<void> {
  const { glb } = await exportGlb(root);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([glb], { type: "model/gltf-binary" }));
  link.download = `scene-v${String(version).padStart(3, "0")}.glb`;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(link.href);
  }, 10000);
}

export { downloadGlb, exportGlb };
export type { GlbExport };
