import { useSignals } from "@preact/signals-react/runtime";
import { BUILDING_DEFS, TERRAIN_NAMES } from "../game/config";
import * as hud from "../game/hud";
import type { BuildingDef } from "../game/types";
import { costText } from "./format";

function BuildPanel(): React.JSX.Element {
  useSignals();
  const mode = hud.mapMode.value;
  const built = hud.built.value;
  const wallet = { gold: hud.gold.value, wood: hud.wood.value, crystal: hud.crystal.value };

  return (
    <div className="panel side">
      <div className="panel-head">
        <h2>Постройки</h2>
        {mode.kind === "build" ? (
          <button type="button" className="mini" onClick={() => (hud.mapMode.value = { kind: "idle" })}>
            Отмена
          </button>
        ) : null}
      </div>
      <div className="list">
        {BUILDING_DEFS.filter((def) => def.panel).map((def) => {
          const blocker = reason(def, built, wallet);
          const note = def.terrain ? `Только на: ${def.terrain.map((kind) => TERRAIN_NAMES[kind]).join(", ")}` : null;
          const active = mode.kind === "build" && mode.id === def.id;
          return (
            <button
              type="button"
              key={def.id}
              className={active ? "card active" : blocker ? "card locked" : "card"}
              onClick={() => (hud.mapMode.value = active ? { kind: "idle" } : { kind: "build", id: def.id })}
            >
              <div className="card-top">
                <span className="card-name">{def.name}</span>
                <span className="card-cost">{costText(def.cost)}</span>
              </div>
              <div className="card-desc">{def.desc}</div>
              {note ? <div className="card-note">{note}</div> : null}
              {blocker ? <div className="card-blocker">{blocker}</div> : null}
            </button>
          );
        })}
      </div>
      <p className="hint">
        Выберите здание и поставьте его на своей земле. Правый клик — точка сбора армии, Esc — отмена.
      </p>
    </div>
  );
}

function reason(def: BuildingDef, built: string[], wallet: { gold: number; wood: number; crystal: number }): string | null {
  for (const required of def.requires) {
    if (!built.includes(required)) {
      const name = BUILDING_DEFS.find((item) => item.id === required)?.name ?? required;
      return `Нужно: ${name}`;
    }
  }
  if (def.unique && built.includes(def.id)) {
    return "Уже построено";
  }
  if ((def.cost.gold ?? 0) > wallet.gold || (def.cost.wood ?? 0) > wallet.wood || (def.cost.crystal ?? 0) > wallet.crystal) {
    return "Не хватает ресурсов";
  }
  return null;
}

export { BuildPanel };
