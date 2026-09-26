import { useSignals } from "@preact/signals-react/runtime";
import { getPhase } from "../../core/phases";
import { useStore } from "../../store/store";

/** The turn panel only displays data, as the spec says. */
const TurnPanel = () => {
  useSignals();
  const store = useStore();
  const turn = store.game.turn.value;
  const phase = store.game.phase.value;

  return (
    <div className="panel turn-panel">
      <div className="turn-panel__turn">
        {`Ход ${turn}`}
      </div>

      <div className="turn-panel__phase">
        {getPhase(phase).label}
      </div>
    </div>
  );
};

export { TurnPanel };
