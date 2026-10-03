import { HEX_SIZE, hexToPixel } from "../core/hex";
import { ICONS } from "../core/icons";
import { getResource } from "../core/resources";
import {
  collectTaxPlan,
  findRoll,
  pickRefusal,
  planPayouts,
  rollTaxPlan,
  withBotPicks,
  withPick,
  withPowerSpent,
  withToxicityPaid,
  withYield,
} from "../core/tax-plan";
import { withMadness } from "../core/tax";
import { techEffects } from "../core/techs";
import { withSlotSpin } from "../core/toxic-slot";
import { replacePlayer } from "./player-updates";
import { showNotice } from "./ui-actions";
import type { TPayoutResourceId, TTaxPlan } from "../core/tax-plan";
import type { THex, TResourceId } from "../core/types";
import type { TStore } from "../store/store";
import type { TCamera, TFlight, THudAnchorId, TPointerAnchor } from "../store/ui-state";

/**
 * The tax phase. It opens with every die on every island rolled once. The
 * player reads the rolls on the hexes and may spend power to change them. The
 * payouts wait until the player ends the phase: then the yield flies to the
 * resources panel and the toxicity to the meter, along a bezier, each mote
 * paying its part as it lands. After the spec's 350 ms pause the mad eat. The
 * player's toxicity slot spins when the phase ends (see `slot-actions.ts`).
 * The bots roll and pick
 * at the same moment. Each bot is paid, and spins its slot, without an
 * animation when its own phase timer fires, whether or not the player has
 * ended the phase yet.
 */

const FLIGHT_DURATION_MS = 700;
/** Buildings fire one after another, so the HUD ticks up instead of jumping. */
const FLIGHT_STAGGER_MS = 110;
/** A building's toxicity leaves just after its yield, not together with it. */
const TOXICITY_FLIGHT_OFFSET_MS = 70;
/** The spec's pause between the resources landing and the madness step. */
const MAD_PAUSE_MS = 350;
/** The bots have no technologies of their own. */
const BOT_EFFECTS = techEffects([]);

/** The collection is a chain of timers; a new phase cancels the one before it. */
let timers: ReturnType<typeof setTimeout>[] = [];
/** What runs once the collection is over: the hand-over to the next phase. */
let onCollected: (() => void) | null = null;

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

/** The HUD part a mote flies to, or the corner of the screen if unmeasured. */
const anchorFor = (store: TStore, target: THudAnchorId) => {
  return store.ui.hudAnchors.peek()[target] ?? { x: 120, y: window.innerHeight - 90 };
};

const isPayoutResource = (resource: TResourceId | null): resource is TPayoutResourceId => {
  return resource !== null && resource !== "mad";
};

/** Rolls, picks and payouts are allowed only while the dice lie unpaid. */
const isTaxOpen = (store: TStore) => {
  const tax = store.game.tax.peek();

  return (
    store.game.stage.peek() === "play" &&
    store.game.phase.peek() === "tax" &&
    tax !== null &&
    tax.status === "rolled" &&
    !store.ui.busy.peek() &&
    !store.derived.isReadonly.peek() &&
    !store.derived.isHumanReady.peek()
  );
};

const replacePlan = (store: TStore, next: TTaxPlan) => {
  const tax = store.game.tax.peek();
  if (!tax) {
    return;
  }

  store.game.tax.value = {
    ...tax,
    plans: tax.plans.map((plan) => (plan.playerId === next.playerId ? next : plan)),
  };
};

/**
 * Opens the phase: every player's dice are rolled, and every bot makes its
 * picks at once. The rolls are seeded by the world seed and the turn, and a
 * phase already rolled for this turn is kept, so nothing can re-roll it.
 */
const startTaxPhaseAction = (store: TStore) => {
  const turn = store.game.turn.peek();
  const current = store.game.tax.peek();
  if (current && current.turn === turn) {
    return;
  }

  clearTimers();
  onCollected = null;
  store.ui.flights.value = [];
  store.ui.busy.value = false;
  store.ui.taxPickHexId.value = null;

  const seed = store.game.nickname.peek();
  const plans = store.game.players.peek().map((player) => {
    const plan = rollTaxPlan(player, turn, seed);

    return player.isHuman ? plan : withBotPicks(player, plan, BOT_EFFECTS);
  });

  store.game.tax.value = { turn, status: "rolled", plans, paidRivalIds: [] };
};

