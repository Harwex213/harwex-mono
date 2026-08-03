import { computed, signal } from "@preact/signals-react";
import { cellKey, frontDirections, neighborCell } from "../hex/hex-layout";
import { attackStrategyFor, type AttackDamage, type AttackTarget } from "./attack-strategies";
import { cellOf, focusCell, selectedKey } from "./grid-state";
import {
  selectedScenario,
  selectedScenarioId,
  type BattleUnit,
  type Deployment,
} from "./scenario-state";
import type { Unit, UnitSide, UnitStats } from "./units-state";

// The seat the local player sits in. Their army is the one the left panel
// lists and the only one the End turn button ever answers for.
const LOCAL_SIDE: UnitSide = "blue";

// Both armies as they stand in the scenario the battle is fought on. Derived
// rather than read once, so picking another scenario swaps the armies out — what
// the board has done to them since is written in the signals below, and
// `selectScenario` is what puts those back to the opening numbers.
const army = computed<BattleUnit[]>(() =>
  selectedScenario.value.deployment.map((entry) => entry.unit),
);

const unitsById = computed<Map<string, BattleUnit>>(
  () => new Map(army.value.map((unit) => [unit.id, unit])),
);

// The local player's units, in the order the left panel lists them.
const localArmy = computed<BattleUnit[]>(() =>
  army.value.filter((unit) => unit.side === LOCAL_SIDE),
);

// The round, as a list of unit ids. Derived from initiative rather than written
// out by hand, so it cannot drift away from the army above.
const turnOrder = computed<string[]>(() =>
  [...army.value]
    .sort((first, second) => second.initiative - first.initiative)
    .map((unit) => unit.id),
);

// Whose turn it is, as an index into `turnOrder`. Wraps back to the start of
// the queue at the end of a round.
const turnIndex = signal(0);

// Cell key per unit. Every unit has one: this page opens with both armies on
// the board.
const cellByUnitId = signal<Record<string, string>>(
  openingCells(selectedScenario.value.deployment),
);

// Clockwise degrees each unit is turned by.
const facingByUnitId = signal<Record<string, number>>(
  openingFacings(selectedScenario.value.deployment),
);

// Health and morale as they stand now. The scenario carries the opening
// numbers, and everything the battle does to them is written here — so a unit's
// marker, its roster row and its card all read one place. A unit worn down to
// nothing stays on the board: routing and removal are not in the prototype yet.
const statsByUnitId = signal<Record<string, UnitStats>>(
  openingStats(selectedScenario.value.deployment),
);

// How much a unit may do on the board in one turn. A step onto a neighbouring
// hex and a turn on the spot cost one each, so this is the whole of what the
// board takes from a unit before its turn is over. Every unit is given the same
// allowance for now; a unit that has spent it can still be looked at, and can
// still be told to do the things that do not move it.
const MOVE_ALLOWANCE = 3;

// What each unit has left of that allowance. Refilled when the unit's turn
// comes round again, so the count is per turn rather than per battle.
const movesLeftByUnitId = signal<Record<string, number>>(
  openingMoves(selectedScenario.value.deployment),
);

// The allowance the count on a unit's card is read against. `MOVE_ALLOWANCE` on
// a unit left to its own pace, and more on one that has been driven on: an
// accelerated unit is handed moves it never started the turn with, and the card
// has to say so rather than report more left than it was ever given.
const movesTotalByUnitId = signal<Record<string, number>>(
  openingMoves(selectedScenario.value.deployment),
);

// What one Accelerate order takes off the unit's morale. The order doubles what
// the unit has left to spend this turn, and morale is what it is bought with — a
// unit driven on past its pace is a unit closer to breaking.
const ACCELERATE_MORALE_COST = 20;

// The unit waiting for a hex click to move to, if any.
const movingUnitId = signal<string | null>(null);

// The unit showing its rotation handles, if any.
const rotatingUnitId = signal<string | null>(null);

// The facing under the pointer while the handles are out. The unit is drawn
// turned this way before the click commits it, so the handle previews the
// result.
const hoveredFacing = signal<number | null>(null);

// The unit waiting for a target to strike, if any.
const attackingUnitId = signal<string | null>(null);

