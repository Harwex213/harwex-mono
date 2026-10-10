import * as THREE from "three";
import { named } from "./geometry";
import { glow } from "./materials";

// The dressing of the Game Show balcony (annex.ts): it makes the platform read as a game show stage on a casino balcony.
// Everything stands on the balcony floor (y = 0), outside the round amphitheatre floor (radius 22).
// Every part is stacked from the floor up. Only true curved mounts (a globe in a bowl, a rope end in a ball,
// fronds in a trunk, bulbs on a frame) are `seated`.
//
// Two kinds of props:
// - "Bonus Show Set": the props composed round the jester wheel (Bonus Show) and its shot. The group stands at the
//   saved place of the wheel (scene-overrides.json) and turns with it, so in the set frame the wheel pivot is the
//   origin and local +z is the front of the wheel. If the user moves Bonus Show, the user moves this group the same way
//   in the editor (one click on any of its props selects the whole set).
//   It holds a round two-step dais under the wheel with LED step lights, a pair of torchères beside the wheel,
//   two contestant podiums with buzzers, a host lectern, a marquee sign, a carpet runner with velvet rope stanchions
//   and two palms in gilded urns that frame the Bonus Show shot.
// - the balcony props: they stand at fixed places on the platform, out of the Bonus Show shot.
//   A cocktail table with stools, a studio camera on a pedestal, two softbox stands and two palms.
//
// The props are modelled at human size and scaled up as a whole, like the amphitheatre props (props.ts),
// so they read next to the 5 m wheel. A uniform scale keeps every contact exact.

// The saved place of Bonus Show: its pivot and its turn about y.
const BONUS_SHOW_HOME = { position: new THREE.Vector3(20.2, 0, 22.5), yaw: THREE.MathUtils.degToRad(-135) };

const SCALE = {
  podium: 1.35,
  lectern: 1.35,
  sign: 0.85,
  stanchion: 1.6,
  torchere: 1.8,
  palm: 2.0,
  lounge: 1.7,
  camera: 1.6,
  softbox: 1.6,
};

// The balcony materials of the dressing. The standard ones take the casino environment (`userData.ownEnvironment`,
// see annex.ts); the glowing ones are unlit.
function createDressingMaterials() {
  const lit = {
    annexVelvet: new THREE.MeshPhysicalMaterial({
      color: 0x4a0712,
      roughness: 0.85,
      sheen: 1,
      sheenColor: new THREE.Color(0xff4a3a),
      sheenRoughness: 0.45,
    }),
    annexCarpet: new THREE.MeshStandardMaterial({ map: createCarpetTexture(), roughness: 0.92, metalness: 0, envMapIntensity: 0.3 }),
    annexLeaf: new THREE.MeshStandardMaterial({ color: 0x2a5a22, roughness: 0.55, side: THREE.DoubleSide }),
    annexTrunk: new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 0.85 }),
    annexGlass: new THREE.MeshStandardMaterial({ color: 0xf2ead8, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.4 }),
    annexBottle: new THREE.MeshStandardMaterial({ color: 0x0c2014, roughness: 0.15, metalness: 0.2 }),
  };
  const unlit = {
    annexLed: new THREE.MeshBasicMaterial({ color: glow(0xffa548, 1.8) }),
    annexBulb: new THREE.MeshBasicMaterial({ color: glow(0xffe2a8, 3) }),
    annexGlobe: new THREE.MeshBasicMaterial({ color: glow(0xffa040, 1.25) }),
    annexBuzzer: new THREE.MeshBasicMaterial({ color: glow(0xff3020, 1.6) }),
    annexTally: new THREE.MeshBasicMaterial({ color: glow(0xff2010, 2.5) }),
    annexSoftbox: new THREE.MeshBasicMaterial({ color: glow(0xffe4c0, 0.85) }),
    annexSign: new THREE.MeshBasicMaterial({ map: createSignTexture(), color: glow(0xffffff, 1.6) }),
    annexMonogram: new THREE.MeshBasicMaterial({ map: createPanelTexture("B"), color: glow(0xffffff, 1.4) }),
    annexPodium1: new THREE.MeshBasicMaterial({ map: createPanelTexture("1"), color: glow(0xffffff, 1.4) }),
    annexPodium2: new THREE.MeshBasicMaterial({ map: createPanelTexture("2"), color: glow(0xffffff, 1.4) }),
  };
  for (const [name, material] of Object.entries(lit)) {
    material.name = name;
    material.userData.ownEnvironment = true;
  }
  for (const [name, material] of Object.entries(unlit)) {
    material.name = name;
  }
  return { ...lit, ...unlit, lit: Object.values(lit) };
}

