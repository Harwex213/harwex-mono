import { signal } from "@preact/signals-react";
import { cellKey } from "../hex/hex-layout";

type UnitKind = "spear" | "sword";

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
  // Short code, shown on the first row of the info panel. A roster keeps the
  // full title alongside its code and passes only the code through to here.
  name: string;
  stats: UnitStats;
};

// Two hand-placed units on plain hexes near the middle of the grid, on
// neighbouring cells so they face each other. A signal, so a later step can
// move them without touching the layer.
const units = signal<Unit[]>([
  {
    id: "spearman",
    cellKey: cellKey(6, 7),
    kind: "spear",
    side: "red",
    name: "ТКО",
    stats: { health: 80, attack: 12, morale: 70 },
  },
  {
    id: "swordsman",
    cellKey: cellKey(7, 8),
    kind: "sword",
    side: "blue",
    name: "МЧН",
    stats: { health: 65, attack: 22, morale: 80 },
  },
]);

function unitAt(key: string): Unit | null {
  return units.value.find((unit) => unit.cellKey === key) ?? null;
}

export { unitAt, units };
export type { Unit, UnitKind, UnitSide, UnitStats };
