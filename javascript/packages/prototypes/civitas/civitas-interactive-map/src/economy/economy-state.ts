import { BASE_SECTOR_KEYS, ECONOMY_CONSTANTS, RESOURCE_KEYS, SECTOR_LABELS } from "./constants";
import type { EconomyState, ResourceKey, ResourceState, Sector, SectorKey } from "./types";

// The factories. A fresh country's opening sheet, and the two per-row builders
// the repairing reader in `serialize.ts` reuses.
//
// DESIGN addition 5: a fresh country starts with ZERO deposits on every
// resource and `militaryPct` 10. The spec never states a starting geology and
// the engine cannot invent one — a judge sets deposits. So a fresh country reads
// a full shortage until then, which is a legitimate state and not a bug. The
// 10% military share is spec section 11's standard start.

function createSector(key: SectorKey): Sector {
  return {
    key,
    name: SECTOR_LABELS[key],
    grounds: null,
    gdpObor: ECONOMY_CONSTANTS.START_SECTOR_GDP_OBOR,
    growthPermanentPct: ECONOMY_CONSTANTS.DEFAULT_PERMANENT_GROWTH_PCT,
    growthTemporaryPct: 0,
  };
}

function createResourceState(key: ResourceKey): ResourceState {
  return {
    key,
    stockUnits: 0,
    deposits: 0,
    extractionBonusPct: 0,
    importsRequested: 0,
    exports: 0,
    blockadePct: 0,
  };
}

function createInitialEconomy(): EconomyState {
  return {
    schemaVersion: ECONOMY_CONSTANTS.ECONOMY_SCHEMA_VERSION,
    turn: 1,

    sectors: BASE_SECTOR_KEYS.map((key) => {
      return createSector(key);
    }),

    ratingScore: ECONOMY_CONSTANTS.START_RATING,
    controlPosition: ECONOMY_CONSTANTS.START_CONTROL,

    emissionPct: 0,
    emissionPctLast: 0,
    militaryPct: ECONOMY_CONSTANTS.MILITARY_FREE_PCT,
    militaryPctLast: ECONOMY_CONSTANTS.MILITARY_FREE_PCT,

    frExpenseLines: [],
    micExpenseLines: [],
    frIncomeLines: [],
    micIncomeLines: [],

    reserveFr: 0,
    reserveAdd: 0,
    reserveWithdraw: 0,

    micStock: 0,
    micStockAdd: 0,
    micStockWithdraw: 0,

    resources: RESOURCE_KEYS.map((key) => {
      return createResourceState(key);
    }),

    loans: [],
    nextLoanId: 1,
    borrowRequest: 0,
    debtAutoService: ECONOMY_CONSTANTS.DEBT_AUTO_SERVICE,
    debtStatus: "normal",
    defaultLastTurn: false,

    mobilized: false,
    mobilizationJustified: true,
    region: "none",
    concessions: [],
    nextConcessionId: 1,
    pendingConcession: null,

    pendingAction: null,
    // Both cooldown counters start satisfied, so nothing is locked at turn 1.
    turnsSinceNationalization: ECONOMY_CONSTANTS.ACTION_COOLDOWN_TURNS,
    turnsSincePrivatization: ECONOMY_CONSTANTS.ACTION_COOLDOWN_TURNS,
    timedModifiers: [],
    nextModifierId: 1,
    privatizationFrDragTurns: 0,
    privatizationMicDragTurns: 0,

    history: [],
  };
}

export { createInitialEconomy, createResourceState, createSector };
