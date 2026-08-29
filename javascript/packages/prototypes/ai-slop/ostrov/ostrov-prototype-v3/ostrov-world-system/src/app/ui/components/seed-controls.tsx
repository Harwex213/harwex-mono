import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { ChangeEvent, FC, FormEvent } from "react";
import type { TRegenerateWorldAction, TRollWorldAction, TSetSeedTextAction } from "../../domain/registry";

type TSeedControlsRegistrySlice = {
  regenerateWorldAction: TRegenerateWorldAction;
  rollWorldAction: TRollWorldAction;
  setSeedTextAction: TSetSeedTextAction;
};

type TSeedControlsProps = {
  registry: TSeedControlsRegistrySlice;
};

const SeedControls: FC<TSeedControlsProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const seedText = store.worldState.seedText.value;
  const world = store.worldState.world.value;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    registry.regenerateWorldAction();
  };

  const onSeedChange = (event: ChangeEvent<HTMLInputElement>) => {
    registry.setSeedTextAction(event.target.value);
  };

  return (
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
        {"Построить"}
      </button>

      <button className="controls__button controls__button--primary" type="button" onClick={registry.rollWorldAction}>
        {"Другой мир"}
      </button>

      <span className="controls__stat">
        {`Островов ${world.islands.length} из ${world.requestedCount}`}
      </span>

      <span className="controls__stat">{`Суши ${world.landCount} из ${world.cellCount} кл.`}</span>

      <span className="controls__stat">{`Поле ${world.width} × ${world.height}`}</span>

      {world.unplaced.length > 0 ? (
        <span className="controls__stat controls__stat--warn">{`Не поместилось ${world.unplaced.length}`}</span>
      ) : null}
    </form>
  );
};

export { SeedControls };
