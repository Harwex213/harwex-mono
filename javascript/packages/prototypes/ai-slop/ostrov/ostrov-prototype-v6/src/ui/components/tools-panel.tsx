import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TOpenTechModalAction, TToggleDemolishModeAction } from "../../domain/registry";

type TToolsPanelRegistrySlice = {
  openTechModalAction: TOpenTechModalAction;
  toggleDemolishModeAction: TToggleDemolishModeAction;
};

type TToolsPanelProps = {
  registry: TToolsPanelRegistrySlice;
};

/** The two icons of the wireframe: demolish above, technologies below. */
const ToolsPanel: FC<TToolsPanelProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const demolishMode = store.ui.demolishMode.value;
  const locked = store.game.phase.value !== "build" || store.ui.busy.value;

  return (
    <div className={`panel tools-panel ${locked ? "panel--locked" : ""}`}>
      <button
        type="button"
        className={`tool-icon has-hint ${demolishMode ? "tool-icon--active" : ""}`}
        onClick={registry.toggleDemolishModeAction}
      >
        {"⛏️"}

        <span className="hint">
          <span className="hint__title">
            {"Снести здание"}
          </span>

          <span className="hint__row">
            {demolishMode
              ? "Кликните по гексу со зданием. Токсичность гекса обнулится."
              : "Включает режим сноса: клик по гексу убирает с него здание."}
          </span>
        </span>
      </button>

      <button
        type="button"
        className="tool-icon has-hint"
        onClick={registry.openTechModalAction}
      >
        {"⚗️"}

        <span className="hint">
          <span className="hint__title">
            {"Технологии"}
          </span>

          <span className="hint__row">
            {"Наука копится в ресурсах. Дерево технологий ещё не описано в спеке."}
          </span>
        </span>
      </button>
    </div>
  );
};

export { ToolsPanel };
