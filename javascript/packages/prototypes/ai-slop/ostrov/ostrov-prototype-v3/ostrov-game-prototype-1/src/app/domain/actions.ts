import {
  PLAYERS_FACTION_ID,
  createBattle,
  createGame,
  finishBattle,
  formArmy,
  foundPower,
  investEngine,
  moveIsland,
  moveUnit,
  queueSkill,
  reinforceArmy,
  resolveTurn,
  runRound,
  setResearch,
  setSquadSlot,
  startBuilding,
  trainCivilian,
} from "../../core/exports";
import { createRng, hashSeed } from "@hw/ostrov-utils";
import type { TBattleSetup, TBuildingType, TPlayerId, TSkillId } from "../../core/exports";
import type { TPanelTab, TStore } from "../store/store";

/** Publishes the mutated game object, so every component reading it re-renders. */
const commit = (store: TStore) => {
  store.game.value = { ...store.game.peek() };
};

const hint = (store: TStore, text: string | null) => {
  store.ui.hint.value = text;
};

/** The side of a battle the players fight on, or `null` when they are not in it. */
const playersRole = (store: TStore): "attacker" | "defender" | null => {
  const battle = store.ui.battle.peek();

  if (battle === null) {
    return null;
  }

  if (battle.attacker.factionId === PLAYERS_FACTION_ID) {
    return "attacker";
  }

  if (battle.defender.factionId === PLAYERS_FACTION_ID) {
    return "defender";
  }

  return null;
};

const openBattle = (store: TStore, setup: TBattleSetup) => {
  const game = store.game.peek();

  store.ui.battle.value = createBattle(game, setup);
  store.ui.battleAuto.value = true;
  game.phase = "battle";
  commit(store);
};

/** Leaves the battle screen: the next queued battle, or back to planning. */
const afterBattle = (store: TStore) => {
  const game = store.game.peek();
  store.ui.battle.value = null;

  if (game.result !== null) {
    game.phase = "ended";
    commit(store);

    return;
  }

  const next = game.pendingBattles.shift();
  if (next !== undefined) {
    // A defender may have died to an earlier battle this turn.
    const defenders = next.defenderUnitIds.filter((id) => game.units[id] !== undefined);
    const attackers = next.attackerUnitIds.filter((id) => game.units[id] !== undefined);

    if (defenders.length === 0 || attackers.length === 0) {
      afterBattle(store);

      return;
    }

    openBattle(store, { ...next, attackerUnitIds: attackers, defenderUnitIds: defenders });

    return;
  }

  game.phase = "planning";
  commit(store);
};

const setActivePlayerAction = (store: TStore, player: TPlayerId) => {
  store.ui.activePlayer.value = player;
  store.ui.selectedUnitId.value = null;
  hint(store, null);
};

const setPanelTabAction = (store: TStore, tab: TPanelTab) => {
  store.ui.panelTab.value = tab;
};

/**
 * A click on the map. With a movable unit selected, a hex it can reach is a move;
 * any other hex becomes the selection and its own units are offered.
 */
const clickTileAction = (store: TStore, tileId: string) => {
  const game = store.game.peek();
  const { ui } = store;
  const selectedUnit = ui.selectedUnitId.peek() === null ? null : (game.units[ui.selectedUnitId.peek()!] ?? null);

  hint(store, null);

  if (game.phase === "planning" && selectedUnit !== null && selectedUnit.owner === ui.activePlayer.peek() && selectedUnit.tileId !== tileId) {
    const outcome = moveUnit(game, selectedUnit.id, tileId);

    if (outcome.kind === "battle") {
      ui.selectedTileId.value = tileId;
      openBattle(store, outcome.setup);

      return;
    }

    if (outcome.kind !== "blocked") {
      ui.selectedTileId.value = tileId;
      ui.panelTab.value = "tile";
      commit(store);

      return;
    }
  }

  ui.selectedTileId.value = tileId;
  ui.panelTab.value = "tile";

  const own = Object.values(game.units).find((unit) => unit.tileId === tileId && unit.owner === ui.activePlayer.peek());
  ui.selectedUnitId.value = own?.id ?? null;
};

const selectUnitAction = (store: TStore, unitId: string | null) => {
  const game = store.game.peek();
  const unit = unitId === null ? null : (game.units[unitId] ?? null);

  if (unit !== null && unit.owner !== store.ui.activePlayer.peek()) {
    hint(store, unit.owner === null ? "Это чужой юнит" : `Этим юнитом управляет ${game.players[unit.owner].name}. Переключите игрока.`);

    return;
  }

  store.ui.selectedUnitId.value = unitId;
  hint(store, null);
};

