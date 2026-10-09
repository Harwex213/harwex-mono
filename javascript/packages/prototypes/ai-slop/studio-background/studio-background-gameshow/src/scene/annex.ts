import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createCasinoPanorama } from "./casinoPanorama";
import { named, polar } from "./geometry";
import type { Materials } from "./materials";
import { FLOOR, LAYOUT, boundaryAngle, jointRadius } from "./studio";

// The annex: the Game Show platform at the front right of the amphitheatre (the camera side, +z), as on the plan sketch.
// It has no walls and no ceiling. It is a marble gallery that overlooks a luxury casino hall:
// - the floor of the platform is a part of the amphitheatre floor (`Studio/Floor/Marble`, see `annexFloorPlan`),
//   so the black marble runs on from the amphitheatre;
// - a gold balustrade runs along the free edges of the platform. Behind it the floor drops away to the casino;
// - the casino is a photo panorama (casinoPanorama.ts), far away round the platform, like the city behind the arches.
//
// Plan, in metres from the studio centre (the hero wheel stands at z = -4):
//   platform: x from -2.4 to 27, z from 9.27 (the outer face of the colonnade end) to 34, minus the round floor;
//   the balustrade stands on the platform along x = 27 (the casino side), z = 34 (the front) and x = -2.4 (left of the
//   round floor), and along z = 9.27 from the end of the colonnade to x = 27.

// The right end of the colonnade: the corner of the end face of the last wall slab on its back face.
const COLONNADE_END_BACK = polar(boundaryAngle(LAYOUT.segments), jointRadius(-LAYOUT.wallThickness));

const PLATFORM = {
  left: -2.4,
  right: 27,
  back: COLONNADE_END_BACK.z,
  front: 34,
};

// The balustrade: a dark plinth, gold balusters and a gold handrail, set in from the platform edge.
const BALUSTRADE = {
  inset: 0.05,
  plinth: { width: 0.36, height: 0.22 },
  baluster: { radius: 0.035, spacing: 0.22 },
  rail: { width: 0.16, height: 0.08, top: 1.05 },
  // Gold posts at the corners and every few metres.
  post: { width: 0.26, spacing: 4 },
};

// The fascia: the platform edge drops this far below the floor, so the platform has a visible thickness.
const FASCIA_DEPTH = 0.6;

// The space of the annex for the light zones (lightZones.ts): the platform, where the games stand.
// It starts 0.6 m in front of the wheel shot camera (z ~10), which looks away from it.
const ANNEX_VIEW = new THREE.Box3(new THREE.Vector3(PLATFORM.left, 0, 10.6), new THREE.Vector3(PLATFORM.right, LAYOUT.ceilingY, PLATFORM.front));

// Box geometry between two corners.
function cuboid(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  geometry.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return geometry;
}

