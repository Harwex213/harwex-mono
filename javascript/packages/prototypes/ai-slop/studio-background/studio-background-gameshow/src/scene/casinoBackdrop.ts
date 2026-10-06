import * as THREE from "three";
import photoUrl from "../assets/casino-hall.jpg";
import plateUrl from "../assets/casino-hall-plate.jpg";
import cutAUrl from "../assets/casino-hall-cut-a.png";
import cutBUrl from "../assets/casino-hall-cut-b.png";
import fxUrl from "../assets/casino-hall-fx.png";
import { named } from "./geometry";
import backdropFragment from "./shaders/casinoBackdrop.frag";
import backdropVertex from "./shaders/casinoBackdrop.vert";
import commonChunk from "./shaders/common.glsl";

// Luxury casino hall behind the "Game Show" bonus station, made from one photo
// (src/assets/casino-hall-photo.png, 650 x 365) by 2.5D camera projection.
//
// Projection setup. The photo is treated as the view of a virtual projector camera:
// - a plain symmetric pinhole with the focal length FOCAL = 500 photo pixels, so the horizontal
//   field of view is 2 * atan(325 / 500) = 66.0 deg and the vertical one is 40.1 deg;
// - looking straight along -Z with no tilt (the photo's columns are vertical), and the horizon
//   through the photo centre, row 182.5;
// - in "photo metres" its eye is EYE = 1.5 m above the casino floor. The room is rebuilt around
//   it from the photo: floor, a 6.5 m ceiling, the panelled left wall at an angle (3 m to the left
//   at 6.5 m depth, 1.9 m at 14 m), the curtain wall 17 m away and a doorway (a deeper room, 20 m)
//   behind the central column. Each card depth comes from where its subject meets the floor
//   (row v at depth EYE * FOCAL / (v - 182.5)) or, for a chandelier, from its size.
// The backdrop scales photo metres by SCALE = 2: the curtain wall is ~25 m wide and 26 m behind
// the near edge, the doorway room 32 m.
// Every surface point is placed on the ray of its photo pixel: from the projector the backdrop
// shows the photo exactly, and from anywhere else the layers parallax like the room would.
//
// Frame (the pivot rule): the local origin is the bottom centre of the near edge, on the casino
// floor. The hall extends towards -Z; the viewer looks from +Z. The near edge is the plane where
// the photo's bottom row meets the floor (photo depth NEAR_DEPTH = 4.1 m). Nearer things (the
// big chairs in the photo's foreground) are pressed onto that plane. The projector sits at
// PROJECTOR_POSITION = (0, 3, 8.2) in this frame. That is the sweet spot for the camera: from
// there the photo fills a 10.7 m x 6 m window on the near edge (x from -5.35 to 5.35, y from 0
// to 6). A camera that dollies or orbits a few metres around it sees the parallax. Outside the
// photo there is no picture: the shell fades to dark and a card fades out. Put the backdrop
// behind an opening of about that window, so the studio wall hides the frustum edges when the
// camera is off the sweet spot or farther back.
//
// Layers (scripts/build-casino-backdrop.py cuts them):
// - Room shell: three grid meshes along the photo rays at the depth of the room surface each
//   pixel shows. It draws the "plate", the photo with every card subject removed and filled in
//   (floor from a shifted floor patch in perspective, walls and ceiling from their own rows), so a
//   card that slides sideways uncovers a plausible room instead of a smear or a copy of itself.
// - Cards: flat cut-outs facing +Z at their own depth: the foreground furniture, the mid chairs,
//   the right table group, two columns and three chandeliers (these sway).
//
// Unlit: ShaderMaterial, no lights, no shadows, no fog. Colour stays linear; the composer's
// OutputPass applies the tone mapping. `uExposure` keeps the hall dimmer than the set and below
// the bloom threshold; only the crystal glints reach it.

