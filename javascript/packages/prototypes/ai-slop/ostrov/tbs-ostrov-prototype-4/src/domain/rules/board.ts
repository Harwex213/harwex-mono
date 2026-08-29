import { AXIAL_DIRECTIONS, axialKey } from "../hex/coords";
import { computeMovement } from "./movement";
import type { TMovementMap } from "./movement";
import type { TArmy, TFactionId, TStructure, TWorld } from "../world/types";

/**
 * A read-only snapshot of the board, passed to anything that has to reason
 * about who stands where: the click handler, the enemy plan, the renderer.
 */

type TBoardView = {
  world: TWorld;
  armies: readonly TArmy[];
  structures: readonly TStructure[];
};

const armyAt = (armies: readonly TArmy[], key: string): TArmy | null =>
  armies.find((army) => army.key === key) ?? null;

const structureAt = (structures: readonly TStructure[], key: string): TStructure | null =>
  structures.find((structure) => structure.key === key) ?? null;

/** Tiles an army of `faction` may not walk onto, because a target stands there. */
const hostileKeysFor = (view: TBoardView, faction: TFactionId): Set<string> => {
  const keys = new Set<string>();

  for (const army of view.armies) {
    if (army.owner !== faction) {
      keys.add(army.key);
    }
  }
  for (const structure of view.structures) {
    if (structure.owner !== faction) {
      keys.add(structure.key);
    }
  }

  return keys;
};

/** Tiles held by the army's own side. It may pass through, not stop. */
const friendlyKeysFor = (view: TBoardView, army: TArmy): Set<string> => {
  const keys = new Set<string>();

  for (const other of view.armies) {
    if (other.owner === army.owner && other.id !== army.id) {
      keys.add(other.key);
    }
  }

  return keys;
};

const movementFor = (view: TBoardView, army: TArmy, budget: number): TMovementMap =>
  computeMovement({
    world: view.world,
    army,
    hostileKeys: hostileKeysFor(view, army.owner),
    friendlyKeys: friendlyKeysFor(view, army),
    budget,
  });

/** The first free land tile at or next to `key`, breadth-first. */
const nearestFreeLandTile = (view: TBoardView, key: string, blocked: ReadonlySet<string>): string | null => {
  const start = view.world.tiles.get(key);
  if (!start) {
    return null;
  }

  const visited = new Set<string>([key]);
  const queue: string[] = [key];

  while (queue.length > 0) {
    const currentKey = queue.shift()!;
    const tile = view.world.tiles.get(currentKey)!;
    if (tile.terrain !== "sea" && !blocked.has(currentKey)) {
      return currentKey;
    }

    for (const neighbourKey of neighbourKeysOf(view.world, currentKey)) {
      if (visited.has(neighbourKey)) {
        continue;
      }
      visited.add(neighbourKey);
      queue.push(neighbourKey);
    }
  }

  return null;
};

const neighbourKeysOf = (world: TWorld, key: string): string[] => {
  const tile = world.tiles.get(key);
  if (!tile) {
    return [];
  }

  return AXIAL_DIRECTIONS.map((step) => axialKey(tile.cell.q + step.q, tile.cell.r + step.r)).filter((neighbourKey) =>
    world.tiles.has(neighbourKey)
  );
};

export type { TBoardView };
export { armyAt, friendlyKeysFor, hostileKeysFor, movementFor, nearestFreeLandTile, neighbourKeysOf, structureAt };
