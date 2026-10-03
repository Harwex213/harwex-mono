import { attackWith, moveArmyAlong } from "./army-actions";
import { boardViewOf, findArmy } from "./engine";
import { axialDistance } from "./hex/coords";
import { movementFor } from "./rules/board";
import { buildPath, trimPathToBudget } from "./rules/movement";
import type { TBoardView } from "./rules/board";
import type { TArmy } from "./world/types";
import type { TStore } from "../store/store";

/**
 * The clan is simple on purpose: it walks at whatever hurts most and hits it.
 * It plays through the same actions the player does, one army at a time, with
 * a pause between them so the board stays readable.
 */

/** Pause between two enemy armies taking their turn. */
const ENEMY_STEP_MS = 240;

/** How long the hit marker stays up before the next army moves. */
const STRIKE_MS = 320;

/** An army this close to the camp guards it instead of marching out. */
const GUARD_RADIUS = 2;

/** A player force this close to the camp wakes the guard up. */
const ALERT_RADIUS = 4;

type TThreat = {
  key: string;
  /** Higher is more worth attacking. */
  value: number;
};

const playerThreats = (view: TBoardView): TThreat[] => {
  const threats: TThreat[] = [];

  for (const army of view.armies) {
    if (army.owner !== "player") {
      continue;
    }
    // A wounded army is the cheapest kill, so it is the most attractive one.
    threats.push({ key: army.key, value: 60 + (army.maxHp - army.hp) * 2 - army.attack });
  }

  for (const structure of view.structures) {
    if (structure.owner !== "player" || structure.hp <= 0) {
      continue;
    }
    threats.push({ key: structure.key, value: 80 + (structure.maxHp - structure.hp) });
  }

  return threats;
};

/** True while nothing of the player's is near enough to pull the guard away. */
const shouldGuardCamp = (view: TBoardView, army: TArmy): boolean => {
  const camp = view.structures.find((structure) => structure.kind === "camp");
  const campTile = camp ? view.world.tiles.get(camp.key) : undefined;
  const armyTile = view.world.tiles.get(army.key);
  if (!campTile || !armyTile) {
    return false;
  }
  if (axialDistance(campTile.cell, armyTile.cell) > GUARD_RADIUS) {
    return false;
  }

  const guards = view.armies.filter((other) => {
    const tile = other.owner === "enemy" ? view.world.tiles.get(other.key) : undefined;

    return tile !== undefined && axialDistance(campTile.cell, tile.cell) <= GUARD_RADIUS;
  });
  // The last defender stays home; anything beyond the first one marches.
  if (guards.length > 1 && guards[0]!.id !== army.id) {
    return false;
  }

  return !playerThreats(view).some((threat) => {
    const tile = view.world.tiles.get(threat.key);

    return tile !== undefined && axialDistance(campTile.cell, tile.cell) <= ALERT_RADIUS;
  });
};

/** Picks the best attack out of what the army can already reach. */
const bestAttack = (threats: readonly TThreat[], reachable: ReadonlySet<string>): TThreat | null =>
  threats
    .filter((threat) => reachable.has(threat.key))
    .sort((a, b) => b.value - a.value)[0] ?? null;

/** Runs one enemy army and reports how long its move takes to play out. */
const actWithEnemyArmy = (store: TStore, id: number): number => {
  const view = boardViewOf(store);
  const army = findArmy(store, id);
  if (!view || !army || army.owner !== "enemy" || army.movementLeft <= 0 || army.hasAttacked) {
    return 0;
  }
  if (shouldGuardCamp(view, army)) {
    return 0;
  }

  const threats = playerThreats(view);
  if (threats.length === 0) {
    return 0;
  }

  const reach = movementFor(view, army, army.movementLeft);
  const immediate = bestAttack(threats, new Set(reach.attacks.keys()));
  if (immediate) {
    attackWith(store, army, immediate.key, reach);

    return STRIKE_MS;
  }

  // Nothing in range: route across the whole island and walk as far as the
  // movement points allow, then look again for something to hit.
  const full = movementFor(view, army, Number.POSITIVE_INFINITY);
  let goalKey = "";
  let goalScore = Number.NEGATIVE_INFINITY;

  for (const threat of threats) {
    const cost = full.attacks.has(threat.key) ? full.costs.get(full.attacks.get(threat.key)!)! : null;
    if (cost === null) {
      continue;
    }
    const score = threat.value - cost * 6;
    if (score > goalScore) {
      goalScore = score;
      goalKey = full.attacks.get(threat.key)!;
    }
  }

  if (goalKey === "" || goalKey === army.key) {
    return 0;
  }

  const path = trimPathToBudget(view.world, buildPath(full.cameFrom, army.key, goalKey), army.movementLeft);
  const blocked = new Set([...view.armies.map((other) => other.key)]);
  while (path.length > 0 && blocked.has(path[path.length - 1]!)) {
    path.pop();
  }
  if (path.length === 0) {
    return 0;
  }

  const moveMs = moveArmyAlong(store, army, path);

  const movedView = boardViewOf(store);
  const movedArmy = findArmy(store, id);
  if (!movedView || !movedArmy || movedArmy.movementLeft <= 0) {
    return moveMs;
  }

  const afterMove = movementFor(movedView, movedArmy, movedArmy.movementLeft);
  const follow = bestAttack(playerThreats(movedView), new Set(afterMove.attacks.keys()));
  if (!follow) {
    return moveMs;
  }

  attackWith(store, movedArmy, follow.key, afterMove, moveMs);

  return moveMs + STRIKE_MS;
};

/** Plays the whole enemy turn, then hands control back through `onFinished`. */
const runEnemyTurn = (store: TStore, onFinished: () => void) => {
  const queue = store.gameState.armies
    .peek()
    .filter((army) => army.owner === "enemy")
    .map((army) => army.id);

  const step = () => {
    if (store.gameState.outcome.peek() !== "playing") {
      onFinished();

      return;
    }

    const id = queue.shift();
    if (id === undefined) {
      onFinished();

      return;
    }

    const duration = actWithEnemyArmy(store, id);
    window.setTimeout(step, duration > 0 ? duration + ENEMY_STEP_MS : 0);
  };

  window.setTimeout(step, ENEMY_STEP_MS);
};

export { ENEMY_STEP_MS, runEnemyTurn };
