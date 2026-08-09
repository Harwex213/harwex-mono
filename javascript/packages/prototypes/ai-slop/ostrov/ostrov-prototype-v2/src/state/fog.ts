import { config } from "@hw/ostrov-prototype-v2-config";
import { hexToWorld } from "../hex/layout";
import type { Tile } from "../map/island";
import { OWNER_PLAYER } from "../map/island";
import type { WorldMap } from "../map/world";
import { territoryVersion, world } from "./signals";
import { claimedAir } from "./territory";

/**
 * Fog of war: which of the world the player has seen, and how brightly it is
 * allowed to be drawn.
 *
 * Three states, kept as one number per tile rather than as an enum, because the
 * renderer wants a light level and not a branch:
 *
 * - `0` — never seen. The tile is not drawn at all and casts no shadow, so the
 *   area reads as the cloud layer showing through.
 * - `fog.exploredDim` — seen once, not in sight now. The terrain is remembered
 *   and painted flat towards the fog colour, with the live decoration faded out.
 * - `1` — inside the reveal radius right now. Drawn exactly as it always was.
 *
 * Everything between those three is the soft edge and the fade, so no tile ever
 * pops from one state into another.
 *
 * Visibility comes from owned territory: a tile within `fog.revealRadius` of any
 * player-owned tile is visible, and anything ever visible stays explored for
 * good. The field is therefore a function of the owner map alone, and the owner
 * map changes only when a building claims ground — so the whole field is
 * computed once per claim and read from a flat array every frame after that.
 */

/** How many explored discs the cloud layer is told about. */
const MAX_DISCS = 8;

/** Level at or above which a tile counts as fully in sight. */
const VISIBLE_LEVEL = 0.999;

type FogDisc = {
  x: number;
  y: number;
  radius: number;
};

/** The cached field. Everything in it is indexed by `Tile.index`. */
type FogField = {
  source: WorldMap;
  version: number;
  /** Light level each tile is heading for, 0…1. */
  target: Float32Array;
  /** Light level each tile held when this field replaced the previous one. */
  previous: Float32Array;
  /** 1 once the tile has ever been inside the reveal radius. */
  explored: Uint8Array;
  /** 1 while the tile is inside the reveal radius right now. */
  visible: Uint8Array;
  /** Brightest tile level of each island, indexed by island id. */
  islandTarget: Float32Array;
  islandPrevious: Float32Array;
  /** 1 when at least one tile of the island has ever been seen. */
  islandExplored: Uint8Array;
  /** `performance.now()` of the moment this field replaced the previous one. */
  startedAt: number;
  discs: FogDisc[];
};

/**
 * What the renderers read. The arrays are owned by this module and reused every
 * frame; nothing downstream may hold onto them past the frame it drew.
 */
type FogSnapshot = {
  enabled: boolean;
  /** Light level per `Tile.index`. Zero means "do not draw this tile". */
  tile: Float32Array;
  /** Brightest level of each island, for the shadow and the culling flag. */
  island: Float32Array;
  islandExplored: Uint8Array;
  /** False while at least one tile is still on its way to the new state. */
  settled: boolean;
};

/** Uniforms the cloud layer needs to thicken itself over the unknown world. */
type CloudFog = {
  /** Explored discs as (x, y, radius) triples, world space. */
  discs: Float32Array;
  discCount: number;
  /** Width of the soft edge of a disc, in world units. */
  softness: number;
  /** How far the cloud thickens outside the discs. Zero switches it off. */
  density: number;
  edgeInner: number;
  edgeOuter: number;
  edgeDensity: number;
};

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) {
    return value < edge0 ? 0 : 1;
  }
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Smallest disc holding both, or whichever of the two already holds the other. */
function unionDisc(a: FogDisc, b: FogDisc): FogDisc {
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  if (distance + b.radius <= a.radius) {
    return a;
  }
  if (distance + a.radius <= b.radius) {
    return b;
  }
  const radius = (distance + a.radius + b.radius) / 2;
  const t = (radius - a.radius) / distance;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, radius };
}

