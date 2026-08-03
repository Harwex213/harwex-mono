import { computed, signal } from "@preact/signals-react";
import { cellKey, frontDirections, neighborCell } from "../hex/hex-layout";
import {
  attackStrategyFor,
  canopyCone,
  type AttackDamage,
  type AttackKind,
  type AttackStrategy,
  type AttackTarget,
} from "./attack-strategies";
import { cellOf, focusCell, selectedKey } from "./grid-state";
import {
  selectedScenario,
  selectedScenarioId,
  type BattleUnit,
  type Deployment,
} from "./scenario-state";
import type { Unit, UnitSide, UnitStats } from "./units-state";

// The seat the local player sits in. Their army is the one the left panel
// lists. The player still gives orders to both armies — nothing drives the
// other one — so the seat only decides what the panels call "yours".
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

// Which round the battle is on. A round is one pass down the queue: every unit
// of both armies has had its turn, and the unit with the highest initiative is
// up again. Counted up on that wrap and nowhere else, so a turn handed on
// mid-round leaves the number alone.
const roundNumber = signal(1);

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

// Whether the board draws the canopy cone of the unit the panels answer for.
// A view setting rather than an order: nothing on the board changes, no attack
// has to be armed for it, and it stays on as the selection moves — so two
// shooters can be read against each other, and an enemy shooter's reach can be
// looked at before walking into it.
const showCanopyCone = signal(false);

