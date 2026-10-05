import * as THREE from "three";

// Checks the blocking of the set for three kinds of defects:
// - a penetration: an edge of one mesh passes through a face of another mesh;
// - a z-fight: two faces lie in the same plane, face the same way and overlap;
// - a floating mesh: it touches nothing that leads down to the floor.
// Faces that only touch (a box resting on a box, a box against a wall) are not defects.
//
// Opt-outs on `userData`:
// - `auditIgnore`: the mesh is not checked at all (the mirror under the floor, the city backdrop, beams);
// - `seated`: the mesh is mounted into a curved surface on purpose (a bulb in a ring), so its
//   penetrations are not reported, but it still counts as touching.
//
// Run it in the browser console: `__studio.audit()`.

const TOUCH = 0.003;
const COPLANAR = 0.002;
const EDGE_MARGIN = 0.001;
// Triangles thinner than this (the smallest altitude, in metres) are not used as pierced faces.
const SLIVER = 0.002;

interface Solid {
  path: string;
  // 9 floats per triangle, world space.
  triangles: Float32Array;
  // 6 floats per triangle: min xyz, max xyz.
  bounds: Float32Array;
  box: THREE.Box3;
  seated: boolean;
}

interface PairDefect {
  a: string;
  b: string;
  count: number;
  at: [number, number, number];
  // The first piercing edge and the face it passes through, for debugging the audit itself.
  detail?: string;
}

interface AuditReport {
  penetrations: PairDefect[];
  zFights: PairDefect[];
  floating: string[];
  solids: number;
  seconds: number;
}

function ignored(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible || current.userData.auditIgnore || current.userData.beam) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function pathOf(object: THREE.Object3D, root: THREE.Object3D): string {
  const names: string[] = [];
  let current: THREE.Object3D | null = object;
  while (current && current !== root) {
    const index = current.parent ? current.parent.children.indexOf(current) : 0;
    names.unshift(current.name !== "" ? current.name : `~${index}`);
    current = current.parent;
  }
  return names.join("/");
}

function buildSolid(path: string, geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, seated: boolean): Solid {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const count = index ? index.count / 3 : position.count / 3;
  const triangles = new Float32Array(count * 9);
  const bounds = new Float32Array(count * 6);
  const box = new THREE.Box3();
  const vertex = new THREE.Vector3();
  for (let t = 0; t < count; t++) {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let k = 0; k < 3; k++) {
      const i = index ? index.getX(t * 3 + k) : t * 3 + k;
      vertex.fromBufferAttribute(position, i).applyMatrix4(matrix);
      triangles[t * 9 + k * 3] = vertex.x;
      triangles[t * 9 + k * 3 + 1] = vertex.y;
      triangles[t * 9 + k * 3 + 2] = vertex.z;
      minX = Math.min(minX, vertex.x);
      minY = Math.min(minY, vertex.y);
      minZ = Math.min(minZ, vertex.z);
      maxX = Math.max(maxX, vertex.x);
      maxY = Math.max(maxY, vertex.y);
      maxZ = Math.max(maxZ, vertex.z);
      box.expandByPoint(vertex);
    }
    bounds.set([minX, minY, minZ, maxX, maxY, maxZ], t * 6);
  }
  return { path, triangles, bounds, box, seated };
}

function collectSolids(root: THREE.Object3D): Solid[] {
  root.updateMatrixWorld(true);
  const solids: Solid[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || ignored(mesh)) {
      return;
    }
    const seated = Boolean(mesh.userData.seated);
    const path = pathOf(mesh, root);
    const instanced = mesh as THREE.InstancedMesh;
    if (instanced.isInstancedMesh) {
      const local = new THREE.Matrix4();
      for (let i = 0; i < instanced.count; i++) {
        instanced.getMatrixAt(i, local);
        solids.push(buildSolid(`${path}#${i}`, mesh.geometry, local.premultiply(mesh.matrixWorld), seated));
      }
    } else {
      solids.push(buildSolid(path, mesh.geometry, mesh.matrixWorld, seated));
    }
  });
  return solids;
}

function boundsOverlap(bounds: Float32Array, i: number, box: THREE.Box3, margin: number): boolean {
  return (
    bounds[i * 6]! <= box.max.x + margin &&
    bounds[i * 6 + 3]! >= box.min.x - margin &&
    bounds[i * 6 + 1]! <= box.max.y + margin &&
    bounds[i * 6 + 4]! >= box.min.y - margin &&
    bounds[i * 6 + 2]! <= box.max.z + margin &&
    bounds[i * 6 + 5]! >= box.min.z - margin
  );
}

function triangleBoundsOverlap(a: Float32Array, i: number, b: Float32Array, j: number, margin: number): boolean {
  for (let axis = 0; axis < 3; axis++) {
    if (a[i * 6 + axis]! > b[j * 6 + 3 + axis]! + margin || b[j * 6 + axis]! > a[i * 6 + 3 + axis]! + margin) {
      return false;
    }
  }
  return true;
}

