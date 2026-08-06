import {
  BASE_SECTOR_KEYS,
  CONCESSION_REGIONS,
  ECONOMY_CONSTANTS,
  OTHER_SECTOR_KEYS,
  RESOURCE_KEYS,
  SECTOR_KEYS,
  SECTOR_LABELS,
} from "./constants";
import { clamp, finiteOr } from "./num";
import { createInitialEconomy, createResourceState } from "./economy-state";
import type {
  Concession,
  DebtStatus,
  EconomyFromJsonResult,
  EconomyState,
  LedgerLine,
  Loan,
  PendingAction,
  Region,
  ResourceKey,
  ResourceState,
  Sector,
  SectorKey,
  TimedModifier,
  TurnRecord,
  TurnStepRecord,
} from "./types";
// Type-only, so it erases at build time and adds no runtime coupling. Reusing
// the store's own JSON type is what keeps the persisted slot honest.
import type { JsonRecord, JsonValue } from "../state/schema";

// The seam between the engine and T05's store, DESIGN addition 4.
//
// `economyToJson` produces what `setCountryEconomics` persists. `economyFromJson`
// reads back arbitrary JSON — a browser, an older build or a truncated write may
// have damaged any field — and REPAIRS rather than rejects, mirroring
// `normalizeState`'s contract. It never throws. Without a repairing reader one
// damaged field would lose the whole economy.

