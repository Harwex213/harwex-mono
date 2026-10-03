import { hexDie } from "./dice";
import { createRng, hashSeed, randomInt } from "./rng";
import { POWER_PER_TURN } from "./stronghold";
import { DEAD_TOXICITY_PCT, facePayout, isDead, isFoodBlocked, withMadness } from "./tax";
import { withMeterGain } from "./toxic-slot";
import type { TPayoutEffects } from "./tax";
import type { TTechEffects } from "./techs";
import type { TBuildingId, TFace, THex, TPlayer, TResourceId } from "./types";

/**
 * The interactive tax phase. At the start of the phase every die on an island
 * is rolled once, and the rolls are kept in a plan. While the phase lasts the
 * player may spend power (власть) to swap a rolled face for another face of the
 * same die. Nothing is paid until the phase ends: then the plan is collected in
 * one go, the power is spent, the toxicity fills the island's meter, and the
 * mad eat.
 *
 * Costs. Swapping to a base face costs 1 power, swapping to the biome face
 * costs 2: the biome face is the one the hex is built for. Going back to the
 * rolled face is free. A building carries one choice at a time, so a second
 * pick on the same building replaces the first one and its power is refunded.
 * The power spent is never stored: it is read from the plan, so it cannot
 * drift away from the choices.
 */

const POWER_FACE_COST = 1;
const POWER_BIOME_FACE_COST = 2;
/** For a bot: one percent of hex toxicity is worth a quarter of a resource. */
const BOT_TOXICITY_WEIGHT = 0.25;

type TTaxRoll = {
  readonly hexId: string;
  /** What stood on the hex at the roll. A plan never pays a die that changed. */
  readonly dieKey: TBuildingId | "stronghold";
  readonly faces: readonly TFace[];
  readonly biomeFaceIndex: number;
  readonly rolledIndex: number;
  /** The face the phase will pay. Equals `rolledIndex` until power changes it. */
  readonly chosenIndex: number;
};

type TTaxPlan = {
  readonly playerId: string;
  readonly turn: number;
  readonly rolls: readonly TTaxRoll[];
};

/** Resources a payout can carry. Toxicity travels separately, on the hex. */
type TPayoutResourceId = Exclude<TResourceId, "mad">;

/** One line of the collection: what one hex pays and what it leaves behind. */
type TTaxPayout = {
  readonly hexId: string;
  readonly resource: TPayoutResourceId;
  readonly amount: number;
  /** Percent added to the hex's own toxicity. */
  readonly toxicity: number;
};

type TPickRefusalCode = "no-roll" | "dead" | "food-blocked" | "power";

type TPickRefusal = {
  readonly code: TPickRefusalCode;
  readonly message: string;
};

const findHex = (player: TPlayer, hexId: string): THex | null => {
  return player.island.hexes.find((hex) => hex.id === hexId) ?? null;
};

const dieKeyOf = (player: TPlayer, hex: THex): TBuildingId | "stronghold" | null => {
  if (player.strongholdHexId === hex.id) {
    return "stronghold";
  }

  return hex.building;
};

/**
 * Rolls every die on the island once. The rolls are seeded by the world seed,
 * the turn and the player, so a turn always rolls the same, and opening the
 * phase twice cannot re-roll it.
 */
const rollTaxPlan = (player: TPlayer, turn: number, seed: string): TTaxPlan => {
  const rng = createRng(hashSeed(`${seed}:tax:${turn}:${player.id}`));
  const rolls: TTaxRoll[] = [];

  for (const hex of player.island.hexes) {
    const die = hexDie(player, hex);
    const dieKey = dieKeyOf(player, hex);
    if (!die || !dieKey || die.faces.length === 0) {
      continue;
    }

    const rolledIndex = randomInt(rng, 0, die.faces.length - 1);

    rolls.push({
      hexId: hex.id,
      dieKey,
      faces: die.faces,
      biomeFaceIndex: die.biomeFaceIndex,
      rolledIndex,
      chosenIndex: rolledIndex,
    });
  }

  return { playerId: player.id, turn, rolls };
};

