import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createAnnexDressing } from "./annexDressing";
import { named, polar } from "./geometry";
import { FLOOR, LAYOUT, boundaryAngle, jointRadius } from "./studio";

// The annex: the Game Show platform at the front right of the amphitheatre (the camera side, +z), as on the plan sketch.
// It has no walls and no ceiling. It is a marble gallery that overlooks a luxury casino hall:
// - the floor of the platform is a part of the amphitheatre floor (`Studio/Floor/Marble`, see `annexFloorPlan`),
//   so the black marble runs on from the amphitheatre;
// - a gold balustrade runs along the free edges of the platform. Behind it the floor drops away to the casino;
// - the casino hall (casino.ts) is real geometry round the platform; its floor lies 3.4 m below the balcony floor.
//
// Plan, in metres from the studio centre (the hero wheel stands at z = -4):
//   platform: x from -2.4 to 23.7, z from 9.27 (the outer face of the colonnade end) to 26, minus the round floor
//   (radius 22). It sticks out 1.7 m past the round floor along x and 4 m along z;
//   the balustrade stands on the platform along x = 23.7 (the casino side), z = 26 (the front) and x = -2.4 (left of the
//   round floor), and along z = 9.27 from the end of the colonnade to x = 23.7.
//   The casino side and the front meet in the tip of the balcony at (23.7, 26). Bonus Show stands on the bisector
//   of that corner and faces back along it.
// The balcony has its own materials in the palette of the casino photo: warm black marble with gold veins,
// a black lacquer plinth and fascia, gilded rails. They reflect a warm environment (`createCasinoEnvironment`)
// instead of the studio one with its blue panels.

// The right end of the colonnade: the corner of the end face of the last wall slab on its back face.
const COLONNADE_END_BACK = polar(boundaryAngle(LAYOUT.segments), jointRadius(-LAYOUT.wallThickness));

