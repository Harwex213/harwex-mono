import * as THREE from "three";

// Building blocks of the distant casino (casinoDistant.ts).
//
// `SolidBatch` merges many small parts into one mesh with baked lighting. Each vertex stores its
// lit colour (`aLit`), so the hall needs no real light at run time. The fragment shader adds only the
// view-dependent parts: the gold and marble glints, the velvet sheen, the crystal sparkle and the fog.
// `GlowBatch` holds camera-facing sprites (halos, light shafts, star glints, haze) for one additive mesh.

// Surface of a part. The fragment shader picks its pattern and its glints by this number.
const Surface = {
  matte: 0,
  // Carpet with a marble aisle and border, chosen in the shader by the position on the floor.
  floor: 1,
  gold: 2,
  velvet: 3,
  felt: 4,
  lacquer: 5,
} as const;

// Animation of the emissive colour.
const Glow = {
  none: 0,
  steady: 1,
  flicker: 2,
  crystal: 3,
  slotScreen: 4,
  chase: 5,
  sheer: 6,
  sunburst: 7,
  painting: 8,
} as const;

// Animation of the vertices.
const Motion = {
  none: 0,
  // Pendulum about `pivot` (a chandelier on its chain).
  sway: 1,
  // Walks to and fro: pivot = (direction x, direction z, speed, range).
  walk: 2,
} as const;

interface Paint {
  color: THREE.ColorRepresentation;
  surface?: number;
  emit?: THREE.ColorRepresentation;
  // Multiplies `emit`, linear.
  emitStrength?: number;
  glow?: number;
  // 0..1, gives each object its own rhythm.
  seed?: number;
  motion?: number;
  pivot?: [number, number, number, number];
}

interface BakeLight {
  position: THREE.Vector3;
  // Linear colour times intensity.
  color: THREE.Color;
  // Distance at which the light falls to half.
  range: number;
}

// A light reaches this many ranges; beyond it the window brings it smoothly to zero.
const REACH = 4;
const CELL = 4;

// Seeded random numbers, so the layout is the same on every load.
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const euler = new THREE.Euler();
const quaternion = new THREE.Quaternion();

// Transform from a position, a scale and a rotation (radians, XYZ order).
function place(x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0): THREE.Matrix4 {
  euler.set(rx, ry, rz);
  quaternion.setFromEuler(euler);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), quaternion, new THREE.Vector3(sx, sy, sz));
}

class SolidBatch {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly albedo: number[] = [];
  private readonly emit: number[] = [];
  private readonly info: number[] = [];
  private readonly pivots: number[] = [];
  private readonly indices: number[] = [];
  private readonly color = new THREE.Color();
  private readonly emitColor = new THREE.Color();
  private readonly vertex = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly normalMatrix = new THREE.Matrix3();

  add(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, paint: Paint): void {
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const uv = geometry.getAttribute("uv");
    const base = this.positions.length / 3;
    this.normalMatrix.getNormalMatrix(matrix);
    this.color.set(paint.color);
    this.emitColor.set(paint.emit ?? 0x000000).multiplyScalar(paint.emitStrength ?? 1);
    const pivot = paint.pivot ?? [0, 0, 0, 0];
    for (let i = 0; i < position.count; i++) {
      this.vertex.fromBufferAttribute(position, i).applyMatrix4(matrix);
      this.positions.push(this.vertex.x, this.vertex.y, this.vertex.z);
      if (normal) {
        this.normal.fromBufferAttribute(normal, i).applyMatrix3(this.normalMatrix).normalize();
      } else {
        this.normal.set(0, 1, 0);
      }
      this.normals.push(this.normal.x, this.normal.y, this.normal.z);
      this.uvs.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      this.albedo.push(this.color.r, this.color.g, this.color.b);
      this.emit.push(this.emitColor.r, this.emitColor.g, this.emitColor.b, paint.glow ?? Glow.none);
      this.info.push(paint.surface ?? Surface.matte, paint.seed ?? 0, paint.motion ?? Motion.none, 0);
      this.pivots.push(pivot[0], pivot[1], pivot[2], pivot[3]);
    }
    const index = geometry.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i++) {
        this.indices.push(base + index.getX(i));
      }
    } else {
      for (let i = 0; i < position.count; i++) {
        this.indices.push(base + i);
      }
    }
  }

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  // Bakes the light of `lights` and the ambient term into a lit colour per vertex.
  build(lights: LightGrid, ambient: (normalY: number, height: number, target: THREE.Color) => THREE.Color): THREE.BufferGeometry {
    const count = this.positions.length / 3;
    const lit = new Float32Array(count * 3);
    const sum = new THREE.Color();
    const sky = new THREE.Color();
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      p.fromArray(this.positions, i * 3);
      n.fromArray(this.normals, i * 3);
      ambient(n.y, p.y, sum);
      lights.gather(p, n, sky);
      sum.add(sky);
      lit[i * 3] = sum.r * (this.albedo[i * 3] ?? 0);
      lit[i * 3 + 1] = sum.g * (this.albedo[i * 3 + 1] ?? 0);
      lit[i * 3 + 2] = sum.b * (this.albedo[i * 3 + 2] ?? 0);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.setAttribute("aLit", new THREE.BufferAttribute(lit, 3));
    geometry.setAttribute("aEmit", new THREE.Float32BufferAttribute(this.emit, 4));
    geometry.setAttribute("aInfo", new THREE.Float32BufferAttribute(this.info, 4));
    geometry.setAttribute("aPivot", new THREE.Float32BufferAttribute(this.pivots, 4));
    geometry.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(this.indices, 1) : new THREE.Uint16BufferAttribute(this.indices, 1));
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
  }
}

