import { useEngine } from "./engine-context";
import { clockOwned, colonistCount, colonistsOpen, paused, speed } from "@hw/colony-sim-v1-core";
import { BuildMenu } from "./build-menu";

const SPEEDS = [1, 2, 3];

// The bottom strip: panel tabs on the left, building in the middle, time controls on
// the right. Every button only dispatches — the same commands the hotkeys send, so
// keyboard and mouse can never disagree about the state.
//
// The time controls are the one group that can be somebody else's: in a networked game
// there is one clock and the host holds it. They stay on screen for a guest — the game
// really is paused, and the readout is the point — and go disabled, because a button that
// answered nothing would read as broken rather than as a decision made elsewhere.
function BottomBar() {
  const engine = useEngine();
  const isPaused = paused.value;
  const ownsClock = clockOwned.value;
  const rosterOpen = colonistsOpen.value;
  const count = colonistCount.value;

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
          <span className="tab-count">{count}</span>
        </button>
      </div>

      <BuildMenu />

      <div className="bar-group">
        <button
          type="button"
          className={isPaused ? "hud-button active" : "hud-button"}
          disabled={!ownsClock}
          aria-label={isPaused ? "resume" : "pause"}
          title={ownsClock ? (isPaused ? "resume (space)" : "pause (space)") : "the host holds the clock"}
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
              disabled={!ownsClock}
              aria-label={`speed ${value}×`}
              title={ownsClock ? `speed ${value}× (${value})` : "the host holds the clock"}
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
