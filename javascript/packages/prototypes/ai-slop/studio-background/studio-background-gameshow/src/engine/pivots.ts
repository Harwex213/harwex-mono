import * as THREE from "three";

// Pivot rule: the origin of every selectable object sits at the bottom centre of its world bounds,
// so the editor gizmo appears on the object, like in Unity.
// An object that does not surround its own bounds centre (a horseshoe of steps, an arc of truss)
// gets the point of its geometry nearest to that centre instead, at the same bottom height.
//
// The scene code builds props in whatever frame is convenient; `recenterPivots` then moves each
// origin without moving anything in the world: the children and the geometry shift back by the
// same amount. It runs once, before the editor takes its snapshot of code defaults.
//
// Left alone: folders, lights, cameras, the mirror, fake beams, animated objects (their code writes
// their transform every frame) and everything that is not part of the set (`auditIgnore`).

const SAMPLES_PER_MESH = 300;
// The geometry surrounds a point when no gap between sample directions around it is wider than this.
const SURROUND_GAP = Math.PI / 2;

interface MeshData {
  box: THREE.Box3;
  // World (x, z) of a subset of the vertices.
  samples: THREE.Vector2[];
}

function skipped(object: THREE.Object3D): boolean {
  return (
    Boolean((object as THREE.Light).isLight) ||
    Boolean((object as THREE.Camera).isCamera) ||
    Boolean((object as { isReflector?: boolean }).isReflector) ||
    Boolean(object.userData.beam) ||
    Boolean(object.userData.animated) ||
    Boolean(object.userData.auditIgnore)
  );
}

function ignoredSubtree(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current.userData.auditIgnore) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function measureMesh(mesh: THREE.Mesh): MeshData {
  const position = mesh.geometry.getAttribute("position");
  const box = new THREE.Box3();
  const samples: THREE.Vector2[] = [];
  const vertex = new THREE.Vector3();
  const instanced = mesh as THREE.InstancedMesh;
  const matrices: THREE.Matrix4[] = [];
  if (instanced.isInstancedMesh) {
    for (let i = 0; i < instanced.count; i++) {
      const local = new THREE.Matrix4();
      instanced.getMatrixAt(i, local);
      matrices.push(local.premultiply(mesh.matrixWorld));
    }
  } else {
    matrices.push(mesh.matrixWorld);
  }
  const stride = Math.max(1, Math.floor((position.count * matrices.length) / SAMPLES_PER_MESH));
  let counter = 0;
  for (const matrix of matrices) {
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(matrix);
      box.expandByPoint(vertex);
      if (counter % stride === 0) {
        samples.push(new THREE.Vector2(vertex.x, vertex.z));
      }
      counter += 1;
    }
  }
  return { box, samples };
}

function measureAll(root: THREE.Object3D): Map<THREE.Mesh, MeshData> {
  root.updateMatrixWorld(true);
  const data = new Map<THREE.Mesh, MeshData>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && !mesh.userData.beam) {
      data.set(mesh, measureMesh(mesh));
    }
  });
  return data;
}

function gather(object: THREE.Object3D, data: Map<THREE.Mesh, MeshData>): MeshData | null {
  const box = new THREE.Box3();
  const samples: THREE.Vector2[] = [];
  object.traverse((child) => {
    const measured = data.get(child as THREE.Mesh);
    if (measured) {
      box.union(measured.box);
      samples.push(...measured.samples);
    }
  });
  return box.isEmpty() ? null : { box, samples };
}

function surrounds(samples: THREE.Vector2[], center: THREE.Vector2): boolean {
  const angles = samples
    .filter((sample) => sample.distanceToSquared(center) > 1e-6)
    .map((sample) => Math.atan2(sample.y - center.y, sample.x - center.x))
    .sort((a, b) => a - b);
  if (angles.length < 3) {
    return false;
  }
  let widest = angles[0]! + Math.PI * 2 - angles[angles.length - 1]!;
  for (let i = 1; i < angles.length; i++) {
    widest = Math.max(widest, angles[i]! - angles[i - 1]!);
  }
  return widest < SURROUND_GAP;
}

function nearestSample(samples: THREE.Vector2[], center: THREE.Vector2): THREE.Vector2 {
  let best = samples[0]!;
  for (const sample of samples) {
    if (sample.distanceToSquared(center) < best.distanceToSquared(center)) {
      best = sample;
    }
  }
  return best;
}

// The world point where the object's pivot belongs, or null for an object without geometry.
function pivotPoint(measured: MeshData): THREE.Vector3 {
  const center = measured.box.getCenter(new THREE.Vector3());
  const center2 = new THREE.Vector2(center.x, center.z);
  const ground = surrounds(measured.samples, center2) ? center2 : nearestSample(measured.samples, center2);
  return new THREE.Vector3(ground.x, measured.box.min.y, ground.y);
}

