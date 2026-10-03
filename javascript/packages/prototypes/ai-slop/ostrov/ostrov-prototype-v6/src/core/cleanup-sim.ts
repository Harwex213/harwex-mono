import { findBridges, HEX_STEP, solveCollisions } from "./cleanup-collision";
import { islandExtent } from "./cleanup-level";
import { AXIAL_DIRECTIONS, HEX_SIZE, hexId, hexToPixel } from "./hex";
import { createRng } from "./rng";
import { getBuilding } from "./buildings";
import { STRONGHOLD_HEX_ART, STRONGHOLD_LABEL } from "./stronghold";
import { STRONGHOLD_DEFENSE } from "./structure-hp";
import { getEnemy, getUnit } from "./units";
import type { TBody } from "./cleanup-collision";
import type { TAnnexedHex, TCleanupHex, TCleanupSide, TIslandBehavior, TLevelBounds, TLevelSpec } from "./cleanup-level";
import type { TRng } from "./rng";
import type { TStructureKind } from "./structure-hp";
import type { TBuildingId } from "./types";
import type { TCombatant, TEnemyId, TProjectile, TUnitId } from "./units";

/**
 * The auto-battle of the cleanup phase. The player steers their island; the
 * units on every island find their own fights.
 *
 * The sim is deterministic: one seed, a fixed tick and a fixed update order
 * give the same battle every time. The state is mutated in place, because a
 * hundred units at 30 ticks a second would otherwise allocate a lot. Every
 * moving thing keeps its position from the previous tick, so the renderer can
 * interpolate between two ticks.
 */

const TICK_HZ = 30;
const TICK_SECONDS = 1 / TICK_HZ;

const PLAYER_ACCELERATION = 420;
const PLAYER_MAX_SPEED = 170;
const PLAYER_DRAG_IDLE = 1.8;
const PLAYER_DRAG_STEERING = 0.5;
const DRIFT_MAX_SPEED = 16;
const DRIFT_WOBBLE = 60;
const APPROACH_SPEED = 34;
const APPROACH_RADIUS = 1100;
/** Islands answer a change of desired velocity at this rate per second. */
const ENEMY_RESPONSE = 0.8;
/** The band inside the map border where the player's island can retreat. */
const RETREAT_BAND = 300;
/** Seconds the island must stay in the band before the retreat happens. */
const RETREAT_SECONDS = 2.5;
/** Leaving the band drains the retreat this many times faster than it fills. */
const RETREAT_DRAIN = 2;

/** Melee reach against a flyer, and a flyer's own reach. */
const FLYER_REACH = 70;
/** A flyer counts as over a hex this close to its centre. */
const HOVER_RADIUS = 60;
const PLAYER_FLYER_AGGRO = 480;
const PLAYER_FLYER_LEASH = 700;
const ENEMY_FLYER_AGGRO = 460;
const ENEMY_FLYER_LEASH = 900;
const FLYER_SEPARATION = 30;
const FLYER_STEERING = 6;
/** Ground monsters chase no farther than this many hex steps from where they stand. */
const ENEMY_CHASE_STEPS = 8;
/** A foreign island this close pulls idle units to the rim facing it. */
const RALLY_GAP = 420;
const RALLY_NODES = 5;
const IDLE_WAIT_MIN = 1.2;
const IDLE_WAIT_SPREAD = 2.4;
const IDLE_PACE = 0.55;
const REGEN_DELAY = 3;
const REGEN_SHARE_PER_SECOND = 0.03;
const DAMAGE_ROLL = 0.3;
const PROJECTILE_SPEED: Readonly<Record<TProjectile, number>> = {
  stone: 420,
  arrow: 560,
  bullet: 1100,
  hex: 320,
  bolt: 760,
};

const CLEARED_HOLD = 3;
const SINK_SECONDS = 2.5;
const LOSS_DELAY = 1.5;
const WIN_DELAY = 1;
/** The event queue is drained by the renderer; this cap guards a stalled one. */
const MAX_EVENTS = 400;

type TSimStatus = "running" | "won" | "lost" | "retreated";
type TIslandState = "active" | "cleared" | "sinking" | "sunk";

type TSimIsland = {
  readonly index: number;
  readonly id: string;
  readonly label: string;
  readonly side: TCleanupSide;
  readonly behavior: TIslandBehavior;
  readonly hexes: readonly TCleanupHex[];
  readonly body: TBody;
  /** Index of the first node of this island in the node arrays. */
  readonly nodeBase: number;
  readonly homeX: number;
  readonly homeY: number;
  readonly wobblePhase: number;
  readonly garrisonTotal: number;
  readonly reward: number;
  px: number;
  py: number;
  state: TIslandState;
  stateTick: number;
  /** Hex indices that join the player when the island is cleared. */
  rewardHexes: number[];
  /** The hexes' outer edges relative to the body position. */
  readonly extent: { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number };
};

type TSimUnit = {
  readonly id: number;
  readonly side: TCleanupSide;
  readonly kind: TUnitId | TEnemyId | TStructureKind;
  /**
   * The hex index on the player's island for a building or the stronghold,
   * -1 for a unit. A structure never moves; only the stronghold shoots.
   */
  readonly structureHex: number;
  readonly stats: TCombatant;
  readonly maxHp: number;
  readonly damage: number;
  readonly homeIsland: number;
  /** Offset from the hex centre, so units on one hex do not stack. */
  readonly slotX: number;
  readonly slotY: number;
  hp: number;
  alive: boolean;
  /** Ground units: the hex node they stand on. -1 for a flyer. */
  node: number;
  /** The node the unit walks to, or -1. */
  nextNode: number;
  /** Ground units: position relative to the island of `node`. */
  lx: number;
  ly: number;
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  cooldown: number;
  lastHurtTick: number;
  lastAttackTick: number;
  /** Unit vector toward the last target, for the attack lunge. */
  aimX: number;
  aimY: number;
  idlePath: number[];
  idleWait: number;
  /** Flyers: the node under them, or -1 over water. */
  hoverNode: number;
};

type TSimProjectile = {
  readonly kind: TProjectile;
  readonly side: TCleanupSide;
  readonly targetId: number;
  readonly damage: number;
  readonly fromX: number;
  readonly fromY: number;
  readonly duration: number;
  age: number;
  targetX: number;
  targetY: number;
  x: number;
  y: number;
  px: number;
  py: number;
  done: boolean;
};

type TSimEvent =
  | { readonly type: "hit"; readonly x: number; readonly y: number; readonly amount: number; readonly side: TCleanupSide }
  | { readonly type: "death"; readonly x: number; readonly y: number; readonly icon: string; readonly side: TCleanupSide }
  | { readonly type: "ferry"; readonly x: number; readonly y: number }
  | { readonly type: "razed"; readonly x: number; readonly y: number; readonly hex: number }
  | { readonly type: "cleared"; readonly island: number }
  | { readonly type: "sunk"; readonly island: number };

type TSimInput = {
  x: number;
  y: number;
};