function solid(name: string, geometries: THREE.BufferGeometry[], material: THREE.Material): THREE.Mesh {
  const geometry = mergeGeometries(geometries.map((item) => item.toNonIndexed()));
  if (!geometry) {
    throw new Error(`cannot merge ${name}`);
  }
  const mesh = named(new THREE.Mesh(geometry, material), name);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// The z where the round floor meets the line x = PLATFORM.left.
function leftEdgeStart(): number {
  return Math.sqrt(FLOOR.radius * FLOOR.radius - PLATFORM.left * PLATFORM.left);
}

// The floor of the platform as a plan polygon of (x, z) points: the rectangle minus the round amphitheatre floor.
// The cut follows the exact polygon of the round floor, so the two parts meet edge to edge.
// The studio floor (studio.ts) adds this polygon to its marble and its mirror.
function annexFloorPlan(): THREE.Vector2[] {
  const { left, right, back, front } = PLATFORM;
  const inside = (point: THREE.Vector2) => point.x > left && point.y > back;
  // Vertices of the round floor CircleGeometry in world space: (r cos t, -r sin t).
  const circle: THREE.Vector2[] = [];
  for (let i = 0; i <= FLOOR.segments; i++) {
    const t = (i / FLOOR.segments) * Math.PI * 2;
    circle.push(new THREE.Vector2(FLOOR.radius * Math.cos(t), -FLOOR.radius * Math.sin(t)));
  }
  // The part of the circle inside the rectangle, in the order of the circle, with the two cut points on its edges.
  const arc: THREE.Vector2[] = [];
  for (let i = 1; i <= FLOOR.segments; i++) {
    const a = circle[i - 1] as THREE.Vector2;
    const b = circle[i] as THREE.Vector2;
    if (inside(a) !== inside(b)) {
      // The edge crosses the left line or the back line: take the crossing that lies on the boundary.
      const crossings: number[] = [];
      if ((a.x > left) !== (b.x > left)) {
        crossings.push((left - a.x) / (b.x - a.x));
      }
      if ((a.y > back) !== (b.y > back)) {
        crossings.push((back - a.y) / (b.y - a.y));
      }
      const k = inside(a) ? Math.min(...crossings) : Math.max(...crossings);
      arc.push(new THREE.Vector2().lerpVectors(a, b, k));
    }
    if (inside(b)) {
      arc.push(b.clone());
    }
  }
  return [new THREE.Vector2(left, front), ...arc, new THREE.Vector2(right, back), new THREE.Vector2(right, front)];
}

// One straight run of balustrade from `a` to `b` (plan points, x and z), on the platform floor.
// Runs meet in the corners: each run stops at the plinth face of the run it meets.
function balustradeRun(a: THREE.Vector2, b: THREE.Vector2, parts: { plinth: THREE.BufferGeometry[]; gold: THREE.BufferGeometry[]; balusters: THREE.Matrix4[] }): void {
  const { plinth, baluster, rail, post } = BALUSTRADE;
  const along = new THREE.Vector2().subVectors(b, a);
  const length = along.length();
  const angle = Math.atan2(along.x, along.y);
  // A box in the run frame: s along the run from a, the box centred on the run line.
  const box = (s0: number, s1: number, y0: number, y1: number, width: number) => {
    const geometry = new THREE.BoxGeometry(width, y1 - y0, s1 - s0);
    geometry.translate(0, (y0 + y1) / 2, (s0 + s1) / 2);
    geometry.rotateY(angle);
    geometry.translate(a.x, 0, a.y);
    return geometry;
  };
  parts.plinth.push(box(0, length, 0, plinth.height, plinth.width));
  parts.gold.push(box(0, length, rail.top - rail.height, rail.top, rail.width));
  // Posts at both ends and at even steps between them.
  const posts = Math.max(1, Math.round(length / post.spacing));
  const postSpots: number[] = [];
  for (let i = 0; i <= posts; i++) {
    const s = THREE.MathUtils.clamp((length * i) / posts, post.width / 2, length - post.width / 2);
    postSpots.push(s);
    parts.gold.push(box(s - post.width / 2, s + post.width / 2, plinth.height, rail.top - rail.height, post.width));
  }
  // Balusters between the posts: each stands on the plinth and carries the rail.
  const height = rail.top - rail.height - plinth.height;
  const matrix = new THREE.Matrix4();
  const direction = new THREE.Vector3(along.x / length, 0, along.y / length);
  for (let i = 0; i < postSpots.length - 1; i++) {
    const from = (postSpots[i] as number) + post.width / 2;
    const to = (postSpots[i + 1] as number) - post.width / 2;
    const count = Math.max(1, Math.floor((to - from) / baluster.spacing));
    for (let j = 0; j < count; j++) {
      const s = from + ((to - from) * (j + 0.5)) / count;
      matrix.makeScale(1, height, 1).setPosition(a.x + direction.x * s, plinth.height + height / 2, a.y + direction.z * s);
      parts.balusters.push(matrix.clone());
    }
  }
}

// The balustrade along the free edges of the platform, and the fascia under the edges.
function createEdge(materials: Materials): THREE.Group {
  const group = named(new THREE.Group(), "Edge", true);
  const { left, right, back, front } = PLATFORM;
  const half = BALUSTRADE.plinth.width / 2 + BALUSTRADE.inset;
  // The colonnade end on the back line, and the start of the left edge at the round floor.
  const colonnadeEnd = COLONNADE_END_BACK.x;
  const leftStart = leftEdgeStart();
  const balusterGeometry = new THREE.CylinderGeometry(BALUSTRADE.baluster.radius, BALUSTRADE.baluster.radius * 1.3, 1, 10);
  // Back: from the colonnade end to the casino side. Casino side: the whole depth. Front: up to the casino side run.
  // Left: from the round floor to the front run.
  const runs: [string, THREE.Vector2, THREE.Vector2][] = [
    ["Balustrade Back", new THREE.Vector2(colonnadeEnd, back + half), new THREE.Vector2(right - 2 * half, back + half)],
    ["Balustrade Casino Side", new THREE.Vector2(right - half, back), new THREE.Vector2(right - half, front)],
    ["Balustrade Front", new THREE.Vector2(right - 2 * half, front - half), new THREE.Vector2(left + 2 * half, front - half)],
    ["Balustrade Left", new THREE.Vector2(left + half, front), new THREE.Vector2(left + half, leftStart)],
  ];
  for (const [name, a, b] of runs) {
    const parts = { plinth: [] as THREE.BufferGeometry[], gold: [] as THREE.BufferGeometry[], balusters: [] as THREE.Matrix4[] };
    balustradeRun(a, b, parts);
    const run = named(new THREE.Group(), name);
    run.add(solid("Plinth", parts.plinth, materials.navy));
    run.add(solid("Rail", parts.gold, materials.gold));
    const balusters = new THREE.InstancedMesh(balusterGeometry, materials.goldDark, parts.balusters.length);
    parts.balusters.forEach((matrix, index) => {
      balusters.setMatrixAt(index, matrix);
    });
    balusters.castShadow = true;
    run.add(named(balusters, "Balusters"));
    group.add(run);
  }

  // The fascia: a dark band with a gold nosing under the free edges, from the floor down.
  const fascia = [
    cuboid(right, right + 0.2, -FASCIA_DEPTH, 0, back, front + 0.2),
    cuboid(left - 0.2, right, -FASCIA_DEPTH, 0, front, front + 0.2),
    cuboid(left - 0.2, left, -FASCIA_DEPTH, 0, leftStart, front),
    // The back fascia starts where the round floor no longer reaches past the back line.
    cuboid(Math.sqrt(FLOOR.radius * FLOOR.radius - (back - 0.2) * (back - 0.2)) + 0.01, right, -FASCIA_DEPTH, 0, back - 0.2, back),
  ];
  group.add(solid("Fascia", fascia, materials.wall));
  return group;
}

// Two real lights, both on Bonus Show: a key from the side of its shot and a warm back light from the casino side,
// which separates the wheel from the bright hall behind it. They follow the wheel (see `follow`), so the code
// writes their transforms every frame. The casino panorama has no real lights.
// Where each light stands and aims, in the frame of Bonus Show: origin at its pivot, +z its front, +x its own x axis.
const KEY = { from: new THREE.Vector3(-3.5, 11, 7), to: new THREE.Vector3(0, 2.8, 0) };
const BACK = { from: new THREE.Vector3(2.5, 9, -6), to: new THREE.Vector3(0, 3.2, 0) };

function createLights(): { group: THREE.Group; key: THREE.SpotLight; back: THREE.SpotLight } {
  const group = named(new THREE.Group(), "Lights", true);
  const add = (name: string, light: THREE.SpotLight) => {
    named(light, name);
    named(light.target, `${name} Target`);
    light.userData.animated = true;
    light.target.userData.animated = true;
    group.add(light, light.target);
    return light;
  };
  const deg = THREE.MathUtils.degToRad;
  const key = add("Bonus Show Key", new THREE.SpotLight(0xffd9a8, 150, 0, deg(20), 0.6, 2));
  const back = add("Bonus Show Back", new THREE.SpotLight(0xffb070, 220, 0, deg(24), 0.7, 2));
  return { group, key, back };
}

// The annex. `bonusShow` is the game object the lights follow; `update` drives the casino animation,
// `follow` moves the lights onto Bonus Show (call it every frame, also while paused, so an editor move is lit at once).
function createAnnex(materials: Materials, bonusShow: THREE.Object3D) {
  const group = named(new THREE.Group(), "Annex", true);
  // Light zones (lightZones.ts): every light under this group belongs to the annex.
  group.userData.lightZone = "annex";
  const lights = createLights();
  const casino = createCasinoPanorama();
  group.add(createEdge(materials), lights.group, casino.group);

  const spot = new THREE.Vector3();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const front = new THREE.Vector3();
  const toLights = new THREE.Matrix4();
  const place = (local: THREE.Vector3, yaw: number, target: THREE.Object3D) => {
    spot.copy(local).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw).add(position);
    if (!target.position.equals(spot)) {
      target.position.copy(spot);
      target.updateMatrixWorld();
    }
  };
  const follow = () => {
    bonusShow.updateWorldMatrix(true, false);
    lights.group.updateWorldMatrix(true, false);
    // Bonus Show in the frame of the lights group. Only its position and its turn about y count:
    // its scale must not move the lights.
    toLights.copy(lights.group.matrixWorld).invert().multiply(bonusShow.matrixWorld);
    toLights.decompose(position, quaternion, scale);
    front.set(0, 0, 1).applyQuaternion(quaternion);
    const yaw = Math.atan2(front.x, front.z);
    place(KEY.from, yaw, lights.key);
    place(KEY.to, yaw, lights.key.target);
    place(BACK.from, yaw, lights.back);
    place(BACK.to, yaw, lights.back.target);
  };

  const update = (time: number) => {
    casino.update(time);
  };
  return { group, update, follow };
}

export { ANNEX_VIEW, annexFloorPlan, createAnnex };
