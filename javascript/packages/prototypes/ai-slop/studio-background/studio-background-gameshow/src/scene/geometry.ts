import type * as THREE from "three";

// Gives an object a name in the editor Hierarchy and lets the editor select it.
// A folder only groups objects: a click in the Scene view selects its children, not the folder.
// Only the engine still names an object in code: the scene root.
function named<T extends THREE.Object3D>(object: T, name: string, folder = false): T {
  object.name = name;
  object.userData.selectable = true;
  object.userData.folder = folder;
  return object;
}

export { named };
