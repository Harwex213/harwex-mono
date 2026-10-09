import * as THREE from "three";
import jesterFaceUrl from "../assets/game-jester-wheel-face.jpg";
import slotScreenUrl from "../assets/game-slot-screen.jpg";
import { named, polar } from "./geometry";
import { glow } from "./materials";

// The three bonus games, each smaller than the hero wheel:
// - "Bonus Show", the jester money wheel: it stands on the Game Show platform of the annex (annex.ts), before the casino panorama;
// - "Bonus Dice", the acrylic plinko tower, and "Bonus Luck", the slot cabinet: they stand in the amphitheatre.
// The user placed all three in the editor (scene-overrides.json); the code defaults below are only a start.
// Every part is stacked from the floor up; only true curved mounts (bosses in the rim, bulbs on the arc) are seated.

// The wide shot camera stands here; the jester wheel turns its face towards it.
const CAMERA = new THREE.Vector2(0, 10);

function loadTexture(url: string): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function createGameMaterials() {
  const materials = {
    gameBrass: new THREE.MeshStandardMaterial({ color: 0xc89a4a, metalness: 1, roughness: 0.3 }),
    gameBrassDark: new THREE.MeshStandardMaterial({ color: 0x7a5626, metalness: 1, roughness: 0.4 }),
    gameWood: new THREE.MeshStandardMaterial({ color: 0x5a3219, metalness: 0, roughness: 0.55 }),
    gameBlack: new THREE.MeshStandardMaterial({ color: 0x07080c, metalness: 0.4, roughness: 0.25 }),
    gameGold: new THREE.MeshStandardMaterial({ color: 0xf0c060, metalness: 1, roughness: 0.2 }),
    gameChrome: new THREE.MeshStandardMaterial({ color: 0xd8dde4, metalness: 1, roughness: 0.15 }),
    gameAcrylic: new THREE.MeshPhysicalMaterial({
      color: 0xdfeeff,
      metalness: 0,
      roughness: 0.04,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    gamePeg: new THREE.MeshStandardMaterial({ color: 0xeaf4ff, emissive: 0xbfdcff, emissiveIntensity: 0.6, roughness: 0.1 }),
    gameRed: new THREE.MeshStandardMaterial({ color: 0xc8202a, emissive: 0x500006, roughness: 0.35 }),
    gameBlue: new THREE.MeshStandardMaterial({ color: 0x2050d0, emissive: 0x081850, roughness: 0.35 }),
    gameGreen: new THREE.MeshStandardMaterial({ color: 0x20a040, emissive: 0x063010, roughness: 0.35 }),
  };
  for (const [name, material] of Object.entries(materials)) {
    material.name = name;
  }
  return materials;
}

type GameMaterials = ReturnType<typeof createGameMaterials>;

function part(name: string, geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = named(new THREE.Mesh(geometry, material), name);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Upright cylinder between two heights.
function drum(name: string, radiusTop: number, radiusBottom: number, bottom: number, top: number, material: THREE.Material, segments = 64): THREE.Mesh {
  return part(name, new THREE.CylinderGeometry(radiusTop, radiusBottom, top - bottom, segments), material, 0, (bottom + top) / 2, 0);
}

// Box between two heights, centred on x and z.
function block(name: string, width: number, bottom: number, top: number, depth: number, material: THREE.Material | THREE.Material[], x = 0, z = 0): THREE.Mesh {
  return part(name, new THREE.BoxGeometry(width, top - bottom, depth), material, x, (bottom + top) / 2, z);
}

// Turns an object so that its local +z faces the wide shot camera.
function faceCamera(object: THREE.Object3D): void {
  object.rotation.y = Math.atan2(CAMERA.x - object.position.x, CAMERA.y - object.position.z);
}

// Jester money wheel (Bonus Show): a printed disc in a brass rim, held at its sides by a C-shaped arc with bulbs,
// on a post, a brass collar and a two-tier wooden base. Three coloured pointers stand on the rim top.
function createJesterWheel(materials: GameMaterials): THREE.Group {
  const wheel = new THREE.Group();
  const radius = 1.7;
  const thickness = 0.12;
  const rimTube = 0.06;
  const arcRadius = 1.95;
  const arcTube = 0.07;

  wheel.add(drum("Base Lower", 1.22, 1.25, 0, 0.16, materials.gameWood));
  wheel.add(drum("Base Band", 1.1, 1.1, 0.16, 0.2, materials.gameBrass));
  wheel.add(drum("Base Upper", 0.98, 1.0, 0.2, 0.34, materials.gameWood));
  wheel.add(drum("Collar", 0.26, 0.32, 0.34, 0.56, materials.gameBrass, 32));
  const arcBottom = 1.12;
  const centerY = arcBottom + arcRadius;
  // The post ends at the arc centre line: it is seated in the round arc tube.
  const post = drum("Post", 0.09, 0.09, 0.56, arcBottom, materials.gameBrass, 24);
  post.userData.seated = true;
  wheel.add(post);

  // Lower half circle of tube around the disc, in the disc plane.
  const arcGeometry = new THREE.TorusGeometry(arcRadius, arcTube, 12, 96, Math.PI);
  arcGeometry.rotateZ(Math.PI);
  wheel.add(part("Arc", arcGeometry, materials.gameBrass, 0, centerY, 0));
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 12, 8), new THREE.MeshBasicMaterial({ color: glow(0xffe2a8, 4) }), 17);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < 17; i++) {
    const angle = Math.PI + (Math.PI * (i + 0.5)) / 17;
    matrix.makeTranslation(Math.cos(angle) * arcRadius, centerY + Math.sin(angle) * arcRadius, arcTube);
    bulbs.setMatrixAt(i, matrix);
  }
  const bulbsMesh = named(bulbs, "Arc Bulbs");
  bulbsMesh.userData.seated = true;
  wheel.add(bulbsMesh);

  // The printed disc. The two rotations give its front cap the UVs of a CircleGeometry.
  const face = loadTexture(jesterFaceUrl);
  const faceMaterial = new THREE.MeshStandardMaterial({ map: face, emissive: 0xffffff, emissiveMap: face, emissiveIntensity: 0.22, roughness: 0.4 });
  const discGeometry = new THREE.CylinderGeometry(radius, radius, thickness, 96);
  discGeometry.rotateX(Math.PI / 2);
  discGeometry.rotateZ(Math.PI / 2);
  wheel.add(part("Disc", discGeometry, [materials.gameBrassDark, faceMaterial, materials.gameBrassDark], 0, centerY, 0));
  // Brass rim around the disc edge, seated half on the edge.
  const rim = part("Rim", new THREE.TorusGeometry(radius, rimTube, 12, 128), materials.gameBrass, 0, centerY, 0);
  rim.userData.seated = true;
  wheel.add(rim);
  // Pivot bosses from the rim to the arc ends; both ends sit in round tubes.
  for (const side of [-1, 1]) {
    const bossGeometry = new THREE.CylinderGeometry(0.11, 0.11, arcRadius - radius, 24);
    bossGeometry.rotateZ(Math.PI / 2);
    const boss = part(side < 0 ? "Pivot Left" : "Pivot Right", bossGeometry, materials.gameBrass, side * (radius + arcRadius) / 2, centerY, 0);
    boss.userData.seated = true;
    wheel.add(boss);
  }

  // Pointers: flat triangles with the tip down, the tip edge seated on the round rim.
  const pointerShape = new THREE.Shape();
  pointerShape.moveTo(0, 0);
  pointerShape.lineTo(0.24, 0.48);
  pointerShape.lineTo(-0.24, 0.48);
  pointerShape.closePath();
  const pointerGeometry = new THREE.ExtrudeGeometry(pointerShape, { depth: 0.1, bevelEnabled: false });
  pointerGeometry.translate(0, 0, -0.05);
  const pointers: [string, number, THREE.Material][] = [
    ["Pointer Red", 0.62, materials.gameRed],
    ["Pointer Blue", 0, materials.gameBlue],
    ["Pointer Green", -0.62, materials.gameGreen],
  ];
  for (const [name, angle, material] of pointers) {
    const pointer = part(name, pointerGeometry, material);
    const tip = radius + rimTube - 0.015;
    pointer.position.set(-Math.sin(angle) * tip, centerY + Math.cos(angle) * tip, 0);
    pointer.rotation.z = angle;
    pointer.userData.seated = true;
    wheel.add(pointer);
  }
  return wheel;
}

