import { showToastAction } from "./game-actions";
import { TECHS, addToxicity, isTechAvailable } from "../core/exports";
import { HUMAN_PLAYER_ID } from "../store/store";
import type { TTechId } from "../core/exports";
import type { TLogEntry } from "../store/game-state";
import type { TStore } from "../store/store";

/**
 * The technologies modal of plan §3.2: one tech is in research at a time, the
 * tax phase pays for it, and cancelling it keeps whatever 📖 it has already
 * collected.
 *
 * `addResearchAction` is the same arithmetic S5 runs inline at the end of the
 * tax phase. It exists so the dev hook and the probe can complete a tech
 * without waiting for a tax phase; S5's own copy was left untouched.
 *
 * The purge ritual of plan §3.3 lives here too: it is the only technology that
 * hands the player an action, and it works exactly like the demolish mode of
 * S4 — a cursor the tools column arms and the island canvas spends.
 */

const ALREADY_RESEARCHED_RU = "Эта технология уже изучена";
const LOCKED_RU = "Сначала нужно изучить требуемые технологии";

/** The technology that unlocks the purge cursor. */
const PURGE_TECH: TTechId = "purge_ritual";

/** One purge costs this much 💠 and takes this much ☣️ off the hex. */
const PURGE_MANA_COST = 5;
const PURGE_TOXICITY_DELTA = 20;

const PURGE_UNRESEARCHED_RU = "Сначала нужно изучить «Ритуал очищения»";
const PURGE_FOREIGN_ISLAND_RU = "Это чужой остров";
const PURGE_BUILD_PHASE_ONLY_RU = "Очищать гексы можно только в фазе строительства";
const PURGE_MODE_OFF_RU = "Сначала включите ритуал очищения";
const PURGE_CLEAN_HEX_RU = "На этом гексе нет токсичности";
const PURGE_NOT_AFFORDABLE_RU = `Не хватает маны: нужно ${PURGE_MANA_COST} 💠`;

const appendLogEntry = (store: TStore, textRu: string): void => {
  const entry: TLogEntry = {
    turn: store.game.turn.peek(),
    phase: store.game.phase.peek(),
    textRu,
  };

  store.game.log.value = [...store.game.log.peek(), entry];
};

/** The human row prints the tech count, so it follows every completed tech. */
const refreshTechCount = (store: TStore): void => {
  const techCount = store.game.researched.peek().length;

  store.game.players.value = store.game.players.peek().map((player) => {
    if (player.id !== HUMAN_PLAYER_ID) {
      return player;
    }

    return { ...player, techCount };
  });
};

const openTechModalAction = (store: TStore): void => {
  store.ui.techModalOpen.value = true;
};

const closeTechModalAction = (store: TStore): void => {
  store.ui.techModalOpen.value = false;
};

/**
 * Puts a tech in research. The tech already in research is cancelled when it is
 * passed again, and a researched or locked one is refused with a toast.
 */
const setResearchTargetAction = (store: TStore, tech: TTechId | null): void => {
  if (tech === null) {
    store.game.researching.value = null;

    return;
  }

  const researched = store.game.researched.peek();
  if (researched.includes(tech) === true) {
    showToastAction(store, ALREADY_RESEARCHED_RU);

    return;
  }

  if (isTechAvailable(tech, researched) === false) {
    showToastAction(store, LOCKED_RU);

    return;
  }

  if (store.game.researching.peek() === tech) {
    // The accumulated 📖 stays in `researchProgress`, so resuming later is free.
    store.game.researching.value = null;

    return;
  }

  store.game.researching.value = tech;
  appendLogEntry(store, `В исследовании: ${TECHS[tech].nameRu}`);
};

/** Adds 📖 to the tech in research and completes it once the cost is paid. */
const addResearchAction = (store: TStore, science: number): void => {
  const researching = store.game.researching.peek();
  if (researching === null || science <= 0) {
    return;
  }

  const progress = store.game.researchProgress.peek();
  const gained = (progress[researching] ?? 0) + science;
  store.game.researchProgress.value = { ...progress, [researching]: gained };

  if (gained < TECHS[researching].cost) {
    return;
  }

  store.game.researched.value = [...store.game.researched.peek(), researching];
  store.game.researching.value = null;
  appendLogEntry(store, `Изучено: ${TECHS[researching].nameRu}`);
  refreshTechCount(store);
};

/**
 * True when the player may purge right now. Every refusal raises its own toast,
 * the same way `canEditIsland` does for the build phase.
 */
const canPurge = (store: TStore): boolean => {
  if (store.game.researched.peek().includes(PURGE_TECH) === false) {
    showToastAction(store, PURGE_UNRESEARCHED_RU);

    return false;
  }

  if (store.derived.isReadonly.peek() === true) {
    showToastAction(store, PURGE_FOREIGN_ISLAND_RU);

    return false;
  }

  if (store.game.phase.peek() !== "build") {
    showToastAction(store, PURGE_BUILD_PHASE_ONLY_RU);

    return false;
  }

  return true;
};

/** Arms the purge cursor, or disarms it when it is already on. */
const togglePurgeAction = (store: TStore): void => {
  const active = store.ui.purgeMode.peek();
  if (active === false && canPurge(store) === false) {
    return;
  }

  store.ui.purgeMode.value = !active;
  store.ui.demolishMode.value = false;
  store.ui.armedBuilding.value = null;
};

/**
 * Plan §3.3: 5 💠 take 20 ☣️ off one hex, clamped at zero by `addToxicity`. The
 * cursor stays armed afterwards, so a whole island is cleaned without
 * re-arming between hexes.
 */
const purgeHexAction = (store: TStore, hexId: string): void => {
  if (store.ui.purgeMode.peek() === false) {
    showToastAction(store, PURGE_MODE_OFF_RU);

    return;
  }

  if (canPurge(store) === false) {
    return;
  }

  const island = store.derived.viewedIsland.peek();
  if (island === null) {
    return;
  }

  const hex = island.hexes[hexId];
  if (hex === undefined) {
    return;
  }

  if (hex.toxicity <= 0) {
    showToastAction(store, PURGE_CLEAN_HEX_RU);

    return;
  }

  const resources = store.game.resources.peek();
  if (resources.mana < PURGE_MANA_COST) {
    showToastAction(store, PURGE_NOT_AFFORDABLE_RU);

    return;
  }

  const removed = Math.min(hex.toxicity, PURGE_TOXICITY_DELTA);
  store.game.resources.value = { ...resources, mana: resources.mana - PURGE_MANA_COST };
  store.game.islands.value = {
    ...store.game.islands.peek(),
    [island.ownerId]: addToxicity(island, hexId, -PURGE_TOXICITY_DELTA),
  };
  appendLogEntry(store, `Ритуал очищения: гекс ${hexId} потерял ${removed} ☣️ за ${PURGE_MANA_COST} 💠`);
};

export {
  PURGE_MANA_COST,
  PURGE_TOXICITY_DELTA,
  addResearchAction,
  closeTechModalAction,
  openTechModalAction,
  purgeHexAction,
  setResearchTargetAction,
  togglePurgeAction,
};
