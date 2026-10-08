import * as THREE from "three";
import layout from "../assets/casino-hall-layout.json";
import photoUrl from "../assets/casino-hall.jpg";
import plateUrl from "../assets/casino-hall-plate.jpg";
import cutUrl from "../assets/casino-hall-cut.png";
import fxUrl from "../assets/casino-hall-fx.png";
import { named } from "./geometry";
import backdropFragment from "./shaders/casinoBackdrop.frag";
import backdropVertex from "./shaders/casinoBackdrop.vert";
import commonChunk from "./shaders/common.glsl";

// A tall Art Deco casino hall, made from one generated picture (src/assets/casino-hall-photo.png,
// 1536 x 1024) by 2.5D camera projection.
//
// Projection setup. The picture is treated as the view of a virtual projector camera:
// - a level pinhole with the focal length FOCAL = 1200 picture pixels, so the horizontal field of
//   view is 2 * atan(768 / 1200) = 65.2 deg;
// - its lens is shifted up: the horizon lies on row 630 of 1024, not in the middle. The projector
//   sees 27.7 deg above the horizon and 18.2 deg below it;
// - its eye is EYE = 1.8 m above the casino floor (the near chairs are 1 m tall). The room is a box
//   around it: side walls 17 m left and right of the axis, a ceiling at 22.5 m, the back wall 80 m
//   away. Each card depth comes from the row where its furniture meets the floor (depth =
//   EYE * FOCAL / (row - horizon)), or for a chandelier from its column (the two rows of
//   chandeliers hang 7 m off the axis).
// scripts/build-casino-backdrop.py holds this model and writes it to casino-hall-layout.json; this
// file reads every number from there.
// Every surface point is placed on the ray of its picture pixel: from the projector the backdrop
// shows the picture exactly, and from anywhere else the layers parallax like the room would.
//
// Frame (the pivot rule): the local origin is the bottom centre of the near edge, on the casino
// floor. The hall extends towards -Z; the viewer looks from +Z. The near edge is the plane where
// the picture's bottom row meets the floor (NEAR_DEPTH = 5.48 m from the projector). The projector
// sits at PROJECTOR_POSITION = (0, 1.8, 5.48) in this frame (1 unit = 1 picture metre). That is the
// sweet spot for the camera: from there the picture fills a 7.0 m x 4.68 m window on the near edge
// (x from -3.5 to 3.5, y from 0 to 4.68). A camera that dollies or orbits a few metres around it
// sees the parallax. Outside the picture there is no image: the shell fades to dark and a card
// fades out. Put the backdrop behind an opening of about that window, so the studio wall hides the
// frustum edges when the camera is off the sweet spot or farther back.
// The furniture is drawn for a 1.8 m eye. Scaling the group up so that the projector meets a
// higher camera also scales the furniture.
// `setNear` moves the near edge deeper into the hall, for a backdrop whose projector stands far in
// front of the wall opening: the shell then starts on the far face of the wall, and a card nearer
// than that moves back along its rays. From the projector the picture stays exactly the same.
//
// Layers (scripts/build-casino-backdrop.py cuts them):
// - Room shell: five planes of the box. It draws the "plate", the picture with every card subject
//   removed and filled in, so a card that slides sideways uncovers a plausible room instead of a
//   smear or a copy of itself.
// - Cards: flat cut-outs facing +Z at their own depth: three groups of tables on each side of the
//   aisle and eight chandeliers (these sway).
//
// Unlit: ShaderMaterial, no lights, no shadows, no fog. Colour stays linear; the composer's
// OutputPass applies the tone mapping. `uExposure` keeps the hall dimmer than the set and below
// the bloom threshold; only the crystal glints and the slot flashes reach it.

const PHOTO_WIDTH = layout.width;
const PHOTO_HEIGHT = layout.height;
const FOCAL = layout.focal;
const CENTER_U = layout.centerU;
const HORIZON_V = layout.horizonV;
// Picture metres.
const EYE = layout.eye;
const CEILING = layout.ceiling;
const HALF_WIDTH = layout.halfWidth;
const BACK = layout.back;
// Where the bottom picture row meets the floor.
const NEAR_DEPTH = (EYE * FOCAL) / (PHOTO_HEIGHT - HORIZON_V);
const PROJECTOR_POSITION = new THREE.Vector3(0, EYE, NEAR_DEPTH);
// Tangents of the projector frustum edges.
const FRUSTUM = {
  left: -CENTER_U / FOCAL,
  right: (PHOTO_WIDTH - CENTER_U) / FOCAL,
  top: HORIZON_V / FOCAL,
  bottom: -(PHOTO_HEIGHT - HORIZON_V) / FOCAL,
};
const PROJECTOR_FOV = THREE.MathUtils.radToDeg(Math.atan(FRUSTUM.top) - Math.atan(FRUSTUM.bottom));

