import { useSignals } from "@preact/signals-react/runtime";
import { BUILDING_DEFS, describeCost } from "../../domain/game/buildings";
import { RESOURCE_LABELS } from "../../domain/game/types";
import { TERRAIN_LABELS } from "../../domain/world/types";
import { useStore } from "../../store/store";
import type { TDemolishAction } from "../../domain/registry";
import type { FC } from "react";

type TTileInspectorRegistrySlice = {
  demolishAction: TDemolishAction;
};

type TTileInspectorProps = {
  registry: TTileInspectorRegistrySlice;
};

/** Everything the selected tile is: terrain, what stands on it, what it yields. */
const TileInspector: FC<TTileInspectorProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const world = store.worldState.world.value;
  const buildings = store.gameState.buildings.value;
  const summary = store.gameState.summary.value;
  const selectedIndex = store.viewState.selectedIndex.value;
  const tile = world.tiles[selectedIndex];

  if (!tile) {
    return (
      <section className="panel">
        <h2 className="panel__title">
          {"Клетка"}
        </h2>
        <p className="panel__hint">
          {"Кликните по острову, чтобы выбрать клетку."}
        </p>
      </section>
    );
  }

  const building = buildings[tile.index] ?? null;
  const definition = building ? BUILDING_DEFS[building.kind] : null;
  const isIdle = summary.idle.has(tile.index);

  return (
    <section className="panel">
      <h2 className="panel__title">
        {`Клетка ${tile.col}:${tile.row}`}
      </h2>

      <dl className="facts">
        <div className="facts__row">
          <dt>
            {"Тип"}
          </dt>
          <dd>
            {TERRAIN_LABELS[tile.terrain]}
          </dd>
        </div>
        <div className="facts__row">
          <dt>
            {"Высота"}
          </dt>
          <dd>
            {tile.height.toFixed(2)}
          </dd>
        </div>
        <div className="facts__row">
          <dt>
            {"Берег"}
          </dt>
          <dd>
            {tile.isCoast ? "да" : "нет"}
          </dd>
        </div>
      </dl>

      {!definition || !building ? (
        <p className="panel__hint">
          {tile.isLand ? "Свободная клетка — выберите постройку ниже." : "На воде строить нельзя."}
        </p>
      ) : (
        <div className="tile-building">
          <div className="tile-building__head">
            <span className="tile-building__glyph">
              {definition.glyph}
            </span>
            <span className="tile-building__label">
              {definition.label}
            </span>
          </div>

          <p className="tile-building__status">
            {building.remaining > 0
              ? `Строится, осталось ходов: ${building.remaining}`
              : isIdle
                ? "Простаивает: не хватает колонистов"
                : "Работает"}
          </p>

          {describeCost(definition.yields).length > 0 && (
            <p className="tile-building__yields">
              {describeCost(definition.yields)
                .map(([resource, amount]) => `${RESOURCE_LABELS[resource]} +${amount}`)
                .join(", ")}
            </p>
          )}

          <button className="button button--danger" onClick={() => registry.demolishAction(tile.index)}>
            {"Разобрать (вернёт половину)"}
          </button>
        </div>
      )}
    </section>
  );
};

export { TileInspector };
