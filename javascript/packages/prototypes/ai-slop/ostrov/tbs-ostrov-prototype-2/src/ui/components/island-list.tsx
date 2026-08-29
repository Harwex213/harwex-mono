import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import { TERRAIN_STYLES } from "../render/palette";
import type { TIsland } from "../../domain/generator/types";
import type { TFocusIslandAction } from "../../domain/registry";
import type { FC } from "react";

type TIslandListRegistrySlice = {
  focusIslandAction: TFocusIslandAction;
};

type TIslandListProps = {
  registry: TIslandListRegistrySlice;
};

/**
 * A 400x400 map can hold several hundred islands, and a list that long is
 * neither readable nor cheap to render. The biggest ones are the interesting
 * ones, so the rest are left to the map itself.
 */
const LISTED_ISLANDS = 40;

/** The three terrains an island has most of, biggest share first. */
const topTerrains = (island: TIsland): string[] =>
  Object.entries(island.terrainCounts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([kind]) => TERRAIN_STYLES[kind as keyof typeof TERRAIN_STYLES].label);

const IslandList: FC<TIslandListProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const map = store.generatorState.map.value;
  const selectedIslandId = store.viewState.selectedIslandId.value;

  if (!map) {
    return null;
  }

  const listed = map.islands.slice(0, LISTED_ISLANDS);

  return (
    <section className="panel">
      <h2 className="panel__title">{`Islands (${map.islands.length})`}</h2>

      {map.islands.length === 0 ? (
        <p className="panel__empty">{"Nothing above sea level. Lower the sea level or widen the cores."}</p>
      ) : (
        <>
          <ul className="islands">
            {listed.map((island) => (
              <li key={island.id}>
                <button
                  type="button"
                  className={island.id === selectedIslandId ? "island island--selected" : "island"}
                  onClick={() => registry.focusIslandAction(island.id)}
                >
                  <span className="island__name">{island.name}</span>
                  <span className="island__size">{`${island.size} hex`}</span>
                  <span className="island__terrain">{topTerrains(island).join(", ")}</span>
                </button>
              </li>
            ))}
          </ul>
          {map.islands.length > LISTED_ISLANDS ? (
            <p className="panel__hint">{`Showing the ${LISTED_ISLANDS} largest of ${map.islands.length}.`}</p>
          ) : null}
        </>
      )}
    </section>
  );
};

export { IslandList };
