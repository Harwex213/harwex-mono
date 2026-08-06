import { CONTROL_BANDS, ECONOMY_CONSTANTS } from "./constants";
import { clamp, finiteOr } from "./num";

// The state control scale, spec section 7.
//
// All three effects are generated from the band index `i`, and all three return
// the neutral value at `i = 5` by construction. Nothing is table-typed: change
// a coefficient in `ECONOMY_CONSTANTS` and the whole eleven-row table moves with
// it, which is what keeps band 50 neutral no matter how the scale is retuned.

const NEUTRAL = ECONOMY_CONSTANTS.CONTROL_NEUTRAL_BAND_INDEX;

function controlBandIndexOf(position: number): number {
  const safe = clamp(finiteOr(position, ECONOMY_CONSTANTS.START_CONTROL), 0, 100);
  for (let index = 0; index < CONTROL_BANDS.length; index += 1) {
    const band = CONTROL_BANDS[index] as { min: number; max: number };
    if (safe >= band.min && safe <= band.max) {
      return index;
    }
  }
  // Unreachable: the eleven bands are contiguous and cover 0..100.
  return NEUTRAL;
}

function controlBandNameOf(bandIndex: number): string {
  const band = CONTROL_BANDS[clamp(bandIndex, 0, CONTROL_BANDS.length - 1)];
  return band === undefined ? "" : band.name;
}

function controlGrowthPpOf(bandIndex: number): number {
  return ECONOMY_CONSTANTS.CONTROL_GROWTH_STEP_PP * (bandIndex - NEUTRAL);
}

function controlFrMultiplierOf(bandIndex: number): number {
  return 1 - ECONOMY_CONSTANTS.CONTROL_FR_STEP * (bandIndex - NEUTRAL);
}

function stepLimitPpOf(bandIndex: number): number {
  return (
    ECONOMY_CONSTANTS.STEP_LIMIT_NEUTRAL_PP
    - ECONOMY_CONSTANTS.CONTROL_STEP_SLOPE_PP * (bandIndex - NEUTRAL)
  );
}

export {
  controlBandIndexOf,
  controlBandNameOf,
  controlFrMultiplierOf,
  controlGrowthPpOf,
  stepLimitPpOf,
};
