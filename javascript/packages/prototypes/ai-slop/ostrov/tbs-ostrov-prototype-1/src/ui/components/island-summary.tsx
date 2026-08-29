import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";

const IslandSummary = () => {
  useSignals();

  const store = useStore();
  const island = store.islandState.island.value;

  return (
    <section className="panel">
      <h2 className="panel__title">{island.name}</h2>

      <dl className="stats">
        <div className="stats__row">
          <dt>{"Зерно"}</dt>
          <dd>{island.seedText}</dd>
        </div>
        <div className="stats__row">
          <dt>{"Суша"}</dt>
          <dd>{`${island.landCount} из ${island.boardSize}`}</dd>
        </div>
      </dl>
    </section>
  );
};

export { IslandSummary };