const foundPowerAction = (store: TStore, unitId: string) => {
  foundPower(store.game.peek(), unitId);
  store.ui.selectedUnitId.value = null;
  commit(store);
};

const startBuildingAction = (store: TStore, unitId: string, type: TBuildingType) => {
  startBuilding(store.game.peek(), unitId, type);
  commit(store);
};

const trainCivilianAction = (store: TStore, type: "settler" | "builders") => {
  trainCivilian(store.game.peek(), store.ui.activePlayer.peek(), type);
  commit(store);
};

const formArmyAction = (store: TStore, barracksId: string) => {
  formArmy(store.game.peek(), store.ui.activePlayer.peek(), barracksId);
  commit(store);
};

const reinforceArmyAction = (store: TStore, unitId: string) => {
  reinforceArmy(store.game.peek(), store.ui.activePlayer.peek(), unitId);
  commit(store);
};

const investEngineAction = (store: TStore, amount: number) => {
  investEngine(store.game.peek(), store.ui.activePlayer.peek(), amount);
  commit(store);
};

const moveIslandAction = (store: TStore, direction: number) => {
  moveIsland(store.game.peek(), direction);
  commit(store);
};

const setResearchAction = (store: TStore, techId: string) => {
  setResearch(store.game.peek(), techId);
  commit(store);
};

/** The active seat is done. When both seats are, the turn resolves and the curtain falls. */
const endTurnAction = (store: TStore) => {
  const game = store.game.peek();

  if (game.phase !== "planning") {
    return;
  }

  const player = game.players[store.ui.activePlayer.peek()];
  player.ready = !player.ready;

  const bothReady = (game.players.p1.ready || game.players.p1.defeated) && (game.players.p2.ready || game.players.p2.defeated);
  if (bothReady) {
    resolveTurn(game);
    store.ui.curtainShown.value = 0;
    store.ui.selectedUnitId.value = null;
  }

  commit(store);
};

const curtainAdvanceAction = (store: TStore) => {
  store.ui.curtainShown.value = store.ui.curtainShown.peek() + 1;
};

const curtainCloseAction = (store: TStore) => {
  const game = store.game.peek();

  if (game.phase !== "curtain") {
    return;
  }

  store.ui.curtainShown.value = game.curtainLines.length;
  afterBattle(store);
};

const battleSetSlotAction = (store: TStore, squadId: string, slot: number) => {
  const battle = store.ui.battle.peek();
  const role = playersRole(store);

  if (battle === null || role === null) {
    return;
  }

  setSquadSlot(battle, role, squadId, slot);
  store.ui.battle.value = { ...battle };
};

const battleStepAction = (store: TStore) => {
  const battle = store.ui.battle.peek();

  if (battle === null || battle.phase === "done") {
    return;
  }

  runRound(battle, store.rng);
  store.ui.battle.value = { ...battle };
};

const battleSkillAction = (store: TStore, skillId: TSkillId) => {
  const battle = store.ui.battle.peek();
  const role = playersRole(store);

  if (battle === null || role === null) {
    return;
  }

  queueSkill(battle, role, skillId);
  store.ui.battleAuto.value = true;
  store.ui.battle.value = { ...battle };
};

const battleAutoToggleAction = (store: TStore) => {
  store.ui.battleAuto.value = !store.ui.battleAuto.peek();
};

const battleFinishAction = (store: TStore) => {
  const battle = store.ui.battle.peek();

  if (battle === null || battle.phase !== "done") {
    return;
  }

  finishBattle(store.game.peek(), battle);
  afterBattle(store);
};

const setSeedTextAction = (store: TStore, text: string) => {
  store.ui.seedText.value = text;
};

const newGameAction = (store: TStore) => {
  const seedText = store.ui.seedText.peek().trim() || "OSTROV";

  store.game.value = createGame(seedText);
  store.rng = createRng(hashSeed(seedText) ^ 0xb47);
  store.ui.selectedTileId.value = null;
  store.ui.selectedUnitId.value = null;
  store.ui.battle.value = null;
  store.ui.panelTab.value = "tile";
  store.ui.activePlayer.value = "p1";
  hint(store, null);
};

export {
  battleAutoToggleAction,
  battleFinishAction,
  battleSetSlotAction,
  battleSkillAction,
  battleStepAction,
  clickTileAction,
  curtainAdvanceAction,
  curtainCloseAction,
  endTurnAction,
  formArmyAction,
  foundPowerAction,
  investEngineAction,
  moveIslandAction,
  newGameAction,
  reinforceArmyAction,
  selectUnitAction,
  setActivePlayerAction,
  setPanelTabAction,
  setResearchAction,
  setSeedTextAction,
  startBuildingAction,
  trainCivilianAction,
};