// Bake lights sorted into a grid on the floor plan, so a vertex looks only at the lights near it.
class LightGrid {
  private readonly cells = new Map<string, BakeLight[]>();
  readonly lights: BakeLight[] = [];
  private readonly delta = new THREE.Vector3();

  add(light: BakeLight): void {
    this.lights.push(light);
    const reach = light.range * REACH;
    const x0 = Math.floor((light.position.x - reach) / CELL);
    const x1 = Math.floor((light.position.x + reach) / CELL);
    const z0 = Math.floor((light.position.z - reach) / CELL);
    const z1 = Math.floor((light.position.z + reach) / CELL);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const key = `${x},${z}`;
        const cell = this.cells.get(key);
        if (cell) {
          cell.push(light);
        } else {
          this.cells.set(key, [light]);
        }
      }
    }
  }

  // Sum of the lights at point `p` with normal `n`: wrapped Lambert, soft inverse square, smooth window.
  gather(p: THREE.Vector3, n: THREE.Vector3, target: THREE.Color): THREE.Color {
    target.setRGB(0, 0, 0);
    const cell = this.cells.get(`${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`);
    if (!cell) {
      return target;
    }
    for (const light of cell) {
      this.delta.subVectors(light.position, p);
      const d2 = this.delta.lengthSq();
      const reach = light.range * REACH;
      if (d2 >= reach * reach) {
        continue;
      }
      const d = Math.sqrt(d2);
      const facing = d > 1e-4 ? this.delta.dot(n) / d : 1;
      const wrap = Math.max((facing + 0.25) / 1.25, 0);
      const ratio = d2 / (reach * reach);
      const window = (1 - ratio * ratio) * (1 - ratio * ratio);
      const falloff = window / (1 + d2 / (light.range * light.range));
      target.r += light.color.r * wrap * falloff;
      target.g += light.color.g * wrap * falloff;
      target.b += light.color.b * wrap * falloff;
    }
    return target;
  }
}

// Sprite kinds of the glow mesh.
const Sprite = {
  halo: 0,
  // Vertical trapezoid hanging down from the point, turned to the camera about the vertical.
  shaft: 1,
  star: 2,
  haze: 3,
} as const;

interface SpriteOptions {
  kind?: number;
  glow?: number;
  seed?: number;
  // Shaft: its length down from the point.
  length?: number;
}

class GlowBatch {
  private readonly centers: number[] = [];
  private readonly corners: number[] = [];
  private readonly colors: number[] = [];
  private readonly infos: number[] = [];
  private readonly indices: number[] = [];
  private readonly color = new THREE.Color();

  // `size` is the radius of the sprite (the half width of a shaft).
  add(at: THREE.Vector3, color: THREE.ColorRepresentation, strength: number, size: number, options: SpriteOptions = {}): void {
    this.color.set(color).multiplyScalar(strength);
    const base = this.centers.length / 3;
    for (const [cx, cy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      this.centers.push(at.x, at.y, at.z);
      this.corners.push(cx, cy);
      this.colors.push(this.color.r, this.color.g, this.color.b, size);
      this.infos.push(options.kind ?? Sprite.halo, options.glow ?? Glow.steady, options.seed ?? 0, options.length ?? 0);
    }
    this.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }

  get count(): number {
    return this.centers.length / 12;
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.centers, 3));
    geometry.setAttribute("aCorner", new THREE.Float32BufferAttribute(this.corners, 2));
    geometry.setAttribute("aGlow", new THREE.Float32BufferAttribute(this.colors, 4));
    geometry.setAttribute("aGlowInfo", new THREE.Float32BufferAttribute(this.infos, 4));
    geometry.setIndex(this.centers.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.indices, 1) : new THREE.Uint16BufferAttribute(this.indices, 1));
    return geometry;
  }
}

export { Glow, GlowBatch, LightGrid, Motion, Sprite, SolidBatch, Surface, place, random, type BakeLight, type Paint };
