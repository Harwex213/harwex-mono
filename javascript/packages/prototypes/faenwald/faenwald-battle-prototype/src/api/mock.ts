/**
 * API layer — mock transport.
 *
 * Installs an adapter that resolves a small route table with canned data after
 * a simulated network delay, instead of hitting a real server. Swap it in at
 * startup with `installMockAdapter()`; remove that call to talk to a live API.
 *
 * It serves a handful of **preset scenarios** (showcase item 25), each a
 * hand-authored hex map plus unit placement built to put one cluster of GDD
 * mechanics on screen: the full Battle of Faenwald (terrain variety + the rank →
 * count → degradation scaling of §3), the §9.9 hill-charge worked example
 * (elevation × cavalry charge × close-formation reflection) and a ranged duel
 * (firing modes, ammo, line-of-fire blocking and terrain ranged reduction).
 *
 * Scenarios are authored in **grid space** (`col`/`row`) so placements read off
 * the rectangle directly; {@link toAxial} applies the per-row shift that turns
 * the offset grid into axial coordinates the engine consumes.
 */

import { setAdapter, type ApiResponse, type RequestConfig } from './request';
import type {
  BattleDTO,
  Elevation,
  HexDTO,
  HexState,
  ScenarioSummary,
  TerrainType,
  UnitDTO,
} from './types';

const MOCK_LATENCY_MS = 250;

/** A terrain feature placed at a column/row in the rectangular grid. */
interface Feature {
  terrain: TerrainType;
  elevation?: Elevation;
  state?: HexState;
}

/** A unit placement authored in grid space (`col`/`row` before the axial shift). */
interface PlacedUnit extends Omit<UnitDTO, 'q' | 'r'> {
  col: number;
  row: number;
}

/** A self-contained preset battle: its summary plus the data to build a {@link BattleDTO}. */
interface Scenario {
  summary: ScenarioSummary;
  width: number;
  height: number;
  /** Feature overrides keyed by `"col,row"`; every other tile defaults to plain. */
  features: Record<string, Feature>;
  units: PlacedUnit[];
}

/** Shift a grid `col`/`row` into axial `q`/`r` so the grid reads as a rectangle. */
function toAxial(col: number, row: number): { q: number; r: number } {
  return { q: col - Math.floor(row / 2), r: row };
}

/** Build the rectangular map, applying `features` over a plain base. */
function buildHexes(width: number, height: number, features: Record<string, Feature>): HexDTO[] {
  const hexes: HexDTO[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const feature = features[`${col},${row}`];
      const { q, r } = toAxial(col, row);
      hexes.push({
        q,
        r,
        terrain: feature?.terrain ?? 'plain',
        ...(feature?.elevation !== undefined ? { elevation: feature.elevation } : {}),
        ...(feature?.state ? { state: feature.state } : {}),
      });
    }
  }
  return hexes;
}

/** Resolve a scenario's authored data into the transport {@link BattleDTO}. */
function buildBattle(scenario: Scenario): BattleDTO {
  return {
    id: scenario.summary.id,
    name: scenario.summary.name,
    hexes: buildHexes(scenario.width, scenario.height, scenario.features),
    units: scenario.units.map(({ col, row, ...rest }) => ({ ...rest, ...toAxial(col, row) })),
  };
}

// ── Scenario 1: The Battle of Faenwald ──────────────────────────────────────
// The original showcase — a 9×7 map with the full terrain set and six units of
// differing category, rank and count, so every phase-1 system is exercised.