// Moves the origin of `object` by `offset` (in its own local space) and keeps everything in place.
function shiftOrigin(object: THREE.Object3D, offset: THREE.Vector3, geometryUsers: Map<THREE.BufferGeometry, number>): void {
  for (const child of object.children) {
    child.position.sub(offset);
  }
  const mesh = object as THREE.Mesh;
  if (mesh.isMesh) {
    const instanced = mesh as THREE.InstancedMesh;
    if (instanced.isInstancedMesh) {
      const back = new THREE.Matrix4().makeTranslation(-offset.x, -offset.y, -offset.z);
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < instanced.count; i++) {
        instanced.getMatrixAt(i, matrix);
        instanced.setMatrixAt(i, matrix.premultiply(back));
      }
      instanced.instanceMatrix.needsUpdate = true;
      instanced.boundingBox = null;
      instanced.boundingSphere = null;
    } else {
      // A geometry shared with other meshes gets its own copy, so they stay where they are.
      const users = geometryUsers.get(mesh.geometry) ?? 1;
      if (users > 1) {
        geometryUsers.set(mesh.geometry, users - 1);
        mesh.geometry = mesh.geometry.clone();
        geometryUsers.set(mesh.geometry, 1);
      }
      mesh.geometry.translate(-offset.x, -offset.y, -offset.z);
    }
  }
  object.updateMatrix();
  object.position.copy(offset.clone().applyMatrix4(object.matrix));
  object.updateMatrixWorld(true);
}

function pivotTargets(root: THREE.Object3D): THREE.Object3D[] {
  const targets: THREE.Object3D[] = [];
  // Post-order: children first, so a parent measures what its children already settled.
  const visit = (object: THREE.Object3D) => {
    for (const child of object.children) {
      visit(child);
    }
    if (object !== root && object.userData.selectable && !object.userData.folder && !skipped(object) && !ignoredSubtree(object)) {
      targets.push(object);
    }
  };
  visit(root);
  return targets;
}

function recenterPivots(root: THREE.Object3D): number {
  const data = measureAll(root);
  const geometryUsers = new Map<THREE.BufferGeometry, number>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) {
      geometryUsers.set(mesh.geometry, (geometryUsers.get(mesh.geometry) ?? 0) + 1);
    }
  });
  let moved = 0;
  for (const object of pivotTargets(root)) {
    const measured = gather(object, data);
    if (!measured) {
      continue;
    }
    const offset = object.worldToLocal(pivotPoint(measured));
    if (offset.lengthSq() > 1e-12) {
      shiftOrigin(object, offset, geometryUsers);
      moved += 1;
    }
  }
  return moved;
}

interface PivotProblem {
  path: string;
  pivot: [number, number, number];
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
}

const round = (v: THREE.Vector3): [number, number, number] => [Math.round(v.x * 100) / 100, Math.round(v.y * 100) / 100, Math.round(v.z * 100) / 100];

function pathOf(object: THREE.Object3D, root: THREE.Object3D): string {
  const names: string[] = [];
  let current: THREE.Object3D | null = object;
  while (current && current !== root) {
    names.unshift(current.name);
    current = current.parent;
  }
  return names.join("/");
}

// Lists selectable objects whose pivot is off the object: outside its bounds, or (for an object that
// does not surround its centre) farther than a tolerance from its geometry. Run it as `__studio.pivots()`.
// The check is loose on purpose, so a prop that was moved or turned in the editor still passes.
function checkPivots(root: THREE.Object3D): PivotProblem[] {
  const data = measureAll(root);
  const problems: PivotProblem[] = [];
  for (const object of pivotTargets(root)) {
    const measured = gather(object, data);
    if (!measured) {
      continue;
    }
    const pivot = object.getWorldPosition(new THREE.Vector3());
    const inside = measured.box.clone().expandByScalar(0.02).containsPoint(pivot);
    const pivot2 = new THREE.Vector2(pivot.x, pivot.z);
    const size = measured.box.getSize(new THREE.Vector3());
    const tolerance = Math.max(0.3, 0.1 * Math.hypot(size.x, size.z));
    const near = surrounds(measured.samples, pivot2) || nearestSample(measured.samples, pivot2).distanceTo(pivot2) <= tolerance;
    if (!inside || !near) {
      problems.push({ path: pathOf(object, root), pivot: round(pivot), boundsMin: round(measured.box.min), boundsMax: round(measured.box.max) });
    }
  }
  return problems;
}

export { checkPivots, recenterPivots };
export type { PivotProblem };
