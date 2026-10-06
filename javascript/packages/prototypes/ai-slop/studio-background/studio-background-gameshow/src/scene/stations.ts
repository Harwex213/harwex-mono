import * as THREE from "three";
import { canvasTexture, createSlotRow, cuboid, drumGeometry, merged, solid } from "./casino";
import type { CasinoMaterials } from "./casino";
import { createSlotCabinet } from "./gameProps";
import type { GameMaterials } from "./gameProps";
import { named } from "./geometry";
import type { Materials } from "./materials";

// Three bonus game stations in the casino hall, each with its own camera shot (cameraRig.ts):
// - Slot: the "Bonus Deluxe" cabinet between two short slot rows, under a lit sign, in the left wing;
// - Dice: a sic bo table with a dice shaker, oversized dice and a result board, in the right wing;
// - Game Show: a stage with a money wheel, a host podium and three contestant podiums, in front of the
//   backdrop wall, so the Game Show shot sees the casino backdrop behind it.
//
// Each station is built in its own frame: the origin on the floor at the station centre, local +z towards its camera.
type StationId = "slot" | "dice" | "gameshow";

const STATIONS: Record<StationId, { center: THREE.Vector3; rotationY: number }> = {
  slot: { center: new THREE.Vector3(-28, 0, 23), rotationY: Math.PI / 2 },
  dice: { center: new THREE.Vector3(28, 0, 23), rotationY: -Math.PI / 2 },
  gameshow: { center: new THREE.Vector3(0, 0, 30.5), rotationY: Math.PI },
};

// A point in a station frame, in world space.
function stationPoint(id: StationId, x: number, y: number, z: number): THREE.Vector3 {
  const station = STATIONS[id];
  return new THREE.Vector3(x, y, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), station.rotationY).add(station.center);
}

function glowTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.MeshStandardMaterial {
  const texture = canvasTexture(width, height, draw);
  return new THREE.MeshStandardMaterial({ map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 1.2, roughness: 0.35 });
}

