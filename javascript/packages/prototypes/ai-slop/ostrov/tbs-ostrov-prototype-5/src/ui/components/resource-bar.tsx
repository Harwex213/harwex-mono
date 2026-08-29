import { useSignals } from "@preact/signals-react/runtime";
import { RESOURCE_GLYPHS, RESOURCE_KINDS, RESOURCE_LABELS } from "../../domain/game/types";
import { useStore } from "../../store/store";

const signed = (value: number): string => (value > 0 ? `+${value}` : `${value}`);

/**
 * Stock on the left, next turn's change on the right. The change is what the
 * turn resolver would apply right now, so it moves as soon as a building is
 * ordered or a worker is freed.
 */
const ResourceBar = () => {
  useSignals();
  const store = useStore();
  const resources = store.gameState.resources.value;
  const summary = store.gameState.summary.value;
  const population = store.gameState.population.value;

  return (
    <div className="resource-bar">
      {RESOURCE_KINDS.map((resource) => {
        const change = summary.net[resource];

        return (
          <div className="resource" key={resource} title={RESOURCE_LABELS[resource]}>
            <span className="resource__glyph">
              {RESOURCE_GLYPHS[resource]}
            </span>
            <span className="resource__value">
              {resources[resource]}
              <span className="resource__cap">
                {`/${summary.storage}`}
              </span>
            </span>
            <span className={`resource__delta resource__delta--${change < 0 ? "bad" : "good"}`}>
              {signed(change)}
            </span>
          </div>
        );
      })}

      <div className="resource" title="Колонисты и жильё">
        <span className="resource__glyph">
          {"🧍"}
        </span>
        <span className="resource__value">
          {population}
          <span className="resource__cap">
            {`/${summary.housing}`}
          </span>
        </span>
        <span className="resource__delta">
          {`свободных ${summary.freeWorkers}`}
        </span>
      </div>
    </div>
  );
};

export { ResourceBar };