/** A click on a hex with a die opens the face popup; any other click does not. */
const openTaxPickAction = (store: TStore, hexId: string) => {
  if (!isTaxOpen(store)) {
    return;
  }

  if (!findRoll(store.derived.humanTaxPlan.peek(), hexId)) {
    return;
  }

  store.ui.hoveredHexId.value = null;
  store.ui.hoverAnchor.value = null;
  store.ui.taxPickHexId.value = hexId;
};

const closeTaxPickAction = (store: TStore) => {
  store.ui.taxPickHexId.value = null;
};

/**
 * Makes a face the one the building pays. Nothing is paid and no power leaves
 * the pool here: the plan remembers the choice until the phase ends. A refused
 * pick keeps the popup open and says why.
 */
const pickTaxFaceAction = (store: TStore, hexId: string, faceIndex: number) => {
  if (!isTaxOpen(store)) {
    return;
  }

  const player = store.derived.humanPlayer.peek();
  const plan = store.derived.humanTaxPlan.peek();
  if (!player || !plan) {
    return;
  }

  const refusal = pickRefusal(player, plan, hexId, faceIndex);
  if (refusal) {
    showNotice(store, refusal.message);

    return;
  }

  replacePlan(store, withPick(plan, hexId, faceIndex));
  store.ui.taxPickHexId.value = null;
};

const dropFlight = (store: TStore, id: string) => {
  store.ui.flights.value = store.ui.flights.peek().filter((flight) => flight.id !== id);
};

/**
 * A mote landing is when its effect is paid. A mote that is no longer in the
 * list has already been paid, by its timer or by a skip, so it pays nothing.
 */
const landFlight = (store: TStore, flight: TFlight) => {
  if (!store.ui.flights.peek().some((candidate) => candidate.id === flight.id)) {
    return;
  }

  dropFlight(store, flight.id);

  const player = store.derived.humanPlayer.peek();
  if (!player) {
    return;
  }

  if (flight.kind === "yield" && isPayoutResource(flight.resource)) {
    replacePlayer(store, withYield(player, flight.resource, flight.amount));

    return;
  }

  if (flight.kind === "toxicity" && flight.hexId) {
    replacePlayer(store, withToxicityPaid(player, flight.hexId, flight.amount));
  }
};

/** Ends the collection once: the phase hands over to the next one. */
const finishCollection = (store: TStore) => {
  clearTimers();
  store.ui.flights.value = [];
  store.ui.busy.value = false;

  const tax = store.game.tax.peek();
  if (tax) {
    store.game.tax.value = { ...tax, status: "collected" };
  }

  const done = onCollected;
  onCollected = null;
  done?.();
};

/**
 * The madness step. Mad people do not work and still eat, which is the part
 * the spec leaves to us. Nobody goes mad here: the toxicity slot does that.
 */
const applyMadness = (store: TStore) => {
  const player = store.derived.humanPlayer.peek();
  if (player) {
    replacePlayer(store, withMadness(player, 0, store.derived.techEffects.peek().madCuredPerTurn));
  }

  finishCollection(store);
};

/** One mote per paid yield and one per toxicity left, staggered hex by hex. */
const flightsFor = (store: TStore, plan: TTaxPlan): TFlight[] => {
  const player = store.derived.humanPlayer.peek();
  if (!player) {
    return [];
  }

  const camera = store.ui.camera.peek();
  const payouts = planPayouts(player, plan, store.derived.techEffects.peek());
  const flights: TFlight[] = [];
  const order = new Map<string, number>();

  payouts.forEach((payout, index) => {
    const hex = player.island.hexes.find((candidate) => candidate.id === payout.hexId);
    if (!hex) {
      return;
    }

    // The stronghold's power leaves with its roll, a beat later.
    const seen = order.get(hex.id);
    const slot = seen ?? order.size;
    order.set(hex.id, slot);

    const from = hexScreenPoint(hex, camera);
    const delayMs = slot * FLIGHT_STAGGER_MS + (seen === undefined ? 0 : TOXICITY_FLIGHT_OFFSET_MS * 2);

    if (payout.amount > 0) {
      const to = anchorFor(store, payout.resource);
      flights.push({
        id: `${index}:${hex.id}:${payout.resource}`,
        kind: "yield",
        icon: getResource(payout.resource).icon,
        amount: payout.amount,
        hexId: hex.id,
        resource: payout.resource,
        fromX: from.x,
        fromY: from.y,
        toX: to.x,
        toY: to.y,
        delayMs,
      });
    }

    if (payout.toxicity > 0) {
      const to = anchorFor(store, "meter");
      flights.push({
        id: `${index}:${hex.id}:toxicity`,
        kind: "toxicity",
        icon: ICONS.toxicity,
        amount: payout.toxicity,
        hexId: hex.id,
        resource: null,
        fromX: from.x,
        fromY: from.y,
        toX: to.x,
        toY: to.y,
        delayMs: delayMs + TOXICITY_FLIGHT_OFFSET_MS,
      });
    }
  });

  return flights;
};

