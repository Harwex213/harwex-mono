import { CONCESSION_REGIONS, ECONOMY_CONSTANTS, OTHER_SECTOR_KEYS } from "./constants";
import { isIntegerInRange, isNonNegativeNumber } from "./num";
import type { DerivedEconomy, EconomyState, LedgerLine, ValidationError } from "./types";

// Spec section 17. Every rule here is raised by the derive pass and reported at
// pipeline step 1, which is the ONLY step that can abort. There is no second
// validation site anywhere in the engine.
//
// Every range test is written as a NEGATED comparison — `!(x >= 0 && x <= max)`
// — so a NaN fails it. A positive test would pass NaN straight through into
// every downstream product, which is the likeliest way a half-typed panel field
// poisons the whole sheet.

type DerivedCore = Omit<DerivedEconomy, "errors" | "warnings">;

function inRange(value: number, min: number, max: number): boolean {
  return typeof value === "number" && !(!(value >= min) || !(value <= max));
}

function checkLines(
  lines: readonly LedgerLine[] | undefined,
  field: string,
  errors: ValidationError[],
): void {
  if (lines === undefined) {
    return;
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as LedgerLine;
    if (!isNonNegativeNumber(line.points)) {
      errors.push({
        code: "V12",
        field: field + "[" + index + "].points",
        message: "a ledger line must carry a finite value of 0 or more",
      });
    }
  }
}

function checkV12(state: EconomyState, errors: ValidationError[]): void {
  for (const sector of state.sectors) {
    if (!isNonNegativeNumber(sector.gdpObor)) {
      errors.push({
        code: "V12",
        field: "sectors." + sector.key + ".gdpObor",
        message: "a sector volume must be a finite number of 0 or more obor",
      });
    }
  }

  const points: [string, number][] = [
    ["reserveAdd", state.reserveAdd],
    ["reserveWithdraw", state.reserveWithdraw],
    ["micStockAdd", state.micStockAdd],
    ["micStockWithdraw", state.micStockWithdraw],
    ["borrowRequest", state.borrowRequest],
    ["reserveFr", state.reserveFr],
    ["micStock", state.micStock],
  ];
  for (const [field, value] of points) {
    if (!isNonNegativeNumber(value)) {
      errors.push({
        code: "V12",
        field,
        message: field + " must be a finite number of 0 or more points",
      });
    }
  }

  for (const resource of state.resources) {
    const units: [string, number][] = [
      ["stockUnits", resource.stockUnits],
      ["deposits", resource.deposits],
      ["extractionBonusPct", resource.extractionBonusPct],
      ["importsRequested", resource.importsRequested],
      ["exports", resource.exports],
    ];
    for (const [field, value] of units) {
      if (!isNonNegativeNumber(value)) {
        errors.push({
          code: "V12",
          field: "resources." + resource.key + "." + field,
          message: field + " must be a finite number of 0 or more",
        });
      }
    }
    if (!inRange(resource.blockadePct, 0, 100)) {
      errors.push({
        code: "V12",
        field: "resources." + resource.key + ".blockadePct",
        message: "a blockade is a percentage in 0..100",
      });
    }
  }

  // `allocatedFr` is a player input only while auto-service is off, and that is
  // exactly when a bad value can reach step 7.
  if (state.debtAutoService === false) {
    for (const loan of state.loans) {
      if (!isNonNegativeNumber(loan.allocatedFr)) {
        errors.push({
          code: "V12",
          field: "loans." + loan.id + ".allocatedFr",
          message: "a manual debt allocation must be a finite number of 0 or more FR",
        });
      }
    }
  }

  checkLines(state.frExpenseLines, "frExpenseLines", errors);
  checkLines(state.micExpenseLines, "micExpenseLines", errors);
  checkLines(state.frIncomeLines, "frIncomeLines", errors);
  checkLines(state.micIncomeLines, "micIncomeLines", errors);
}

