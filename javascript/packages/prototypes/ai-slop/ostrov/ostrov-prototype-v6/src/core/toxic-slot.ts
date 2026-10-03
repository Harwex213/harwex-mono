import { getBuilding } from "./buildings";
import { ICONS } from "./icons";
import { getResource } from "./resources";
import { createRng, hashSeed, randomInt } from "./rng";
import { DEAD_TOXICITY_PCT } from "./tax";
import type { TRng } from "./rng";
import type { THex, TPlayer, TResourceId } from "./types";

/**
 * The island's toxicity meter and the slot under it.
 *
 * The meter. Every player has one meter, 0..1000. In the tax phase each
 * percent of toxicity a building leaves on its hex adds 2.5 points to the
 * meter. A hex that is already dead takes no more toxicity and adds nothing.
 * Measured on islands that grow from 3 to 10 buildings, before any luck: the
 * meter reaches "Малые" on turns 5-8, "Значительные" on turns 7-11 and
 * "Катастрофические" on turns 9-17. The meter never drops by itself. Only a
 * lucky spin lowers it.
 *
 * The slot. Once per turn, when the tax phase ends, a meter at "Малые" or
 * above spins three reels. Each reel shows a bad symbol (skull, poison) with
 * the chance of the level. At a full meter one reel always shows a skull. The
 * number of bad symbols picks the outcome, and the level and the outcome pick
 * one event from the catalog. Everything is seeded by the world seed, the turn
 * and the player, so a spin can be replayed exactly.
 */

const METER_MAX = 1000;
const METER_PER_HEX_TOXICITY_PCT = 2.5;
const REEL_COUNT = 3;

type TMeterLevel = 0 | 1 | 2 | 3;

type TMeterZone = {
  readonly level: TMeterLevel;
  /** The first meter value of the zone. */
  readonly from: number;
  /** The last meter value of the zone. */
  readonly to: number;
  readonly label: string;
  /** The status line under the meter's counter. */
  readonly status: string;
};

const METER_ZONES: readonly TMeterZone[] = [
  { level: 0, from: 0, to: 249, label: "Нет последствий", status: "Нет последствий" },
  { level: 1, from: 250, to: 499, label: "Малые", status: "Малые последствия" },
  { level: 2, from: 500, to: 799, label: "Значительные", status: "Значительные последствия" },
  { level: 3, from: 800, to: METER_MAX, label: "Катастрофические", status: "Катастрофические последствия" },
];

/** The chance that one reel shows a bad symbol, per level. Level 0 never spins. */
const BAD_CHANCE_BY_LEVEL: Readonly<Record<TMeterLevel, number>> = {
  0: 0,
  1: 0.35,
  2: 0.55,
  3: 0.75,
};

type TSlotSymbolId = "gear" | "coin" | "skull" | "poison";

type TSlotSymbol = {
  readonly id: TSlotSymbolId;
  readonly label: string;
  readonly icon: string;
  readonly isBad: boolean;
};

const SLOT_SYMBOLS: Readonly<Record<TSlotSymbolId, TSlotSymbol>> = {
  gear: { id: "gear", label: "Шестерня", icon: ICONS.technology, isBad: false },
  coin: { id: "coin", label: "Монета", icon: ICONS.coin, isBad: false },
  skull: { id: "skull", label: "Череп", icon: ICONS.dead, isBad: true },
  poison: { id: "poison", label: "Капля яда", icon: ICONS.poison, isBad: true },
};

/** 0 bad symbols: luck. 1: a small fortune. 2: a misfortune. 3: a disaster. */
type TSlotOutcome = "luck" | "fortune" | "misfortune" | "disaster";

const OUTCOME_BY_BAD_COUNT: readonly TSlotOutcome[] = ["luck", "fortune", "misfortune", "disaster"];

const OUTCOME_LABELS: Readonly<Record<TSlotOutcome, string>> = {
  luck: "Удача",
  fortune: "Малая удача",
  misfortune: "Несчастье",
  disaster: "Бедствие",
};

/**
 * One step of an event. The numbers are the rule; the catalog text only
 * describes them. Every step is applied in order on the same seeded stream.
 */