/**
 * Ends the player's tax phase: the player's plan is paid. The
 * player's power leaves the pool now, and the rest arrives mote by mote.
 * `onDone` runs once, after the madness step or after a skip. Returns `false`
 * when there is nothing to collect: no open phase, or a collection already
 * running, so a second press cannot pay twice.
 */
const collectTaxAction = (store: TStore, onDone: () => void) => {
  const tax = store.game.tax.peek();
  if (!tax || tax.status !== "rolled" || store.ui.busy.peek()) {
    return false;
  }

  store.game.tax.value = { ...tax, status: "collecting" };
  store.ui.busy.value = true;
  store.ui.taxPickHexId.value = null;
  onCollected = onDone;
  clearTimers();

  // The rivals are not paid here: each one is paid by its own phase timer.
  const player = store.derived.humanPlayer.peek();
  const plan = tax.plans.find((candidate) => candidate.playerId === player?.id);
  if (!player || !plan) {
    finishCollection(store);

    return true;
  }

  replacePlayer(store, withPowerSpent(player, plan));

  const flights = flightsFor(store, plan);
  store.ui.flights.value = flights;

  for (const flight of flights) {
    later(() => landFlight(store, flight), flight.delayMs + FLIGHT_DURATION_MS);
  }

  const lastLanding = flights.reduce((latest, flight) => Math.max(latest, flight.delayMs), 0) + FLIGHT_DURATION_MS;

  later(() => applyMadness(store), lastLanding + MAD_PAUSE_MS);

  return true;
};

/** Skips straight to the end of the collection, for a player who has seen it enough. */
const skipTaxAnimationAction = (store: TStore) => {
  if (!store.ui.busy.peek() || store.game.tax.peek()?.status !== "collecting") {
    return;
  }

  clearTimers();

  for (const flight of store.ui.flights.peek()) {
    landFlight(store, flight);
  }

  applyMadness(store);
};

/**
 * A rival ends its tax phase: its plan is paid and its slot spins silently, by
 * the player's rules, without an animation. A rival already paid this phase
 * is not paid again. The rival timers in `ready-actions.ts` call this.
 */
const collectRivalTaxAction = (store: TStore, playerId: string) => {
  const tax = store.game.tax.peek();
  if (!tax || tax.turn !== store.game.turn.peek() || tax.paidRivalIds.includes(playerId)) {
    return;
  }

  const player = store.game.players.peek().find((candidate) => candidate.id === playerId);
  const plan = tax.plans.find((candidate) => candidate.playerId === playerId);
  if (!player || player.isHuman || !plan) {
    return;
  }

  // The list is written first, so nothing re-entrant can pay the rival twice.
  store.game.tax.value = { ...tax, paidRivalIds: [...tax.paidRivalIds, playerId] };
  replacePlayer(store, withSlotSpin(collectTaxPlan(player, plan, BOT_EFFECTS), tax.turn, store.game.nickname.peek()));
};

/** Leaves the tax phase behind: the next phase opens with no tax state. */
const clearTaxState = (store: TStore) => {
  clearTimers();
  onCollected = null;
  store.game.tax.value = null;
  store.ui.taxPickHexId.value = null;
  store.ui.flights.value = [];
};

const setCameraAction = (store: TStore, camera: TCamera) => {
  store.ui.camera.value = camera;
};

/** Merges what one HUD part measured into the anchors the others measured. */
const setHudAnchorsAction = (store: TStore, anchors: Readonly<Partial<Record<THudAnchorId, TPointerAnchor>>>) => {
  store.ui.hudAnchors.value = { ...store.ui.hudAnchors.peek(), ...anchors };
};

export {
  clearTaxState,
  closeTaxPickAction,
  collectRivalTaxAction,
  collectTaxAction,
  openTaxPickAction,
  pickTaxFaceAction,
  setCameraAction,
  setHudAnchorsAction,
  skipTaxAnimationAction,
  startTaxPhaseAction,
};
