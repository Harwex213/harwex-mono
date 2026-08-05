import type {
  DebtTerms,
  RatingTier,
  Region,
  ResourceCategory,
  ResourceKey,
  SectorKey,
} from "./types";

// The single retuning surface. Every scalar in `.plan/T11/FORMULA-SPEC.md`
// section 2 lives in `ECONOMY_CONSTANTS`; the structured tables sit beside it.
// Nothing anywhere else in `src/economy/` may hard-code a balance number.
//
// The user's four rulings in spec section 0-A are final and are baked in here:
// tier B borrows 2,25 x annual income (not a flat 22 500), a concession costs
// total GDP / province count, INVEST_GROWTH_COEFF is 2,00, 1 FR point is
// 2 000 obor, privatization succeeds on 6+, and unpaid MIC upkeep loses only
// the points the budget could not cover.

const ECONOMY_CONSTANTS = {
  // 2.1 Currency and conversion
  ARLINGS_PER_OBOR: 500,
  ARLINGS_PER_FR_POINT: 1000000,
  OBOR_PER_FR_POINT: 2000,
  OBOR_PER_MIC_POINT: 50000,
  OBOR_PER_RESOURCE_UNIT: 1000000,

  // 2.2 GDP and sectors
  OTHER_SECTOR_MAX: 2,
  DEFAULT_PERMANENT_GROWTH_PCT: 3.0,
  START_GDP_OBOR: 100000000,
  START_SECTOR_GDP_OBOR: 20000000,
  SECTOR_GROWTH_FLOOR_PCT: -100.0,

  // 2.3 Credit rating
  START_RATING: 70,
  RATING_FR_PIVOT: 70,
  RATING_FR_SLOPE: 0.01,
  RATING_RECOVERY_PER_TURN: 1,
  RATING_MIN: 0,
  RATING_MAX: 100,

  // 2.4 Control scale
  CONTROL_NEUTRAL_BAND_INDEX: 5,
  START_CONTROL: 50,
  CONTROL_GROWTH_STEP_PP: 0.5,
  CONTROL_FR_STEP: 0.1,
  STEP_LIMIT_NEUTRAL_PP: 10.0,
  CONTROL_STEP_SLOPE_PP: 1.5,
  NAT_LOCK_BAND_INDEX: 0,
  PRIV_LOCK_BAND_INDEX: 10,

  // 2.5 FR generation
  FR_TAX_RATE: 0.2,
  FR_GROWTH_COEFF: 0.02,
  FR_GROWTH_FACTOR_MIN: 0.5,
  FR_GROWTH_FACTOR_MAX: 1.5,
  FR_LIGHT_BONUS_COEFF: 0.25,
  MILITARY_FR_DRAG: 1.0,
  MILITARY_FR_DRAG_FLOOR: 0.1,
  FR_REGIME_MULT_MOBILIZED: 0.5,
  EMISSION_FR_RATE: 1.0,

  // 2.6 MIC generation
  MIC_HEAVY_BONUS_COEFF: 0.5,
  MIC_REGIME_MULT_MOBILIZED: 2.0,

  // 2.7 Emission and military spending
  EMISSION_PCT_MIN: 0.0,
  EMISSION_PCT_MAX: 50.0,
  EMISSION_INFLATION_COEFF: 1.5,
  INFLATION_GROWTH_COEFF: 0.1,
  EMISSION_RATING_COEFF: 0.4,
  MILITARY_PCT_MIN: 0.0,
  MILITARY_PCT_MAX: 60.0,
  MILITARY_FREE_PCT: 10.0,
  DEFENCE_GROWTH_COEFF: 0.1,

  // 2.8 Savings
  RESERVE_CAP_MULTIPLE: 2.0,
  INVEST_GROWTH_COEFF: 2.0,
  RESERVE_PENALTY_MULTIPLE: 1.5,
  MIC_UPKEEP_FR_PER_POINT: 2.0,

  // 2.9 Debt
  DEBT_SHORTFALL_RATING_MAX: 10,
  DEBT_AUTO_SERVICE: true,

  // 2.10 States and flags
  MOB_STEP_BONUS_PP: 10.0,
  MOB_FR_MULT: 0.5,
  MOB_MIC_MULT: 2.0,
  MOB_GROWTH_PP: -2.0,
  MOB_UNJUSTIFIED_RATING_PER_TURN: -5,
  NAT_GROWTH_PP: -0.75,
  NAT_RATING: -4,
  NAT_INCOME_MAX_PCT: 26.25,
  PRIV_GROWTH_MAX_PP: 0.75,
  PRIV_FAIL_GROWTH_PP: -0.25,
  PRIV_FAIL_RATING: -2,
  ACTION_COOLDOWN_TURNS: 2,
  ROLL_MIN: 1,
  ROLL_MAX: 10,
  PRIV_SUCCESS_MIN_ROLL: 6,
  ACTION_EFFECT_TURNS: 2,
  NAT_CONTROL_SHIFT: -3,
  PRIV_CONTROL_SHIFT: 3,
  PRIV_DRAG_PCT: 5.0,
  PRIV_DRAG_TURNS: 3,
  CONCESSION_GROWTH_PP: 1.5,

  // 2.11 Resources
  DEPOSIT_YIELD_UNITS: 50,

  // 2.12 Engine
  TURN_HISTORY_MAX: 12,
  PCT_STORE_DECIMALS: 4,
  PCT_DISPLAY_DECIMALS: 2,
  POINT_DECIMALS: 2,
  ECONOMY_SCHEMA_VERSION: 1,

  // Engine limits the spec states in prose rather than in the table.
  LEDGER_LINE_MAX: 24,
  LEDGER_LABEL_MAX: 120,
  SECTOR_NAME_MAX: 60,
  SECTOR_GROUNDS_MAX: 400,
} as const;

