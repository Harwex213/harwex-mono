type TDomainEconomy = {
  /** > 0 */
  turn: number;

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
};

type TDomainEconomyPrediction = {
  newPopulation: number;
  newTurnover: number;
};

type TVassalEconomy = {
  /** > 0 */
  turn: number;

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
};

type TVassalEconomyPrediction = {
  newPopulation: number;
  newTurnover: number;
};
