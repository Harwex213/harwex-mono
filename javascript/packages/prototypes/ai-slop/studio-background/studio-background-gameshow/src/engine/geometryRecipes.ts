import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// A geometry recipe: the data that builds one BufferGeometry.
// - A three.js primitive by its type ("box", "cylinder", "lathe", "extrude", ...) and its constructor parameters
//   under the three.js names. A parameter equal to the three.js default is left out.
// - "merge": `parts` (recipes) merged into one geometry; `groups` keeps one draw group per part.
// - "edges": the edges of `geometry` (a recipe).
// - `ops`: steps applied after the build, in order: ["rotateX", angle], ["translate", x, y, z], ["toNonIndexed"], ...
// The same recipe always builds the same vertices. Meshes with equal recipes share one geometry.

type Op = [string, ...number[]];

interface Recipe {
  type: string;
  ops?: Op[];
  [parameter: string]: unknown;
}

interface ShapeData {
  curves: unknown[][];
  holes?: ShapeData[];
  autoClose?: boolean;
}

// Constructor parameters of each primitive, in constructor order.
const PRIMITIVES: Record<string, { name: string; params: string[]; create: (...args: never[]) => THREE.BufferGeometry }> = {
  box: { name: "BoxGeometry", params: ["width", "height", "depth", "widthSegments", "heightSegments", "depthSegments"], create: (...a: never[]) => new THREE.BoxGeometry(...a) },
  sphere: { name: "SphereGeometry", params: ["radius", "widthSegments", "heightSegments", "phiStart", "phiLength", "thetaStart", "thetaLength"], create: (...a: never[]) => new THREE.SphereGeometry(...a) },
  cylinder: { name: "CylinderGeometry", params: ["radiusTop", "radiusBottom", "height", "radialSegments", "heightSegments", "openEnded", "thetaStart", "thetaLength"], create: (...a: never[]) => new THREE.CylinderGeometry(...a) },
  cone: { name: "ConeGeometry", params: ["radius", "height", "radialSegments", "heightSegments", "openEnded", "thetaStart", "thetaLength"], create: (...a: never[]) => new THREE.ConeGeometry(...a) },
  torus: { name: "TorusGeometry", params: ["radius", "tube", "radialSegments", "tubularSegments", "arc", "thetaStart", "thetaLength"], create: (...a: never[]) => new THREE.TorusGeometry(...a) },
  plane: { name: "PlaneGeometry", params: ["width", "height", "widthSegments", "heightSegments"], create: (...a: never[]) => new THREE.PlaneGeometry(...a) },
  circle: { name: "CircleGeometry", params: ["radius", "segments", "thetaStart", "thetaLength"], create: (...a: never[]) => new THREE.CircleGeometry(...a) },
  ring: { name: "RingGeometry", params: ["innerRadius", "outerRadius", "thetaSegments", "phiSegments", "thetaStart", "thetaLength"], create: (...a: never[]) => new THREE.RingGeometry(...a) },
  capsule: { name: "CapsuleGeometry", params: ["radius", "height", "capSegments", "radialSegments", "heightSegments"], create: (...a: never[]) => new THREE.CapsuleGeometry(...a) },
};

const NUMERIC_TYPES = Object.keys(PRIMITIVES);
const defaults = new Map<string, Record<string, unknown>>();

function defaultsOf(type: string): Record<string, unknown> {
  let result = defaults.get(type);
  if (!result) {
    const entry = PRIMITIVES[type];
    result = entry ? ((entry.create() as unknown as { parameters: Record<string, unknown> }).parameters ?? {}) : {};
    defaults.set(type, result);
  }
  return result;
}

// --- Shapes and curves -------------------------------------------------------------------------

function curveToData(curve: THREE.Curve<THREE.Vector2>): unknown[] {
  const c = curve as unknown as Record<string, unknown> & { type: string };
  if (c.type === "LineCurve") {
    const line = curve as THREE.LineCurve;
    return ["line", ...([line.v1.x, line.v1.y, line.v2.x, line.v2.y])];
  }
  if (c.type === "EllipseCurve" || c.type === "ArcCurve") {
    const e = curve as THREE.EllipseCurve;
    return [
      c.type === "ArcCurve" ? "arc" : "ellipse",
      ...([e.aX, e.aY, e.xRadius, e.yRadius, e.aStartAngle, e.aEndAngle]),
      e.aClockwise,
      e.aRotation,
    ];
  }
  if (c.type === "SplineCurve") {
    return ["spline", (curve as THREE.SplineCurve).points.map((p) => ([p.x, p.y]))];
  }
  if (c.type === "QuadraticBezierCurve") {
    const q = curve as THREE.QuadraticBezierCurve;
    return ["quadratic", ...([q.v0.x, q.v0.y, q.v1.x, q.v1.y, q.v2.x, q.v2.y])];
  }
  if (c.type === "CubicBezierCurve") {
    const q = curve as THREE.CubicBezierCurve;
    return ["cubic", ...([q.v0.x, q.v0.y, q.v1.x, q.v1.y, q.v2.x, q.v2.y, q.v3.x, q.v3.y])];
  }
  throw new Error(`unsupported curve ${c.type}`);
}

