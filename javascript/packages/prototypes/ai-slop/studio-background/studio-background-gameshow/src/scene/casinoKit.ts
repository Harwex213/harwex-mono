import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Building blocks of the casino hall (casino.ts). Every piece is built in a local frame and placed with `at`.
// A `Batch` collects pieces per material and merges them, so the whole hall draws in a few calls.

type Geometry = THREE.BufferGeometry;

// The kinds of the glow material (casinoGlow.frag).
const GLOW = { steady: 0, flame: 1, crystal: 2, screen: 3, bar: 4, window: 5 } as const;

// A small seeded random generator, so the hall is the same on every load.
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WHITE = new THREE.Color(1, 1, 1);

// Keeps position, normal and uv, and gives the geometry an index: the batch merges only indexed geometry.
function prepare(source: Geometry): Geometry {
  const geometry = new THREE.BufferGeometry();
  const position = source.getAttribute("position");
  geometry.setAttribute("position", position);
  if (!source.getAttribute("normal")) {
    source.computeVertexNormals();
  }
  geometry.setAttribute("normal", source.getAttribute("normal"));
  const uv = source.getAttribute("uv");
  geometry.setAttribute("uv", uv ?? new THREE.Float32BufferAttribute(new Float32Array(position.count * 2), 2));
  if (source.index) {
    geometry.setIndex(source.index);
  } else {
    geometry.setIndex([...Array(position.count).keys()]);
  }
  return geometry;
}

function filled(count: number, values: number[]): THREE.Float32BufferAttribute {
  const array = new Float32Array(count * values.length);
  for (let i = 0; i < count; i++) {
    array.set(values, i * values.length);
  }
  return new THREE.Float32BufferAttribute(array, values.length);
}

class Batch {
  private readonly parts = new Map<string, Geometry[]>();
  private transform: THREE.Matrix4 | null = null;
  triangles = 0;

  // Runs `build` with every added piece moved by `placement` (pieces are built in their own frame).
  within(placement: THREE.Matrix4, build: () => void): void {
    const outer = this.transform;
    this.transform = outer ? outer.clone().multiply(placement) : placement;
    build();
    this.transform = outer;
  }

  private push(key: string, geometry: Geometry): void {
    if (this.transform) {
      geometry.applyMatrix4(this.transform);
    }
    const list = this.parts.get(key) ?? [];
    list.push(geometry);
    this.parts.set(key, list);
    this.triangles += (geometry.index ? geometry.index.count : geometry.getAttribute("position").count) / 3;
  }

  // A lit piece. `color` tints the material colour (vertex colours).
  add(key: string, source: Geometry, color: THREE.Color = WHITE): void {
    const geometry = prepare(source);
    geometry.setAttribute("color", filled(geometry.getAttribute("position").count, [color.r, color.g, color.b]));
    this.push(key, geometry);
  }

  // An emitter: `color` is its HDR colour, `kind` one of GLOW, `phase` its own offset in 0..1.
  glow(key: string, source: Geometry, color: THREE.Color, kind: number, phase: number): void {
    const geometry = prepare(source);
    const count = geometry.getAttribute("position").count;
    geometry.setAttribute("aColor", filled(count, [color.r, color.g, color.b]));
    geometry.setAttribute("aFx", filled(count, [kind, phase]));
    this.push(key, geometry);
  }

  // A piece that already carries the attributes of its batch (a merged part of another batch).
  addPrepared(key: string, geometry: Geometry): void {
    this.push(key, geometry);
  }

  has(key: string): boolean {
    return this.parts.has(key);
  }

