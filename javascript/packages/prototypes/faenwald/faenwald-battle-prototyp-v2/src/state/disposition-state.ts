import { computed, signal } from "@preact/signals-react";
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
    placed.push({
      id: unit.id,
      cellKey,
      kind: unit.kind,
      side: PLAYER_SIDE,
      name: unit.code,
      stats: unit.stats,
    });
  }

  return placed;
});

const placedCount = computed(() => Object.keys(placementByUnitId.value).length);

function isPlaced(unitId: string): boolean {
  return placementByUnitId.value[unitId] !== undefined;
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
  isPlaced,
  pickUnit,
  pickedUnitId,
  placeUnit,
  placedCount,
  placedUnits,
  ready,
  recallUnit,
  roster,
  toggleReady,
  unitIdAt,
};
export type { RosterUnit };