type TSlotEffect =
  /** The meter drops by a seeded amount in `min..max`. */
  | { readonly kind: "meter"; readonly min: number; readonly max: number }
  | { readonly kind: "gain"; readonly resource: TResourceId; readonly amount: number }
  /** Takes `percent` of a resource, at least `min` while the pool has any. */
  | { readonly kind: "loss"; readonly resource: TResourceId; readonly percent: number; readonly min: number }
  /** Healthy people go mad. Never more than the population. */
  | { readonly kind: "madness"; readonly count: number }
  /** People die. */
  | { readonly kind: "deaths"; readonly count: number }
  | { readonly kind: "army"; readonly count: number }
  /** Random built hexes take more toxicity, never past the dead mark. */
  | { readonly kind: "pollute"; readonly hexes: number; readonly pct: number }
  /** The most toxic hexes lose toxicity. */
  | { readonly kind: "cleanse"; readonly hexes: number; readonly pct: number }
  /** The worm eats one building (never the stronghold) and poisons its hex. */
  | { readonly kind: "worm"; readonly pct: number };

type TSlotEvent = {
  readonly id: string;
  readonly level: Exclude<TMeterLevel, 0>;
  readonly outcome: TSlotOutcome;
  readonly title: string;
  readonly text: string;
  readonly icon: string;
  readonly effects: readonly TSlotEffect[];
};

/**
 * The catalog: one event per level and outcome. The bad events grow from the
 * bandits of "Малые" to the garbage worm of "Катастрофические", the lucky
 * ones grow with the level too.
 */
const SLOT_EVENTS: readonly TSlotEvent[] = [
  {
    id: "clean-wind",
    level: 1,
    outcome: "luck",
    title: "Чистый ветер",
    text: "Ветер переменился и унёс ядовитую дымку за край острова.",
    icon: ICONS.scouting,
    effects: [{ kind: "meter", min: 100, max: 150 }],
  },
  {
    id: "spoil-heap",
    level: 1,
    outcome: "fortune",
    title: "Находка в отвалах",
    text: "Старатели перебрали отвалы и нашли годный камень и доски.",
    icon: ICONS.stone,
    effects: [
      { kind: "gain", resource: "stone", amount: 4 },
      { kind: "gain", resource: "wood", amount: 3 },
    ],
  },
  {
    id: "bandits",
    level: 1,
    outcome: "misfortune",
    title: "Налёт бандитов",
    text: "По ядовитому следу острова пришли бандиты и унесли часть еды и камня.",
    icon: ICONS.archer,
    effects: [
      { kind: "loss", resource: "food", percent: 20, min: 1 },
      { kind: "loss", resource: "stone", percent: 20, min: 1 },
    ],
  },
  {
    id: "fumes",
    level: 1,
    outcome: "disaster",
    title: "Испарения",
    text: "Над стоками поднялся сладковатый дым. Двое жителей перестали узнавать своих.",
    icon: ICONS.mad,
    effects: [
      { kind: "madness", count: 2 },
      { kind: "loss", resource: "food", percent: 10, min: 1 },
    ],
  },
  {
    id: "cleansing-rain",
    level: 2,
    outcome: "luck",
    title: "Очищающий ливень",
    text: "Тяжёлый ливень смыл отраву со склонов в море.",
    icon: ICONS.mana,
    effects: [{ kind: "meter", min: 150, max: 200 }],
  },
  {
    id: "caravan",
    level: 2,
    outcome: "fortune",
    title: "Брошенный караван",
    text: "В пустошах нашли ржавый караван с инструментом и печатями прежней власти.",
    icon: ICONS.hammers,
    effects: [
      { kind: "gain", resource: "hammers", amount: 4 },
      { kind: "gain", resource: "power", amount: 1 },
    ],
  },
  {
    id: "undead",
    level: 2,
    outcome: "misfortune",
    title: "Налёт нечисти",
    text: "Отрава подняла то, что лежало в земле. Остров отбился, но потерял людей и бойцов.",
    icon: ICONS.zombie,
    effects: [
      { kind: "deaths", count: 2 },
      { kind: "army", count: 2 },
    ],
  },
  {
    id: "toxic-fog",
    level: 2,
    outcome: "disaster",
    title: "Ядовитый туман",
    text: "Туман лёг на постройки. Трое сошли с ума, а земля под двумя зданиями прогнила.",
    icon: ICONS.moth,
    effects: [
      { kind: "madness", count: 3 },
      { kind: "pollute", hexes: 2, pct: 15 },
    ],
  },
  {
    id: "great-cleansing",
    level: 3,
    outcome: "luck",
    title: "Великое очищение",
    text: "Небо прорвало чистой водой. Остров дышит так, как не дышал много лет.",
    icon: ICONS.mana,
    effects: [{ kind: "meter", min: 200, max: 250 }],
  },
  {
    id: "witch-gift",
    level: 3,
    outcome: "fortune",
    title: "Дар ведьмы",
    text: "Болотная ведьма взяла плату отравой: два самых грязных гекса стали чище, в запасе прибавилось маны.",
    icon: ICONS.witch,
    effects: [
      { kind: "cleanse", hexes: 2, pct: 20 },
      { kind: "gain", resource: "mana", amount: 3 },
    ],
  },
  {
    id: "ghouls",
    level: 3,
    outcome: "misfortune",
    title: "Ночь упырей",
    text: "На запах отравы пришли упыри. Утром не досчитались троих, ещё двое бредят.",
    icon: ICONS.vampire,
    effects: [
      { kind: "deaths", count: 3 },
      { kind: "madness", count: 2 },
      { kind: "army", count: 1 },
    ],
  },
  {
    id: "garbage-worm",
    level: 3,
    outcome: "disaster",
    title: "Мусорный червь",
    text: "Из недр поднялся мусорный червь. Он жрёт постройки и оставляет за собой отраву.",
    icon: ICONS.leech,
    effects: [
      { kind: "worm", pct: 40 },
      { kind: "pollute", hexes: 2, pct: 15 },
      { kind: "madness", count: 2 },
    ],
  },
];

