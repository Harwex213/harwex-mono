import { HEX_SIZE_PX, hexId, pixelToHex } from "../../core/exports";
import type { TIsland } from "../../core/exports";
import type { TWorldPoint } from "./camera";

/**
 * Pointer → hex. The inversion itself lives in `src/core/hex.ts` and nowhere
 * else (plan §7); this file only asks the island whether the answer exists.
 */

/** The id of the island hex under the world point, or `null` for open sky. */
const hexIdAtWorldPoint = (island: TIsland, world: TWorldPoint): string | null => {
  const axial = pixelToHex(world.x, world.y, HEX_SIZE_PX);
  const id = hexId(axial.q, axial.r);
  if (island.hexes[id] === undefined) {
    return null;
  }

  return id;
};

export { hexIdAtWorldPoint };
