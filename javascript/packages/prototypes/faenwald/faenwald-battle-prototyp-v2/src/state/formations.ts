import { cellKey, flankDirections, neighborCell } from "../hex/hex-layout";
import type { UnitKind, UnitSide } from "./units-state";

// Something a unit carries because of where it stands rather than because of
// what it is: it is gained and lost as the board moves around the unit, and
// nothing about the unit itself changes with it. The panels draw one chip per
// modifier, and `sign` is what colours the chip.
type UnitModifier = {
  id: string;
  // What the panels call it.
  label: string;
  // The glyph in front of that label, and the same shape the board draws the
  // modifier with — so the chip and the cue on the hexes read as one thing.
  icon: string;
  // One line of why the unit has it, shown on hover.
  hint: string;
  sign: "positive" | "negative";
};

const CLOSED_FORMATION: UnitModifier = {
  id: "closed-formation",
  label: "Сомкнутый Строй",
  icon: "⛓",
  hint: "Рядом, в одну линию, стоит другой отряд копейщиков.",
  sign: "positive",
};

// A unit as the formation rules read it: what it is, where it stands, which side
// it fights for and which way it looks. Who owns those four things is the
// caller's business — the battle keeps them in signals and hands this module a
// plain list, the way the attack strategies are handed a lookup.
type FormationUnit = {
  id: string;
  col: number;
  row: number;
  kind: UnitKind;
  side: UnitSide;
  facing: number;
};

// Two spearmen holding a closed formation, and the hex edge running between
// them. The board draws a chain along that edge, so the pair is answered with
// the hex the edge is measured from and the direction the other unit lies in.
type FormationLink = {
  // One key per edge. The pair is met twice, once from each of the two units,
  // and both times it comes out as the same key — which is what keeps the edge
  // down to one chain.
  key: string;
  col: number;
  row: number;
  direction: number;
};

type Formation = {
  links: FormationLink[];
  // Everybody holding a formation, so a panel can ask about one unit without
  // walking the links.
  unitIds: Set<string>;
};

// Which spearmen stand shoulder to shoulder. A closed formation is two units
// that are both spearmen, both of the same army, both looking the same way, and
// standing on each other's flank hex — the pair beside a unit rather than the
// pair in front of it.
//
// Every one of those conditions is symmetric, so the two units always agree
// about the formation they hold: neither one can carry the modifier while the
// other does not, and neither side of the shared edge can want a chain the other
// side does not.
function closedFormation(units: FormationUnit[]): Formation {
  const spearmen = units.filter((unit) => unit.kind === "spear");
  const byCell = new Map(spearmen.map((unit) => [cellKey(unit.col, unit.row), unit]));
  const links = new Map<string, FormationLink>();
  const unitIds = new Set<string>();

  for (const unit of spearmen) {
    for (const direction of flankDirections(unit.facing)) {
      const beside = neighborCell(unit.col, unit.row, direction);
      if (beside === null) {
        continue;
      }

      const neighbor = byCell.get(cellKey(beside.col, beside.row));
      if (neighbor === undefined) {
        continue;
      }

      if (neighbor.side !== unit.side || neighbor.facing !== unit.facing) {
        continue;
      }

      unitIds.add(unit.id);
      unitIds.add(neighbor.id);

      // The two hexes in a fixed order, so the edge is the same key whichever of
      // the two units it is read from.
      const key = [cellKey(unit.col, unit.row), cellKey(beside.col, beside.row)].sort().join("|");
      if (links.has(key)) {
        continue;
      }

      links.set(key, { key, col: unit.col, row: unit.row, direction });
    }
  }

  return { links: [...links.values()], unitIds };
}

export { CLOSED_FORMATION, closedFormation };
export type { Formation, FormationLink, FormationUnit, UnitModifier };