interface CasinoBackdropOptions {
  // Brightness of the picture, linear. 1 shows the picture as it is.
  exposure?: number;
  // Softness of the picture: 1 is sharp, 2 is about one texel of blur, 4 two texels.
  defocus?: number;
  // Strength of the distance haze and the light shafts.
  haze?: number;
  // Strength of all the animation (glints, flicker, slots, curtains, breathing, sway).
  life?: number;
}

interface CasinoBackdrop {
  group: THREE.Group;
  // Deterministic in time: the same time gives the same frame.
  update: (time: number) => void;
  // Moves the near edge to `depth` picture metres from the projector (see the frame notes above).
  // A depth under the default near edge changes nothing.
  setNear: (depth: number) => void;
  // Projector (sweet spot) in the backdrop frame. `fov` is the full vertical field of view in
  // degrees. The frustum is not symmetric: `frustum` holds the tangents of its four edges (the
  // horizon is at height 0, `top` is above it, `bottom` is negative).
  projector: {
    position: THREE.Vector3;
    fov: number;
    aspect: number;
    frustum: { left: number; right: number; top: number; bottom: number };
  };
}

interface Card {
  name: string;
  // Picture pixels: left, top, right, bottom.
  box: [number, number, number, number];
  // Picture metres from the projector.
  depth: number;
  // Channel of casino-hall-cut.png that holds the coverage.
  channel: number;
  // Swaying chandelier: the column of its chain.
  hangU?: number;
}

// Back to front, so the blending order is right.
const CARDS: Card[] = layout.cards.map((card) => ({
  ...card,
  box: [card.box[0] ?? 0, card.box[1] ?? 0, card.box[2] ?? 0, card.box[3] ?? 0],
}));

// Point of the backdrop frame on the ray of picture pixel (u, v), `depth` picture metres away.
function onRay(u: number, v: number, depth: number, target = new THREE.Vector3()): THREE.Vector3 {
  return target.set(
    PROJECTOR_POSITION.x + (depth * (u - CENTER_U)) / FOCAL,
    PROJECTOR_POSITION.y - (depth * (v - HORIZON_V)) / FOCAL,
    PROJECTOR_POSITION.z - depth,
  );
}

// Backdrop frame -> (u * w, v * w, -, w) of the picture texture, w = depth from the projector.
function projectorMatrix(): THREE.Matrix4 {
  const toTexture = new THREE.Matrix4().set(
    FOCAL / PHOTO_WIDTH, 0, -CENTER_U / PHOTO_WIDTH, 0,
    0, FOCAL / PHOTO_HEIGHT, -(1 - HORIZON_V / PHOTO_HEIGHT), 0,
    0, 0, -1, 0,
    0, 0, -1, 0,
  );
  const fromProjector = new THREE.Matrix4().makeTranslation(
    -PROJECTOR_POSITION.x,
    -PROJECTOR_POSITION.y,
    -PROJECTOR_POSITION.z,
  );
  return toTexture.multiply(fromProjector);
}

// A rectangle from four corners: a, b along the bottom, c, d along the top, seen from inside the box.
function quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry().setFromPoints([a, b, c, d]);
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  geometry.computeBoundingSphere();
  return geometry;
}

// A card nearer than the near edge stands this far (picture metres) behind it.
const CARD_GAP = 0.3;

// The five inner faces of the room box. The box starts `near` picture metres from the projector.
function shellGeometries(near: number): [string, THREE.BufferGeometry][] {
  const x = HALF_WIDTH;
  const top = CEILING;
  const front = PROJECTOR_POSITION.z - near;
  const back = PROJECTOR_POSITION.z - BACK;
  const p = (px: number, py: number, pz: number) => new THREE.Vector3(px, py, pz);
  return [
    ["Shell Floor", quad(p(-x, 0, front), p(x, 0, front), p(-x, 0, back), p(x, 0, back))],
    ["Shell Ceiling", quad(p(-x, top, back), p(x, top, back), p(-x, top, front), p(x, top, front))],
    ["Shell Left", quad(p(-x, 0, front), p(-x, 0, back), p(-x, top, front), p(-x, top, back))],
    ["Shell Right", quad(p(x, 0, back), p(x, 0, front), p(x, top, back), p(x, top, front))],
    ["Shell Back", quad(p(-x, 0, back), p(x, 0, back), p(-x, top, back), p(x, top, back))],
  ];
}

// Depth of a card behind a near edge `near` picture metres from the projector.
function cardDepth(card: Card, near: number): number {
  return Math.max(card.depth, near + CARD_GAP);
}

