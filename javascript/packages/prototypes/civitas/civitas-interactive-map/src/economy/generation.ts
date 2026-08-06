import { ECONOMY_CONSTANTS } from "./constants";
import {
  controlBandIndexOf,
  controlBandNameOf,
  controlFrMultiplierOf,
  controlGrowthPpOf,
  stepLimitPpOf,
} from "./control";
import { clamp, finiteOr, safeDivide } from "./num";
import { emissionRatingPenaltyOf, ratingFactorOf, ratingTierOf } from "./rating";
import type { EconomyState, GenerationStage, SectorKey } from "./types";

// Pipeline step 3, spec sections 8.1, 8.2, 10 and 11.
//
// Generation reads `plannedGrowthPct` and never `overallGrowthPct`. That is the
// whole anti-circularity device of spec 5.7 (guard G17): FR and MIC take growth
// as an input and growth takes unspent FR and MIC as an input, and
// `plannedGrowthPct` — which depends only on the sector volumes and the two
// growth columns — is what breaks the cycle with no fixed-point iteration.

function shareByKeyOf(state: EconomyState, gdpTotalObor: number): Record<SectorKey, number> {
  const out: Record<SectorKey, number> = {
    agriculture: 0,
    lightIndustry: 0,
    heavyIndustry: 0,
    commercial: 0,
    extraction: 0,
    other1: 0,
    other2: 0,
  };
  for (const sector of state.sectors) {
    if (out[sector.key] === undefined) {
      continue;
    }
    out[sector.key] += safeDivide(finiteOr(sector.gdpObor, 0), gdpTotalObor);
  }
  return out;
}

function plannedGrowthPctOf(state: EconomyState, gdpTotalObor: number): number {
  let weighted = 0;
  for (const sector of state.sectors) {
    const base = finiteOr(sector.growthPermanentPct, 0) + finiteOr(sector.growthTemporaryPct, 0);
    weighted += finiteOr(sector.gdpObor, 0) * base;
  }
  return safeDivide(weighted, gdpTotalObor);
}