function curveFromData(data: unknown[]): THREE.Curve<THREE.Vector2> {
  const [kind, ...rest] = data;
  const n = rest as number[];
  if (kind === "line") {
    return new THREE.LineCurve(new THREE.Vector2(n[0], n[1]), new THREE.Vector2(n[2], n[3]));
  }
  if (kind === "arc" || kind === "ellipse") {
    const args: [number, number, number, number, number, number, boolean, number] = [n[0]!, n[1]!, n[2]!, n[3]!, n[4]!, n[5]!, rest[6] as boolean, rest[7] as number];
    if (kind === "arc") {
      const arc = new THREE.ArcCurve(args[0], args[1], args[2], args[4], args[5], args[6]);
      arc.yRadius = args[3];
      arc.aRotation = args[7];
      return arc;
    }
    return new THREE.EllipseCurve(...args);
  }
  if (kind === "spline") {
    return new THREE.SplineCurve((rest[0] as number[][]).map((p) => new THREE.Vector2(p[0], p[1])));
  }
  if (kind === "quadratic") {
    return new THREE.QuadraticBezierCurve(new THREE.Vector2(n[0], n[1]), new THREE.Vector2(n[2], n[3]), new THREE.Vector2(n[4], n[5]));
  }
  if (kind === "cubic") {
    return new THREE.CubicBezierCurve(new THREE.Vector2(n[0], n[1]), new THREE.Vector2(n[2], n[3]), new THREE.Vector2(n[4], n[5]), new THREE.Vector2(n[6], n[7]));
  }
  throw new Error(`unknown curve ${String(kind)}`);
}

function pathToData(path: THREE.Path): ShapeData {
  const data: ShapeData = { curves: path.curves.map(curveToData) };
  if (path.autoClose) {
    data.autoClose = true;
  }
  const shape = path as THREE.Shape;
  if (shape.holes && shape.holes.length > 0) {
    data.holes = shape.holes.map(pathToData);
  }
  return data;
}

function fillPath<T extends THREE.Path>(path: T, data: ShapeData): T {
  path.curves = data.curves.map(curveFromData);
  path.autoClose = data.autoClose ?? false;
  return path;
}

function shapeFromData(data: ShapeData): THREE.Shape {
  const shape = fillPath(new THREE.Shape(), data);
  shape.holes = (data.holes ?? []).map((hole) => fillPath(new THREE.Path(), hole));
  return shape;
}

// --- Recipes of existing geometries --------------------------------------------------------------

const recipes = new WeakMap<THREE.BufferGeometry, Recipe>();

function setRecipe(geometry: THREE.BufferGeometry, recipe: Recipe): void {
  recipes.set(geometry, recipe);
}

function getRecipe(geometry: THREE.BufferGeometry): Recipe | undefined {
  return recipes.get(geometry);
}

function typeKey(geometryType: string): string | undefined {
  return Object.keys(PRIMITIVES).find((key) => PRIMITIVES[key]?.name === geometryType);
}

