import { pick } from "./rng";
import type { TRng } from "./rng";

/**
 * The toxic trail a player leaves in a world cell never fades, and the spec
 * lets it throw negative events at them — or nothing at all.
 */

type TTrailEventId = "bandits" | "undead" | "madness" | "worm";

type TTrailEvent = {
  readonly id: TTrailEventId;
  readonly title: string;
  readonly text: string;
};

const TRAIL_EVENTS: readonly TTrailEvent[] = [
  {
    id: "bandits",
    title: "Налёт бандитов",
    text: "Из отравленных пустошей пришли люди с мешками. Часть камня и дерева унесли с собой.",
  },
  {
    id: "undead",
    title: "Налёт нечисти",
    text: "Шлейф поднял то, что лежало под ним. Остров потерял людей, отбиваясь.",
  },
  {
    id: "madness",
    title: "Испарения шлейфа",
    text: "Ветер принёс сладковатый дым. Ещё несколько человек перестали узнавать своих.",
  },
  {
    id: "worm",
    title: "Мусорный червь",
    text: "Из недр поднялся червь и сожрал постройку вместе с половиной гекса.",
  },
];

/** The trail worth one percentage point of event chance. */
const TRAIL_PER_CHANCE_POINT = 8;
const MAX_EVENT_CHANCE = 0.6;

const eventChance = (trail: number) => {
  return Math.min(MAX_EVENT_CHANCE, trail / (TRAIL_PER_CHANCE_POINT * 100));
};

/** Rolls the trail. Most turns it gives back nothing, as the spec allows. */
const rollTrailEvent = (trail: number, rng: TRng) => {
  if (rng() > eventChance(trail)) {
    return null;
  }

  return pick(rng, TRAIL_EVENTS);
};

export type { TTrailEvent, TTrailEventId };
export { eventChance, rollTrailEvent, TRAIL_EVENTS };
