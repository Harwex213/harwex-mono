import { getBiome } from "./biomes";
import { canAfford, canBuildOn } from "./buildings";
import { isStrongholdHex, STRONGHOLD_LABEL } from "./stronghold";
import type { TBuilding, THex, TPlayer } from "./types";

/**
 * The rules that decide whether a building can go on a hex. The build action
 * and the hover tooltip both read them, so the tooltip cannot promise a build
 * that the click then refuses.
 */

type TBuildRefusalCode = "stronghold" | "occupied" | "biome" | "cost";

type TBuildRefusal = {
  readonly code: TBuildRefusalCode;
  readonly message: string;
};

/** Returns `null` when the building can go on the hex, or the reason why not. */
const buildRefusal = (
  player: TPlayer,
  hex: THex,
  building: TBuilding,
  stoneDiscount: number,
): TBuildRefusal | null => {
  if (isStrongholdHex(player, hex.id)) {
    return { code: "stronghold", message: `Здесь стоит ${STRONGHOLD_LABEL.toLowerCase()}` };
  }

  if (hex.building !== null) {
    return { code: "occupied", message: "Гекс уже занят" };
  }

  if (!canBuildOn(building, hex.biome)) {
    return {
      code: "biome",
      message: `«${building.label}» нельзя строить на биоме «${getBiome(hex.biome).label}»`,
    };
  }

  if (!canAfford(player.resources, building, stoneDiscount)) {
    return { code: "cost", message: `Не хватает ресурсов на «${building.label}»` };
  }

  return null;
};

export type { TBuildRefusal, TBuildRefusalCode };
export { buildRefusal };
