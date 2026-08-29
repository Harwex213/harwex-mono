import { axialKey, axialNeighbours } from "../hex/coords";
import { moveCostOf } from "../world/terrain";
import type { TArmy, TWorld } from "../world/types";

/**
 * One Dijkstra serves both jobs an army has: where it may walk this turn, and
 * what it may hit. Attacks are not extra nodes in the graph — an army attacks
 * from a tile it can stand on, with at least one movement point left over.
 */

type TMovementInput = {
  world: TWorld;
  army: TArmy;
  /** Tiles held by an army of the other side, plus their structures. */
  hostileKeys: ReadonlySet<string>;
  /** Tiles held by an army of the same side. Walk through, do not stop. */
  friendlyKeys: ReadonlySet<string>;
  /** Movement points to spend. `Infinity` maps the whole island for the AI. */
  budget: number;
};

type TMovementMap = {
  /** Movement points spent to reach each tile. */
  costs: ReadonlyMap<string, number>;
  cameFrom: ReadonlyMap<string, string>;
  /** Tiles the army may end its move on. */
  destinations: ReadonlySet<string>;
  /** Hostile tile to the tile the attack would be launched from. */
  attacks: ReadonlyMap<string, string>;
};

const computeMovement = (input: TMovementInput): TMovementMap => {
  const { world, army, hostileKeys, friendlyKeys, budget } = input;

  const costs = new Map<string, number>([[army.key, 0]]);
  const cameFrom = new Map<string, string>();
  const settled = new Set<string>();
  const open = new Set<string>([army.key]);

  while (open.size > 0) {
    let currentKey = "";
    let currentCost = Number.POSITIVE_INFINITY;
    for (const key of open) {
      const cost = costs.get(key)!;
      if (cost < currentCost) {
        currentCost = cost;
        currentKey = key;
      }
    }

    open.delete(currentKey);
    settled.add(currentKey);

    const tile = world.tiles.get(currentKey);
    if (!tile) {
      continue;
    }

    for (const neighbour of axialNeighbours(tile.cell)) {
      const neighbourKey = axialKey(neighbour.q, neighbour.r);
      const neighbourTile = world.tiles.get(neighbourKey);
      if (!neighbourTile || settled.has(neighbourKey)) {
        continue;
      }
      // A hostile tile is a target, never a step: the army stops in front of it.
      if (hostileKeys.has(neighbourKey)) {
        continue;
      }

      const stepCost = moveCostOf(neighbourTile.terrain);
      if (!Number.isFinite(stepCost)) {
        continue;
      }

      const total = currentCost + stepCost;
      if (total > budget) {
        continue;
      }
      if (total >= (costs.get(neighbourKey) ?? Number.POSITIVE_INFINITY)) {
        continue;
      }

      costs.set(neighbourKey, total);
      cameFrom.set(neighbourKey, currentKey);
      open.add(neighbourKey);
    }
  }

  const destinations = new Set<string>();
  for (const key of costs.keys()) {
    if (key === army.key || friendlyKeys.has(key)) {
      continue;
    }
    destinations.add(key);
  }

  // An attack costs the last movement point, so the launch tile must be
  // reachable with something still in hand.
  const attacks = new Map<string, string>();
  for (const [key, cost] of costs) {
    if (cost >= budget) {
      continue;
    }
    if (key !== army.key && friendlyKeys.has(key)) {
      continue;
    }

    const tile = world.tiles.get(key);
    if (!tile) {
      continue;
    }

    for (const neighbour of axialNeighbours(tile.cell)) {
      const neighbourKey = axialKey(neighbour.q, neighbour.r);
      if (!hostileKeys.has(neighbourKey)) {
        continue;
      }
      const known = attacks.get(neighbourKey);
      if (known !== undefined && costs.get(known)! <= cost) {
        continue;
      }
      attacks.set(neighbourKey, key);
    }
  }

  return { costs, cameFrom, destinations, attacks };
};

/** The tiles walked to get from the army to `target`, `target` last. */
const buildPath = (cameFrom: ReadonlyMap<string, string>, fromKey: string, targetKey: string): string[] => {
  const path: string[] = [];
  let cursor = targetKey;

  while (cursor !== fromKey) {
    path.unshift(cursor);
    const previous = cameFrom.get(cursor);
    if (previous === undefined) {
      return [];
    }
    cursor = previous;
  }

  return path;
};

/** The longest prefix of `path` the army can pay for out of `budget`. */
const trimPathToBudget = (world: TWorld, path: readonly string[], budget: number): string[] => {
  const affordable: string[] = [];
  let spent = 0;

  for (const key of path) {
    const tile = world.tiles.get(key);
    if (!tile) {
      break;
    }
    spent += moveCostOf(tile.terrain);
    if (spent > budget) {
      break;
    }
    affordable.push(key);
  }

  return affordable;
};

export type { TMovementInput, TMovementMap };
export { buildPath, computeMovement, trimPathToBudget };
