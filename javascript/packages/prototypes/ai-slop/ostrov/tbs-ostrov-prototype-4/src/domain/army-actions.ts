import {
  boardViewOf,
  checkOutcome,
  combatRng,
  findArmy,
  patchArmy,
  patchStructure,
  pushLog,
  refreshVision,
  removeArmy,
} from "./engine";
import { armyAt, movementFor, structureAt } from "./rules/board";
import { resolveArmyAttack, resolveStructureAttack } from "./rules/combat";
import { buildPath } from "./rules/movement";
import { moveCostOf } from "./world/terrain";
import type { TMovementMap } from "./rules/movement";
import type { TArmy } from "./world/types";
import type { TStore } from "../store/store";

/**
 * Everything an army can be told to do. The enemy turn calls the same three
 * functions the mouse does, so the AI can never take a move the player could
 * not have taken from the same position.
 */

/** How long one tile of a move takes on screen. */
const MOVE_STEP_MS = 130;

const selectArmyAction = (store: TStore, id: number) => {
  if (store.gameState.outcome.peek() !== "playing") {
    return;
  }

  const army = findArmy(store, id);
  if (id !== -1 && (!army || army.owner !== "player")) {
    return;
  }

  store.selectionState.selectedArmyId.value = store.selectionState.selectedArmyId.peek() === id ? -1 : id;
};

const hoverTileAction = (store: TStore, key: string) => {
  if (store.selectionState.hoveredKey.peek() === key) {
    return;
  }

  store.selectionState.hoveredKey.value = key;
};

/** Cycles through the player armies that still have movement points. */
const selectNextArmyAction = (store: TStore) => {
  const armies = store.gameState.armies.peek().filter((army) => army.owner === "player");
  const ready = armies.filter((army) => army.movementLeft > 0 && !army.hasAttacked);
  if (ready.length === 0) {
    return;
  }

  const currentId = store.selectionState.selectedArmyId.peek();
  const currentIndex = ready.findIndex((army) => army.id === currentId);

  store.selectionState.selectedArmyId.value = ready[(currentIndex + 1) % ready.length]!.id;
};

/** The movement points `path` costs, counting the tile stepped onto each time. */
const pathCost = (store: TStore, path: readonly string[]): number => {
  const view = boardViewOf(store);
  if (!view) {
    return 0;
  }

  return path.reduce((total, key) => {
    const tile = view.world.tiles.get(key);

    return tile ? total + moveCostOf(tile.terrain) : total;
  }, 0);
};

/**
 * Applies the move at once and hands the path to the renderer to replay. The
 * state never waits on an animation, so a fast second click is always safe.
 */
const moveArmyAlong = (store: TStore, army: TArmy, path: readonly string[]): number => {
  if (path.length === 0) {
    return 0;
  }

  const spent = pathCost(store, path);
  const destination = path[path.length - 1]!;

  store.animationState.move.value = {
    armyId: army.id,
    fromKey: army.key,
    path,
    startedAt: performance.now(),
    stepMs: MOVE_STEP_MS,
  };

  patchArmy(store, army.id, {
    key: destination,
    movementLeft: Math.max(0, army.movementLeft - spent),
    restedTurns: 0,
  });
  refreshVision(store);

  return path.length * MOVE_STEP_MS;
};

/**
 * Resolves an attack, walking the attacker to its launch tile first.
 * `baseDelay` holds the hit marker back until an earlier move has played out.
 */
