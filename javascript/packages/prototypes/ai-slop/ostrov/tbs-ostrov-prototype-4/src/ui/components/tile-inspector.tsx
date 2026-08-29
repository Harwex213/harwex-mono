import { useSignals } from "@preact/signals-react/runtime";
import { UNITS } from "../../domain/rules/units";
import { TERRAIN } from "../../domain/world/terrain";
import { useStore } from "../../store/store";
import type { FC } from "react";

const TileInspector: FC = () => {
  useSignals();
  const store = useStore();

  const world = store.worldState.world.value;
  const hoveredKey = store.selectionState.hoveredKey.value;
  const armies = store.gameState.armies.value;
  const structures = store.gameState.structures.value;
  const explored = store.gameState.explored.value;
  const visible = store.gameState.visible.value;
  const showFog = store.viewState.showFog.value;

  const tile = world && hoveredKey !== "" ? world.tiles.get(hoveredKey) : undefined;
  const hidden = showFog && tile !== undefined && !explored.has(tile.key);

  if (!tile || hidden) {
    return (
      <section className="panel">
        <h2 className="panel__title">
          {"Клетка"}
        </h2>
        <p className="panel__empty">
          {hidden ? "Земля не разведана." : "Наведите курсор на карту."}
        </p>
      </section>
    );
  }

  const terrain = TERRAIN[tile.terrain];
  const army = armies.find((candidate) => candidate.key === tile.key);
  const structure = structures.find((candidate) => candidate.key === tile.key);
  const armyVisible = army !== undefined && (!showFog || visible.has(tile.key));

  return (
    <section className="panel">
      <h2 className="panel__title">
        {"Клетка"}
      </h2>

      <p className="tile__terrain">
        {terrain.label}
        <span className="tile__coords">
          {`q ${tile.cell.q} · r ${tile.cell.r}`}
        </span>
      </p>

      <dl className="stats">
        <div className="stats__row">
          <dt>
            {"Стоимость хода"}
          </dt>
          <dd className="stats__value">
            {terrain.moveCost === null ? "непроходимо" : terrain.moveCost}
          </dd>
        </div>
        <div className="stats__row">
          <dt>
            {"Защита"}
          </dt>
          <dd className="stats__value">
            {`×${terrain.defence.toFixed(2)}`}
          </dd>
        </div>
        <div className="stats__row">
          <dt>
            {"Доход"}
          </dt>
          <dd className="stats__value stats__value--gold">
            {`+${terrain.income}`}
          </dd>
        </div>
      </dl>

      {structure ? (
        <p className="tile__occupant">
          {`${structure.name} — ${structure.hp}/${structure.maxHp} HP`}
        </p>
      ) : null}

      {armyVisible ? (
        <p className={`tile__occupant tile__occupant--${army.owner}`}>
          {`${UNITS[army.kind].name} — ${army.hp}/${army.maxHp} HP`}
        </p>
      ) : null}
    </section>
  );
};

export { TileInspector };