function collectValidationErrors(
  state: EconomyState,
  derived: DerivedCore,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!inRange(state.emissionPct, ECONOMY_CONSTANTS.EMISSION_PCT_MIN, ECONOMY_CONSTANTS.EMISSION_PCT_MAX)) {
    errors.push({
      code: "V1",
      field: "emissionPct",
      message: "emission must be between " + ECONOMY_CONSTANTS.EMISSION_PCT_MIN
        + " and " + ECONOMY_CONSTANTS.EMISSION_PCT_MAX + " percent",
    });
  }

  if (!inRange(state.militaryPct, ECONOMY_CONSTANTS.MILITARY_PCT_MIN, ECONOMY_CONSTANTS.MILITARY_PCT_MAX)) {
    errors.push({
      code: "V2",
      field: "militaryPct",
      message: "military spending must be between " + ECONOMY_CONSTANTS.MILITARY_PCT_MIN
        + " and " + ECONOMY_CONSTANTS.MILITARY_PCT_MAX + " percent",
    });
  }

  // The step is a HARD CAP, enforced as an error and never as a clamp. A clamp
  // would silently change what the player typed and then resolve a turn they did
  // not intend (guard G27).
  const emissionMove = Math.abs(state.emissionPct - state.emissionPctLast);
  if (!(emissionMove <= derived.emissionStepLimitPp)) {
    errors.push({
      code: "V3",
      field: "emissionPct",
      message: "emission moved " + emissionMove.toFixed(2) + " pp against a step limit of "
        + derived.emissionStepLimitPp.toFixed(2) + " pp",
    });
  }

  const militaryMove = Math.abs(state.militaryPct - state.militaryPctLast);
  if (!(militaryMove <= derived.militaryStepLimitPp)) {
    errors.push({
      code: "V4",
      field: "militaryPct",
      message: "military spending moved " + militaryMove.toFixed(2)
        + " pp against a step limit of " + derived.militaryStepLimitPp.toFixed(2) + " pp",
    });
  }

  // No silent clamp: a negative remainder would flow into `investedObor` and
  // come out as a growth penalty, quietly turning an overspent budget into a
  // merely bad turn (guard G13).
  if (!(derived.frRemainder >= 0)) {
    errors.push({
      code: "V5",
      field: "frExpenseLines",
      message: "the FR ledger is over by " + Math.abs(derived.frRemainder).toFixed(2) + " points",
    });
  }
  if (!(derived.micRemainder >= 0)) {
    errors.push({
      code: "V6",
      field: "micExpenseLines",
      message: "the MIC ledger is over by " + Math.abs(derived.micRemainder).toFixed(2) + " points",
    });
  }

  // Only a country actually asking for money can fail V7. A tier-F country with
  // no request must still be able to end its turn.
  const request = state.borrowRequest;
  if (typeof request !== "number" || !Number.isFinite(request)) {
    errors.push({
      code: "V7",
      field: "borrowRequest",
      message: "the borrow request must be a finite number of FR points",
    });
  } else if (request > 0) {
    if (!(request <= derived.newLoanAvailable)) {
      errors.push({
        code: "V7",
        field: "borrowRequest",
        message: "the borrow request of " + request.toFixed(2)
          + " FR exceeds the " + derived.newLoanAvailable.toFixed(2) + " FR available",
      });
    }
    if (derived.ratingTier === "F") {
      errors.push({
        code: "V7",
        field: "borrowRequest",
        message: "a country in default tier F cannot borrow",
      });
    }
    if (state.debtStatus === "default") {
      errors.push({
        code: "V7",
        field: "borrowRequest",
        message: "a country in debt default cannot borrow until one turn closes with no shortfall",
      });
    }
  }

  const pending = state.pendingAction;
  if (pending !== null && pending !== undefined) {
    const available = pending.kind === "nationalization"
      ? derived.nationalizationAvailable
      : derived.privatizationAvailable;
    if (!available) {
      errors.push({
        code: "V8",
        field: "pendingAction",
        message: pending.kind + " is unavailable: its cooldown has not expired or the "
          + "control scale locks it out",
      });
    }
    if (!isIntegerInRange(pending.roll, ECONOMY_CONSTANTS.ROLL_MIN, ECONOMY_CONSTANTS.ROLL_MAX)) {
      errors.push({
        code: "V9",
        field: "pendingAction.roll",
        message: "the roll must be a whole number between " + ECONOMY_CONSTANTS.ROLL_MIN
          + " and " + ECONOMY_CONSTANTS.ROLL_MAX,
      });
    }
  }

  let otherCount = 0;
  for (const sector of state.sectors) {
    if (!OTHER_SECTOR_KEYS.includes(sector.key)) {
      continue;
    }
    otherCount += 1;
    // The rulebook requires "weighty grounds", so an Other sector does not exist
    // without them. That is what makes creating one a [V] and not a [P].
    if (typeof sector.grounds !== "string" || sector.grounds.trim() === "") {
      errors.push({
        code: "V10",
        field: "sectors." + sector.key + ".grounds",
        message: "an Other sector needs non-empty grounds",
      });
    }
  }
  if (otherCount > ECONOMY_CONSTANTS.OTHER_SECTOR_MAX) {
    errors.push({
      code: "V10",
      field: "sectors",
      message: "at most " + ECONOMY_CONSTANTS.OTHER_SECTOR_MAX + " Other sectors are allowed",
    });
  }

  const concession = state.pendingConcession;
  if (concession !== null && concession !== undefined) {
    if (!CONCESSION_REGIONS.includes(state.region)) {
      errors.push({
        code: "V11",
        field: "pendingConcession",
        message: "only a country in Bengo, Aglan, Sudhara or Badiyat may grant a concession",
      });
    }
    const exists = state.sectors.some((sector) => {
      return sector.key === concession.sectorKey;
    });
    if (!exists) {
      errors.push({
        code: "V11",
        field: "pendingConcession.sectorKey",
        message: "the concession names a sector this country does not have",
      });
    }
  }

  checkV12(state, errors);

  if (!isIntegerInRange(state.ratingScore, ECONOMY_CONSTANTS.RATING_MIN, ECONOMY_CONSTANTS.RATING_MAX)) {
    errors.push({
      code: "V13",
      field: "ratingScore",
      message: "the credit rating is a whole number between 0 and 100",
    });
  }
  if (!isIntegerInRange(state.controlPosition, 0, 100)) {
    errors.push({
      code: "V13",
      field: "controlPosition",
      message: "the control scale position is a whole number between 0 and 100",
    });
  }

  return errors;
}

export { collectValidationErrors, type DerivedCore };
