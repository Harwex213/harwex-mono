import {
  bearingBetween,
  cellKey,
  forwardCone,
  frontDirections,
  neighborCell,
  type ConeCell,
} from "../hex/hex-layout";
import type { UnitKind, UnitSide, UnitStats } from "./units-state";

// The kinds of attack a unit can make: a weapon swung by hand, and a volley
// lobbed over the heads in front of the shooter. Everything below is shaped
// around this list rather than around one attack, so a charge is a new strategy
// in the table at the bottom of this file and no edit anywhere else.
type AttackKind = "melee" | "canopy";

// A unit an armed attack may land on, and the direction it lies in from the
// attacker — the layer points an arrow that way, and a blow throws its target
// that way. Clockwise degrees from straight up, so a neighbour and a hex four
// steps up the board are read the same way.
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
  label: "Attack",

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

// How deep the canopy cone runs. A shot is lobbed rather than aimed, so its
// reach is the wedge in front of the shooter out to this many steps: two hexes
// at the first step, three at the second, and so on to five at the fourth —
// fourteen hexes in all.
const CANOPY_RANGE = 4;

// What a volley takes off the defender, as shares of the shooter's attack. A
// lobbed shot is aimed at a hex rather than at a man, so it draws less blood
// than a blow landed by hand — and arrows falling out of the sky tell on a
// unit's will more than on its body, which is what the second share says.
const CANOPY_HEALTH_SHARE = 0.6;

const CANOPY_MORALE_SHARE = 0.9;

// The reach of a volley shot over the heads in front of the shooter: the cone
// the unit is facing, `CANOPY_RANGE` steps deep. Nothing blocks it. That is the
// whole point of shooting over a canopy rather than through it — an own unit
// standing in the way is shot over, not shot at, and the hexes behind it are as
// open as the ones beside it.
const canopy: AttackStrategy = {
  kind: "canopy",
  label: "Canopy",

  targets(board) {
    const targets: AttackTarget[] = [];

    for (const cell of canopyCone(board.col, board.row, board.facing)) {
      const key = cellKey(cell.col, cell.row);
      const unitId = board.unitIdAt(key);
      if (unitId === null) {
        continue;
      }

      // An own unit under the arc is one of the heads the volley goes over.
      if (board.sideOf(unitId) === board.side) {
        continue;
      }

      targets.push({
        unitId,
        key,
        direction: bearingBetween(board.col, board.row, cell.col, cell.row),
      });
    }

    return targets;
  },

  damage(attacker) {
    return {
      health: Math.round(attacker.attack * CANOPY_HEALTH_SHARE),
      morale: Math.round(attacker.attack * CANOPY_MORALE_SHARE),
    };
  },
};

// Every hex a canopy shot could come down on. The strategy above reads its
// targets off this, and the board draws the same hexes when the cone is switched
// on — so what the player is shown and what the attack answers for are one list.
function canopyCone(col: number, row: number, facing: number): ConeCell[] {
  return forwardCone(col, row, facing, CANOPY_RANGE);
}

const ATTACK_STRATEGIES: Record<AttackKind, AttackStrategy> = { canopy, melee };

// Which attack each kind of unit makes. A bow shoots and nothing else: the two
// hexes a melee would reach are the first step of its cone, so a shooter with
// an enemy against it is still answered for.
const ATTACK_KIND_BY_UNIT_KIND: Record<UnitKind, AttackKind> = {
  spear: "melee",
  sword: "melee",
  bow: "canopy",
};

function attackStrategyFor(kind: UnitKind): AttackStrategy {
  return ATTACK_STRATEGIES[ATTACK_KIND_BY_UNIT_KIND[kind]];
}

export { ATTACK_STRATEGIES, CANOPY_RANGE, attackStrategyFor, canopyCone };
export type { AttackBoard, AttackDamage, AttackKind, AttackStrategy, AttackTarget };