// A blow being played out. Written when a strike is committed and cleared once
// the animation it drives is over.
type Strike = {
  attackerId: string;
  targetId: string;
  // Which attack landed it. A blow by hand is a lunge, a volley is an arrow in
  // the air, and the two are drawn nothing like each other.
  kind: AttackKind;
  // The hexes the blow travels between. A lunge only needs the direction below,
  // but a shot has a whole flight to draw across the board.
  fromKey: string;
  toKey: string;
  // The way the blow travels: the attacker lunges that way, and the unit it hits
  // is thrown that way.
  direction: number;
  // Whether the blow is still on its way. A shot spends `SHOT_MS` in the air
  // before it lands, and the unit under it answers nothing until it does; a
  // lunge is written landed, because its own animation carries the wind-up.
  phase: "flight" | "impact";
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

// How long an arrow spends in the air, whatever the distance: a volley at four
// hexes is a longer shot, not a slower one. The stylesheet is handed this too —
// the arrow crosses the board on it, and the timer below takes the arrow off the
// board when it runs out.
const SHOT_MS = 520;

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

// --- Оппортун ---

// A swing an enemy is handed outside its own turn, because a unit moved where
// it could reach. Three things provoke one:
//
//  "leave"    — the unit is about to step off its hex. Everybody who can reach
//               it there swings before it goes.
//  "arrive"   — the unit has landed on its new hex. Every shooter covering that
//               hex answers at once.
//  "turn-end" — the same landing, answered by hand: a melee enemy waits until
//               the unit's whole turn is over and swings then.
type OpportunityTrigger = "leave" | "arrive" | "turn-end";

type Opportunity = {
  // The enemy holding the swing.
  attackerId: string;
  // The unit that provoked it, and the only one the swing may land on.
  victimId: string;
  trigger: OpportunityTrigger;
};

// The swings still to be answered, the one at the head first. Empty means no
// window is open and the board is the local player's again.
const opportunities = signal<Opportunity[]>([]);

// One swing per enemy per turn of the unit that provoked it. Without this a
// unit walking three hexes past the same spearman would be swung at three
// times, and the board would spend the turn asking rather than playing. Emptied
// whenever the turn is handed on.
const spentOpportunities = signal<Record<string, true>>({});

// The step a "leave" window is holding back. The swing lands first and the unit
// walks after it, which is the whole point of that trigger — so the step is
// parked here and taken from `closeOpportunities`.
const heldMove = signal<{ unitId: string; key: string } | null>(null);

// Whether the end of the turn is being held back the same way, by a "turn-end"
// window.
const heldTurnEnd = signal(false);

// Whether the unit whose turn it is has stepped at all. Only a unit that moved
// provokes the melee swing at the end of its turn: standing still all turn is
// not what the trigger answers.
const movedThisTurn = signal(false);

let opportunityTimer = 0;

// The swing being answered now.
const currentOpportunity = computed<Opportunity | null>(() => opportunities.value[0] ?? null);

// Whether a window is open. The board is the enemy's until it closes: every
// order the local player has is muted, and the only things that answer are the
// swing itself and the button that passes it up.
const opportunityOpen = computed<boolean>(() => opportunities.value.length > 0);

// The enemy holding the swing, and the unit under it. Both markers are ringed
// in red for as long as the window is open.
const opportunityAttackerId = computed<string | null>(
  () => currentOpportunity.value?.attackerId ?? null,
);

const opportunityVictimId = computed<string | null>(
  () => currentOpportunity.value?.victimId ?? null,
);

const opportunityAttacker = computed<BattleUnit | null>(() => {
  const attackerId = opportunityAttackerId.value;
  if (attackerId === null) {
    return null;
  }

  return unitsById.value.get(attackerId) ?? null;
});

// Everybody still to answer, in the order they will be asked. The turn order
// bar draws one card per entry, in front of the round it is interrupting.
const opportunityUnits = computed<BattleUnit[]>(() =>
  opportunities.value
    .map((entry) => unitsById.value.get(entry.attackerId))
    .filter((unit) => unit !== undefined),
);

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

// Where the next round begins in that queue: the offset of the card the round
// line is drawn before. Everything behind the line belongs to the round after
// this one.
//
// `null` at the top of a round. The line then falls on the head of the queue,
// and a line there would stand for the round the bar already counts — so the
// bar drops it, and it comes back at the tail as soon as the first unit has
// moved.
const roundBreakOffset = computed<number | null>(() => {
  if (turnIndex.value === 0) {
    return null;
  }

  return turnOrder.value.length - turnIndex.value;
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
//
// An Оппортун is the exception: the swing is one blow at the unit that provoked
// it, so everybody else the enemy could reach from where it stands is dropped.
const attackTargets = computed<AttackTarget[]>(() => {
  const unitId = attackingUnitId.value;
  if (unitId === null) {
    return [];
  }

  const targets = targetsFor(unitId);
  const victimId = opportunityVictimId.value;
  if (victimId === null) {
    return targets;
  }

  return targets.filter((target) => target.unitId === victimId);
});

// The hex the arrows are drawn from: the one the armed attacker stands on.
const attackFromKey = computed<string | null>(() => {
  const unitId = attackingUnitId.value;
  if (unitId === null) {
    return null;
  }

  return cellOfUnit(unitId);
});

// The attack the armed unit is about to make, if one is armed. The layer drawing
// the targets reads its kind: a blow by hand is offered as a dart on the seam it
// would cross, a volley as an arc over the board.
const armedAttack = computed<AttackStrategy | null>(() => {
  const unitId = attackingUnitId.value;
  if (unitId === null) {
    return null;
  }

  return attackStrategyOf(unitId);
});

// Whether the Attack command has anything to offer. An attack with nobody in
// reach stays silent rather than arming an empty board, so the button that
// stands for it goes quiet too.
const canAttack = computed<boolean>(() => {
  if (!takingOrders.value) {
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
  if (!takingOrders.value) {
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

// The attack the unit the panels answer for makes. The card names it on the
// command button, and offers the cone switch on the strength of its kind — the
// switch belongs to a shooter and to nobody else.
const selectedAttack = computed<AttackStrategy | null>(() => {
  const unit = selectedUnit.value;
  if (unit === null) {
    return null;
  }

  return attackStrategyFor(unit.kind);
});

// The hexes a canopy shot from the selected unit could come down on, or nothing
// at all: with the cone switched off, with a unit that does not shoot, and with
// no unit selected. Off-board hexes are dropped here rather than in the cone
// itself, which knows nothing about the board it is read against.
const canopyConeKeys = computed<string[]>(() => {
  if (!showCanopyCone.value) {
    return [];
  }

  const unit = selectedUnit.value;
  if (unit === null || selectedAttack.value?.kind !== "canopy") {
    return [];
  }

  const from = cellOfUnit(unit.id);
  if (from === null) {
    return [];
  }

  const cell = cellOf(from);
  if (cell === null) {
    return [];
  }

  // The facing a hovered rotation handle stands for wins over the stored one, so
  // the cone swings round with the marker while the handles are out — the same
  // preview `markerFor` draws, answered by the hexes the unit would shoot.
  const preview = unit.id === rotatingUnitId.value ? hoveredFacing.value : null;
  const facing = preview ?? facingByUnitId.value[unit.id] ?? 0;

  return canopyCone(cell.col, cell.row, facing)
    .map((coneCell) => cellKey(coneCell.col, coneCell.row))
    .filter((key) => cellOf(key) !== null);
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

// The attack a unit on the board makes, which is its kind's. Melee for a unit
// the army no longer has, so a caller always has a strategy to work with.
function attackStrategyOf(unitId: string): AttackStrategy {
  const unit = unitsById.value.get(unitId);
  return attackStrategyFor(unit?.kind ?? "sword");
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

// Whether the local player's unit is the one to move. The round still says
// whose side the turn belongs to: the button label under the roster and the
// players panel read this.
const localTurn = computed(() => activeUnit.value.side === LOCAL_SIDE);

// Whether the active unit may be given an order. Nothing drives the other army,
// so the local player gives orders to both sides: the enemy's turn is played by
// hand rather than skipped. The one thing that takes the board away is an open
// Оппортун. The window belongs to the unit holding the swing, and every order
// waits until the swing is answered.
const takingOrders = computed(() => !opportunityOpen.value);

// Arms the active unit for a move, or calls the move off if it is already
// armed. Nothing to arm on the enemy's turn: their units are watched, not
// played. Nothing to arm on a spent unit either — calling an armed move off
// stays open to it, or the last step of a turn would leave the board waiting
// for a click that can no longer land.
function toggleMove(): void {
  if (!takingOrders.value) {
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
  if (!takingOrders.value) {
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
  movingUnitId.value = null;

  if (!reachable) {
    return;
  }

  // The first trigger. The unit is still on the hex it is leaving, so everybody
  // who can reach it there is asked before it goes — a swing at a unit turning
  // its back. The step is parked until the last of them has answered.
  if (openOpportunities(unitId, ATTACK_KINDS, "leave")) {
    heldMove.value = { unitId, key };
    return;
  }

  stepUnit(unitId, key);
}

// Puts the unit on `key` and plays the step out. Split off `moveUnit` because
// a step held back by an Оппортун is taken from `closeOpportunities` instead,
// once the swings it provoked are done with.
function stepUnit(unitId: string, key: string): void {
  const from = cellOfUnit(unitId);

  // The hex was free when the step was armed. Nothing that happens inside a
  // window moves anybody onto it, but the step is now written from two places
  // and the guard is a line.
  if (from === null || unitIdAt(key) !== null) {
    return;
  }

  cellByUnitId.value = { ...cellByUnitId.value, [unitId]: key };
  spendMove(unitId);
  focusCell(key);
  movedThisTurn.value = true;

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

  // The third trigger. A shooter covering the hex the unit has walked onto does
  // not wait for anything: the volley is loosed the moment the unit lands.
  openOpportunities(unitId, ["canopy"], "arrive");
}

// Ends the turn, or answers whatever is standing in the way of ending it.
//
// Three things can come of one press. With an Оппортун open the button belongs
// to the enemy holding the swing, and pressing it is that enemy passing the
// swing up. With a unit that has walked into somebody's reach, the press opens
// the last window of the turn instead of ending it. Otherwise the round is
// handed on.
function endTurn(): void {
  if (opportunityOpen.value) {
    passOpportunity();
    return;
  }

  // The second trigger. A melee enemy covering the hex the unit walked onto has
  // waited the whole turn out, and swings as the turn closes. Only a unit that
  // moved provoked one — standing still provokes nobody.
  if (movedThisTurn.value && openOpportunities(activeUnit.value.id, ["melee"], "turn-end")) {
    heldTurnEnd.value = true;
    return;
  }

  handTurnOn();
}

// Hands the round on to the next unit in the queue and selects it, so the
// board says who is up without a click. The unit coming up starts its turn on
// a full allowance, whatever it had left at the end of its last one.
function handTurnOn(): void {
  cancelActions();

  // The wrap back to the head of the queue is the end of a round, and the only
  // thing that moves the round count on.
  const next = (turnIndex.value + 1) % turnOrder.value.length;
  if (next === 0) {
    roundNumber.value += 1;
  }

  turnIndex.value = next;
  refillMoves(activeUnit.value.id);

  // A new unit is up, so the Оппортун bookkeeping starts over: nobody has
  // moved yet this turn, and every enemy has its swing back.
  movedThisTurn.value = false;
  spentOpportunities.value = {};

  selectUnit(activeUnit.value.id);
}

// Both kinds of attack, for the trigger that asks everybody rather than one
// sort of enemy.
const ATTACK_KINDS: AttackKind[] = ["melee", "canopy"];

// Everybody on the other side who could strike `victimId` where it stands right
// now, through an attack of one of the given kinds. The reach is the enemy's
// own attack, read off the same strategy its turn would use — so an Оппортун is
// a blow the unit could have landed anyway, taken out of turn.
//
// In initiative order, the way the round itself runs, so two enemies swinging
// at the same unit are asked in the order the turn order bar would have asked
// them.
function opportunityAttackers(victimId: string, kinds: AttackKind[]): string[] {
  const victim = unitsById.value.get(victimId);
  if (victim === undefined) {
    return [];
  }

  return [...army.value]
    .sort((first, second) => second.initiative - first.initiative)
    .filter((unit) => unit.side !== victim.side)
    .filter((unit) => kinds.includes(attackStrategyOf(unit.id).kind))
    .filter((unit) => spentOpportunities.value[unit.id] === undefined)
    .filter((unit) => targetsFor(unit.id).some((target) => target.unitId === victimId))
    .map((unit) => unit.id);
}

// Opens a window on everybody the trigger has handed a swing to, and says
// whether it opened one at all — a trigger nobody answers leaves the board
// alone, and the caller carries on as if it had never fired.
//
// Whatever the local player had armed goes: the board is the enemy's from here
// until the last swing has been answered.
function openOpportunities(
  victimId: string,
  kinds: AttackKind[],
  trigger: OpportunityTrigger,
): boolean {
  const attackers = opportunityAttackers(victimId, kinds);
  if (attackers.length === 0) {
    return false;
  }

  cancelActions();
  opportunities.value = attackers.map((attackerId) => ({ attackerId, trigger, victimId }));
  armOpportunity();

  return true;
}

// Arms the swing at the head of the queue on the board, so the enemy holding it
// has an arrow pointing at the unit it may hit and a click to land it with. The
// target list is cut down to that one unit — see `attackTargets`.
function armOpportunity(): void {
  const current = currentOpportunity.value;
  if (current === null) {
    return;
  }

  attackingUnitId.value = current.attackerId;
  hoveredTargetId.value = null;
}

// The enemy holding the swing lets it go. Nothing is struck, and the swing is
// still spent: an Оппортун offered and turned down does not come round again.
function passOpportunity(): void {
  advanceOpportunity();
}

// Drops the swing at the head of the queue, taken or passed, and asks the next
// enemy. The window closes when there is nobody left to ask.
function advanceOpportunity(): void {
  const current = currentOpportunity.value;
  if (current === null) {
    return;
  }

  spentOpportunities.value = { ...spentOpportunities.value, [current.attackerId]: true };

  const rest = opportunities.value.slice(1);
  opportunities.value = rest;

  if (rest.length > 0) {
    armOpportunity();
    return;
  }

  closeOpportunities();
}

// The last swing has been answered, so whatever the window was holding back
// happens now: the step the unit was interrupted on, or the end of its turn.
// A step taken here can provoke a window of its own — a shooter covering the
// hex it lands on — and that one opens on top of this one closing.
function closeOpportunities(): void {
  cancelAttack();

  const held = heldMove.value;
  if (held !== null) {
    heldMove.value = null;
    stepUnit(held.unitId, held.key);
    return;
  }

  if (heldTurnEnd.value) {
    heldTurnEnd.value = false;
    handTurnOn();
  }
}

// Drops every window and everything one was holding back. For a position being
// left behind: the swings belonged to units the next scenario does not have.
function clearOpportunities(): void {
  window.clearTimeout(opportunityTimer);
  opportunities.value = [];
  spentOpportunities.value = {};
  heldMove.value = null;
  heldTurnEnd.value = false;
  movedThisTurn.value = false;
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
  clearOpportunities();

  const { deployment } = selectedScenario.value;
  cellByUnitId.value = openingCells(deployment);
  facingByUnitId.value = openingFacings(deployment);
  statsByUnitId.value = openingStats(deployment);
  movesLeftByUnitId.value = openingMoves(deployment);
  movesTotalByUnitId.value = openingMoves(deployment);
  turnIndex.value = 0;
  roundNumber.value = 1;

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
  if (!takingOrders.value) {
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

// Draws the canopy cone on the board, or takes it off. Not gated on the turn or
// on the side: the cone says where a shot could come down, and that is worth
// reading whoever the shooter is.
function setCanopyCone(shown: boolean): void {
  showCanopyCone.value = shown;
}

// Strikes `targetUnitId`, which has to be one of the units the armed attack
// reaches. A click on anything else is not a blow the unit can land, so it reads
// as calling the attack off — the same bargain a move click makes.
//
// The blow is committed here and lands a moment later: the attacker lunges or
// looses its arrow from the click, and the damage is written when the blow
// arrives, so the bars come down on the impact rather than ahead of it. A lunge
// connects part of the way into its own animation; an arrow connects when it
// finishes crossing the board.
function strikeUnit(targetUnitId: string): void {
  const attackerId = attackingUnitId.value;
  if (attackerId === null) {
    return;
  }

  const target = attackTargets.value.find((entry) => entry.unitId === targetUnitId);
  const attacker = unitsById.value.get(attackerId);
  const from = cellOfUnit(attackerId);
  if (target === undefined || attacker === undefined || from === null) {
    cancelAttack();
    return;
  }

  const strategy = attackStrategyFor(attacker.kind);
  const damage = strategy.damage(statsOf(attackerId), statsOf(targetUnitId));
  const flying = strategy.kind === "canopy";

  // Whether this is the swing an open Оппортун is offering. One is taken out of
  // the unit's own turn and costs it nothing of that turn's allowance — and the
  // window it belongs to moves on once the blow has played out.
  const counter = currentOpportunity.value?.attackerId === attackerId;

  cancelAttack();
  if (!counter) {
    spendMove(attackerId);
  }

  strikeSeq += 1;
  const seq = strikeSeq;
  strike.value = {
    attackerId,
    targetId: targetUnitId,
    kind: strategy.kind,
    fromKey: from,
    toKey: target.key,
    direction: target.direction,
    phase: flying ? "flight" : "impact",
    seq,
  };

  // Timers rather than animation callbacks: the markers are drawn from this
  // state, so this state is what has to say when the blow lands and when the
  // animation is over. A second strike started mid-animation drops the first
  // one's timers and plays out on its own.
  //
  // A shot is the two waits one after the other: the flight, and then the same
  // reaction a lunge ends on, less the wind-up the lunge spends before landing.
  const overMs = flying ? SHOT_MS + PUNCH_MS - PUNCH_IMPACT_MS : PUNCH_MS;

  window.clearTimeout(impactTimer);
  window.clearTimeout(strikeTimer);
  impactTimer = window.setTimeout(
    () => {
      applyDamage(targetUnitId, damage);
      if (flying) {
        landStrike(seq);
      }
    },
    flying ? SHOT_MS : PUNCH_IMPACT_MS,
  );
  strikeTimer = window.setTimeout(() => {
    strike.value = null;
  }, overMs);

  // The next enemy is asked once this blow is off the board, not the moment the
  // click lands: two swings answered back to back would otherwise play over the
  // top of each other.
  //
  // Read against the enemy the wait belongs to. The button under the roster
  // still answers while the blow is in the air, and a press of it moves the
  // queue on by itself — so a timer arriving after that must find its own swing
  // still at the head, or it would take a second one nobody answered.
  if (counter) {
    window.clearTimeout(opportunityTimer);
    opportunityTimer = window.setTimeout(() => {
      if (currentOpportunity.value?.attackerId !== attackerId) {
        return;
      }

      advanceOpportunity();
    }, overMs);
  }
}

// Says the arrow has arrived: it comes off the board, and the unit it came down
// on is thrown and flashed. Read against the sequence number the shot was
// written with, so a shot whose state has been replaced — by the next blow, or
// by a scenario being picked — lands on nothing.
function landStrike(seq: number): void {
  const current = strike.value;
  if (current === null || current.seq !== seq) {
    return;
  }

  strike.value = { ...current, phase: "impact" };
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
  //
  // A swing an Оппортун has armed survives it: that one is not the local
  // player's to call off, and reading a unit's card while the window is open
  // must not take the enemy's blow off the board.
  if (!opportunityOpen.value) {
    cancelActions();
  }

  focusCell(cell);
}

export {
  ACCELERATE_MORALE_COST,
  MOVE_ALLOWANCE,
  PUNCH_IMPACT_MS,
  PUNCH_MS,
  SHOT_MS,
  STEP_MS,
  accelerateUnit,
  activeUnit,
  armedAttack,
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
  canopyConeKeys,
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
  opportunityAttacker,
  opportunityAttackerId,
  opportunityOpen,
  opportunityUnits,
  opportunityVictimId,
  pendingDamage,
  rotateCellKey,
  rotateUnit,
  rotatingUnitId,
  roundBreakOffset,
  roundNumber,
  selectScenario,
  selectUnit,
  selectedAttack,
  selectedUnit,
  setCanopyCone,
  showCanopyCone,
  statsOf,
  strike,
  strikeUnit,
  toggleMove,
  toggleRotate,
  turnQueue,
  unitIdAt,
};
export type { BattleUnit, MoveTarget, Movement, Opportunity, OpportunityTrigger, Strike };
