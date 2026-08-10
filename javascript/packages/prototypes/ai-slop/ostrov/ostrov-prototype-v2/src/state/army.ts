import { config } from "@hw/ostrov-prototype-v2-config";
import { computed } from "@preact/signals-react";
import type { BuildingId } from "../buildings/catalog";
import { CASTLE_ID, HUT_ID, buildingSpec } from "../buildings/catalog";
import { buildings } from "./buildings";

/**
 * How many soldiers the island can hold.
 *
 * The barracks does not enter into it. It trains, and training is all it does —
 * an island of six barracks and no houses has nowhere to put a single soldier.
 * The places come from two buildings: the castle contributes a flat base, and
 * every finished hut contributes its `workerSlots`.
 *
 * `workerSlots` is doing double duty here, and it should not: the field means
 * "how many workers this building employs" everywhere else, and a hut has no
 * production for a worker to be employed in. A `populationProvided` field of its
 * own would say what is meant and would let a designer give the mine lodgings
 * without also giving it soldiers. Until that field exists the reuse is behind
 * one config switch, `army.hutSlotsFeedArmy`, so turning it off is one click.
 */

/** What one finished building of this kind adds to the limit. */
function capacityOf(id: BuildingId): number {
  if (id === CASTLE_ID) {
    return config.army.castleBaseCapacity;
  }
  if (id === HUT_ID && config.army.hutSlotsFeedArmy) {
    return buildingSpec(id).workerSlots;
  }
  return 0;
}

/**
 * Places on the island right now: the castle base plus every hut's slots. Only
 * finished buildings count — a site under scaffolding houses nobody.
 */
const armyLimit = computed<number>(() => {
  let total = 0;
  for (const building of buildings.value.values()) {
    if (building.state !== "built") {
      continue;
    }
    total += capacityOf(building.id);
  }
  return total;
});

export { armyLimit, capacityOf };
