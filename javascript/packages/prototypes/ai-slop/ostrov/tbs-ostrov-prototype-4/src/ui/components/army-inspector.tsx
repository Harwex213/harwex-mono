import { useSignals } from "@preact/signals-react/runtime";
import { UNITS } from "../../domain/rules/units";
import { TERRAIN } from "../../domain/world/terrain";
import { useStore } from "../../store/store";
import type { FC } from "react";

const ArmyInspector: FC = () => {
  useSignals();
  const store = useStore();

  const world = store.worldState.world.value;
  const armies = store.gameState.armies.value;
  const selectedArmyId = store.selectionState.selectedArmyId.value;

  const army = armies.find((candidate) => candidate.id === selectedArmyId);
  if (!world || !army) {
    return (
      <section className="panel">
        <h2 className="panel__title">
          {"Армия"}
        </h2>
        <p className="panel__empty">
          {"Кликните по своей армии на карте."}
        </p>
      </section>
    );
  }

  const tile = world.tiles.get(army.key);
  const terrain = tile ? TERRAIN[tile.terrain] : null;
  const blueprint = UNITS[army.kind];

  return (
    <section className="panel">
      <h2 className="panel__title">
        {"Армия"}
      </h2>

      <p className="army__name">
        {army.name}
      </p>

      <div className="bar">
        <div
          className="bar__fill"
          style={{ width: `${Math.round((army.hp / army.maxHp) * 100)}%` }}
        />
        <span className="bar__label">
          {`${army.hp} / ${army.maxHp} HP`}
        </span>
      </div>

      <dl className="stats">
        <div className="stats__row">
          <dt>
            {"Ходы"}
          </dt>
          <dd className="stats__value">
            {`${army.movementLeft} / ${army.movement}`}
          </dd>
        </div>
        <div className="stats__row">
          <dt>
            {"Сила"}
          </dt>
          <dd className="stats__value">
            {army.attack}
          </dd>
        </div>
        <div className="stats__row">
          <dt>
            {"Местность"}
          </dt>
          <dd className="stats__value">
            {terrain ? `${terrain.label} ·  ×${terrain.defence.toFixed(2)}` : "—"}
          </dd>
        </div>
        <div className="stats__row">
          <dt>
            {"Содержание"}
          </dt>
          <dd className="stats__value stats__value--cost">
            {`−${blueprint.upkeep}`}
          </dd>
        </div>
      </dl>

      <p className="panel__hint">
        {army.hasAttacked
          ? "Армия уже атаковала в этот ход."
          : army.movementLeft <= 0
            ? "Ходы кончились. Отдых лечит на следующем ходу."
            : "Кликните по подсвеченной клетке, чтобы пойти, по красной — чтобы атаковать."}
      </p>
    </section>
  );
};

export { ArmyInspector };