function deriveGenerationStage(state: EconomyState, gdpTotalObor: number): GenerationStage {
  const shareByKey = shareByKeyOf(state, gdpTotalObor);
  const plannedGrowthPct = plannedGrowthPctOf(state, gdpTotalObor);

  const ratingTier = ratingTierOf(state.ratingScore);
  const ratingFactor = ratingFactorOf(state.ratingScore);

  const controlBandIndex = controlBandIndexOf(state.controlPosition);
  const controlFrMultiplier = controlFrMultiplierOf(controlBandIndex);
  const stepLimitPp = stepLimitPpOf(controlBandIndex);

  const emissionPct = finiteOr(state.emissionPct, 0);
  const militaryPct = finiteOr(state.militaryPct, 0);
  const mobilized = state.mobilized === true;

  // The step is a hard cap, never a clamp (spec 12, guard G27). These two are
  // the limits V3 and V4 test; nothing here changes what the player typed.
  const emissionStepLimitPp = stepLimitPp;
  const militaryStepLimitPp = stepLimitPp
    + (mobilized ? ECONOMY_CONSTANTS.MOB_STEP_BONUS_PP : 0);

  const frTaxBase = safeDivide(gdpTotalObor, ECONOMY_CONSTANTS.OBOR_PER_FR_POINT)
    * ECONOMY_CONSTANTS.FR_TAX_RATE;
  const frGrowthFactor = clamp(
    1 + ECONOMY_CONSTANTS.FR_GROWTH_COEFF * plannedGrowthPct,
    ECONOMY_CONSTANTS.FR_GROWTH_FACTOR_MIN,
    ECONOMY_CONSTANTS.FR_GROWTH_FACTOR_MAX,
  );
  // The military share of the economy is the share that does not generate FR.
  // The floor is structural and, as the constants stand, unreachable: at the
  // 60% ceiling the drag bottoms out at 0,40 (guard G16).
  const frDefenceDrag = Math.max(
    ECONOMY_CONSTANTS.MILITARY_FR_DRAG_FLOOR,
    1 - ECONOMY_CONSTANTS.MILITARY_FR_DRAG * militaryPct / 100,
  );
  const frLightBonus = ECONOMY_CONSTANTS.FR_LIGHT_BONUS_COEFF * shareByKey.lightIndustry;

  // Both drags read the INCOMING counter. A drag armed by this turn's
  // privatization does not bite this turn — spec 15.2 says it starts next turn,
  // because this turn's income was already generated when the action resolved.
  const dragFactor = 1 - ECONOMY_CONSTANTS.PRIV_DRAG_PCT / 100;
  const privatizationFrDrag = finiteOr(state.privatizationFrDragTurns, 0) > 0 ? dragFactor : 1;
  const privatizationMicDrag = finiteOr(state.privatizationMicDragTurns, 0) > 0 ? dragFactor : 1;

  const frCore = frTaxBase
    * ratingFactor
    * controlFrMultiplier
    * frGrowthFactor
    * frDefenceDrag
    * (1 + frLightBonus)
    * privatizationFrDrag;

  // Emission enters additively, not as a multiplier: printing money creates new
  // money proportional to the money base, not to the tax take. A printing press
  // does not need a creditor, so a bad rating does not touch it.
  const frEmission = safeDivide(gdpTotalObor, ECONOMY_CONSTANTS.OBOR_PER_FR_POINT)
    * ECONOMY_CONSTANTS.EMISSION_FR_RATE
    * (emissionPct / 100);

  const frRegimeMultiplier = mobilized ? ECONOMY_CONSTANTS.FR_REGIME_MULT_MOBILIZED : 1;
  const frGenerated = (frCore + frEmission) * frRegimeMultiplier;

  const micHeavyBonus = ECONOMY_CONSTANTS.MIC_HEAVY_BONUS_COEFF * shareByKey.heavyIndustry;
  const micRegimeMultiplier = mobilized ? ECONOMY_CONSTANTS.MIC_REGIME_MULT_MOBILIZED : 1;
  const micGenerated = safeDivide(gdpTotalObor, ECONOMY_CONSTANTS.OBOR_PER_MIC_POINT)
    * (militaryPct / 100)
    * frGrowthFactor
    * (1 + micHeavyBonus)
    * privatizationMicDrag
    * micRegimeMultiplier;

  // Inflation is a per-turn derived value, never a stock. Dropping emission to 0
  // clears it the same turn.
  const inflationPct = ECONOMY_CONSTANTS.EMISSION_INFLATION_COEFF * emissionPct;
  const inflationGrowthPp = ECONOMY_CONSTANTS.INFLATION_GROWTH_COEFF * inflationPct;
  const defenceGrowthPp = ECONOMY_CONSTANTS.DEFENCE_GROWTH_COEFF
    * Math.max(0, militaryPct - ECONOMY_CONSTANTS.MILITARY_FREE_PCT);

  return {
    shareByKey,
    plannedGrowthPct,
    ratingTier,
    ratingFactor,
    controlBandIndex,
    controlBandName: controlBandNameOf(controlBandIndex),
    controlGrowthPp: controlGrowthPpOf(controlBandIndex),
    controlFrMultiplier,
    emissionStepLimitPp,
    militaryStepLimitPp,
    frTaxBase,
    frGrowthFactor,
    frDefenceDrag,
    frLightBonus,
    frRegimeMultiplier,
    frCore,
    frEmission,
    frGenerated,
    micHeavyBonus,
    micRegimeMultiplier,
    micGenerated,
    inflationPct,
    inflationGrowthPp,
    emissionRatingPenalty: emissionRatingPenaltyOf(emissionPct),
    defenceGrowthPp,
    mobilizationGrowthPp: mobilized ? ECONOMY_CONSTANTS.MOB_GROWTH_PP : 0,
  };
}

export { deriveGenerationStage, plannedGrowthPctOf, shareByKeyOf };