// The target under the pointer while the attack is armed. Its marker answers
// the pointer, and the slices of its bars the blow would take are blinked on it.
const hoveredTargetId = signal<string | null>(null);

// A blow being played out. Written when a strike is committed and cleared once
// the animation it drives is over.
type Strike = {
  attackerId: string;
  targetId: string;
  // The way the blow travels, so the attacker lunges towards the unit it hits.
  direction: number;
  // Bumped per blow. Two strikes on the same pair carry the same ids otherwise,
  // and the layer would have nothing to restart its animation on.
  seq: number;
};

const strike = signal<Strike | null>(null);

// How long a strike takes to play out, and how far into it the blow lands. The
// bars come down at the impact rather than at the click, so the numbers drop as
// the marker connects. The stylesheet is handed both.
const PUNCH_MS = 420;

const PUNCH_IMPACT_MS = 170;

let strikeSeq = 0;

let impactTimer = 0;

let strikeTimer = 0;

// A step being played out. Written when a unit moves and cleared once the
// animation it drives is over, the same way a strike is.
type Movement = {
  unitId: string;
  // The hex the unit has left. Its marker is drawn on the hex it has arrived at
  // and slid in from this one, so a step reads as travel rather than as a marker
  // appearing somewhere else.
  fromKey: string;
  // Bumped per step, so a unit that walks two hexes in a row plays the animation
  // twice — the same reason a strike carries one.
  seq: number;
};

const movement = signal<Movement | null>(null);

// How long that slide lasts. The stylesheet is handed it, so the timer clearing
// the movement above and the animation it drives cannot drift apart.
const STEP_MS = 280;

// What the timer waits on top of that. The timer is started the moment the step
// is written, and the animation only starts on the frame the marker carrying it
// is painted on — so a timer of exactly `STEP_MS` takes the marker off the board
// a frame or two short of the hex it is walking to. Two frames at 60Hz, rounded
// up, is enough to let the animation finish first.
const STEP_TAIL_MS = 40;

let movementSeq = 0;

let movementTimer = 0;

// The unit to move. Never empty: the queue is built from the army itself, so
// every id in it answers.
const activeUnit = computed<BattleUnit>(
  () => unitsById.value.get(turnOrder.value[turnIndex.value]) ?? army.value[0],
);

// The round as the turn order bar draws it: the unit to move first, then the
// rest behind it, wrapping past the end of the round.
const turnQueue = computed<BattleUnit[]>(() => {
  const order = turnOrder.value;
  const start = turnIndex.value;
  const queue: BattleUnit[] = [];

  for (let offset = 0; offset < order.length; offset += 1) {
    const unit = unitsById.value.get(order[(start + offset) % order.length]);
    if (unit !== undefined) {
      queue.push(unit);
    }
  }

  return queue;
});

// The shape `UnitLayer` draws, rebuilt whenever a unit moves or turns.
const battleUnits = computed<Unit[]>(() => army.value.map(markerFor));

// A hex an armed move may go to, and the direction it lies in — the layer
// points an arrow that way.
type MoveTarget = {
  key: string;
  direction: number;
};

