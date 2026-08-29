import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import { POPULATION_COLOR, SCIENCE_COLOR } from "../palette";
import { Chip, ResourceChips } from "./resource-chips";
import type { ChangeEvent, FC, FormEvent } from "react";
import type { TEndTurnAction, TRollIslandAction, TSetSeedTextAction, TStartIslandAction } from "../../domain/registry";

type TTopBarRegistrySlice = {
  startIslandAction: TStartIslandAction;
  rollIslandAction: TRollIslandAction;
  setSeedTextAction: TSetSeedTextAction;
  endTurnAction: TEndTurnAction;
};

type TTopBarProps = {
  registry: TTopBarRegistrySlice;
};

/** One header row: island name and stock on the left, seed and end turn on the right. */
const TopBar: FC<TTopBarProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const settlement = store.gameState.settlement.value;
  const island = store.gameState.island.value;
  const seedText = store.gameState.seedText.value;
  const ending = store.gameState.turnMessage.value !== null;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    registry.startIslandAction();
  };

  const onSeedChange = (event: ChangeEvent<HTMLInputElement>) => {
    registry.setSeedTextAction(event.target.value);
  };

  return (
    <header className="topbar">
      <h1 className="app__title">{`Остров ${island.name}`}</h1>
      <div className="topbar__stock">
        <ResourceChips amounts={settlement.resources} deltas={settlement.forecast()} full />
        <span className="topbar__divider" />
        <span className="chips">
          <Chip icon="🔬" color={SCIENCE_COLOR} tip="Очки науки" value={settlement.science} delta={settlement.scienceRate} />
          <Chip
            icon="👥"
            color={POPULATION_COLOR}
            tip="Жители — сколько живёт / сколько мест"
            value={`${settlement.population}/${settlement.housing}`}
          />
        </span>
      </div>

      <form className="controls" onSubmit={onSubmit}>
        <label className="controls__label" htmlFor="seed">
          {"Зерно"}
        </label>
        <input
          id="seed"
          className="controls__input"
          value={seedText}
          onChange={onSeedChange}
          spellCheck={false}
          autoComplete="off"
        />
        <button className="controls__button" type="submit">
          {"Начать заново"}
        </button>
        <button className="controls__button" type="button" onClick={registry.rollIslandAction}>
          {"Другой остров"}
        </button>
        <button
          className="controls__button controls__button--primary"
          type="button"
          disabled={!settlement.canEndTurn || ending}
          data-tip={settlement.canEndTurn ? undefined : "Сначала поставь Ратушу"}
          onClick={registry.endTurnAction}
        >
          {`Конец хода ${settlement.turn}`}
        </button>
      </form>
    </header>
  );
};

export { TopBar };
