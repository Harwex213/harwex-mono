import { showToastAction } from "./game-actions";
import {
  HEX_SIZE_PX,
  TECHS,
  addToxicity,
  applyInsaneConversion,
  applyUpkeep,
  builtHexIds,
  computeTaxYields,
  createRng,
  hexToPixel,
  islandToxicityPoints,
  manaIncome,
  rollRiot,
  setBuilding,
} from "../core/exports";
import {
  ALARM_PULSE_MS,
  FLIGHT_MS,
  FLIGHT_STAGGER_MS,
  INSANE_DELAY_MS,
  NO_FLIGHTS,
  PULSE_MS,
  RESOURCE_GLYPHS,
} from "../store/anim-state";
import { PHASE_NAMES_RU } from "../store/game-state";
import { HUMAN_PLAYER_ID } from "../store/store";
import { worldToScreen } from "../ui/island-canvas/camera";
import type {
  TIsland,
  TResourceId,
  TResources,
  TTechId,
  TYieldEntry,
} from "../core/exports";
import type { TFlight } from "../store/anim-state";
import type { TLogEntry } from "../store/game-state";
import type { TStore } from "../store/store";
import type { TScreenPoint } from "../store/ui-state";
import type { TViewport } from "../ui/island-canvas/camera";

/**
 * The tax phase: every building spawns its payout, the payouts fly to the HUD,
 * the counters land, and exactly `INSANE_DELAY_MS` later the toxicity turns
 * citizens into insane ones (plan §3.1 and §4.5, spec node
 * `bezier-curve-hud-350-ms`).
 *
 * The animation is driven by the layer's RAF loop through `tickTaxAction`; the
 * whole sequence can also be ended synchronously by `fastForwardTaxAction`.
 */

/** How high above the straight line the bezier control point sits. */
const CONTROL_LIFT_PX = 160;

/** Consecutive flights bend to opposite sides by this much. */
const CONTROL_SIDE_OFFSET_PX = 60;

const HALF = 2;

/** A riot poisons the hex it wrecks by this much. */
const RIOT_TOXICITY_PENALTY = 5;

/** The riot roll is seeded per turn, so two runs of the probe see the same board. */
const RIOT_SEED_FACTOR = 31;

/** Slack on top of the natural duration before the watchdog force-ends the phase. */
const WATCHDOG_SLACK_MS = 1000;

/** Where the flights aim when the HUD has not been rendered yet. */
const FALLBACK_ANCHOR: TScreenPoint = { x: 0, y: 0 };

const CHIP_SELECTOR = ".resource-chip[data-resource]";
const CANVAS_SLOT_SELECTOR = ".island-page__canvas-slot";

const RIOT_TOAST_RU = "Бунт! Сумасшедшие разрушили здание";

/** The yields this phase pays. Re-read by the log summary once everything landed. */
let pendingYields: readonly TYieldEntry[] = [];

/** Guards the pulse timeout: only the newest pulse may clear the class. */
let pulseToken = 0;

/** Ends the phase even when the layer was unmounted mid-flight. */
let watchdogTimerId: number | null = null;

const appendLogEntry = (store: TStore, textRu: string): void => {
  const entry: TLogEntry = {
    turn: store.game.turn.peek(),
    phase: store.game.phase.peek(),
    textRu,
  };

  store.game.log.value = [...store.game.log.peek(), entry];
};

const clearWatchdog = (): void => {
  if (watchdogTimerId === null) {
    return;
  }

  window.clearTimeout(watchdogTimerId);
  watchdogTimerId = null;
};

/** Flashes one chip. A newer pulse always wins, so the class never sticks. */
const pulseChip = (store: TStore, resource: TResourceId, holdMs: number): void => {
  pulseToken += 1;
  const token = pulseToken;
  store.anim.pulse.value = resource;

  window.setTimeout(() => {
    if (token !== pulseToken) {
      return;
    }

    store.anim.pulse.value = null;
  }, holdMs);
};

/** The centre of every HUD chip, in viewport pixels. */
const measureHudAnchors = (): Readonly<Partial<Record<TResourceId, TScreenPoint>>> => {
  const anchors: Partial<Record<TResourceId, TScreenPoint>> = {};
  const chips = document.querySelectorAll(CHIP_SELECTOR);

  chips.forEach((chip) => {
    const resource = chip.getAttribute("data-resource") as TResourceId | null;
    if (resource === null) {
      return;
    }

    const rect = chip.getBoundingClientRect();
    anchors[resource] = { x: rect.left + rect.width / HALF, y: rect.top + rect.height / HALF };
  });

  return anchors;
};