type TCleanupSim = {
  readonly seed: number;
  readonly tier: number;
  readonly rng: TRng;
  readonly islands: TSimIsland[];
  readonly bodies: TBody[];
  units: TSimUnit[];
  projectiles: TSimProjectile[];
  events: TSimEvent[];
  readonly input: TSimInput;
  tick: number;
  status: TSimStatus;
  /** Tick at which the end condition was first met, or -1. */
  endingTick: number;
  kills: number;
  /** Everything the player fielded, dead or alive. */
  readonly roster: readonly TUnitId[];
  readonly lost: TUnitId[];
  readonly annexed: TAnnexedHex[];
  /* The hex graph. Node n is hex `nodeHex[n]` of island `nodeIsland[n]`. */
  readonly nodeIsland: Int32Array;
  readonly nodeHex: Int32Array;
  readonly nodeX: Float64Array;
  readonly nodeY: Float64Array;
  /** Neighbours inside one island. They never change. */
  readonly innerLinks: readonly (readonly number[])[];
  /** Neighbours across a bridge, rebuilt every tick. */
  bridgeLinks: number[][];
  /** Smallest gap between each pair of islands, rebuilt every tick. */
  gaps: Float64Array;
  /** Hex steps to the nearest foe, per side, rebuilt every tick. -1 is unreachable. */
  readonly flowToEnemy: Int32Array;
  readonly flowToPlayer: Int32Array;
  nextUnitId: number;
  readonly bounds: TLevelBounds;
  /** 0..1: how far the retreat through the map border has run. */
  retreatProgress: number;
  /** True while the player's island touches the retreat band. */
  inRetreatBand: boolean;
  /** Hp of each structure on the player's island, by hex index. -1 where nothing stands. */
  readonly structureHp: Float64Array;
  /** Structures standing when the battle began. Zero means defeat by ruin cannot happen. */
  structuresAtStart: number;
  /** Structures razed in this battle. */
  razed: number;
};

const hexCenter = (hex: TCleanupHex) => hexToPixel(hex.q, hex.r, HEX_SIZE);

const combatantOf = (kind: TUnitId | TEnemyId, side: TCleanupSide): TCombatant => {
  return side === "player" ? getUnit(kind as TUnitId) : getEnemy(kind as TEnemyId);
};

const roll = (rng: TRng, value: number) => value * (1 - DAMAGE_ROLL / 2 + rng() * DAMAGE_ROLL);

const createBody = (hexes: readonly TCleanupHex[], x: number, y: number, mass: number): TBody => {
  const extent = islandExtent(hexes);
  const localX = new Float64Array(hexes.length);
  const localY = new Float64Array(hexes.length);

  hexes.forEach((hex, index) => {
    const center = hexCenter(hex);
    localX[index] = center.x;
    localY[index] = center.y;
  });

  return {
    x,
    y,
    vx: 0,
    vy: 0,
    invMass: 1 / mass,
    localX,
    localY,
    centerX: extent.cx,
    centerY: extent.cy,
    radius: extent.radius,
    solid: true,
    anchored: false,
  };
};

/** The node indices of an island, sorted so that units spread from its middle. */
const spawnNodes = (island: TSimIsland, rng: TRng, preferHex: number) => {
  const origin = preferHex >= 0 ? hexCenter(island.hexes[preferHex] as TCleanupHex) : { x: island.body.centerX, y: island.body.centerY };

  return island.hexes
    .map((hex, index) => {
      const center = hexCenter(hex);

      return { node: island.nodeBase + index, order: Math.hypot(center.x - origin.x, center.y - origin.y) + rng() * 20 };
    })
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.node);
};

const addUnit = (
  sim: TCleanupSim,
  kind: TUnitId | TEnemyId,
  side: TCleanupSide,
  homeIsland: number,
  node: number,
  growth: number,
) => {
  const stats = combatantOf(kind, side);
  const id = sim.nextUnitId;
  sim.nextUnitId += 1;
  // A golden-angle spiral: every unit on a hex gets its own spot.
  const angle = id * 2.39996;
  const radius = 10 + (id % 3) * 9;
  const island = sim.islands[homeIsland] as TSimIsland;
  const hexIndex = node - island.nodeBase;
  const hex = island.hexes[hexIndex] as TCleanupHex;
  const center = hexCenter(hex);
  const slotX = Math.cos(angle) * radius;
  const slotY = Math.sin(angle) * radius * 0.7;
  const lx = center.x + slotX;
  const ly = center.y + slotY;
  const x = island.body.x + lx;
  const y = island.body.y + ly;
  const maxHp = Math.round(stats.hp * growth);

  sim.units.push({
    id,
    side,
    kind,
    structureHex: -1,
    stats,
    maxHp,
    damage: stats.damage * growth,
    homeIsland,
    slotX,
    slotY,
    hp: maxHp,
    alive: true,
    node: stats.flying ? -1 : node,
    nextNode: -1,
    lx,
    ly,
    x,
    y: stats.flying ? y - 10 : y,
    px: x,
    py: y,
    vx: 0,
    vy: 0,
    cooldown: sim.rng() * stats.cooldown,
    lastHurtTick: -1000,
    lastAttackTick: -1000,
    aimX: 1,
    aimY: 0,
    idlePath: [],
    idleWait: sim.rng() * IDLE_WAIT_SPREAD,
    hoverNode: -1,
  });
};

/**
 * A building or the stronghold, as a combatant that never moves. Monsters
 * attack it like a unit. The stronghold shoots back with bolts.
 */
const addStructure = (sim: TCleanupSim, hex: TCleanupHex, index: number) => {
  if (hex.maxHp <= 0) {
    return;
  }

  sim.structureHp[index] = hex.hp;
  if (hex.hp <= 0) {
    return;
  }

  const kind: TStructureKind = hex.stronghold ? "stronghold" : (hex.building as TBuildingId);
  const defends = kind === "stronghold";
  const stats: TCombatant = {
    label: defends ? STRONGHOLD_LABEL : getBuilding(kind as TBuildingId).label,
    icon: defends ? STRONGHOLD_HEX_ART : getBuilding(kind as TBuildingId).hexArt,
    hp: hex.maxHp,
    damage: defends ? STRONGHOLD_DEFENSE.damage : 0,
    cooldown: STRONGHOLD_DEFENSE.cooldown,
    range: defends ? STRONGHOLD_DEFENSE.range : 0,
    speed: 0,
    flying: false,
    projectile: defends ? "bolt" : null,
  };
  const island = sim.islands[0] as TSimIsland;
  const center = hexCenter(hex);
  const id = sim.nextUnitId;
  sim.nextUnitId += 1;
  sim.structuresAtStart += 1;

  sim.units.push({
    id,
    side: "player",
    kind,
    structureHex: index,
    stats,
    maxHp: hex.maxHp,
    damage: stats.damage,
    homeIsland: 0,
    slotX: 0,
    slotY: 0,
    hp: hex.hp,
    alive: true,
    node: island.nodeBase + index,
    nextNode: -1,
    lx: center.x,
    ly: center.y,
    x: island.body.x + center.x,
    y: island.body.y + center.y,
    px: island.body.x + center.x,
    py: island.body.y + center.y,
    vx: 0,
    vy: 0,
    cooldown: 0,
    lastHurtTick: -1000,
    lastAttackTick: -1000,
    aimX: 1,
    aimY: 0,
    idlePath: [],
    idleWait: 0,
    hoverNode: -1,
  });
};

