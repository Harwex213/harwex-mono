import * as THREE from "three";

// Static batching, like Unity's: a folder with the `staticBatch` component draws the static meshes under it
// with one draw call per material (and shadow flags and render order).
// - A material without shader code of its own (the colonnade: gold, wall) gets a three.js BatchedMesh: one multi-draw
//   call that still culls every part against the view on its own, so a batch far out of view costs nothing.
// - A material with shader code of its own (the casino materials read the hall frame and per-vertex glow data) gets
//   one merged mesh: the vertices of all its parts, moved into the frame of the folder.
// - The source meshes stay in the tree: the Hierarchy lists them, the editor picks and moves them, Save writes them.
//   They move to BATCHED_LAYER, which no camera renders; the editor raycaster tests that layer too.
// - The batch meshes are children of the folder without an id: the scene file does not know them,
//   the editor does not list or pick them, and the blocking audit skips them (`auditIgnore`).
// - After every edit (`sync`) the batch compares its sources with the tree. A moved source writes only its own
//   matrix (BatchedMesh) or its own vertices (merged mesh). A source added, deleted, hidden, moved in or out, or given
//   another material rebuilds the batch.
// Left out of a batch (they draw as usual): animated subtrees (a component moves them every frame), the subtree of
// a nested batch, instanced meshes, mirrors, fake beams and meshes with a transparent material.

const BATCHED_LAYER = 2;

// The matrix from the frame of `object` to the frame of `ancestor`: the product of the local matrices between them.
// Unlike `inverse(ancestor.matrixWorld) * object.matrixWorld` it adds no rounding of its own, and it reads the
// current transforms, even before the renderer updates the world matrices.
function relativeMatrix(ancestor: THREE.Object3D, object: THREE.Object3D, target: THREE.Matrix4): THREE.Matrix4 {
  const chain: THREE.Object3D[] = [];
  let current: THREE.Object3D | null = object;
  while (current && current !== ancestor) {
    chain.push(current);
    current = current.parent;
  }
  if (current !== ancestor) {
    ancestor.updateWorldMatrix(true, false);
    object.updateWorldMatrix(true, false);
    return target.copy(ancestor.matrixWorld).invert().multiply(object.matrixWorld);
  }
  target.identity();
  for (let i = chain.length - 1; i >= 0; i--) {
    const link = chain[i]!;
    if (link.matrixAutoUpdate) {
      link.updateMatrix();
    }
    target.multiply(link.matrix);
  }
  return target;
}

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function isBatchable(object: THREE.Object3D): object is THREE.Mesh {
  const mesh = object as THREE.Mesh;
  if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) {
    return false;
  }
  if ((mesh as { isReflector?: boolean }).isReflector || mesh.userData.beam || mesh.userData.batchOutput) {
    return false;
  }
  return materialsOf(mesh).every((material) => !material.transparent);
}

// The attributes that `material` reads. A shader material reads the attributes its vertex shader names.
function attributeNames(material: THREE.Material, available: Set<string>): string[] {
  const shader = material as THREE.ShaderMaterial;
  if (shader.isShaderMaterial) {
    return [...available].filter((name) => name === "position" || new RegExp(`\\b${name}\\b`).test(shader.vertexShader));
  }
  const names = ["position", "normal", "uv"].filter((name) => name === "position" || available.has(name));
  if (material.vertexColors) {
    names.push("color");
  }
  return names;
}

// One draw group of one source mesh in a batch mesh.
interface Slice {
  mesh: THREE.Mesh;
  bucket: Bucket;
  // BatchedMesh: the instance of the part.
  instance: number;
  // Merged mesh: the first vertex in the merged buffers, the vertex count, and the source vertices of the group
  // in the frame of the mesh.
  offset: number;
  count: number;
  positions: Float32Array | null;
  normals: Float32Array | null;
}