// Spec 4.1. The display order is INVENTED and nothing in the engine depends on
// it; the SET of five base sectors is SOURCED.
const BASE_SECTOR_KEYS: readonly SectorKey[] = [
  "agriculture",
  "lightIndustry",
  "heavyIndustry",
  "commercial",
  "extraction",
];

const OTHER_SECTOR_KEYS: readonly SectorKey[] = ["other1", "other2"];

const SECTOR_KEYS: readonly SectorKey[] = [...BASE_SECTOR_KEYS, ...OTHER_SECTOR_KEYS];

const SECTOR_LABELS: Readonly<Record<SectorKey, string>> = {
  agriculture: "Agriculture",
  lightIndustry: "Light industry",
  heavyIndustry: "Heavy industry",
  commercial: "Commercial",
  extraction: "Extraction",
  other1: "Other 1",
  other2: "Other 2",
};

// Spec 13.1, in the image's order.
const RESOURCE_KEYS: readonly ResourceKey[] = [
  "coal",
  "oil",
  "fibre",
  "ferrous",
  "nonferrous",
  "rubber",
  "chemical",
  "precious",
];

const RESOURCE_LABELS: Readonly<Record<ResourceKey, string>> = {
  coal: "Coal",
  oil: "Oil",
  fibre: "Fibre crops",
  ferrous: "Ferrous metal ores",
  nonferrous: "Non-ferrous metal ores",
  rubber: "Rubber",
  chemical: "Chemical feedstock",
  precious: "Precious metals / stones",
};

const RESOURCE_CATEGORY: Readonly<Record<ResourceKey, ResourceCategory>> = {
  coal: "fuel",
  oil: "fuel",
  fibre: "raw",
  ferrous: "raw",
  nonferrous: "raw",
  rubber: "raw",
  chemical: "raw",
  precious: "luxury",
};

// Spec 13.2, reproduced verbatim. This is the ONE place the matrix is written
// down; `SECTOR_DEPENDENCIES` below is derived from it by inversion so the two
// can never drift.
const RESOURCE_DEPENDENTS: Readonly<Record<ResourceKey, readonly SectorKey[]>> = {
  coal: ["heavyIndustry", "lightIndustry", "extraction"],
  oil: ["heavyIndustry"],
  fibre: ["agriculture", "commercial"],
  ferrous: ["heavyIndustry", "lightIndustry"],
  nonferrous: ["heavyIndustry", "lightIndustry"],
  rubber: ["heavyIndustry"],
  chemical: ["agriculture", "heavyIndustry", "lightIndustry"],
  precious: ["commercial"],
};

function invertDependencyMatrix(): Readonly<Record<SectorKey, readonly ResourceKey[]>> {
  const out: Record<SectorKey, ResourceKey[]> = {
    agriculture: [],
    lightIndustry: [],
    heavyIndustry: [],
    commercial: [],
    extraction: [],
    other1: [],
    other2: [],
  };
  for (const resource of RESOURCE_KEYS) {
    for (const sector of RESOURCE_DEPENDENTS[resource]) {
      out[sector].push(resource);
    }
  }
  return out;
}

