import { computed, signal } from "@preact/signals-react";
import { cellKey } from "../hex/hex-layout";
import type { AvatarCode } from "../units/unit-avatars";
import { focusCell, hoveredKey, selectedKey } from "./grid-state";
import type { Unit, UnitKind, UnitSide, UnitStats } from "./units-state";

// A unit already standing on the board. The disposition page works with a
// roster the local player still has to place; by the time the battle is on,
// both armies are deployed and every unit carries the side it fights for.
type BattleUnit = {
  id: string;
  // Full name for a roster row and the actions panel. `code` is the short form
  // the marker on the canvas carries, and the key its portrait hangs on.
  title: string;
  code: AvatarCode;
  kind: UnitKind;
  side: UnitSide;
  // Where the unit sits in the round. The queue runs from the highest down, so
  // a lighter unit moves before a heavier one.
  initiative: number;
  stats: UnitStats;
};

// Where a unit stands when the battle opens, and which way it looks.
type Deployment = {
  unit: BattleUnit;
  col: number;
  row: number;
  facing: number;
};

// The seat the local player sits in. Their army is the one the left panel
// lists and the only one the End turn button ever answers for.
const LOCAL_SIDE: UnitSide = "blue";

// Both armies as they stand when the page opens: blue along the bottom looking
// up the board, red along the top looking down it. Hand-placed, the way the
// terrain map is, and kept well inside the grid so both lines are on screen at
// the zoom the canvas fits itself to.
const DEPLOYMENT: Deployment[] = [
  {
    col: 2,
    row: 4,
    facing: 180,
    unit: {
      id: "red-lko",
      title: "Лёгкий копейщик",
      code: "ЛКо",
      kind: "spear",
      side: "red",
      initiative: 85,
      stats: { health: 50, attack: 12, morale: 65 },
    },
  },
  {
    col: 5,
    row: 4,
    facing: 180,
    unit: {
      id: "red-tko",
      title: "Тяжёлый копейщик",
      code: "ТКо",
      kind: "spear",
      side: "red",
      initiative: 60,
      stats: { health: 90, attack: 20, morale: 75 },
    },
  },
  {
    col: 9,
    row: 4,
    facing: 180,
    unit: {
      id: "red-lpo",
      title: "Лёгкий пехотинец",
      code: "ЛПо",
      kind: "sword",
      side: "red",
      initiative: 75,
      stats: { health: 55, attack: 18, morale: 60 },
    },
  },
  {
    col: 2,
    row: 10,
    facing: 0,
    unit: {
      id: "blue-tko",
      title: "Тяжёлый копейщик",
      code: "ТКо",
      kind: "spear",
      side: "blue",
      initiative: 55,
      stats: { health: 90, attack: 20, morale: 75 },
    },
  },
  {
    col: 5,
    row: 10,
    facing: 0,
    unit: {
      id: "blue-sko",
      title: "Средний копейщик",
      code: "СКо",
      kind: "spear",
      side: "blue",
      initiative: 70,
      stats: { health: 70, attack: 16, morale: 70 },
    },
  },
  {
    col: 8,
    row: 10,
    facing: 0,
    unit: {
      id: "blue-lko",
      title: "Лёгкий копейщик",
      code: "ЛКо",
      kind: "spear",
      side: "blue",
      initiative: 90,
      stats: { health: 50, attack: 12, morale: 65 },
    },
  },
  {
    col: 10,
    row: 10,
    facing: 0,
    unit: {
      id: "blue-lpo",
      title: "Лёгкий пехотинец",
      code: "ЛПо",
      kind: "sword",
      side: "blue",
      initiative: 80,
      stats: { health: 55, attack: 18, morale: 60 },
    },
  },
];

const army: BattleUnit[] = DEPLOYMENT.map((entry) => entry.unit);

const unitsById = new Map(army.map((unit) => [unit.id, unit]));

// The local player's units, in the order the left panel lists them.
const localArmy: BattleUnit[] = army.filter((unit) => unit.side === LOCAL_SIDE);

// The round, as a list of unit ids. Derived from initiative rather than written
// out by hand, so it cannot drift away from the army above.
const TURN_ORDER: string[] = [...army]
  .sort((first, second) => second.initiative - first.initiative)
  .map((unit) => unit.id);

// Whose turn it is, as an index into `TURN_ORDER`. Wraps back to the start of
// the queue at the end of a round.
const turnIndex = signal(0);

// Cell key per unit. Every unit has one: this page opens with both armies on
// the board.
const cellByUnitId = signal<Record<string, string>>(
  Object.fromEntries(DEPLOYMENT.map((entry) => [entry.unit.id, cellKey(entry.col, entry.row)])),
);

// Clockwise degrees each unit is turned by.
const facingByUnitId = signal<Record<string, number>>(
  Object.fromEntries(DEPLOYMENT.map((entry) => [entry.unit.id, entry.facing])),
);

// The unit waiting for a hex click to move to, if any.
const movingUnitId = signal<string | null>(null);

// The unit showing its rotation handles, if any.
const rotatingUnitId = signal<string | null>(null);

// The facing under the pointer while the handles are out. The unit is drawn
// turned this way before the click commits it, so the handle previews the
// result.
const hoveredFacing = signal<number | null>(null);

// The unit to move. Never empty: the queue is built from the army itself, so
// every id in it answers.
const activeUnit = computed<BattleUnit>(() => unitsById.get(TURN_ORDER[turnIndex.value]) ?? army[0]);

