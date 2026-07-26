import { useState } from "preact/hooks";
import { DEFAULT_PLAYER, type PlayerId, selection, type SpawnKind } from "@hw/colony-sim-v1-core";
import { type Experiments, experiments, setExperiment } from "@hw/colony-sim-v1-game-render";
import { useEngine } from "@hw/colony-sim-v1-hud";
import "./debug-panel.css";

// `owner` is what a spawn belongs to, and null is the honest answer for a tree.
// Every worker joins the one colony this app runs (see main.ts): a button that
// spawned somebody else's would put a colonist on the map that nothing here can
// command and no panel accounts for.
const SPAWNS: readonly { kind: SpawnKind; owner: PlayerId | null; icon: string; label: string }[] = [
  { kind: "colonist", owner: DEFAULT_PLAYER, icon: "🧑", label: "worker" },
  { kind: "tree", owner: null, icon: "🌲", label: "tree" },
  // 🪨 is the stone *resource* here and in the HUD's stock panel, so the boulder
  // that drops it gets the landform icon instead of sharing one with its loot.
  { kind: "rock", owner: null, icon: "⛰️", label: "rock" },
  { kind: "chicken", owner: null, icon: "🐔", label: "chicken" },
  { kind: "wood", owner: null, icon: "🪵", label: "wood" },
  { kind: "stone", owner: null, icon: "🪨", label: "stone" },
  // Food is the farm's output, and this is how the haul loop gets tried without
  // waiting on a farm to grow one.
  { kind: "food", owner: null, icon: "🍗", label: "food" },
];

// The render experiments this app can switch, and what to call them on screen. The
// flags themselves belong to the renderer — they are about how the world is drawn —
// and the switch belongs here, for the same reason the spawn buttons do: the shipped
// game must not grow one, and hiding it behind a flag inside the HUD would only mean
// shipping it turned off.
const EXPERIMENTS: readonly { flag: keyof Experiments; icon: string; label: string; title: string }[] = [
  { flag: "fogOfWar", icon: "🌫️", label: "fog", title: "fog of war over the dead lands" },
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
  // Destroying is the other half of the same story: until colonists chop and mine
  // on their own, this button is what turns a standing tree or boulder into the
  // resources it drops. A selected colonist is not destructible and the sim just
  // ignores the command — the panel only checks that *something* is selected.
  const target = selected && selected.kind === "entity" ? selected.id : null;

  return (
    <div className="panel debug-panel">
      <div className="panel-title">Debug</div>
      <div className="debug-target">{tile ? `spawn at ${tile.x}, ${tile.y}` : "spawn on a free tile"}</div>
      <div className="debug-actions">
        {SPAWNS.map((spawn) => {
          return (
            <button
              type="button"
              key={spawn.label}
              className="hud-button debug-action"
              title={`spawn ${spawn.label}`}
              onClick={() => engine.dispatch({ type: "spawn", kind: spawn.kind, tile, owner: spawn.owner })}
            >
              <span className="debug-icon" aria-hidden="true">
                {spawn.icon}
              </span>
              {spawn.label}
            </button>
          );
        })}
        <button
          type="button"
          className="hud-button debug-action"
          title="destroy the selected tree or rock"
          disabled={target === null}
          onClick={() => target !== null && engine.dispatch({ type: "destroy", id: target })}
        >
          <span className="debug-icon" aria-hidden="true">
            💥
          </span>
          destroy
        </button>
      </div>
      <div className="debug-group-title">Experiments</div>
      <div className="debug-actions">
        {EXPERIMENTS.map((experiment) => {
          return <ExperimentSwitch key={experiment.flag} {...experiment} />;
        })}
      </div>
    </div>
  );
}

// One flag, one button. The flags are plain module state the renderer looks at every
// frame rather than a signal — they are not world state and not something the DOM HUD
// reads — so the button keeps the copy it renders from. That is honest here and only
// here: this panel is the only thing that ever writes them.
function ExperimentSwitch(
  { flag, icon, label, title }: { flag: keyof Experiments; icon: string; label: string; title: string },
) {
  const [on, setOn] = useState(experiments[flag]);

  return (
    <button
      type="button"
      className={on ? "hud-button debug-action active" : "hud-button debug-action"}
      aria-pressed={on}
      title={title}
      onClick={() => {
        setExperiment(flag, !on);
        setOn(!on);
      }}
    >
      <span className="debug-icon" aria-hidden="true">
        {icon}
      </span>
      {label}
    </button>
  );
}

export { DebugPanel };
