import type { Recipe } from "./geometryRecipes";
import type { ComponentData } from "./sceneFormat";

// Objects that the user adds in the editor: an empty group, mesh primitives and lights.
// An added object is an ordinary object of the scene file: `primitiveComponents` gives its components.
//
// Pivot rule: the geometry of every mesh primitive already has its origin at the bottom centre of its bounds,
// so `__studio.pivots()` stays empty.
// The box and the plane get 2 segments across: the pivot check samples vertices, and a vertex in the middle
// of the bottom face shows that the pivot lies on the geometry.

type AddKind = "group" | "cube" | "sphere" | "cylinder" | "plane" | "cone" | "torus" | "capsule" | "point" | "spot" | "directional";

interface AddEntry {
  kind: AddKind;
  label: string;
  section: "Empty" | "Mesh" | "Light";
}

const ADD_ENTRIES: AddEntry[] = [
  { kind: "group", label: "Group", section: "Empty" },
  { kind: "cube", label: "Cube", section: "Mesh" },
  { kind: "sphere", label: "Sphere", section: "Mesh" },
  { kind: "cylinder", label: "Cylinder", section: "Mesh" },
  { kind: "plane", label: "Plane", section: "Mesh" },
  { kind: "cone", label: "Cone", section: "Mesh" },
  { kind: "torus", label: "Torus", section: "Mesh" },
  { kind: "capsule", label: "Capsule", section: "Mesh" },
  { kind: "point", label: "Point Light", section: "Light" },
  { kind: "spot", label: "Spot Light", section: "Light" },
  { kind: "directional", label: "Directional Light", section: "Light" },
];

const HALF_PI = Math.PI / 2;

// Geometry with its origin at the bottom centre of its bounds.
const GEOMETRY: Record<string, Recipe> = {
  cube: { type: "box", widthSegments: 2, depthSegments: 2, ops: [["translate", 0, 0.5, 0]] },
  sphere: { type: "sphere", radius: 0.5, ops: [["translate", 0, 0.5, 0]] },
  cylinder: { type: "cylinder", radiusTop: 0.5, radiusBottom: 0.5, ops: [["translate", 0, 0.5, 0]] },
  // Lies on the ground, facing up.
  plane: { type: "plane", width: 2, height: 2, widthSegments: 2, heightSegments: 2, ops: [["rotateX", -HALF_PI]] },
  cone: { type: "cone", radius: 0.5, ops: [["translate", 0, 0.5, 0]] },
  // Lies flat, so the ring surrounds its own centre and the pivot is the bottom centre of the hole.
  torus: { type: "torus", radius: 0.5, tube: 0.15, radialSegments: 16, tubularSegments: 48, ops: [["rotateX", -HALF_PI], ["translate", 0, 0.15, 0]] },
  capsule: { type: "capsule", radius: 0.3, height: 0.8, capSegments: 8, radialSegments: 24, ops: [["translate", 0, 0.7, 0]] },
};

function isAddKind(value: unknown): value is AddKind {
  return ADD_ENTRIES.some((entry) => entry.kind === value);
}

function labelOf(kind: AddKind): string {
  return ADD_ENTRIES.find((entry) => entry.kind === kind)?.label ?? kind;
}

function isLightKind(kind: AddKind): boolean {
  return kind === "point" || kind === "spot" || kind === "directional";
}

// The components of a new object of `kind`. A spot or directional light aims at `targetId`:
// a child 1 m below it in its own frame, so rotating the light turns the beam, like in Unity.
function primitiveComponents(kind: AddKind, targetId: string): Record<string, ComponentData> | undefined {
  if (kind === "group") {
    return undefined;
  }
  if (kind === "point") {
    return { light: { type: "point", color: "#fff0dd", intensity: 20, distance: 12, decay: 2 } };
  }
  if (kind === "spot") {
    return { light: { type: "spot", color: "#fff0dd", intensity: 150, distance: 0, decay: 2, angle: 25, penumbra: 0.5, target: targetId } };
  }
  if (kind === "directional") {
    return { light: { type: "directional", color: "#ffffff", intensity: 1.5, target: targetId } };
  }
  return {
    meshRenderer: {
      geometry: GEOMETRY[kind],
      material: { color: "#b4b4b4", emissive: "#000000", emissiveIntensity: 1, roughness: 0.5, metalness: 0 },
      castShadow: true,
      receiveShadow: true,
    },
  };
}

export { ADD_ENTRIES, isAddKind, isLightKind, labelOf, primitiveComponents };
export type { AddEntry, AddKind };