/** The canvas slot's box, which turns canvas-local screen points into viewport ones. */
const readCanvasSlot = (): { readonly origin: TScreenPoint; readonly viewport: TViewport } => {
  const slot = document.querySelector(CANVAS_SLOT_SELECTOR);
  if (slot === null) {
    return {
      origin: FALLBACK_ANCHOR,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  }

  const rect = slot.getBoundingClientRect();

  return {
    origin: { x: rect.left, y: rect.top },
    viewport: { width: rect.width, height: rect.height },
  };
};

const controlPointFor = (from: TScreenPoint, to: TScreenPoint, index: number): TScreenPoint => {
  const side = index % HALF === 0 ? CONTROL_SIDE_OFFSET_PX : -CONTROL_SIDE_OFFSET_PX;

  return {
    x: (from.x + to.x) / HALF + side,
    y: (from.y + to.y) / HALF - CONTROL_LIFT_PX,
  };
};

/** One glyph per payout, plus one per poisoned hex, all leaving on a stagger. */
const buildFlights = (
  store: TStore,
  island: TIsland,
  yields: readonly TYieldEntry[],
  anchors: Readonly<Partial<Record<TResourceId, TScreenPoint>>>,
  nowMs: number,
): readonly TFlight[] => {
  const slot = readCanvasSlot();
  const camera = store.ui.camera.peek();
  const flights: TFlight[] = [];

  for (const entry of yields) {
    const hex = island.hexes[entry.hexId];
    if (hex === undefined) {
      continue;
    }

    const world = hexToPixel(hex.q, hex.r, HEX_SIZE_PX);
    const local = worldToScreen(world, camera, slot.viewport);
    const from: TScreenPoint = { x: local.x + slot.origin.x, y: local.y + slot.origin.y };

    const payouts: readonly { readonly resource: TResourceId; readonly amount: number }[] =
      entry.toxicity > 0
        ? [
          { resource: entry.resource, amount: entry.amount },
          { resource: "toxicity", amount: entry.toxicity },
        ]
        : [{ resource: entry.resource, amount: entry.amount }];

    for (const payout of payouts) {
      const index = flights.length;
      const to = anchors[payout.resource] ?? FALLBACK_ANCHOR;

      flights.push({
        id: `${entry.hexId}:${payout.resource}:${index}`,
        hexId: entry.hexId,
        resource: payout.resource,
        amount: payout.amount,
        from,
        control: controlPointFor(from, to, index),
        to,
        startMs: nowMs + index * FLIGHT_STAGGER_MS,
        landed: false,
      });
    }
  }

  return flights;
};

/**
 * One landing: the counter takes the glyph's amount and the chip flashes. A
 * poison glyph also stays on the hex that spawned it, which is what makes the
 * `50-100` spec node and the insane conversion live from one turn to the next.
 */
const landFlight = (store: TStore, flight: TFlight): void => {
  const resources = store.game.resources.peek();

  store.game.resources.value = {
    ...resources,
    [flight.resource]: resources[flight.resource] + flight.amount,
  };

  if (flight.resource === "toxicity" && flight.amount > 0) {
    const islands = store.game.islands.peek();
    const island = islands[HUMAN_PLAYER_ID];
    if (island !== undefined) {
      store.game.islands.value = {
        ...islands,
        [HUMAN_PLAYER_ID]: addToxicity(island, flight.hexId, flight.amount),
      };
    }
  }

  pulseChip(store, flight.resource, PULSE_MS);
};

/** Lands every glyph still in the air and moves the phase into its pause. */
const landEveryFlight = (store: TStore, nowMs: number): void => {
  const flights = store.anim.flights.peek();
  const next: TFlight[] = [];
  let changed = false;

  for (const flight of flights) {
    if (flight.landed === true) {
      next.push(flight);

      continue;
    }

    landFlight(store, flight);
    next.push({ ...flight, landed: true });
    changed = true;
  }

  if (changed === true) {
    store.anim.flights.value = next;
  }

  store.anim.lastLandingMs.value = nowMs;
  store.anim.taxStage.value = "pause";
};

/** What the payouts added up to, for the one-line log summary. */
const summariseYields = (yields: readonly TYieldEntry[]): string => {
  const totals = new Map<TResourceId, number>();

  for (const entry of yields) {
    totals.set(entry.resource, (totals.get(entry.resource) ?? 0) + entry.amount);
    if (entry.toxicity > 0) {
      totals.set("toxicity", (totals.get("toxicity") ?? 0) + entry.toxicity);
    }
  }

  const parts: string[] = [];
  totals.forEach((amount, resource) => {
    parts.push(`+${amount} ${RESOURCE_GLYPHS[resource]}`);
  });

  if (parts.length === 0) {
    return "Налоги: пусто";
  }

  return `Налоги: ${parts.join(", ")}`;
};

/** The 📖 the island earned this phase, which pays for mana and for research. */
const scienceGainedThisPhase = (yields: readonly TYieldEntry[]): number => {
  let total = 0;
  for (const entry of yields) {
    if (entry.resource === "science") {
      total += entry.amount;
    }
  }

  return total;
};

/** Adds the turn's 📖 to the tech in research and completes it when it is paid for. */
const advanceResearch = (store: TStore, science: number): void => {
  const researching = store.game.researching.peek();
  if (researching === null || science <= 0) {
    return;
  }

  const progress = store.game.researchProgress.peek();
  const gained = (progress[researching] ?? 0) + science;
  store.game.researchProgress.value = { ...progress, [researching]: gained };

  if (gained < TECHS[researching].cost) {
    return;
  }

  const researched: readonly TTechId[] = [...store.game.researched.peek(), researching];
  store.game.researched.value = researched;
  store.game.researching.value = null;
  appendLogEntry(store, `Изучено: ${TECHS[researching].nameRu}`);
};

/** The riot of plan §3.1 point 4: one building wrecked, one marauder queued. */
const rollRiotThisPhase = (store: TStore, resources: TResources): void => {
  const seed = store.game.seed.peek() + store.game.turn.peek() * RIOT_SEED_FACTOR;
  const rng = createRng(seed);
  if (rollRiot(rng, resources) === false) {
    return;
  }

  const islands = store.game.islands.peek();
  const island = islands[HUMAN_PLAYER_ID];
  if (island === undefined) {
    return;
  }

  const built = builtHexIds(island);
  if (built.length === 0) {
    return;
  }

  const targetId = rng.pick(built);
  const wrecked = addToxicity(setBuilding(island, targetId, null), targetId, RIOT_TOXICITY_PENALTY);

  store.game.islands.value = { ...islands, [HUMAN_PLAYER_ID]: wrecked };
  store.game.pendingEnemies.value = store.game.pendingEnemies.peek() + 1;
  appendLogEntry(store, `${RIOT_TOAST_RU} на гексе ${targetId}`);
  showToastAction(store, RIOT_TOAST_RU);
};

/** Keeps the human row of the player list in step with the island. */
const refreshHumanCounters = (store: TStore): void => {
  const islands = store.game.islands.peek();
  const island = islands[HUMAN_PLAYER_ID];
  if (island === undefined) {
    return;
  }

  const buildingCount = builtHexIds(island).length;
  const techCount = store.game.researched.peek().length;

  store.game.players.value = store.game.players.peek().map((player) => {
    if (player.id !== HUMAN_PLAYER_ID) {
      return player;
    }

    return { ...player, buildingCount, techCount };
  });
};

/**
 * Everything that happens once the pause is over: mana, the insane conversion,
 * upkeep, research and the riot roll, in exactly that order.
 */
const finishTaxAction = (store: TStore, nowMs: number): void => {
  const stage = store.anim.taxStage.peek();
  if (stage !== "flying" && stage !== "pause") {
    return;
  }

  store.anim.taxStage.value = "insane";
  clearWatchdog();

  const islands = store.game.islands.peek();
  const island = islands[HUMAN_PLAYER_ID] ?? null;
  const science = scienceGainedThisPhase(pendingYields);
  const toxicityPoints = island === null ? 0 : islandToxicityPoints(island);

  const earned = store.game.resources.peek();
  const withMana: TResources = { ...earned, mana: earned.mana + manaIncome(science) };
  const converted = applyInsaneConversion(withMana, toxicityPoints);

  store.game.resources.value = converted;
  store.anim.insaneAtMs.value = nowMs;

  const fed = applyUpkeep(converted);
  store.game.resources.value = fed;

  advanceResearch(store, science);
  rollRiotThisPhase(store, fed);
  refreshHumanCounters(store);

  appendLogEntry(store, summariseYields(pendingYields));
  pendingYields = [];

  store.anim.taxStage.value = "done";
  store.game.busy.value = false;
  pulseChip(store, "insane", ALARM_PULSE_MS);
};

/**
 * The build → tax transition. Measures the HUD, spawns one glyph per payout and
 * hands the sequence over to the layer's RAF loop.
 */
const startTaxPhaseAction = (store: TStore): void => {
  const turn = store.game.turn.peek();

  store.game.phase.value = "tax";
  store.game.busy.value = true;
  store.anim.taxStage.value = "flying";
  store.anim.pulse.value = null;
  store.anim.insaneAtMs.value = null;
  store.anim.lastLandingMs.value = null;
  appendLogEntry(store, `Ход ${turn}: ${PHASE_NAMES_RU.tax}`);

  const island = store.game.islands.peek()[HUMAN_PLAYER_ID] ?? null;
  const yields = island === null
    ? []
    : computeTaxYields(island, store.game.researched.peek(), store.game.resources.peek().insane);
  pendingYields = yields;

  const anchors = measureHudAnchors();
  store.anim.hudAnchors.value = anchors;

  const nowMs = performance.now();
  const flights = island === null ? NO_FLIGHTS : buildFlights(store, island, yields, anchors, nowMs);
  store.anim.flights.value = flights;

  if (flights.length === 0) {
    store.anim.lastLandingMs.value = nowMs;
    store.anim.taxStage.value = "pause";
  }

  // The RAF loop dies with the layer, so a timer guarantees `busy` is released.
  clearWatchdog();
  const naturalMs = flights.length * FLIGHT_STAGGER_MS + FLIGHT_MS + INSANE_DELAY_MS;
  watchdogTimerId = window.setTimeout(() => {
    watchdogTimerId = null;
    fastForwardTaxAction(store);
  }, naturalMs + WATCHDOG_SLACK_MS);
};

/** One animation frame: land what is due, then run the pause down. */
const tickTaxAction = (store: TStore, nowMs: number): void => {
  const stage = store.anim.taxStage.peek();

  if (stage === "flying") {
    const flights = store.anim.flights.peek();
    const next: TFlight[] = [];
    let changed = false;
    let allLanded = true;

    for (const flight of flights) {
      if (flight.landed === true) {
        next.push(flight);

        continue;
      }

      if (nowMs < flight.startMs + FLIGHT_MS) {
        next.push(flight);
        allLanded = false;

        continue;
      }

      landFlight(store, flight);
      next.push({ ...flight, landed: true });
      changed = true;
    }

    if (changed === true) {
      store.anim.flights.value = next;
    }

    if (allLanded === true) {
      store.anim.lastLandingMs.value = nowMs;
      store.anim.taxStage.value = "pause";
    }

    return;
  }

  if (stage !== "pause") {
    return;
  }

  const landedAtMs = store.anim.lastLandingMs.peek();
  if (landedAtMs !== null && nowMs - landedAtMs < INSANE_DELAY_MS) {
    return;
  }

  finishTaxAction(store, nowMs);
};

/** A click while the glyphs fly lands them all at once. The pause still runs. */
const skipFlightsAction = (store: TStore): void => {
  if (store.anim.taxStage.peek() !== "flying") {
    return;
  }

  landEveryFlight(store, performance.now());
};

/** Ends the whole sequence synchronously. Safe to call in any stage. */
const fastForwardTaxAction = (store: TStore): void => {
  const stage = store.anim.taxStage.peek();
  if (stage === "idle" || stage === "done" || stage === "insane") {
    return;
  }

  if (stage === "flying") {
    landEveryFlight(store, performance.now());
  }

  const landedAtMs = store.anim.lastLandingMs.peek() ?? performance.now();
  finishTaxAction(store, landedAtMs + INSANE_DELAY_MS);
};

export {
  fastForwardTaxAction,
  finishTaxAction,
  skipFlightsAction,
  startTaxPhaseAction,
  tickTaxAction,
};