// The balcony materials from annex.ts that the dressing shares.
interface BalconyMaterials {
  annexGold: THREE.MeshStandardMaterial;
  annexBronze: THREE.MeshStandardMaterial;
  annexLacquer: THREE.MeshStandardMaterial;
  annexFascia: THREE.MeshStandardMaterial;
}

type DressingMaterials = ReturnType<typeof createDressingMaterials> & BalconyMaterials;

function canvas2d(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("2d canvas is unavailable");
  }
  return { canvas, context };
}

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

// The carpet runner: burgundy with a gold border, a black band inside it and gold diamonds down the middle.
// The canvas has the proportions of the runner (about 1.8 m by 4.7 m).
function createCarpetTexture(): THREE.CanvasTexture {
  const width = 400;
  const height = 1000;
  const { canvas, context } = canvas2d(width, height);
  context.fillStyle = "#4e0c14";
  context.fillRect(0, 0, width, height);
  // Border: a gold line, a black band, a thin gold line.
  context.fillStyle = "#b8893e";
  context.fillRect(10, 10, width - 20, height - 20);
  context.fillStyle = "#170708";
  context.fillRect(18, 18, width - 36, height - 36);
  context.fillStyle = "#9a7232";
  context.fillRect(44, 44, width - 88, height - 88);
  context.fillStyle = "#4e0c14";
  context.fillRect(48, 48, width - 96, height - 96);
  // Diamonds down the middle, joined by a fine lattice.
  context.strokeStyle = "rgba(184, 137, 62, 0.55)";
  context.lineWidth = 3;
  const step = 150;
  for (let y = 48 + step / 2; y < height - 48; y += step) {
    context.beginPath();
    context.moveTo(width / 2, y - step / 2);
    context.lineTo(width / 2 + 120, y);
    context.lineTo(width / 2, y + step / 2);
    context.lineTo(width / 2 - 120, y);
    context.closePath();
    context.stroke();
    context.fillStyle = "#b8893e";
    context.beginPath();
    context.moveTo(width / 2, y - 34);
    context.lineTo(width / 2 + 26, y);
    context.lineTo(width / 2, y + 34);
    context.lineTo(width / 2 - 26, y);
    context.closePath();
    context.fill();
    context.fillStyle = "#170708";
    context.beginPath();
    context.arc(width / 2, y, 9, 0, Math.PI * 2);
    context.fill();
  }
  const texture = toTexture(canvas);
  return texture;
}

// The marquee sign face: gold serif letters on a dark burgundy ground, with a fine gold inner line.
function createSignTexture(): THREE.CanvasTexture {
  const width = 1024;
  const height = 440;
  const { canvas, context } = canvas2d(width, height);
  const ground = context.createLinearGradient(0, 0, 0, height);
  ground.addColorStop(0, "#1c0508");
  ground.addColorStop(0.5, "#2c080e");
  ground.addColorStop(1, "#1c0508");
  context.fillStyle = ground;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#8a6428";
  context.lineWidth = 6;
  context.strokeRect(26, 26, width - 52, height - 52);
  const letters = context.createLinearGradient(0, 80, 0, 360);
  letters.addColorStop(0, "#fff0c0");
  letters.addColorStop(0.55, "#f2c060");
  letters.addColorStop(1, "#b07a28");
  context.fillStyle = letters;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "bold 150px Georgia, serif";
  context.fillText("BONUS", width / 2, 150);
  context.font = "bold 118px Georgia, serif";
  context.fillText("SHOW", width / 2, 300);
  // Small stars on both sides of the lower word.
  context.fillStyle = "#f2c060";
  for (const x of [190, width - 190]) {
    context.beginPath();
    for (let i = 0; i < 10; i++) {
      const radius = i % 2 === 0 ? 30 : 12;
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      context.lineTo(x + Math.cos(angle) * radius, 300 + Math.sin(angle) * radius);
    }
    context.closePath();
    context.fill();
  }
  return toTexture(canvas);
}

