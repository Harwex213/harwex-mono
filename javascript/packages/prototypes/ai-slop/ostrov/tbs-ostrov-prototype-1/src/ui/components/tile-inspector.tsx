import { useSignals } from "@preact/signals-react/runtime";
import { TERRAIN_LABELS } from "../../domain/island/terrain";
import { useStore } from "../../store/store";

const percent = (value: number) => `${Math.round(value * 100)}%`;

const TileInspector = () => {
  useSignals();

  const store = useStore();
  const island = store.islandState.island.value;
  const selectedKey = store.islandState.selectedKey.value;
  const tile = island.tiles.find((candidate) => candidate.key === selectedKey) ?? null;

  if (!tile || !tile.terrain) {
    return (
      <section className="panel">
        <h2 className="panel__title">{"Гекс"}</h2>
        <p className="panel__hint">{"Кликните по клетке суши, чтобы посмотреть её."}</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2 className="panel__title">{TERRAIN_LABELS[tile.terrain]}</h2>

      <dl className="stats">
        <div className="stats__row">
          <dt>{"Координаты"}</dt>
          <dd>{`q ${tile.q}, r ${tile.r}`}</dd>
        </div>
        <div className="stats__row">
          <dt>{"Высота"}</dt>
          <dd>{percent(tile.elevation)}</dd>
        </div>
        <div className="stats__row">
          <dt>{"Влажность"}</dt>
          <dd>{percent(tile.moisture)}</dd>
        </div>
        <div className="stats__row">
          <dt>{"Берег"}</dt>
          <dd>{tile.coastal ? "да" : "нет"}</dd>
        </div>
      </dl>
    </section>
  );
};

export { TileInspector };
