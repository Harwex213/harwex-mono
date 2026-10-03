import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type {
  TNewGameAction,
  TRandomizeSeedAction,
  TSetBoardSizeAction,
  TSetSeedAction,
} from "../../domain/registry";
import type { ChangeEvent, FC } from "react";

type TWorldPanelRegistrySlice = {
  newGameAction: TNewGameAction;
  setSeedAction: TSetSeedAction;
  randomizeSeedAction: TRandomizeSeedAction;
  setBoardSizeAction: TSetBoardSizeAction;
};

type TWorldPanelProps = {
  registry: TWorldPanelRegistrySlice;
};

/** 5x5 is the brief; the larger boards are there to see the rules breathe. */
const BOARD_SIZES: readonly number[] = [5, 7, 9, 11];

const WorldPanel: FC<TWorldPanelProps> = ({ registry }) => {
  useSignals();
  const store = useStore();

  const seed = store.worldState.seed.value;
  const boardSize = store.worldState.boardSize.value;
  const world = store.worldState.world.value;

  const handleSeed = (event: ChangeEvent<HTMLInputElement>) => {
    registry.setSeedAction(event.target.value);
  };

  return (
    <section className="panel">
      <h2 className="panel__title">
        {"Остров"}
      </h2>

      <label className="field">
        <span className="field__label">
          {"Зерно"}
        </span>
        <input className="field__input" type="text" value={seed} onChange={handleSeed} spellCheck={false} />
      </label>

      <div className="chips">
        {BOARD_SIZES.map((size) => (
          <button
            key={size}
            type="button"
            className={`chip${size === boardSize ? " chip--active" : ""}`}
            onClick={() => registry.setBoardSizeAction(size)}
          >
            {`${size}×${size}`}
          </button>
        ))}
      </div>

      <div className="panel__buttons">
        <button type="button" className="button button--primary" onClick={registry.newGameAction}>
          {"Новая партия"}
        </button>
        <button type="button" className="button" onClick={registry.randomizeSeedAction}>
          {"Случайный остров"}
        </button>
      </div>

      <p className="panel__hint">
        {world ? `Суши: ${world.landKeys.length} из ${world.order.length} клеток.` : "Остров ещё не создан."}
      </p>
    </section>
  );
};

export { WorldPanel };
