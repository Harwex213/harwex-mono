import { hexDistance } from "./hex";
import { HEX_ART } from "./hex-art";
import { ICONS } from "./icons";
import { pick } from "./rng";
import type { TRng } from "./rng";
import type { TFace, TIsland, TPlayer } from "./types";

/**
 * The stronghold (твердыня) is the seat of a player's power. Every player puts
 * exactly one on their island before the first turn. It is not one of the seven
 * buildings: it cannot be built, demolished or built over. It still rolls a die
 * in the tax phase like a building does, and it is the only source of power
 * (власть), the resource that changes a rolled face.
 */

const STRONGHOLD_LABEL = "Твердыня";
/**
 * The stronghold's die: 3 wood, 3 stone, 3 food or 2 hammers. The stronghold
 * keeps the island's heart clean, so no face leaves toxicity. The die is the
 * same on every biome, so it has no biome face.
 */
const STRONGHOLD_FACES: readonly TFace[] = [
  { resource: "wood", amount: 3, toxicity: 0 },
  { resource: "stone", amount: 3, toxicity: 0 },
  { resource: "food", amount: 3, toxicity: 0 },
  { resource: "hammers", amount: 2, toxicity: 0 },
];
/** Power the stronghold pays at the end of every tax phase, on top of its roll. */
const POWER_PER_TURN = 1;
/** The 64px icon drawn next to the stronghold in panels and tooltips. */
const STRONGHOLD_ART = ICONS.stronghold;
/** The 256px sprite the island canvas draws on the stronghold hex. */
const STRONGHOLD_HEX_ART = HEX_ART.stronghold;

const ORIGIN = { q: 0, r: 0 };

/** A stronghold goes on a hex of the player's own island that has no building. */
const canPlaceStronghold = (island: TIsland, hexId: string) => {
  const hex = island.hexes.find((candidate) => candidate.id === hexId);

  return hex !== undefined && hex.building === null;
};

const hasStronghold = (player: TPlayer) => {
  return player.strongholdHexId !== null;
};

const isStrongholdHex = (player: TPlayer | null, hexId: string) => {
  return player !== null && player.strongholdHexId === hexId;
};

/**
 * Puts the stronghold on a hex. A player places one stronghold, so a second
 * call moves it. A building on the target hex is cleared: a bot may pick a
 * built hex when its island has no free one.
 */
const withStronghold = (player: TPlayer, hexId: string): TPlayer => {
  const hexes = player.island.hexes.map((hex) => {
    return hex.id === hexId ? { ...hex, building: null } : hex;
  });

  return {
    ...player,
    island: { hexes },
    strongholdHexId: hexId,
  };
};

/**
 * Where a bot puts its stronghold: a free hex nearest to the island centre,
 * where the island is hardest to reach. A tie is broken by the seeded rng.
 * Returns `null` only for an island with no hexes.
 */
const pickStrongholdHex = (island: TIsland, rng: TRng): string | null => {
  const free = island.hexes.filter((hex) => hex.building === null);
  const candidates = free.length > 0 ? free : island.hexes;
  if (candidates.length === 0) {
    return null;
  }

  const nearest = Math.min(...candidates.map((hex) => hexDistance(hex, ORIGIN)));
  const central = candidates.filter((hex) => hexDistance(hex, ORIGIN) === nearest);

  return pick(rng, central).id;
};

export {
  canPlaceStronghold,
  hasStronghold,
  isStrongholdHex,
  pickStrongholdHex,
  POWER_PER_TURN,
  STRONGHOLD_ART,
  STRONGHOLD_FACES,
  STRONGHOLD_HEX_ART,
  STRONGHOLD_LABEL,
  withStronghold,
};
