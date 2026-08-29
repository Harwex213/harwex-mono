import { useSignals } from "@preact/signals-react/runtime";
import { BATTLE_TIME_LIMIT, aliveCount } from "../../domain/battle/simulation";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type {
  TAutoArrangeAction,
  TNextRoundAction,
  TRestartGameAction,
  TSetSpeedAction,
  TStartBattleAction,
  TTogglePauseAction,
} from "../../domain/registry";

type TControlBarRegistrySlice = {
  autoArrangeAction: TAutoArrangeAction;
  nextRoundAction: TNextRoundAction;
  restartGameAction: TRestartGameAction;
  setSpeedAction: TSetSpeedAction;
  startBattleAction: TStartBattleAction;
  togglePauseAction: TTogglePauseAction;
};

type TControlBarProps = {
  registry: TControlBarRegistrySlice;
};

const SPEEDS = [1, 2, 4];

const ControlBar: FC<TControlBarProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const phase = store.metaState.phase.value;
  const speed = store.metaState.speed.value;
  const paused = store.metaState.paused.value;
  const sim = store.battleState.sim.value;

  // Reading the tick keeps the live counters below in step with the fight.
  const tick = store.battleState.tick.value;
  const playerAlive = sim ? aliveCount(sim, "player") : 0;
  const enemyAlive = sim ? aliveCount(sim, "enemy") : 0;
  const elapsed = sim ? Math.min(BATTLE_TIME_LIMIT, Math.floor(tick / 8)) : 0;

  return (
    <div className="controls">
      {phase === "prep" && (
        <>
          <button className="button button--primary" type="button" onClick={() => registry.startBattleAction()}>
            {"Начать бой"}
          </button>

          <button className="button" type="button" onClick={() => registry.autoArrangeAction()}>
            {"Перестроить"}
          </button>

          <span className="controls__hint">
            {"Перетащите бойца в свою половину: он ходит свободно, сетка — только разметка"}
          </span>
        </>
      )}

      {phase === "battle" && (
        <>
          <button className="button" type="button" onClick={() => registry.togglePauseAction()}>
            {paused ? "Продолжить" : "Пауза"}
          </button>

          <div className="speed">
            {SPEEDS.map((value) => (
              <button
                key={value}
                className={value === speed ? "button button--tiny button--on" : "button button--tiny"}
                type="button"
                onClick={() => registry.setSpeedAction(value)}
              >
                {`${value}×`}
              </button>
            ))}
          </div>

          <span className="controls__hint">
            {`Наши: ${playerAlive} · Враги: ${enemyAlive} · ${elapsed} с из ${BATTLE_TIME_LIMIT}`}
          </span>
        </>
      )}

      {phase === "result" && (
        <button className="button button--primary" type="button" onClick={() => registry.nextRoundAction()}>
          {"Следующий раунд"}
        </button>
      )}

      {phase === "over" && (
        <button className="button button--primary" type="button" onClick={() => registry.restartGameAction()}>
          {"Начать заново"}
        </button>
      )}

      <button className="button button--ghost" type="button" onClick={() => registry.restartGameAction()}>
        {"Сброс"}
      </button>
    </div>
  );
};

export { ControlBar };