interface Bucket {
  material: THREE.Material;
  castShadow: boolean;
  receiveShadow: boolean;
  renderOrder: number;
  // The groups of the sources, in tree order.
  parts: { mesh: THREE.Mesh; start: number; count: number }[];
  output: THREE.Mesh | THREE.BatchedMesh | null;
}

// A material that three.js can draw as a BatchedMesh: a built-in material without shader code of its own.
function drawsBatched(material: THREE.Material): boolean {
  return !(material as THREE.ShaderMaterial).isShaderMaterial && material.onBeforeCompile === THREE.Material.prototype.onBeforeCompile;
}

interface Member {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  materials: THREE.Material[];
  castShadow: boolean;
  receiveShadow: boolean;
  renderOrder: number;
}

function sameMembers(a: Member[], b: Member[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.mesh !== y.mesh || x.geometry !== y.geometry || x.castShadow !== y.castShadow || x.receiveShadow !== y.receiveShadow || x.renderOrder !== y.renderOrder) {
      return false;
    }
    if (x.materials.length !== y.materials.length || x.materials.some((material, index) => material !== y.materials[index])) {
      return false;
    }
  }
  return true;
}

// The xyz values of `count` vertices of an attribute from `first` on.
function copyRange(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, first: number, count: number): Float32Array {
  const result = new Float32Array(count * 3);
  for (let v = 0; v < count; v++) {
    result[v * 3] = attribute.getX(first + v);
    result[v * 3 + 1] = attribute.getY(first + v);
    result[v * 3 + 2] = attribute.getZ(first + v);
  }
  return result;
}

const vertex = new THREE.Vector3();
const normalMatrix = new THREE.Matrix3();

class StaticBatch {
  private readonly root: THREE.Object3D;
  private members: Member[] = [];
  private buckets: Bucket[] = [];
  private slices: Slice[] = [];
  // The matrix of each member at the last write, and whether it mirrors (turns the winding).
  private readonly matrices = new Map<THREE.Mesh, { matrix: THREE.Matrix4; mirrors: boolean }>();

  constructor(root: THREE.Object3D) {
    this.root = root;
  }

  // Brings the merged meshes in line with the tree.
  sync(): void {
    const members = this.collect();
    if (!sameMembers(members, this.members)) {
      this.rebuild(members);
      return;
    }
    const matrix = new THREE.Matrix4();
    const changed = new Set<THREE.Mesh>();
    for (const member of members) {
      relativeMatrix(this.root, member.mesh, matrix);
      const last = this.matrices.get(member.mesh);
      if (!last || !last.matrix.equals(matrix)) {
        if (!last || last.mirrors !== matrix.determinant() < 0) {
          this.rebuild(members);
          return;
        }
        last.matrix.copy(matrix);
        changed.add(member.mesh);
      }
    }
    if (changed.size === 0) {
      return;
    }
    const touched = new Set<Bucket>();
    for (const slice of this.slices) {
      if (changed.has(slice.mesh)) {
        this.write(slice, this.matrices.get(slice.mesh)!.matrix);
        touched.add(slice.bucket);
      }
    }
    for (const bucket of touched) {
      const output = bucket.output;
      if ((output as THREE.BatchedMesh | null)?.isBatchedMesh) {
        (output as THREE.BatchedMesh).computeBoundingSphere();
        (output as THREE.BatchedMesh).computeBoundingBox();
      } else {
        output?.geometry.computeBoundingSphere();
        output?.geometry.computeBoundingBox();
      }
    }
  }

  // Removes the batch meshes; the sources draw by themselves again.
  dispose(): void {
    this.rebuild([]);
  }

  // The static meshes under the root, in tree order.
  private collect(): Member[] {
    const members: Member[] = [];
    const visit = (object: THREE.Object3D) => {
      if (!object.visible || object.userData.animated || object.userData.batchOutput) {
        return;
      }
      if (object !== this.root && (object.userData.components as Record<string, unknown> | undefined)?.staticBatch) {
        return;
      }
      if (isBatchable(object)) {
        members.push({
          mesh: object,
          geometry: object.geometry,
          materials: materialsOf(object),
          castShadow: object.castShadow,
          receiveShadow: object.receiveShadow,
          renderOrder: object.renderOrder,
        });
      }
      for (const child of object.children) {
        visit(child);
      }
    };
    visit(this.root);
    return members;
  }

