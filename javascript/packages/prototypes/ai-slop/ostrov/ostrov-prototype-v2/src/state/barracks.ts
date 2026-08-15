import { config } from "@hw/ostrov-prototype-v2-config";
import { computed, signal } from "@preact/signals-react";
import { BARRACKS_ID } from "../buildings/catalog";
import { walkTo } from "../economy/paths";
import type { Axial } from "../hex/coords";
import { hexKey } from "../hex/coords";
import { REPEAT_RETRY_SEC } from "../tuning";
import type { UnitId } from "../units/catalog";
import { allUnitIds, trainingSeconds, unitArmyCost, unitPrice } from "../units/catalog";
import { armyLimit } from "./army";
import type { PlacedBuilding } from "./buildings";
import { buildings } from "./buildings";
import { tileExplored } from "./fog";
import { payPrice, priceShortfall, resourceLabel } from "./resources";
import { selected, world } from "./signals";
import { armyUsed, rallyUnits, spawnUnit } from "./units";

/**
 * What every barracks on the island is doing: what it is training, what it is
 * told to keep training, and where it sends what comes out.
 *
 * The records live in a plain map rather than in a signal holding an immutable
 * copy, because the front of a queue is touched on the frame it starts and on
 * the frame it finishes and never in between. `barracksVersion` is bumped
 * whenever something a panel would want to redraw has changed, which is the same
 * arrangement `territoryVersion` uses for the map. The training bar itself is a
 * CSS animation started from `startedAt`, so a queue in progress costs React
 * nothing at all per frame.
 *
 * The barracks raises no army limit. It only trains, and it is refused — loudly,
 * with the reason — when the island has no room or the treasury is short.
 */

type QueueEntry = {
  /** Ascending, never reused. The React key of the row and of the progress bar. */
  id: number;
  unitId: UnitId;
  /** `performance.now()` of the moment it reached the front, or null while it waits. */
  startedAt: number | null;
};

type Barracks = {
  key: string;
  hex: Axial;
  queue: QueueEntry[];
  /** Unit kinds this barracks keeps ordering by itself. */
  repeat: Set<UnitId>;
  /** Where what comes out walks to. Defaults to the barracks' own hex. */
  rally: Axial;
  /** Why repeat training is waiting, or empty while it is not. */
  paused: string;
  /** `performance.now()` before which repeat training does not try again. */
  nextRepeatAt: number;
  /** Rotates through `repeat`, so two kinds on repeat take turns. */
  cursor: number;
};

/** Why an order was refused. Empty means it was not. */
type Refusal = string;

const records = new Map<string, Barracks>();

/** Bumped whenever a queue, a repeat flag or a rally point changed. */
const barracksVersion = signal(0);

/** A refused rally point, kept only long enough for the map to say why. */
type RallyNotice = {
  q: number;
  r: number;
  text: string;
  /** `performance.now()` of the refusal. */
  at: number;
};

const rallyNotice = signal<RallyNotice | null>(null);

let nextEntryId = 1;

function bump(): void {
  barracksVersion.value = barracksVersion.peek() + 1;
}

/** The barracks the player is looking at, or null when they are looking elsewhere. */
const selectedBarracks = computed<PlacedBuilding | null>(() => {
  const hex = selected.value;
  if (!hex) {
    return null;
  }
  const building = buildings.value.get(hexKey(hex.q, hex.r));
  if (!building || building.id !== BARRACKS_ID || building.state !== "built") {
    return null;
  }
  return building;
});

/** Adds a record for every finished barracks, and drops the rest. */
function syncRecords(): void {
  const live = new Set<string>();
  for (const building of buildings.peek().values()) {
    if (building.id !== BARRACKS_ID || building.state !== "built") {
      continue;
    }
    const key = hexKey(building.q, building.r);
    live.add(key);
    if (records.has(key)) {
      continue;
    }
    const hex: Axial = { q: building.q, r: building.r };
    records.set(key, {
      key,
      hex,
      queue: [],
      repeat: new Set<UnitId>(),
      rally: hex,
      paused: "",
      nextRepeatAt: 0,
      cursor: 0,
    });
  }
  for (const key of [...records.keys()]) {
    if (!live.has(key)) {
      records.delete(key);
    }
  }
}

/** The record of one barracks, or null when there is no barracks on that hex. */
function barracksAt(key: string): Barracks | null {
  syncRecords();
  return records.get(key) ?? null;
}

/** Places already spoken for: the units alive plus everything in every queue. */
function armyPlanned(): number {
  let planned = armyUsed.peek();
  for (const record of records.values()) {
    for (const entry of record.queue) {
      planned += unitArmyCost(entry.unitId);
    }
  }
  return planned;
}

/**
 * Why this order would be refused, or an empty string when it would go through.
 *
 * The order of the tests is the order the player can act on: a full queue is
 * over in a few seconds, the army limit needs a hut, and a short treasury needs
 * a producer. The panel shows whichever of the three is in the way.
 */
function trainRefusal(record: Barracks, unitId: UnitId): Refusal {
  if (record.queue.length >= config.army.queueLimit) {
    return "Очередь полна";
  }
  if (armyPlanned() + unitArmyCost(unitId) > armyLimit.peek()) {
    return "Предел армии";
  }
  const missing = priceShortfall(unitPrice(unitId));
  if (missing) {
    return `Не хватает: ${resourceLabel(missing)}`;
  }
  return "";
}

/**
 * Puts one unit in the queue and takes its price out of the pile, or refuses and
 * changes nothing. The price is taken here rather than when the unit walks out,
 * exactly as a building is paid for when its site is laid: a queue of unpaid
 * orders would make both the panel and the treasury a lie.
 */