function isPlainObject(value: unknown): value is { [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: number): number {
  return finiteOr(value, 0);
}

function lineToJson(line: LedgerLine): JsonValue {
  return { label: String(line.label ?? ""), points: num(line.points) };
}

function sectorToJson(sector: Sector): JsonValue {
  return {
    key: sector.key,
    name: String(sector.name ?? ""),
    grounds: typeof sector.grounds === "string" ? sector.grounds : null,
    gdpObor: num(sector.gdpObor),
    growthPermanentPct: num(sector.growthPermanentPct),
    growthTemporaryPct: num(sector.growthTemporaryPct),
  };
}

function resourceToJson(resource: ResourceState): JsonValue {
  return {
    key: resource.key,
    stockUnits: num(resource.stockUnits),
    deposits: num(resource.deposits),
    extractionBonusPct: num(resource.extractionBonusPct),
    importsRequested: num(resource.importsRequested),
    exports: num(resource.exports),
    blockadePct: num(resource.blockadePct),
  };
}

function loanToJson(loan: Loan): JsonValue {
  return {
    id: num(loan.id),
    principal: num(loan.principal),
    ratePct: num(loan.ratePct),
    termTurns: num(loan.termTurns),
    turnsRemaining: num(loan.turnsRemaining),
    createdTurn: num(loan.createdTurn),
    allocatedFr: num(loan.allocatedFr),
  };
}

function stepToJson(step: TurnStepRecord): JsonValue {
  return {
    step: String(step.step ?? ""),
    deltas: step.deltas.map((entry) => {
      return { label: String(entry.label ?? ""), value: num(entry.value), unit: String(entry.unit ?? "") };
    }),
    notes: step.notes.map((note) => {
      return String(note);
    }),
  };
}

function recordToJson(entry: TurnRecord): JsonValue {
  return {
    turn: num(entry.turn),
    gdpTotalObor: num(entry.gdpTotalObor),
    gdpNextTotalObor: num(entry.gdpNextTotalObor),
    overallGrowthPct: num(entry.overallGrowthPct),
    frGenerated: num(entry.frGenerated),
    frRemainder: num(entry.frRemainder),
    micGenerated: num(entry.micGenerated),
    micRemainder: num(entry.micRemainder),
    ratingScore: num(entry.ratingScore),
    ratingNext: num(entry.ratingNext),
    controlPosition: num(entry.controlPosition),
    controlNext: num(entry.controlNext),
    steps: entry.steps.map(stepToJson),
    warnings: entry.warnings.map((warning) => {
      return String(warning);
    }),
  };
}

function economyToJson(state: EconomyState): JsonRecord {
  return {
    schemaVersion: ECONOMY_CONSTANTS.ECONOMY_SCHEMA_VERSION,
    turn: num(state.turn),
    sectors: state.sectors.map(sectorToJson),
    ratingScore: num(state.ratingScore),
    controlPosition: num(state.controlPosition),
    emissionPct: num(state.emissionPct),
    emissionPctLast: num(state.emissionPctLast),
    militaryPct: num(state.militaryPct),
    militaryPctLast: num(state.militaryPctLast),
    frExpenseLines: state.frExpenseLines.map(lineToJson),
    micExpenseLines: state.micExpenseLines.map(lineToJson),
    frIncomeLines: state.frIncomeLines.map(lineToJson),
    micIncomeLines: state.micIncomeLines.map(lineToJson),
    reserveFr: num(state.reserveFr),
    reserveAdd: num(state.reserveAdd),
    reserveWithdraw: num(state.reserveWithdraw),
    micStock: num(state.micStock),
    micStockAdd: num(state.micStockAdd),
    micStockWithdraw: num(state.micStockWithdraw),
    resources: state.resources.map(resourceToJson),
    loans: state.loans.map(loanToJson),
    nextLoanId: num(state.nextLoanId),
    borrowRequest: num(state.borrowRequest),
    debtAutoService: state.debtAutoService === true,
    debtStatus: state.debtStatus,
    defaultLastTurn: state.defaultLastTurn === true,
    mobilized: state.mobilized === true,
    mobilizationJustified: state.mobilizationJustified === true,
    region: state.region,
    concessions: state.concessions.map((concession) => {
      return {
        id: num(concession.id),
        sectorKey: concession.sectorKey,
        gdpTransferredObor: num(concession.gdpTransferredObor),
        grantedTurn: num(concession.grantedTurn),
        active: concession.active === true,
      };
    }),
    nextConcessionId: num(state.nextConcessionId),
    // Absent is null, never undefined: `sanitizeRecord` DROPS an undefined key.
    pendingConcession: state.pendingConcession === null
      ? null
      : { sectorKey: state.pendingConcession.sectorKey },
    pendingAction: state.pendingAction === null
      ? null
      : {
        kind: state.pendingAction.kind,
        enterprise: state.pendingAction.enterprise,
        roll: num(state.pendingAction.roll),
      },
    turnsSinceNationalization: num(state.turnsSinceNationalization),
    turnsSincePrivatization: num(state.turnsSincePrivatization),
    timedModifiers: state.timedModifiers.map((modifier) => {
      return {
        id: num(modifier.id),
        reason: String(modifier.reason ?? ""),
        growthPp: num(modifier.growthPp),
        turnsRemaining: num(modifier.turnsRemaining),
      };
    }),
    nextModifierId: num(state.nextModifierId),
    privatizationFrDragTurns: num(state.privatizationFrDragTurns),
    privatizationMicDragTurns: num(state.privatizationMicDragTurns),
    history: state.history.map(recordToJson),
  };
}

// --------------------------------------------------------------------------
// The repairing reader.
// --------------------------------------------------------------------------

function readNumber(value: unknown, fallback: number, min?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  if (min !== undefined && value < min) {
    return min;
  }
  return value;
}

function readString(value: unknown, fallback: string, max: number): string {
  if (typeof value !== "string") {
    return fallback;
  }
  return value.length > max ? value.slice(0, max) : value;
}

function readLines(value: unknown, repairs: string[], field: string): LedgerLine[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: LedgerLine[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) {
      continue;
    }
    out.push({
      label: readString(entry.label, "", ECONOMY_CONSTANTS.LEDGER_LABEL_MAX),
      points: readNumber(entry.points, 0, 0),
    });
  }
  if (out.length > ECONOMY_CONSTANTS.LEDGER_LINE_MAX) {
    repairs.push("truncated " + field + " to " + ECONOMY_CONSTANTS.LEDGER_LINE_MAX + " lines");
    return out.slice(0, ECONOMY_CONSTANTS.LEDGER_LINE_MAX);
  }
  return out;
}