// A podium or lectern panel: a gold glyph in a gold ring on a dark burgundy ground.
function createPanelTexture(glyph: string): THREE.CanvasTexture {
  const size = 256;
  const { canvas, context } = canvas2d(size, size * 1.5);
  context.fillStyle = "#24060b";
  context.fillRect(0, 0, size, size * 1.5);
  context.strokeStyle = "#b8893e";
  context.lineWidth = 5;
  context.strokeRect(12, 12, size - 24, size * 1.5 - 24);
  context.beginPath();
  context.arc(size / 2, size * 0.75, 82, 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = "#f4c870";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "bold 120px Georgia, serif";
  context.fillText(glyph, size / 2, size * 0.75 + 6);
  return toTexture(canvas);
}

function part(name: string, geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = named(new THREE.Mesh(geometry, material), name);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Upright cylinder between two heights.
function drum(name: string, radiusTop: number, radiusBottom: number, bottom: number, top: number, material: THREE.Material, segments = 48, x = 0, z = 0): THREE.Mesh {
  return part(name, new THREE.CylinderGeometry(radiusTop, radiusBottom, top - bottom, segments), material, x, (bottom + top) / 2, z);
}

// Box between two heights, centred on (x, z).
function block(name: string, width: number, bottom: number, top: number, depth: number, material: THREE.Material | THREE.Material[], x = 0, z = 0): THREE.Mesh {
  return part(name, new THREE.BoxGeometry(width, top - bottom, depth), material, x, (bottom + top) / 2, z);
}

// Flat ring between two radii and two heights, with flat caps and sharp edges.
function ring(name: string, inner: number, outer: number, bottom: number, top: number, material: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: top - bottom, bevelEnabled: false, curveSegments: 64 });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, bottom, 0);
  return part(name, geometry, material);
}

// Upright solid of revolution from a (radius, height) profile that starts and ends on the axis.
function lathe(name: string, profile: [number, number][], material: THREE.Material, segments = 40): THREE.Mesh {
  return part(name, new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments), material);
}

// A ball that sits on the end of a post: the post top rim lies on the ball, so the ball is seated.
function ball(name: string, radius: number, y: number, material: THREE.Material, x = 0, z = 0): THREE.Mesh {
  const mesh = part(name, new THREE.SphereGeometry(radius, 20, 14), material, x, y, z);
  mesh.userData.seated = true;
  return mesh;
}

// Turns an object so that its local +z faces the point (x, z) of its parent frame.
function face(object: THREE.Object3D, x: number, z: number): void {
  object.rotation.y = Math.atan2(x - object.position.x, z - object.position.z);
}

function at<T extends THREE.Object3D>(object: T, x: number, z: number, scale = 1): T {
  object.position.set(x, 0, z);
  object.scale.setScalar(scale);
  return object;
}

// The dais under the wheel: two low round steps round the wheel base, in black lacquer with gold nosings.
// A recessed amber LED strip runs under the nosing of each step. The wheel base (radius 1.25 m) stands in the hole
// on the balcony floor; the dais top (0.16 m) is level with the top of the lower tier of the base.
// The outer radius keeps the dais 0.2 m off the balustrade at the tip of the balcony.
function createDais(m: DressingMaterials): THREE.Group {
  const dais = new THREE.Group();
  // Lower step: body, LED strip, then the top with a gold nosing that overhangs the body.
  dais.add(ring("Lower Body", 1.29, 2.85, 0, 0.03, m.annexLacquer));
  dais.add(ring("Lower LED", 1.29, 2.83, 0.03, 0.05, m.annexLed));
  dais.add(ring("Lower Top", 1.29, 2.76, 0.05, 0.08, m.annexLacquer));
  dais.add(ring("Lower Nosing", 2.76, 2.88, 0.05, 0.08, m.annexGold));
  // Upper step, on the lower one.
  dais.add(ring("Upper Body", 1.27, 2.25, 0.08, 0.11, m.annexLacquer));
  dais.add(ring("Upper LED", 1.27, 2.23, 0.11, 0.13, m.annexLed));
  dais.add(ring("Upper Top", 1.27, 1.8, 0.13, 0.16, m.annexLacquer));
  dais.add(ring("Upper Inlay", 1.8, 1.86, 0.13, 0.16, m.annexGold));
  dais.add(ring("Upper Top Outer", 1.86, 2.16, 0.13, 0.16, m.annexLacquer));
  dais.add(ring("Upper Nosing", 2.16, 2.28, 0.13, 0.16, m.annexGold));
  return dais;
}

