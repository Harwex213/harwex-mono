import { computed, signal } from "@preact/signals-react";
import { cellOf, clearSelection, focusCell, grid, hoveredKey, selectedKey } from "./grid-state";
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

// The player deploys inside a band along their own edge of the board: the rows
// this many from the top. A hex outside the band takes no unit, whether the unit
// is being placed from the roster or moved from another hex.
const DEPLOY_ROWS = 3;

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

// Clockwise degrees each unit is turned by. A unit missing from the map faces
// straight up, which is how it lands on the board.
const facingByUnitId = signal<Record<string, number>>({});

// The placed unit showing its rotation handles, if any.
const rotatingUnitId = signal<string | null>(null);

// The facing under the pointer while the handles are out. The unit is drawn
// turned this way before the click commits it, so the handle previews the result.
const hoveredFacing = signal<number | null>(null);

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

  if (unitIdAt(cellKey) !== null || !isDeployCell(cellKey)) {
    return null;
  }

  const unit = roster.find((entry) => entry.id === unitId);
  if (unit === undefined) {
    return null;
  }

  return markerFor(unit, cellKey);
});

// The hexes a click could put the armed unit on: the free ones inside the
// deployment band. Empty while nothing is armed, which is what stops the
// highlight from standing on the board all the time.
//
// A hex the band already has a unit on is left out, even for a move, which may
// swap the two units standing on it and its own hex. The swap has an overlay of
// its own, and a highlight under a marker would read as an empty hex.
const placeableCellKeys = computed<string[]>(() => {
  if (movingUnitId.value === null && pickedUnitId.value === null) {
    return [];
  }

  const taken = new Set(Object.values(placementByUnitId.value));
  const keys: string[] = [];
  for (const cell of grid.cells) {
    if (cell.row >= DEPLOY_ROWS || taken.has(cell.key)) {
      continue;
    }
    keys.push(cell.key);
  }

  return keys;
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

// Where the rotation handles go: the hex of the unit being turned. Empty unless
// a unit has its handles out.
const rotateCellKey = computed<string | null>(() => {
  const unitId = rotatingUnitId.value;
  if (unitId === null) {
    return null;
  }

  return placementOf(unitId);
});

// A roster entry says what a unit is; this is the marker that stands for it on a
// hex. The marker carries the short code, not the full title.
//
// The facing a hovered handle stands for wins over the stored one, so the unit is
// already turned that way while the pointer rests on the handle.
function markerFor(unit: RosterUnit, cellKey: string): Unit {
  const preview = unit.id === rotatingUnitId.value ? hoveredFacing.value : null;

  return {
    id: unit.id,
    cellKey,
    kind: unit.kind,
    side: PLAYER_SIDE,
    name: unit.code,
    facing: preview ?? facingByUnitId.value[unit.id] ?? 0,
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

// Whether a hex lies in the band the player deploys into. A key the grid does
// not know is not a hex at all, so it takes nothing either.
function isDeployCell(key: string): boolean {
  const cell = cellOf(key);
  if (cell === null) {
    return false;
  }

  return cell.row < DEPLOY_ROWS;
}

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
//
// The selection is dropped along with it. It stands on some other unit — the
// board has nothing of this one on it yet — and leaving it would keep that unit's
// actions panel open next to a roster row talking about a different unit.
function pickUnit(unitId: string): void {
  pickedUnitId.value = pickedUnitId.value === unitId ? null : unitId;
  movingUnitId.value = null;
  cancelRotate();
  clearSelection();
}

function cancelPick(): void {
  pickedUnitId.value = null;
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
  cancelRotate();
}

function cancelMove(): void {
  movingUnitId.value = null;
}

// Disarms every command at once, for the one key that means "never mind".
function cancelActions(): void {
  cancelMove();
  cancelRotate();
}

// Puts the rotation handles on the selected unit, or takes them back if they are
// already out. Nothing to do while the selection holds no unit.
function toggleRotate(): void {
  const unit = selectedUnit.value;
  if (unit === null) {
    cancelRotate();
    return;
  }

  if (rotatingUnitId.value === unit.id) {
    cancelRotate();
    return;
  }

  rotatingUnitId.value = unit.id;
  hoveredFacing.value = null;
  pickedUnitId.value = null;
  movingUnitId.value = null;
}

function cancelRotate(): void {
  rotatingUnitId.value = null;
  hoveredFacing.value = null;
}

// The handle under the pointer, or `null` once the pointer leaves it. Drives the
// preview in `markerFor`.
function hoverFacing(facing: number | null): void {
  hoveredFacing.value = facing;
}

// Commits the facing a handle stands for and puts the handles away.
function rotateUnit(facing: number): void {
  const unitId = rotatingUnitId.value;
  if (unitId === null) {
    return;
  }

  cancelRotate();

  if (facingByUnitId.value[unitId] === facing) {
    return;
  }

  facingByUnitId.value = { ...facingByUnitId.value, [unitId]: facing };
  ready.value = false;
}

// Sends the unit being moved to `cellKey`. Another unit standing there is not
// pushed off the board: the two trade places, so the move never costs a unit its
// spot. Either way the move ends and the selection follows the unit.
//
// A hex outside the deployment band takes nothing, and the unit stays where it
// is. The move still ends: a click that lands off the band is the user calling
// it off.
function moveUnit(cellKey: string): void {
  const unitId = movingUnitId.value;
  if (unitId === null) {
    return;
  }

  movingUnitId.value = null;

  const from = placementOf(unitId);
  if (from === null || from === cellKey || !isDeployCell(cellKey)) {
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

  // A hex outside the deployment band takes nothing, and the unit stays armed for
  // a hex that does.
  if (!isDeployCell(cellKey)) {
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
  cancelActions,
  cancelMove,
  cancelPick,
  cancelRotate,
  hoverFacing,
  isPlaced,
  moveUnit,
  movingUnitId,
  pickUnit,
  pickedUnitId,
  placeUnit,
  placeableCellKeys,
  placedCount,
  placedUnitAt,
  placedUnits,
  placementOf,
  previewUnit,
  ready,
  recallUnit,
  rotateCellKey,
  rotateUnit,
  rotatingUnitId,
  roster,
  selectedUnit,
  swapCellKey,
  toggleMove,
  toggleReady,
  toggleRotate,
  unitIdAt,
};
export type { RosterUnit };
