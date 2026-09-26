import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TToggleDemolishAction } from "../../domain/registry";

/**
 * The pickaxe of `01-spec-image-5.png`, top slot of the tools column. S8 puts
 * the technologies flask in the slot below it.
 */

type TDemolishIconRegistrySlice = {
  toggleDemolish: TToggleDemolishAction;
};

type TDemolishIconProps = {
  registry: TDemolishIconRegistrySlice;
};

const DEMOLISH_GLYPH = "⛏";
const DEMOLISH_LABEL_RU = "Снести";

const DemolishIcon: FC<TDemolishIconProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const active = store.ui.demolishMode.value;

  return (
    <button
      type="button"
      className={active ? "demolish-icon demolish-icon--active" : "demolish-icon"}
      title={DEMOLISH_LABEL_RU}
      aria-pressed={active}
      onClick={() => registry.toggleDemolish()}
    >
      <span className="demolish-icon__glyph">
        {DEMOLISH_GLYPH}
      </span>

      <span className="demolish-icon__label">
        {"Снести"}
      </span>
    </button>
  );
};

export type { TDemolishIconRegistrySlice };
export { DemolishIcon };
