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

// Every kind of shooter the roster has, laid out for a ranged attack to be
// tried against. Blue holds the bottom of the board and looks up it; the red
// units it is pointed at are targets, not an army meant to fight back.
//
// A unit shoots along the seam its facing points at, and that seam zig-zags
// between two columns in offset coordinates. So the lane in front of a blue
// unit on row 10 runs up through the column to its left and back again:
// `(5, 10)` looks up `(4, 9)`, `(5, 8)`, `(4, 7)`, and on. Every red unit below
// stands on such a lane, at a distance written out beside it — a ranged strategy
// is then read off the board rather than counted out on it.
//
// Three things a shot has to answer are already on the board:
//
// - A ladder of distances up the archer's lane: 2, 4 and 6 hexes from `(5, 10)`.
//   A short bow reaches the first rung, a long one all three.
// - A friendly unit in the line of fire. The heavy infantryman on `(6, 9)`
//   stands in the crossbowman's front hex, so the lane behind that hex is only
//   open if a shot may pass over an own unit's head.
// - Red shooters of their own, on the lanes blue's right flank is pointed at, so
//   a return shot has somewhere to come from once the enemy is driven.
//
// Rows 4 to 10 are the band the whole position is laid out in, the same band the
// two scenarios above use. The canvas fits the grid by width and opens on a view
// that is shorter than the grid is tall, so a unit outside that band has to be
// panned to before it can be seen.
//
// The whole of the blue army moves before the whole of the red one: no enemy
// turn has to be skipped through between two shots being tried.
const RANGED_TEST: Deployment[] = [
  {
    col: 3,
    row: 10,
    facing: 0,
    unit: {
      id: "blue-kluch",
      title: "Конный лучник",
      code: "КЛуч",
      kind: "bow",
      side: "blue",
      initiative: 96,
      stats: { health: 55, attack: 16, morale: 70 },
    },
  },
  {
    col: 5,
    row: 10,
    facing: 0,
    unit: {
      id: "blue-luch",
      title: "Лучник",
      code: "Луч",
      kind: "bow",
      side: "blue",
      initiative: 92,
      stats: { health: 45, attack: 14, morale: 55 },
    },
  },
  {
    col: 7,
    row: 10,
    facing: 0,
    unit: {
      id: "blue-arb",
      title: "Арбалетчик",
      code: "Арб",
      kind: "bow",
      side: "blue",
      initiative: 88,
      stats: { health: 50, attack: 26, morale: 60 },
    },
  },
  {
    col: 9,
    row: 10,
    facing: 0,
    unit: {
      id: "blue-long",
      title: "Лонгбоумен",
      code: "Лонг",
      kind: "bow",
      side: "blue",
      initiative: 84,
      stats: { health: 50, attack: 22, morale: 70 },
    },
  },
  {
    col: 6,
    row: 9,
    facing: 0,
    unit: {
      id: "blue-tpo",
      title: "Тяжёлый пехотинец",
      code: "ТПо",
      kind: "sword",
      side: "blue",
      initiative: 80,
      stats: { health: 95, attack: 26, morale: 80 },
    },
  },
  // Two hexes up the archer's lane: the near rung of the ladder, and the one
  // target a bow of any reach at all can be pointed at.
  {
    col: 5,
    row: 8,
    facing: 180,
    unit: {
      id: "red-lpo",
      title: "Лёгкий пехотинец",
      code: "ЛПо",
      kind: "sword",
      side: "red",
      initiative: 60,
      stats: { health: 55, attack: 18, morale: 60 },
    },
  },
  // Four hexes up the same lane: the middle rung.
  {
    col: 5,
    row: 6,
    facing: 180,
    unit: {
      id: "red-sko",
      title: "Средний копейщик",
      code: "СКо",
      kind: "spear",
      side: "red",
      initiative: 56,
      stats: { health: 70, attack: 16, morale: 70 },
    },
  },
  // Six hexes up it: the far rung, and the top of the band the position fits in.
  // A short bow is out of range of this one, which is the point of it.
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
      initiative: 52,
      stats: { health: 90, attack: 20, morale: 75 },
    },
  },
  // Four hexes up the crossbowman's lane — the lane its own escort stands in.
  {
    col: 7,
    row: 6,
    facing: 180,
    unit: {
      id: "red-luch",
      title: "Лучник",
      code: "Луч",
      kind: "bow",
      side: "red",
      initiative: 48,
      stats: { health: 45, attack: 14, morale: 55 },
    },
  },
  // Six hexes up the longbowman's lane: the second shooter red can answer with,
  // and the farthest target the right flank is pointed at.
  {
    col: 9,
    row: 4,
    facing: 180,
    unit: {
      id: "red-arb",
      title: "Арбалетчик",
      code: "Арб",
      kind: "bow",
      side: "red",
      initiative: 44,
      stats: { health: 50, attack: 26, morale: 60 },
    },
  },
];

