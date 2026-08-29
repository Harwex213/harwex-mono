import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { ChangeEvent, FC, FormEvent } from "react";
import type { TRegenerateIslandAction, TRollIslandAction, TSetSeedTextAction } from "../../domain/registry";

type TSeedControlsRegistrySlice = {
  regenerateIslandAction: TRegenerateIslandAction;
  rollIslandAction: TRollIslandAction;
  setSeedTextAction: TSetSeedTextAction;
};

type TSeedControlsProps = {
  registry: TSeedControlsRegistrySlice;
};

const SeedControls: FC<TSeedControlsProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const seedText = store.islandState.seedText.value;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    registry.regenerateIslandAction();
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

      <button
        className="controls__button controls__button--primary"
        type="button"
        onClick={registry.rollIslandAction}
      >
        {"Другой остров"}
      </button>
    </form>
  );
};

export { SeedControls };