  merged(key: string): Geometry {
    const list = this.parts.get(key);
    if (!list || list.length === 0) {
      throw new Error(`casino batch ${key} is empty`);
    }
    const geometry = mergeGeometries(list);
    if (!geometry) {
      throw new Error(`cannot merge casino batch ${key}`);
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  keys(): string[] {
    return [...this.parts.keys()];
  }
}

const matrix = new THREE.Matrix4();
const rotation = new THREE.Quaternion();
const euler = new THREE.Euler();
const scaleVector = new THREE.Vector3();
const offset = new THREE.Vector3();

// Places a copy of a geometry: scaled, turned by yaw about y (then pitch about x and roll about z before it), moved.
function at(geometry: Geometry, x: number, y: number, z: number, yaw = 0, scale: number | THREE.Vector3 = 1, pitch = 0, roll = 0): Geometry {
  euler.set(pitch, yaw, roll, "YXZ");
  rotation.setFromEuler(euler);
  if (typeof scale === "number") {
    scaleVector.set(scale, scale, scale);
  } else {
    scaleVector.copy(scale);
  }
  matrix.compose(offset.set(x, y, z), rotation, scaleVector);
  return geometry.clone().applyMatrix4(matrix);
}

// A mirror copy across the plane z = 0, with the winding turned back so the faces still face out.
function mirrored(geometry: Geometry): Geometry {
  // Keeps every attribute (colours, glow kinds): only the points, the normals and the winding change.
  const copy = geometry.clone();
  if (!copy.index) {
    copy.setIndex([...Array(copy.getAttribute("position").count).keys()]);
  }
  copy.scale(1, 1, -1);
  const index = copy.index;
  if (index) {
    const flipped: number[] = [];
    for (let i = 0; i < index.count; i += 3) {
      flipped.push(index.getX(i), index.getX(i + 2), index.getX(i + 1));
    }
    copy.setIndex(flipped);
  }
  return copy;
}

// Box between two corners.
function cuboid(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Geometry {
  const geometry = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
  geometry.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return geometry;
}

// Upright cylinder or cone from y0 to y1 round the y axis.
function drum(radiusTop: number, radiusBottom: number, y0: number, y1: number, segments = 16, open = false): Geometry {
  const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, y1 - y0, segments, 1, open);
  geometry.translate(0, (y0 + y1) / 2, 0);
  return geometry;
}

// Horizontal ring round the y axis at height y.
function ring(radius: number, tube: number, y: number, tubular = 32, radial = 6): Geometry {
  const geometry = new THREE.TorusGeometry(radius, tube, radial, tubular);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, y, 0);
  return geometry;
}

// A thin rod from a to b.
function rod(a: THREE.Vector3, b: THREE.Vector3, radius: number, segments = 6): Geometry {
  const length = a.distanceTo(b);
  const geometry = new THREE.CylinderGeometry(radius, radius, length, segments, 1, true);
  geometry.translate(0, length / 2, 0);
  const direction = new THREE.Vector3().subVectors(b, a).normalize();
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction));
  geometry.translate(a.x, a.y, a.z);
  return geometry;
}

// A flat polygon in the plan at height y, facing up (or down): `plan` holds (u, v) points.
function planFace(plan: THREE.Vector2[], y: number, up: boolean): Geometry {
  // Shape (x, y) = (u, -v): the X rotation turns shape y into -z, so the face lands at z = v.
  const shape = new THREE.Shape(plan.map((point) => new THREE.Vector2(point.x, -point.y)));
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  if (!up) {
    // Facing down: the same points with the winding reversed.
    const index = geometry.index;
    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i + 1);
        index.setX(i + 1, index.getX(i + 2));
        index.setX(i + 2, a);
      }
    }
    const normal = geometry.getAttribute("normal");
    for (let i = 0; i < normal.count; i++) {
      normal.setXYZ(i, 0, -1, 0);
    }
  }
  geometry.translate(0, y, 0);
  return geometry;
}

// An upright prism over a plan polygon of (u, v) points, from y0 to y1.
function planPrism(plan: THREE.Vector2[], y0: number, y1: number): Geometry {
  const shape = new THREE.Shape(plan.map((point) => new THREE.Vector2(point.x, -point.y)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y0, 0);
  return geometry;
}

// Keeps the part of a convex or concave polygon where a * x + b * y + c >= 0 (Sutherland-Hodgman, one plane).
function clipPolygon(polygon: THREE.Vector2[], a: number, b: number, c: number): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  const side = (point: THREE.Vector2) => a * point.x + b * point.y + c;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i] as THREE.Vector2;
    const q = polygon[(i + 1) % polygon.length] as THREE.Vector2;
    const sp = side(p);
    const sq = side(q);
    if (sp >= 0) {
      out.push(p.clone());
    }
    if ((sp >= 0) !== (sq >= 0)) {
      out.push(new THREE.Vector2().lerpVectors(p, q, sp / (sp - sq)));
    }
  }
  return out;
}