const faenwald: Scenario = {
  summary: {
    id: 'faenwald',
    name: 'The Battle of Faenwald',
    mechanic: 'The grand showcase — full terrain set, mixed ranks & counts, both rulers afield.',
  },
  width: 9,
  height: 7,
  features: {
    // Hill shoulder, top-right.
    '6,1': { terrain: 'foothill' },
    '7,1': { terrain: 'hill' },
    '8,1': { terrain: 'foothill' },
    '7,2': { terrain: 'foothill' },
    // Forest and brush, left-centre.
    '1,3': { terrain: 'forest' },
    '2,3': { terrain: 'forest' },
    '1,4': { terrain: 'forest' },
    '2,2': { terrain: 'brush' },
    // Road across the middle.
    '3,3': { terrain: 'road' },
    '4,3': { terrain: 'road' },
    '5,3': { terrain: 'road' },
    // Muddy ford just south of the road.
    '3,4': { terrain: 'plain', state: 'mud' },
    '4,4': { terrain: 'plain', state: 'mud' },
    // Settlement and bog.
    '4,2': { terrain: 'settlement' },
    '5,5': { terrain: 'bog' },
    // Mountain (impassable, blocks line of fire) and a small lake.
    '7,5': { terrain: 'mountain' },
    '1,6': { terrain: 'water' },
    '2,6': { terrain: 'water' },
  },
  units: [
    // Blue advances from the south (facing 1 = NE/NW front, i.e. "up").
    { id: 'b1', defId: 'cavalry.heavy', side: 'blue', rank: 5, count: 100, col: 2, row: 5, facing: 1, name: 'Royal Lancers', isRuler: true },
    { id: 'b2', defId: 'spear.heavy', side: 'blue', rank: 3, count: 100, col: 4, row: 6, facing: 1, name: 'Ironwall Phalanx', hp: 80 },
    { id: 'b3', defId: 'ranged.archer', side: 'blue', rank: 2, count: 60, col: 6, row: 6, facing: 1, name: 'Greenwood Bows' },
    // Red holds the north (facing 4 = SW/SE front, i.e. "down").
    { id: 'r1', defId: 'shock.heavy', side: 'red', rank: 5, count: 100, col: 6, row: 1, facing: 4, name: 'Dread Vanguard', isRuler: true },
    { id: 'r2', defId: 'cavalry.medium', side: 'red', rank: 3, count: 80, col: 3, row: 1, facing: 4, name: 'Border Riders' },
    { id: 'r3', defId: 'ranged.crossbow', side: 'red', rank: 2, count: 100, col: 2, row: 0, facing: 4, name: 'Tower Arbalests' },
  ],
};

// ── Scenario 2: Hill charge (§9.9 worked example) ───────────────────────────
// Heavy spearmen in close formation on a hill (each interior unit's E/W flanks
// are covered by an allied spearman facing the same way → ×0.6 shielding) face a
// cavalry assault charging uphill from the foothills below. Demonstrates the
// elevation matchup, the cavalry charge run and Close-Formation charge reflection
// (§5.1.4) — the cavalry's own charge bounced back into it.

const hillCharge: Scenario = {
  summary: {
    id: 'hill-charge',
    name: 'The Hill at Faenwald (§9.9)',
    mechanic: 'Elevation × cavalry charge × close-formation reflection — the GDD worked example.',
  },
  width: 7,
  height: 6,
  features: {
    // Hill crown the spearmen hold; foothill shoulders to either side.
    '1,1': { terrain: 'foothill' },
    '2,1': { terrain: 'hill' },
    '3,1': { terrain: 'hill' },
    '4,1': { terrain: 'hill' },
    '5,1': { terrain: 'foothill' },
    // Foothill apron the charge climbs over.
    '2,2': { terrain: 'foothill' },
    '3,2': { terrain: 'foothill' },
    '4,2': { terrain: 'foothill' },
  },
  units: [
    // Red shield wall along the crest, all facing 4 ("down") — the middle unit's
    // E and W flanks are both covered → both-flanks ×0.6 close formation.
    { id: 'r1', defId: 'spear.heavy', side: 'red', rank: 4, count: 100, col: 2, row: 1, facing: 4, name: 'Left Wardens' },
    { id: 'r2', defId: 'spear.heavy', side: 'red', rank: 4, count: 100, col: 3, row: 1, facing: 4, name: 'Crownguard', isRuler: true },
    { id: 'r3', defId: 'spear.heavy', side: 'red', rank: 4, count: 100, col: 4, row: 1, facing: 4, name: 'Right Wardens' },
    // Blue cavalry assault from the plain, facing 1 ("up") to charge the crest.
    { id: 'b1', defId: 'cavalry.heavy', side: 'blue', rank: 5, count: 100, col: 5, row: 4, facing: 1, name: 'Royal Lancers', isRuler: true },
    { id: 'b2', defId: 'cavalry.medium', side: 'blue', rank: 4, count: 100, col: 3, row: 4, facing: 1, name: 'Border Riders' },
    { id: 'b3', defId: 'cavalry.light', side: 'blue', rank: 3, count: 100, col: 1, row: 4, facing: 1, name: 'Outriders' },
  ],
};

