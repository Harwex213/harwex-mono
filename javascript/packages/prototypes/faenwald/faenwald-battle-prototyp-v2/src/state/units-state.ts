import { signal } from "@preact/signals-react";
import { cellKey } from "../hex/hex-layout";

type UnitKind = "spear" | "sword" | "bow";

type UnitSide = "red" | "blue";

type UnitStats = {
  health: number;
  attack: number;
  morale: number;
};

type Unit = {
  id: string;
  cellKey: string;
  kind: UnitKind;
  side: UnitSide;
  // Short code from the roster — `ТКо` for тяжелый копейщик, `Луч` for лучник,
  // and so on. Shown on the marker itself and on the first row of the info
  // panel. A roster keeps the full title alongside its code and passes only the
  // code through to here.
  name: string;
  // Clockwise degrees the glyph is turned by, on top of the upright pose the
  // icon itself defines. One hex neighbour is 60 degrees away. Absent means
  // upright.
  facing?: number;
  stats: UnitStats;
};

// A step being played out. The unit already stands on the hex it has arrived
// at, so what the layer needs is the hex it left: the marker is opened there and
// slid home. Written by whichever page moved the unit and cleared once the
// animation it drives is over.
type Movement = {
  unitId: string;
  fromKey: string;
  // Bumped per step, so a unit that walks two hexes in a row plays the
  // animation twice — same class, same element, and CSS would run it once.
  seq: number;
};

const FACINGS = [0, 60, 120, 180, 240, 300];

// The first column each row of facings starts on.
const ROTATION_ROW_COL = 4;

// One row per kind, one unit per hex facing, so the six rotations of a glyph
// can be read off against each other. A signal, so a later step can move them
// without touching the layer.
const units = signal<Unit[]>([
  ...rotationRow(5, {
    kind: "spear",
    side: "red",
    name: "ТКо",
    stats: { health: 80, attack: 12, morale: 70 },
  }),
  ...rotationRow(7, {
    kind: "sword",
    side: "blue",
    name: "СПо",
    stats: { health: 65, attack: 22, morale: 80 },
  }),
  ...rotationRow(9, {
    kind: "bow",
    side: "red",
    name: "Луч",
    stats: { health: 55, attack: 18, morale: 60 },
  }),
]);

function rotationRow(row: number, unit: Omit<Unit, "id" | "cellKey" | "facing">): Unit[] {
  return FACINGS.map((facing, index) => ({
    ...unit,
    id: `${unit.kind}-${facing}`,
    cellKey: cellKey(ROTATION_ROW_COL + index, row),
    facing,
  }));
}

function unitAt(key: string): Unit | null {
  return units.value.find((unit) => unit.cellKey === key) ?? null;
}

export { unitAt, units };
export type { Movement, Unit, UnitKind, UnitSide, UnitStats };
