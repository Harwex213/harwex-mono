import { useSignals } from "@preact/signals-react/runtime";
import { MOVE_RANGE } from "../../domain/world/world";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TEndTurnAction, TToggleMoveModeAction } from "../../domain/registry";

type TActionCardsRegistrySlice = {
  toggleMoveModeAction: TToggleMoveModeAction;
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
  const moving = mode === "move";
  const canMove = movesLeft > 0;

  return (
    <div className="hand">
      <button
        type="button"
        className={`card card--move${moving ? " card--active" : ""}`}
        disabled={!canMove && !moving}
        onClick={() => registry.toggleMoveModeAction()}
      >
        <span className="card__icon">{moving ? "✕" : "🪶"}</span>
        <span className="card__title">{moving ? "Отменить перелёт" : "Перелёт острова"}</span>
        <span className="card__text">
          {moving
            ? "Выберите подсвеченную клетку в небе."
            : canMove
              ? `Остров перелетает до ${MOVE_RANGE} клеток. Свободные места подсветятся.`
              : "В этот ход остров уже летал."}
        </span>
        <span className="card__cost">{canMove ? "1 перелёт" : "0 перелётов"}</span>
      </button>

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