// Torchère: a stepped gold foot, a slim stem with two knops, a gold bowl and a frosted amber globe in it.
function createTorchere(m: DressingMaterials): THREE.Group {
  const lamp = new THREE.Group();
  lamp.add(lathe("Foot", [[0, 0], [0.22, 0], [0.22, 0.03], [0.17, 0.06], [0.16, 0.09], [0.08, 0.13], [0.05, 0.16], [0, 0.16]], m.annexGold));
  lamp.add(drum("Stem Lower", 0.026, 0.03, 0.16, 0.7, m.annexGold, 20));
  lamp.add(lathe("Knop Lower", [[0, 0.7], [0.04, 0.7], [0.065, 0.74], [0.04, 0.78], [0, 0.78]], m.annexGold, 24));
  lamp.add(drum("Stem Middle", 0.024, 0.026, 0.78, 1.4, m.annexGold, 20));
  lamp.add(lathe("Knop Upper", [[0, 1.4], [0.035, 1.4], [0.055, 1.43], [0.035, 1.46], [0, 1.46]], m.annexGold, 24));
  lamp.add(drum("Stem Upper", 0.024, 0.024, 1.46, 1.7, m.annexGold, 20));
  // An open bowl: the outer wall up to the rim, then the inner wall back down to the axis.
  lamp.add(lathe("Bowl", [[0, 1.7], [0.05, 1.7], [0.18, 1.78], [0.26, 1.88], [0.27, 1.9], [0.25, 1.9], [0.16, 1.81], [0, 1.77]], m.annexGold, 48));
  const globe = ball("Globe", 0.15, 1.92, m.annexGlobe);
  lamp.add(globe);
  return lamp;
}

// Contestant podium: a gold toe band, a black lacquer body with a lit number panel in a gold frame,
// a gold band and a lacquer desk top with a red buzzer. Local +z is the front.
function createPodium(m: DressingMaterials, panel: THREE.Material): THREE.Group {
  const podium = new THREE.Group();
  podium.add(block("Toe", 0.92, 0, 0.05, 0.72, m.annexGold));
  podium.add(block("Body", 0.86, 0.05, 0.85, 0.66, m.annexLacquer));
  podium.add(block("Panel Frame", 0.62, 0.22, 0.78, 0.02, m.annexGold, 0, 0.34));
  // Box material order: +x, -x, +y, -y, +z (the front), -z.
  podium.add(block("Panel", 0.54, 0.26, 0.74, 0.01, [m.annexGold, m.annexGold, m.annexGold, m.annexGold, panel, m.annexGold], 0, 0.355));
  podium.add(block("Band", 0.98, 0.85, 0.89, 0.78, m.annexGold));
  podium.add(block("Desk", 0.94, 0.89, 0.93, 0.74, m.annexLacquer));
  podium.add(drum("Buzzer Housing", 0.075, 0.085, 0.93, 0.97, m.annexGold, 32, 0, 0.12));
  const dome = part("Buzzer", new THREE.SphereGeometry(0.06, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), m.annexBuzzer, 0, 0.97, 0.12);
  podium.add(dome);
  return podium;
}

// Host lectern: a narrow lacquer column with a lit monogram panel, a gold desk band, a lacquer reading top
// and a gooseneck microphone. Local +z is the front.
function createLectern(m: DressingMaterials): THREE.Group {
  const lectern = new THREE.Group();
  lectern.add(block("Toe", 0.62, 0, 0.05, 0.5, m.annexGold));
  lectern.add(block("Body", 0.52, 0.05, 1.0, 0.4, m.annexLacquer));
  lectern.add(block("Panel Frame", 0.42, 0.3, 0.92, 0.02, m.annexGold, 0, 0.21));
  lectern.add(block("Panel", 0.34, 0.36, 0.86, 0.01, [m.annexGold, m.annexGold, m.annexGold, m.annexGold, m.annexMonogram, m.annexGold], 0, 0.225));
  lectern.add(block("Band", 0.64, 1.0, 1.04, 0.5, m.annexGold));
  lectern.add(block("Top", 0.6, 1.04, 1.08, 0.46, m.annexLacquer));
  lectern.add(drum("Mic Stem", 0.008, 0.012, 1.08, 1.36, m.annexGold, 12, 0, -0.12));
  lectern.add(ball("Mic", 0.026, 1.36 + Math.sqrt(0.026 * 0.026 - 0.008 * 0.008), m.annexFascia, 0, -0.12));
  return lectern;
}

// The centre of the stanchion ball, at human size: the post top rim (radius 0.025) lies on the ball.
const STANCHION_BALL = 0.92 + Math.sqrt(0.045 * 0.045 - 0.025 * 0.025);

// Velvet rope stanchion: a domed gold foot, a post and a ball on top.
function createStanchion(m: DressingMaterials): THREE.Group {
  const post = new THREE.Group();
  post.add(lathe("Foot", [[0, 0], [0.17, 0], [0.17, 0.02], [0.12, 0.05], [0.05, 0.07], [0, 0.07]], m.annexGold, 32));
  post.add(drum("Post", 0.025, 0.025, 0.07, 0.92, m.annexGold, 16));
  post.add(ball("Top", 0.045, STANCHION_BALL, m.annexGold));
  return post;
}