  private rebuild(members: Member[]): void {
    for (const bucket of this.buckets) {
      if (bucket.output) {
        bucket.output.removeFromParent();
        if ((bucket.output as THREE.BatchedMesh).isBatchedMesh) {
          (bucket.output as THREE.BatchedMesh).dispose();
        } else {
          bucket.output.geometry.dispose();
        }
      }
    }
    // A former source that left the batch draws by itself again.
    const kept = new Set(members.map((member) => member.mesh));
    for (const member of this.members) {
      if (!kept.has(member.mesh)) {
        member.mesh.layers.set(0);
      }
    }
    this.members = members;
    this.buckets = [];
    this.slices = [];
    this.matrices.clear();
    const byKey = new Map<string, Bucket>();
    for (const member of members) {
      const { mesh, geometry, materials } = member;
      const ranges: { material: THREE.Material; start: number; count: number }[] = [];
      const total = geometry.index ? geometry.index.count : geometry.getAttribute("position").count;
      if (Array.isArray(mesh.material)) {
        for (const group of geometry.groups) {
          const material = materials[group.materialIndex ?? 0];
          if (material) {
            ranges.push({ material, start: group.start, count: Math.min(group.count, total - group.start) });
          }
        }
      } else {
        ranges.push({ material: materials[0]!, start: 0, count: total });
      }
      for (const range of ranges) {
        const key = `${range.material.uuid}|${member.castShadow}|${member.receiveShadow}|${member.renderOrder}`;
        let bucket = byKey.get(key);
        if (!bucket) {
          bucket = { material: range.material, castShadow: member.castShadow, receiveShadow: member.receiveShadow, renderOrder: member.renderOrder, parts: [], output: null };
          byKey.set(key, bucket);
          this.buckets.push(bucket);
        }
        bucket.parts.push({ mesh, start: range.start, count: range.count });
      }
      const matrix = relativeMatrix(this.root, mesh, new THREE.Matrix4());
      this.matrices.set(mesh, { matrix, mirrors: matrix.determinant() < 0 });
      mesh.layers.set(BATCHED_LAYER);
    }
    for (const bucket of this.buckets) {
      this.merge(bucket);
    }
  }