/**
 * Folds one more explored disc into the list.
 *
 * The list is what the cloud layer clears itself over, so it has to stay short:
 * once it is full the two discs whose union is smallest are merged, which loses
 * a little precision at the rim of the known world and nothing else. The 2D map
 * is the authority on what is actually drawn; this is atmosphere.
 */
function addDisc(discs: FogDisc[], added: FogDisc): void {
  for (const disc of discs) {
    if (Math.hypot(added.x - disc.x, added.y - disc.y) + added.radius <= disc.radius) {
      return;
    }
  }
  const kept = discs.filter((disc) => Math.hypot(added.x - disc.x, added.y - disc.y) + disc.radius > added.radius);
  kept.push(added);
  while (kept.length > MAX_DISCS) {
    let bestLeft = 0;
    let bestRight = 1;
    let bestRadius = Number.POSITIVE_INFINITY;
    for (let left = 0; left < kept.length; left += 1) {
      for (let right = left + 1; right < kept.length; right += 1) {
        const merged = unionDisc(kept[left]!, kept[right]!);
        if (merged.radius < bestRadius) {
          bestRadius = merged.radius;
          bestLeft = left;
          bestRight = right;
        }
      }
    }
    const merged = unionDisc(kept[bestLeft]!, kept[bestRight]!);
    kept.splice(bestRight, 1);
    kept.splice(bestLeft, 1);
    kept.push(merged);
  }
  discs.length = 0;
  discs.push(...kept);
}

/** Every point the reveal radius is measured from: owned land and claimed air. */
function territoryPoints(source: WorldMap): { x: number; y: number; islandId: number }[] {
  const points: { x: number; y: number; islandId: number }[] = [];
  for (const tile of source.tiles) {
    if (tile.owner !== OWNER_PLAYER) {
      continue;
    }
    const centre = hexToWorld(tile);
    points.push({ x: centre.x, y: centre.y, islandId: tile.islandId });
  }
  for (const hex of claimedAir(source)) {
    const centre = hexToWorld(hex);
    points.push({ x: centre.x, y: centre.y, islandId: hex.islandId });
  }
  return points;
}

/**
 * One disc per island the player holds ground on: that island's share of the
 * territory grown by the reveal radius. A holding spans a couple of hundred
 * world units against a reveal radius of well over a thousand, so the bounding
 * disc is a close enough stand-in for the union of the per-point discs. It
 * over-reveals the cloud layer by that span at the corners and nothing else —
 * the 2D map is what decides which land is actually drawn.
 */
function discsOfTerritory(points: readonly { x: number; y: number; islandId: number }[]): FogDisc[] {
  const radius = config.fog.revealRadius + config.fog.softness;
  const perIsland = new Map<number, { x: number; y: number }[]>();
  for (const point of points) {
    const group = perIsland.get(point.islandId) ?? [];
    group.push(point);
    perIsland.set(point.islandId, group);
  }
  const discs: FogDisc[] = [];
  for (const group of perIsland.values()) {
    let sumX = 0;
    let sumY = 0;
    for (const point of group) {
      sumX += point.x;
      sumY += point.y;
    }
    const x = sumX / group.length;
    const y = sumY / group.length;
    let reach = 0;
    for (const point of group) {
      reach = Math.max(reach, Math.hypot(point.x - x, point.y - y));
    }
    discs.push({ x, y, radius: reach + radius });
  }
  return discs;
}

let field: FogField | null = null;

/** Scratch the animated snapshot is written into, so a frame allocates nothing. */
let tileScratch = new Float32Array(0);
let islandScratch = new Float32Array(0);

const cloudFog: CloudFog = {
  discs: new Float32Array(MAX_DISCS * 3),
  discCount: 0,
  softness: 0,
  density: 0,
  edgeInner: 0,
  edgeOuter: 0,
  edgeDensity: 0,
};

