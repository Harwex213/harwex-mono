import * as THREE from "three";
import type { ComponentData } from "../engine/sceneFormat";
import { Batch, GLOW, archBand, archOpening, at, candelabrum, chandelier, cuboid, drape, drum, palm, person, planFace, planPrism, ring, rgb, slotMachine, spandrel, statue } from "./casinoKit";
import type { GlowKind, Rgb } from "./casinoKit";

// The body components of the casino hall round the Game Show balcony. Every column, arch, drape, window, lamp, table,
// slot machine, palm and guest is an object in the scene file, under `Casino`, with one of these components.
// A component builds the geometry of its object in the local frame of the object: one mesh with a draw group
// per material. Lit pieces carry a vertex tint (`color`); emitters carry their HDR colour, kind and phase
// (`aColor`, `aFx`) for the glow material. Every colour and phase comes from the component data.
//
// The hall frame is the frame of the `Casino` object: u (x) runs along the nave, v (z) across it, y is world y.
// The folders `Architecture`, `Gaming Floor` and `Bar` carry a `staticBatch` component: it merges the meshes per
// material, so the whole hall draws in 23 calls. Virtual lamps (`virtualLamp`, `virtualLine` in components.ts)
// light the hall in the shader of the casino materials (casinoShading.ts).

type Build = (batch: Batch, data: ComponentData) => void;

const GOLD = "casinoGold";
const MARBLE = "casinoMarble";
const GLOW_MATERIAL = "casinoGlow";
const DARK = "casinoDark";
const VELVET = "casinoVelvet";

const v = (values: unknown) => values as Rgb;
const n = (value: unknown) => value as number;
const kindOf = (name: unknown) => GLOW[name as GlowKind];

// [material, x0, x1, y0, y1, z0, z1] with an optional tint [.., r, g, b], or for an emitter [.., r, g, b, kind, phase].
type BoxItem = [string, number, number, number, number, number, number, ...unknown[]];

const casinoBoxes: Build = (batch, data) => {
  for (const item of data.boxes as BoxItem[]) {
    const [material, x0, x1, y0, y1, z0, z1, r, g, b, kind, phase] = item;
    const geometry = cuboid(x0, x1, y0, y1, z0, z1);
    if (kind !== undefined) {
      batch.glow(material, geometry, new THREE.Color(n(r), n(g), n(b)), kindOf(kind), n(phase));
    } else if (r !== undefined) {
      batch.add(material, geometry, new THREE.Color(n(r), n(g), n(b)));
    } else {
      batch.add(material, geometry);
    }
  }
};

const plan = (data: ComponentData) => (data.plan as [number, number][]).map(([x, y]) => new THREE.Vector2(x, y));

// A flat polygon of (u, v) points at the height of the object, facing up or down.
const casinoPlanFace: Build = (batch, data) => {
  batch.add(data.material as string, planFace(plan(data), 0, Boolean(data.up)));
};

// An upright prism over a polygon of (u, v) points, `height` tall.
const casinoPlanPrism: Build = (batch, data) => {
  batch.add(data.material as string, planPrism(plan(data), 0, n(data.height)));
};

