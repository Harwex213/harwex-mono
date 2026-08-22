import type { Axial } from "../hex/coords";
import { hexKey } from "../hex/coords";
import { OWNER_PLAYER } from "../map/island";
import type { WorldMap } from "../map/world";
import { territoryVersion, world } from "./signals";

/**
 * Who owns which ground, and which of the empty air between the islands.
 *
 * Ownership of a tile is a field on the tile itself, and the tiles are shared by
 * the world map and by every island, so a claim is written once and read
 * everywhere. What the rest of the app watches is `territoryVersion`: the fog
 * field, the territory outline and both canvases all rebuild off that counter
 * rather than off a new world object, which keeps a claim from throwing away
 * every cache the renderer holds.
 *
 * A claim also takes the hexes inside its radius that hold no land. That is not
 * bookkeeping for its own sake: the islands of this world sit about ten hex
 * steps apart, so a two-ring claim laid on the rim of an island would otherwise
 * find nothing at all to take and the player's reach would never grow. The empty
 * hexes are territory — airspace over the clouds — and the fog measures its
 * reveal radius from them exactly as it does from land.
 */

/** One hex of claimed air: no land on it, and it still pushes the fog back. */
type ClaimedHex = {
  q: number;
  r: number;
  /** Island the claim was laid from. The fog groups its discs on it. */
  islandId: number;
};

const claimed = new Map<string, ClaimedHex>();

let source: WorldMap | null = null;

/** Drops everything the claims of an older world said. */
function resetIfWorldChanged(map: WorldMap): void {
  if (source === map) {
    return;
  }
  source = map;
  claimed.clear();
}

/**
 * Hands every hex within `radius` steps of `centre` to the player: the tiles as
 * owned land, the gaps as claimed air. Returns true when anything actually
 * changed hands, which is also the only case that bumps the version.
 */
function claimAround(centre: Axial, radius: number): boolean {
  if (radius <= 0) {
    return false;
  }
  const map = world.peek();
  resetIfWorldChanged(map);
  const home = map.tileAt(centre.q, centre.r);
  if (!home) {
    return false;
  }
  let changed = false;
  for (let dq = -radius; dq <= radius; dq += 1) {
    const from = Math.max(-radius, -dq - radius);
    const to = Math.min(radius, -dq + radius);
    for (let dr = from; dr <= to; dr += 1) {
      const q = centre.q + dq;
      const r = centre.r + dr;
      const tile = map.tileAt(q, r);
      if (tile) {
        if (tile.owner !== OWNER_PLAYER) {
          tile.owner = OWNER_PLAYER;
          changed = true;
        }
        continue;
      }
      const key = hexKey(q, r);
      if (!claimed.has(key)) {
        claimed.set(key, { q, r, islandId: home.islandId });
        changed = true;
      }
    }
  }
  if (changed) {
    territoryVersion.value = territoryVersion.peek() + 1;
  }
  return changed;
}

/** The claimed air, for whoever measures the player's reach. */
function claimedAir(map: WorldMap): Iterable<ClaimedHex> {
  resetIfWorldChanged(map);
  return claimed.values();
}

export type { ClaimedHex };
export { claimAround, claimedAir };