const attackWith = (
  store: TStore,
  army: TArmy,
  targetKey: string,
  movement: TMovementMap,
  baseDelay = 0
): boolean => {
  const view = boardViewOf(store);
  if (!view) {
    return false;
  }

  const launchKey = movement.attacks.get(targetKey);
  if (launchKey === undefined) {
    return false;
  }

  let delay = baseDelay;
  if (launchKey !== army.key) {
    delay += moveArmyAlong(store, army, buildPath(movement.cameFrom, army.key, launchKey));
  }

  const attacker = findArmy(store, army.id);
  const targetTile = view.world.tiles.get(targetKey);
  if (!attacker || !targetTile) {
    return false;
  }

  const rng = combatRng(store);
  const defenderArmy = armyAt(view.armies, targetKey);
  const defenderStructure = structureAt(view.structures, targetKey);

  let damageToDefender = 0;
  let damageToAttacker = 0;
  let fatal = false;
  let defenderName = "";

  if (defenderArmy) {
    const outcome = resolveArmyAttack(attacker, defenderArmy, targetTile, rng);
    damageToDefender = outcome.damageToDefender;
    damageToAttacker = outcome.damageToAttacker;
    defenderName = defenderArmy.name;
    fatal = defenderArmy.hp - damageToDefender <= 0;

    if (fatal) {
      removeArmy(store, defenderArmy.id);
    } else {
      patchArmy(store, defenderArmy.id, { hp: defenderArmy.hp - damageToDefender, restedTurns: 0 });
    }
  } else if (defenderStructure) {
    const outcome = resolveStructureAttack(attacker, defenderStructure, targetTile, rng);
    damageToDefender = outcome.damageToDefender;
    damageToAttacker = outcome.damageToAttacker;
    defenderName = defenderStructure.name;
    fatal = defenderStructure.hp - damageToDefender <= 0;

    patchStructure(store, defenderStructure.id, Math.max(0, defenderStructure.hp - damageToDefender));
  } else {
    return false;
  }

  const attackerSurvives = attacker.hp - damageToAttacker > 0;
  if (attackerSurvives) {
    patchArmy(store, attacker.id, {
      hp: attacker.hp - damageToAttacker,
      movementLeft: 0,
      hasAttacked: true,
      restedTurns: 0,
    });
  } else {
    removeArmy(store, attacker.id);
  }

  store.animationState.strike.value = {
    key: targetKey,
    startAt: performance.now() + delay,
    damage: damageToDefender,
    fatal,
  };

  const tone = attacker.owner === "player" ? "combat" : "enemy";
  pushLog(
    store,
    tone,
    `${attacker.name} → ${defenderName}: −${damageToDefender}, в ответ −${damageToAttacker}.` +
      (fatal ? " Цель уничтожена." : "") +
      (attackerSurvives ? "" : " Атакующий погиб.")
  );

  refreshVision(store);
  checkOutcome(store);

  return true;
};

/**
 * The one gesture the board understands. A click either picks up an army,
 * sends the one in hand somewhere, or lets it go.
 */
const clickTileAction = (store: TStore, key: string) => {
  if (store.gameState.outcome.peek() !== "playing" || store.gameState.phase.peek() !== "player") {
    return;
  }

  const view = boardViewOf(store);
  if (!view) {
    return;
  }

  const clickedArmy = armyAt(view.armies, key);
  if (clickedArmy && clickedArmy.owner === "player") {
    store.selectionState.selectedArmyId.value = clickedArmy.id;

    return;
  }

  const selected = findArmy(store, store.selectionState.selectedArmyId.peek());
  if (!selected || selected.owner !== "player") {
    return;
  }
  if (selected.movementLeft <= 0 || selected.hasAttacked) {
    return;
  }

  const movement = movementFor(view, selected, selected.movementLeft);

  if (movement.attacks.has(key)) {
    attackWith(store, selected, key, movement);

    return;
  }

  if (movement.destinations.has(key)) {
    const path = buildPath(movement.cameFrom, selected.key, key);
    if (path.length > 0) {
      moveArmyAlong(store, selected, path);
    }

    return;
  }

  store.selectionState.selectedArmyId.value = -1;
};

export { MOVE_STEP_MS, attackWith, clickTileAction, hoverTileAction, moveArmyAlong, selectArmyAction, selectNextArmyAction };