/** One line of the event display: what really happened, with real numbers. */
type TSlotEffectLine = {
  readonly icon: string;
  readonly text: string;
  readonly tone: "good" | "bad";
};

type TSlotSpin = {
  readonly playerId: string;
  readonly turn: number;
  readonly level: Exclude<TMeterLevel, 0>;
  readonly reels: readonly TSlotSymbolId[];
  /** The reel the full meter forced to a skull, or `null`. */
  readonly forcedReel: number | null;
  readonly badCount: number;
  readonly outcome: TSlotOutcome;
  readonly eventId: string;
  readonly meterBefore: number;
  readonly meterAfter: number;
  readonly lines: readonly TSlotEffectLine[];
};

const clampMeter = (value: number) => Math.max(0, Math.min(METER_MAX, Math.round(value)));

const meterLevel = (value: number): TMeterLevel => {
  let level: TMeterLevel = 0;

  for (const zone of METER_ZONES) {
    if (value >= zone.from) {
      level = zone.level;
    }
  }

  return level;
};

const getMeterZone = (level: TMeterLevel): TMeterZone => {
  const zone = METER_ZONES.find((candidate) => candidate.level === level);
  if (!zone) {
    throw new Error(`Unknown meter level: ${level}`);
  }

  return zone;
};

/** Meter points for toxicity, in percent, that the tax phase leaves on a hex. */
const meterGain = (hexToxicityPct: number) => Math.round(hexToxicityPct * METER_PER_HEX_TOXICITY_PCT);

const withMeterGain = (player: TPlayer, hexToxicityPct: number): TPlayer => {
  if (hexToxicityPct <= 0) {
    return player;
  }

  return { ...player, toxicMeter: clampMeter(player.toxicMeter + meterGain(hexToxicityPct)) };
};

const outcomeOf = (badCount: number): TSlotOutcome => {
  return OUTCOME_BY_BAD_COUNT[Math.max(0, Math.min(REEL_COUNT, badCount))] ?? "luck";
};

const findSlotEvent = (level: Exclude<TMeterLevel, 0>, outcome: TSlotOutcome): TSlotEvent => {
  const event = SLOT_EVENTS.find((candidate) => candidate.level === level && candidate.outcome === outcome);
  if (!event) {
    throw new Error(`No slot event for level ${level} and outcome ${outcome}`);
  }

  return event;
};

const getSlotEvent = (id: string): TSlotEvent => {
  const event = SLOT_EVENTS.find((candidate) => candidate.id === id);
  if (!event) {
    throw new Error(`Unknown slot event: ${id}`);
  }

  return event;
};

/**
 * The three reels. Every reel draws the same two numbers whatever it shows,
 * so the stream stays aligned. At a full meter one seeded reel is a skull.
 */
const rollReels = (rng: TRng, level: TMeterLevel, isFull: boolean) => {
  const chance = BAD_CHANCE_BY_LEVEL[level];
  const forcedReel = isFull ? randomInt(rng, 0, REEL_COUNT - 1) : null;
  const reels: TSlotSymbolId[] = [];

  for (let index = 0; index < REEL_COUNT; index += 1) {
    const isBad = rng() < chance;
    const isFirstOfPair = rng() < 0.5;

    if (index === forcedReel) {
      reels.push("skull");
    } else if (isBad) {
      reels.push(isFirstOfPair ? "skull" : "poison");
    } else {
      reels.push(isFirstOfPair ? "gear" : "coin");
    }
  }

  return { reels, forcedReel };
};

/** "1 житель", "2 жителя", "5 жителей". */
const plural = (count: number, one: string, few: string, many: string) => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return one;
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return few;
  }

  return many;
};