const scratch = {
  a: new THREE.Triangle(),
  b: new THREE.Triangle(),
  normalA: new THREE.Vector3(),
  normalB: new THREE.Vector3(),
  p0: new THREE.Vector3(),
  p1: new THREE.Vector3(),
  closest: new THREE.Vector3(),
  edge1: new THREE.Vector3(),
  edge2: new THREE.Vector3(),
  direction: new THREE.Vector3(),
  h: new THREE.Vector3(),
  s: new THREE.Vector3(),
  q: new THREE.Vector3(),
  barycentric: new THREE.Vector3(),
  hitT: 0,
};

function loadTriangle(target: THREE.Triangle, data: Float32Array, i: number): THREE.Triangle {
  target.a.fromArray(data, i * 9);
  target.b.fromArray(data, i * 9 + 3);
  target.c.fromArray(data, i * 9 + 6);
  return target;
}

// True when the segment passes through the inside of the triangle.
// Both ends must lie more than EDGE_MARGIN off the triangle plane, on opposite sides:
// a segment that ends on the face or runs along it (within float32 rounding) only touches it.
function segmentPierces(p0: THREE.Vector3, p1: THREE.Vector3, triangle: THREE.Triangle): boolean {
  const { edge1, edge2, direction, h, s, q } = scratch;
  edge1.subVectors(triangle.b, triangle.a);
  edge2.subVectors(triangle.c, triangle.a);
  direction.subVectors(p1, p0);
  const length = direction.length();
  if (length < EDGE_MARGIN * 2) {
    return false;
  }
  const normal = scratch.normalA.crossVectors(edge1, edge2).normalize();
  const side0 = normal.dot(s.subVectors(p0, triangle.a));
  const side1 = normal.dot(s.subVectors(p1, triangle.a));
  if (side0 * side1 >= 0 || Math.abs(side0) <= EDGE_MARGIN || Math.abs(side1) <= EDGE_MARGIN) {
    return false;
  }
  h.crossVectors(direction, edge2);
  const det = edge1.dot(h);
  // A sliver triangle has no reliable plane: a segment that runs along the face seems to cross it.
  // Its well-shaped neighbours in the same face still catch a real penetration.
  const longest = Math.max(edge1.length(), edge2.length(), triangle.c.distanceTo(triangle.b));
  if (scratch.q.crossVectors(edge1, edge2).length() / longest < SLIVER) {
    return false;
  }
  const inverse = 1 / det;
  s.subVectors(p0, triangle.a);
  const u = inverse * s.dot(h);
  q.crossVectors(s, edge1);
  const v = inverse * direction.dot(q);
  const t = inverse * edge2.dot(q);
  // The hit must be more than EDGE_MARGIN metres inside the triangle, measured from each edge:
  // a hit on an edge is a contact line, like a wall meeting a beam.
  const doubleArea = h.crossVectors(edge1, edge2).length();
  const w = 1 - u - v;
  const toAC = (u * doubleArea) / edge2.length();
  const toAB = (v * doubleArea) / edge1.length();
  const toBC = (w * doubleArea) / triangle.c.distanceTo(triangle.b);
  if (toAC <= EDGE_MARGIN || toAB <= EDGE_MARGIN || toBC <= EDGE_MARGIN) {
    return false;
  }
  scratch.hitT = t;
  return true;
}

// The point where an edge of `a` passes through `b`, or null.
function pierces(a: THREE.Triangle, b: THREE.Triangle): THREE.Vector3 | null {
  const corners = [a.a, a.b, a.c];
  for (let k = 0; k < 3; k++) {
    const p0 = corners[k]!;
    const p1 = corners[(k + 1) % 3]!;
    if (segmentPierces(p0, p1, b)) {
      return p0.clone().lerp(p1, scratch.hitT);
    }
  }
  return null;
}

function strictlyInside(point: THREE.Vector3, triangle: THREE.Triangle): boolean {
  const barycentric = triangle.getBarycoord(point, scratch.barycentric);
  if (!barycentric) {
    return false;
  }
  const margin = 1e-3;
  return barycentric.x > margin && barycentric.y > margin && barycentric.z > margin;
}

function zFighting(a: THREE.Triangle, b: THREE.Triangle): boolean {
  a.getNormal(scratch.normalA);
  b.getNormal(scratch.normalB);
  if (scratch.normalA.dot(scratch.normalB) < 0.999) {
    return false;
  }
  if (Math.abs(scratch.normalA.dot(scratch.p0.subVectors(b.a, a.a))) > COPLANAR) {
    return false;
  }
  const centroidA = a.getMidpoint(scratch.p0);
  if (strictlyInside(centroidA, b)) {
    return true;
  }
  const centroidB = b.getMidpoint(scratch.p1);
  if (strictlyInside(centroidB, a)) {
    return true;
  }
  return [a.a, a.b, a.c].some((corner) => strictlyInside(corner, b)) || [b.a, b.b, b.c].some((corner) => strictlyInside(corner, a));
}