const PHOTO_WIDTH = 650;
const PHOTO_HEIGHT = 365;
const FOCAL = 500;
const CENTER_U = PHOTO_WIDTH / 2;
const CENTER_V = PHOTO_HEIGHT / 2;
// Photo metres.
const EYE = 1.5;
const CEILING = 6.5;
// The panelled left wall runs at an angle: x = LEFT_WALL_X + LEFT_WALL_SLOPE * depth.
const LEFT_WALL_X = -3.952;
const LEFT_WALL_SLOPE = 0.148;
const BACK_WALL = 17;
const DOORWAY = 20;
// Where the bottom photo row meets the floor.
const NEAR_DEPTH = (EYE * FOCAL) / (PHOTO_HEIGHT - CENTER_V);
const SCALE = 2;
const PROJECTOR_POSITION = new THREE.Vector3(0, EYE * SCALE, NEAR_DEPTH * SCALE);
const PROJECTOR_FOV = THREE.MathUtils.radToDeg(2 * Math.atan(CENTER_V / FOCAL));
// Size of the 2x textures.
const MAP_SIZE = new THREE.Vector2(PHOTO_WIDTH * 2, PHOTO_HEIGHT * 2);
// Shell grid cell, photo pixels.
const GRID_STEP = 4;

interface CasinoBackdropOptions {
  // Brightness of the photo, linear. 1 shows the photo as it is.
  exposure?: number;
  // Blur radius in texels of the 2x photo.
  defocus?: number;
  // Strength of the distance haze and the light shafts.
  haze?: number;
  // Strength of all the animation (glints, flicker, slots, curtains, breathing).
  life?: number;
}

interface CasinoBackdrop {
  group: THREE.Group;
  // Deterministic in time: the same time gives the same frame.
  update: (time: number) => void;
  // Projector (sweet spot) in the backdrop frame, and its vertical field of view in degrees.
  projector: { position: THREE.Vector3; fov: number; aspect: number };
}

interface Card {
  name: string;
  // Photo pixels: left, top, right, bottom.
  box: [number, number, number, number];
  // Photo metres from the projector.
  depth: number;
  channelA: [number, number, number];
  channelB: [number, number, number];
  // Swaying chandelier: hangs from the ceiling above `hangU`.
  hangU?: number;
  phase?: number;
}

// Back to front, so the blending order is right.
const CARDS: Card[] = [
  { name: "Column Right", box: [390, 78, 438, 232], depth: 16.5, channelA: [0, 0, 0], channelB: [1, 0, 0] },
  { name: "Column Centre", box: [264, 0, 338, 248], depth: 12.3, channelA: [0, 0, 0], channelB: [1, 0, 0] },
  { name: "Chandelier Small", box: [502, 72, 592, 134], depth: 11, channelA: [0, 0, 1], channelB: [0, 0, 0], hangU: 546, phase: 2.1 },
  { name: "Chandelier Big", box: [452, 0, 578, 92], depth: 8, channelA: [0, 0, 0], channelB: [1, 0, 0], hangU: 515, phase: 0.7 },
  { name: "Chandelier Left", box: [112, 0, 222, 110], depth: 6, channelA: [0, 0, 0], channelB: [1, 0, 0], hangU: 171, phase: 4.0 },
  { name: "Table Group", box: [460, 205, 608, 266], depth: 7.4, channelA: [0, 0, 1], channelB: [0, 0, 0] },
  { name: "Mid Chairs", box: [360, 212, 505, 326], depth: 5.3, channelA: [0, 1, 0], channelB: [0, 0, 0] },
  { name: "Near Furniture", box: [0, 205, 650, 365], depth: NEAR_DEPTH, channelA: [1, 0, 0], channelB: [0, 0, 0] },
];

// Point of the backdrop frame on the ray of photo pixel (u, v), `depth` photo metres away.
function onRay(u: number, v: number, depth: number, target = new THREE.Vector3()): THREE.Vector3 {
  const s = depth * SCALE;
  return target.set(
    PROJECTOR_POSITION.x + (s * (u - CENTER_U)) / FOCAL,
    PROJECTOR_POSITION.y - (s * (v - CENTER_V)) / FOCAL,
    PROJECTOR_POSITION.z - s,
  );
}