  // Builds the batch mesh of a bucket.
  private merge(bucket: Bucket): void {
    const mirrors = bucket.parts.some((part) => this.matrices.get(part.mesh)!.mirrors);
    // A BatchedMesh turns the winding of the whole mesh, not of one part: a mirrored part needs merged vertices.
    if (drawsBatched(bucket.material) && !mirrors && this.instance(bucket)) {
      return;
    }
    const available = new Set<string>();
    for (const part of bucket.parts) {
      for (const name of Object.keys(part.mesh.geometry.attributes)) {
        available.add(name);
      }
    }
    const names = attributeNames(bucket.material, available);
    // The vertex range and the remapped index of each part.
    const layouts: { first: number; count: number; index: number[] }[] = [];
    let vertexCount = 0;
    let indexCount = 0;
    for (const part of bucket.parts) {
      const index = part.mesh.geometry.index;
      let first = part.start;
      let last = part.start + part.count - 1;
      if (index) {
        first = Infinity;
        last = -Infinity;
        for (let i = part.start; i < part.start + part.count; i++) {
          const value = index.getX(i);
          first = Math.min(first, value);
          last = Math.max(last, value);
        }
      }
      const indices: number[] = [];
      for (let i = part.start; i < part.start + part.count; i++) {
        indices.push((index ? index.getX(i) : i) - first + vertexCount);
      }
      if (this.matrices.get(part.mesh)!.mirrors) {
        for (let i = 0; i + 2 < indices.length; i += 3) {
          const swap = indices[i + 1]!;
          indices[i + 1] = indices[i + 2]!;
          indices[i + 2] = swap;
        }
      }
      layouts.push({ first, count: last - first + 1, index: indices });
      vertexCount += last - first + 1;
      indexCount += indices.length;
    }
    const geometry = new THREE.BufferGeometry();
    for (const name of names) {
      let itemSize = name === "uv" ? 2 : 3;
      for (const part of bucket.parts) {
        const attribute = part.mesh.geometry.getAttribute(name);
        if (attribute) {
          itemSize = attribute.itemSize;
          break;
        }
      }
      const array = new Float32Array(vertexCount * itemSize);
      if (name === "color") {
        array.fill(1);
      }
      let offset = 0;
      bucket.parts.forEach((part, i) => {
        const layout = layouts[i]!;
        const attribute = part.mesh.geometry.getAttribute(name) as THREE.BufferAttribute | undefined;
        if (attribute && name !== "position" && name !== "normal") {
          for (let v = 0; v < layout.count; v++) {
            for (let c = 0; c < itemSize; c++) {
              array[(offset + v) * itemSize + c] = attribute.getComponent(layout.first + v, c);
            }
          }
        }
        offset += layout.count;
      });
      geometry.setAttribute(name, new THREE.BufferAttribute(array, itemSize));
    }
    const indexArray = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
    let cursor = 0;
    for (const layout of layouts) {
      indexArray.set(layout.index, cursor);
      cursor += layout.index.length;
    }
    geometry.setIndex(new THREE.BufferAttribute(indexArray, 1));
    const output = new THREE.Mesh(geometry, bucket.material);
    this.output(bucket, output);
    let offset = 0;
    bucket.parts.forEach((part, i) => {
      const layout = layouts[i]!;
      const source = part.mesh.geometry;
      const position = source.getAttribute("position");
      const normal = names.includes("normal") ? source.getAttribute("normal") : undefined;
      const slice: Slice = { mesh: part.mesh, bucket, instance: -1, offset, count: layout.count, positions: copyRange(position, layout.first, layout.count), normals: normal ? copyRange(normal, layout.first, layout.count) : null };
      this.slices.push(slice);
      this.write(slice, this.matrices.get(part.mesh)!.matrix, false);
      offset += layout.count;
    });
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    this.root.add(output);
  }

  // Builds a BatchedMesh for a bucket: one geometry per source group, one instance per part.
  // Returns false when the geometries do not fit one BatchedMesh (different attributes).
  private instance(bucket: Bucket): boolean {
    const available = new Set<string>(["position", "normal", "uv", "color"]);
    for (const part of bucket.parts) {
      for (const name of [...available]) {
        if (!part.mesh.geometry.getAttribute(name)) {
          available.delete(name);
        }
      }
    }
    const names = attributeNames(bucket.material, available);
    if (!names.every((name) => available.has(name))) {
      return false;
    }
    // The geometry of each source group, with only the attributes the material reads and always an index.
    const geometries = new Map<string, THREE.BufferGeometry>();
    const keyOf = (part: Bucket["parts"][number]) => `${part.mesh.geometry.uuid}|${part.start}|${part.count}`;
    let vertexCount = 0;
    let indexCount = 0;
    for (const part of bucket.parts) {
      const key = keyOf(part);
      if (geometries.has(key)) {
        continue;
      }
      const source = part.mesh.geometry;
      const index = source.index;
      let first = part.start;
      let last = part.start + part.count - 1;
      if (index) {
        first = Infinity;
        last = -Infinity;
        for (let i = part.start; i < part.start + part.count; i++) {
          first = Math.min(first, index.getX(i));
          last = Math.max(last, index.getX(i));
        }
      }
      const geometry = new THREE.BufferGeometry();
      for (const name of names) {
        const attribute = source.getAttribute(name);
        const array = new Float32Array((last - first + 1) * attribute.itemSize);
        for (let v = first; v <= last; v++) {
          for (let c = 0; c < attribute.itemSize; c++) {
            array[(v - first) * attribute.itemSize + c] = attribute.getComponent(v, c);
          }
        }
        geometry.setAttribute(name, new THREE.BufferAttribute(array, attribute.itemSize));
      }
      const indices: number[] = [];
      for (let i = part.start; i < part.start + part.count; i++) {
        indices.push((index ? index.getX(i) : i) - first);
      }
      geometry.setIndex(indices);
      geometries.set(key, geometry);
      vertexCount += last - first + 1;
      indexCount += indices.length;
    }
    const batched = new THREE.BatchedMesh(bucket.parts.length, vertexCount, indexCount, bucket.material);
    const ids = new Map<string, number>();
    for (const [key, geometry] of geometries) {
      ids.set(key, batched.addGeometry(geometry));
      geometry.dispose();
    }
    this.output(bucket, batched);
    for (const part of bucket.parts) {
      const instance = batched.addInstance(ids.get(keyOf(part))!);
      batched.setMatrixAt(instance, this.matrices.get(part.mesh)!.matrix);
      this.slices.push({ mesh: part.mesh, bucket, instance, offset: 0, count: 0, positions: null, normals: null });
    }
    batched.computeBoundingBox();
    batched.computeBoundingSphere();
    this.root.add(batched);
    return true;
  }