// The span of the line y = v inside a polygon of (x, y) points, as [from, to] along x (the widest span).
function spanAt(polygon: THREE.Vector2[], v: number): [number, number] | null {
  const crossings: number[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i] as THREE.Vector2;
    const q = polygon[(i + 1) % polygon.length] as THREE.Vector2;
    if ((p.y <= v) !== (q.y <= v)) {
      crossings.push(p.x + ((v - p.y) / (q.y - p.y)) * (q.x - p.x));
    }
  }
  if (crossings.length < 2) {
    return null;
  }
  return [Math.min(...crossings), Math.max(...crossings)];
}

// The panel above an elliptical arch: from `left` to `right` along x, the arch springs at `spring` and rises by `rise`,
// the panel ends at `top`. It is `depth` thick along z, from z = 0.
function spandrel(left: number, right: number, spring: number, rise: number, top: number, depth: number): Geometry {
  const half = (right - left) / 2;
  const shape = new THREE.Shape();
  shape.moveTo(left, spring);
  shape.lineTo(left, top);
  shape.lineTo(right, top);
  shape.lineTo(right, spring);
  shape.absellipse((left + right) / 2, spring, half, rise, 0, Math.PI, false, 0);
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 20 });
}

// A band along an elliptical arch: the inner edge on the arch, `width` wide, `depth` thick along z from z = 0.
function archBand(left: number, right: number, spring: number, rise: number, width: number, depth: number): Geometry {
  const half = (right - left) / 2;
  const centre = (left + right) / 2;
  const shape = new THREE.Shape();
  shape.moveTo(right + width, spring);
  shape.absellipse(centre, spring, half + width, rise + width, 0, Math.PI, false, 0);
  shape.lineTo(left, spring);
  shape.absellipse(centre, spring, half, rise, Math.PI, 0, true, 0);
  shape.lineTo(right + width, spring);
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 20 });
}

// The opening of an elliptical arch as a flat face at z = 0 facing +z: a rectangle up to `spring` and a half ellipse on it.
function archOpening(left: number, right: number, bottom: number, spring: number, rise: number): Geometry {
  const shape = new THREE.Shape();
  shape.moveTo(left, bottom);
  shape.lineTo(right, bottom);
  shape.lineTo(right, spring);
  shape.absellipse((left + right) / 2, spring, (right - left) / 2, rise, 0, Math.PI, false, 0);
  shape.lineTo(left, bottom);
  const geometry = new THREE.ShapeGeometry(shape, 20);
  // Opening uv: 0..1 over its bounding box, so a picture fills it.
  const position = geometry.getAttribute("position");
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    uv[i * 2] = (position.getX(i) - left) / (right - left);
    uv[i * 2 + 1] = (position.getY(i) - bottom) / (spring + rise - bottom);
  }
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return geometry;
}

// A velvet drape that hangs from its top edge and is tied back to one side.
// Local frame: x across (0..width), the top edge at y = 0, the drape hangs down to y = -height, folds along z.
// `tie` is the share of the height where the tieback gathers it, `side` the edge it is pulled to (-1 left, 1 right).
function drape(width: number, height: number, tie: number, side: -1 | 1, folds = 6, columns = 18, rows = 14): Geometry {
  const geometry = new THREE.PlaneGeometry(1, 1, columns, rows);
  const position = geometry.getAttribute("position");
  const depth = (width / folds) * 0.28;
  for (let i = 0; i < position.count; i++) {
    const s = position.getX(i) + 0.5;
    const t = 0.5 - position.getY(i);
    // How wide the drape is at this height: full at the top, gathered at the tieback, flaring a little below it.
    const gather = t < tie ? THREE.MathUtils.lerp(1, 0.2, THREE.MathUtils.smootherstep(t / tie, 0, 1)) : THREE.MathUtils.lerp(0.2, 0.42, (t - tie) / (1 - tie));
    const across = side < 0 ? s * width * gather : width - (1 - s) * width * gather;
    const fold = Math.sin(s * folds * Math.PI * 2) * depth * (0.6 + 0.8 * (1 - gather));
    position.setXYZ(i, across, -t * height, fold);
  }
  geometry.computeVertexNormals();
  return geometry;
}

// A crystal drop: a stretched octahedron.
const CRYSTAL = new THREE.OctahedronGeometry(1, 0);

