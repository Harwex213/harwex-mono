import { useSignals } from "@preact/signals-react/runtime";
import { PHASE_NAMES_RU } from "../../store/game-state";
import { useStore } from "../../store/store";
import type { FC } from "react";

/** Top centre of the island page. It displays data and nothing else (spec node-49). */
const TurnPill: FC = () => {
  useSignals();

  const store = useStore();
  const turn = store.game.turn.value;
  const phase = store.game.phase.value;

  return (
    <div className="turn-pill">
      <span className="turn-pill__turn">
        {`Ход ${turn}`}
      </span>

      <span className="turn-pill__separator">
        {"·"}
      </span>

      <span className="turn-pill__phase">
        {PHASE_NAMES_RU[phase]}
      </span>
    </div>
  );
};

export { TurnPill };