const snapshot: FogSnapshot = {
  enabled: true,
  tile: tileScratch,
  island: islandScratch,
  islandExplored: new Uint8Array(0),
  settled: true,
};

/** Every tile lit, every island known: the field a disabled fog hands out. */
function clearField(source: WorldMap, now: number): FogField {
  const tiles = new Float32Array(source.tiles.length).fill(1);
  const islands = new Float32Array(source.islands.length).fill(1);
  return {
    source,
    version: territoryVersion.peek(),
    target: tiles,
    previous: tiles,
    explored: new Uint8Array(source.tiles.length).fill(1),
    visible: new Uint8Array(source.tiles.length).fill(1),
    islandTarget: islands,
    islandPrevious: islands,
    islandExplored: new Uint8Array(source.islands.length).fill(1),
    startedAt: now,
    discs: [],
  };
}

/**
 * Rebuilds the field from the owner map.
 *
 * Runs once per claim, never per frame. The cost is one pass over the world for
 * every owned tile, which at eighty islands and a start island of nine hexes is
 * a few thousand distance tests.
 */
function rebuild(source: WorldMap, now: number): FogField {
  const knobs = config.fog;
  const count = source.tiles.length;
  const carried = field && field.source === source ? field : null;
  const explored = carried ? carried.explored : new Uint8Array(count);
  const visible = new Uint8Array(count);
  const target = new Float32Array(count);
  const previous = new Float32Array(count);
  const islandTarget = new Float32Array(source.islands.length);
  const islandPrevious = new Float32Array(source.islands.length);
  const islandExplored = carried ? carried.islandExplored : new Uint8Array(source.islands.length);

  if (carried) {
    sampleInto(carried, now, previous, islandPrevious);
  }

  const points = territoryPoints(source);
  const ownedX = points.map((point) => point.x);
  const ownedY = points.map((point) => point.y);

  const inner = knobs.revealRadius - knobs.softness;
  const outer = knobs.revealRadius + knobs.softness;
  const dim = knobs.exploredDim;
  for (let index = 0; index < count; index += 1) {
    const tile = source.tiles[index]!;
    const centre = hexToWorld(tile);
    let nearest = Number.POSITIVE_INFINITY;
    for (let owned = 0; owned < ownedX.length; owned += 1) {
      const dx = centre.x - ownedX[owned]!;
      const dy = centre.y - ownedY[owned]!;
      const squared = dx * dx + dy * dy;
      if (squared < nearest) {
        nearest = squared;
      }
    }
    const sight = 1 - smoothstep(inner, outer, Math.sqrt(nearest));
    if (sight > 0) {
      explored[index] = 1;
      islandExplored[tile.islandId] = 1;
    }
    visible[index] = sight >= VISIBLE_LEVEL ? 1 : 0;
    const level = explored[index] === 1 ? dim + (1 - dim) * sight : 0;
    target[index] = level;
    if (level > islandTarget[tile.islandId]!) {
      islandTarget[tile.islandId] = level;
    }
  }

  const discs = carried ? carried.discs : [];
  for (const disc of discsOfTerritory(points)) {
    addDisc(discs, disc);
  }

  // The very first field has nothing to fade from: the opening view is the
  // answer, not a transition into it.
  if (!carried) {
    previous.set(target);
    islandPrevious.set(islandTarget);
  }

  return {
    source,
    version: territoryVersion.peek(),
    target,
    previous,
    explored,
    visible,
    islandTarget,
    islandPrevious,
    islandExplored,
    startedAt: now,
    discs,
  };
}

/** How far along its transition the field is, 0…1. */
function progressOf(current: FogField, now: number): number {
  const seconds = config.fog.fadeSeconds;
  if (seconds <= 0) {
    return 1;
  }
  const t = (now - current.startedAt) / (seconds * 1000);
  if (t >= 1) {
    return 1;
  }
  if (t <= 0) {
    return 0;
  }
  return t * t * (3 - 2 * t);
}