// Slot cabinet (Bonus Luck): a black plinth with a gold band, a tall black body with the printed screen on its front, a gold cap.
function createSlotCabinet(materials: GameMaterials): THREE.Group {
  const cabinet = new THREE.Group();
  const screen = loadTexture(slotScreenUrl);
  const screenMaterial = new THREE.MeshStandardMaterial({ map: screen, emissive: 0xffffff, emissiveMap: screen, emissiveIntensity: 0.9, roughness: 0.3 });
  const black = materials.gameBlack;
  cabinet.add(block("Plinth", 2.2, 0, 0.35, 1.0, black));
  cabinet.add(block("Band", 2.1, 0.35, 0.4, 0.92, materials.gameGold));
  // Box material order: +x, -x, +y, -y, +z (the front), -z.
  cabinet.add(block("Body", 2.0, 0.4, 3.5, 0.8, [black, black, black, black, screenMaterial, black]));
  cabinet.add(block("Cap", 2.06, 3.5, 3.58, 0.86, materials.gameGold));
  return cabinet;
}

// Canvas plaque text: the name of the tower.
function createPlaqueTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2d canvas is unavailable");
  }
  ctx.fillStyle = "#c9ced6";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#5c616a";
  ctx.lineWidth = 10;
  ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);
  ctx.fillStyle = "#1e2228";
  ctx.font = "bold 64px Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("THE TOWER of JOKER'S SNOW", canvas.width / 2, canvas.height / 2 + 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Shape of a chevron (an upside-down V) of `width`, `height` and stroke `stroke`, tip up.
