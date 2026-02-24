// ── Titles ────────────────────────────────────────────────────────────────────

export type Title = "baron" | "viscount" | "count" | "duke" | "king" | "emperor";

export const TITLE_DOMAIN_LIMIT: Record<Title, number> = {
  baron: 1,
  viscount: 2,
  count: 3,
  duke: 4,
  king: 5,
  emperor: 7,
};

// ── Domain economy ─────────────────────────────────────────────────────────────

export interface DomainEconomy {
  /** Total population of directly held territories */
  population: number;
  /** Per-turn population growth rate (fraction, e.g. 0.01 = 1%) */
  populationGrowthRate: number;
  /** Current economic turnover */
  turnover: number;
  /** Per-turn turnover growth rate (fraction, e.g. 0.05 = 5%) */
  turnoverGrowthRate: number;
  /** Tax collection efficiency (fraction, e.g. 0.40 = 40%) */
  collectionEfficiency: number;
  /** Suzerain tax rate — portion of turnover collected for own treasury (fraction, max 0.08) */
  suzerainTaxRate: number;
  /** Imperial tax rate — portion of turnover paid to emperor/suzerain (fraction) */
  imperialTaxRate: number;
}

/** Maximum turnover = population × 1000 */
export const TURNOVER_PER_POPULATION = 1_000;

export const DOMAIN_DEFAULTS = {
  populationGrowthRate: 0.01,
  turnoverGrowthRate: 0.05,
  collectionEfficiency: 0.40,
  suzerainTaxRateMax: 0.08,
  imperialTaxRate: 0.02,
} as const;

// ── Vassal economy ─────────────────────────────────────────────────────────────

export interface VassalEconomy {
  /** Total population of vassal territories */
  population: number;
  /** Per-turn population growth rate (fraction) */
  populationGrowthRate: number;
  /** Current economic turnover of vassals */
  turnover: number;
  /** Per-turn turnover growth rate (fraction) */
  turnoverGrowthRate: number;
  /** Feudal tax — portion of turnover kept by vassals themselves (fraction) */
  feudalTaxRate: number;
  /** Feudal aid — portion of vassal turnover collected by the suzerain (fraction) */
  feudalAidRate: number;
}

export const VASSAL_DEFAULTS = {
  populationGrowthRate: 0.01,
  turnoverGrowthRate: 0.05,
  turnoverGrowthRateStartThreshold: 0.06,
  feudalTaxRate: 0.03,
  feudalAidRate: 0.01,
} as const;

// ── Province ───────────────────────────────────────────────────────────────────

export interface Province {
  /** Baronies that make up the province */
  baronies: Barony[];
}

export interface Barony {
  population: number;
  turnover: number;
}

export const BARONY_DEFAULTS = {
  population: 5_000,
  turnover: 500_000,
} as const;

// ── Domain limit penalty ───────────────────────────────────────────────────────

/** Applied once per barony over the domain limit */
export const DOMAIN_LIMIT_PENALTY = {
  /** Multiplicative reduction of current collection efficiency */
  collectionEfficiencyReduction: 0.10,
  /** Absolute reduction of the collection efficiency ceiling */
  collectionEfficiencyCeilingReduction: 0.20,
} as const;

// ── Loans ──────────────────────────────────────────────────────────────────────

export interface Loan {
  /** Principal as a fraction of domain turnover */
  principalRate: number;
  /** Maximum term in turns (1 turn = 5 years) */
  maxTermTurns: number;
  /** Interest rate applied per term (fraction) */
  interestRate: number;
}

/** Standard loan tiers available without special negotiation */
export const LOAN_TIERS: readonly Loan[] = [
  { principalRate: 0.02, maxTermTurns: 1, interestRate: 0.10 },
  { principalRate: 0.05, maxTermTurns: 3, interestRate: 0.20 },
] as const;

// ── Calendar ───────────────────────────────────────────────────────────────────

export const CALENDAR = {
  /** Real days per game turn */
  realDaysPerTurn: 10,
  /** Game years per turn */
  gameYearsPerTurn: 5,
  /** Real days for writing orders at the start of a turn */
  orderWritingDays: 5,
  /** Game turns per real month (approx.) */
  turnsPerRealMonth: 3,
  /** Game years per real month (approx.) */
  gameYearsPerRealMonth: 15,
} as const;
