import { finiteOr, roundTo, safeDivide } from "./num";
import type { ConcessionStage, GdpStage, SectorDerived } from "./types";

// Pipeline step 12, spec sections 5.5 and 15.3.
//
// Rounding to whole obor happens PER SECTOR and the total is the sum of the
// rounded parts (guard G26). Rounding the total independently would let it
// disagree with the parts a player reads.

function deriveGdpStage(
  sectors: readonly SectorDerived[],
  concession: ConcessionStage,
  gdpTotalObor: number,
  provinceCount: number,
): GdpStage {
  const warnings: string[] = [];
  const grown: SectorDerived[] = sectors.map((sector) => {
    const next = Math.max(0, roundTo(sector.gdpObor * (1 + sector.finalPct / 100), 0));
    return { ...sector, gdpNextObor: next };
  });

  // A concession costs total GDP / province count (ruling 3). The chosen sector
  // decides only WHERE the loss lands, never what it is computed from, so every
  // player no longer picks their smallest sector and the mechanic keeps its
  // teeth. The cost is booked against the NEXT-turn volume, never against the
  // start-of-turn volume that section 4.2a freezes for the whole turn.
  let concessionCostObor = 0;
  const count = Math.max(0, Math.trunc(finiteOr(provinceCount, 0)));
  if (concession.granted && concession.sectorKey !== null && count > 0) {
    const target = grown.find((sector) => {
      return sector.key === concession.sectorKey;
    });
    if (target !== undefined) {
      const fullCost = roundTo(safeDivide(gdpTotalObor, count), 0);
      // Guard G8: the cost can never push a sector below 0. The remainder is
      // absorbed by the clamp, not carried to another sector or a later turn.
      concessionCostObor = Math.min(fullCost, target.gdpNextObor);
      target.gdpNextObor -= concessionCostObor;
      if (concessionCostObor < fullCost) {
        warnings.push(
          "V20: concession cost clamped from " + fullCost + " to " + concessionCostObor
          + " obor by " + target.key + "'s grown volume",
        );
      }
    }
  }

  let gdpNextTotalObor = 0;
  for (const sector of grown) {
    gdpNextTotalObor += sector.gdpNextObor;
  }

  return {
    sectors: grown,
    gdpNextTotalObor,
    gdpChangeObor: gdpNextTotalObor - gdpTotalObor,
    concessionCostObor,
    warnings,
  };
}

export { deriveGdpStage };
