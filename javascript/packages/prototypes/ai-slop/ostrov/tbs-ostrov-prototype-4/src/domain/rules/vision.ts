import { axialDistance } from "../hex/coords";
import { TERRAIN } from "../world/terrain";
import type { TArmy, TFactionId, TStructure, TWorld } from "../world/types";

/**
 * Sight is plain radius: on a board this size a line-of-sight rule would blind
 * an army standing behind its own forest and read as a bug, not a rule.
 */

const computeVisible = (
  world: TWorld,
  armies: readonly TArmy[],
  structures: readonly TStructure[],
  faction: TFactionId
): Set<string> => {
  const visible = new Set<string>();

  const reveal = (fromKey: string, radius: number) => {
    const source = world.tiles.get(fromKey);
    if (!source) {
      return;
    }
    for (const tile of world.order) {
      if (axialDistance(source.cell, tile.cell) <= radius) {
        visible.add(tile.key);
      }
    }
  };

  for (const structure of structures) {
    if (structure.owner !== faction) {
      continue;
    }
    reveal(structure.key, structure.sight);
  }

  for (const army of armies) {
    if (army.owner !== faction) {
      continue;
    }
    const tile = world.tiles.get(army.key);
    const bonus = tile ? TERRAIN[tile.terrain].sightBonus : 0;
    reveal(army.key, army.sight + bonus);
  }

  return visible;
};

export { computeVisible };
