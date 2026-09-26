import type { TRng, TTrailEvent, TTrailEventId } from "./types";

/**
 * The toxic trail events of plan §3.6. The roll only decides *what* happened;
 * the store applies the effect, using the constants exported here.
 */

const PERCENT_SCALE = 100;

/** Every trail point is worth two percent of a chance. */
const TRAIL_TO_CHANCE_FACTOR = 2;

/** However long the trail, the chance stops here. */
const MAX_EVENT_CHANCE_PERCENT = 60;

/** Flying into a cell nobody has scouted doubles the chance. */
const UNREVEALED_CHANCE_MULTIPLIER = 2;

/** Bandits take this share of the food and the stone, at least one of each. */
const BANDIT_LOSS_PERCENT = 10;
const BANDIT_MIN_LOSS = 1;

/** Undead queue this many extra enemies for the next clearing phase. */
const UNDEAD_EXTRA_ENEMIES = 2;

/** The growth turns this many citizens into insane ones. */
const INSANE_GROWTH_COUNT = 3;

/** The worm poisons one built hex by this much, and destroys the building at or above the threshold. */
const GARBAGE_WORM_TOXICITY = 15;
const GARBAGE_WORM_DESTROY_TOXICITY = 85;

/** An empty trail loses this many points. */
const EMPTY_TRAIL_RELIEF = 5;

type TTrailEventRange = {
  readonly maxRoll: number;
  readonly event: TTrailEvent;
};

const trailEvent = (id: TTrailEventId, titleRu: string, textRu: string): TTrailEvent => {
  return { id, titleRu, textRu };
};

/** d100, in the order of the plan's table. */
const TRAIL_EVENT_TABLE: readonly TTrailEventRange[] = [
  {
    maxRoll: 30,
    event: trailEvent(
      "bandits",
      "Налёт бандитов",
      "По шлейфу острова пришли бандиты и вынесли десятую часть еды и камня.",
    ),
  },
  {
    maxRoll: 55,
    event: trailEvent(
      "undead",
      "Налёт нечисти",
      "Нечисть учуяла отраву. В следующей зачистке вас ждут два лишних врага.",
    ),
  },
  {
    maxRoll: 80,
    event: trailEvent(
      "insane_growth",
      "Прирост сумасшедших",
      "Испарения свели с ума ещё троих жителей.",
    ),
  },
  {
    maxRoll: 95,
    event: trailEvent(
      "garbage_worm",
      "Мусорный червь",
      "Мусорный червь вгрызся в один из застроенных гексов и оставил после себя отраву.",
    ),
  },
  {
    maxRoll: 100,
    event: trailEvent(
      "empty",
      "Пустой шлейф",
      "Шлейф выдохся сам собой. Ничего не произошло.",
    ),
  },
];

/** The chance in percent that the trail fires an event this exploration phase. */
const trailEventChancePercent = (trail: number, arrivedUnrevealed: boolean): number => {
  if (trail <= 0) {
    return 0;
  }
  const multiplier = arrivedUnrevealed === true ? UNREVEALED_CHANCE_MULTIPLIER : 1;
  return Math.min(MAX_EVENT_CHANCE_PERCENT, trail * TRAIL_TO_CHANCE_FACTOR * multiplier);
};

const rollTrailEvent = (rng: TRng, trail: number, arrivedUnrevealed: boolean): TTrailEvent | null => {
  const chance = trailEventChancePercent(trail, arrivedUnrevealed);
  if (chance <= 0) {
    return null;
  }
  if (rng.next() * PERCENT_SCALE >= chance) {
    return null;
  }
  const roll = rng.int(1, PERCENT_SCALE);
  for (const range of TRAIL_EVENT_TABLE) {
    if (roll <= range.maxRoll) {
      return range.event;
    }
  }
  return null;
};

export {
  BANDIT_LOSS_PERCENT,
  BANDIT_MIN_LOSS,
  EMPTY_TRAIL_RELIEF,
  GARBAGE_WORM_DESTROY_TOXICITY,
  GARBAGE_WORM_TOXICITY,
  INSANE_GROWTH_COUNT,
  MAX_EVENT_CHANCE_PERCENT,
  UNDEAD_EXTRA_ENEMIES,
  rollTrailEvent,
  trailEventChancePercent,
};