// The recipe of a geometry that three.js built from parameters (without the ops after it).
function baseRecipe(geometry: THREE.BufferGeometry): Recipe | null {
  const parameters = (geometry as unknown as { parameters?: Record<string, unknown> }).parameters;
  if (!parameters) {
    return null;
  }
  const key = typeKey(geometry.type);
  if (key) {
    const entry = PRIMITIVES[key]!;
    const base = defaultsOf(key);
    const recipe: Recipe = { type: key };
    for (const name of entry.params) {
      const value = parameters[name];
      if (value !== undefined && value !== base[name]) {
        recipe[name] = value;
      }
    }
    return recipe;
  }
  if (geometry.type === "LatheGeometry") {
    const recipe: Recipe = { type: "lathe", points: (parameters.points as THREE.Vector2[]).map((p) => ([p.x, p.y])) };
    recipe.segments = parameters.segments;
    recipe.phiStart = parameters.phiStart;
    recipe.phiLength = parameters.phiLength;
    return recipe;
  }
  if (geometry.type === "ExtrudeGeometry" || geometry.type === "ShapeGeometry") {
    const raw = parameters.shapes as THREE.Shape | THREE.Shape[];
    const shapes = (Array.isArray(raw) ? raw : [raw]).map(pathToData);
    if (geometry.type === "ShapeGeometry") {
      return { type: "shape", shapes, curveSegments: parameters.curveSegments };
    }
    const options = { ...(parameters.options as Record<string, unknown>) };
    for (const [name, value] of Object.entries(options)) {
      if (typeof value === "function" || (typeof value === "object" && value !== null)) {
        throw new Error(`extrude option ${name} cannot be saved`);
      }
    }
    return { type: "extrude", shapes, options };
  }
  if (geometry.type === "TubeGeometry") {
    const path = parameters.path as THREE.CatmullRomCurve3;
    if (!(path as unknown as { isCatmullRomCurve3?: boolean }).isCatmullRomCurve3) {
      throw new Error("only CatmullRomCurve3 tubes can be saved");
    }
    return {
      type: "tube",
      path: { points: path.points.map((p) => ([p.x, p.y, p.z])), closed: path.closed, curveType: path.curveType, tension: path.tension },
      tubularSegments: parameters.tubularSegments,
      radius: parameters.radius,
      radialSegments: parameters.radialSegments,
      closed: parameters.closed,
    };
  }
  if (geometry.type === "EdgesGeometry") {
    const inner = recipeOf(parameters.geometry as THREE.BufferGeometry);
    if (!inner) {
      return null;
    }
    return { type: "edges", geometry: inner, thresholdAngle: parameters.thresholdAngle };
  }
  return null;
}

// The recipe of `geometry`: the stored one (geometry built from a recipe, or recorded), or the one of a plain primitive.
function recipeOf(geometry: THREE.BufferGeometry): Recipe | null {
  return recipes.get(geometry) ?? baseRecipe(geometry);
}

// --- Building ------------------------------------------------------------------------------------

function applyOp(geometry: THREE.BufferGeometry, op: Op): THREE.BufferGeometry {
  const [name, ...n] = op;
  switch (name) {
    case "rotateX":
      return geometry.rotateX(n[0]!);
    case "rotateY":
      return geometry.rotateY(n[0]!);
    case "rotateZ":
      return geometry.rotateZ(n[0]!);
    case "translate":
      return geometry.translate(n[0]!, n[1]!, n[2]!);
    case "scale":
      return geometry.scale(n[0]!, n[1]!, n[2]!);
    case "applyMatrix4":
      return geometry.applyMatrix4(new THREE.Matrix4().fromArray(n));
    case "applyQuaternion":
      return geometry.applyQuaternion(new THREE.Quaternion(n[0], n[1], n[2], n[3]));
    case "lookAt":
      return geometry.lookAt(new THREE.Vector3(n[0], n[1], n[2]));
    case "center":
      return geometry.center();
    case "computeVertexNormals":
      geometry.computeVertexNormals();
      return geometry;
    case "toNonIndexed":
      return geometry.toNonIndexed();
    default:
      throw new Error(`unknown geometry op ${name}`);
  }
}

// A velvet drape: a plane of `width` by `height` with vertical folds that get deeper towards the floor.
function drapeGeometry(width: number, height: number): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(width, height, 80, 20);
  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const gather = 0.6 + 0.4 * (1 - (y + height / 2) / height);
    position.setZ(i, Math.sin(x * 7.5) * 0.12 * gather + Math.sin(x * 2.3) * 0.08);
  }
  geometry.computeVertexNormals();
  return geometry;
}

