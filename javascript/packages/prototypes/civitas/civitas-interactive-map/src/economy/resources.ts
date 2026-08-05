import {
  ECONOMY_CONSTANTS,
  RESOURCE_DEPENDENTS,
  RESOURCE_KEYS,
  RESOURCE_WEIGHTS,
  SECTOR_DEPENDENCIES,
  SECTOR_KEYS,
} from "./constants";
import { clamp, finiteOr, roundTo, safeDivide } from "./num";
import type { ResourceDerived, ResourceKey, ResourceStage, ResourceState, Sector, SectorKey } from "./types";

// Pipeline step 2, spec sections 13.3 and 13.4.
//
// The shortage penalty is multiplicative and normalised, which is what makes the
// two SOURCED halves of the rule hold exactly: a total shortage of everything a
// sector needs gives a penalty of exactly 1, so growth lands on 0 and never
// below it (guard G9), and a sector that is already shrinking is untouched.

function gdpByKey(sectors: readonly Sector[]): Record<SectorKey, number> {
  const out: Record<SectorKey, number> = {
    agriculture: 0,
    lightIndustry: 0,
    heavyIndustry: 0,
    commercial: 0,
    extraction: 0,
    other1: 0,
    other2: 0,
  };
  for (const sector of sectors) {
    if (out[sector.key] === undefined) {
      continue;
    }
    out[sector.key] += Math.max(0, finiteOr(sector.gdpObor, 0));
  }
  return out;
}

// `ceil` of the summed quotient, not the sum of ceilings: a part-used unit still
// has to exist, but only one of them.
function needUnitsOf(resource: ResourceKey, gdp: Record<SectorKey, number>): number {
  let total = 0;
  for (const sector of RESOURCE_DEPENDENTS[resource]) {
    total += gdp[sector];
  }
  return Math.max(0, Math.ceil(total / ECONOMY_CONSTANTS.OBOR_PER_RESOURCE_UNIT));
}

function deriveResourceOne(
  entry: ResourceState,
  gdp: Record<SectorKey, number>,
  warnings: string[],
): ResourceDerived {
  const needUnits = needUnitsOf(entry.key, gdp);

  const deposits = Math.max(0, finiteOr(entry.deposits, 0));
  const bonusPct = Math.max(0, finiteOr(entry.extractionBonusPct, 0));
  const extractionUnits = roundTo(
    ECONOMY_CONSTANTS.DEPOSIT_YIELD_UNITS * deposits * (1 + bonusPct / 100),
    0,
  );

  // A blockade cuts imports only. Domestic extraction is untouched by one.
  const blockadePct = clamp(finiteOr(entry.blockadePct, 0), 0, 100);
  const requested = Math.max(0, finiteOr(entry.importsRequested, 0));
  const importUnits = roundTo(requested * (1 - blockadePct / 100), 0);

  const stockUnits = Math.max(0, finiteOr(entry.stockUnits, 0));
  const onHandUnits = stockUnits + extractionUnits + importUnits;

  // The clip, not a floor on supply: a country cannot ship units it does not
  // hold, and clipping here makes `supplyUnits` non-negative by construction
  // with no `max(0, ...)` needed anywhere (guard G12).
  const requestedExports = Math.max(0, finiteOr(entry.exports, 0));
  const exportsAppliedUnits = Math.min(requestedExports, onHandUnits);
  if (requestedExports > exportsAppliedUnits) {
    warnings.push(
      "V19: " + entry.key + " exports clipped from " + requestedExports + " to "
      + exportsAppliedUnits + " units",
    );
  }

  const supplyUnits = onHandUnits - exportsAppliedUnits;
  const coverage = needUnits === 0 ? 1 : Math.min(1, safeDivide(supplyUnits, needUnits));
  const shortage = 1 - coverage;
  const freeUnits = Math.max(0, supplyUnits - needUnits);

  return {
    key: entry.key,
    needUnits,
    extractionUnits,
    importUnits,
    onHandUnits,
    exportsAppliedUnits,
    supplyUnits,
    coverage,
    shortage,
    freeUnits,
    stockNextUnits: freeUnits,
  };
}

// sectorPenalty(s) = sum over deps of weight(r) x shortage(r) / sum of weight(r).
// The normalisation is what bounds the penalty at 1. A sector with no
// dependencies — `other1`, `other2` — divides by zero, so its penalty is 0
// (guard G3).
function sectorPenaltiesOf(
  shortageByKey: Record<ResourceKey, number>,
): Record<SectorKey, number> {
  const out: Record<SectorKey, number> = {
    agriculture: 0,
    lightIndustry: 0,
    heavyIndustry: 0,
    commercial: 0,
    extraction: 0,
    other1: 0,
    other2: 0,
  };
  for (const sector of SECTOR_KEYS) {
    let weighted = 0;
    let weightTotal = 0;
    for (const resource of SECTOR_DEPENDENCIES[sector]) {
      const weight = RESOURCE_WEIGHTS[resource];
      weightTotal += weight;
      weighted += weight * shortageByKey[resource];
    }
    out[sector] = weightTotal === 0 ? 0 : clamp(weighted / weightTotal, 0, 1);
  }
  return out;
}

function deriveResourceStage(
  sectors: readonly Sector[],
  resources: readonly ResourceState[],
): ResourceStage {
  const gdp = gdpByKey(sectors);
  const warnings: string[] = [];

  const byKey = new Map<ResourceKey, ResourceState>();
  for (const entry of resources) {
    byKey.set(entry.key, entry);
  }

  const derived: ResourceDerived[] = [];
  const shortageByKey: Record<ResourceKey, number> = {
    coal: 0,
    oil: 0,
    fibre: 0,
    ferrous: 0,
    nonferrous: 0,
    rubber: 0,
    chemical: 0,
    precious: 0,
  };

  // Always all eight, always in the spec's order, whatever the state carries.
  for (const key of RESOURCE_KEYS) {
    const entry = byKey.get(key) ?? {
      key,
      stockUnits: 0,
      deposits: 0,
      extractionBonusPct: 0,
      importsRequested: 0,
      exports: 0,
      blockadePct: 0,
    };
    const row = deriveResourceOne(entry, gdp, warnings);
    derived.push(row);
    shortageByKey[key] = row.shortage;
  }

  return {
    resources: derived,
    penaltyByKey: sectorPenaltiesOf(shortageByKey),
    warnings,
  };
}

export { deriveResourceStage, gdpByKey, needUnitsOf, sectorPenaltiesOf };
