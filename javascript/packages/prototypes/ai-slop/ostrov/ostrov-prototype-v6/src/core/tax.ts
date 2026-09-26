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
 * One ☣️ point on a face is worth this much of the hex. At 4% a swamp mine,
 * the dirtiest die in the game, kills its own hex in about five turns.
 */
const TOXICITY_PER_FACE_POINT_PCT = 4;
/**
 * Invented, as the spec asks. The island's toxicity load is the sum of what
 * lies on its hexes; every full 60 points of it drives one more person mad each
 * turn, and the mad eat food without working. The more a player builds, the
 * faster the island eats its own population.
 */
const MAD_PER_TOXICITY_STEP_POINTS = 60;

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

/** The island's whole toxicity load, which is what the HUD shows as ☣️. */
const totalToxicity = (player: TPlayer) => {
  return player.island.hexes.reduce((sum, hex) => sum + hex.toxicity, 0);
};

/** How many people go mad this turn. Never more people than the island has. */
const madConversion = (player: TPlayer) => {
  const driven = Math.floor(totalToxicity(player) / MAD_PER_TOXICITY_STEP_POINTS);

  return Math.min(player.resources.population, driven);
};

const isDead = (hex: THex) => hex.toxicity >= DEAD_TOXICITY_PCT;

const isFoodBlocked = (hex: THex) => hex.toxicity >= FOOD_BLOCKED_TOXICITY_PCT;

export {
  DEAD_TOXICITY_PCT,
  effectiveYield,
  FOOD_BLOCKED_TOXICITY_PCT,
  isDead,
  isFoodBlocked,
  madConversion,
  totalToxicity,
  toxicityGain,
};
