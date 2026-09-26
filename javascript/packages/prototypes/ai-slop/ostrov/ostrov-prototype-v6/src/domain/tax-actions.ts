import { facesOn, getBuilding } from "../core/buildings";
import { HEX_SIZE, hexToPixel } from "../core/hex";
import { effectiveYield, madConversion, toxicityGain } from "../core/tax";
import { getResource } from "../core/resources";
import { createRng, hashSeed, pick } from "../core/rng";
import { replacePlayer, updateHex } from "./player-updates";
import type { TStore } from "../store/store";
import type { TCamera, TFlight } from "../store/ui-state";
import type { THex, TResourceId } from "../core/types";

/**
 * The tax phase runs itself: the player watches. Each building throws its die,
 * the yield and the toxicity fly to the HUD along a bezier, and after the
 * spec's 350 ms pause the toxicity drives part of the population mad.
 */

const FLIGHT_DURATION_MS = 700;
/** Buildings fire one after another, so the HUD ticks up instead of jumping. */
const FLIGHT_STAGGER_MS = 110;
/** A building's toxicity leaves just after its yield, not together with it. */
const TOXICITY_FLIGHT_OFFSET_MS = 70;
/** The spec's pause between the resources landing and the madness. */
const MAD_PAUSE_MS = 350;

/** The whole run is a chain of timers; a new run cancels the one before it. */
let timers: ReturnType<typeof setTimeout>[] = [];

const clearTimers = () => {
  for (const timer of timers) {
    clearTimeout(timer);
  }

  timers = [];
};

const later = (callback: () => void, delayMs: number) => {
  timers.push(setTimeout(callback, delayMs));
};

/** Where a hex sits on screen, given the island layer's current transform. */
const hexScreenPoint = (hex: THex, camera: TCamera) => {
  const center = hexToPixel(hex.q, hex.r, HEX_SIZE);

  return {
    x: camera.x + center.x * camera.scale,
    y: camera.y + center.y * camera.scale,
  };
};

/** The HUD icon a mote flies to, or the corner of the screen if unmeasured. */
const anchorFor = (store: TStore, resource: TResourceId) => {
  return store.ui.hudAnchors.peek()[resource] ?? { x: 120, y: window.innerHeight - 90 };
};

const dropFlight = (store: TStore, id: string) => {
  store.ui.flights.value = store.ui.flights.peek().filter((flight) => flight.id !== id);
};

/** A mote landing is when its effect is applied, not when it took off. */
const landFlight = (store: TStore, flight: TFlight) => {
  dropFlight(store, flight.id);

  const player = store.derived.humanPlayer.peek();
  if (!player) {
    return;
  }

  if (flight.kind === "yield" && flight.resource) {
    const resource = flight.resource;

    replacePlayer(store, {
      ...player,
      resources: { ...player.resources, [resource]: player.resources[resource] + flight.amount },
    });

    return;
  }

  if (flight.kind === "toxicity" && flight.hexId) {
    updateHex(store, player, flight.hexId, (hex) => ({
      ...hex,
      toxicity: Math.min(100, hex.toxicity + flight.amount),
    }));
  }
};

/**
 * The madness step. Mad people do not work and still eat, which is the part
 * the spec leaves to us.
 */
const applyMadness = (store: TStore, converted: number) => {
  const player = store.derived.humanPlayer.peek();
  if (!player) {
    return;
  }

  // Asylums send part of the mad back to work before the rest eat this turn.
  const cured = Math.min(player.resources.mad, store.derived.techEffects.peek().madCuredPerTurn);
  const mad = player.resources.mad + converted - cured;

  replacePlayer(store, {
    ...player,
    resources: {
      ...player.resources,
      population: player.resources.population - converted + cured,
      mad,
      food: Math.max(0, player.resources.food - mad),
    },
  });

  store.ui.busy.value = false;
};