// A velvet rope that hangs between two ball centres. Its ends sit in the balls.
function createRope(m: DressingMaterials, name: string, from: THREE.Vector3, to: THREE.Vector3, sag: number): THREE.Mesh {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 16; i++) {
    const s = i / 16;
    points.push(new THREE.Vector3().lerpVectors(from, to, s).setY(from.y - sag * 4 * s * (1 - s)));
  }
  const rope = part(name, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 32, 0.045, 10, false), m.annexVelvet);
  rope.userData.seated = true;
  return rope;
}

// Potted palm in a gilded urn: the urn, a ringed trunk on the urn top and drooping fronds out of the trunk top.
function createPalm(m: DressingMaterials): THREE.Group {
  const palm = new THREE.Group();
  const urnTop = 0.82;
  palm.add(lathe("Urn", [[0, 0], [0.24, 0], [0.24, 0.05], [0.17, 0.1], [0.19, 0.2], [0.33, 0.45], [0.37, 0.62], [0.34, 0.74], [0.4, 0.78], [0.4, 0.82], [0, urnTop]], m.annexGold, 48));
  const trunkTop = 2.3;
  palm.add(drum("Trunk", 0.07, 0.1, urnTop, trunkTop, m.annexTrunk, 12));
  const length = 1.9;
  const frondGeometry = new THREE.PlaneGeometry(0.42, length, 1, 10);
  const position = frondGeometry.getAttribute("position");
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i) + length / 2;
    const x = position.getX(i);
    // Narrow at the root so it fits inside the trunk top, wide in the middle, pinched to a tip.
    const width = (1 - (y / length) * 0.8) * Math.min(1, 0.3 + y / 0.4);
    position.setX(i, x * width);
    position.setZ(i, -Math.pow(y / length, 2) * 0.9);
    position.setY(i, y);
  }
  frondGeometry.computeVertexNormals();
  const fronds = named(new THREE.Group(), "Fronds");
  for (let i = 0; i < 12; i++) {
    const frond = new THREE.Mesh(frondGeometry, m.annexLeaf);
    frond.position.y = trunkTop - 0.02;
    frond.rotation.order = "YXZ";
    frond.rotation.y = (i / 12) * Math.PI * 2 + (i % 2) * 0.2;
    frond.rotation.x = -0.95 + (i % 3) * 0.25;
    frond.castShadow = true;
    frond.userData.seated = true;
    fronds.add(frond);
  }
  palm.add(fronds);
  return palm;
}