const createCleanup = (level: TLevelSpec, seed: number): TCleanupSim => {
  const rng = createRng(seed);
  const islands: TSimIsland[] = [];
  let nodeCount = 0;

  level.islands.forEach((spec, index) => {
    const mass = spec.side === "player" ? Math.max(12, spec.hexes.length) * 1.5 : spec.hexes.length;
    const body = createBody(spec.hexes, spec.x, spec.y, mass);
    body.anchored = spec.side === "enemy";

    islands.push({
      index,
      id: spec.id,
      label: spec.label,
      side: spec.side,
      behavior: spec.behavior,
      hexes: spec.hexes,
      body,
      nodeBase: nodeCount,
      homeX: spec.x,
      homeY: spec.y,
      wobblePhase: rng() * Math.PI * 2,
      garrisonTotal: spec.garrison.length,
      reward: spec.reward,
      px: spec.x,
      py: spec.y,
      state: "active",
      stateTick: 0,
      rewardHexes: [],
      extent: {
        minX: Math.min(...body.localX) - HEX_SIZE,
        maxX: Math.max(...body.localX) + HEX_SIZE,
        minY: Math.min(...body.localY) - HEX_SIZE,
        maxY: Math.max(...body.localY) + HEX_SIZE,
      },
    });
    nodeCount += spec.hexes.length;
  });

  const nodeIsland = new Int32Array(nodeCount);
  const nodeHex = new Int32Array(nodeCount);
  const innerLinks: number[][] = [];

  for (const island of islands) {
    const byKey = new Map(island.hexes.map((hex, index) => [hexId(hex.q, hex.r), index]));

    island.hexes.forEach((hex, index) => {
      const node = island.nodeBase + index;
      nodeIsland[node] = island.index;
      nodeHex[node] = index;
      innerLinks[node] = AXIAL_DIRECTIONS.map((step) => byKey.get(hexId(hex.q + step.q, hex.r + step.r)))
        .filter((neighbor): neighbor is number => neighbor !== undefined)
        .map((neighbor) => island.nodeBase + neighbor);
    });
  }

  const sim: TCleanupSim = {
    seed,
    tier: level.tier,
    rng,
    islands,
    bodies: islands.map((island) => island.body),
    units: [],
    projectiles: [],
    events: [],
    input: { x: 0, y: 0 },
    tick: 0,
    status: "running",
    endingTick: -1,
    kills: 0,
    roster: level.roster,
    lost: [],
    annexed: [],
    nodeIsland,
    nodeHex,
    nodeX: new Float64Array(nodeCount),
    nodeY: new Float64Array(nodeCount),
    innerLinks,
    bridgeLinks: Array.from({ length: nodeCount }, () => []),
    gaps: new Float64Array(islands.length * islands.length),
    flowToEnemy: new Int32Array(nodeCount),
    flowToPlayer: new Int32Array(nodeCount),
    nextUnitId: 1,
    bounds: level.bounds,
    retreatProgress: 0,
    inRetreatBand: false,
    structureHp: new Float64Array(level.islands[0]?.hexes.length ?? 0).fill(-1),
    structuresAtStart: 0,
    razed: 0,
  };

  const player = islands[0];
  if (player) {
    player.hexes.forEach((hex, index) => {
      addStructure(sim, hex, index);
    });

    const strongholdHex = player.hexes.findIndex((hex) => hex.stronghold);
    const nodes = spawnNodes(player, rng, strongholdHex);
    level.roster.forEach((kind, index) => {
      addUnit(sim, kind, "player", 0, nodes[index % nodes.length] as number, 1);
    });
  }

  for (const island of islands) {
    if (island.side !== "enemy") {
      continue;
    }

    const nodes = spawnNodes(island, rng, -1);
    level.islands[island.index]?.garrison.forEach((kind, index) => {
      addUnit(sim, kind, "enemy", island.index, nodes[index % nodes.length] as number, level.growth);
    });
  }

  refreshWorld(sim);

  return sim;
};

const pushEvent = (sim: TCleanupSim, event: TSimEvent) => {
  sim.events.push(event);
  if (sim.events.length > MAX_EVENTS) {
    sim.events.splice(0, sim.events.length - MAX_EVENTS);
  }
};

const islandCenter = (island: TSimIsland) => ({
  x: island.body.x + island.body.centerX,
  y: island.body.y + island.body.centerY,
});

const gapBetween = (sim: TCleanupSim, a: number, b: number) => {
  return sim.gaps[a * sim.islands.length + b] as number;
};

const nodeActive = (sim: TCleanupSim, node: number) => {
  const island = sim.islands[sim.nodeIsland[node] as number] as TSimIsland;

  return island.state === "active" || island.state === "cleared";
};

/* ---------- islands ---------- */

/** The nearest enemy island that sails at the player. Only one does at a time, so the player is never boxed in. */
const leadApproacher = (sim: TCleanupSim) => {
  const player = sim.islands[0];
  if (!player) {
    return -1;
  }

  const to = islandCenter(player);
  let best = -1;
  let bestDistance = APPROACH_RADIUS;

  for (const island of sim.islands) {
    if (island.side !== "enemy" || island.state !== "active" || island.behavior !== "approach") {
      continue;
    }

    const from = islandCenter(island);
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    if (distance < bestDistance) {
      best = island.index;
      bestDistance = distance;
    }
  }

  return best;
};

/** Keeps every island inside the map border. An island that hits it stops there. */
const clampToBounds = (sim: TCleanupSim) => {
  const { halfWidth, halfHeight } = sim.bounds;

  for (const island of sim.islands) {
    if (island.state === "sunk") {
      continue;
    }

    const body = island.body;
    const left = body.x + island.extent.minX;
    const right = body.x + island.extent.maxX;
    const top = body.y + island.extent.minY;
    const bottom = body.y + island.extent.maxY;

    if (left < -halfWidth) {
      body.x += -halfWidth - left;
      body.vx = Math.max(0, body.vx);
    } else if (right > halfWidth) {
      body.x -= right - halfWidth;
      body.vx = Math.min(0, body.vx);
    }

    if (top < -halfHeight) {
      body.y += -halfHeight - top;
      body.vy = Math.max(0, body.vy);
    } else if (bottom > halfHeight) {
      body.y -= bottom - halfHeight;
      body.vy = Math.min(0, body.vy);
    }
  }
};

/** How far the player's island is from the nearest map border. Zero is touching it. */
const borderGap = (sim: TCleanupSim) => {
  const player = sim.islands[0];
  if (!player) {
    return Infinity;
  }

  const { halfWidth, halfHeight } = sim.bounds;
  const body = player.body;

  return Math.min(
    halfWidth - (body.x + player.extent.maxX),
    body.x + player.extent.minX + halfWidth,
    halfHeight - (body.y + player.extent.maxY),
    body.y + player.extent.minY + halfHeight,
  );
};