// A tiered crystal chandelier, as in the photo: a long crystal tail from the crown down to the main ring of candles,
// then a crystal basket in three tiers down to a pendant. `diameter` is the main ring. Local frame: the main ring at y = 0.
// Gold parts go to `gold`, crystal and flames to `glow`.
function chandelier(batch: Batch, gold: string, glow: string, diameter: number, seed: number): void {
  const random = seededRandom(seed);
  const radius = diameter / 2;
  const d = diameter;
  const crystalColor = (bright: number) => new THREE.Color(1.0, 0.82, 0.56).multiplyScalar(bright * 1.45 * (0.7 + random() * 0.6));
  const crystal = (x: number, y: number, z: number, size: number, bright = 1.3) => {
    batch.glow(glow, at(CRYSTAL, x, y, z, random() * Math.PI, new THREE.Vector3(size, size * 1.7, size)), crystalColor(bright), GLOW.crystal, random());
  };
  // Frame.
  batch.add(gold, ring(radius * 0.97, d * 0.016, 0, 48, 6));
  batch.add(gold, ring(radius * 0.6, d * 0.01, d * 0.04, 32, 5));
  batch.add(gold, drum(d * 0.025, d * 0.025, -d * 0.5, d * 0.78, 8));
  batch.add(gold, ring(radius * 0.22, d * 0.012, d * 0.72, 20, 5));
  batch.add(gold, drum(radius * 0.05, radius * 0.24, d * 0.72, d * 0.8, 12));
  const tiers = [
    { r: 0.78, y: -0.13 },
    { r: 0.55, y: -0.26 },
    { r: 0.32, y: -0.37 },
  ];
  for (const tier of tiers) {
    batch.add(gold, ring(radius * tier.r, d * 0.007, d * tier.y, 32, 4));
  }
  // Candles on the main ring.
  const candles = 22;
  for (let i = 0; i < candles; i++) {
    const angle = (i / candles) * Math.PI * 2;
    const x = Math.cos(angle) * radius * 0.97;
    const z = Math.sin(angle) * radius * 0.97;
    batch.add(gold, at(drum(d * 0.018, d * 0.01, 0, d * 0.025, 8), x, d * 0.01, z));
    batch.glow(glow, at(drum(d * 0.007, d * 0.007, 0, d * 0.05, 6), x, d * 0.035, z), new THREE.Color(0.9, 0.8, 0.62), GLOW.steady, 0);
    batch.glow(glow, at(CRYSTAL, x, d * 0.095, z, 0, new THREE.Vector3(d * 0.008, d * 0.018, d * 0.008)), new THREE.Color(3.2, 2.2, 1.1), GLOW.flame, random());
  }
  // The tail: strands from the crown down to the ring, wider and wider.
  const strands = 40;
  for (let i = 0; i < strands; i++) {
    const angle = (i / strands) * Math.PI * 2;
    const count = 13;
    for (let j = 0; j < count; j++) {
      const t = (j + 0.5) / count;
      const r = radius * THREE.MathUtils.lerp(0.2, 0.9, t ** 0.75);
      crystal(Math.cos(angle) * r, d * THREE.MathUtils.lerp(0.7, 0.06, t), Math.sin(angle) * r, d * 0.007, 1.25);
    }
  }
  // Swags between the candles, sagging under the ring.
  for (let i = 0; i < candles; i++) {
    const a0 = (i / candles) * Math.PI * 2;
    const a1 = ((i + 1) / candles) * Math.PI * 2;
    for (let j = 1; j < 6; j++) {
      const t = j / 6;
      const angle = THREE.MathUtils.lerp(a0, a1, t);
      const sag = Math.sin(t * Math.PI) * d * 0.06;
      crystal(Math.cos(angle) * radius * 0.97, -sag - d * 0.01, Math.sin(angle) * radius * 0.97, d * 0.007, 1.5);
    }
  }
  // The basket: strands from the main ring down to the pendant, through the three tiers.
  const basket = 36;
  for (let i = 0; i < basket; i++) {
    const angle = ((i + 0.5) / basket) * Math.PI * 2;
    const count = 10;
    for (let j = 0; j < count; j++) {
      const t = (j + 0.5) / count;
      const r = radius * 0.92 * Math.cos(t * Math.PI * 0.5) ** 0.7;
      crystal(Math.cos(angle) * r, -d * 0.48 * t, Math.sin(angle) * r, d * 0.0075, 1.35);
    }
  }
  // Drops that hang from the tiers.
  for (const tier of tiers) {
    const drops = Math.round(28 * tier.r);
    for (let i = 0; i < drops; i++) {
      const angle = (i / drops) * Math.PI * 2;
      for (let j = 0; j < 3; j++) {
        crystal(Math.cos(angle) * radius * tier.r, d * tier.y - d * (0.02 + j * 0.03), Math.sin(angle) * radius * tier.r, d * 0.007, 1.6);
      }
    }
  }
  // The pendant.
  crystal(0, -d * 0.53, 0, d * 0.03, 1.8);
}