function cardGeometry(card: Card, depth: number): THREE.BufferGeometry {
  const [left, top, right, bottom] = card.box;
  return quad(
    onRay(left, bottom, depth),
    onRay(right, bottom, depth),
    onRay(left, top, depth),
    onRay(right, top, depth),
  );
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
  const cut = loadMask(cutUrl);
  const fx = loadMask(fxUrl);
  const localToProjector = projectorMatrix();

  const group = named(new THREE.Group(), "Casino Backdrop", true);
  group.userData.auditIgnore = true;

  // Uniform objects shared by every layer.
  const shared = {
    uWorldToProjector: { value: new THREE.Matrix4() },
    uCut: { value: cut },
    uFx: { value: fx },
    uMapSize: { value: new THREE.Vector2(PHOTO_WIDTH, PHOTO_HEIGHT) },
    uTime: { value: 0 },
    uExposure: { value: options.exposure ?? 0.8 },
    uDefocus: { value: Math.log2(Math.max(options.defocus ?? 1.4, 0.25)) },
    uHaze: { value: options.haze ?? 1 },
    uLife: { value: options.life ?? 1 },
    uHazeColor: { value: new THREE.Color(0.22, 0.14, 0.07) },
    uVoidColor: { value: new THREE.Color(0.008, 0.005, 0.004) },
    uHazeRange: { value: new THREE.Vector2(12, 85) },
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
      side: THREE.DoubleSide,
    });

  const addMesh = (mesh: THREE.Mesh, name: string, parent: THREE.Object3D) => {
    named(mesh, name);
    mesh.userData.auditIgnore = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.onBeforeRender = syncProjector;
    parent.add(mesh);
  };

  const shellMaterial = makeMaterial(plate, { SHELL: "" }, { uChannel: { value: new THREE.Vector3() } });
  const shell = named(new THREE.Group(), "Room Shell", true);
  shell.userData.auditIgnore = true;
  group.add(shell);
  const shellMeshes: THREE.Mesh[] = [];
  for (const [name, geometry] of shellGeometries(NEAR_DEPTH)) {
    const mesh = new THREE.Mesh(geometry, shellMaterial);
    addMesh(mesh, name, shell);
    shellMeshes.push(mesh);
  }

  const sways: { phase: number; uniforms: { uSway: THREE.IUniform } }[] = [];
  const cardMeshes: THREE.Mesh[] = [];
  // The ceiling point straight above each swaying chandelier, at its depth.
  const hangs = new Map<Card, THREE.Vector3>();
  const hangAt = (card: Card, near: number) => {
    const hang = hangs.get(card);
    if (hang && card.hangU !== undefined) {
      onRay(card.hangU, HORIZON_V, cardDepth(card, near), hang);
      hang.y = CEILING;
    }
  };
  CARDS.forEach((card, index) => {
    const swayUniforms = { uSwayPivot: { value: new THREE.Vector3() }, uSway: { value: new THREE.Vector2() } };
    const channel = new THREE.Vector3();
    channel.setComponent(card.channel, 1);
    const defines: Record<string, string> = card.hangU === undefined ? {} : { SWAY: "" };
    const material = makeMaterial(photo, defines, { uChannel: { value: channel }, ...swayUniforms });
    const mesh = new THREE.Mesh(cardGeometry(card, cardDepth(card, NEAR_DEPTH)), material);
    // Farthest card first; all before the studio's own transparent objects.
    mesh.renderOrder = -40 + index;
    addMesh(mesh, card.name, group);
    cardMeshes.push(mesh);
    if (card.hangU !== undefined) {
      const hang = new THREE.Vector3();
      hangs.set(card, hang);
      hangAt(card, NEAR_DEPTH);
      sways.push({ phase: index * 1.37, uniforms: swayUniforms });
      mesh.onBeforeRender = () => {
        syncProjector();
        (swayUniforms.uSwayPivot.value as THREE.Vector3).copy(hang).applyMatrix4(group.matrixWorld);
      };
    }
  });

  const update = (time: number) => {
    shared.uTime.value = time;
    const life = shared.uLife.value;
    for (const { phase, uniforms } of sways) {
      // Slow pendulum with a little drift; the twist about the chain is slower still.
      const swing = 0.004 * Math.sin(time * 0.42 + phase) + 0.0015 * Math.sin(time * 0.19 + phase * 2.3);
      const twist = 0.03 * Math.sin(time * 0.15 + phase * 1.7);
      (uniforms.uSway.value as THREE.Vector2).set(swing * life, twist * life);
    }
  };
  update(0);

  const setNear = (depth: number) => {
    const near = Math.max(depth, NEAR_DEPTH);
    shellGeometries(near).forEach(([, geometry], index) => {
      const mesh = shellMeshes[index] as THREE.Mesh;
      mesh.geometry.dispose();
      mesh.geometry = geometry;
    });
    CARDS.forEach((card, index) => {
      const mesh = cardMeshes[index] as THREE.Mesh;
      mesh.geometry.dispose();
      mesh.geometry = cardGeometry(card, cardDepth(card, near));
      hangAt(card, near);
    });
  };

  return {
    group,
    update,
    setNear,
    projector: {
      position: PROJECTOR_POSITION.clone(),
      fov: PROJECTOR_FOV,
      aspect: PHOTO_WIDTH / PHOTO_HEIGHT,
      frustum: { ...FRUSTUM },
    },
  };
}

export { createCasinoBackdrop, type CasinoBackdrop, type CasinoBackdropOptions };