function chevronShape(width: number, height: number, stroke: number): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(0, height);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2 - stroke, 0);
  shape.lineTo(0, height - stroke * 1.6);
  shape.lineTo(-width / 2 + stroke, 0);
  shape.closePath();
  return shape;
}

// Pentagon outline of circumradius `radius` with a stroke.
function pentagonShape(radius: number, stroke: number): THREE.Shape {
  const corners = (r: number) => Array.from({ length: 5 }, (_, i) => {
    const angle = Math.PI / 2 + (i * Math.PI * 2) / 5;
    return new THREE.Vector2(Math.cos(angle) * r, Math.sin(angle) * r);
  });
  const shape = new THREE.Shape(corners(radius));
  shape.holes.push(new THREE.Path(corners(radius - stroke).reverse()));
  return shape;
}

// The Tower (Bonus Dice): a black plinth with a plaque, and on it a clear acrylic case of two chambers built from plates.
// Pegs, chevrons and pentagons span the case from the inner face of the back plate to the inner face of the front one.
// Two chutes stand on the top plate. The case edges glow.
function createTower(materials: GameMaterials): THREE.Group {
  const tower = new THREE.Group();
  const plinthTop = 0.42;
  const mainWidth = 1.3;
  const shaftWidth = 0.5;
  const width = mainWidth + shaftWidth;
  const depth = 0.56;
  const height = 3.7;
  const plate = 0.02;
  const top = plinthTop + height;
  const inner = depth - plate * 2;
  const left = -width / 2;
  const glass = materials.gameAcrylic;

  tower.add(block("Plinth", width + 0.3, 0, plinthTop, depth + 0.4, materials.gameBlack));
  const plaqueMaterial = new THREE.MeshStandardMaterial({ map: createPlaqueTexture(), metalness: 0.6, roughness: 0.3 });
  // Box material order: +x, -x, +y, -y, +z (the front), -z.
  const chrome = materials.gameChrome;
  tower.add(block("Plaque", 1.0, 0.12, 0.28, 0.02, [chrome, chrome, chrome, chrome, plaqueMaterial, chrome], 0, (depth + 0.4) / 2 + 0.01));

  const plates = named(new THREE.Group(), "Case");
  plates.add(block("Front Plate", width, plinthTop, top, plate, glass, 0, depth / 2 - plate / 2));
  plates.add(block("Back Plate", width, plinthTop, top, plate, glass, 0, -depth / 2 + plate / 2));
  const sideXs = [left + plate / 2, left + mainWidth, -left - plate / 2];
  for (const [index, x] of sideXs.entries()) {
    plates.add(block(["Left Plate", "Divider Plate", "Right Plate"][index] ?? "Plate", plate, plinthTop, top, inner, glass, x));
  }
  plates.add(block("Top Plate", width, top, top + plate, depth, glass));
  // Shelves across the main chamber, between the left plate and the divider.
  const mainInnerLeft = left + plate;
  const mainInnerRight = left + mainWidth - plate / 2;
  const mainCenter = (mainInnerLeft + mainInnerRight) / 2;
  for (const [index, y] of [plinthTop + 1.25, plinthTop + 2.45].entries()) {
    plates.add(block(`Shelf ${index + 1}`, mainInnerRight - mainInnerLeft, y, y + plate, inner, glass, mainCenter));
  }
  tower.add(plates);

  // Pegs: rods across the depth of the case, in the lower main chamber and all up the shaft.
  const pegGeometry = new THREE.CylinderGeometry(0.022, 0.022, inner, 12);
  pegGeometry.rotateX(Math.PI / 2);
  const pegPositions: [number, number][] = [];
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 5; col++) {
      const offset = row % 2 === 0 ? 0 : 0.11;
      pegPositions.push([mainInnerLeft + 0.2 + col * 0.22 + offset, plinthTop + 0.25 + row * 0.17]);
    }
  }
  const shaftLeft = left + mainWidth + plate / 2;
  const shaftRight = -left - plate;
  // The shaft alternates rows of two pegs and rows of one peg in the middle.
  for (let row = 0; row < 18; row++) {
    const xs = row % 2 === 0 ? [0.12, 0.32] : [0.22];
    for (const x of xs) {
      pegPositions.push([shaftLeft + x, plinthTop + 0.2 + row * 0.19]);
    }
  }
  const pegs = new THREE.InstancedMesh(pegGeometry, materials.gamePeg, pegPositions.length);
  const matrix = new THREE.Matrix4();
  pegPositions.forEach(([x, y], i) => {
    matrix.makeTranslation(x, y, 0);
    pegs.setMatrixAt(i, matrix);
  });
  tower.add(named(pegs, "Pegs"));

  // Chevrons and pentagons in the upper main chamber.
  const deflectors = named(new THREE.Group(), "Deflectors");
  const extrudeAcross = (shape: THREE.Shape) => {
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: inner, bevelEnabled: false });
    geometry.translate(0, 0, -inner / 2);
    return geometry;
  };
  const chevron = extrudeAcross(chevronShape(0.26, 0.13, 0.03));
  // Chevrons above the upper shelf, pentagons between the shelves.
  for (const [x, y] of [[-0.35, 3.7], [0, 3.7], [0.35, 3.7], [-0.17, 3.3], [0.17, 3.3]] as const) {
    deflectors.add(part("Chevron", chevron, materials.gamePeg, mainCenter + x, y, 0));
  }
  const pentagon = extrudeAcross(pentagonShape(0.14, 0.03));
  for (const [x, y] of [[-0.35, 2.5], [0, 2.5], [0.35, 2.5], [-0.17, 2.15], [0.17, 2.15]] as const) {
    deflectors.add(part("Pentagon", pentagon, materials.gamePeg, mainCenter + x, y, 0));
  }
  tower.add(deflectors);

  // Chutes: open-top trays, drawn as clear trapezoid prisms standing on the top plate.
  const chuteShape = (bottomWidth: number, topWidth: number, h: number) => {
    const shape = new THREE.Shape();
    shape.moveTo(-bottomWidth / 2, 0);
    shape.lineTo(bottomWidth / 2, 0);
    shape.lineTo(topWidth / 2, h);
    shape.lineTo(-topWidth / 2, h);
    shape.closePath();
    return shape;
  };
  const chuteTop = top + plate;
  for (const [index, spec] of [
    { x: mainCenter, bottom: 0.7, top: 1.15 },
    { x: (shaftLeft + shaftRight) / 2, bottom: 0.36, top: 0.48 },
  ].entries()) {
    const geometry = new THREE.ExtrudeGeometry(chuteShape(spec.bottom, spec.top, 0.24), { depth, bevelEnabled: false });
    geometry.translate(0, 0, -depth / 2);
    tower.add(part(`Chute ${index + 1}`, geometry, glass, spec.x, chuteTop, 0));
  }

  // Lit edges: glowing lines along the edges of the case.
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(width, height + plate, depth)),
    new THREE.LineBasicMaterial({ color: glow(0xdfefff, 3) }),
  );
  edges.position.y = plinthTop + (height + plate) / 2;
  tower.add(edges);
  return tower;
}

function createGameProps(materials: GameMaterials) {
  const group = named(new THREE.Group(), "Game Props", true);

  const show = named(createJesterWheel(materials), "Bonus Show");
  show.position.copy(polar(THREE.MathUtils.degToRad(53), 12.2));
  faceCamera(show);
  group.add(show);

  const dice = named(createTower(materials), "Bonus Dice");
  dice.position.set(8.8, 0, 1.6);
  // The tower turns its front to the studio centre.
  dice.rotation.y = Math.atan2(-dice.position.x, -dice.position.z);
  group.add(dice);

  // On the left of the wheel, mirroring Bonus Dice.
  const luck = named(createSlotCabinet(materials), "Bonus Luck");
  luck.position.set(-6.2, 0, -0.2);
  luck.rotation.y = Math.atan2(-luck.position.x, -luck.position.z);
  group.add(luck);

  return group;
}

export { createGameMaterials, createGameProps };
export type { GameMaterials };