// ── Scenario 3: The arrow storm (line of fire & ammo) ───────────────────────
// A ranged duel across a mountain spur that blocks line of fire, with a forest,
// brush margin and a settlement that bends what each shooter can hit. Shows the
// three firing modes, the 8-shot ammo budget, crossbow reload cadence and the
// forest/brush ranged-damage reduction.

const arrowStorm: Scenario = {
  summary: {
    id: 'arrow-storm',
    name: 'The Arrow Storm',
    mechanic: 'Ranged modes, ammo & line of fire — a mountain spur splits the field.',
  },
  width: 9,
  height: 6,
  features: {
    // Central mountain spur (impassable, blocks line of fire) with a hill perch.
    '4,2': { terrain: 'mountain' },
    '4,3': { terrain: 'mountain' },
    '5,2': { terrain: 'hill' },
    // Forest and brush soften arrows on the left flank.
    '1,2': { terrain: 'forest' },
    '2,2': { terrain: 'forest' },
    '1,3': { terrain: 'brush' },
    // A settlement on the right — no arcing fire may target it.
    '7,3': { terrain: 'settlement' },
  },
  units: [
    // Blue shooters and a spear escort advance from the south.
    { id: 'b1', defId: 'ranged.archer', side: 'blue', rank: 4, count: 100, col: 2, row: 5, facing: 1, name: 'Greenwood Bows' },
    { id: 'b2', defId: 'ranged.crossbow', side: 'blue', rank: 3, count: 100, col: 6, row: 5, facing: 1, name: 'Vale Arbalests' },
    { id: 'b3', defId: 'spear.medium', side: 'blue', rank: 4, count: 100, col: 4, row: 5, facing: 1, name: 'Shield Escort', isRuler: true },
    // Red shooters and light cavalry hold the north.
    { id: 'r1', defId: 'ranged.archer', side: 'red', rank: 4, count: 100, col: 2, row: 1, facing: 4, name: 'Black Fletchers' },
    { id: 'r2', defId: 'ranged.horseArcher', side: 'red', rank: 3, count: 100, col: 7, row: 1, facing: 4, name: 'Steppe Riders' },
    { id: 'r3', defId: 'cavalry.light', side: 'red', rank: 4, count: 100, col: 5, row: 0, facing: 4, name: 'Raiders', isRuler: true },
  ],
};

const SCENARIOS: Scenario[] = [faenwald, hillCharge, arrowStorm];

type Route = () => unknown;

/**
 * The route table: `GET /scenarios` lists the presets, `GET /battle` serves the
 * default (first) one, and `GET /battle/<id>` serves a specific preset (item 25).
 */
const routes: Record<string, Route> = {
  'GET /scenarios': () => SCENARIOS.map((scenario): ScenarioSummary => scenario.summary),
  'GET /battle': () => buildBattle(SCENARIOS[0]),
};

for (const scenario of SCENARIOS) {
  routes[`GET /battle/${scenario.summary.id}`] = () => buildBattle(scenario);
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const installMockAdapter = (): void => {
  setAdapter(async (config: RequestConfig): Promise<ApiResponse> => {
    await delay(MOCK_LATENCY_MS);

    const route = routes[`${config.method} ${config.url}`];
    if (!route) {
      throw new Error(`No mock route for ${config.method} ${config.url}`);
    }

    return {
      data: route(),
      status: 200,
      config,
    };
  });
};
