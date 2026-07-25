import { useEngine } from "./engine-context";
import { colonistCount, colonistsOpen, paused, speed } from "@hw/colony-sim-v1-core";

const SPEEDS = [1, 2, 3];

// The bottom strip: panel tabs on the left, time controls on the right. Every
// button only dispatches — the same commands the hotkeys send, so keyboard and
// mouse can never disagree about the state.
function BottomBar() {
  const engine = useEngine();
  const isPaused = paused.value;
  const rosterOpen = colonistsOpen.value;

  return (
    <div className="bottom-bar">
      <div className="bar-group">
        <button
          type="button"
          className={rosterOpen ? "hud-button tab active" : "hud-button tab"}
          aria-pressed={rosterOpen}
          title="colonists (c)"
          onClick={() => engine.dispatch({ type: "toggleColonists" })}
        >
          colonists
          <span className="tab-count">{colonistCount.value}</span>
        </button>
      </div>

      <div className="bar-group">
        <button
          type="button"
          className={isPaused ? "hud-button active" : "hud-button"}
          aria-label={isPaused ? "resume" : "pause"}
          title={isPaused ? "resume (space)" : "pause (space)"}
          onClick={() => engine.dispatch({ type: "togglePause" })}
        >
          {isPaused ? "▶" : "❚❚"}
        </button>
        {SPEEDS.map((value) => {
          return (
            <button
              type="button"
              key={value}
              className={!isPaused && speed.value === value ? "hud-button active" : "hud-button"}
              aria-label={`speed ${value}×`}
              title={`speed ${value}× (${value})`}
              onClick={() => engine.dispatch({ type: "setSpeed", value })}
            >
              {value}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { BottomBar };
