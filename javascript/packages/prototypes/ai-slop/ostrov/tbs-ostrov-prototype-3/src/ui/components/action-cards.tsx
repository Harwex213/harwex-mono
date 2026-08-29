import { useSignals } from "@preact/signals-react/runtime";
import { MOVE_RANGES } from "../../domain/world/world";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TEndTurnAction, TSetMoveRangeAction, TToggleMoveModeAction } from "../../domain/registry";

type TActionCardsRegistrySlice = {
  toggleMoveModeAction: TToggleMoveModeAction;
  setMoveRangeAction: TSetMoveRangeAction;
  endTurnAction: TEndTurnAction;
};

type TActionCardsProps = {
  registry: TActionCardsRegistrySlice;
};

/** The hand at the bottom of the viewport. One card per thing the player can do. */
const ActionCards: FC<TActionCardsProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const mode = store.gameState.mode.value;
  const movesLeft = store.gameState.movesLeft.value;
  const range = store.gameState.moveRange.value;
  const moving = mode === "move";
  const canMove = movesLeft > 0;

  return (
    <div className="hand">
      <div className={`card card--move${moving ? " card--active" : ""}${!canMove && !moving ? " card--disabled" : ""}`}>
        <button
          type="button"
          className="card__body"
          disabled={!canMove && !moving}
          onClick={() => registry.toggleMoveModeAction()}
        >
          <span className="card__icon">{moving ? "✕" : "🪶"}</span>
          <span className="card__title">{moving ? "Отменить перелёт" : "Перелёт острова"}</span>
          <span className="card__text">
            {moving
              ? "Выберите клетку внутри зоны."
              : canMove
                ? `Остров перелетает до ${range} ${range === 1 ? "клетки" : "клеток"} за ход.`
                : "В этот ход остров уже летал."}
          </span>
          <span className="card__cost">{canMove ? "1 перелёт" : "0 перелётов"}</span>
        </button>

        <div className="card__range" role="radiogroup" aria-label="Дальность перелёта">
          <span className="card__range-label">{"Дальность"}</span>
          {MOVE_RANGES.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={option === range}
              className={`card__range-option${option === range ? " card__range-option--active" : ""}`}
              onClick={() => registry.setMoveRangeAction(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <button type="button" className="card card--turn" onClick={() => registry.endTurnAction()}>
        <span className="card__icon">⏭</span>
        <span className="card__title">{"Завершить ход"}</span>
        <span className="card__text">{"Собрать доход. Соседние острова дрейфуют."}</span>
        <span className="card__cost">{`Ход ${store.gameState.turn.value}`}</span>
      </button>
    </div>
  );
};

export { ActionCards };
