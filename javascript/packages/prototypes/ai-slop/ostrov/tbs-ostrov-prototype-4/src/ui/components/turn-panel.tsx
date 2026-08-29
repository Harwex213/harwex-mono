import { useSignals } from "@preact/signals-react/runtime";
import { armyUpkeep, cityIncome } from "../../domain/game-state";
import { useStore } from "../../store/store";
import type { TEndTurnAction, TSelectNextArmyAction } from "../../domain/registry";
import type { FC } from "react";

type TTurnPanelRegistrySlice = {
  endTurnAction: TEndTurnAction;
  selectNextArmyAction: TSelectNextArmyAction;
};

type TTurnPanelProps = {
  registry: TTurnPanelRegistrySlice;
};

const TurnPanel: FC<TTurnPanelProps> = ({ registry }) => {
  useSignals();
  const store = useStore();

  const world = store.worldState.world.value;
  const turn = store.gameState.turn.value;
  const phase = store.gameState.phase.value;
  const outcome = store.gameState.outcome.value;
  const armies = store.gameState.armies.value;
  const structures = store.gameState.structures.value;
  const gold = store.gameState.factions.value.player.gold;

  const city = structures.find((structure) => structure.kind === "city");
  const income = world && city ? cityIncome(world, city.key) : 0;
  const upkeep = armyUpkeep(armies);
  const ready = armies.filter((army) => army.owner === "player" && army.movementLeft > 0 && !army.hasAttacked);

  return (
    <section className="panel">
      <h2 className="panel__title">
        {"Ход"}
      </h2>

      <div className="turn">
        <span className="turn__number">
          {turn}
        </span>
        <span className={`turn__phase turn__phase--${phase}`}>
          {phase === "player" ? "Ваш ход" : "Ход клана"}
        </span>
      </div>

      <dl className="stats">
        <div className="stats__row">
          <dt>
            {"Казна"}
          </dt>
          <dd className="stats__value stats__value--gold">
            {gold}
          </dd>
        </div>
        <div className="stats__row">
          <dt>
            {"Доход города"}
          </dt>
          <dd className="stats__value">
            {`+${income}`}
          </dd>
        </div>
        <div className="stats__row">
          <dt>
            {"Содержание армий"}
          </dt>
          <dd className="stats__value stats__value--cost">
            {`−${upkeep}`}
          </dd>
        </div>
      </dl>

      <div className="panel__buttons">
        <button
          type="button"
          className="button button--primary"
          onClick={registry.endTurnAction}
          disabled={phase !== "player" || outcome !== "playing"}
        >
          {"Завершить ход"}
        </button>
        <button
          type="button"
          className="button"
          onClick={registry.selectNextArmyAction}
          disabled={ready.length === 0 || phase !== "player"}
        >
          {`Следующая армия (${ready.length})`}
        </button>
      </div>

      <p className="panel__hint">
        {"Пробел — завершить ход, N — следующая армия, Esc — снять выделение."}
      </p>
    </section>
  );
};

export { TurnPanel };