function readSectors(value: unknown, repairs: string[]): Sector[] {
  const byKey = new Map<SectorKey, Sector>();
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!isPlainObject(entry)) {
        repairs.push("dropped a malformed sector");
        continue;
      }
      const key = entry.key;
      if (typeof key !== "string" || !SECTOR_KEYS.includes(key as SectorKey)) {
        repairs.push("dropped a sector with an unknown key");
        continue;
      }
      if (byKey.has(key as SectorKey)) {
        repairs.push("dropped a duplicate " + key + " sector");
        continue;
      }
      byKey.set(key as SectorKey, {
        key: key as SectorKey,
        name: readString(entry.name, SECTOR_LABELS[key as SectorKey], ECONOMY_CONSTANTS.SECTOR_NAME_MAX),
        grounds: typeof entry.grounds === "string"
          ? entry.grounds.slice(0, ECONOMY_CONSTANTS.SECTOR_GROUNDS_MAX)
          : null,
        gdpObor: readNumber(entry.gdpObor, 0, 0),
        growthPermanentPct: readNumber(
          entry.growthPermanentPct,
          ECONOMY_CONSTANTS.DEFAULT_PERMANENT_GROWTH_PCT,
        ),
        growthTemporaryPct: readNumber(entry.growthTemporaryPct, 0),
      });
    }
  }

  const out: Sector[] = [];
  for (const key of BASE_SECTOR_KEYS) {
    const found = byKey.get(key);
    if (found === undefined) {
      repairs.push("inserted the missing " + key + " sector at 0 obor");
      out.push({
        key,
        name: SECTOR_LABELS[key],
        grounds: null,
        gdpObor: 0,
        growthPermanentPct: ECONOMY_CONSTANTS.DEFAULT_PERMANENT_GROWTH_PCT,
        growthTemporaryPct: 0,
      });
      continue;
    }
    out.push(found);
  }
  for (const key of OTHER_SECTOR_KEYS) {
    const found = byKey.get(key);
    if (found !== undefined) {
      out.push(found);
    }
  }
  return out;
}

function readResources(value: unknown, repairs: string[]): ResourceState[] {
  const byKey = new Map<ResourceKey, ResourceState>();
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!isPlainObject(entry)) {
        continue;
      }
      const key = entry.key;
      if (typeof key !== "string" || !RESOURCE_KEYS.includes(key as ResourceKey)) {
        repairs.push("dropped a resource with an unknown key");
        continue;
      }
      byKey.set(key as ResourceKey, {
        key: key as ResourceKey,
        stockUnits: readNumber(entry.stockUnits, 0, 0),
        deposits: readNumber(entry.deposits, 0, 0),
        extractionBonusPct: readNumber(entry.extractionBonusPct, 0, 0),
        importsRequested: readNumber(entry.importsRequested, 0, 0),
        exports: readNumber(entry.exports, 0, 0),
        blockadePct: clamp(readNumber(entry.blockadePct, 0, 0), 0, 100),
      });
    }
  }
  return RESOURCE_KEYS.map((key) => {
    const found = byKey.get(key);
    if (found === undefined) {
      repairs.push("inserted the missing " + key + " resource row");
      return createResourceState(key);
    }
    return found;
  });
}

function readLoans(value: unknown, repairs: string[]): Loan[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: Loan[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry) || typeof entry.id !== "number" || !Number.isFinite(entry.id)) {
      repairs.push("dropped a malformed loan");
      continue;
    }
    out.push({
      id: entry.id,
      principal: readNumber(entry.principal, 0, 0),
      ratePct: readNumber(entry.ratePct, 0, 0),
      termTurns: readNumber(entry.termTurns, 0, 0),
      turnsRemaining: readNumber(entry.turnsRemaining, 0, 0),
      createdTurn: readNumber(entry.createdTurn, 0, 0),
      allocatedFr: readNumber(entry.allocatedFr, 0, 0),
    });
  }
  return out;
}

function readConcessions(value: unknown, repairs: string[]): Concession[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: Concession[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry) || typeof entry.sectorKey !== "string"
      || !SECTOR_KEYS.includes(entry.sectorKey as SectorKey)) {
      repairs.push("dropped a malformed concession");
      continue;
    }
    out.push({
      id: readNumber(entry.id, 1, 1),
      sectorKey: entry.sectorKey as SectorKey,
      gdpTransferredObor: readNumber(entry.gdpTransferredObor, 0, 0),
      grantedTurn: readNumber(entry.grantedTurn, 1, 1),
      active: entry.active === true,
    });
  }
  return out;
}

