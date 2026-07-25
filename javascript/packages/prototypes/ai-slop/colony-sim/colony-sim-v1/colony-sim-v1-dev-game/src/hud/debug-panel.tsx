import { selection, type SpawnKind } from "@hw/colony-sim-v1-core";
import { useEngine } from "@hw/colony-sim-v1-hud";
import "./debug-panel.css";

const SPAWNS: readonly { kind: SpawnKind; icon: string; label: string }[] = [
  { kind: "tree", icon: "🌲", label: "tree" },
  { kind: "rock", icon: "🪨", label: "rock" },
  { kind: "chicken", icon: "🐔", label: "chicken" },
];

// A dev-only way to put things into the world by hand, instead of regenerating the
// map until it happens to contain what a change needs to be judged against. It
// lives in this app rather than in the hud package because the shipped game must
// not grow a spawn menu — and it needs no special access to do the job: spawning
// is a command like every other button's, so the panel holds the same dispatcher
// and still cannot touch the world itself.
function DebugPanel() {
  const engine = useEngine();
  // A selected tile is where things land, which makes "click, then spawn" the way
  // to aim. A selected entity is not a spot on the map, so it reads as no target
  // and the engine picks a free tile instead.
  const selected = selection.value;
  const tile = selected && selected.kind === "tile" ? { x: selected.x, y: selected.y } : null;

  return (
    <div className="panel debug-panel">
      <div className="panel-title">Debug</div>
      <div className="debug-target">{tile ? `spawn at ${tile.x}, ${tile.y}` : "spawn on a free tile"}</div>
      <div className="debug-actions">
        {SPAWNS.map((spawn) => {
          return (
            <button
              type="button"
              key={spawn.kind}
              className="hud-button debug-action"
              title={`spawn ${spawn.label}`}
              onClick={() => engine.dispatch({ type: "spawn", kind: spawn.kind, tile })}
            >
              <span className="debug-icon" aria-hidden="true">
                {spawn.icon}
              </span>
              {spawn.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { DebugPanel };