// A row of bulbs around the edge of a sign canvas.
function bulbBorder(ctx: CanvasRenderingContext2D, width: number, height: number, step: number): void {
  ctx.fillStyle = "#fff2c4";
  for (let x = step / 2; x < width; x += step) {
    for (const y of [step / 2, height - step / 2]) {
      ctx.beginPath();
      ctx.arc(x, y, step * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (let y = step * 1.5; y < height - step; y += step) {
    for (const x of [step / 2, width - step / 2]) {
      ctx.beginPath();
      ctx.arc(x, y, step * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function signText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string): void {
  ctx.font = `bold ${size}px Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillText(text, x + size * 0.04, y + size * 0.05);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

// Die face: gold pips on red.
function dieFace(value: number): THREE.MeshStandardMaterial {
  const texture = canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = "#a50e1a";
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = "#e8b75a";
    ctx.lineWidth = 6;
    ctx.strokeRect(5, 5, 118, 118);
    const pips: Record<number, [number, number][]> = {
      1: [[64, 64]],
      2: [[36, 36], [92, 92]],
      3: [[34, 34], [64, 64], [94, 94]],
      4: [[36, 36], [92, 36], [36, 92], [92, 92]],
      5: [[34, 34], [94, 34], [64, 64], [34, 94], [94, 94]],
      6: [[36, 32], [92, 32], [36, 64], [92, 64], [36, 96], [92, 96]],
    };
    ctx.fillStyle = "#f6d27a";
    for (const [x, y] of pips[value] ?? []) {
      ctx.beginPath();
      ctx.arc(x, y, 11, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  return new THREE.MeshStandardMaterial({ map: texture, metalness: 0.1, roughness: 0.25, emissive: 0x300004 });
}

function createStationMaterials() {
  const materials = {
    stationSlotSign: glowTexture(1024, 160, (ctx) => {
      ctx.fillStyle = "#3a0610";
      ctx.fillRect(0, 0, 1024, 160);
      bulbBorder(ctx, 1024, 160, 32);
      signText(ctx, "BONUS DELUXE", 512, 84, 92, "#ffd86a");
    }),
    stationDiceBoard: glowTexture(768, 256, (ctx) => {
      const gradient = ctx.createLinearGradient(0, 0, 0, 256);
      gradient.addColorStop(0, "#14082e");
      gradient.addColorStop(1, "#3a0614");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 768, 256);
      bulbBorder(ctx, 768, 256, 28);
      signText(ctx, "DICE BONUS", 384, 82, 76, "#ffd86a");
      const cells = ["x2", "x5", "x10", "x50", "x150"];
      cells.forEach((label, i) => {
        const x = 104 + i * 140;
        ctx.fillStyle = i === 3 ? "#c8101e" : "#20123e";
        ctx.fillRect(x - 58, 140, 116, 70);
        ctx.strokeStyle = "#e8b75a";
        ctx.lineWidth = 4;
        ctx.strokeRect(x - 58, 140, 116, 70);
        signText(ctx, label, x, 177, 42, "#fff2d0");
      });
    }),
    stationSicBoFelt: (() => {
      const texture = canvasTexture(512, 256, (ctx) => {
        ctx.fillStyle = "#6a0a14";
        ctx.fillRect(0, 0, 512, 256);
        ctx.strokeStyle = "#e0b060";
        ctx.lineWidth = 3;
        for (let i = 0; i < 6; i++) {
          ctx.strokeRect(20 + i * 79, 150, 74, 80);
        }
        ctx.strokeRect(20, 24, 230, 110);
        ctx.strokeRect(262, 24, 230, 110);
        signText(ctx, "SMALL", 135, 80, 44, "#f2d080");
        signText(ctx, "BIG", 377, 80, 44, "#f2d080");
      });
      return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85 });
    })(),
    stationMarquee: glowTexture(1024, 64, (ctx) => {
      ctx.fillStyle = "#14060a";
      ctx.fillRect(0, 0, 1024, 64);
      ctx.fillStyle = "#ffe2a0";
      for (let x = 12; x < 1024; x += 24) {
        ctx.beginPath();
        ctx.arc(x, 8, 4, 0, Math.PI * 2);
        ctx.arc(x, 56, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      signText(ctx, "★  GAME  SHOW  ★", 512, 33, 34, "#ffd86a");
    }),
    stationHostPanel: glowTexture(256, 160, (ctx) => {
      ctx.fillStyle = "#2a0a3a";
      ctx.fillRect(0, 0, 256, 160);
      bulbBorder(ctx, 256, 160, 20);
      signText(ctx, "HOST", 128, 82, 52, "#ffd86a");
    }),
    stationWheelFace: (() => {
      const texture = canvasTexture(512, 512, (ctx) => {
        const colors = ["#b3121f", "#e6c068", "#1f3fa8", "#e6c068", "#1a8a3a", "#e6c068", "#6a1fa0", "#e6c068"];
        const labels = ["10", "2", "50", "5", "25", "2", "500", "5", "10", "2", "100", "5", "25", "2", "50", "5"];
        const count = labels.length;
        ctx.translate(256, 256);
        for (let i = 0; i < count; i++) {
          ctx.fillStyle = colors[i % colors.length] ?? "#b3121f";
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, 256, (i / count) * Math.PI * 2, ((i + 1) / count) * Math.PI * 2);
          ctx.closePath();
          ctx.fill();
          ctx.save();
          ctx.rotate(((i + 0.5) / count) * Math.PI * 2);
          ctx.fillStyle = i % 2 === 0 ? "#fff4dc" : "#3a1a08";
          ctx.font = "bold 40px Georgia, serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(labels[i] ?? "", 190, 0);
          ctx.restore();
        }
        ctx.fillStyle = "#14060a";
        ctx.beginPath();
        ctx.arc(0, 0, 70, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#f2c46a";
        ctx.lineWidth = 8;
        ctx.stroke();
        ctx.fillStyle = "#f2c46a";
        ctx.font = "bold 30px Georgia, serif";
        ctx.textAlign = "center";
        ctx.fillText("BONUS", 0, 2);
      });
      return new THREE.MeshStandardMaterial({ map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.35, roughness: 0.4 });
    })(),
    stationPodium1: glowTexture(128, 128, (ctx) => {
      ctx.fillStyle = "#1a2a7a";
      ctx.fillRect(0, 0, 128, 128);
      signText(ctx, "1", 64, 68, 80, "#ffd86a");
    }),
    stationPodium2: glowTexture(128, 128, (ctx) => {
      ctx.fillStyle = "#1a2a7a";
      ctx.fillRect(0, 0, 128, 128);
      signText(ctx, "2", 64, 68, 80, "#ffd86a");
    }),
    stationPodium3: glowTexture(128, 128, (ctx) => {
      ctx.fillStyle = "#1a2a7a";
      ctx.fillRect(0, 0, 128, 128);
      signText(ctx, "3", 64, 68, 80, "#ffd86a");
    }),
    stationBuzzer: new THREE.MeshStandardMaterial({ color: 0xe0202c, emissive: 0xc00010, emissiveIntensity: 1.4, roughness: 0.2 }),
    stationDie1: dieFace(1),
    stationDie2: dieFace(2),
    stationDie3: dieFace(3),
    stationDie4: dieFace(4),
    stationDie5: dieFace(5),
    stationDie6: dieFace(6),
  };
  for (const [name, material] of Object.entries(materials)) {
    material.name = name;
  }
  return materials;
}

type StationMaterials = ReturnType<typeof createStationMaterials>;

// Box material order: +x, -x, +y, -y, +z (the front), -z.
function frontFaced(side: THREE.Material, front: THREE.Material): THREE.Material[] {
  return [side, side, side, side, front, side];
}

// Round dais: a gold rim ring under a wooden top.
function createDais(radius: number, materials: Materials, casino: CasinoMaterials): THREE.Group {
  const dais = named(new THREE.Group(), "Dais");
  dais.add(solid("Rim", drumGeometry(radius + 0.1, radius + 0.1, 0, 0.06, 0, 0, 96), materials.goldPolished));
  dais.add(solid("Top", drumGeometry(radius, radius, 0.06, 0.2, 0, 0, 96), casino.casinoWood));
  return dais;
}

// Bar stool: a foot disc, a gold pole and a velvet seat.
function createStool(materials: Materials, bottom: number): THREE.Group {
  const stool = new THREE.Group();
  stool.add(solid("Foot", drumGeometry(0.25, 0.25, bottom, bottom + 0.04, 0, 0, 24), materials.goldDark));
  stool.add(solid("Pole", drumGeometry(0.04, 0.04, bottom + 0.04, bottom + 0.74, 0, 0, 12), materials.gold));
  stool.add(solid("Seat", drumGeometry(0.26, 0.26, bottom + 0.74, bottom + 0.84, 0, 0, 24), materials.velvet));
  return stool;
}

// A board on two square posts. The board spans between the inner faces of the posts; a gold header bar
// can rest on the post tops.
function createSignBoard(name: string, halfWidth: number, bottom: number, boardBottom: number, boardTop: number, postTop: number, z: number, face: THREE.Material, materials: Materials, casino: CasinoMaterials): THREE.Group {
  const board = named(new THREE.Group(), name);
  const post = 0.18;
  const depth = 0.16;
  const posts = [-1, 1].map((side) => cuboid(side * halfWidth - (side < 0 ? post : 0), side * halfWidth + (side > 0 ? post : 0), bottom, postTop, z - post / 2, z + post / 2));
  board.add(merged("Posts", posts, materials.goldDark));
  board.add(solid("Board", cuboid(-halfWidth, halfWidth, boardBottom, boardTop, z - depth / 2, z + depth / 2), casino.casinoBlack));
  // The lit face is a thin plate on the front of the board.
  const plate = new THREE.Mesh(cuboid(-halfWidth + 0.08, halfWidth - 0.08, boardBottom + 0.08, boardTop - 0.08, z + depth / 2, z + depth / 2 + 0.01), frontFaced(casino.casinoBlack, face));
  board.add(named(plate, "Face"));
  board.add(solid("Header", cuboid(-halfWidth - post - 0.06, halfWidth + post + 0.06, postTop, postTop + 0.22, z - post / 2 - 0.04, z + post / 2 + 0.04), materials.goldPolished));
  return board;
}

// A spot from the hall ceiling onto the station, in the station frame.
function addKeyLight(station: THREE.Group, from: THREE.Vector3, to: THREE.Vector3, intensity: number, angle: number): void {
  const light = named(new THREE.SpotLight(0xffe0b8, intensity, 0, THREE.MathUtils.degToRad(angle), 0.6, 2), "Key Light");
  light.position.copy(from);
  named(light.target, "Key Light Target");
  light.target.position.copy(to);
  station.add(light, light.target);
}

function placeStation(station: THREE.Group, id: StationId): void {
  station.position.copy(STATIONS[id].center);
  station.rotation.y = STATIONS[id].rotationY;
}

function createSlotStation(materials: Materials, casino: CasinoMaterials, game: GameMaterials, own: StationMaterials): THREE.Group {
  const station = named(new THREE.Group(), "Slot", true);
  const top = 0.2;
  station.add(createDais(4, materials, casino));
  const cabinet = named(createSlotCabinet(game), "Slot Cabinet");
  cabinet.position.y = top;
  station.add(cabinet);
  // Short rows of two machines on both sides of the cabinet plinth.
  for (const side of [-1, 1]) {
    const row = named(createSlotRow(2, casino), side < 0 ? "Slot Pair Left" : "Slot Pair Right");
    row.position.set(side * (1.1 + 0.05 + 0.84), top, -0.2);
    station.add(row);
  }
  const stool = named(createStool(materials, top), "Stool");
  stool.position.z = 1.3;
  station.add(stool);
  station.add(createSignBoard("Sign", 3.25, top, 4.4, 5.5, 5.5, -1.1, own.stationSlotSign, materials, casino));
  addKeyLight(station, new THREE.Vector3(0, 9.4, 5), new THREE.Vector3(0, 1.6, 0), 520, 28);
  placeStation(station, "slot");
  return station;
}

function createDie(size: number, own: StationMaterials): THREE.Mesh {
  const faces = [own.stationDie1, own.stationDie6, own.stationDie2, own.stationDie5, own.stationDie3, own.stationDie4];
  const geometry = new THREE.BoxGeometry(size, size, size);
  geometry.translate(0, size / 2, 0);
  const die = new THREE.Mesh(geometry, faces);
  die.castShadow = true;
  die.receiveShadow = true;
  return die;
}

function createDiceStation(materials: Materials, casino: CasinoMaterials, own: StationMaterials): THREE.Group {
  const station = named(new THREE.Group(), "Dice", true);
  const top = 0.2;
  station.add(createDais(4.2, materials, casino));

  // Sic bo table: a wooden pedestal and top, a printed felt inside a gold rail.
  const table = named(new THREE.Group(), "Sic Bo Table");
  table.add(merged("Body", [cuboid(-1.3, 1.3, top, 0.95, -0.6, 0.6), cuboid(-1.7, 1.7, 0.95, 1.07, -0.95, 0.95)], casino.casinoWood));
  table.add(solid("Felt", cuboid(-1.55, 1.55, 1.07, 1.09, -0.8, 0.8), [casino.casinoFelt, casino.casinoFelt, own.stationSicBoFelt, casino.casinoFelt, casino.casinoFelt, casino.casinoFelt]));
  table.add(merged("Rail", [
    cuboid(-1.7, 1.7, 1.07, 1.15, 0.8, 0.95),
    cuboid(-1.7, 1.7, 1.07, 1.15, -0.95, -0.8),
    cuboid(-1.7, -1.55, 1.07, 1.15, -0.8, 0.8),
    cuboid(1.55, 1.7, 1.07, 1.15, -0.8, 0.8),
  ], materials.goldPolished));
  // The shaker: a gold plate on the felt under a clear dome, three dice inside.
  const shaker = named(new THREE.Group(), "Shaker");
  shaker.add(solid("Plate", drumGeometry(0.4, 0.42, 1.09, 1.14, 0, 0, 48), materials.goldPolished));
  const domeGeometry = new THREE.SphereGeometry(0.36, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  domeGeometry.translate(0, 1.14, 0);
  const dome = new THREE.Mesh(domeGeometry, new THREE.MeshPhysicalMaterial({ color: 0xe8f2ff, roughness: 0.05, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
  dome.material.name = "stationDome";
  shaker.add(named(dome, "Dome"));
  for (const [index, [x, z, turn]] of ([[-0.1, 0.06, 0.3], [0.11, 0.08, -0.5], [0.0, -0.12, 0.9]] as const).entries()) {
    const die = named(createDie(0.13, own), `Small Die ${index + 1}`);
    die.position.set(x, 1.14, z);
    die.rotation.y = turn;
    shaker.add(die);
  }
  table.add(shaker);
  station.add(table);

  // Oversized dice on the dais: one beside the table on the right, a stack of two on the left.
  // The top die of the stack is smaller and turned only a little, so its corners stay on the die under it.
  const big = 0.9;
  const dice = named(new THREE.Group(), "Big Dice");
  const placements: [string, number, number, number, number, number][] = [
    ["Big Die Right", big, 2.75, top, 0.55, 0.35],
    ["Big Die Left", big, -2.75, top, 0.3, -0.2],
    ["Big Die Left Top", 0.7, -2.75, top + big, 0.3, 0.05],
  ];
  for (const [name, size, x, y, z, turn] of placements) {
    const die = named(createDie(size, own), name);
    die.position.set(x, y, z);
    die.rotation.y = turn;
    dice.add(die);
  }
  station.add(dice);

  for (const [index, x] of [-0.8, 0.8].entries()) {
    const stool = named(createStool(materials, top), `Stool ${index + 1}`);
    stool.position.set(x, 0, 1.55);
    station.add(stool);
  }
  station.add(createSignBoard("Result Board", 3.0, top, 3.5, 5.6, 5.6, -2.5, own.stationDiceBoard, materials, casino));
  addKeyLight(station, new THREE.Vector3(0, 9.4, 4.5), new THREE.Vector3(0, 1.2, 0), 520, 30);
  placeStation(station, "dice");
  return station;
}

// Money wheel on a stand: a printed disc in a gold rim with bulbs, a post behind it, a pointer on top.
function createMoneyWheel(materials: Materials, own: StationMaterials): THREE.Group {
  const wheel = named(new THREE.Group(), "Money Wheel");
  const radius = 1.45;
  const thickness = 0.12;
  const centerY = 2.05;
  wheel.add(solid("Base", cuboid(-0.8, 0.8, 0, 0.3, -0.55, 0.45), materials.goldDark));
  wheel.add(solid("Post", cuboid(-0.12, 0.12, 0.3, centerY, -0.34, -thickness / 2), materials.gold));
  const discGeometry = new THREE.CylinderGeometry(radius, radius, thickness, 96);
  discGeometry.rotateX(Math.PI / 2);
  discGeometry.rotateZ(Math.PI / 2);
  discGeometry.translate(0, centerY, 0);
  const disc = new THREE.Mesh(discGeometry, [materials.goldDark, own.stationWheelFace, materials.goldDark]);
  wheel.add(named(disc, "Disc"));
  const rimGeometry = new THREE.TorusGeometry(radius, 0.06, 12, 128);
  rimGeometry.translate(0, centerY, 0);
  const rim = solid("Rim", rimGeometry, materials.goldPolished);
  rim.userData.seated = true;
  wheel.add(rim);
  const count = 24;
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.04, 10, 8), materials.bulb, count);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    matrix.makeTranslation(Math.cos(angle) * radius, centerY + Math.sin(angle) * radius, 0.06);
    bulbs.setMatrixAt(i, matrix);
  }
  const bulbMesh = named(bulbs, "Bulbs");
  bulbMesh.userData.seated = true;
  wheel.add(bulbMesh);
  // Pointer: a flat triangle with the tip down, the tip seated on the rim top.
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0.18, 0.36);
  shape.lineTo(-0.18, 0.36);
  shape.closePath();
  const pointerGeometry = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false });
  pointerGeometry.translate(0, centerY + radius + 0.04, -0.04);
  const pointer = solid("Pointer", pointerGeometry, own.stationBuzzer);
  pointer.userData.seated = true;
  wheel.add(pointer);
  return wheel;
}

function createGameShowStation(materials: Materials, casino: CasinoMaterials, own: StationMaterials): THREE.Group {
  const station = named(new THREE.Group(), "Game Show", true);
  const top = 0.6;
  // Stage: a black block, a gold nosing along the front edge, a lit marquee strip on the front face.
  const stage = named(new THREE.Group(), "Stage");
  stage.add(solid("Block", cuboid(-4.2, 4.2, 0, top, -2.2, 2.2), casino.casinoWood));
  stage.add(solid("Nosing", cuboid(-4.2, 4.2, top, top + 0.04, 2.0, 2.3), materials.goldPolished));
  stage.add(named(new THREE.Mesh(cuboid(-3.9, 3.9, 0.1, 0.5, 2.2, 2.21), frontFaced(casino.casinoWood, own.stationMarquee)), "Marquee"));
  station.add(stage);

  const wheel = createMoneyWheel(materials, own);
  wheel.position.set(0, top, -1.1);
  station.add(wheel);

  // Host podium on the left, as seen from the camera.
  const host = named(new THREE.Group(), "Host Podium");
  host.add(solid("Body", cuboid(-0.6, 0.6, 0, 1.05, -0.35, 0.35), casino.casinoBlack));
  host.add(named(new THREE.Mesh(cuboid(-0.5, 0.5, 0.2, 0.85, 0.35, 0.36), frontFaced(casino.casinoBlack, own.stationHostPanel)), "Panel"));
  host.add(solid("Top", cuboid(-0.7, 0.7, 1.05, 1.11, -0.45, 0.45), materials.goldPolished));
  host.position.set(-2.9, top, 0.7);
  station.add(host);

  // Three contestant podiums on the right, each with a buzzer.
  const panels = [own.stationPodium1, own.stationPodium2, own.stationPodium3];
  for (const [index, panel] of panels.entries()) {
    const podium = named(new THREE.Group(), `Contestant Podium ${index + 1}`);
    podium.add(solid("Body", cuboid(-0.45, 0.45, 0, 0.95, -0.35, 0.35), casino.casinoBlack));
    podium.add(named(new THREE.Mesh(cuboid(-0.36, 0.36, 0.15, 0.8, 0.35, 0.36), frontFaced(casino.casinoBlack, panel)), "Panel"));
    podium.add(solid("Top", cuboid(-0.5, 0.5, 0.95, 1.0, -0.4, 0.4), materials.goldPolished));
    podium.add(solid("Buzzer Base", drumGeometry(0.16, 0.17, 1.0, 1.05, 0, 0, 24), casino.casinoBlack));
    const dome = new THREE.SphereGeometry(0.13, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.translate(0, 1.05, 0);
    podium.add(solid("Buzzer", dome, own.stationBuzzer));
    podium.position.set(1.25 + index * 1.05, top, 0.7);
    station.add(podium);
  }
  addKeyLight(station, new THREE.Vector3(0, 9.4, 6), new THREE.Vector3(0, 1.6, 0), 650, 32);
  placeStation(station, "gameshow");
  return station;
}

function createStations(materials: Materials, casino: CasinoMaterials, game: GameMaterials): THREE.Group {
  const own = createStationMaterials();
  const group = named(new THREE.Group(), "Stations", true);
  group.add(createSlotStation(materials, casino, game, own), createDiceStation(materials, casino, own), createGameShowStation(materials, casino, own));
  return group;
}

export { STATIONS, createStations, stationPoint };
export type { StationId };