const resourceLabel = (resource: TResourceId) => getResource(resource).label;

const withResource = (player: TPlayer, resource: TResourceId, delta: number): TPlayer => ({
  ...player,
  resources: { ...player.resources, [resource]: Math.max(0, player.resources[resource] + delta) },
});

const withHexes = (player: TPlayer, change: (hex: THex) => THex): TPlayer => ({
  ...player,
  island: { hexes: player.island.hexes.map(change) },
});

/** Picks up to `count` different items, seeded. */
const pickSome = <T,>(rng: TRng, items: readonly T[], count: number): T[] => {
  const pool = [...items];
  const picked: T[] = [];

  while (picked.length < count && pool.length > 0) {
    const index = Math.floor(rng() * pool.length);
    const [item] = pool.splice(index, 1);
    if (item !== undefined) {
      picked.push(item);
    }
  }

  return picked;
};

type TApplied = {
  readonly player: TPlayer;
  readonly lines: readonly TSlotEffectLine[];
};

const applyEffect = (state: TApplied, effect: TSlotEffect, rng: TRng): TApplied => {
  const { player, lines } = state;

  if (effect.kind === "meter") {
    const drop = randomInt(rng, effect.min, effect.max);
    const next = clampMeter(player.toxicMeter - drop);

    return {
      player: { ...player, toxicMeter: next },
      lines: [...lines, { icon: ICONS.toxicity, text: `Шкала токсичности −${player.toxicMeter - next}`, tone: "good" }],
    };
  }

  if (effect.kind === "gain") {
    return {
      player: withResource(player, effect.resource, effect.amount),
      lines: [
        ...lines,
        { icon: getResource(effect.resource).icon, text: `+${effect.amount} ${resourceLabel(effect.resource)}`, tone: "good" },
      ],
    };
  }

  if (effect.kind === "loss") {
    const held = player.resources[effect.resource];
    const taken = Math.min(held, Math.max(effect.min, Math.floor((held * effect.percent) / 100)));
    if (taken <= 0) {
      return state;
    }

    return {
      player: withResource(player, effect.resource, -taken),
      lines: [
        ...lines,
        { icon: getResource(effect.resource).icon, text: `−${taken} ${resourceLabel(effect.resource)}`, tone: "bad" },
      ],
    };
  }

  if (effect.kind === "madness") {
    const moved = Math.min(effect.count, player.resources.population);
    if (moved <= 0) {
      return state;
    }

    const next = withResource(withResource(player, "population", -moved), "mad", moved);

    return {
      player: next,
      lines: [
        ...lines,
        { icon: ICONS.mad, text: `${moved} ${plural(moved, "житель сошёл", "жителя сошли", "жителей сошли")} с ума`, tone: "bad" },
      ],
    };
  }

  if (effect.kind === "deaths") {
    const lost = Math.min(effect.count, player.resources.population);
    if (lost <= 0) {
      return state;
    }

    return {
      player: withResource(player, "population", -lost),
      lines: [...lines, { icon: ICONS.population, text: `−${lost} ${resourceLabel("population")}`, tone: "bad" }],
    };
  }

  if (effect.kind === "army") {
    const lost = Math.min(effect.count, player.army);
    if (lost <= 0) {
      return state;
    }

    return {
      player: { ...player, army: player.army - lost },
      lines: [...lines, { icon: ICONS.army, text: `−${lost} ${plural(lost, "боец", "бойца", "бойцов")}`, tone: "bad" }],
    };
  }

  if (effect.kind === "pollute") {
    const living = player.island.hexes.filter((hex) => hex.toxicity < DEAD_TOXICITY_PCT);
    const built = living.filter((hex) => hex.building !== null || hex.id === player.strongholdHexId);
    const targets = pickSome(rng, built.length > 0 ? built : living, effect.hexes);
    if (targets.length === 0) {
      return state;
    }

    const ids = new Set(targets.map((hex) => hex.id));

    return {
      player: withHexes(player, (hex) => {
        return ids.has(hex.id) ? { ...hex, toxicity: Math.min(DEAD_TOXICITY_PCT, hex.toxicity + effect.pct) } : hex;
      }),
      lines: [
        ...lines,
        {
          icon: ICONS.toxicity,
          text: `+${effect.pct}% токсичности на ${targets.length} ${plural(targets.length, "гексе", "гексах", "гексах")}`,
          tone: "bad",
        },
      ],
    };
  }

  if (effect.kind === "cleanse") {
    const dirty = [...player.island.hexes]
      .filter((hex) => hex.toxicity > 0)
      .sort((left, right) => right.toxicity - left.toxicity || left.id.localeCompare(right.id))
      .slice(0, effect.hexes);
    if (dirty.length === 0) {
      return state;
    }

    const ids = new Set(dirty.map((hex) => hex.id));

    return {
      player: withHexes(player, (hex) => {
        return ids.has(hex.id) ? { ...hex, toxicity: Math.max(0, hex.toxicity - effect.pct) } : hex;
      }),
      lines: [
        ...lines,
        {
          icon: ICONS.toxicity,
          text: `−${effect.pct}% токсичности на ${dirty.length} ${plural(dirty.length, "гексе", "гексах", "гексах")}`,
          tone: "good",
        },
      ],
    };
  }

  // The worm. The stronghold is the island's heart and is never eaten.
  const prey = player.island.hexes.filter((hex) => hex.building !== null && hex.id !== player.strongholdHexId);
  const victim = prey.length > 0 ? prey[Math.floor(rng() * prey.length)] : undefined;
  if (!victim || !victim.building) {
    // Nothing to eat: the worm burrows through a living hex and poisons it.
    const living = player.island.hexes.filter((hex) => hex.toxicity < DEAD_TOXICITY_PCT);
    const burrow = living.length > 0 ? living[Math.floor(rng() * living.length)] : undefined;
    if (!burrow) {
      return state;
    }

    return {
      player: withHexes(player, (hex) => {
        return hex.id === burrow.id ? { ...hex, toxicity: Math.min(DEAD_TOXICITY_PCT, hex.toxicity + effect.pct) } : hex;
      }),
      lines: [...lines, { icon: ICONS.leech, text: `Червю нечего есть: он отравил гекс (+${effect.pct}%)`, tone: "bad" }],
    };
  }

  const label = getBuilding(victim.building).label;

  return {
    player: withHexes(player, (hex) => {
      if (hex.id !== victim.id) {
        return hex;
      }

      return { ...hex, building: null, toxicity: Math.min(DEAD_TOXICITY_PCT, hex.toxicity + effect.pct) };
    }),
    lines: [...lines, { icon: ICONS.leech, text: `Червь сожрал: ${label} (+${effect.pct}% на гексе)`, tone: "bad" }],
  };
};