const runMadnessStep = (store: TStore) => {
  const player = store.derived.humanPlayer.peek();
  if (!player) {
    store.ui.busy.value = false;

    return;
  }

  const converted = madConversion(player);
  if (converted === 0) {
    applyMadness(store, 0);

    return;
  }

  const from = anchorFor(store, "population");
  const to = anchorFor(store, "mad");

  store.ui.flights.value = [
    ...store.ui.flights.peek(),
    {
      id: "mad",
      kind: "mad",
      emoji: getResource("mad").emoji,
      amount: converted,
      hexId: null,
      resource: null,
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y,
      delayMs: 0,
    },
  ];

  later(() => {
    dropFlight(store, "mad");
    applyMadness(store, converted);
  }, FLIGHT_DURATION_MS);
};

/**
 * Rolls every building and sends the motes on their way. The rolls are seeded
 * by nickname and turn, so the same turn always pays out the same.
 */
const startTaxPhaseAction = (store: TStore) => {
  const player = store.derived.humanPlayer.peek();
  if (!player) {
    return;
  }

  clearTimers();
  store.ui.busy.value = true;

  const rng = createRng(hashSeed(`${store.game.nickname.peek()}:tax:${store.game.turn.peek()}`));
  const effects = store.derived.techEffects.peek();
  const camera = store.ui.camera.peek();
  const flights: TFlight[] = [];
  let index = 0;

  for (const hex of player.island.hexes) {
    if (!hex.building) {
      continue;
    }

    const face = pick(rng, facesOn(getBuilding(hex.building), hex.biome));
    const raw = effectiveYield(face, hex);
    // Irrigation adds to a roll that pays food, but never revives a dead hex.
    const gained = raw > 0 && face.resource === "food" ? raw + effects.foodBonus : raw;
    const dirt = Math.round(toxicityGain(face, hex) * effects.toxicityMultiplier);
    const from = hexScreenPoint(hex, camera);
    const delayMs = index * FLIGHT_STAGGER_MS;
    index += 1;

    if (gained > 0) {
      const to = anchorFor(store, face.resource);
      flights.push({
        id: `${hex.id}:yield`,
        kind: "yield",
        emoji: getResource(face.resource).emoji,
        amount: gained,
        hexId: hex.id,
        resource: face.resource,
        fromX: from.x,
        fromY: from.y,
        toX: to.x,
        toY: to.y,
        delayMs,
      });
    }

    if (dirt > 0) {
      const to = anchorFor(store, "toxicity");
      flights.push({
        id: `${hex.id}:toxicity`,
        kind: "toxicity",
        emoji: getResource("toxicity").emoji,
        amount: dirt,
        hexId: hex.id,
        resource: null,
        fromX: from.x,
        fromY: from.y,
        toX: to.x,
        toY: to.y,
        delayMs: delayMs + TOXICITY_FLIGHT_OFFSET_MS,
      });
    }
  }

  store.ui.flights.value = flights;

  for (const flight of flights) {
    later(() => landFlight(store, flight), flight.delayMs + FLIGHT_DURATION_MS);
  }

  const lastLanding = flights.reduce((latest, flight) => Math.max(latest, flight.delayMs), 0) + FLIGHT_DURATION_MS;

  later(() => runMadnessStep(store), lastLanding + MAD_PAUSE_MS);
};

/** Skips straight to the end of the run, for a player who has seen it enough. */
const skipTaxAnimationAction = (store: TStore) => {
  if (!store.ui.busy.peek()) {
    return;
  }

  const pending = store.ui.flights.peek();
  clearTimers();
  store.ui.flights.value = [];

  for (const flight of pending) {
    if (flight.kind !== "mad") {
      landFlight(store, flight);
    }
  }

  const player = store.derived.humanPlayer.peek();
  applyMadness(store, player ? madConversion(player) : 0);
};

const setCameraAction = (store: TStore, camera: TCamera) => {
  store.ui.camera.value = camera;
};

const setHudAnchorsAction = (
  store: TStore,
  anchors: Readonly<Partial<Record<TResourceId, { x: number; y: number }>>>,
) => {
  store.ui.hudAnchors.value = anchors;
};

export { setCameraAction, setHudAnchorsAction, skipTaxAnimationAction, startTaxPhaseAction };
