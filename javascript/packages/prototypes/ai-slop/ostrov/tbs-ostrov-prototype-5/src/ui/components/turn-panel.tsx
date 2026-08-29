import { useSignals } from "@preact/signals-react/runtime";
import { GROWTH_FOOD_COST, VICTORY_POPULATION } from "../../domain/game/economy";
import { useStore } from "../../store/store";
import type { TEndTurnAction, TRestartAction } from "../../domain/registry";
import type { FC } from "react";

type TTurnPanelRegistrySlice = {
  endTurnAction: TEndTurnAction;
  restartAction: TRestartAction;
};

type TTurnPanelProps = {
  registry: TTurnPanelRegistrySlice;
};

const TurnPanel: FC<TTurnPanelProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const turn = store.gameState.turn.value;
  const victory = store.gameState.victory.value;
  const population = store.gameState.population.value;

  return (
    <div className="turn-panel">
      <div className="turn-panel__count">
        <span className="turn-panel__label">
          {"Ход"}
        </span>
        <span className="turn-panel__value">
          {turn}
        </span>
      </div>

      <div
        className="turn-panel__goal"
        title={`Новый колонист появляется, когда есть ${GROWTH_FOOD_COST} еды и свободное место в домах`}
      >
        {`Цель: ${population}/${VICTORY_POPULATION} колонистов`}
      </div>

      <button className="button button--primary" onClick={registry.endTurnAction} disabled={victory}>
        {victory ? "Партия окончена" : "Завершить ход"}
      </button>

      <button className="button" onClick={registry.restartAction}>
        {"Новый остров"}
      </button>
    </div>
  );
};

export { TurnPanel };
