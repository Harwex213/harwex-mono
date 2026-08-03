import { computed, signal } from "@preact/signals-react";
import { focusCell, hoveredKey, selectedKey } from "./grid-state";
import type { Unit, UnitKind, UnitSide, UnitStats } from "./units-state";

// A unit the local player owns and has to place before the battle starts.
type RosterUnit = {
  id: string;
  // Full name for the roster row. `code` is the short form the marker on the
  // canvas carries.
  title: string;
  code: string;
  kind: UnitKind;
  stats: UnitStats;
};

// Everything on this page belongs to one player, so the side is fixed.
const PLAYER_SIDE: UnitSide = "blue";

const roster: RosterUnit[] = [
  {
    id: "heavy-spear-1",
    title: "Тяж. Копейщик",
    code: "ТКО",
    kind: "spear",
    stats: { health: 80, attack: 12, morale: 70 },
  },
  {
    id: "spear-1",
    title: "Копейщик",
    code: "КОП",
    kind: "spear",
    stats: { health: 50, attack: 14, morale: 70 },
  },
  {
    id: "heavy-spear-2",
    title: "Тяж. Копейщик",
    code: "ТКО",
    kind: "spear",
    stats: { health: 120, attack: 40, morale: 70 },
  },
  {
    id: "sword-1",
    title: "Мечник",
    code: "МЧН",
    kind: "sword",
    stats: { health: 65, attack: 22, morale: 80 },
  },
];

// Cell key per placed unit. Units missing from the map are still in the roster
// panel, waiting for a hex.
const placementByUnitId = signal<Record<string, string>>({});

// The roster unit waiting for a hex click, if any.
const pickedUnitId = signal<string | null>(null);

// The placed unit waiting for a hex click to move to, if any. Never set at the
// same time as `pickedUnitId`: one hex click cannot both place and move.
const movingUnitId = signal<string | null>(null);

const ready = signal(false);

// The shape `UnitLayer` draws, rebuilt from the placement map.
const placedUnits = computed<Unit[]>(() => {
  const placements = placementByUnitId.value;
  const placed: Unit[] = [];

  for (const unit of roster) {
    const cellKey = placements[unit.id];
    if (cellKey === undefined) {
      continue;
    }
    placed.push(markerFor(unit, cellKey));
  }

  return placed;
});

// The unit a hex click would put down — the one being placed or the one being
// moved — drawn on the hex under the pointer. Empty over a taken hex: a click
// there either does nothing or swaps, and the swap has an overlay of its own.
const previewUnit = computed<Unit | null>(() => {
  const unitId = movingUnitId.value ?? pickedUnitId.value;
  const cellKey = hoveredKey.value;
  if (unitId === null || cellKey === null) {
    return null;
  }

  if (unitIdAt(cellKey) !== null) {
    return null;
  }

  const unit = roster.find((entry) => entry.id === unitId);
  if (unit === undefined) {
    return null;
  }

  return markerFor(unit, cellKey);
});

// The hex a move would trade places with: the one under the pointer, holding
// some other unit. Empty over the moving unit's own hex, which a click just
// leaves it on.
const swapCellKey = computed<string | null>(() => {
  const unitId = movingUnitId.value;
  const cellKey = hoveredKey.value;
  if (unitId === null || cellKey === null) {
    return null;
  }

  const occupant = unitIdAt(cellKey);
  if (occupant === null || occupant === unitId) {
    return null;
  }

  return cellKey;
});

// A roster entry says what a unit is; this is the marker that stands for it on a
// hex. The marker carries the short code, not the full title.
function markerFor(unit: RosterUnit, cellKey: string): Unit {
  return {
    id: unit.id,
    cellKey,
    kind: unit.kind,
    side: PLAYER_SIDE,
    name: unit.code,
    stats: unit.stats,
  };
}

const placedCount = computed(() => Object.keys(placementByUnitId.value).length);

// The placed unit standing on the selected hex, if there is one. The roster
// entry, not the `Unit` the canvas draws: the actions panel shows the full title
// and the marker only carries the short code.
const selectedUnit = computed<RosterUnit | null>(() => {
  const key = selectedKey.value;
  if (key === null) {
    return null;
  }

  const unitId = unitIdAt(key);
  if (unitId === null) {
    return null;
  }

  return roster.find((unit) => unit.id === unitId) ?? null;
});

function isPlaced(unitId: string): boolean {
  return placementByUnitId.value[unitId] !== undefined;
}

// The marker shape on a cell, for the read-only info panel. `selectedUnit` above
// answers with the roster entry instead, because the actions panel needs the
// full title.
function placedUnitAt(cellKey: string): Unit | null {
  return placedUnits.value.find((unit) => unit.cellKey === cellKey) ?? null;
}

function placementOf(unitId: string): string | null {
  return placementByUnitId.value[unitId] ?? null;
}

function unitIdAt(cellKey: string): string | null {
  for (const [unitId, key] of Object.entries(placementByUnitId.value)) {
    if (key === cellKey) {
      return unitId;
    }
  }
  return null;
}

// Clicking the roster arms a unit for the next hex click; clicking it again
// disarms it.
function pickUnit(unitId: string): void {
  pickedUnitId.value = pickedUnitId.value === unitId ? null : unitId;
  movingUnitId.value = null;
}

// Arms the selected unit for a move, or calls the move off if it is already
// armed. Nothing to do while the selection holds no unit.
function toggleMove(): void {
  const unit = selectedUnit.value;
  if (unit === null) {
    movingUnitId.value = null;
    return;
  }

  movingUnitId.value = movingUnitId.value === unit.id ? null : unit.id;
  pickedUnitId.value = null;
}

function cancelMove(): void {
  movingUnitId.value = null;
}

// Sends the unit being moved to `cellKey`. Another unit standing there is not
// pushed off the board: the two trade places, so the move never costs a unit its
// spot. Either way the move ends and the selection follows the unit.
function moveUnit(cellKey: string): void {
  const unitId = movingUnitId.value;
  if (unitId === null) {
    return;
  }

  movingUnitId.value = null;

  const from = placementOf(unitId);
  if (from === null || from === cellKey) {
    return;
  }

  const next = { ...placementByUnitId.value, [unitId]: cellKey };
  const occupant = unitIdAt(cellKey);
  if (occupant !== null) {
    next[occupant] = from;
  }

  placementByUnitId.value = next;
  ready.value = false;
  focusCell(cellKey);
}

function placeUnit(cellKey: string): void {
  const unitId = pickedUnitId.value;
  if (unitId === null) {
    return;
  }

  // One unit per hex. Moving a unit means recalling it first.
  if (unitIdAt(cellKey) !== null) {
    return;
  }

  placementByUnitId.value = { ...placementByUnitId.value, [unitId]: cellKey };
  pickedUnitId.value = null;
  ready.value = false;
}

function recallUnit(unitId: string): void {
  const { [unitId]: removed, ...rest } = placementByUnitId.value;
  if (removed === undefined) {
    return;
  }

  placementByUnitId.value = rest;
  ready.value = false;
}

function toggleReady(): void {
  ready.value = !ready.value;
}

export {
  cancelMove,
  isPlaced,
  moveUnit,
  movingUnitId,
  pickUnit,
  pickedUnitId,
  placeUnit,
  placedCount,
  placedUnitAt,
  placedUnits,
  placementOf,
  previewUnit,
  ready,
  recallUnit,
  roster,
  selectedUnit,
  swapCellKey,
  toggleMove,
  toggleReady,
  unitIdAt,
};
export type { RosterUnit };