const PLATFORM = {
  left: -2.4,
  right: 23.7,
  back: COLONNADE_END_BACK.z,
  front: 26,
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

// The balcony materials, in the palette of the casino photo: warm black, deep bronze, amber gold.
// Each has its own name, so the editor saves it apart from the studio materials.
// `userData.ownEnvironment`: the engine gives the material the casino environment as its own map,
// and the editor lighting swaps that map for its even sky (editorLighting.ts).
function createAnnexMaterials() {
  const materials = {
    annexGold: new THREE.MeshStandardMaterial({ color: 0xe0b060, metalness: 1, roughness: 0.28 }),
    annexBronze: new THREE.MeshStandardMaterial({ color: 0xa87a3a, metalness: 1, roughness: 0.36 }),
    annexLacquer: new THREE.MeshStandardMaterial({ color: 0x1e130b, metalness: 0.3, roughness: 0.3 }),
    annexFascia: new THREE.MeshStandardMaterial({ color: 0x160e08, metalness: 0.2, roughness: 0.5 }),
  };
  for (const [name, material] of Object.entries(materials)) {
    material.name = name;
    material.userData.ownEnvironment = true;
  }
  return materials;
}

type AnnexMaterials = ReturnType<typeof createAnnexMaterials>;

// One texture tile of the floor marble spans this many metres.
const VEIN_TILE = 7;

// A small seeded random generator, so the veins are the same on every load.
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Warm black marble with gold veins, as one tile that repeats without seams.
// The clouds are sums of sines with whole periods per tile; each vein is drawn nine times, shifted by one tile,
// so a vein that leaves the tile on one side comes back on the other side.
function createVeinTexture(): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("cannot draw the marble");
  }
  const image = context.createImageData(size, size);
  const dark = [12, 7, 4];
  const light = [40, 25, 14];
  for (let y = 0; y < size; y++) {
    const v = (y / size) * Math.PI * 2;
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2;
      const cloud = 0.5 + 0.25 * Math.sin(2 * u + 1.3 * Math.sin(3 * v)) + 0.15 * Math.sin(5 * v + 2 * Math.sin(2 * u)) + 0.1 * Math.sin(7 * (u + v));
      const k = THREE.MathUtils.clamp(cloud, 0, 1) ** 1.6;
      const index = (y * size + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        image.data[index + channel] = (dark[channel] as number) + ((light[channel] as number) - (dark[channel] as number)) * k;
      }
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);

  const random = seededRandom(7);
  const veins: { points: THREE.Vector2[]; width: number; alpha: number }[] = [];
  const walk = (start: THREE.Vector2, heading: number, steps: number, width: number, alpha: number, depth: number) => {
    const points = [start.clone()];
    let angle = heading;
    const point = start.clone();
    for (let i = 0; i < steps; i++) {
      angle += (random() - 0.5) * 0.35;
      // The veins keep a main direction across the slab, like a cut block of marble.
      angle += (heading - angle) * 0.15;
      point.x += Math.cos(angle) * 14;
      point.y += Math.sin(angle) * 14;
      points.push(point.clone());
      if (depth < 2 && random() < 0.04) {
        walk(point, angle + (random() < 0.5 ? -1 : 1) * (0.5 + random() * 0.6), Math.floor(steps * 0.4), width * 0.55, alpha * 0.8, depth + 1);
      }
    }
    veins.push({ points, width, alpha });
  };
  for (let i = 0; i < 9; i++) {
    walk(new THREE.Vector2(random() * size, random() * size), 0.6 + (random() - 0.5) * 0.5, 40 + Math.floor(random() * 40), 1 + random() * 1.6, 0.4 + random() * 0.4, 0);
  }
  context.lineCap = "round";
  context.lineJoin = "round";
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (const vein of veins) {
        context.beginPath();
        vein.points.forEach((point, index) => {
          if (index === 0) {
            context.moveTo(point.x + dx * size, point.y + dy * size);
          } else {
            context.lineTo(point.x + dx * size, point.y + dy * size);
          }
        });
        // A soft halo first, then the thin gold line.
        context.strokeStyle = `rgba(150, 100, 50, ${vein.alpha * 0.1})`;
        context.lineWidth = vein.width * 7;
        context.stroke();
        context.strokeStyle = `rgba(200, 150, 80, ${vein.alpha * 0.6})`;
        context.lineWidth = vein.width;
        context.stroke();
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

// Turns the annex part of the studio floor (`marbleFloorAnnex`, studio.ts) into the balcony marble:
// warm black with gold veins. The floor plan UVs are in metres (ShapeGeometry), so the tile repeats every VEIN_TILE metres.
// The engine gives it the casino environment as its own map.
function styleAnnexFloor(material: THREE.MeshStandardMaterial): void {
  const veins = createVeinTexture();
  veins.repeat.set(1 / VEIN_TILE, 1 / VEIN_TILE);
  material.color.set(0xffffff);
  material.map = veins;
  material.envMapIntensity = 0.35;
  material.needsUpdate = true;
}

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
function createEdge(materials: AnnexMaterials): THREE.Group {
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
    run.add(solid("Plinth", parts.plinth, materials.annexLacquer));
    run.add(solid("Rail", parts.gold, materials.annexGold));
    const balusters = new THREE.InstancedMesh(balusterGeometry, materials.annexBronze, parts.balusters.length);
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
  group.add(solid("Fascia", fascia, materials.annexFascia));
  return group;
}

// Two real lights, both on Bonus Show: a key from the side of its shot and a warm back light from the casino side,
// which separates the wheel from the bright hall behind it. They follow the wheel (see `follow`), so the code
// writes their transforms every frame. The casino hall has no real lights.
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

// The annex. `bonusShow` is the game object the lights follow; `update` is kept for the engine (nothing to animate),
// `follow` moves the lights onto Bonus Show (call it every frame, also while paused, so an editor move is lit at once).
// `materials` lists the balcony materials that take the casino environment.
function createAnnex(bonusShow: THREE.Object3D) {
  const group = named(new THREE.Group(), "Annex", true);
  // Light zones (lightZones.ts): every light under this group belongs to the annex.
  group.userData.lightZone = "annex";
  const lights = createLights();
  const materials = createAnnexMaterials();
  // The game show props on the platform (annexDressing.ts), under the "Show Dressing" folder.
  const dressing = createAnnexDressing(materials);
  group.add(createEdge(materials), dressing.group, lights.group);

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

  // The casino hall (casino.ts) is mounted and animated by the engine: the annex has nothing to animate.
  const update = (_time: number) => {};
  return { group, update, follow, materials: [...Object.values(materials), ...dressing.materials] };
}

export { ANNEX_VIEW, annexFloorPlan, createAnnex, styleAnnexFloor };
