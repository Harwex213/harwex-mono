import { Island, generateIsland } from "@hw/ostrov-island-system";
import { createSeedText } from "@hw/ostrov-utils";
import { RESOURCE_LABELS, RESOURCE_LIST, Settlement, buildingDef } from "../../core/exports";
import type { TBuildingKind, TTurnReport } from "../../core/exports";
import type { TLogEntry, TStore } from "../store/store";

const LOG_LIMIT = 60;

/** Lines shown one after another while a turn ends. */
const TURN_MESSAGES = ["Ветра меняются…", "Враги готовятся…", "Жители трудятся…", "Наступает новый день"];

/** How long each line stays, in ms. */
const TURN_MESSAGE_MS = 300;

let nextLogId = 1;

const pushLog = (store: TStore, text: string, tone: TLogEntry["tone"] = "info") => {
  const { gameState } = store;
  const entry: TLogEntry = { id: nextLogId, turn: gameState.settlement.peek().turn, text, tone };

  nextLogId += 1;
  gameState.log.value = [entry, ...gameState.log.peek()].slice(0, LOG_LIMIT);
};

const describeReport = (report: TTurnReport) => {
  const gains = RESOURCE_LIST.filter((kind) => report.produced[kind] - report.spent[kind] !== 0).map((kind) => {
    const net = report.produced[kind] - report.spent[kind];

    return `${net > 0 ? "+" : ""}${net} ${RESOURCE_LABELS[kind].toLowerCase()}`;
  });

  if (report.science > 0) {
    gains.push(`+${report.science} науки`);
  }

  return gains.length > 0 ? gains.join(", ") : "ничего не произведено";
};

/** Starts over on a new island. The seed field decides which one. */
const startIslandAction = (store: TStore, seedText?: string) => {
  const { gameState } = store;
  const seed = (seedText ?? gameState.seedText.peek()).trim() || createSeedText();
  const island = generateIsland({ seedText: seed, ...Island.DEFAULT_CONFIG });

  gameState.seedText.value = seed;
  gameState.island.value = island;
  gameState.settlement.value = Settlement.found(island);
  gameState.selectedKey.value = null;
  gameState.pickedKind.value = null;
  gameState.log.value = [];
  gameState.turnMessage.value = null;

  pushLog(store, `Основано поселение на острове ${island.name}`);
};

const rollIslandAction = (store: TStore) => {
  startIslandAction(store, createSeedText());
};

const setSeedTextAction = (store: TStore, seedText: string) => {
  store.gameState.seedText.value = seedText;
};

/** Arms a catalog card; picking the armed card again disarms it. */
const pickBuildingAction = (store: TStore, kind: TBuildingKind | null) => {
  const { pickedKind } = store.gameState;

  pickedKind.value = pickedKind.peek() === kind ? null : kind;
};

/**
 * A click on the board. With a card armed it tries to build there; without,
 * it selects the tile for the inspector. Clicking the selected tile again
 * clears the selection.
 */
const clickTileAction = (store: TStore, tileKey: string) => {
  const { gameState } = store;
  const picked = gameState.pickedKind.peek();

  if (picked === null) {
    gameState.selectedKey.value = gameState.selectedKey.peek() === tileKey ? null : tileKey;

    return;
  }

  if (gameState.turnMessage.peek() !== null) {
    return;
  }

  const tile = gameState.island.peek().tileByKey(tileKey);
  if (!tile) {
    return;
  }

  const settlement = gameState.settlement.peek();
  const def = buildingDef(picked);
  const check = settlement.canPlace(def, tile);

  if (!check.ok) {
    pushLog(store, `${def.label}: ${check.reasons.join(", ")}`, "bad");

    return;
  }

  gameState.settlement.value = settlement.place(def, tile);
  gameState.selectedKey.value = tileKey;
  pushLog(store, def.buildTurns > 0 ? `Заложена ${def.label}` : `Построена ${def.label}`);

  // A card stays armed while the player can still afford another copy, so a
  // row of farms is a row of clicks. Otherwise it drops back to select mode.
  const next = gameState.settlement.peek();
  if (!next.island.landTiles().some((candidate) => next.canPlace(def, candidate).ok)) {
    gameState.pickedKind.value = null;
  }
};

const clearSelectionAction = (store: TStore) => {
  store.gameState.selectedKey.value = null;
};

const upgradeBuildingAction = (store: TStore, tileKey: string) => {
  const { gameState } = store;
  const settlement = gameState.settlement.peek();
  const building = settlement.buildingAt(tileKey);

  if (!building || !settlement.canUpgrade(building)) {
    return;
  }

  gameState.settlement.value = settlement.upgrade(building);
  pushLog(store, `${building.label} улучшена до уровня ${building.level + 1}`);
};

const demolishBuildingAction = (store: TStore, tileKey: string) => {
  const { gameState } = store;
  const settlement = gameState.settlement.peek();
  const building = settlement.buildingAt(tileKey);

  if (!building || building.def.unique) {
    return;
  }

  gameState.settlement.value = settlement.demolish(building);
  pushLog(store, `${building.label} снесена`);
};

/** Applies the turn once the curtain has run through its lines. */
const finishTurn = (store: TStore) => {
  const { gameState } = store;
  const { settlement, report } = gameState.settlement.peek().endTurn();

  pushLog(store, `Ход ${report.turn}: ${describeReport(report)}`);

  for (const event of report.events) {
    if (event.type === "completed") {
      pushLog(store, `Достроена ${event.building.label}`, "good");
    }

    if (event.type === "starved") {
      const kinds = event.shortfall.map((kind) => RESOURCE_LABELS[kind].toLowerCase());

      pushLog(store, `Не хватило: ${kinds.join(", ")}`, "bad");
    }

    if (event.type === "grew") {
      pushLog(store, `Прибыл новый житель, всего ${event.population}`, "good");
    }
  }

  gameState.settlement.value = settlement;
  gameState.turnMessage.value = null;
};

/**
 * Ends the turn behind a curtain: the lines of `TURN_MESSAGES` are shown one
 * after another, and the turn is applied when the last one has passed.
 * Refused while the town hall is not placed and while a turn is already ending.
 */
const endTurnAction = (store: TStore) => {
  const { gameState } = store;

  if (!gameState.settlement.peek().canEndTurn || gameState.turnMessage.peek() !== null) {
    return;
  }

  gameState.pickedKind.value = null;
  gameState.selectedKey.value = null;

  TURN_MESSAGES.forEach((message, index) => {
    window.setTimeout(() => {
      gameState.turnMessage.value = message;
    }, index * TURN_MESSAGE_MS);
  });

  window.setTimeout(finishTurn, TURN_MESSAGES.length * TURN_MESSAGE_MS, store);
};

export {
  clearSelectionAction,
  clickTileAction,
  demolishBuildingAction,
  endTurnAction,
  pickBuildingAction,
  rollIslandAction,
  setSeedTextAction,
  startIslandAction,
  upgradeBuildingAction,
};
