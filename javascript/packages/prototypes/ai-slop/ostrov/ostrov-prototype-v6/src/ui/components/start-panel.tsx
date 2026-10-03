import { useSignals } from "@preact/signals-react/runtime";
import { hasStronghold, STRONGHOLD_ART } from "../../core/stronghold";
import { useStore } from "../../store/store";
import { Icon } from "./icon";
import type { FC } from "react";
import type { TStartGameAction } from "../../domain/registry";

type TStartPanelRegistrySlice = {
  startGameAction: TStartGameAction;
};

type TStartPanelProps = {
  registry: TStartPanelRegistrySlice;
};

/**
 * The "Начать" button of the start phase, at the bottom centre of the
 * wireframe. It stays disabled until the player's stronghold stands. After the
 * click the panel slides down and out while the vignette comes in.
 */
const StartPanel: FC<TStartPanelProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const player = store.derived.humanPlayer.value;
  const isPlaced = player !== null && hasStronghold(player);
  const isLeaving = store.game.stage.value !== "setup";

  return (
    <div className={`panel start-panel ${isLeaving ? "start-panel--leaving" : ""}`}>
      <div className="start-panel__hint">
        <Icon src={STRONGHOLD_ART} size="m" />
        {isPlaced
          ? "Твердыня стоит. Кликните другой гекс, чтобы перенести её."
          : "Кликните свободный гекс, чтобы поставить твердыню."}
      </div>

      <button
        type="button"
        className="button button--primary start-panel__button"
        disabled={!isPlaced || isLeaving}
        onClick={registry.startGameAction}
      >
        {"Начать"}
      </button>
    </div>
  );
};

export { StartPanel };
