import { effect, signal } from "@preact/signals-react";
import type { BuildingId } from "../buildings/catalog";
import { allBuildingIds, prerequisiteOf } from "../buildings/catalog";
import { builtIds } from "./buildings";

/**
 * Which build tiles are asking to be looked at.
 *
 * A building whose prerequisite is unmet is absent from the panel, so the moment
 * the prerequisite finishes a tile the player has never seen appears in a grid
 * they already know. The golden pulse is what says which one is new.
 *
 * Two rules shape the state. It is per building: hovering the sawmill says
 * nothing about the mine standing next to it. And it lives here, at module
 * scope, rather than inside the panel, so closing the panel and opening it again
 * does not hand the player the same news twice.
 *
 * The opening panel is calm because everything available from the first minute
 * is seeded as already noticed. The pulse therefore only ever marks a transition
 * the player lived through, never the roster they started with.
 */

/** Buildings that will never pulse again: seen at start, or hovered since. */
const noticed = new Set<BuildingId>(allBuildingIds().filter((id) => prerequisiteOf(id) === null));

/** Buildings whose tile is pulsing right now. */
const attracting = signal<ReadonlySet<BuildingId>>(new Set<BuildingId>());

/**
 * Watches the roster for a prerequisite being met.
 *
 * A signal effect, not a frame loop: `builtIds` only changes when a site
 * finishes, so this runs a handful of times in a whole session. It reads the
 * pulsing set through `peek`, so writing that set cannot wake it again.
 */
effect(() => {
  const built = builtIds.value;
  const current = attracting.peek();
  let next: Set<BuildingId> | null = null;
  for (const id of allBuildingIds()) {
    if (noticed.has(id) || current.has(id)) {
      continue;
    }
    const prerequisite = prerequisiteOf(id);
    if (prerequisite !== null && !built.has(prerequisite)) {
      continue;
    }
    next = next ?? new Set(current);
    next.add(id);
  }
  if (next) {
    attracting.value = next;
  }
});

/** True while this tile should be pulsing. */
function attractsAttention(id: BuildingId): boolean {
  return attracting.value.has(id);
}

/** The player has looked at this tile. It never pulses again, this session. */
function noticeBuilding(id: BuildingId): void {
  if (noticed.has(id)) {
    return;
  }
  noticed.add(id);
  const current = attracting.peek();
  if (!current.has(id)) {
    return;
  }
  const next = new Set(current);
  next.delete(id);
  attracting.value = next;
}

export { attractsAttention, noticeBuilding };