const steerIslands = (sim: TCleanupSim, dt: number) => {
  const player = sim.islands[0];
  const approacher = leadApproacher(sim);

  for (const island of sim.islands) {
    const body = island.body;
    island.px = body.x;
    island.py = body.y;

    if (island.state === "sunk") {
      continue;
    }

    if (island.side === "player") {
      const length = Math.hypot(sim.input.x, sim.input.y);
      const steering = length > 0.01;
      if (steering) {
        body.vx += (sim.input.x / length) * PLAYER_ACCELERATION * dt;
        body.vy += (sim.input.y / length) * PLAYER_ACCELERATION * dt;
      }

      const drag = Math.exp(-(steering ? PLAYER_DRAG_STEERING : PLAYER_DRAG_IDLE) * dt);
      body.vx *= drag;
      body.vy *= drag;
      const speed = Math.hypot(body.vx, body.vy);
      if (speed > PLAYER_MAX_SPEED) {
        body.vx *= PLAYER_MAX_SPEED / speed;
        body.vy *= PLAYER_MAX_SPEED / speed;
      }
    } else {
      let desiredX = 0;
      let desiredY = 0;

      // A docked island holds still, so the fight on the bridge stays put.
      const docked = gapBetween(sim, 0, island.index) < HEX_STEP * 0.2;

      if (island.state === "active" && !docked) {
        const time = sim.tick * TICK_SECONDS * 0.12 + island.wobblePhase;
        const wobbleX = island.homeX + Math.cos(time) * DRIFT_WOBBLE;
        const wobbleY = island.homeY + Math.sin(time * 1.3) * DRIFT_WOBBLE;
        desiredX = (wobbleX - body.x) * 0.2;
        desiredY = (wobbleY - body.y) * 0.2;
        const drift = Math.hypot(desiredX, desiredY);
        if (drift > DRIFT_MAX_SPEED) {
          desiredX *= DRIFT_MAX_SPEED / drift;
          desiredY *= DRIFT_MAX_SPEED / drift;
        }

        if (island.index === approacher && player) {
          const from = islandCenter(island);
          const to = islandCenter(player);
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const distance = Math.hypot(dx, dy);
          if (distance < APPROACH_RADIUS) {
            desiredX = (dx / distance) * APPROACH_SPEED;
            desiredY = (dy / distance) * APPROACH_SPEED;
          }
        }
      }

      const response = Math.min(1, ENEMY_RESPONSE * dt);
      body.vx += (desiredX - body.vx) * response;
      body.vy += (desiredY - body.vy) * response;
    }

    body.x += body.vx * dt;
    body.y += body.vy * dt;
  }

  clampToBounds(sim);
  solveCollisions(sim.bodies);
  // The solver may push an island back out; the border wins.
  clampToBounds(sim);
};

/** Node positions, bridges and island gaps. */
function refreshWorld(sim: TCleanupSim) {
  const count = sim.nodeIsland.length;

  for (let node = 0; node < count; node += 1) {
    const island = sim.islands[sim.nodeIsland[node] as number] as TSimIsland;
    sim.nodeX[node] = island.body.x + (island.body.localX[sim.nodeHex[node] as number] as number);
    sim.nodeY[node] = island.body.y + (island.body.localY[sim.nodeHex[node] as number] as number);
    (sim.bridgeLinks[node] as number[]).length = 0;
  }

  const { bridges, distances } = findBridges(sim.bodies);
  sim.gaps.fill(Infinity);

  for (const pair of distances) {
    sim.gaps[pair.a * sim.islands.length + pair.b] = pair.gap;
    sim.gaps[pair.b * sim.islands.length + pair.a] = pair.gap;
  }

  for (const bridge of bridges) {
    const nodeA = (sim.islands[bridge.a] as TSimIsland).nodeBase + bridge.hexA;
    const nodeB = (sim.islands[bridge.b] as TSimIsland).nodeBase + bridge.hexB;
    (sim.bridgeLinks[nodeA] as number[]).push(nodeB);
    (sim.bridgeLinks[nodeB] as number[]).push(nodeA);
  }
}

const linksOf = (sim: TCleanupSim, node: number) => {
  const inner = sim.innerLinks[node] as readonly number[];
  const bridged = sim.bridgeLinks[node] as number[];

  return bridged.length === 0 ? inner : [...inner, ...bridged];
};

const areLinked = (sim: TCleanupSim, a: number, b: number) => {
  return a === b || (sim.innerLinks[a] as readonly number[]).includes(b) || (sim.bridgeLinks[a] as number[]).includes(b);
};

/** Multi-source BFS from every node that holds a unit of `goalSide`. */
const buildFlow = (sim: TCleanupSim, goalSide: TCleanupSide, flow: Int32Array) => {
  flow.fill(-1);
  const queue: number[] = [];

  for (const unit of sim.units) {
    if (!unit.alive || unit.side !== goalSide) {
      continue;
    }

    const node = unit.node >= 0 ? unit.node : unit.hoverNode;
    if (node >= 0 && flow[node] === -1 && nodeActive(sim, node)) {
      flow[node] = 0;
      queue.push(node);
    }
  }

  for (let head = 0; head < queue.length; head += 1) {
    const node = queue[head] as number;
    const next = (flow[node] as number) + 1;

    for (const neighbor of linksOf(sim, node)) {
      if (flow[neighbor] === -1 && nodeActive(sim, neighbor)) {
        flow[neighbor] = next;
        queue.push(neighbor);
      }
    }
  }
};

/* ---------- combat ---------- */

const hurt = (sim: TCleanupSim, target: TSimUnit, amount: number) => {
  if (!target.alive) {
    return;
  }

  target.hp -= amount;
  target.lastHurtTick = sim.tick;
  pushEvent(sim, { type: "hit", x: target.x, y: target.y, amount: Math.max(1, Math.round(amount)), side: target.side });

  if (target.structureHex >= 0) {
    sim.structureHp[target.structureHex] = Math.max(0, target.hp);
  }

  if (target.hp > 0) {
    return;
  }

  target.alive = false;
  target.hp = 0;

  if (target.structureHex >= 0) {
    sim.razed += 1;
    pushEvent(sim, { type: "razed", x: target.x, y: target.y, hex: target.structureHex });

    return;
  }

  pushEvent(sim, { type: "death", x: target.x, y: target.y, icon: target.stats.icon, side: target.side });

  if (target.side === "player") {
    sim.lost.push(target.kind as TUnitId);
  } else {
    sim.kills += 1;
  }
};

const attack = (sim: TCleanupSim, unit: TSimUnit, target: TSimUnit) => {
  const dx = target.x - unit.x;
  const dy = target.y - unit.y;
  const distance = Math.hypot(dx, dy) || 1;
  unit.aimX = dx / distance;
  unit.aimY = dy / distance;
  unit.lastAttackTick = sim.tick;
  unit.cooldown = unit.stats.cooldown;
  const damage = roll(sim.rng, unit.damage);

  if (unit.stats.projectile) {
    const speed = PROJECTILE_SPEED[unit.stats.projectile];
    sim.projectiles.push({
      kind: unit.stats.projectile,
      side: unit.side,
      targetId: target.id,
      damage,
      fromX: unit.x,
      fromY: unit.y,
      duration: Math.max(TICK_SECONDS * 2, distance / speed),
      age: 0,
      targetX: target.x,
      targetY: target.y,
      x: unit.x,
      y: unit.y,
      px: unit.x,
      py: unit.y,
      done: false,
    });

    return;
  }

  hurt(sim, target, damage);
};

