import { distancesFrom, getCell } from "./world-gen";
import type { TWorld, TWorldCell } from "./world-gen";

/**
 * The rules of the scouting phase, kept pure so the actions, the cell panel
 * and the globe all read the same answer.
 *
 * - Fog. A cell is `revealed` once scouted or visited. An unrevealed cell that
 *   touches a revealed one is `frontier`: the player can scout it. Every other
 *   cell is `fogged`: the player sees the land and sea from orbit, but nothing
 *   on them.
 * - Scouting. One action reveals one frontier cell. It costs
 *   `ceil(distance / 2)` scouting, at least 1, where the distance counts
 *   flights from the player's cell. Scouting reveals the biome, the wild
 *   islands, a rival sitting there and the toxic trail.
 * - Moving. One flight per turn, to a neighbouring cell with no other player
 *   in it, whatever its kind: the island flies over void clouds and may stop
 *   at a settlement. The flight reveals the cell it lands in. Landing in an
 *   `island` cell activates it: its wild islands become the cleanup fight at
 *   the end of the turn, and every turn after, until they are all cleared.
 * - Void and settlement cells hold no fight. A settlement has no effect yet.
 */

type TCellVisibility = "revealed" | "frontier" | "fogged";

type TCheck = {
  readonly ok: boolean;
  /** Why the action is refused. Empty when `ok` is true. */
  readonly reason: string;
};

type TScoutCheck = TCheck & {
  readonly cost: number;
  /** Flights from the player's cell, or -1 when unreachable. */
  readonly distance: number;
};

const cellVisibility = (world: TWorld, cell: TWorldCell): TCellVisibility => {
  if (cell.revealed) {
    return "revealed";
  }

  const touchesKnown = cell.neighbors.some((id) => getCell(world, id)?.revealed === true);

  return touchesKnown ? "frontier" : "fogged";
};

const scoutCost = (distance: number) => Math.max(1, Math.ceil(distance / 2));

const scoutCheck = (world: TWorld, fromCellId: string, cellId: string, scouting: number): TScoutCheck => {
  const from = getCell(world, fromCellId);
  const cell = getCell(world, cellId);
  if (!from || !cell) {
    return { ok: false, reason: "Гекс не найден", cost: 0, distance: -1 };
  }

  const distance = distancesFrom(world.cells, from.index)[cell.index] ?? -1;
  const cost = scoutCost(distance);
  const visibility = cellVisibility(world, cell);

  if (visibility === "revealed") {
    return { ok: false, reason: "Гекс уже разведан", cost, distance };
  }

  if (visibility === "fogged") {
    return { ok: false, reason: "Слишком далеко: сначала разведайте соседний гекс", cost, distance };
  }

  if (scouting < cost) {
    return { ok: false, reason: `Не хватает разведки: нужно ${cost}`, cost, distance };
  }

  return { ok: true, reason: "", cost, distance };
};

const moveCheck = (world: TWorld, fromCellId: string, cellId: string, movedThisTurn: boolean): TCheck => {
  const from = getCell(world, fromCellId);
  const cell = getCell(world, cellId);
  if (!from || !cell) {
    return { ok: false, reason: "Гекс не найден" };
  }

  if (cell.id === from.id) {
    return { ok: false, reason: "Остров уже здесь" };
  }

  if (movedThisTurn) {
    return { ok: false, reason: "Остров уже перелетал в этом ходу" };
  }

  if (!from.neighbors.includes(cell.id)) {
    return { ok: false, reason: "Перелететь можно только в соседний гекс" };
  }

  if (cell.ownerId !== null) {
    return { ok: false, reason: "Гекс занят другим островом" };
  }

  return { ok: true, reason: "" };
};

/** The wild islands the cleanup phase fights in this cell. */
const pendingIslands = (cell: TWorldCell | null) => {
  if (!cell || cell.kind !== "island" || !cell.activated || cell.cleared) {
    return 0;
  }

  return cell.islandCount;
};

/** The free neighbours the island can fly to this turn. */
const reachableCellIds = (world: TWorld, fromCellId: string, movedThisTurn: boolean) => {
  const from = getCell(world, fromCellId);
  if (!from || movedThisTurn) {
    return [];
  }

  return from.neighbors.filter((id) => moveCheck(world, fromCellId, id, false).ok);
};

export type { TCellVisibility, TCheck, TScoutCheck };
export { cellVisibility, moveCheck, pendingIslands, reachableCellIds, scoutCheck, scoutCost };