/** Writes the field's current levels into the two arrays. Returns true when settled. */
function sampleInto(current: FogField, now: number, tiles: Float32Array, islands: Float32Array): boolean {
  const t = progressOf(current, now);
  if (t >= 1) {
    tiles.set(current.target);
    islands.set(current.islandTarget);
    return true;
  }
  for (let index = 0; index < tiles.length; index += 1) {
    const from = current.previous[index]!;
    tiles[index] = from + (current.target[index]! - from) * t;
  }
  for (let index = 0; index < islands.length; index += 1) {
    const from = current.islandPrevious[index]!;
    islands[index] = from + (current.islandTarget[index]! - from) * t;
  }
  return false;
}

function ensureField(now: number): FogField {
  const source = world.peek();
  const version = territoryVersion.peek();
  if (field && field.source === source && field.version === version) {
    return field;
  }
  field = config.fog.enabled ? rebuild(source, now) : clearField(source, now);
  return field;
}

/**
 * The fog as of `now`, for one frame of drawing.
 *
 * A settled field hands its own arrays straight out; only a field still fading
 * writes the scratch, and that is one lerp per tile over a few hundred tiles.
 */
function sampleFog(now: number): FogSnapshot {
  const current = ensureField(now);
  snapshot.enabled = config.fog.enabled;
  snapshot.islandExplored = current.islandExplored;
  if (progressOf(current, now) >= 1) {
    snapshot.tile = current.target;
    snapshot.island = current.islandTarget;
    snapshot.settled = true;
    return snapshot;
  }
  if (tileScratch.length !== current.target.length) {
    tileScratch = new Float32Array(current.target.length);
    islandScratch = new Float32Array(current.islandTarget.length);
  }
  snapshot.settled = sampleInto(current, now, tileScratch, islandScratch);
  snapshot.tile = tileScratch;
  snapshot.island = islandScratch;
  return snapshot;
}

/** Whether the tile is in sight right now. Placement asks before it accepts a hex. */
function tileVisible(tile: Tile): boolean {
  if (!config.fog.enabled) {
    return true;
  }
  return ensureField(performance.now()).visible[tile.index] === 1;
}

/** Whether the tile has ever been seen. */
function tileExplored(tile: Tile): boolean {
  if (!config.fog.enabled) {
    return true;
  }
  return ensureField(performance.now()).explored[tile.index] === 1;
}

/** The explored discs, for the minimap wash. Live data — read it, do not keep it. */
function exploredDiscs(): readonly FogDisc[] {
  return ensureField(performance.now()).discs;
}

/**
 * The cloud layer's copy of the fog, packed for the shader.
 *
 * The bank at the edge of the world rides in the same object: both are the same
 * job — telling the shader where to stop being sky and start being weather.
 */
function fogUniforms(now: number): CloudFog {
  const current = ensureField(now);
  const source = current.source;
  const discs = current.discs;
  cloudFog.discCount = Math.min(MAX_DISCS, discs.length);
  for (let index = 0; index < cloudFog.discCount; index += 1) {
    const disc = discs[index]!;
    cloudFog.discs[index * 3] = disc.x;
    cloudFog.discs[index * 3 + 1] = disc.y;
    cloudFog.discs[index * 3 + 2] = disc.radius;
  }
  cloudFog.softness = Math.max(1, config.fog.softness);
  cloudFog.density = config.fog.enabled ? config.fog.cloudDensity : 0;
  const inner = source.zoneRadii.peripheral * config.background.edgeBankStart;
  cloudFog.edgeInner = inner;
  cloudFog.edgeOuter = inner + config.background.edgeBankWidth;
  cloudFog.edgeDensity = config.background.edgeBankEnabled ? config.background.edgeBankDensity : 0;
  return cloudFog;
}

export type { CloudFog, FogDisc, FogSnapshot };
export { MAX_DISCS, exploredDiscs, fogUniforms, sampleFog, tileExplored, tileVisible };
