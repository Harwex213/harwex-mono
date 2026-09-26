import { BIOMES } from "./biomes";
import { buildingsForBiome } from "./buildings";
import { hexArea, hexId, hexNeighbors } from "./hex";
import { createRng, hashSeed, pick, pickWeighted, randomInt } from "./rng";
import { addResources, STARTING_POOL } from "./resources";
import type { TRng } from "./rng";
import type { TBiomeId, THex, TIsland, TPlayer } from "./types";

/**
 * Islands are grown, not authored. A flying island is a blob of hexes around
 * the origin; biomes grow in clusters so the map reads as terrain instead of
 * confetti.
 */

const ISLAND_RADIUS = 3;
/** Hexes on the last ring are dropped this often, which frays the silhouette. */
const RIM_DROP_CHANCE = 0.45;
/** How much an already placed neighbour pulls the next hex to the same biome. */
const NEIGHBOR_BIAS = 2.6;

/** How common each biome is before neighbours are taken into account. */
const BIOME_WEIGHTS: Readonly<Record<TBiomeId, number>> = {
  grassland: 10,
  plains: 9,
  forrest: 8,
  savanna: 5,
  rainforest: 4,
  taiga: 6,
  tundra: 5,
  desert: 4,
  polar_desert: 2,
  swamp: 4,
  badlands: 3,
  crater: 2,
  volcano: 1,
  hills: 7,
  mountains: 5,
  cliffs: 4,
};

/**
 * A playable island needs somewhere to mine, somewhere to log and somewhere to
 * farm. Without this the generator can hand out an island where four of the
 * seven buildings are unbuildable.
 */
const REQUIRED_GROUPS: readonly (readonly TBiomeId[])[] = [
  ["mountains", "volcano", "crater", "cliffs"],
  ["forrest", "taiga", "rainforest", "savanna"],
  ["grassland", "plains", "hills"],
];

const createCells = (rng: TRng) => {
  return hexArea(ISLAND_RADIUS).filter((cell) => {
    const isRim = Math.max(Math.abs(cell.q), Math.abs(cell.r), Math.abs(cell.q + cell.r)) === ISLAND_RADIUS;

    return !isRim || rng() > RIM_DROP_CHANCE;
  });
};

const growBiomes = (cells: ReturnType<typeof createCells>, rng: TRng) => {
  const assigned = new Map<string, TBiomeId>();

  for (const cell of cells) {
    const neighborBiomes = hexNeighbors(cell.q, cell.r)
      .map((neighbor) => assigned.get(hexId(neighbor.q, neighbor.r)))
      .filter((biomeId): biomeId is TBiomeId => biomeId !== undefined);

    const biome = pickWeighted(rng, BIOMES, (candidate) => {
      const sameNeighbors = neighborBiomes.filter((biomeId) => biomeId === candidate.id).length;

      return BIOME_WEIGHTS[candidate.id] * (1 + NEIGHBOR_BIAS * sameNeighbors);
    });

    assigned.set(hexId(cell.q, cell.r), biome.id);
  }

  return assigned;
};

/** Rewrites rim hexes until every required group is present at least once. */
const enforceRequiredGroups = (hexes: THex[], rng: TRng) => {
  for (const group of REQUIRED_GROUPS) {
    const present = hexes.some((hex) => group.includes(hex.biome));
    if (present) {
      continue;
    }

    const index = randomInt(rng, 0, hexes.length - 1);
    const victim = hexes[index];
    if (!victim) {
      continue;
    }

    hexes[index] = { ...victim, biome: pick(rng, group) };
  }
};

const createIsland = (rng: TRng): TIsland => {
  const cells = createCells(rng);
  const biomes = growBiomes(cells, rng);

  const hexes = cells.map((cell) => ({
    id: hexId(cell.q, cell.r),
    q: cell.q,
    r: cell.r,
    biome: biomes.get(hexId(cell.q, cell.r)) as TBiomeId,
    building: null,
    toxicity: 0,
  }));

  enforceRequiredGroups(hexes, rng);

  return { hexes };
};