/** The nearest living foe that `accept` allows, by straight distance. */
const nearestFoe = (sim: TCleanupSim, unit: TSimUnit, maxDistance: number, accept: (foe: TSimUnit) => boolean) => {
  let best: TSimUnit | null = null;
  let bestDistance = maxDistance;

  for (const other of sim.units) {
    if (!other.alive || other.side === unit.side) {
      continue;
    }

    const distance = Math.hypot(other.x - unit.x, other.y - unit.y);
    if (distance <= bestDistance && accept(other)) {
      best = other;
      bestDistance = distance;
    }
  }

  return best;
};

/** A foe a ground unit can hit from where it stands. */
const isStructure = (unit: TSimUnit) => unit.structureHex >= 0;

/**
 * A foe a ground unit can hit from where it stands. Monsters hit units in
 * reach first and turn on buildings only when no unit is in reach.
 */
const targetForGround = (sim: TCleanupSim, unit: TSimUnit) => {
  const inReach = (foe: TSimUnit) => {
    if (unit.stats.range > 1) {
      return true;
    }

    if (foe.node < 0) {
      return Math.hypot(foe.x - unit.x, foe.y - unit.y) <= FLYER_REACH;
    }

    return areLinked(sim, unit.node, foe.node);
  };
  const reach = unit.stats.range > 1 ? unit.stats.range * HEX_STEP : HEX_STEP * 1.9;
  const fighter = nearestFoe(sim, unit, reach, (foe) => !isStructure(foe) && inReach(foe));

  return fighter ?? nearestFoe(sim, unit, reach, (foe) => isStructure(foe) && inReach(foe));
};

/** The stronghold shoots the nearest monster in range. Other buildings only stand. */
const stepStructure = (sim: TCleanupSim, unit: TSimUnit) => {
  if (unit.damage <= 0 || unit.cooldown > 0) {
    return;
  }

  const target = nearestFoe(sim, unit, unit.stats.range * HEX_STEP, () => true);
  if (target) {
    attack(sim, unit, target);
  }
};

/* ---------- ground movement ---------- */

/** Where a unit stands on `node`, in the frame of the island of `frameNode`. */
const slotIn = (sim: TCleanupSim, unit: TSimUnit, node: number, frameNode: number) => {
  const frame = sim.islands[sim.nodeIsland[frameNode] as number] as TSimIsland;

  return {
    x: (sim.nodeX[node] as number) + unit.slotX - frame.body.x,
    y: (sim.nodeY[node] as number) + unit.slotY - frame.body.y,
  };
};

const walk = (sim: TCleanupSim, unit: TSimUnit, pace: number, dt: number) => {
  // A bridge that breaks under a walking unit sends it back to its own hex.
  if (unit.nextNode >= 0 && (!areLinked(sim, unit.node, unit.nextNode) || !nodeActive(sim, unit.nextNode))) {
    unit.nextNode = -1;
    unit.idlePath = [];
  }

  const goalNode = unit.nextNode >= 0 ? unit.nextNode : unit.node;
  const goal = slotIn(sim, unit, goalNode, unit.node);
  const dx = goal.x - unit.lx;
  const dy = goal.y - unit.ly;
  const distance = Math.hypot(dx, dy);
  const step = unit.stats.speed * HEX_STEP * pace * dt;

  if (distance <= step) {
    unit.lx = goal.x;
    unit.ly = goal.y;

    if (unit.nextNode >= 0) {
      const arrived = unit.nextNode;
      const island = sim.islands[sim.nodeIsland[arrived] as number] as TSimIsland;
      unit.node = arrived;
      unit.nextNode = -1;
      unit.lx = (sim.nodeX[arrived] as number) + unit.slotX - island.body.x;
      unit.ly = (sim.nodeY[arrived] as number) + unit.slotY - island.body.y;
    }

    return;
  }

  unit.lx += (dx / distance) * step;
  unit.ly += (dy / distance) * step;
};

/** BFS path from `from` to the first node that `isGoal` accepts. */
const pathTo = (sim: TCleanupSim, from: number, isGoal: (node: number) => boolean, crossBridges: boolean) => {
  const previous = new Map<number, number>([[from, -1]]);
  const queue = [from];

  for (let head = 0; head < queue.length; head += 1) {
    const node = queue[head] as number;
    if (node !== from && isGoal(node)) {
      const path: number[] = [];
      let cursor = node;
      while (cursor !== from) {
        path.unshift(cursor);
        cursor = previous.get(cursor) as number;
      }

      return path;
    }

    const links = crossBridges ? linksOf(sim, node) : (sim.innerLinks[node] as readonly number[]);
    for (const neighbor of links) {
      if (!previous.has(neighbor) && nodeActive(sim, neighbor)) {
        previous.set(neighbor, node);
        queue.push(neighbor);
      }
    }
  }

  return [];
};

/** The foreign island this island's idle units should gather to face. */
const rallyIsland = (sim: TCleanupSim, island: TSimIsland) => {
  let best = -1;
  let bestGap = RALLY_GAP;

  for (const other of sim.islands) {
    if (other.side === island.side || other.state !== "active") {
      continue;
    }

    const gap = gapBetween(sim, island.index, other.index);
    if (gap < bestGap) {
      best = other.index;
      bestGap = gap;
    }
  }

  return best;
};

/** Wandering, gathering on the rim facing a foe, or walking home. */
const idle = (sim: TCleanupSim, unit: TSimUnit, dt: number) => {
  if (unit.nextNode < 0 && unit.idlePath.length > 0) {
    unit.nextNode = unit.idlePath.shift() as number;
  }

  if (unit.nextNode >= 0) {
    walk(sim, unit, IDLE_PACE, dt);

    return;
  }

  walk(sim, unit, IDLE_PACE, dt);
  unit.idleWait -= dt;
  if (unit.idleWait > 0) {
    return;
  }

  unit.idleWait = IDLE_WAIT_MIN + sim.rng() * IDLE_WAIT_SPREAD;
  const hereIsland = sim.nodeIsland[unit.node] as number;
  const home = unit.side === "player" ? 0 : unit.homeIsland;

  if (hereIsland !== home) {
    const homeIsland = sim.islands[home] as TSimIsland;
    if (homeIsland.state === "active" || homeIsland.state === "cleared") {
      unit.idlePath = pathTo(sim, unit.node, (node) => sim.nodeIsland[node] === home, true);
      unit.idleWait = 0.3;
    }

    if (unit.idlePath.length > 0) {
      return;
    }
  }

  const island = sim.islands[hereIsland] as TSimIsland;
  const rally = rallyIsland(sim, island);

  if (rally >= 0) {
    const target = islandCenter(sim.islands[rally] as TSimIsland);
    const facing = island.hexes
      .map((_, index) => island.nodeBase + index)
      .sort((a, b) => {
        const da = Math.hypot((sim.nodeX[a] as number) - target.x, (sim.nodeY[a] as number) - target.y);
        const db = Math.hypot((sim.nodeX[b] as number) - target.x, (sim.nodeY[b] as number) - target.y);

        return da - db;
      })
      .slice(0, RALLY_NODES);
    const goal = facing[Math.floor(sim.rng() * facing.length)] as number;
    if (goal !== unit.node) {
      unit.idlePath = pathTo(sim, unit.node, (node) => node === goal, false);
    }

    unit.idleWait *= 0.5;

    return;
  }

  // A short stroll: one or two hexes in a random direction.
  const links = sim.innerLinks[unit.node] as readonly number[];
  if (links.length > 0 && sim.rng() < 0.7) {
    const first = links[Math.floor(sim.rng() * links.length)] as number;
    unit.idlePath = [first];
  }
};

