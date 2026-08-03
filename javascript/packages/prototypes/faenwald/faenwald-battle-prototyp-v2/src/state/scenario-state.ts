import { computed, signal } from "@preact/signals-react";
import type { AvatarCode } from "../units/unit-avatars";
import type { UnitKind, UnitSide, UnitStats } from "./units-state";

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

// A predefined battle: both armies and the hex every unit opens on. The battle
// page takes its starting position from here and from nowhere else, so a new
// position is a new entry in `SCENARIOS` rather than an edit to the page.
type Scenario = {
  id: string;
  name: string;
  // One line under the name in the scenarios drawer: what the position is.
  summary: string;
  deployment: Deployment[];
};

// Blue along the bottom looking up the board, red along the top looking down
// it. Hand-placed, the way the terrain map is, and kept well inside the grid so
// both lines are on screen at the zoom the canvas fits itself to.
const LINE_CLASH: Deployment[] = [
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

// Three pairs already locked together, one pair per column. A melee reaches the
// two hexes the facing lies between, so a unit on row 8 looking up the board and
// one on row 7 looking down it have each other in reach from the first turn:
// nobody has to walk anywhere before the Attack command has something to offer.
//
// The order the round runs in is initiative, and the first unit to move is the
// blue light infantryman — the local player is handed a unit that can strike
// where it stands rather than an enemy turn to skip through.
const MELEE_LOCK: Deployment[] = [
  {
    col: 3,
    row: 7,
    facing: 180,
    unit: {
      id: "red-sko",
      title: "Средний копейщик",
      code: "СКо",
      kind: "spear",
      side: "red",
      initiative: 88,
      stats: { health: 70, attack: 16, morale: 70 },
    },
  },
  {
    col: 6,
    row: 7,
    facing: 180,
    unit: {
      id: "red-tpo",
      title: "Тяжёлый пехотинец",
      code: "ТПо",
      kind: "sword",
      side: "red",
      initiative: 65,
      stats: { health: 95, attack: 26, morale: 80 },
    },
  },
  {
    col: 9,
    row: 7,
    facing: 180,
    unit: {
      id: "red-lko",
      title: "Лёгкий копейщик",
      code: "ЛКо",
      kind: "spear",
      side: "red",
      initiative: 82,
      stats: { health: 50, attack: 12, morale: 65 },
    },
  },
  {
    col: 3,
    row: 8,
    facing: 0,
    unit: {
      id: "blue-lpo",
      title: "Лёгкий пехотинец",
      code: "ЛПо",
      kind: "sword",
      side: "blue",
      initiative: 95,
      stats: { health: 55, attack: 18, morale: 60 },
    },
  },
  {
    col: 6,
    row: 8,
    facing: 0,
    unit: {
      id: "blue-spo",
      title: "Средний пехотинец",
      code: "СПо",
      kind: "sword",
      side: "blue",
      initiative: 78,
      stats: { health: 70, attack: 24, morale: 70 },
    },
  },
  {
    col: 9,
    row: 8,
    facing: 0,
    unit: {
      id: "blue-tko",
      title: "Тяжёлый копейщик",
      code: "ТКо",
      kind: "spear",
      side: "blue",
      initiative: 58,
      stats: { health: 90, attack: 20, morale: 75 },
    },
  },
];

const SCENARIOS: Scenario[] = [
  {
    id: "line-clash",
    name: "Встречный бой",
    summary: "Две линии в чистом поле: четыре отряда синих против трёх красных.",
    deployment: LINE_CLASH,
  },
  {
    id: "melee-lock",
    name: "Сшибка",
    summary: "Три пары уже сошлись вплотную: каждый отряд бьёт в ближнем бою, не сходя с места.",
    deployment: MELEE_LOCK,
  },
];

// The scenario the battle is fought on. A signal already, so the drawer reads
// the name from one place — but the army below it is built once, at import, so
// writing a new id here does not yet re-deploy the board.
const selectedScenarioId = signal<string>(SCENARIOS[0].id);

const selectedScenario = computed<Scenario>(
  () => SCENARIOS.find((scenario) => scenario.id === selectedScenarioId.value) ?? SCENARIOS[0],
);

export { SCENARIOS, selectedScenario, selectedScenarioId };
export type { BattleUnit, Deployment, Scenario };
