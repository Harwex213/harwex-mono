import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";

/** Bottom popup shown while a turn ends. The line changes every few hundred ms. */
const TurnCurtain = () => {
  useSignals();

  const store = useStore();
  const message = store.gameState.turnMessage.value;

  if (message === null) {
    return null;
  }

  return (
    <div className="curtain" role="status" aria-live="polite">
      {/* The key restarts the entrance animation for every new line. */}
      <div key={message} className="curtain__line">
        {message}
      </div>
    </div>
  );
};

export { TurnCurtain };