const stepGroundUnit = (sim: TCleanupSim, unit: TSimUnit, dt: number) => {
  const onBridge = unit.nextNode >= 0 && sim.nodeIsland[unit.nextNode] !== sim.nodeIsland[unit.node];
  const target = onBridge ? null : targetForGround(sim, unit);

  if (target) {
    // A unit finishes the step it is in before it swings.
    if (unit.nextNode >= 0) {
      walk(sim, unit, 1, dt);
    } else {
      walk(sim, unit, 1, dt);
      if (unit.cooldown <= 0) {
        attack(sim, unit, target);
      }
    }

    unit.idlePath = [];

    return;
  }

  if (unit.nextNode < 0) {
    const flow = unit.side === "player" ? sim.flowToEnemy : sim.flowToPlayer;
    const here = flow[unit.node] as number;
    const chases = here > 0 && (unit.side === "player" || here <= ENEMY_CHASE_STEPS);

    if (chases) {
      const options = linksOf(sim, unit.node).filter((node) => flow[node] === here - 1 && nodeActive(sim, node));
      if (options.length > 0) {
        unit.nextNode = options[(unit.id + Math.floor(sim.tick / TICK_HZ)) % options.length] as number;
        unit.idlePath = [];
      }
    }
  }

  if (unit.nextNode >= 0 && unit.idlePath.length === 0) {
    walk(sim, unit, 1, dt);

    return;
  }

  idle(sim, unit, dt);
};

/* ---------- flyers ---------- */

const hoverNodeAt = (sim: TCleanupSim, x: number, y: number) => {
  let best = -1;
  let bestDistance = HOVER_RADIUS;

  for (const island of sim.islands) {
    if (island.state !== "active" && island.state !== "cleared") {
      continue;
    }

    const center = islandCenter(island);
    if (Math.hypot(center.x - x, center.y - y) > island.body.radius + HOVER_RADIUS) {
      continue;
    }

    for (let index = 0; index < island.hexes.length; index += 1) {
      const node = island.nodeBase + index;
      const distance = Math.hypot((sim.nodeX[node] as number) - x, (sim.nodeY[node] as number) - y);
      if (distance < bestDistance) {
        best = node;
        bestDistance = distance;
      }
    }
  }

  return best;
};

const flyerTarget = (sim: TCleanupSim, unit: TSimUnit) => {
  if (unit.side === "player") {
    const home = islandCenter(sim.islands[0] as TSimIsland);

    return nearestFoe(sim, unit, PLAYER_FLYER_AGGRO, (foe) => Math.hypot(foe.x - home.x, foe.y - home.y) < PLAYER_FLYER_LEASH);
  }

  const home = islandCenter(sim.islands[unit.homeIsland] as TSimIsland);

  const allowed = (foe: TSimUnit) => {
    const nearFlyer = Math.hypot(foe.x - unit.x, foe.y - unit.y) < ENEMY_FLYER_AGGRO;

    return nearFlyer && Math.hypot(foe.x - home.x, foe.y - home.y) < ENEMY_FLYER_LEASH;
  };

  // A flyer in reach of a unit fights it; otherwise it raids the nearest building.
  const fighter = nearestFoe(sim, unit, FLYER_REACH * 1.5, (foe) => !isStructure(foe) && allowed(foe));

  return fighter ?? nearestFoe(sim, unit, ENEMY_FLYER_AGGRO * 2, allowed);
};

const stepFlyer = (sim: TCleanupSim, unit: TSimUnit, dt: number) => {
  const target = flyerTarget(sim, unit);
  let goalX: number;
  let goalY: number;
  let pace = 1;

  if (target) {
    const dx = target.x - unit.x;
    const dy = target.y - unit.y;
    const distance = Math.hypot(dx, dy) || 1;
    if (distance <= FLYER_REACH && unit.cooldown <= 0) {
      attack(sim, unit, target);
    }

    // It hangs just short of the target instead of sitting on it.
    const standoff = FLYER_REACH * 0.7;
    goalX = target.x - (dx / distance) * standoff;
    goalY = target.y - (dy / distance) * standoff;
  } else {
    const homeIndex = unit.side === "player" ? 0 : unit.homeIsland;
    const homeIsland = sim.islands[homeIndex] as TSimIsland;
    const home = homeIsland.state === "sunk" ? islandCenter(sim.islands[0] as TSimIsland) : islandCenter(homeIsland);
    const orbit = 50 + (unit.id % 4) * 18;
    const angle = sim.tick * TICK_SECONDS * 0.6 + unit.id;
    goalX = home.x + Math.cos(angle) * orbit;
    goalY = home.y + Math.sin(angle) * orbit * 0.7;
    pace = 0.6;
  }

  const dx = goalX - unit.x;
  const dy = goalY - unit.y;
  const distance = Math.hypot(dx, dy);
  const maxSpeed = unit.stats.speed * HEX_STEP * pace;
  let desiredX = distance > 1 ? (dx / distance) * Math.min(maxSpeed, distance * 3) : 0;
  let desiredY = distance > 1 ? (dy / distance) * Math.min(maxSpeed, distance * 3) : 0;

  for (const other of sim.units) {
    if (other === unit || !other.alive || other.node >= 0) {
      continue;
    }

    const ox = unit.x - other.x;
    const oy = unit.y - other.y;
    const gap = Math.hypot(ox, oy);
    if (gap > 0 && gap < FLYER_SEPARATION) {
      desiredX += (ox / gap) * maxSpeed * 0.5;
      desiredY += (oy / gap) * maxSpeed * 0.5;
    }
  }

  const response = Math.min(1, FLYER_STEERING * dt);
  unit.vx += (desiredX - unit.vx) * response;
  unit.vy += (desiredY - unit.vy) * response;
  unit.x += unit.vx * dt;
  unit.y += unit.vy * dt;
};

/* ---------- the tick ---------- */