function readModifiers(value: unknown, repairs: string[]): TimedModifier[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: TimedModifier[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) {
      repairs.push("dropped a malformed timed modifier");
      continue;
    }
    out.push({
      id: readNumber(entry.id, 1, 1),
      reason: readString(entry.reason, "", ECONOMY_CONSTANTS.LEDGER_LABEL_MAX),
      growthPp: readNumber(entry.growthPp, 0),
      turnsRemaining: readNumber(entry.turnsRemaining, 0, 0),
    });
  }
  return out;
}

function readHistory(value: unknown): TurnRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: TurnRecord[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) {
      continue;
    }
    const steps: TurnStepRecord[] = [];
    if (Array.isArray(entry.steps)) {
      for (const step of entry.steps) {
        if (!isPlainObject(step)) {
          continue;
        }
        const deltas: TurnStepRecord["deltas"] = [];
        if (Array.isArray(step.deltas)) {
          for (const item of step.deltas) {
            if (!isPlainObject(item)) {
              continue;
            }
            deltas.push({
              label: readString(item.label, "", ECONOMY_CONSTANTS.LEDGER_LABEL_MAX),
              value: readNumber(item.value, 0),
              unit: readString(item.unit, "", 16),
            });
          }
        }
        steps.push({
          step: readString(step.step, "", 64),
          deltas,
          notes: Array.isArray(step.notes)
            ? step.notes.filter((note): note is string => {
              return typeof note === "string";
            })
            : [],
        });
      }
    }
    out.push({
      turn: readNumber(entry.turn, 1, 1),
      gdpTotalObor: readNumber(entry.gdpTotalObor, 0, 0),
      gdpNextTotalObor: readNumber(entry.gdpNextTotalObor, 0, 0),
      overallGrowthPct: readNumber(entry.overallGrowthPct, 0),
      frGenerated: readNumber(entry.frGenerated, 0),
      frRemainder: readNumber(entry.frRemainder, 0),
      micGenerated: readNumber(entry.micGenerated, 0),
      micRemainder: readNumber(entry.micRemainder, 0),
      ratingScore: readNumber(entry.ratingScore, 0),
      ratingNext: readNumber(entry.ratingNext, 0),
      controlPosition: readNumber(entry.controlPosition, 0),
      controlNext: readNumber(entry.controlNext, 0),
      steps,
      warnings: Array.isArray(entry.warnings)
        ? entry.warnings.filter((warning): warning is string => {
          return typeof warning === "string";
        })
        : [],
    });
  }
  if (out.length > ECONOMY_CONSTANTS.TURN_HISTORY_MAX) {
    return out.slice(out.length - ECONOMY_CONSTANTS.TURN_HISTORY_MAX);
  }
  return out;
}

function readPendingAction(value: unknown): PendingAction | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const kind = value.kind;
  const enterprise = value.enterprise;
  if (kind !== "nationalization" && kind !== "privatization") {
    return null;
  }
  if (enterprise !== "civilian" && enterprise !== "military") {
    return null;
  }
  return { kind, enterprise, roll: readNumber(value.roll, 1, 0) };
}

function readStatus(value: unknown): DebtStatus {
  if (value === "arrears" || value === "default" || value === "normal") {
    return value;
  }
  return "normal";
}

function readRegion(value: unknown): Region {
  if (typeof value === "string" && (value === "none" || CONCESSION_REGIONS.includes(value as Region))) {
    return value as Region;
  }
  return "none";
}