// A candelabrum fixed to a wall or a column: a back plate, a stem and `arms` candles in a fan.
// Local frame: the wall face at z = 0, the candelabrum stands out along +z; y = 0 is its bottom.
function candelabrum(batch: Batch, gold: string, glow: string, arms: number, size: number, random: () => number): void {
  batch.add(gold, cuboid(-0.09 * size, 0.09 * size, 0, 0.5 * size, 0, 0.04 * size));
  batch.add(gold, rod(new THREE.Vector3(0, 0.15 * size, 0.02 * size), new THREE.Vector3(0, 0.15 * size, 0.28 * size), 0.02 * size));
  batch.add(gold, drum(0.025 * size, 0.04 * size, 0.0, 0.62 * size, 8).translate(0, 0, 0.28 * size));
  for (let i = 0; i < arms; i++) {
    const t = arms === 1 ? 0.5 : i / (arms - 1);
    const x = (t - 0.5) * 0.62 * size;
    const lift = (1 - Math.abs(t - 0.5) * 2) * 0.12 * size;
    const top = 0.5 * size + lift;
    const z = 0.28 * size + (1 - Math.abs(t - 0.5) * 2) * 0.06 * size;
    batch.add(gold, rod(new THREE.Vector3(0, 0.32 * size, 0.28 * size), new THREE.Vector3(x, top - 0.02 * size, z), 0.012 * size, 5));
    batch.add(gold, at(drum(0.035 * size, 0.02 * size, 0, 0.04 * size, 8), x, top - 0.03 * size, z));
    batch.glow(glow, at(drum(0.016 * size, 0.016 * size, 0, 0.14 * size, 6), x, top, z), new THREE.Color(1.0, 0.88, 0.7), GLOW.steady, 0);
    batch.glow(glow, at(CRYSTAL, x, top + 0.19 * size, z, 0, new THREE.Vector3(0.022 * size, 0.05 * size, 0.022 * size)), new THREE.Color(4.0, 2.6, 1.2), GLOW.flame, random());
  }
}

// A gold statue on a marble pedestal: a draped figure with one arm raised. Local frame: the pedestal bottom at y = 0.
function statue(batch: Batch, gold: string, marble: string, height: number): void {
  const pedestal = height * 0.4;
  batch.add(marble, cuboid(-0.42, 0.42, 0, pedestal, -0.42, 0.42));
  batch.add(gold, cuboid(-0.46, 0.46, pedestal - 0.06, pedestal, -0.46, 0.46));
  batch.add(gold, cuboid(-0.46, 0.46, 0, 0.08, -0.46, 0.46));
  const h = height;
  const profile = [
    [0.0, 0],
    [0.3, 0],
    [0.27, 0.12],
    [0.2, 0.4],
    [0.17, 0.55],
    [0.2, 0.7],
    [0.19, 0.8],
    [0.08, 0.86],
    [0.0, 0.87],
  ].map(([r, y]) => new THREE.Vector2((r as number) * h * 0.5, (y as number) * h));
  batch.add(gold, at(new THREE.LatheGeometry(profile, 14), 0, pedestal, 0));
  batch.add(gold, at(new THREE.SphereGeometry(h * 0.055, 12, 8), 0, pedestal + h * 0.92, 0));
  batch.add(gold, rod(new THREE.Vector3(h * 0.08, pedestal + h * 0.78, 0), new THREE.Vector3(h * 0.16, pedestal + h * 1.05, h * 0.04), h * 0.025));
  batch.add(gold, rod(new THREE.Vector3(-h * 0.08, pedestal + h * 0.77, 0), new THREE.Vector3(-h * 0.12, pedestal + h * 0.5, h * 0.06), h * 0.025));
}