// The marquee sign on a gilded frame: two gold legs on feet with a cross bar, a lacquer sign box between them,
// a gold frame on its face with bulbs round it, the lit lettering inside the frame and a gold crest on top.
// Built at full size; local +z is the front.
function createSign(m: DressingMaterials): THREE.Group {
  const sign = new THREE.Group();
  const half = 1.15;
  const leg = 0.1;
  const legX = half + leg / 2;
  // The legs are as deep as the sign box, so the box side faces lie on the leg faces.
  const depth = 0.16;
  for (const side of [-1, 1]) {
    const name = side < 0 ? "Left" : "Right";
    sign.add(block(`${name} Foot`, 0.18, 0, 0.06, 0.5, m.annexGold, side * legX));
    sign.add(block(`${name} Leg`, leg, 0.06, 2.62, depth, m.annexGold, side * legX));
    // The ball covers the leg top: its lower part sits on the leg.
    sign.add(ball(`${name} Finial`, 0.1, 2.62 + Math.sqrt(0.1 * 0.1 - 0.05 * 0.05), m.annexGold, side * legX));
  }
  sign.add(block("Cross Bar", half * 2, 0.4, 0.48, 0.06, m.annexGold));
  const bottom = 1.3;
  const top = 2.46;
  sign.add(block("Box", half * 2, bottom, top, depth, m.annexLacquer));
  // The frame on the face of the box: bars at the top and the bottom, posts between them.
  const front = depth / 2;
  const bar = 0.09;
  const frameDepth = 0.04;
  const frame = [
    block("Frame Top", half * 2, top - bar, top, frameDepth, m.annexGold, 0, front + frameDepth / 2),
    block("Frame Bottom", half * 2, bottom, bottom + bar, frameDepth, m.annexGold, 0, front + frameDepth / 2),
    block("Frame Left", bar, bottom + bar, top - bar, frameDepth, m.annexGold, -half + bar / 2, front + frameDepth / 2),
    block("Frame Right", bar, bottom + bar, top - bar, frameDepth, m.annexGold, half - bar / 2, front + frameDepth / 2),
  ];
  sign.add(...frame);
  const faceWidth = half * 2 - bar * 2;
  const black = m.annexLacquer;
  sign.add(block("Lettering", faceWidth, bottom + bar, top - bar, 0.01, [black, black, black, black, m.annexSign, black], 0, front + 0.005));
  // Bulbs on the frame face, round the lettering.
  const spots: [number, number][] = [];
  const across = 13;
  for (let i = 0; i < across; i++) {
    const x = -half + bar / 2 + ((half * 2 - bar) * i) / (across - 1);
    spots.push([x, top - bar / 2], [x, bottom + bar / 2]);
  }
  for (let i = 1; i < 6; i++) {
    const y = bottom + bar / 2 + ((top - bottom - bar) * i) / 6;
    spots.push([-half + bar / 2, y], [half - bar / 2, y]);
  }
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.028, 12, 8), m.annexBulb, spots.length);
  const matrix = new THREE.Matrix4();
  spots.forEach(([x, y], index) => {
    bulbs.setMatrixAt(index, matrix.makeTranslation(x, y, front + frameDepth));
  });
  const bulbsMesh = named(bulbs, "Bulbs");
  bulbsMesh.userData.seated = true;
  sign.add(bulbsMesh);
  // The crest: a gold fan standing on the top of the box.
  const crestShape = new THREE.Shape();
  crestShape.moveTo(-0.7, 0);
  crestShape.quadraticCurveTo(-0.62, 0.3, 0, 0.36);
  crestShape.quadraticCurveTo(0.62, 0.3, 0.7, 0);
  crestShape.closePath();
  const crest = new THREE.ExtrudeGeometry(crestShape, { depth: 0.06, bevelEnabled: false, curveSegments: 16 });
  crest.translate(0, top, -0.03);
  sign.add(part("Crest", crest, m.annexGold));
  sign.add(ball("Crest Jewel", 0.07, top + 0.36 + Math.sqrt(0.07 * 0.07 - 0.03 * 0.03), m.annexBulb));
  return sign;
}

// The carpet runner from the dais towards the amphitheatre, 12 mm thick. In the set frame it runs along +z.
function createRunner(m: DressingMaterials, from: number, to: number, width: number): THREE.Mesh {
  return block("Carpet Runner", width, 0, 0.012, to - from, m.annexCarpet, 0, (from + to) / 2);
}

// Champagne cocktail table: a gold foot and stem, a gold plate under a lacquer top,
// an ice bucket with a bottle and two flutes on the top.
function createCocktailTable(m: DressingMaterials): THREE.Group {
  const table = new THREE.Group();
  table.add(lathe("Foot", [[0, 0], [0.26, 0], [0.26, 0.02], [0.2, 0.05], [0.06, 0.08], [0, 0.08]], m.annexGold, 40));
  table.add(drum("Stem", 0.035, 0.04, 0.08, 1.04, m.annexGold, 20));
  table.add(drum("Top Edge", 0.34, 0.34, 1.04, 1.06, m.annexGold, 48));
  table.add(drum("Top", 0.32, 0.32, 1.06, 1.08, m.annexLacquer, 48));
  // The ice bucket: an open gold cup. The bottle stands on its inner floor.
  table.add(lathe("Ice Bucket", [[0, 1.08], [0.07, 1.08], [0.085, 1.28], [0.075, 1.28], [0.062, 1.1], [0, 1.1]], m.annexGold, 32));
  table.add(lathe("Bottle", [[0, 1.1], [0.04, 1.1], [0.042, 1.3], [0.02, 1.36], [0.014, 1.44], [0, 1.44]], m.annexBottle, 24));
  for (const [index, x] of [-0.18, 0.18].entries()) {
    const flute = lathe(`Flute ${index + 1}`, [[0, 0], [0.035, 0], [0.035, 0.005], [0.004, 0.012], [0.004, 0.1], [0.022, 0.13], [0.026, 0.24], [0, 0.24]], m.annexGlass, 20);
    flute.position.set(x, 1.08, 0.12);
    table.add(flute);
  }
  return table;
}

// Bar stool: a gold foot, a stem, a gold seat ring and a velvet cushion.
function createStool(m: DressingMaterials): THREE.Group {
  const stool = new THREE.Group();
  stool.add(lathe("Foot", [[0, 0], [0.22, 0], [0.22, 0.02], [0.15, 0.05], [0.05, 0.07], [0, 0.07]], m.annexGold, 40));
  stool.add(drum("Stem", 0.03, 0.035, 0.07, 0.66, m.annexGold, 20));
  stool.add(drum("Seat Ring", 0.2, 0.18, 0.66, 0.7, m.annexGold, 40));
  stool.add(drum("Cushion", 0.2, 0.21, 0.7, 0.78, m.annexVelvet, 40));
  return stool;
}