/**
 * The whole spin of one player in one turn. Returns `null` when the meter is
 * below "Малые" and the slot stays off. The same player, turn and seed always
 * give the same spin and the same player after it.
 */
const rollSlot = (player: TPlayer, turn: number, seed: string): { spin: TSlotSpin; player: TPlayer } | null => {
  const level = meterLevel(player.toxicMeter);
  if (level === 0) {
    return null;
  }

  const rng = createRng(hashSeed(`${seed}:slot:${turn}:${player.id}`));
  const { reels, forcedReel } = rollReels(rng, level, player.toxicMeter >= METER_MAX);
  const badCount = reels.filter((id) => SLOT_SYMBOLS[id].isBad).length;
  const outcome = outcomeOf(badCount);
  const event = findSlotEvent(level, outcome);
  const applied = event.effects.reduce<TApplied>((state, effect) => applyEffect(state, effect, rng), {
    player,
    lines: [],
  });
  const lines: readonly TSlotEffectLine[] =
    applied.lines.length > 0 ? applied.lines : [{ icon: ICONS.check, text: "Обошлось без потерь", tone: "good" }];

  return {
    player: applied.player,
    spin: {
      playerId: player.id,
      turn,
      level,
      reels,
      forcedReel,
      badCount,
      outcome,
      eventId: event.id,
      meterBefore: player.toxicMeter,
      meterAfter: applied.player.toxicMeter,
      lines,
    },
  };
};

/** A bot's spin: silent, same rules. A player below "Малые" is returned as is. */
const withSlotSpin = (player: TPlayer, turn: number, seed: string): TPlayer => {
  return rollSlot(player, turn, seed)?.player ?? player;
};

export type {
  TMeterLevel,
  TMeterZone,
  TSlotEffect,
  TSlotEffectLine,
  TSlotEvent,
  TSlotOutcome,
  TSlotSpin,
  TSlotSymbol,
  TSlotSymbolId,
};
export {
  BAD_CHANCE_BY_LEVEL,
  clampMeter,
  getMeterZone,
  getSlotEvent,
  METER_MAX,
  METER_PER_HEX_TOXICITY_PCT,
  METER_ZONES,
  meterGain,
  meterLevel,
  OUTCOME_LABELS,
  rollSlot,
  SLOT_EVENTS,
  SLOT_SYMBOLS,
  withMeterGain,
  withSlotSpin,
};
