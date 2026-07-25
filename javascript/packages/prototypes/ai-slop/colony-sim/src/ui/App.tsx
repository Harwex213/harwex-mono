import { gameTick, colonistCount, storedWood, speed, paused } from "@/ui/signals";
import { useEngine } from "@/ui/engine-context";
import "@/ui/hud.css";

const SPEEDS = [1, 2, 3];

// DOM HUD overlaid on the pixi canvas. Reads signals (auto-subscribed by
// @preact/signals) and pushes commands back through engine.dispatch.
function App() {
  const engine = useEngine();

  return (
    <div className="hud">
      <span className="stat">tick {gameTick.value}</span>
      <span className="stat">colonists {colonistCount.value}</span>
      <span className="stat">wood {storedWood.value}</span>
      <span className="spacer" />
      <div className="controls">
        <button
          type="button"
          className={paused.value ? "active" : ""}
          onClick={() => engine.dispatch({ type: "togglePause" })}
        >
          {paused.value ? "▶" : "❚❚"}
        </button>
        {SPEEDS.map((value) => {
          return (
            <button
              type="button"
              key={value}
              className={!paused.value && speed.value === value ? "active" : ""}
              onClick={() => engine.dispatch({ type: "setSpeed", value })}
            >
              {value}×
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { App };
