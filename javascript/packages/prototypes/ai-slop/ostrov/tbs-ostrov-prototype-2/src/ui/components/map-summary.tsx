import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";

const MapSummary = () => {
  useSignals();
  const store = useStore();
  const map = store.generatorState.map.value;

  if (!map) {
    return null;
  }

  const total = map.cells.height.length;
  const landShare = total === 0 ? 0 : Math.round((map.landCount / total) * 100);
  const largest = map.islands[0];

  return (
    <section className="panel">
      <h2 className="panel__title">{"Map"}</h2>
      <dl className="stats">
        <div className="stats__row">
          <dt>{"Hexes"}</dt>
          <dd>{`${map.width} × ${map.height} = ${total.toLocaleString("en-US")}`}</dd>
        </div>
        <div className="stats__row">
          <dt>{"Land"}</dt>
          <dd>{`${map.landCount.toLocaleString("en-US")} (${landShare}%)`}</dd>
        </div>
        <div className="stats__row">
          <dt>{"Islands"}</dt>
          <dd>{map.islands.length}</dd>
        </div>
        <div className="stats__row">
          <dt>{"Largest"}</dt>
          <dd>{largest ? `${largest.name} — ${largest.size}` : "—"}</dd>
        </div>
        <div className="stats__row">
          <dt>{"Flooded specks"}</dt>
          <dd>{map.discardedIslands}</dd>
        </div>
        <div className="stats__row">
          <dt>{"Generated in"}</dt>
          <dd>{`${map.generationMs.toFixed(1)} ms`}</dd>
        </div>
      </dl>
    </section>
  );
};

export { MapSummary };
