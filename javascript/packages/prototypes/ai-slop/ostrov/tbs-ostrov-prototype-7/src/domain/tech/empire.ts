import { TECHS, techOf } from "./tech-tree";

/** One thing the player can build, with how many times techs improved it. */
type TAsset = {
  name: string;
  level: number;
  notes: string[];
};

type TEmpire = {
  buildings: TAsset[];
  units: TAsset[];
};

const upsertAsset = (assets: Map<string, TAsset>, name: string): TAsset => {
  let asset = assets.get(name);
  if (!asset) {
    asset = { name, level: 0, notes: [] };
    assets.set(name, asset);
  }

  return asset;
};

/** Everything the researched set gives, folded into one snapshot. */
const deriveEmpire = (researched: readonly string[]): TEmpire => {
  const buildings = new Map<string, TAsset>();
  const units = new Map<string, TAsset>();

  // Walk in tree order so unlocks land before improvements.
  TECHS.filter((tech) => researched.includes(tech.id)).forEach((tech) => {
    tech.effects.forEach((effect) => {
      const pool = effect.kind === "unlockBuilding" || effect.kind === "improveBuilding" ? buildings : units;
      const asset = upsertAsset(pool, effect.target);

      if (effect.kind === "unlockBuilding" || effect.kind === "unlockUnit") {
        asset.level = Math.max(asset.level, 1);
      } else {
        asset.level += 1;
        asset.notes.push(effect.note);
      }
    });
  });

  return {
    buildings: [...buildings.values()],
    units: [...units.values()],
  };
};

const isAvailable = (id: string, researched: readonly string[]): boolean => {
  if (researched.includes(id)) {
    return false;
  }

  return techOf(id).requires.every((requirement) => researched.includes(requirement));
};

export type { TAsset, TEmpire };
export { deriveEmpire, isAvailable };