function enqueueTraining(key: string, unitId: UnitId, now: number): Refusal {
  const record = barracksAt(key);
  if (!record) {
    return "Нет казармы";
  }
  const refusal = trainRefusal(record, unitId);
  if (refusal) {
    return refusal;
  }
  if (!payPrice(unitPrice(unitId))) {
    return "Не хватает ресурсов";
  }
  record.queue.push({ id: nextEntryId, unitId, startedAt: record.queue.length === 0 ? now : null });
  nextEntryId += 1;
  bump();
  return "";
}

/** Cancels the order at `index` of the queue. The price is refunded to nobody: prototype. */
function cancelTraining(key: string, entryId: number): void {
  const record = barracksAt(key);
  if (!record) {
    return;
  }
  const index = record.queue.findIndex((entry) => entry.id === entryId);
  if (index < 0) {
    return;
  }
  record.queue.splice(index, 1);
  bump();
}

/** Turns continuous training of one unit kind on, or off when it is already on. */
function toggleRepeat(key: string, unitId: UnitId): void {
  const record = barracksAt(key);
  if (!record) {
    return;
  }
  if (record.repeat.has(unitId)) {
    record.repeat.delete(unitId);
    if (record.repeat.size === 0) {
      record.paused = "";
    }
  } else {
    record.repeat.add(unitId);
    // A toggle is an instruction, so it is acted on at once rather than at the
    // end of whatever wait the last refusal started.
    record.nextRepeatAt = 0;
  }
  bump();
}

function repeatsOn(key: string, unitId: UnitId): boolean {
  return records.get(key)?.repeat.has(unitId) === true;
}

/**
 * One order per frame at most, and only once the wait after a refusal has run
 * out. That wait is the whole of "does not busy-spin": a blocked repeat asks the
 * treasury twice a second instead of sixty times, and the first ask after the
 * block clears starts the order.
 */
function runRepeat(record: Barracks, now: number): void {
  if (record.repeat.size === 0 || now < record.nextRepeatAt) {
    return;
  }
  if (record.queue.length >= config.army.queueLimit) {
    // Not a block: the barracks is simply working at capacity.
    return;
  }
  const wanted = allUnitIds().filter((id) => record.repeat.has(id));
  if (wanted.length === 0) {
    return;
  }
  const unitId = wanted[record.cursor % wanted.length]!;
  const refusal = enqueueTraining(record.key, unitId, now);
  if (refusal) {
    // Paused, never switched off: the toggle stays lit and the reason is shown.
    record.paused = refusal;
    record.nextRepeatAt = now + REPEAT_RETRY_SEC * 1000;
    bump();
    return;
  }
  record.cursor += 1;
  if (record.paused) {
    record.paused = "";
    bump();
  }
}

/**
 * One step of every barracks: the front of the queue starts, finishes and walks
 * out, and any repeat toggle puts the next order in. Called once from the map's
 * render loop; nothing here starts a loop of its own.
 */
function advanceBarracks(now: number): void {
  syncRecords();
  for (const record of records.values()) {
    const front = record.queue[0];
    if (front) {
      if (front.startedAt === null) {
        front.startedAt = now;
        bump();
      } else if (now - front.startedAt >= trainingSeconds(front.unitId) * 1000) {
        // A unit that cannot be put on the map — an island cut in half under it —
        // holds the queue rather than vanishing with the money.
        if (spawnUnit(front.unitId, record.hex, record.rally, now)) {
          record.queue.shift();
          const next = record.queue[0];
          if (next) {
            next.startedAt = now;
          }
          bump();
        }
      }
    }
    runRepeat(record, now);
  }
}

/** True while any barracks has something in its queue. */
function trainingActive(): boolean {
  for (const record of records.values()) {
    if (record.queue.length > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Sends everything this barracks produces to `hex`.
 *
 * Two ways to be refused, and both say so on the map: ground the player has
 * never seen, and ground no chain of land hexes reaches. The second is the one
 * that matters — the rally point of a barracks on one island cannot be a hex on
 * another, because a soldier walks and there is nothing but sky in between.
 */
function setRally(key: string, hex: Axial, now: number): Refusal {
  const record = barracksAt(key);
  if (!record) {
    return "Нет казармы";
  }
  const map = world.peek();
  const tile = map.byKey.get(hexKey(hex.q, hex.r));
  if (!tile) {
    rallyNotice.value = { q: hex.q, r: hex.r, text: "Здесь не земля", at: now };
    return "Здесь не земля";
  }
  if (!tileExplored(tile)) {
    rallyNotice.value = { q: hex.q, r: hex.r, text: "Скрыто туманом", at: now };
    return "Скрыто туманом";
  }
  if (!walkTo(map, hex, record.hex)) {
    rallyNotice.value = { q: hex.q, r: hex.r, text: "Не дойти по земле", at: now };
    return "Не дойти по земле";
  }
  record.rally = { q: hex.q, r: hex.r };
  rallyNotice.value = null;
  rallyUnits(key, record.rally);
  bump();
  return "";
}

/** Where this barracks currently sends its soldiers. Its own hex until it is moved. */
function rallyOf(key: string): Axial | null {
  return records.get(key)?.rally ?? null;
}

/** Live view of one barracks for the panel. Read it during the render; never keep it. */
function barracksView(key: string): Barracks | null {
  return barracksAt(key);
}

export type { Barracks, QueueEntry, Refusal };
export {
  advanceBarracks,
  armyPlanned,
  barracksVersion,
  barracksView,
  cancelTraining,
  enqueueTraining,
  rallyNotice,
  rallyOf,
  repeatsOn,
  selectedBarracks,
  setRally,
  toggleRepeat,
  trainRefusal,
  trainingActive,
};