const stepProjectiles = (sim: TCleanupSim, byId: Map<number, TSimUnit>, dt: number) => {
  for (const shot of sim.projectiles) {
    shot.px = shot.x;
    shot.py = shot.y;
    const target = byId.get(shot.targetId);
    if (target && target.alive) {
      shot.targetX = target.x;
      shot.targetY = target.y;
    }

    shot.age += dt;
    const t = Math.min(1, shot.age / shot.duration);
    shot.x = shot.fromX + (shot.targetX - shot.fromX) * t;
    shot.y = shot.fromY + (shot.targetY - shot.fromY) * t;

    if (t >= 1) {
      shot.done = true;
      if (target && target.alive) {
        hurt(sim, target, shot.damage);
      }
    }
  }

  sim.projectiles = sim.projectiles.filter((shot) => !shot.done);
};

const garrisonAlive = (sim: TCleanupSim, island: number) => {
  return sim.units.some((unit) => unit.alive && unit.side === "enemy" && unit.homeIsland === island);
};

/** Cleared, then held, then sunk: the life of an enemy island after its last monster. */
const stepIslandStates = (sim: TCleanupSim) => {
  const player = sim.islands[0];

  for (const island of sim.islands) {
    if (island.side !== "enemy") {
      continue;
    }

    const age = (sim.tick - island.stateTick) * TICK_SECONDS;

    if (island.state === "active" && !garrisonAlive(sim, island.index)) {
      island.state = "cleared";
      island.stateTick = sim.tick;
      // A cleared island is a husk: the player's island may shove it aside.
      island.body.anchored = false;
      const toward = player ? islandCenter(player) : { x: 0, y: 0 };
      island.rewardHexes = island.hexes
        .map((_, index) => index)
        .sort((a, b) => {
          const da = Math.hypot(island.body.x + (island.body.localX[a] as number) - toward.x, island.body.y + (island.body.localY[a] as number) - toward.y);
          const db = Math.hypot(island.body.x + (island.body.localX[b] as number) - toward.x, island.body.y + (island.body.localY[b] as number) - toward.y);

          return da - db;
        })
        .slice(0, island.reward);

      for (const index of island.rewardHexes) {
        const hex = island.hexes[index] as TCleanupHex;
        sim.annexed.push({ biome: hex.biome, toxicity: hex.toxicity });
      }

      pushEvent(sim, { type: "cleared", island: island.index });

      continue;
    }

    if (island.state === "cleared" && age >= CLEARED_HOLD) {
      const occupied = sim.units.some((unit) => {
        return unit.alive && unit.side === "enemy" && unit.node >= 0 && sim.nodeIsland[unit.node] === island.index;
      });
      if (occupied) {
        continue;
      }

      // Anyone still on the island is carried home before it goes under.
      if (player) {
        const homeNodes = spawnNodes(player, sim.rng, -1);
        let slot = 0;
        for (const unit of sim.units) {
          if (!unit.alive || unit.node < 0) {
            continue;
          }

          const onIsland = sim.nodeIsland[unit.node] === island.index;
          const heading = unit.nextNode >= 0 && sim.nodeIsland[unit.nextNode] === island.index;
          if (!onIsland && !heading) {
            continue;
          }

          const node = homeNodes[slot % homeNodes.length] as number;
          slot += 1;
          pushEvent(sim, { type: "ferry", x: unit.x, y: unit.y });
          unit.node = node;
          unit.nextNode = -1;
          unit.idlePath = [];
          const target = slotIn(sim, unit, node, node);
          unit.lx = target.x;
          unit.ly = target.y;
          unit.x = player.body.x + target.x;
          unit.y = player.body.y + target.y;
          unit.px = unit.x;
          unit.py = unit.y;
          pushEvent(sim, { type: "ferry", x: unit.x, y: unit.y });
        }
      }

      island.state = "sinking";
      island.stateTick = sim.tick;
      island.body.solid = false;

      continue;
    }

    if (island.state === "sinking" && age >= SINK_SECONDS) {
      island.state = "sunk";
      island.stateTick = sim.tick;
      pushEvent(sim, { type: "sunk", island: island.index });
    }
  }
};

const stepStatus = (sim: TCleanupSim) => {
  if (sim.status !== "running") {
    return;
  }

  const enemies = sim.islands.filter((island) => island.side === "enemy");
  // A level with no enemy islands ends at once: there is nothing to clear.
  const allSunk = enemies.every((island) => island.state === "sunk");
  // Defeat is the last building or the stronghold falling. A wiped army alone
  // does not end the battle: the stronghold keeps shooting.
  const islandRuined = sim.structuresAtStart > 0 && !sim.units.some((unit) => unit.alive && isStructure(unit));

  if (!allSunk && !islandRuined) {
    sim.endingTick = -1;

    return;
  }

  if (sim.endingTick < 0) {
    sim.endingTick = sim.tick;
  }

  const waited = (sim.tick - sim.endingTick) * TICK_SECONDS;
  if (islandRuined && waited >= LOSS_DELAY) {
    sim.status = "lost";
  } else if (allSunk && !islandRuined && waited >= WIN_DELAY) {
    sim.status = "won";
  }
};

/**
 * The retreat costs the units that are not home: a ground unit standing on
 * another island stays behind and is lost. Flyers keep up with the island.
 */
const leaveBattle = (sim: TCleanupSim) => {
  for (const unit of sim.units) {
    if (!unit.alive || unit.side !== "player" || unit.node < 0) {
      continue;
    }

    if (sim.nodeIsland[unit.node] !== 0) {
      unit.alive = false;
      unit.hp = 0;
      sim.lost.push(unit.kind as TUnitId);
      pushEvent(sim, { type: "death", x: unit.x, y: unit.y, icon: unit.stats.icon, side: unit.side });
    }
  }

  sim.units = sim.units.filter((unit) => unit.alive);
  sim.status = "retreated";
};

/** Fills the retreat while the player's island stays in the band by the border. */
const stepRetreat = (sim: TCleanupSim, dt: number) => {
  sim.inRetreatBand = borderGap(sim) < RETREAT_BAND;

  if (sim.inRetreatBand) {
    sim.retreatProgress = Math.min(1, sim.retreatProgress + dt / RETREAT_SECONDS);
  } else {
    sim.retreatProgress = Math.max(0, sim.retreatProgress - (dt * RETREAT_DRAIN) / RETREAT_SECONDS);
  }

  if (sim.retreatProgress >= 1 && sim.status === "running") {
    leaveBattle(sim);
  }
};