// A palm in a gold pot. Local frame: the pot bottom at y = 0.
function palm(batch: Batch, gold: string, leaf: string, dark: string, height: number, random: () => number): void {
  const pot = 0.75;
  batch.add(gold, drum(0.48, 0.36, 0, pot, 16));
  const trunkTop = height * 0.55;
  batch.add(dark, drum(0.08, 0.12, pot, trunkTop, 7), new THREE.Color(0.35, 0.25, 0.15));
  const length = height * 0.55;
  const frond = new THREE.PlaneGeometry(0.5, length, 1, 6);
  const position = frond.getAttribute("position");
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i) + length / 2;
    const width = (1 - (y / length) * 0.85) * Math.min(1, 0.25 + y / 0.5);
    position.setXYZ(i, position.getX(i) * width, y, -((y / length) ** 2) * length * 0.45);
  }
  frond.computeVertexNormals();
  const fronds = 10;
  for (let i = 0; i < fronds; i++) {
    batch.add(leaf, at(frond, 0, trunkTop, 0, (i / fronds) * Math.PI * 2 + random() * 0.3, 1, -0.75 + (i % 3) * 0.3), new THREE.Color().setHSL(0.3, 0.45, 0.25 + random() * 0.12));
  }
}

// A standing person in dark clothes; `height` 1.75 for a guest, less for a seated one. Local frame: the feet at y = 0.
function person(batch: Batch, dark: string, height: number, color: THREE.Color): void {
  const h = height / 1.75;
  const profile = [
    [0.0, 0],
    [0.15, 0],
    [0.16, 0.85],
    [0.2, 1.0],
    [0.23, 1.38],
    [0.17, 1.47],
    [0.06, 1.5],
    [0.0, 1.51],
  ].map(([r, y]) => new THREE.Vector2((r as number) * h, (y as number) * h));
  batch.add(dark, new THREE.LatheGeometry(profile, 8), color);
  batch.add(dark, at(new THREE.SphereGeometry(0.11 * h, 8, 6), 0, 1.62 * h, 0), new THREE.Color(0.55, 0.38, 0.28));
}

// A slot machine facing +z: a dark cabinet, a screen with the reels picture, a gold frame and a lit topper.
// Local frame: the cabinet bottom centre at y = 0.
function slotMachine(batch: Batch, keys: { dark: string; gold: string; glow: string }, tint: THREE.Color, phase: number): void {
  batch.add(keys.dark, cuboid(-0.36, 0.36, 0, 1.78, -0.34, 0.34), new THREE.Color(0.035, 0.025, 0.04));
  batch.add(keys.dark, cuboid(-0.36, 0.36, 0.82, 0.92, 0.34, 0.56), new THREE.Color(0.05, 0.035, 0.05));
  const screen = new THREE.PlaneGeometry(0.56, 0.7);
  batch.glow(keys.glow, at(screen, 0, 1.36, 0.345), tint, GLOW.screen, phase);
  batch.add(keys.gold, cuboid(-0.34, 0.34, 1.0, 1.03, 0.33, 0.36));
  batch.add(keys.gold, cuboid(-0.34, 0.34, 1.71, 1.74, 0.33, 0.36));
  batch.add(keys.gold, cuboid(-0.34, -0.31, 1.0, 1.74, 0.33, 0.36));
  batch.add(keys.gold, cuboid(0.31, 0.34, 1.0, 1.74, 0.33, 0.36));
  batch.glow(keys.glow, cuboid(-0.3, 0.3, 1.78, 2.0, 0.05, 0.3), tint.clone().multiplyScalar(0.35), GLOW.steady, 0);
  batch.add(keys.gold, cuboid(-0.37, 0.37, 2.12, 2.18, -0.22, 0.32));
}

export {
  Batch,
  GLOW,
  archBand,
  archOpening,
  at,
  candelabrum,
  chandelier,
  clipPolygon,
  cuboid,
  drape,
  drum,
  mirrored,
  palm,
  person,
  planFace,
  planPrism,
  ring,
  rod,
  seededRandom,
  slotMachine,
  spandrel,
  spanAt,
  statue,
};