// Two walls of spears, laid out for Сомкнутый Строй to be read off the board. A
// formation is two spearmen of one army standing on each other's flank hex and
// looking the same way, so the position holds one of each case the rule has to
// answer:
//
// - Blue holds a run of three spearmen on row 9, all looking up the board. The
//   two edges inside that run carry a chain, and the middle unit is in formation
//   on both sides at once.
// - A light infantryman closes the blue line on `(7, 9)`. It stands where a
//   fourth spearman would, and no chain is drawn to it: the modifier belongs to
//   spearmen and to nobody else.
// - Red answers with two spearmen on `(4, 8)` and `(5, 8)`, so a formation is on
//   the board for both armies.
// - The red spearman on `(6, 8)` stands beside `(5, 8)` but looks off to one
//   side. The two are neighbours and both spearmen, and they hold no formation —
//   which is the one case the facing decides on its own. Turning it back to 180
//   closes the line, and the chain appears.
//
// The two lines are on adjacent rows, so a melee reaches across from the first
// turn: a formation can be broken by the units holding it being made to move.
// Blue moves first — the light spearman on `(6, 9)` has the highest initiative.
const SPEAR_WALL: Deployment[] = [
  {
    col: 4,
    row: 8,
    facing: 180,
    unit: {
      id: "red-sko",
      title: "Средний копейщик",
      code: "СКо",
      kind: "spear",
      side: "red",
      initiative: 66,
      stats: { health: 70, attack: 16, morale: 70 },
    },
  },
  {
    col: 5,
    row: 8,
    facing: 180,
    unit: {
      id: "red-tko",
      title: "Тяжёлый копейщик",
      code: "ТКо",
      kind: "spear",
      side: "red",
      initiative: 54,
      stats: { health: 90, attack: 20, morale: 75 },
    },
  },
  // Beside the heavy spearman, looking away down the board's left flank. No
  // formation, on either unit, until somebody turns it.
  {
    col: 6,
    row: 8,
    facing: 120,
    unit: {
      id: "red-lko",
      title: "Лёгкий копейщик",
      code: "ЛКо",
      kind: "spear",
      side: "red",
      initiative: 72,
      stats: { health: 50, attack: 12, morale: 65 },
    },
  },
  {
    col: 8,
    row: 8,
    facing: 180,
    unit: {
      id: "red-tpo",
      title: "Тяжёлый пехотинец",
      code: "ТПо",
      kind: "sword",
      side: "red",
      initiative: 62,
      stats: { health: 95, attack: 26, morale: 80 },
    },
  },
  {
    col: 4,
    row: 9,
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
  // The middle of the blue run: in formation with the unit on either side of it.
  {
    col: 5,
    row: 9,
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
    col: 6,
    row: 9,
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
  // On the end of the blue line, and not a spearman: the line closes here as far
  // as the formation is concerned.
  {
    col: 7,
    row: 9,
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
  {
    id: "ranged-test",
    name: "Перестрелка",
    summary: "Стрелки всех видов и цели в двух, четырёх и шести гексах: расстановка под проверку дальнего боя.",
    deployment: RANGED_TEST,
  },
  {
    id: "spear-wall",
    name: "Стена копий",
    summary: "Копейщики плечом к плечу: расстановка под проверку сомкнутого строя.",
    deployment: SPEAR_WALL,
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