/** Fills part of an island, so a rival's island does not read as unplayed. */
const populateIsland = (island: TIsland, rng: TRng, fillChance: number): TIsland => {
  const hexes = island.hexes.map((hex) => {
    const allowed = buildingsForBiome(hex.biome);
    if (allowed.length === 0 || rng() > fillChance) {
      return hex;
    }

    const building = pick(rng, allowed);

    return {
      ...hex,
      building: building.id,
      toxicity: randomInt(rng, 0, 40),
    };
  });

  return { hexes };
};

/**
 * Adds hexes won in the clearing phase. New hexes are stuck to the rim, so the
 * island stays one piece.
 */
const growIsland = (island: TIsland, count: number, rng: TRng): TIsland => {
  const hexes = [...island.hexes];

  for (let added = 0; added < count; added += 1) {
    const present = new Set(hexes.map((hex) => hex.id));
    const free = hexes
      .flatMap((hex) => hexNeighbors(hex.q, hex.r))
      .filter((cell) => !present.has(hexId(cell.q, cell.r)));

    if (free.length === 0) {
      break;
    }

    const cell = pick(rng, free);
    const neighborBiomes = hexNeighbors(cell.q, cell.r)
      .map((neighbor) => hexes.find((hex) => hex.id === hexId(neighbor.q, neighbor.r))?.biome)
      .filter((biomeId): biomeId is TBiomeId => biomeId !== undefined);

    const biome = pickWeighted(rng, BIOMES, (candidate) => {
      const sameNeighbors = neighborBiomes.filter((biomeId) => biomeId === candidate.id).length;

      return BIOME_WEIGHTS[candidate.id] * (1 + NEIGHBOR_BIAS * sameNeighbors);
    });

    hexes.push({
      id: hexId(cell.q, cell.r),
      q: cell.q,
      r: cell.r,
      biome: biome.id,
      building: null,
      toxicity: 0,
    });
  }

  return { hexes };
};

const RIVALS: readonly { readonly id: string; readonly nickname: string; readonly color: string }[] = [
  { id: "carribean", nickname: "Carribean Sorcerer", color: "#4fd1c5" },
  { id: "blue", nickname: "Blue Sorcerer", color: "#5b9bf5" },
  { id: "orange", nickname: "Orange Sorcerer", color: "#f59b4c" },
];

const HUMAN_PLAYER_ID = "human";
const HUMAN_COLOR = "#8fd14f";
const RIVAL_FILL_CHANCE = 0.55;

const createRival = (
  rival: (typeof RIVALS)[number],
  seed: string,
): TPlayer => {
  const rng = createRng(hashSeed(`${seed}:${rival.id}`));
  const island = populateIsland(createIsland(rng), rng, RIVAL_FILL_CHANCE);
  const built = island.hexes.filter((hex) => hex.building !== null).length;

  return {
    id: rival.id,
    nickname: rival.nickname,
    color: rival.color,
    isHuman: false,
    island,
    resources: addResources(STARTING_POOL, {
      food: randomInt(rng, 0, 40),
      toxicity: island.hexes.reduce((sum, hex) => sum + hex.toxicity, 0) / island.hexes.length,
      mad: randomInt(rng, 0, 4),
    }),
    army: built + randomInt(rng, 0, 8),
    techs: randomInt(rng, 0, 6),
    cellId: "",
  };
};

/** The whole roster of a session: the human first, then the three rivals. */
const createPlayers = (nickname: string): readonly TPlayer[] => {
  const humanRng = createRng(hashSeed(nickname));

  const human: TPlayer = {
    id: HUMAN_PLAYER_ID,
    nickname,
    color: HUMAN_COLOR,
    isHuman: true,
    island: createIsland(humanRng),
    resources: STARTING_POOL,
    army: 0,
    techs: 0,
    cellId: "",
  };

  return [human, ...RIVALS.map((rival) => createRival(rival, nickname))];
};

export { createIsland, createPlayers, growIsland, HUMAN_PLAYER_ID, ISLAND_RADIUS };
