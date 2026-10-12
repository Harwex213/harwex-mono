import * as THREE from "three";
import { clean, formatJson, formatScene } from "./sceneMerge";

// The scene file (one version under src/scene/versions/). The format is described in docs/scene-format.md.
// The file is the scene: every object in it has a stable id, a name, a parent, an order among its siblings,
// a transform, flags and components. Code only knows component types.

type Vec3 = [number, number, number];
// A colour: "#rrggbb" (sRGB), or [r, g, b] in linear space when the hex form cannot hold it (HDR glow colours).
type ColorValue = string | [number, number, number];

// The values of a material that the editor can change. A shared material keeps them in `materials` by name;
// an own material of one mesh keeps them inline in its `meshRenderer`.
interface MaterialValues {
  color?: ColorValue;
  emissive?: ColorValue;
  emissiveIntensity?: number;
  roughness?: number;
  metalness?: number;
}

interface Flags {
  // A pure grouping node: a click in the Scene view selects its children, not the folder.
  folder?: boolean;
  // Shown in the Hierarchy and pickable. The default is true for a named object, false for an unnamed one.
  selectable?: boolean;
  // A component writes the transform every frame: the transform in the file is only the start.
  animated?: boolean;
  // Mounted into a curved surface on purpose: the blocking audit allows the overlap.
  seated?: boolean;
  // Not part of the set: the blocking audit and the pivot rule leave the subtree alone.
  auditIgnore?: boolean;
  // Editor Lighting swaps the material of this mesh for a matte one (the mirror floor).
  editorMatte?: boolean;
}

type ComponentData = Record<string, unknown>;

interface ObjectRecord {
  name: string;
  // Id of the parent; "" is the scene root.
  parent: string;
  // Siblings sort by `order`, then by id. Gaps are fine: a move changes only the order of the moved object.
  order: number;
  position?: Vec3;
  // Degrees.
  rotation?: Vec3;
  // Only when it is not "XYZ".
  rotationOrder?: string;
  scale?: Vec3;
  // Only when false.
  visible?: boolean;
  flags?: Flags;
  components?: Record<string, ComponentData>;
}

// Scene-wide render settings: the background, the environment map, tone mapping, shadows and post-processing.
interface SceneSettings {
  background: ColorValue;
  // "studio" (the dark room with warm and blue panels) or "casino" (the warm casino room).
  environment: string;
  environmentIntensity: number;
  // "ACESFilmic", "AgX", "Neutral", "Reinhard", "Cineon", "Linear" or "None".
  toneMapping: string;
  toneMappingExposure: number;
  // "PCF", "PCFSoft", "VSM", "Basic" or "None".
  shadowMap: string;
  // MSAA samples of the render target the scene draws into.
  samples: number;
  // The bloom pass; null leaves it out.
  bloom: { strength: number; radius: number; threshold: number } | null;
}

interface SceneFile {
  format: string;
  version: number;
  settings: SceneSettings;
  materials: Record<string, MaterialValues>;
  objects: Record<string, ObjectRecord>;
}

const FORMAT = "gameshow-studio-scene";
const VERSION = 2;
const ROOT_ID = "";

function cleanVector(values: number[]): number[] {
  return values.map(clean);
}

function encodeColor(color: THREE.Color): ColorValue {
  const hex = `#${color.getHexString()}`;
  const back = new THREE.Color(hex);
  if (back.r === color.r && back.g === color.g && back.b === color.b) {
    return hex;
  }
  return [clean(color.r), clean(color.g), clean(color.b)];
}

function decodeColor(value: ColorValue, target: THREE.Color): THREE.Color {
  if (typeof value === "string") {
    return target.set(value);
  }
  return target.setRGB(value[0], value[1], value[2], THREE.LinearSRGBColorSpace);
}

export { FORMAT, ROOT_ID, VERSION, clean, cleanVector, decodeColor, encodeColor, formatJson, formatScene };
export type { ColorValue, ComponentData, Flags, MaterialValues, ObjectRecord, SceneFile, SceneSettings, Vec3 };
