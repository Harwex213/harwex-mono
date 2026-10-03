import type { TTechEffects } from "./techs";
import type { TFace, THex, TPlayer } from "./types";

/**
 * The rules of the tax phase. Every building rolls one face of its die; the
 * hex's own toxicity eats into what the roll pays out and then grows by what
 * the roll leaves behind.
 */

/** A hex this toxic produces nothing at all: the spec's "клетка бесполезна". */
const DEAD_TOXICITY_PCT = 100;
/** Past this, the spec forbids food outright, not merely reduces it. */
const FOOD_BLOCKED_TOXICITY_PCT = 50;
/**
 * One toxicity point on a face is worth this much of the hex. At 4% a swamp mine,
 * the dirtiest die in the game, kills its own hex in about five turns.
 */
const TOXICITY_PER_FACE_POINT_PCT = 4;

/** What the face actually pays after the hex's toxicity has taken its cut. */
const effectiveYield = (face: TFace, hex: THex) => {
  if (hex.toxicity >= DEAD_TOXICITY_PCT) {
    return 0;
  }

  if (face.resource === "food" && hex.toxicity >= FOOD_BLOCKED_TOXICITY_PCT) {
    return 0;
  }

  return Math.max(0, Math.round(face.amount * (1 - hex.toxicity / 100)));
};

/** How much the hex is dirtied by the roll, never past the dead mark. */
const toxicityGain = (face: TFace, hex: THex) => {
  if (hex.toxicity >= DEAD_TOXICITY_PCT) {
    return 0;
  }

  return Math.min(DEAD_TOXICITY_PCT - hex.toxicity, face.toxicity * TOXICITY_PER_FACE_POINT_PCT);
};

/**
 * The island's whole toxicity load: the sum over its hexes. The exploration
 * phase leaves it in the world cell as the toxic trail.
 */
const totalToxicity = (player: TPlayer) => {
  return player.island.hexes.reduce((sum, hex) => sum + hex.toxicity, 0);
};

/** The part of the researched technologies that changes a tax payout. */
type TPayoutEffects = Pick<TTechEffects, "foodBonus" | "toxicityMultiplier">;

/**
 * What one face really pays on one hex this turn: the yield after the hex's
 * toxicity and the irrigation bonus, and the toxicity in percent it leaves on
 * the hex. The roll plate, the pick popup and the collection all read this.
 */
const facePayout = (face: TFace, hex: THex, effects: TPayoutEffects) => {
  const raw = effectiveYield(face, hex);
  // Irrigation adds to a roll that pays food, but never revives a dead hex.
  const amount = raw > 0 && face.resource === "food" ? raw + effects.foodBonus : raw;
  const toxicity = Math.round(toxicityGain(face, hex) * effects.toxicityMultiplier);

  return { amount, toxicity };
};

/**
 * The madness step of the tax phase. `converted` people go mad, asylums send
 * up to `curedPerTurn` of the mad back to work, and every mad person left eats
 * one food without working. Food never drops below zero. The tax phase itself
 * drives nobody mad any more: people go mad only through the toxicity slot
 * (`core/toxic-slot.ts`), so it passes 0.
 */
const withMadness = (player: TPlayer, converted: number, curedPerTurn: number): TPlayer => {
  const cured = Math.min(player.resources.mad, curedPerTurn);
  const mad = player.resources.mad + converted - cured;

  return {
    ...player,
    resources: {
      ...player.resources,
      population: player.resources.population - converted + cured,
      mad,
      food: Math.max(0, player.resources.food - mad),
    },
  };
};

const isDead = (hex: THex) => hex.toxicity >= DEAD_TOXICITY_PCT;

const isFoodBlocked = (hex: THex) => hex.toxicity >= FOOD_BLOCKED_TOXICITY_PCT;

export type { TPayoutEffects };
export {
  DEAD_TOXICITY_PCT,
  effectiveYield,
  facePayout,
  FOOD_BLOCKED_TOXICITY_PCT,
  isDead,
  isFoodBlocked,
  totalToxicity,
  toxicityGain,
  withMadness,
};