function economyFromJson(raw: unknown): EconomyFromJsonResult {
  const repairs: string[] = [];
  if (!isPlainObject(raw)) {
    repairs.push("the saved economy was not an object");
    return { state: createInitialEconomy(), repairs };
  }

  const sectors = readSectors(raw.sectors, repairs);
  const loans = readLoans(raw.loans, repairs);

  let nextLoanId = readNumber(raw.nextLoanId, 1, 1);
  for (const loan of loans) {
    if (loan.id + 1 > nextLoanId) {
      nextLoanId = loan.id + 1;
    }
  }

  const concessions = readConcessions(raw.concessions, repairs);
  let nextConcessionId = readNumber(raw.nextConcessionId, 1, 1);
  for (const concession of concessions) {
    if (concession.id + 1 > nextConcessionId) {
      nextConcessionId = concession.id + 1;
    }
  }

  const timedModifiers = readModifiers(raw.timedModifiers, repairs);
  let nextModifierId = readNumber(raw.nextModifierId, 1, 1);
  for (const modifier of timedModifiers) {
    if (modifier.id + 1 > nextModifierId) {
      nextModifierId = modifier.id + 1;
    }
  }

  const rawRating = readNumber(raw.ratingScore, ECONOMY_CONSTANTS.START_RATING, undefined);
  const ratingScore = clamp(Math.round(rawRating), 0, 100);
  if (ratingScore !== rawRating) {
    repairs.push("clamped the credit rating into 0..100");
  }
  const rawControl = readNumber(raw.controlPosition, ECONOMY_CONSTANTS.START_CONTROL, undefined);
  const controlPosition = clamp(Math.round(rawControl), 0, 100);
  if (controlPosition !== rawControl) {
    repairs.push("clamped the control scale position into 0..100");
  }

  const pendingAction = readPendingAction(raw.pendingAction);

  const pendingConcessionRaw = raw.pendingConcession;
  const pendingConcession = isPlainObject(pendingConcessionRaw)
    && typeof pendingConcessionRaw.sectorKey === "string"
    && SECTOR_KEYS.includes(pendingConcessionRaw.sectorKey as SectorKey)
    ? { sectorKey: pendingConcessionRaw.sectorKey as SectorKey }
    : null;

  const state: EconomyState = {
    schemaVersion: ECONOMY_CONSTANTS.ECONOMY_SCHEMA_VERSION,
    turn: Math.max(1, Math.round(readNumber(raw.turn, 1, 1))),
    sectors,
    ratingScore,
    controlPosition,
    emissionPct: readNumber(raw.emissionPct, 0, 0),
    emissionPctLast: readNumber(raw.emissionPctLast, 0, 0),
    militaryPct: readNumber(raw.militaryPct, ECONOMY_CONSTANTS.MILITARY_FREE_PCT, 0),
    militaryPctLast: readNumber(raw.militaryPctLast, ECONOMY_CONSTANTS.MILITARY_FREE_PCT, 0),
    frExpenseLines: readLines(raw.frExpenseLines, repairs, "frExpenseLines"),
    micExpenseLines: readLines(raw.micExpenseLines, repairs, "micExpenseLines"),
    frIncomeLines: readLines(raw.frIncomeLines, repairs, "frIncomeLines"),
    micIncomeLines: readLines(raw.micIncomeLines, repairs, "micIncomeLines"),
    reserveFr: readNumber(raw.reserveFr, 0, 0),
    reserveAdd: readNumber(raw.reserveAdd, 0, 0),
    reserveWithdraw: readNumber(raw.reserveWithdraw, 0, 0),
    micStock: readNumber(raw.micStock, 0, 0),
    micStockAdd: readNumber(raw.micStockAdd, 0, 0),
    micStockWithdraw: readNumber(raw.micStockWithdraw, 0, 0),
    resources: readResources(raw.resources, repairs),
    loans,
    nextLoanId,
    borrowRequest: readNumber(raw.borrowRequest, 0, 0),
    debtAutoService: raw.debtAutoService !== false,
    debtStatus: readStatus(raw.debtStatus),
    defaultLastTurn: raw.defaultLastTurn === true,
    mobilized: raw.mobilized === true,
    mobilizationJustified: raw.mobilizationJustified !== false,
    region: readRegion(raw.region),
    concessions,
    nextConcessionId,
    pendingConcession,
    pendingAction,
    turnsSinceNationalization: readNumber(
      raw.turnsSinceNationalization,
      ECONOMY_CONSTANTS.ACTION_COOLDOWN_TURNS,
      0,
    ),
    turnsSincePrivatization: readNumber(
      raw.turnsSincePrivatization,
      ECONOMY_CONSTANTS.ACTION_COOLDOWN_TURNS,
      0,
    ),
    timedModifiers,
    nextModifierId,
    privatizationFrDragTurns: readNumber(raw.privatizationFrDragTurns, 0, 0),
    privatizationMicDragTurns: readNumber(raw.privatizationMicDragTurns, 0, 0),
    history: readHistory(raw.history),
  };

  return { state, repairs };
}

export { economyFromJson, economyToJson };