  // Gives a batch mesh the flags of its bucket and keeps it out of picks, saves and the audit.
  private output(bucket: Bucket, mesh: THREE.Mesh | THREE.BatchedMesh): void {
    mesh.castShadow = bucket.castShadow;
    mesh.receiveShadow = bucket.receiveShadow;
    mesh.renderOrder = bucket.renderOrder;
    mesh.userData.batchOutput = true;
    mesh.userData.auditIgnore = true;
    mesh.userData.selectable = false;
    // Clicks go to the sources.
    mesh.raycast = () => {};
    bucket.output = mesh;
  }

  // Moves the part of a slice by `matrix`: its instance matrix, or its vertices in the merged buffers.
  private write(slice: Slice, matrix: THREE.Matrix4, upload = true): void {
    const output = slice.bucket.output!;
    if ((output as THREE.BatchedMesh).isBatchedMesh) {
      (output as THREE.BatchedMesh).setMatrixAt(slice.instance, matrix);
      return;
    }
    if (!slice.positions) {
      return;
    }
    const geometry = output.geometry;
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const target = position.array as Float32Array;
    for (let v = 0; v < slice.count; v++) {
      vertex.set(slice.positions[v * 3]!, slice.positions[v * 3 + 1]!, slice.positions[v * 3 + 2]!).applyMatrix4(matrix);
      target[(slice.offset + v) * 3] = vertex.x;
      target[(slice.offset + v) * 3 + 1] = vertex.y;
      target[(slice.offset + v) * 3 + 2] = vertex.z;
    }
    const normal = geometry.getAttribute("normal") as THREE.BufferAttribute | undefined;
    if (normal && slice.normals) {
      normalMatrix.getNormalMatrix(matrix);
      const array = normal.array as Float32Array;
      for (let v = 0; v < slice.count; v++) {
        vertex.set(slice.normals[v * 3]!, slice.normals[v * 3 + 1]!, slice.normals[v * 3 + 2]!).applyNormalMatrix(normalMatrix);
        array[(slice.offset + v) * 3] = vertex.x;
        array[(slice.offset + v) * 3 + 1] = vertex.y;
        array[(slice.offset + v) * 3 + 2] = vertex.z;
      }
    }
    if (upload) {
      position.addUpdateRange(slice.offset * 3, slice.count * 3);
      position.needsUpdate = true;
      if (normal && slice.normals) {
        normal.addUpdateRange(slice.offset * 3, slice.count * 3);
        normal.needsUpdate = true;
      }
    }
  }
}

export { BATCHED_LAYER, StaticBatch, relativeMatrix };