// Where the armed unit may step. A unit walks forwards, and a facing points at
// a corner, so the two hexes the facing looks between are the whole of it. A
// hex off the board or with somebody on it is dropped: units in a battle do not
// trade places the way they do while the armies are being laid out.
const moveTargets = computed<MoveTarget[]>(() => {
  const unitId = movingUnitId.value;
  if (unitId === null) {
    return [];
  }

  const from = cellOfUnit(unitId);
  if (from === null) {
    return [];
  }

  const cell = cellOf(from);
  if (cell === null) {
    return [];
  }

  const targets: MoveTarget[] = [];

  for (const direction of frontDirections(facingByUnitId.value[unitId] ?? 0)) {
    const step = neighborCell(cell.col, cell.row, direction);
    if (step === null) {
      continue;
    }

    const key = cellKey(step.col, step.row);
    if (cellOf(key) === null || unitIdAt(key) !== null) {
      continue;
    }

    targets.push({ key, direction });
  }

  return targets;
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

// Everyone the unit could hit from where it stands, through whichever attack
// its kind makes. Read straight — no `computed` — because two different
// questions ask it: what the armed attack is offering, and whether the command
// has anything to offer at all.
function targetsFor(unitId: string): AttackTarget[] {
  const unit = unitsById.value.get(unitId);
  if (unit === undefined) {
    return [];
  }

  const from = cellOfUnit(unitId);
  if (from === null) {
    return [];
  }

  const cell = cellOf(from);
  if (cell === null) {
    return [];
  }

  return attackStrategyFor(unit.kind).targets({
    col: cell.col,
    row: cell.row,
    facing: facingByUnitId.value[unitId] ?? 0,
    side: unit.side,
    unitIdAt,
    sideOf: (id) => unitsById.value.get(id)?.side ?? null,
  });
}

// What the armed attack may land on. Empty unless a unit has its attack armed,
// the way the move targets are.
const attackTargets = computed<AttackTarget[]>(() => {
  const unitId = attackingUnitId.value;
  if (unitId === null) {
    return [];
  }

  return targetsFor(unitId);
});

// The hex the arrows are drawn from: the one the armed attacker stands on.
const attackFromKey = computed<string | null>(() => {
  const unitId = attackingUnitId.value;
  if (unitId === null) {
    return null;
  }

  return cellOfUnit(unitId);
});

// Whether the Attack command has anything to offer. An attack with nobody in
// reach stays silent rather than arming an empty board, so the button that
// stands for it goes quiet too.
const canAttack = computed<boolean>(() => {
  if (!localTurn.value) {
    return false;
  }

  const unitId = activeUnit.value.id;
  if (movesLeftOf(unitId) === 0) {
    return false;
  }

  return targetsFor(unitId).length > 0;
});

// Whether the Accelerate command has anything to give. It doubles what the unit
// has left, so a unit with nothing left has nothing to double; and it is paid
// for in morale, so a unit that cannot cover the price cannot be driven on. The
// button that stands for the order goes quiet in either case, which is what
// keeps the confirmation from opening on an order that would do nothing.
const canAccelerate = computed<boolean>(() => {
  if (!localTurn.value) {
    return false;
  }

  const unitId = activeUnit.value.id;
  if (movesLeftOf(unitId) === 0) {
    return false;
  }

  return statsOf(unitId).morale >= ACCELERATE_MORALE_COST;
});

// What the target under the pointer is about to lose. Its marker blinks these
// slices of its bars, so the blow can be read before it is struck.
const pendingDamage = computed<{ unitId: string; damage: AttackDamage } | null>(() => {
  const attackerId = attackingUnitId.value;
  const targetId = hoveredTargetId.value;
  if (attackerId === null || targetId === null) {
    return null;
  }

  const attacker = unitsById.value.get(attackerId);
  if (attacker === undefined) {
    return null;
  }

  // The pointer may still be resting where a target stood a moment ago.
  if (!attackTargets.value.some((target) => target.unitId === targetId)) {
    return null;
  }

  return {
    unitId: targetId,
    damage: attackStrategyFor(attacker.kind).damage(statsOf(attackerId), statsOf(targetId)),
  };
});

// The hex the target under the pointer stands on. The board lights that hex up
// in the attack colour, in place of the hover ring it would otherwise wear.
//
// Read off the target list rather than off the unit, and so `null` while the
// pointer rests where a target stood a moment ago — the same guard
// `pendingDamage` makes, for the same reason.
const hoveredTargetKey = computed<string | null>(() => {
  const targetId = hoveredTargetId.value;
  if (targetId === null) {
    return null;
  }

  return attackTargets.value.find((target) => target.unitId === targetId)?.key ?? null;
});

// The unit standing on the selected hex, if there is one. Its stats are the
// ones the battle has left it with, not the ones the scenario opened on.
const selectedUnit = computed<BattleUnit | null>(() => {
  const key = selectedKey.value;
  if (key === null) {
    return null;
  }

  const unitId = unitIdAt(key);
  if (unitId === null) {
    return null;
  }

  const unit = unitsById.value.get(unitId);
  if (unit === undefined) {
    return null;
  }

  return { ...unit, stats: statsOf(unitId) };
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
    stats: statsOf(unit.id),
  };
}

function cellOfUnit(unitId: string): string | null {
  return cellByUnitId.value[unitId] ?? null;
}

// Health and morale as the battle has left them. The scenario numbers are the
// fallback, which is what a unit nobody has touched yet still carries.
function statsOf(unitId: string): UnitStats {
  return (
    statsByUnitId.value[unitId] ??
    unitsById.value.get(unitId)?.stats ?? { health: 0, attack: 0, morale: 0 }
  );
}

// What the unit has left of its allowance this turn. Read during a render that
// tracks signals, so the panel showing it follows every step and every turn.
function movesLeftOf(unitId: string): number {
  return movesLeftByUnitId.value[unitId] ?? 0;
}

// The allowance that count is read against this turn.
function movesTotalOf(unitId: string): number {
  return movesTotalByUnitId.value[unitId] ?? MOVE_ALLOWANCE;
}

// Takes one off the allowance, for an order the unit has actually carried out.
// Arming a command costs nothing: a move called off leaves the unit where it
// was, and so leaves its allowance where it was too.
function spendMove(unitId: string): void {
  movesLeftByUnitId.value = {
    ...movesLeftByUnitId.value,
    [unitId]: Math.max(0, movesLeftOf(unitId) - 1),
  };
}

// Both halves of the count: a turn opens on the plain allowance, whatever the
// last one was stretched to.
function refillMoves(unitId: string): void {
  movesLeftByUnitId.value = { ...movesLeftByUnitId.value, [unitId]: MOVE_ALLOWANCE };
  movesTotalByUnitId.value = { ...movesTotalByUnitId.value, [unitId]: MOVE_ALLOWANCE };
}

// The four maps a deployment opens on. The signals above are built from these
// at import and written from them again whenever a scenario is picked, so the
// opening position is read out of the scenario in one place rather than two.
function openingCells(deployment: Deployment[]): Record<string, string> {
  return Object.fromEntries(
    deployment.map((entry) => [entry.unit.id, cellKey(entry.col, entry.row)]),
  );
}

function openingFacings(deployment: Deployment[]): Record<string, number> {
  return Object.fromEntries(deployment.map((entry) => [entry.unit.id, entry.facing]));
}

function openingStats(deployment: Deployment[]): Record<string, UnitStats> {
  return Object.fromEntries(deployment.map((entry) => [entry.unit.id, entry.unit.stats]));
}

function openingMoves(deployment: Deployment[]): Record<string, number> {
  return Object.fromEntries(deployment.map((entry) => [entry.unit.id, MOVE_ALLOWANCE]));
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
// played. Nothing to arm on a spent unit either — calling an armed move off
// stays open to it, or the last step of a turn would leave the board waiting
// for a click that can no longer land.
function toggleMove(): void {
  if (!localTurn.value) {
    return;
  }

  const unitId = activeUnit.value.id;
  if (movingUnitId.value !== unitId && movesLeftOf(unitId) === 0) {
    return;
  }

  movingUnitId.value = movingUnitId.value === unitId ? null : unitId;
  cancelRotate();
  cancelAttack();
}

function cancelMove(): void {
  movingUnitId.value = null;
}

// Disarms every command at once, for the one key that means "never mind".
function cancelActions(): void {
  cancelMove();
  cancelRotate();
  cancelAttack();
}

// Puts the rotation handles on the active unit, or takes them back if they are
// already out. Gated on the local turn and on the allowance, the same way a
// move is: turning on the spot is work too.
function toggleRotate(): void {
  if (!localTurn.value) {
    return;
  }

  const unitId = activeUnit.value.id;
  if (rotatingUnitId.value === unitId) {
    cancelRotate();
    return;
  }

  if (movesLeftOf(unitId) === 0) {
    return;
  }

  rotatingUnitId.value = unitId;
  hoveredFacing.value = null;
  movingUnitId.value = null;
  cancelAttack();
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

  // The handle the unit already faces is not a turn, so it costs nothing.
  if (facingByUnitId.value[unitId] === facing) {
    return;
  }

  facingByUnitId.value = { ...facingByUnitId.value, [unitId]: facing };
  spendMove(unitId);
}

// Sends the unit being moved to `key`, which has to be one of the highlighted
// hexes in front of it. A click anywhere else on the board is not a step the
// unit can take, so it reads as calling the move off. Either way the move ends.
function moveUnit(key: string): void {
  const unitId = movingUnitId.value;
  if (unitId === null) {
    return;
  }

  const reachable = moveTargets.value.some((target) => target.key === key);
  const from = cellOfUnit(unitId);
  movingUnitId.value = null;

  if (!reachable || from === null) {
    return;
  }

  cellByUnitId.value = { ...cellByUnitId.value, [unitId]: key };
  spendMove(unitId);
  focusCell(key);

  // The unit stands on the new hex from here on, and the hex it left is handed
  // to the layer so the marker can be slid in from it. A step taken while the
  // one before it is still playing drops that one's timer and plays out on its
  // own — the same bargain a second strike makes.
  movementSeq += 1;
  movement.value = { unitId, fromKey: from, seq: movementSeq };

  window.clearTimeout(movementTimer);
  movementTimer = window.setTimeout(() => {
    movement.value = null;
  }, STEP_MS + STEP_TAIL_MS);
}

// Hands the round on to the next unit in the queue and selects it, so the
// board says who is up without a click. The unit coming up starts its turn on
// a full allowance, whatever it had left at the end of its last one.
function endTurn(): void {
  cancelActions();
  turnIndex.value = (turnIndex.value + 1) % turnOrder.value.length;
  refillMoves(activeUnit.value.id);
  selectUnit(activeUnit.value.id);
}

// Fights the battle on another scenario: the armies the derivations above read
// come from the picked one, and everything the board has written since — where
// the units stand, what they face, what they have left — is put back to that
// scenario's opening position. A battle in progress is dropped rather than
// stored, which is what makes a scenario a starting position and not a save.
//
// The round opens on the unit with the highest initiative, and the board is
// left with that unit selected, so the new position says who is up.
function selectScenario(scenarioId: string): void {
  if (scenarioId === selectedScenarioId.value) {
    return;
  }

  selectedScenarioId.value = scenarioId;

  // Whatever was playing out belonged to the position being left. Its timers
  // would otherwise write a blow or a step onto units that are no longer here.
  window.clearTimeout(impactTimer);
  window.clearTimeout(strikeTimer);
  window.clearTimeout(movementTimer);
  strike.value = null;
  movement.value = null;

  const { deployment } = selectedScenario.value;
  cellByUnitId.value = openingCells(deployment);
  facingByUnitId.value = openingFacings(deployment);
  statsByUnitId.value = openingStats(deployment);
  movesLeftByUnitId.value = openingMoves(deployment);
  movesTotalByUnitId.value = openingMoves(deployment);
  turnIndex.value = 0;

  // Disarms every command on the way, the same as any other selection from
  // outside the board.
  selectUnit(activeUnit.value.id);
}

// Arms the active unit for an attack, or calls the attack off if it is already
// armed. Gated the way a move is — the enemy's units are watched, not played,
// and a spent unit swings at nothing. On top of that an attack needs somebody to
// swing at: with nobody in reach the order is not refused, it simply has nothing
// to arm, and the board is left as it stands.
function attackUnit(): void {
  if (!localTurn.value) {
    return;
  }

  const unitId = activeUnit.value.id;
  if (attackingUnitId.value === unitId) {
    cancelAttack();
    return;
  }

  if (movesLeftOf(unitId) === 0) {
    return;
  }

  if (targetsFor(unitId).length === 0) {
    return;
  }

  cancelMove();
  cancelRotate();
  attackingUnitId.value = unitId;
  hoveredTargetId.value = null;
}

function cancelAttack(): void {
  attackingUnitId.value = null;
  hoveredTargetId.value = null;
}

// The target under the pointer, or `null` once the pointer leaves it. Drives
// both the marker's own answer and the bar slices blinked on it.
function hoverAttackTarget(unitId: string | null): void {
  hoveredTargetId.value = unitId;
}

// Strikes `targetUnitId`, which has to be one of the units the armed attack
// reaches. A click on anything else is not a blow the unit can land, so it reads
// as calling the attack off — the same bargain a move click makes.
//
// The blow is committed here and lands a moment later: the attacker lunges from
// the click, and the damage is written when the marker connects, so the bars
// come down on the impact rather than ahead of it.
function strikeUnit(targetUnitId: string): void {
  const attackerId = attackingUnitId.value;
  if (attackerId === null) {
    return;
  }

  const target = attackTargets.value.find((entry) => entry.unitId === targetUnitId);
  const attacker = unitsById.value.get(attackerId);
  if (target === undefined || attacker === undefined) {
    cancelAttack();
    return;
  }

  const damage = attackStrategyFor(attacker.kind).damage(statsOf(attackerId), statsOf(targetUnitId));

  cancelAttack();
  spendMove(attackerId);

  strikeSeq += 1;
  strike.value = {
    attackerId,
    targetId: targetUnitId,
    direction: target.direction,
    seq: strikeSeq,
  };

  // Timers rather than animation callbacks: the markers are drawn from this
  // state, so this state is what has to say when the blow lands and when the
  // animation is over. A second strike started mid-animation drops the first
  // one's timers and plays out on its own.
  window.clearTimeout(impactTimer);
  window.clearTimeout(strikeTimer);
  impactTimer = window.setTimeout(() => applyDamage(targetUnitId, damage), PUNCH_IMPACT_MS);
  strikeTimer = window.setTimeout(() => {
    strike.value = null;
  }, PUNCH_MS);
}

// Takes a blow off a unit's health and morale. Neither goes below nothing.
function applyDamage(unitId: string, damage: AttackDamage): void {
  const current = statsOf(unitId);

  statsByUnitId.value = {
    ...statsByUnitId.value,
    [unitId]: {
      ...current,
      health: Math.max(0, current.health - damage.health),
      morale: Math.max(0, current.morale - damage.morale),
    },
  };
}

// Drives the active unit on: everything it has left to spend this turn is
// doubled, and the morale it is bought with comes off its bars. The order is
// confirmed before it gets here — the page asks, and this is what the answer
// runs — so the guard below is the last word rather than the only one.
//
// The allowance grows by exactly what the order gave, so a unit accelerated
// halfway through its turn still reads as having part of the turn behind it.
function accelerateUnit(): void {
  if (!canAccelerate.value) {
    return;
  }

  const unitId = activeUnit.value.id;
  const gained = movesLeftOf(unitId);

  movesLeftByUnitId.value = {
    ...movesLeftByUnitId.value,
    [unitId]: movesLeftOf(unitId) + gained,
  };
  movesTotalByUnitId.value = {
    ...movesTotalByUnitId.value,
    [unitId]: movesTotalOf(unitId) + gained,
  };

  const current = statsOf(unitId);
  statsByUnitId.value = {
    ...statsByUnitId.value,
    [unitId]: {
      ...current,
      morale: Math.max(0, current.morale - ACCELERATE_MORALE_COST),
    },
  };
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
  ACCELERATE_MORALE_COST,
  MOVE_ALLOWANCE,
  PUNCH_MS,
  STEP_MS,
  accelerateUnit,
  activeUnit,
  attackFromKey,
  attackTargets,
  attackUnit,
  attackingUnitId,
  battleUnitAt,
  battleUnits,
  canAccelerate,
  canAttack,
  cancelActions,
  cancelAttack,
  cancelRotate,
  endTurn,
  hoverAttackTarget,
  hoverFacing,
  hoveredTargetId,
  hoveredTargetKey,
  localArmy,
  localTurn,
  movement,
  moveTargets,
  moveUnit,
  movesLeftOf,
  movesTotalOf,
  movingUnitId,
  pendingDamage,
  rotateCellKey,
  rotateUnit,
  rotatingUnitId,
  selectScenario,
  selectUnit,
  selectedUnit,
  statsOf,
  strike,
  strikeUnit,
  toggleMove,
  toggleRotate,
  turnQueue,
  unitIdAt,
};
export type { BattleUnit, MoveTarget, Movement, Strike };
