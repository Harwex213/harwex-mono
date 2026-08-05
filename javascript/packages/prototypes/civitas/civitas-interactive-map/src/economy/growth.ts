import { ECONOMY_CONSTANTS } from "./constants";
import { finiteOr, safeDivide } from "./num";
import type { GrowthInput, GrowthStage, SectorDerived } from "./types";

// Pipeline step 11, spec section 5.
//
// One modifier sum applies equally to every sector; the resource shortage is the
// only per-sector term. The shortage is MULTIPLICATIVE and applies only when
// pre-shortage growth is positive, which satisfies both halves of the sourced
// rule exactly: a full shortage lands on 0, and a sector already shrinking is
// untouched, so a shortage can never on its own drive growth negative (G9).

function modifierPpOf(input: GrowthInput): number {
  return input.controlGrowthPp
    + input.mobilizationGrowthPp
    + input.concessionGrowthPp
    + input.timedModifierPp
    + input.autoInvestGrowthPp
    - input.reservePenaltyPp
    - input.inflationGrowthPp
    - input.defenceGrowthPp;
}

function deriveGrowthStage(input: GrowthInput): GrowthStage {
  const modifierPp = modifierPpOf(input);
  const warnings: string[] = [];
  const sectors: SectorDerived[] = [];

  let weighted = 0;

  for (const sector of input.sectors) {
    const gdpObor = Math.max(0, finiteOr(sector.gdpObor, 0));
    const basePct = finiteOr(sector.growthPermanentPct, 0)
      + finiteOr(sector.growthTemporaryPct, 0);
    const shortagePenalty = input.penaltyByKey[sector.key] ?? 0;
    const preShortagePct = basePct + modifierPp;

    const shortened = preShortagePct > 0
      ? preShortagePct * (1 - shortagePenalty)
      : preShortagePct;
    // Guard G7: a sector's volume can reach 0 but never go below it.
    const finalPct = Math.max(ECONOMY_CONSTANTS.SECTOR_GROWTH_FLOOR_PCT, shortened);

    if (preShortagePct > 0 && shortagePenalty >= 1) {
      warnings.push("V18: " + sector.key + " growth zeroed by a full resource shortage");
    }

    weighted += gdpObor * finalPct;
    sectors.push({
      key: sector.key,
      gdpObor,
      share: input.shareByKey[sector.key] ?? 0,
      basePct,
      shortagePenalty,
      preShortagePct,
      finalPct,
      // Written at step 12. `gdp.ts` owns the next-turn volume.
      gdpNextObor: 0,
    });
  }

  return {
    modifierPp,
    sectors,
    // A GDP-weighted mean, not a plain one. Its useful property: the sum of the
    // grown sectors equals the total grown at this rate, up to rounding.
    overallGrowthPct: safeDivide(weighted, input.gdpTotalObor),
    warnings,
  };
}

export { deriveGrowthStage, modifierPpOf };
