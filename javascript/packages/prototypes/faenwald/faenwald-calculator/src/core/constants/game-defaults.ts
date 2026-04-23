export const BARONY_DEFAULTS = {
  population: 5_000,
  turnover: 500_000,
} as const;

export const DOMAIN_DEFAULTS = {
  populationGrowthRate: 0.01,
  turnoverGrowthRate: 0.05,
  collectionEfficiency: 0.40,
  suzerainTaxRateMax: 0.08,
  imperialTaxRate: 0.02,
} as const;

export const VASSAL_DEFAULTS = {
  populationGrowthRate: 0.01,
  turnoverGrowthRate: 0.05,
  turnoverGrowthRateStartThreshold: 0.06,
  feudalTaxRate: 0.03,
  feudalAidRate: 0.01,
} as const;