// Depth (photo metres) of the room surface that photo pixel (u, v) shows: the nearest plane the
// ray leaves the room through. Never nearer than the near edge.
function roomDepth(u: number, v: number, back: number): number {
  const rx = (u - CENTER_U) / FOCAL;
  const ry = -(v - CENTER_V) / FOCAL;
  let depth = back;
  if (ry < 0) {
    depth = Math.min(depth, EYE / -ry);
  }
  if (ry > 0) {
    depth = Math.min(depth, (CEILING - EYE) / ry);
  }
  if (rx < LEFT_WALL_SLOPE) {
    depth = Math.min(depth, -LEFT_WALL_X / (LEFT_WALL_SLOPE - rx));
  }
  return Math.max(depth, NEAR_DEPTH + 0.02);
}

// Grid along the photo rays between two photo columns; rows run from above the photo to its bottom.
function shellGeometry(uFrom: number, uTo: number, back: number): THREE.BufferGeometry {
  const vFrom = -60;
  const vTo = PHOTO_HEIGHT;
  const columns = Math.ceil((uTo - uFrom) / GRID_STEP);
  const rows = Math.ceil((vTo - vFrom) / GRID_STEP);
  const positions = new Float32Array((columns + 1) * (rows + 1) * 3);
  const point = new THREE.Vector3();
  let offset = 0;
  for (let j = 0; j <= rows; j++) {
    const v = vFrom + ((vTo - vFrom) * j) / rows;
    for (let i = 0; i <= columns; i++) {
      const u = uFrom + ((uTo - uFrom) * i) / columns;
      onRay(u, v, roomDepth(u, v, back), point);
      positions[offset++] = point.x;
      positions[offset++] = point.y;
      positions[offset++] = point.z;
    }
  }
  const indices: number[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const a = j * (columns + 1) + i;
      const b = a + 1;
      const c = a + columns + 1;
      const d = c + 1;
      // Counter-clockwise seen from +Z.
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function cardGeometry(card: Card): THREE.BufferGeometry {
  const [left, top, right, bottom] = card.box;
  const corners = [
    onRay(left, bottom, card.depth),
    onRay(right, bottom, card.depth),
    onRay(left, top, card.depth),
    onRay(right, top, card.depth),
  ];
  const geometry = new THREE.BufferGeometry().setFromPoints(corners);
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  geometry.computeBoundingSphere();
  return geometry;
}

function loadColor(url: string): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// Masks hold coverage, not colour: no sRGB decode.
function loadMask(url: string): THREE.Texture {
  return new THREE.TextureLoader().load(url);
}

function createCasinoBackdrop(options: CasinoBackdropOptions = {}): CasinoBackdrop {
  const photo = loadColor(photoUrl);
  const plate = loadColor(plateUrl);
  const cutA = loadMask(cutAUrl);
  const cutB = loadMask(cutBUrl);
  const fx = loadMask(fxUrl);

  const projectorCamera = new THREE.PerspectiveCamera(PROJECTOR_FOV, PHOTO_WIDTH / PHOTO_HEIGHT, 0.5, 500);
  projectorCamera.position.copy(PROJECTOR_POSITION);
  projectorCamera.lookAt(PROJECTOR_POSITION.x, PROJECTOR_POSITION.y, PROJECTOR_POSITION.z - 1);
  projectorCamera.updateMatrixWorld(true);
  // Backdrop frame -> projector clip space. Fixed: the projector never moves inside the backdrop.
  const localToProjector = new THREE.Matrix4().multiplyMatrices(
    projectorCamera.projectionMatrix,
    projectorCamera.matrixWorldInverse,
  );

  const group = named(new THREE.Group(), "Casino Backdrop", true);
  group.userData.auditIgnore = true;

  // Uniform objects shared by every layer.
  const shared = {
    uWorldToProjector: { value: new THREE.Matrix4() },
    uCutA: { value: cutA },
    uCutB: { value: cutB },
    uFx: { value: fx },
    uMapSize: { value: MAP_SIZE },
    uTime: { value: 0 },
    uExposure: { value: options.exposure ?? 0.78 },
    uDefocus: { value: options.defocus ?? 1.3 },
    uHaze: { value: options.haze ?? 1 },
    uLife: { value: options.life ?? 1 },
    uHazeColor: { value: new THREE.Color(0.2, 0.12, 0.065) },
    uVoidColor: { value: new THREE.Color(0.008, 0.005, 0.004) },
    uHazeRange: { value: new THREE.Vector2(20, 70) },
  };
  const groupInverse = new THREE.Matrix4();
  // Follows the group wherever the integration puts it.
  const syncProjector = () => {
    groupInverse.copy(group.matrixWorld).invert();
    shared.uWorldToProjector.value.multiplyMatrices(localToProjector, groupInverse);
  };

  const makeMaterial = (map: THREE.Texture, defines: Record<string, string>, extra: Record<string, THREE.IUniform>) =>
    new THREE.ShaderMaterial({
      name: "Casino Backdrop",
      vertexShader: backdropVertex,
      fragmentShader: backdropFragment.replace("// @common", commonChunk),
      defines,
      uniforms: { ...shared, uPhoto: { value: map }, ...extra },
      transparent: !("SHELL" in defines),
      depthWrite: "SHELL" in defines,
    });

  const addMesh = (mesh: THREE.Mesh, name: string) => {
    named(mesh, name);
    mesh.userData.auditIgnore = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.onBeforeRender = syncProjector;
    group.add(mesh);
  };

  // Room shell: the doorway segment goes behind the central and the right column; the two wall
  // segments overlap it under those columns, so no stretched triangle bridges the depth step.
  const shellMaterial = makeMaterial(plate, { SHELL: "" }, {
    uChannelA: { value: new THREE.Vector3() },
    uChannelB: { value: new THREE.Vector3() },
  });
  const shell = named(new THREE.Group(), "Room Shell", true);
  shell.userData.auditIgnore = true;
  group.add(shell);
  const segments: [string, number, number, number][] = [
    ["Shell Left", -110, 312, BACK_WALL],
    ["Shell Doorway", 296, 420, DOORWAY],
    ["Shell Right", 406, PHOTO_WIDTH + 110, BACK_WALL],
  ];
  for (const [name, from, to, back] of segments) {
    const mesh = new THREE.Mesh(shellGeometry(from, to, back), shellMaterial);
    addMesh(mesh, name);
    shell.add(mesh);
  }

  const sways: { card: Card; uniforms: { uSway: THREE.IUniform } }[] = [];
  CARDS.forEach((card, index) => {
    const swayUniforms = { uSwayPivot: { value: new THREE.Vector3() }, uSway: { value: new THREE.Vector2() } };
    const defines: Record<string, string> = card.hangU === undefined ? {} : { SWAY: "" };
    const material = makeMaterial(photo, defines, {
      uChannelA: { value: new THREE.Vector3(...card.channelA) },
      uChannelB: { value: new THREE.Vector3(...card.channelB) },
      ...swayUniforms,
    });
    const mesh = new THREE.Mesh(cardGeometry(card), material);
    // Farthest card first; all before the studio's own transparent objects.
    mesh.renderOrder = -20 + index;
    addMesh(mesh, card.name);
    if (card.hangU !== undefined) {
      // The ceiling point straight above the chandelier, at its depth.
      const hang = onRay(card.hangU, CENTER_V, card.depth);
      hang.y = CEILING * SCALE;
      sways.push({ card, uniforms: swayUniforms });
      mesh.onBeforeRender = () => {
        syncProjector();
        (swayUniforms.uSwayPivot.value as THREE.Vector3).copy(hang).applyMatrix4(group.matrixWorld);
      };
    }
  });

  const update = (time: number) => {
    shared.uTime.value = time;
    for (const { card, uniforms } of sways) {
      const phase = card.phase ?? 0;
      // Slow pendulum with a little drift; the twist about the chain is slower still.
      const swing = 0.012 * Math.sin(time * 0.55 + phase) + 0.004 * Math.sin(time * 0.23 + phase * 2.3);
      const twist = 0.02 * Math.sin(time * 0.17 + phase * 1.7);
      (uniforms.uSway.value as THREE.Vector2).set(swing, twist);
    }
  };
  update(0);

  return {
    group,
    update,
    projector: { position: PROJECTOR_POSITION.clone(), fov: PROJECTOR_FOV, aspect: PHOTO_WIDTH / PHOTO_HEIGHT },
  };
}

export { createCasinoBackdrop, type CasinoBackdrop, type CasinoBackdropOptions };