/** One fixed tick of the whole level. Does nothing once the level has ended. */
const stepCleanup = (sim: TCleanupSim) => {
  if (sim.status !== "running") {
    return;
  }

  const dt = TICK_SECONDS;
  sim.tick += 1;

  steerIslands(sim, dt);
  refreshWorld(sim);

  for (const unit of sim.units) {
    unit.px = unit.x;
    unit.py = unit.y;
    unit.cooldown -= dt;
    if (unit.node < 0) {
      unit.hoverNode = hoverNodeAt(sim, unit.x, unit.y);
    }
  }

  buildFlow(sim, "enemy", sim.flowToEnemy);
  buildFlow(sim, "player", sim.flowToPlayer);

  for (const unit of sim.units) {
    if (!unit.alive) {
      continue;
    }

    if (isStructure(unit)) {
      stepStructure(sim, unit);

      continue;
    }

    if (unit.node < 0) {
      stepFlyer(sim, unit, dt);
    } else {
      stepGroundUnit(sim, unit, dt);
    }

    if (unit.side === "player" && unit.hp < unit.maxHp && (sim.tick - unit.lastHurtTick) * dt > REGEN_DELAY) {
      unit.hp = Math.min(unit.maxHp, unit.hp + unit.maxHp * REGEN_SHARE_PER_SECOND * dt);
    }
  }

  const byId = new Map(sim.units.map((unit) => [unit.id, unit]));
  stepProjectiles(sim, byId, dt);

  // Ground units ride their island: the world position follows the local one.
  for (const unit of sim.units) {
    if (unit.node < 0) {
      continue;
    }

    const island = sim.islands[sim.nodeIsland[unit.node] as number] as TSimIsland;
    unit.x = island.body.x + unit.lx;
    unit.y = island.body.y + unit.ly;
  }

  sim.units = sim.units.filter((unit) => unit.alive);
  stepIslandStates(sim);
  stepStatus(sim);
  stepRetreat(sim, dt);
};

/**
 * Ends a level that is still running as a retreat, at the same cost as
 * sailing out through the border. Only the turn flow calls it, as a safety
 * net when the phase moves on without the level having ended.
 */
const retreatCleanup = (sim: TCleanupSim) => {
  if (sim.status === "running") {
    leaveBattle(sim);
  }
};

const setCleanupInput = (sim: TCleanupSim, x: number, y: number) => {
  sim.input.x = Math.max(-1, Math.min(1, x));
  sim.input.y = Math.max(-1, Math.min(1, y));
};

/** Takes the events queued since the last call. */
const drainEvents = (sim: TCleanupSim) => {
  const events = sim.events;
  sim.events = [];

  return events;
};

type TIslandSummary = {
  readonly id: string;
  readonly label: string;
  readonly state: TIslandState;
  readonly alive: number;
  readonly total: number;
  readonly kinds: readonly TEnemyId[];
  readonly reward: number;
};

type TCleanupHud = {
  readonly status: TSimStatus;
  readonly alive: Readonly<Partial<Record<TUnitId, number>>>;
  readonly aliveTotal: number;
  readonly kills: number;
  readonly islands: readonly TIslandSummary[];
  readonly inRetreatBand: boolean;
  /** Rounded to tenths, so the HUD updates a few times per second, not every tick. */
  readonly retreatProgress: number;
  readonly buildingsStanding: number;
  readonly buildingsTotal: number;
  /** The stronghold's hp in percent, rounded, or -1 when the island has none. */
  readonly strongholdPct: number;
};

/** The counts the HUD shows. Cheap enough to take every tick. */
const summarizeCleanup = (sim: TCleanupSim): TCleanupHud => {
  const alive: Partial<Record<TUnitId, number>> = {};
  let aliveTotal = 0;

  let buildingsStanding = 0;

  for (const unit of sim.units) {
    if (unit.alive && isStructure(unit)) {
      buildingsStanding += 1;

      continue;
    }

    if (unit.alive && unit.side === "player") {
      const kind = unit.kind as TUnitId;
      alive[kind] = (alive[kind] ?? 0) + 1;
      aliveTotal += 1;
    }
  }

  const islands = sim.islands
    .filter((island) => island.side === "enemy")
    .map((island) => {
      const garrison = sim.units.filter((unit) => unit.alive && unit.side === "enemy" && unit.homeIsland === island.index);

      return {
        id: island.id,
        label: island.label,
        state: island.state,
        alive: garrison.length,
        total: island.garrisonTotal,
        kinds: [...new Set(garrison.map((unit) => unit.kind as TEnemyId))],
        reward: island.reward,
      };
    });

  return {
    status: sim.status,
    alive,
    aliveTotal,
    kills: sim.kills,
    islands,
    inRetreatBand: sim.inRetreatBand,
    retreatProgress: Math.round(sim.retreatProgress * 10) / 10,
    buildingsStanding,
    buildingsTotal: sim.structuresAtStart,
    strongholdPct: strongholdPct(sim),
  };
};

const strongholdPct = (sim: TCleanupSim) => {
  const player = sim.islands[0];
  const index = player ? player.hexes.findIndex((hex) => hex.stronghold) : -1;
  const hex = player && index >= 0 ? player.hexes[index] : null;
  if (!hex || hex.maxHp <= 0) {
    return -1;
  }

  return Math.round((Math.max(0, sim.structureHp[index] as number) / hex.maxHp) * 100);
};

type TCleanupOutcome = "won" | "lost" | "retreated" | "calm";

type TCleanupResult = {
  readonly outcome: TCleanupOutcome;
  readonly totalIslands: number;
  readonly clearedIslands: number;
  readonly annexed: readonly TAnnexedHex[];
  readonly survivors: readonly TUnitId[];
  readonly lost: readonly TUnitId[];
  readonly kills: number;
  /** Every structure of the player's island after the battle, by hex id. */
  readonly structures: readonly { readonly hexId: string; readonly hp: number; readonly startHp: number; readonly maxHp: number }[];
  readonly razed: number;
};

/** What the level ends with. A level with no enemy islands is a calm sea. */
const cleanupResult = (sim: TCleanupSim): TCleanupResult => {
  const enemies = sim.islands.filter((island) => island.side === "enemy");
  const survivors = sim.units
    .filter((unit) => unit.alive && unit.side === "player" && !isStructure(unit))
    .map((unit) => unit.kind as TUnitId);
  const player = sim.islands[0];
  const structures = (player?.hexes ?? [])
    .map((hex, index) => ({ hexId: hex.id, hp: Math.round(Math.max(0, sim.structureHp[index] as number)), startHp: hex.hp, maxHp: hex.maxHp }))
    .filter((entry) => entry.maxHp > 0);
  let outcome: TCleanupOutcome = sim.status === "running" ? "retreated" : sim.status;
  if (enemies.length === 0) {
    outcome = "calm";
  }

  return {
    outcome,
    totalIslands: enemies.length,
    clearedIslands: enemies.filter((island) => island.state !== "active").length,
    // A lost battle claims nothing: the island is in ruins.
    annexed: sim.status === "lost" ? [] : [...sim.annexed],
    survivors,
    lost: [...sim.lost],
    kills: sim.kills,
    structures,
    razed: sim.razed,
  };
};

export type {
  TCleanupHud,
  TCleanupOutcome,
  TCleanupResult,
  TCleanupSim,
  TIslandState,
  TIslandSummary,
  TSimEvent,
  TSimIsland,
  TSimProjectile,
  TSimStatus,
  TSimUnit,
};
export {
  cleanupResult,
  CLEARED_HOLD,
  createCleanup,
  drainEvents,
  RETREAT_BAND,
  retreatCleanup,
  setCleanupInput,
  SINK_SECONDS,
  stepCleanup,
  summarizeCleanup,
  TICK_HZ,
  TICK_SECONDS,
};