const findRoll = (plan: TTaxPlan | null, hexId: string): TTaxRoll | null => {
  if (!plan) {
    return null;
  }

  return plan.rolls.find((roll) => roll.hexId === hexId) ?? null;
};

/** The power a face costs against the roll. The rolled face is always free. */
const pickCost = (roll: TTaxRoll, index: number) => {
  if (index === roll.rolledIndex) {
    return 0;
  }

  return index === roll.biomeFaceIndex ? POWER_BIOME_FACE_COST : POWER_FACE_COST;
};

const planPowerSpent = (plan: TTaxPlan | null) => {
  if (!plan) {
    return 0;
  }

  return plan.rolls.reduce((sum, roll) => sum + pickCost(roll, roll.chosenIndex), 0);
};

/** The power still free to spend, after the choices already in the plan. */
const powerLeft = (player: TPlayer, plan: TTaxPlan | null) => {
  return player.resources.power - planPowerSpent(plan);
};

/**
 * Whether the face at `index` can become the paid face of the die on `hexId`.
 * Returns `null` when it can. Going back to the rolled face, or picking the
 * face already chosen, is always allowed. The power already spent on this
 * building counts as free, because a new pick refunds it.
 */
const pickRefusal = (player: TPlayer, plan: TTaxPlan | null, hexId: string, index: number): TPickRefusal | null => {
  const roll = findRoll(plan, hexId);
  const hex = findHex(player, hexId);
  const face = roll?.faces[index];
  if (!roll || !hex || !face) {
    return { code: "no-roll", message: "На этом гексе нечего бросать" };
  }

  if (index === roll.chosenIndex || index === roll.rolledIndex) {
    return null;
  }

  if (isDead(hex)) {
    return { code: "dead", message: `Гекс мёртв (${DEAD_TOXICITY_PCT}%): любая грань даст 0` };
  }

  if (face.resource === "food" && isFoodBlocked(hex)) {
    return { code: "food-blocked", message: "Токсичность выше 50%: еда здесь не вырастет" };
  }

  const cost = pickCost(roll, index);
  const available = powerLeft(player, plan) + pickCost(roll, roll.chosenIndex);
  if (available < cost) {
    return { code: "power", message: `Не хватает власти: нужно ${cost}, есть ${Math.max(0, available)}` };
  }

  return null;
};

/** The plan with one die paying another face. The caller checks the refusal. */
const withPick = (plan: TTaxPlan, hexId: string, index: number): TTaxPlan => ({
  ...plan,
  rolls: plan.rolls.map((roll) => (roll.hexId === hexId ? { ...roll, chosenIndex: index } : roll)),
});

/**
 * Everything the plan pays, hex by hex, with the stronghold's power income as
 * its own line. A roll whose die is gone or changed pays nothing.
 */
const planPayouts = (player: TPlayer, plan: TTaxPlan, effects: TPayoutEffects): readonly TTaxPayout[] => {
  const payouts: TTaxPayout[] = [];

  for (const roll of plan.rolls) {
    const hex = findHex(player, roll.hexId);
    const face = roll.faces[roll.chosenIndex];
    if (!hex || !face || dieKeyOf(player, hex) !== roll.dieKey) {
      continue;
    }

    const paid = facePayout(face, hex, effects);
    payouts.push({ hexId: hex.id, resource: face.resource, amount: paid.amount, toxicity: paid.toxicity });

    if (roll.dieKey === "stronghold") {
      payouts.push({ hexId: hex.id, resource: "power", amount: POWER_PER_TURN, toxicity: 0 });
    }
  }

  return payouts;
};

/** Takes the plan's power off the pool. Done once, when the phase ends. */
const withPowerSpent = (player: TPlayer, plan: TTaxPlan): TPlayer => ({
  ...player,
  resources: {
    ...player.resources,
    power: Math.max(0, player.resources.power - planPowerSpent(plan)),
  },
});

