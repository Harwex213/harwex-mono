import * as THREE from "three";
import { named } from "../scene/geometry";

// Objects that the user adds in the editor: an empty group, mesh primitives and lights.
// The scene document stores an added object as data (its kind, name, parent, transform and material)
// and builds it again with `createPrimitive` on load.
//
// Pivot rule: the geometry of every mesh primitive already has its origin at the bottom centre of its bounds,
// so `__studio.pivots()` stays empty without `recenterPivots` (that one runs only at startup).
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

const DEFAULT_COLOR = 0xb4b4b4;

function isAddKind(value: unknown): value is AddKind {
  return ADD_ENTRIES.some((entry) => entry.kind === value);
}

function labelOf(kind: AddKind): string {
  return ADD_ENTRIES.find((entry) => entry.kind === kind)?.label ?? kind;
}

function isLightKind(kind: AddKind): boolean {
  return kind === "point" || kind === "spot" || kind === "directional";
}

function isMeshKind(kind: AddKind): boolean {
  return kind !== "group" && !isLightKind(kind);
}

// Geometry with its origin at the bottom centre of its bounds.
function primitiveGeometry(kind: AddKind): THREE.BufferGeometry {
  if (kind === "cube") {
    return new THREE.BoxGeometry(1, 1, 1, 2, 1, 2).translate(0, 0.5, 0);
  }
  if (kind === "sphere") {
    return new THREE.SphereGeometry(0.5, 32, 16).translate(0, 0.5, 0);
  }
  if (kind === "cylinder") {
    return new THREE.CylinderGeometry(0.5, 0.5, 1, 32).translate(0, 0.5, 0);
  }
  if (kind === "plane") {
    // Lies on the ground, facing up.
    return new THREE.PlaneGeometry(2, 2, 2, 2).rotateX(-Math.PI / 2);
  }
  if (kind === "cone") {
    return new THREE.ConeGeometry(0.5, 1, 32).translate(0, 0.5, 0);
  }
  if (kind === "torus") {
    // Lies flat, so the ring surrounds its own centre and the pivot is the bottom centre of the hole.
    return new THREE.TorusGeometry(0.5, 0.15, 16, 48).rotateX(-Math.PI / 2).translate(0, 0.15, 0);
  }
  return new THREE.CapsuleGeometry(0.3, 0.8, 8, 24).translate(0, 0.7, 0);
}

function createOwnMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: DEFAULT_COLOR, roughness: 0.5, metalness: 0 });
  // The Inspector lists only named materials. `own` keeps it out of the list of shared materials.
  material.name = "Own Material";
  material.userData.own = true;
  return material;
}

// A light aims at a target that hangs 1 m below it in its own frame: rotating the light turns the beam, like in Unity.
function aimDown(light: THREE.SpotLight | THREE.DirectionalLight): void {
  light.target.position.set(0, -1, 0);
  light.add(light.target);
}

function createPrimitive(kind: AddKind, name: string): THREE.Object3D {
  if (kind === "group") {
    // A pure grouping node, like the folders of the code: a click in the Scene view selects its children.
    return named(new THREE.Group(), name, true);
  }
  if (kind === "point") {
    return named(new THREE.PointLight(0xfff0dd, 20, 12, 2), name);
  }
  if (kind === "spot") {
    const light = new THREE.SpotLight(0xfff0dd, 150, 0, THREE.MathUtils.degToRad(25), 0.5, 2);
    aimDown(light);
    return named(light, name);
  }
  if (kind === "directional") {
    const light = new THREE.DirectionalLight(0xffffff, 1.5);
    aimDown(light);
    return named(light, name);
  }
  const material = createOwnMaterial();
  const mesh = new THREE.Mesh(primitiveGeometry(kind), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.ownMaterial = material;
  return named(mesh, name);
}

export { ADD_ENTRIES, createOwnMaterial, createPrimitive, isAddKind, isLightKind, isMeshKind, labelOf };
export type { AddEntry, AddKind };