// Studio camera on a pedestal: a lacquer skirt, a column, a head plate, the camera body with a lens hood,
// a viewfinder and a red tally light, and two pan bars. Local +z is the lens direction.
function createStudioCamera(m: DressingMaterials): THREE.Group {
  const camera = new THREE.Group();
  camera.add(lathe("Skirt", [[0, 0], [0.4, 0], [0.4, 0.04], [0.32, 0.2], [0, 0.2]], m.annexFascia, 40));
  camera.add(drum("Ring", 0.12, 0.12, 0.2, 0.3, m.annexGold, 32));
  camera.add(drum("Column", 0.07, 0.07, 0.3, 1.2, m.annexFascia, 24));
  camera.add(block("Head", 0.3, 1.2, 1.26, 0.56, m.annexGold));
  camera.add(block("Body", 0.26, 1.26, 1.52, 0.5, m.annexFascia));
  const lensGeometry = new THREE.CylinderGeometry(0.1, 0.085, 0.32, 32);
  lensGeometry.rotateX(Math.PI / 2);
  camera.add(part("Lens", lensGeometry, m.annexFascia, 0, 1.39, 0.25 + 0.16));
  camera.add(block("Viewfinder", 0.2, 1.52, 1.66, 0.18, m.annexFascia, 0, -0.1));
  camera.add(block("Tally", 0.06, 1.52, 1.55, 0.03, m.annexTally, 0, 0.2));
  for (const side of [-1, 1]) {
    camera.add(block(side < 0 ? "Pan Bar Left" : "Pan Bar Right", 0.03, 1.22, 1.25, 0.6, m.annexGold, side * 0.13, -0.28 - 0.3));
  }
  return camera;
}

// Softbox stand: three legs from a hub to the floor, a column, a speed ring and a softbox with a lit diffuser.
// Local +z is the light direction.
function createSoftbox(m: DressingMaterials): THREE.Group {
  const stand = new THREE.Group();
  const hub = 0.62;
  const spread = 0.5;
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const foot = new THREE.Vector3(Math.sin(angle) * spread, 0, Math.cos(angle) * spread);
    const top = new THREE.Vector3(0, hub, 0);
    const length = foot.distanceTo(top);
    const legGeometry = new THREE.CylinderGeometry(0.014, 0.014, length, 8);
    const leg = part(`Leg ${i + 1}`, legGeometry, m.annexFascia);
    leg.position.copy(foot).add(top).multiplyScalar(0.5);
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(foot).normalize());
    leg.userData.seated = true;
    stand.add(leg);
  }
  stand.add(drum("Column", 0.02, 0.025, hub - 0.08, 2.0, m.annexFascia, 12));
  stand.add(block("Speed Ring", 0.14, 2.0, 2.14, 0.14, m.annexGold));
  // The softbox: a square frustum on its side, the narrow end on the speed ring face.
  const length = 0.42;
  const boxGeometry = new THREE.CylinderGeometry(0.07 * Math.SQRT2, 0.32 * Math.SQRT2, length, 4, 1, false, Math.PI / 4);
  boxGeometry.rotateX(Math.PI / 2);
  stand.add(part("Softbox", boxGeometry, m.annexFascia, 0, 2.07, 0.07 + length / 2));
  stand.add(block("Diffuser", 0.6, 2.07 - 0.3, 2.07 + 0.3, 0.01, m.annexSoftbox, 0, 0.07 + length + 0.005));
  return stand;
}

