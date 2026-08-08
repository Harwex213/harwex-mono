import { useSignals } from "@preact/signals-react/runtime";
import { SKILL_DEFS } from "../game/config";
import * as hud from "../game/hud";
import { game } from "../game/instance";

function SkillBar(): React.JSX.Element {
  useSignals();
  const ready = hud.built.value.includes("altar");
  const cooldowns = hud.skillCooldowns.value;
  const mode = hud.mapMode.value;

  return (
    <div className="skillbar panel">
      {SKILL_DEFS.map((def) => {
        const left = cooldowns[def.id];
        const disabled = !ready || left > 0;
        const active = mode.kind === "skill" && mode.id === def.id;
        return (
          <button
            type="button"
            key={def.id}
            className={active ? "skill active" : disabled ? "skill locked" : "skill"}
            title={ready ? def.desc : "Постройте алтарь на руинах"}
            onClick={() => {
              if (disabled) {
                return;
              }
              if (def.targeted) {
                hud.mapMode.value = active ? { kind: "idle" } : { kind: "skill", id: def.id };
                return;
              }
              game.cast(def.id, 0, 0);
            }}
          >
            <span className="skill-name">{def.name}</span>
            <span className="skill-sub">{left > 0 ? `${Math.ceil(left)} сек` : def.targeted ? "по точке" : "сразу"}</span>
            {left > 0 ? <div className="skill-cd" style={{ height: `${(left / def.cooldown) * 100}%` }} /> : null}
          </button>
        );
      })}
      {hud.furyLeft.value > 0 ? <div className="buff">Ярость {Math.ceil(hud.furyLeft.value)}</div> : null}
      {hud.wardLeft.value > 0 ? <div className="buff">Оберег {Math.ceil(hud.wardLeft.value)}</div> : null}
    </div>
  );
}

export { SkillBar };
