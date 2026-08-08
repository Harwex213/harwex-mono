import { useSignals } from "@preact/signals-react/runtime";
import { ACTOR_DEFS, BUILDING_BY_ID } from "../game/config";
import * as hud from "../game/hud";
import { game } from "../game/instance";
import type { ActorDef } from "../game/types";
import { costText } from "./format";

function ArmyPanel(): React.JSX.Element {
  useSignals();
  const built = hud.built.value;
  const wallet = { gold: hud.gold.value, wood: hud.wood.value, crystal: hud.crystal.value };
  const queue = hud.queues.value;

  return (
    <div className="panel side">
      <div className="panel-head">
        <h2>Армия</h2>
        <span className="muted">
          {hud.pop.value}/{hud.popCap.value}
        </span>
      </div>
      <div className="list">
        {ACTOR_DEFS.filter((def) => def.team === "island").map((def) => {
          const blocker = reason(def, built, wallet, hud.pop.value, hud.popCap.value);
          return (
            <button
              type="button"
              key={def.id}
              className={blocker ? "card locked" : "card"}
              onClick={() => game.queueUnit(def.id)}
            >
              <div className="card-top">
                <span className="card-name">{def.name}</span>
                <span className="card-cost">{costText(def.cost ?? {})}</span>
              </div>
              <div className="card-desc">
                {def.desc} <span className="muted">· мест: {def.pop} · {def.trainTime} сек</span>
              </div>
              {blocker ? <div className="card-blocker">{blocker}</div> : null}
            </button>
          );
        })}
      </div>

      {queue.length > 0 ? (
        <div className="queue">
          <h3>Найм</h3>
          {queue.slice(0, 6).map((order, index) => (
            <div className="queue-row" key={`${order.building}-${index}`}>
              <span>{order.name}</span>
              <div className="queue-bar">
                <div className="queue-fill" style={{ width: `${(1 - order.left / order.total) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="army-actions">
        <button
          type="button"
          className={hud.mapMode.value.kind === "rally" ? "wide active" : "wide"}
          onClick={() => (hud.mapMode.value = hud.mapMode.value.kind === "rally" ? { kind: "idle" } : { kind: "rally" })}
        >
          Точка сбора
        </button>
        <button
          type="button"
          className={hud.assault.value ? "wide danger active" : "wide danger"}
          onClick={() => game.toggleAssault()}
        >
          {hud.assault.value ? "Отозвать армию" : "Штурм босса"}
        </button>
      </div>
    </div>
  );
}

function reason(
  def: ActorDef,
  built: string[],
  wallet: { gold: number; wood: number; crystal: number },
  pop: number,
  popCap: number,
): string | null {
  if (def.producer && !built.includes(def.producer)) {
    return `Нужно: ${BUILDING_BY_ID.get(def.producer)!.name}`;
  }
  for (const required of def.requires ?? []) {
    if (!built.includes(required)) {
      return `Нужно: ${BUILDING_BY_ID.get(required)!.name}`;
    }
  }
  if (pop + (def.pop ?? 1) > popCap) {
    return "Не хватает лимита армии";
  }
  const cost = def.cost ?? {};
  if ((cost.gold ?? 0) > wallet.gold || (cost.wood ?? 0) > wallet.wood || (cost.crystal ?? 0) > wallet.crystal) {
    return "Не хватает ресурсов";
  }
  return null;
}

export { ArmyPanel };