// The props composed round the jester wheel, in its frame (see the top of the file).
function createShowSet(m: DressingMaterials): THREE.Group {
  const set = named(new THREE.Group(), "Bonus Show Set");
  set.position.copy(BONUS_SHOW_HOME.position);
  set.rotation.y = BONUS_SHOW_HOME.yaw;

  set.add(named(createDais(m), "Dais"));

  // Torchères on both sides of the wheel, a little in front of its face, clear of the dais and the balustrade.
  for (const side of [-1, 1]) {
    set.add(named(at(createTorchere(m), side * 3.34, 0.29, SCALE.torchere), side < 0 ? "Torchère Left" : "Torchère Right"));
  }

  // Contestants on the left of the wheel (seen from the shot), the sign and the host on the right.
  // The podiums stand side by side at the same distance from the shot camera and turn their fronts to it.
  // The host lectern stands by the aisle, in front of the sign, and turns to the contestants.
  const podiums: [string, number, number, THREE.Material][] = [
    ["Contestant Podium 1", -4.18, 3.4, m.annexPodium1],
    ["Contestant Podium 2", -2.85, 2.25, m.annexPodium2],
  ];
  for (const [name, x, z, panel] of podiums) {
    const podium = named(at(createPodium(m, panel), x, z, SCALE.podium), name);
    face(podium, 2.5, 10);
    set.add(podium);
  }
  const sign = named(at(createSign(m), 3.92, 1.46, SCALE.sign), "Marquee Sign");
  face(sign, 2.5, 10);
  set.add(sign);
  const lectern = named(at(createLectern(m), 3.3, 4.4, SCALE.lectern), "Host Lectern");
  face(lectern, -3.5, 3);
  set.add(lectern);

  // The carpet runner from the dais to the edge of the round floor, with velvet ropes on both sides.
  set.add(createRunner(m, 2.92, 7.6, 1.8));
  const ropes = named(new THREE.Group(), "Velvet Ropes");
  const rows = [4.0, 5.6, 7.2];
  for (const side of [-1, 1]) {
    const tops: THREE.Vector3[] = [];
    rows.forEach((z, index) => {
      const x = side * 1.3;
      ropes.add(named(at(createStanchion(m), x, z, SCALE.stanchion), `Stanchion ${side < 0 ? "L" : "R"}${index + 1}`));
      tops.push(new THREE.Vector3(x, STANCHION_BALL * SCALE.stanchion, z));
    });
    for (let i = 0; i < tops.length - 1; i++) {
      ropes.add(createRope(m, `Rope ${side < 0 ? "L" : "R"}${i + 1}`, tops[i] as THREE.Vector3, tops[i + 1] as THREE.Vector3, 0.32));
    }
  }
  set.add(ropes);

  // Palms in the foreground corners of the Bonus Show shot.
  set.add(named(at(createPalm(m), -3.6, 6.4, SCALE.palm), "Palm Left"));
  set.add(named(at(createPalm(m), 5.4, 6.8, SCALE.palm), "Palm Right"));
  return set;
}

// The balcony props at fixed places on the platform (world x, z), out of the Bonus Show shot.
function createBalconyProps(m: DressingMaterials, wheel: THREE.Vector3): THREE.Object3D[] {
  const props: THREE.Object3D[] = [];

  // A champagne table with two stools on the long front strip of the balcony.
  const lounge = named(new THREE.Group(), "Champagne Table");
  lounge.add(named(at(createCocktailTable(m), 0, 0, SCALE.lounge), "Table"));
  for (const side of [-1, 1]) {
    const stool = named(at(createStool(m), side * 1.25, 0, SCALE.lounge), side < 0 ? "Stool Left" : "Stool Right");
    lounge.add(stool);
  }
  lounge.position.set(9.6, 0, 23.8);
  props.push(lounge);

  // A studio camera on the front strip, aimed at the wheel.
  const camera = named(at(createStudioCamera(m), 12.2, 23.6, SCALE.camera), "Studio Camera");
  face(camera, wheel.x, wheel.z);
  props.push(camera);

  // Two softboxes aimed at the wheel: one by the casino side, one on the front strip.
  for (const [name, x, z] of [["Softbox Casino Side", 22.3, 13.2], ["Softbox Front", 6.0, 24.3]] as const) {
    const softbox = named(at(createSoftbox(m), x, z, SCALE.softbox), name);
    face(softbox, wheel.x, wheel.z);
    props.push(softbox);
  }

  // Palms on the casino side (clear of the colonnade wall) and at the left corner.
  props.push(named(at(createPalm(m), 22.3, 15.6, SCALE.palm), "Palm Casino Side"));
  props.push(named(at(createPalm(m), -0.9, 24.5, SCALE.palm), "Palm Left Corner"));
  return props;
}

// The dressing of the balcony. `balcony` holds the balcony materials of annex.ts.
// `materials` lists the new lit materials: they take the casino environment like the other balcony materials.
function createAnnexDressing(balcony: BalconyMaterials): { group: THREE.Group; materials: THREE.MeshStandardMaterial[] } {
  const m: DressingMaterials = { ...createDressingMaterials(), ...balcony };
  const group = named(new THREE.Group(), "Show Dressing", true);
  group.add(createShowSet(m), ...createBalconyProps(m, BONUS_SHOW_HOME.position));
  return { group, materials: m.lit };
}

export { createAnnexDressing };