// The barrel vault of the nave: an elliptic arch of `half` width and `rise` over the full `length` along x.
const casinoVault: Build = (batch, data) => {
  const length = n(data.length);
  const half = n(data.half);
  const rise = n(data.rise);
  const segmentsU = n(data.segmentsU);
  const segmentsA = n(data.segmentsA);
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= segmentsU; i++) {
    const u = (length * i) / segmentsU;
    for (let j = 0; j <= segmentsA; j++) {
      const angle = (Math.PI * j) / segmentsA;
      positions.push(u, rise * Math.sin(angle), half * Math.cos(angle));
      uvs.push(i / segmentsU, j / segmentsA);
    }
  }
  const row = segmentsA + 1;
  for (let i = 0; i < segmentsU; i++) {
    for (let j = 0; j < segmentsA; j++) {
      const a = i * row + j;
      const b = (i + 1) * row + j;
      index.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const vault = new THREE.BufferGeometry();
  vault.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  vault.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  vault.setIndex(index);
  vault.computeVertexNormals();
  // The normal at the crown must point down into the nave; otherwise turn the winding round.
  if (vault.getAttribute("normal").getY(Math.floor(segmentsA / 2)) > 0) {
    const flipped: number[] = [];
    for (let i = 0; i < index.length; i += 3) {
      flipped.push(index[i]!, index[i + 2]!, index[i + 1]!);
    }
    vault.setIndex(flipped);
    vault.computeVertexNormals();
  }
  batch.add("casinoVault", vault);
};

// A band along an elliptic arch: the inner edge on the arch from `left` to `right`, springing at y = 0.
const casinoArchBand: Build = (batch, data) => {
  batch.add(data.material as string, archBand(n(data.left), n(data.right), 0, n(data.rise), n(data.width), n(data.depth)));
};

// A flat face in the shape of an arch opening: `width` wide, upright sides `height` tall, then a half ellipse of `rise`.
const casinoArchFace: Build = (batch, data) => {
  const half = n(data.width) / 2;
  batch.add(data.material as string, archOpening(-half, half, 0, n(data.height), n(data.rise)));
};

// An arch between two columns: the marble panel over the opening (from z = 0 back to `depth`) and the gold band
// along the opening in front of it. The opening is `width` wide and springs at y = 0.
const casinoArch: Build = (batch, data) => {
  const half = n(data.width) / 2;
  const rise = n(data.rise);
  const band = data.band as [number, number];
  batch.add(MARBLE, spandrel(-half, half, 0, rise, n(data.top), n(data.depth)));
  batch.add(GOLD, archBand(-half, half, 0, rise, band[0], band[1]).translate(0, 0, -band[1]));
};

// A velvet drape that hangs from its top edge (y = 0) and is tied back to one side.
const casinoDrape: Build = (batch, data) => {
  const geometry = drape(n(data.width), n(data.height), n(data.tie), data.side as -1 | 1, n(data.folds), n(data.columns), n(data.rows));
  batch.add(VELVET, geometry, rgb(v(data.color)));
};

// A nave column on the casino floor (y = 0): marble plinth, base drum and shaft with gold bands, a fan of gold fins
// up into the flared gold capital, and the marble abacus. Its candelabra are child objects.
const casinoColumn: Build = (batch, data) => {
  const radius = n(data.radius);
  const plinth = n(data.plinth);
  const plinthTop = n(data.plinthTop);
  const drumTop = n(data.drumTop);
  const capitalBottom = n(data.capitalBottom);
  const capitalTop = n(data.capitalTop);
  const top = n(data.top);
  batch.add(MARBLE, cuboid(-plinth, plinth, 0, plinthTop, -plinth, plinth));
  batch.add(GOLD, cuboid(-plinth - 0.05, plinth + 0.05, plinthTop - 0.14, plinthTop, -plinth - 0.05, plinth + 0.05));
  batch.add(GOLD, cuboid(-plinth - 0.05, plinth + 0.05, 0, 0.18, -plinth - 0.05, plinth + 0.05));
  batch.add(MARBLE, drum(radius * 1.22, radius * 1.3, plinthTop, drumTop, 28));
  batch.add(GOLD, ring(radius * 1.27, 0.08, plinthTop + 0.12, 36));
  batch.add(GOLD, ring(radius * 1.2, 0.07, drumTop - 0.06, 36));
  batch.add(MARBLE, drum(radius, radius, drumTop, capitalBottom, 28));
  for (const y of data.bands as number[]) {
    batch.add(GOLD, ring(radius + 0.02, 0.07, y, 36));
  }
  const fins = n(data.fins);
  const fin = cuboid(-0.03, 0.03, 0, 2.5, -0.03, 0.03);
  for (let i = 0; i < fins; i++) {
    const angle = (i / fins) * Math.PI * 2;
    batch.add(GOLD, at(fin, Math.cos(angle) * (radius + 0.01), capitalBottom - 2.6, Math.sin(angle) * (radius + 0.01), -angle, 1, 0, 0));
  }
  batch.add(GOLD, drum(radius * 1.35, radius, capitalBottom, capitalTop, 28));
  batch.add(GOLD, ring(radius * 1.35, 0.09, capitalTop, 36));
  batch.add(MARBLE, cuboid(-1.65, 1.65, capitalTop, top, -1.65, 1.65));
  batch.add(GOLD, cuboid(-1.7, 1.7, top - 0.1, top, -1.7, 1.7));
};

// A candelabrum on a wall or a column: the wall face at z = 0, it stands out along +z. One candle per flame phase.
const casinoCandelabrum: Build = (batch, data) => {
  candelabrum(batch, GOLD, GLOW_MATERIAL, n(data.size), data.phases as number[], { candle: v(data.candle), flame: v(data.flame) });
};

// The balustrade along the front of a gallery: x runs along it from 0 to `length`, y = 0 is the gallery floor,
// z = 0 is the gallery front and `side` the sign of z towards the gallery. Fascia mouldings under the floor,
// a marble plinth, `balusters` gold balusters `spacing` apart and a gold rail.
const casinoBalustrade: Build = (batch, data) => {
  const length = n(data.length);
  const side = n(data.side);
  const slab = n(data.slab);
  const railTop = n(data.railTop);
  const box = (y0: number, y1: number, d0: number, d1: number) => cuboid(0, length, y0, y1, Math.min(side * d0, side * d1), Math.max(side * d0, side * d1));
  batch.add(GOLD, box(-0.12, 0, -0.06, 0));
  batch.add(GOLD, box(-slab, -slab + 0.1, -0.06, 0));
  batch.add(MARBLE, box(0, 0.2, 0, 0.36));
  batch.add(GOLD, box(railTop - 0.1, railTop, 0.02, 0.34));
  const baluster = drum(0.035, 0.045, 0.2, railTop - 0.1, 6, true);
  const spacing = n(data.spacing);
  for (let i = 1; i <= n(data.balusters); i++) {
    batch.add(GOLD, at(baluster, i * spacing, 0, side * 0.18));
  }
};

// A lamp on the fascia of a gallery: a gold bracket under the floor (y = 0) and a glowing shade on the nave side.
const casinoFasciaLamp: Build = (batch, data) => {
  const side = n(data.side);
  batch.add(GOLD, cuboid(-0.05, 0.05, -0.75, -0.3, Math.min(-side * 0.25, 0), Math.max(-side * 0.25, 0)));
  batch.glow(GLOW_MATERIAL, at(drum(0.12, 0.16, 0, 0.28, 10), 0, -0.62, -side * 0.28), rgb(v(data.color)), GLOW.flame, n(data.phase));
};

// A gold statue on a marble pedestal.
const casinoStatue: Build = (batch, data) => {
  statue(batch, GOLD, MARBLE, n(data.height));
};

// A tall night window in a wall: the wall face at z = 0, the window faces +z, its sill line at y = 0.
// The glass is an emitter (kind window); a gold frame, an optional sill, mullions and transoms.
const casinoWindow: Build = (batch, data) => {
  const width = n(data.width);
  const half = width / 2;
  const height = n(data.height);
  const rise = n(data.rise);
  const [frameWidth, frameDepth] = data.frame as [number, number];
  batch.glow(GLOW_MATERIAL, archOpening(-half, half, 0, height, rise), rgb(v(data.color)), GLOW.window, n(data.phase));
  batch.add(GOLD, archBand(-half, half, height, rise, frameWidth, frameDepth));
  batch.add(GOLD, cuboid(-half - frameWidth, -half, 0, height, 0, frameDepth));
  batch.add(GOLD, cuboid(half, half + frameWidth, 0, height, 0, frameDepth));
  if (data.sill) {
    const [overhang, sillHeight, sillDepth] = data.sill as [number, number, number];
    batch.add(GOLD, cuboid(-half - overhang, half + overhang, -sillHeight, 0, 0, sillDepth));
  }
  const [mullionHalf, mullionDepth] = data.mullion as [number, number];
  for (const x of data.mullions as number[]) {
    batch.add(GOLD, cuboid(x - mullionHalf, x + mullionHalf, 0, height + rise, 0, mullionDepth));
  }
  const [transomHalf, transomDepth] = data.transom as [number, number];
  for (const y of data.transoms as number[]) {
    batch.add(GOLD, cuboid(-half, half, y - transomHalf, y + transomHalf, 0, transomDepth));
  }
};

// A lantern on a marble post beside the aisle, standing on the floor (y = 0).
const casinoLantern: Build = (batch, data) => {
  batch.add(MARBLE, cuboid(-0.28, 0.28, 0, 1.0, -0.28, 0.28));
  batch.add(GOLD, cuboid(-0.32, 0.32, 1.0, 1.08, -0.32, 0.32));
  batch.add(GOLD, at(drum(0.05, 0.07, 0, 1.2, 8), 0, 1.08, 0));
  batch.add(GOLD, at(drum(0.2, 0.14, 0, 0.1, 8), 0, 2.25, 0));
  batch.glow(GLOW_MATERIAL, at(drum(0.15, 0.15, 0, 0.5, 8), 0, 2.35, 0), rgb(v(data.color)), GLOW.flame, n(data.phase));
  batch.add(GOLD, at(drum(0.03, 0.22, 0, 0.18, 8), 0, 2.85, 0));
};

// A round gaming table with a lamp on a pole in the middle.
const casinoTable: Build = (batch, data) => {
  const radius = n(data.radius);
  const top = n(data.top);
  const lamp = n(data.lamp);
  batch.add(DARK, drum(0.4, 0.5, 0, top - 0.08, 12), rgb(v(data.baseColor)));
  batch.add("casinoFelt", drum(radius, radius, top - 0.08, top, 32));
  batch.add(GOLD, ring(radius, 0.06, top - 0.02, 40));
  batch.add(GOLD, drum(0.025, 0.025, top, lamp, 6));
  batch.glow(GLOW_MATERIAL, at(drum(0.2, 0.32, 0, 0.32, 14, true), 0, lamp - 0.1, 0), rgb(v(data.color)), GLOW.flame, n(data.phase));
};

// A velvet chair on a gold base; its back is at -z.
const casinoChair: Build = (batch) => {
  batch.add(VELVET, cuboid(-0.24, 0.24, 0.42, 0.52, -0.24, 0.24));
  batch.add(VELVET, cuboid(-0.24, 0.24, 0.52, 1.0, -0.3, -0.22));
  batch.add(GOLD, cuboid(-0.2, 0.2, 0, 0.42, -0.2, 0.2));
};

// A person in dark clothes: `height` 1.75 for a guest who stands, less for one who sits.
const casinoPerson: Build = (batch, data) => {
  person(batch, DARK, n(data.height), rgb(v(data.color)));
};

// A slot machine facing +z: its screen and topper glow in `tint`.
const casinoSlotMachine: Build = (batch, data) => {
  slotMachine(batch, { dark: DARK, gold: GOLD, glow: GLOW_MATERIAL }, rgb(v(data.tint)), n(data.phase));
};

// A palm in a gold pot.
const casinoPalm: Build = (batch, data) => {
  palm(batch, GOLD, "casinoLeaf", DARK, n(data.height), data.fronds as [number, number][]);
};

// The flower urn on the aisle: a marble pedestal, a gold urn and red flowers at the given points.
const casinoFlowerUrn: Build = (batch, data) => {
  batch.add(MARBLE, cuboid(-0.5, 0.5, 0, 1.1, -0.5, 0.5));
  batch.add(GOLD, at(new THREE.LatheGeometry([new THREE.Vector2(0.15, 0), new THREE.Vector2(0.35, 0.3), new THREE.Vector2(0.55, 0.75), new THREE.Vector2(0.6, 0.85)], 16), 0, 1.1, 0));
  const flower = new THREE.IcosahedronGeometry(0.16, 0);
  const color = rgb(v(data.color));
  for (const [x, y, z] of data.flowers as Rgb[]) {
    batch.add(VELVET, at(flower, x, y, z), color);
  }
};

// The back bar: the shelves picture (an emitter of kind bar) in an arched gold frame. The wall face at z = 0, y = 0 the floor.
const casinoBackBar: Build = (batch, data) => {
  const half = n(data.width) / 2;
  const bottom = n(data.bottom);
  const spring = n(data.spring);
  const rise = n(data.rise);
  const [frameWidth, frameDepth] = data.frame as [number, number];
  batch.glow(GLOW_MATERIAL, archOpening(-half, half, bottom, spring, rise), rgb(v(data.color)), GLOW.bar, n(data.phase));
  batch.add(GOLD, archBand(-half, half, spring, rise, frameWidth, frameDepth));
  batch.add(GOLD, cuboid(-half - frameWidth, -half, 0, spring, 0, frameDepth));
  batch.add(GOLD, cuboid(half, half + frameWidth, 0, spring, 0, frameDepth));
};

// A bar stool: a gold post and a velvet seat.
const casinoBarStool: Build = (batch) => {
  batch.add(GOLD, drum(0.04, 0.04, 0, 0.75, 6));
  batch.add(VELVET, drum(0.22, 0.22, 0.75, 0.85, 12));
};

// A tiered crystal chandelier that hangs `drop` metres under its canopy (y = 0) on a gold chain.
const casinoChandelier: Build = (batch, data) => {
  const diameter = n(data.diameter);
  const drop = n(data.drop);
  batch.within(new THREE.Matrix4().makeTranslation(0, -drop, 0), () => {
    chandelier(batch, GOLD, GLOW_MATERIAL, diameter, n(data.seed), { crystal: v(data.crystal), candle: v(data.candle), flame: v(data.flame) });
  });
  batch.add(GOLD, drum(0.05, 0.05, -drop + diameter * 0.8, 0, 6));
  batch.add(GOLD, drum(0.5, 0.25, -0.35, 0, 16));
};

const BUILDS: Record<string, Build> = {
  casinoBoxes,
  casinoPlanFace,
  casinoPlanPrism,
  casinoVault,
  casinoArchBand,
  casinoArchFace,
  casinoArch,
  casinoDrape,
  casinoColumn,
  casinoCandelabrum,
  casinoBalustrade,
  casinoFasciaLamp,
  casinoStatue,
  casinoWindow,
  casinoLantern,
  casinoTable,
  casinoChair,
  casinoPerson,
  casinoSlotMachine,
  casinoPalm,
  casinoFlowerUrn,
  casinoBackBar,
  casinoBarStool,
  casinoChandelier,
};

// The geometry of a casino body and the material key of each of its draw groups.
function buildCasinoBody(type: string, data: ComponentData): { geometry: THREE.BufferGeometry; materials: string[] } {
  const build = BUILDS[type];
  if (!build) {
    throw new Error(`unknown casino body ${type}`);
  }
  const batch = new Batch();
  build(batch, data);
  const { geometry, keys } = batch.grouped();
  return { geometry, materials: keys };
}

const CASINO_BODIES = Object.keys(BUILDS);

export { CASINO_BODIES, buildCasinoBody };