// The wall slab of one bay of the colonnade, in the bay frame: x along the wall, the front face at z = 0, the back
// at -thickness, from y = 0 up to `height`. `arch`: [half width, sill, spring] of the opening (a rectangle up to the
// spring topped by a half circle). The slab is built flat, then each point is pushed along the radius from the studio
// centre (at z = `apothem`), so both ends lie on the radial planes through the joints and meet the next slab.
function wallSlabGeometry(length: number, height: number, thickness: number, apothem: number, arch: number[] | undefined, curveSegments: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-length / 2, 0);
  shape.lineTo(length / 2, 0);
  shape.lineTo(length / 2, height);
  shape.lineTo(-length / 2, height);
  shape.closePath();
  if (arch) {
    const [halfWidth, sill, spring] = arch as [number, number, number];
    const hole = new THREE.Path();
    hole.moveTo(-halfWidth, sill);
    hole.lineTo(halfWidth, sill);
    hole.lineTo(halfWidth, spring);
    hole.absarc(0, spring, halfWidth, 0, Math.PI, false);
    hole.lineTo(-halfWidth, sill);
    shape.holes.push(hole);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments });
  geometry.translate(0, 0, -thickness);
  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i++) {
    const scale = (apothem - position.getZ(i)) / apothem;
    position.setX(i, position.getX(i) * scale);
  }
  geometry.computeVertexNormals();
  return geometry;
}

// A palm frond: narrow at the root (y = 0), wide in the middle, pinched to a tip at `length`, bent down along its length.
function frondGeometry(width: number, length: number, segments: number): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(width, length, 1, segments);
  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i) + length / 2;
    const x = position.getX(i);
    const scale = (1 - (y / length) * 0.8) * Math.min(1, 0.3 + y / 0.4);
    position.setX(i, x * scale);
    position.setZ(i, -Math.pow(y / length, 2) * 0.9);
    position.setY(i, y);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function buildBase(recipe: Recipe): THREE.BufferGeometry {
  const entry = PRIMITIVES[recipe.type];
  if (entry) {
    const args = entry.params.map((name) => recipe[name]);
    return entry.create(...(args as never[]));
  }
  switch (recipe.type) {
    case "drape":
      return drapeGeometry(recipe.width as number, recipe.height as number);
    case "frond":
      return frondGeometry(recipe.width as number, recipe.length as number, recipe.segments as number);
    case "wallSlab":
      return wallSlabGeometry(recipe.length as number, recipe.height as number, recipe.thickness as number, recipe.apothem as number, recipe.arch as number[] | undefined, recipe.curveSegments as number);
    case "lathe":
      return new THREE.LatheGeometry(
        (recipe.points as number[][]).map((p) => new THREE.Vector2(p[0], p[1])),
        recipe.segments as number | undefined,
        recipe.phiStart as number | undefined,
        recipe.phiLength as number | undefined,
      );
    case "extrude":
      return new THREE.ExtrudeGeometry((recipe.shapes as ShapeData[]).map(shapeFromData), recipe.options as THREE.ExtrudeGeometryOptions);
    case "shape":
      return new THREE.ShapeGeometry((recipe.shapes as ShapeData[]).map(shapeFromData), recipe.curveSegments as number | undefined);
    case "tube": {
      const path = recipe.path as { points: number[][]; closed: boolean; curveType: THREE.CurveType; tension: number };
      const curve = new THREE.CatmullRomCurve3(path.points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), path.closed, path.curveType, path.tension);
      return new THREE.TubeGeometry(curve, recipe.tubularSegments as number, recipe.radius as number, recipe.radialSegments as number, recipe.closed as boolean);
    }
    case "edges":
      return new THREE.EdgesGeometry(buildFresh(recipe.geometry as Recipe), recipe.thresholdAngle as number | undefined);
    case "merge": {
      const merged = mergeGeometries((recipe.parts as Recipe[]).map(buildFresh), Boolean(recipe.groups));
      if (!merged) {
        throw new Error("cannot merge the parts of a recipe");
      }
      return merged;
    }
    default:
      throw new Error(`unknown geometry type ${recipe.type}`);
  }
}

// A new geometry from a recipe, never shared.
function buildFresh(recipe: Recipe): THREE.BufferGeometry {
  let geometry = buildBase(recipe);
  for (const op of recipe.ops ?? []) {
    geometry = applyOp(geometry, op);
  }
  recipes.set(geometry, recipe);
  return geometry;
}

const cache = new Map<string, THREE.BufferGeometry>();

// The geometry of a recipe. Equal recipes give the same shared geometry: never change it in place.
function buildGeometry(recipe: Recipe): THREE.BufferGeometry {
  const key = JSON.stringify(recipe);
  let geometry = cache.get(key);
  if (!geometry) {
    geometry = buildFresh(recipe);
    cache.set(key, geometry);
  }
  return geometry;
}

export { NUMERIC_TYPES, baseRecipe, buildFresh, buildGeometry, getRecipe, recipeOf, setRecipe };
export type { Op, Recipe, ShapeData };