/** Adds a paid amount to the pool. */
const withYield = (player: TPlayer, resource: TPayoutResourceId, amount: number): TPlayer => ({
  ...player,
  resources: { ...player.resources, [resource]: player.resources[resource] + amount },
});

/** Dirties one hex, never past the dead mark. */
const withHexToxicity = (player: TPlayer, hexId: string, pct: number): TPlayer => {
  if (pct === 0) {
    return player;
  }

  const hexes = player.island.hexes.map((hex) => {
    return hex.id === hexId ? { ...hex, toxicity: Math.min(DEAD_TOXICITY_PCT, hex.toxicity + pct) } : hex;
  });

  return { ...player, island: { hexes } };
};

/**
 * The toxicity half of a payout: the hex gets dirtier, and the same percent
 * fills the island's meter.
 */
const withToxicityPaid = (player: TPlayer, hexId: string, pct: number): TPlayer => {
  return withMeterGain(withHexToxicity(player, hexId, pct), pct);
};

/**
 * Pays one payout line. The tax animation pays the same line in two halves,
 * the yield and the toxicity, as their motes land.
 */
const withPayout = (player: TPlayer, payout: TTaxPayout): TPlayer => {
  return withToxicityPaid(withYield(player, payout.resource, payout.amount), payout.hexId, payout.toxicity);
};

/**
 * The whole end of the tax phase in one pure step: power spent, every payout,
 * then the mad eat. The bots collect through this; the player's animation runs
 * the same three steps one mote at a time.
 */
const collectTaxPlan = (player: TPlayer, plan: TTaxPlan, effects: TTechEffects): TPlayer => {
  const paid = planPayouts(player, plan, effects).reduce(withPayout, withPowerSpent(player, plan));

  return withMadness(paid, 0, effects.madCuredPerTurn);
};

/**
 * A bot's picks: it swaps the rolls that gain the most per power first, while
 * its power lasts. A face is worth its payout minus a quarter per percent of
 * toxicity it leaves.
 */
const withBotPicks = (player: TPlayer, plan: TTaxPlan, effects: TPayoutEffects): TTaxPlan => {
  const worth = (face: TFace, hex: THex) => {
    const paid = facePayout(face, hex, effects);

    return paid.amount - paid.toxicity * BOT_TOXICITY_WEIGHT;
  };

  const candidates = plan.rolls.flatMap((roll) => {
    const hex = findHex(player, roll.hexId);
    const rolled = roll.faces[roll.rolledIndex];
    if (!hex || !rolled || isDead(hex)) {
      return [];
    }

    let bestIndex = roll.rolledIndex;
    let bestGain = 0;

    roll.faces.forEach((face, index) => {
      const gain = worth(face, hex) - worth(rolled, hex);
      if (gain > bestGain) {
        bestGain = gain;
        bestIndex = index;
      }
    });

    if (bestIndex === roll.rolledIndex) {
      return [];
    }

    return [{ hexId: roll.hexId, index: bestIndex, ratio: bestGain / pickCost(roll, bestIndex) }];
  });

  candidates.sort((left, right) => right.ratio - left.ratio);

  return candidates.reduce((current, candidate) => {
    if (pickRefusal(player, current, candidate.hexId, candidate.index) !== null) {
      return current;
    }

    return withPick(current, candidate.hexId, candidate.index);
  }, plan);
};

export type { TPayoutResourceId, TPickRefusal, TPickRefusalCode, TTaxPayout, TTaxPlan, TTaxRoll };
export {
  collectTaxPlan,
  findRoll,
  pickCost,
  pickRefusal,
  planPayouts,
  planPowerSpent,
  POWER_BIOME_FACE_COST,
  POWER_FACE_COST,
  powerLeft,
  rollTaxPlan,
  withBotPicks,
  withHexToxicity,
  withPayout,
  withPick,
  withPowerSpent,
  withToxicityPaid,
  withYield,
};