function touches(a: THREE.Triangle, b: THREE.Triangle): boolean {
  for (const corner of [a.a, a.b, a.c]) {
    b.closestPointToPoint(corner, scratch.closest);
    if (scratch.closest.distanceTo(corner) < TOUCH) {
      return true;
    }
  }
  for (const corner of [b.a, b.b, b.c]) {
    a.closestPointToPoint(corner, scratch.closest);
    if (scratch.closest.distanceTo(corner) < TOUCH) {
      return true;
    }
  }
  return false;
}

function candidates(solid: Solid, box: THREE.Box3): number[] {
  const result: number[] = [];
  const count = solid.triangles.length / 9;
  for (let i = 0; i < count; i++) {
    if (boundsOverlap(solid.bounds, i, box, TOUCH)) {
      result.push(i);
    }
  }
  return result;
}

interface PairResult {
  penetration: number;
  penetrationAt: THREE.Vector3 | null;
  zFight: number;
  zFightAt: THREE.Vector3 | null;
  touching: boolean;
  detail: string;
}

function describe(a: THREE.Triangle, b: THREE.Triangle): string {
  const f = (v: THREE.Vector3) => `(${v.x.toFixed(7)},${v.y.toFixed(7)},${v.z.toFixed(7)})`;
  return `tri ${f(a.a)} ${f(a.b)} ${f(a.c)} | tri ${f(b.a)} ${f(b.b)} ${f(b.c)}`;
}

function checkPair(a: Solid, b: Solid): PairResult {
  const result: PairResult = { penetration: 0, penetrationAt: null, zFight: 0, zFightAt: null, touching: false, detail: "" };
  const listA = candidates(a, b.box);
  const listB = candidates(b, a.box);
  for (const i of listA) {
    const triangleA = loadTriangle(scratch.a, a.triangles, i);
    for (const j of listB) {
      if (!triangleBoundsOverlap(a.bounds, i, b.bounds, j, TOUCH)) {
        continue;
      }
      const triangleB = loadTriangle(scratch.b, b.triangles, j);
      const hit = pierces(triangleA, triangleB) ?? pierces(triangleB, triangleA);
      if (hit) {
        result.penetration += 1;
        if (!result.penetrationAt) {
          result.penetrationAt = hit;
          result.detail = describe(triangleA, triangleB);
        }
        result.touching = true;
        continue;
      }
      if (zFighting(triangleA, triangleB)) {
        result.zFight += 1;
        result.zFightAt ??= triangleA.getMidpoint(new THREE.Vector3());
        result.touching = true;
        continue;
      }
      if (!result.touching && touches(triangleA, triangleB)) {
        result.touching = true;
      }
    }
  }
  return result;
}

function toTuple(point: THREE.Vector3): [number, number, number] {
  return [Math.round(point.x * 100) / 100, Math.round(point.y * 100) / 100, Math.round(point.z * 100) / 100];
}

function auditBlocking(root: THREE.Object3D): AuditReport {
  const started = performance.now();
  const solids = collectSolids(root);
  const penetrations: PairDefect[] = [];
  const zFights: PairDefect[] = [];
  const links = solids.map(() => [] as number[]);
  const expanded = new THREE.Box3();

  for (let i = 0; i < solids.length; i++) {
    const a = solids[i]!;
    expanded.copy(a.box).expandByScalar(TOUCH);
    for (let j = i + 1; j < solids.length; j++) {
      const b = solids[j]!;
      if (!expanded.intersectsBox(b.box)) {
        continue;
      }
      const pair = checkPair(a, b);
      if (pair.touching) {
        links[i]!.push(j);
        links[j]!.push(i);
      }
      if (pair.penetration > 0 && pair.penetrationAt && !a.seated && !b.seated) {
        penetrations.push({ a: a.path, b: b.path, count: pair.penetration, at: toTuple(pair.penetrationAt), detail: pair.detail });
      }
      if (pair.zFight > 0 && pair.zFightAt) {
        zFights.push({ a: a.path, b: b.path, count: pair.zFight, at: toTuple(pair.zFightAt) });
      }
    }
  }

  // Everything that reaches the floor plane is grounded; the rest must touch a grounded mesh.
  const grounded = new Set<number>();
  const queue: number[] = [];
  solids.forEach((solid, index) => {
    if (solid.box.min.y < TOUCH) {
      grounded.add(index);
      queue.push(index);
    }
  });
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const next of links[current]!) {
      if (!grounded.has(next)) {
        grounded.add(next);
        queue.push(next);
      }
    }
  }
  const floating = solids.filter((_, index) => !grounded.has(index)).map((solid) => solid.path);

  return {
    penetrations,
    zFights,
    floating,
    solids: solids.length,
    seconds: Math.round((performance.now() - started) / 100) / 10,
  };
}

export { auditBlocking };
export type { AuditReport };
