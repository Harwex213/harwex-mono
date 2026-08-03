import { cellKey, frontDirections, neighborCell } from "../hex/hex-layout";
import type { UnitKind, UnitSide, UnitStats } from "./units-state";

// The kinds of attack a unit can make. Melee is the only one the prototype
// answers. Everything below is shaped around that list rather than around melee
// itself, so a ranged attack or a charge is a new strategy in the table at the
// bottom of this file and no edit anywhere else.
type AttackKind = "melee";

// A unit an armed attack may land on, and the direction it lies in from the
// attacker — the layer points an arrow that way.
type AttackTarget = {
  unitId: string;
  key: string;
  direction: number;
};

// What one blow takes off the defender.
type AttackDamage = {
  health: number;
  morale: number;
};

// What a strategy may ask about the board while it works out its reach. Handed
// in rather than imported, so a strategy knows nothing about the page it is used
// on and can be tried against a position written out by hand.
type AttackBoard = {
  // Where the attacker stands, and which way it looks.
  col: number;
  row: number;
  facing: number;
  side: UnitSide;
  // The unit standing on a hex. Null for an empty hex, and for a hex the board
  // does not have — nobody stands off the board.
  unitIdAt: (key: string) => string | null;
  sideOf: (unitId: string) => UnitSide | null;
};

type AttackStrategy = {
  kind: AttackKind;
  // Named on the command button, so the panel says which attack is on offer.
  label: string;
  // Everyone the attacker could hit from where it stands. An empty list is an
  // attack with nobody in reach, and the command that stands for it goes quiet.
  targets: (board: AttackBoard) => AttackTarget[];
  damage: (attacker: UnitStats, defender: UnitStats) => AttackDamage;
};

// A blow to the body and a blow to the will. A hit takes the attacker's whole
// attack off health, and this much of it off morale.
const MELEE_MORALE_SHARE = 0.5;

// The reach of a weapon swung by hand: the two hexes the unit is already
// looking at. A facing points at a corner rather than at a neighbour, so those
// are the two hexes the facing lies between — the same pair a step forward may
// go to.
const melee: AttackStrategy = {
  kind: "melee",
  label: "Melee",

  targets(board) {
    const targets: AttackTarget[] = [];

    for (const direction of frontDirections(board.facing)) {
      const step = neighborCell(board.col, board.row, direction);
      if (step === null) {
        continue;
      }

      const key = cellKey(step.col, step.row);
      const unitId = board.unitIdAt(key);
      if (unitId === null) {
        continue;
      }

      // An own unit in front is a neighbour, not a target.
      if (board.sideOf(unitId) === board.side) {
        continue;
      }

      targets.push({ unitId, key, direction });
    }

    return targets;
  },

  damage(attacker) {
    return {
      health: attacker.attack,
      morale: Math.round(attacker.attack * MELEE_MORALE_SHARE),
    };
  },
};

const ATTACK_STRATEGIES: Record<AttackKind, AttackStrategy> = { melee };

// Which attack each kind of unit makes. Everything on the board fights hand to
// hand for now — an archer keeps a melee attack until there is a ranged
// strategy to give it.
const ATTACK_KIND_BY_UNIT_KIND: Record<UnitKind, AttackKind> = {
  spear: "melee",
  sword: "melee",
  bow: "melee",
};

function attackStrategyFor(kind: UnitKind): AttackStrategy {
  return ATTACK_STRATEGIES[ATTACK_KIND_BY_UNIT_KIND[kind]];
}

export { ATTACK_STRATEGIES, attackStrategyFor };
export type { AttackBoard, AttackDamage, AttackKind, AttackStrategy, AttackTarget };