// The round as the turn order bar draws it: the unit to move first, then the
// rest behind it, wrapping past the end of the round.
const turnQueue = computed<BattleUnit[]>(() => {
  const start = turnIndex.value;
  const queue: BattleUnit[] = [];

  for (let offset = 0; offset < TURN_ORDER.length; offset += 1) {
    const unit = unitsById.get(TURN_ORDER[(start + offset) % TURN_ORDER.length]);
    if (unit !== undefined) {
      queue.push(unit);
    }
  }

  return queue;
});

// The shape `UnitLayer` draws, rebuilt whenever a unit moves or turns.
const battleUnits = computed<Unit[]>(() => army.map(markerFor));

// The active unit drawn on the hex under the pointer while its move is armed.
// Empty over a taken hex: a move onto one does nothing.
const previewUnit = computed<Unit | null>(() => {
  const unitId = movingUnitId.value;
  const target = hoveredKey.value;
  if (unitId === null || target === null) {
    return null;
  }

  const unit = unitsById.get(unitId);
  if (unit === undefined || unitIdAt(target) !== null) {
    return null;
  }

  return { ...markerFor(unit), cellKey: target };
});

// Where the rotation handles go: the hex of the unit being turned. Empty unless
// a unit has its handles out.
const rotateCellKey = computed<string | null>(() => {
  const unitId = rotatingUnitId.value;
  if (unitId === null) {
    return null;
  }

  return cellOfUnit(unitId);
});

// The unit standing on the selected hex, if there is one.
const selectedUnit = computed<BattleUnit | null>(() => {
  const key = selectedKey.value;
  if (key === null) {
    return null;
  }

  const unitId = unitIdAt(key);
  if (unitId === null) {
    return null;
  }

  return unitsById.get(unitId) ?? null;
});

// The marker that stands for a unit on its hex. It carries the short code, not
// the full title.
//
// The facing a hovered handle stands for wins over the stored one, so the unit
// is already turned that way while the pointer rests on the handle.
function markerFor(unit: BattleUnit): Unit {
  const preview = unit.id === rotatingUnitId.value ? hoveredFacing.value : null;

  return {
    id: unit.id,
    cellKey: cellByUnitId.value[unit.id],
    kind: unit.kind,
    side: unit.side,
    name: unit.code,
    facing: preview ?? facingByUnitId.value[unit.id] ?? 0,
    stats: unit.stats,
  };
}

function cellOfUnit(unitId: string): string | null {
  return cellByUnitId.value[unitId] ?? null;
}

function unitIdAt(key: string): string | null {
  for (const [unitId, cell] of Object.entries(cellByUnitId.value)) {
    if (cell === key) {
      return unitId;
    }
  }
  return null;
}

// The marker on a cell, for the read-only info panel. `selectedUnit` above
// answers with the battle unit instead, because the actions panel needs the
// full title.
function battleUnitAt(key: string): Unit | null {
  return battleUnits.value.find((unit) => unit.cellKey === key) ?? null;
}

// Whether the local player is the one to move. The End turn button and the
// actions panel both hang on this: the other army is watched, not played.
const localTurn = computed(() => activeUnit.value.side === LOCAL_SIDE);

// Arms the active unit for a move, or calls the move off if it is already
// armed. Nothing to arm on the enemy's turn: their units are watched, not
// played.
function toggleMove(): void {
  if (!localTurn.value) {
    return;
  }

  const unitId = activeUnit.value.id;
  movingUnitId.value = movingUnitId.value === unitId ? null : unitId;
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

// Puts the rotation handles on the active unit, or takes them back if they are
// already out. Gated on the local turn, the same way a move is.
function toggleRotate(): void {
  if (!localTurn.value) {
    return;
  }

  const unitId = activeUnit.value.id;
  if (rotatingUnitId.value === unitId) {
    cancelRotate();
    return;
  }

  rotatingUnitId.value = unitId;
  hoveredFacing.value = null;
  movingUnitId.value = null;
}

function cancelRotate(): void {
  rotatingUnitId.value = null;
  hoveredFacing.value = null;
}

// The handle under the pointer, or `null` once the pointer leaves it. Drives
// the preview in `markerFor`.
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
}

// Sends the unit being moved to `key`. A hex someone already stands on is not
// a move: unlike the disposition page, two units in a battle do not trade
// places. Either way the move ends.
function moveUnit(key: string): void {
  const unitId = movingUnitId.value;
  if (unitId === null) {
    return;
  }

  movingUnitId.value = null;

  if (cellOfUnit(unitId) === key || unitIdAt(key) !== null) {
    return;
  }

  cellByUnitId.value = { ...cellByUnitId.value, [unitId]: key };
  focusCell(key);
}

// Hands the round on to the next unit in the queue and selects it, so the
// board says who is up without a click.
function endTurn(): void {
  cancelActions();
  turnIndex.value = (turnIndex.value + 1) % TURN_ORDER.length;
  selectUnit(activeUnit.value.id);
}

// Selects a unit on the board from a control outside the canvas — a roster row
// or a card in the turn order bar.
function selectUnit(unitId: string): void {
  const cell = cellOfUnit(unitId);
  if (cell === null) {
    return;
  }

  // A move or rotation armed on some other unit was aimed at the board, and
  // neither the roster nor the turn bar is the board.
  cancelActions();
  focusCell(cell);
}

export {
  activeUnit,
  battleUnitAt,
  battleUnits,
  cancelActions,
  cancelRotate,
  endTurn,
  hoverFacing,
  localArmy,
  localTurn,
  moveUnit,
  movingUnitId,
  previewUnit,
  rotateCellKey,
  rotateUnit,
  rotatingUnitId,
  selectUnit,
  selectedUnit,
  toggleMove,
  toggleRotate,
  turnQueue,
  unitIdAt,
};
export type { BattleUnit };