// Spec 13.2, inverted. `other1` and `other2` map to `[]` — an Other sector has
// no resource dependency at all (spec 4.1), which is what makes its shortage
// penalty 0 through guard G3.
const SECTOR_DEPENDENCIES = invertDependencyMatrix();

// Spec 13.4: weight(r) = 1 / dependentCount(r). The count is the matrix's, not
// the count of sectors a given country happens to have.
function buildResourceWeights(): Readonly<Record<ResourceKey, number>> {
  const out: Record<ResourceKey, number> = {
    coal: 0,
    oil: 0,
    fibre: 0,
    ferrous: 0,
    nonferrous: 0,
    rubber: 0,
    chemical: 0,
    precious: 0,
  };
  for (const resource of RESOURCE_KEYS) {
    const count = RESOURCE_DEPENDENTS[resource].length;
    out[resource] = count === 0 ? 0 : 1 / count;
  }
  return out;
}

const RESOURCE_WEIGHTS = buildResourceWeights();

// Spec 6.1. Contiguous, exhaustive, no gaps, highest tier first.
const RATING_TIERS: readonly { tier: RatingTier; min: number; max: number }[] = [
  { tier: "A+", min: 95, max: 100 },
  { tier: "A", min: 85, max: 94 },
  { tier: "B", min: 70, max: 84 },
  { tier: "C", min: 50, max: 69 },
  { tier: "D", min: 30, max: 49 },
  { tier: "E", min: 10, max: 29 },
  { tier: "F", min: 0, max: 9 },
];

// Spec 7.1. Index 5 is the single-value neutral band 50.
const CONTROL_BANDS: readonly { min: number; max: number; name: string }[] = [
  { min: 0, max: 5, name: "Total control" },
  { min: 6, max: 20, name: "Command economy" },
  { min: 21, max: 30, name: "Heavy dirigisme" },
  { min: 31, max: 44, name: "Dirigisme" },
  { min: 45, max: 49, name: "Guided market" },
  { min: 50, max: 50, name: "Policy of balance" },
  { min: 51, max: 55, name: "Regulated market" },
  { min: 56, max: 69, name: "Social market" },
  { min: 70, max: 79, name: "Free market" },
  { min: 80, max: 94, name: "Laissez-faire" },
  { min: 95, max: 100, name: "Minarchism" },
];

// Spec 2.9. Ruling 2: the limits are multiples of annual FR income, and tier B
// stays 2,25. Tier F's rate and term are 0 in the engine, never absent, so
// `DerivedEconomy` stays total; V7 is what blocks the borrow.
const DEBT_TERMS: Readonly<Record<RatingTier, DebtTerms>> = {
  "A+": { limitMultiple: 4.0, ratePct: 4.0, termTurns: 10 },
  A: { limitMultiple: 3.0, ratePct: 8.0, termTurns: 8 },
  B: { limitMultiple: 2.25, ratePct: 12.0, termTurns: 6 },
  C: { limitMultiple: 1.5, ratePct: 17.0, termTurns: 4 },
  D: { limitMultiple: 1.0, ratePct: 23.0, termTurns: 3 },
  E: { limitMultiple: 0.5, ratePct: 30.0, termTurns: 2 },
  F: { limitMultiple: 0.0, ratePct: 0.0, termTurns: 0 },
};

// Spec 15.3. Exactly these four; every other region cannot grant a concession.
const CONCESSION_REGIONS: readonly Region[] = ["bengo", "aglan", "sudhara", "badiyat"];

const REGIONS: readonly Region[] = ["none", "bengo", "aglan", "sudhara", "badiyat"];

export {
  BASE_SECTOR_KEYS,
  CONCESSION_REGIONS,
  CONTROL_BANDS,
  DEBT_TERMS,
  ECONOMY_CONSTANTS,
  OTHER_SECTOR_KEYS,
  RATING_TIERS,
  REGIONS,
  RESOURCE_CATEGORY,
  RESOURCE_DEPENDENTS,
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  RESOURCE_WEIGHTS,
  SECTOR_DEPENDENCIES,
  SECTOR_KEYS,
  SECTOR_LABELS,
};
