import { useSignals } from "@preact/signals-react/runtime";
import * as hud from "../game/hud";
import { game } from "../game/instance";
import { clock, ICONS } from "./format";

function TopBar(): React.JSX.Element {
  useSignals();
  const coreRatio = hud.coreHp.value / hud.coreMaxHp.value;
  const waveLabel = hud.waveRunning.value ? `Волна ${hud.wave.value} идёт` : `Волна ${hud.wave.value + 1} через`;

  return (
    <div className="topbar panel">
      <div className="resources">
        <Resource icon={ICONS.gold} value={hud.gold.value} rate={hud.goldRate.value} title="Золото" />
        <Resource icon={ICONS.wood} value={hud.wood.value} rate={hud.woodRate.value} title="Дерево" />
        <Resource icon={ICONS.crystal} value={hud.crystal.value} rate={hud.crystalRate.value} title="Кристаллы" />
        <div className="resource" title="Армия и лимит">
          <span className="resource-icon">⚔️</span>
          <span className={hud.pop.value >= hud.popCap.value ? "resource-value warn" : "resource-value"}>
            {hud.pop.value}/{hud.popCap.value}
          </span>
        </div>
      </div>

      <div className="wave-block">
        <div className="wave-line">
          <span className={hud.waveRunning.value ? "wave-label hot" : "wave-label"}>{waveLabel}</span>
          <span className="wave-timer">{hud.waveRunning.value ? `врагов: ${hud.enemyCount.value}` : clock(hud.waveTimer.value)}</span>
          <button
            type="button"
            className="mini"
            disabled={hud.waveRunning.value}
            title="Вызвать волну сейчас: награда за убитых больше на 40%"
            onClick={() => game.callWave()}
          >
            Вызвать
          </button>
        </div>
        <div className="core-bar" title={`Ядро: ${hud.coreHp.value} / ${hud.coreMaxHp.value}`}>
          <div className="core-fill" style={{ width: `${Math.max(0, coreRatio) * 100}%` }} />
          <span className="core-text">Ядро {hud.coreHp.value}</span>
        </div>
      </div>

      <div className="speed">
        <span className="timer">{clock(hud.elapsed.value)}</span>
        {[0, 1, 2, 3].map((value) => (
          <button
            type="button"
            key={value}
            className={hud.speed.value === value ? "mini active" : "mini"}
            onClick={() => game.setSpeed(value)}
          >
            {value === 0 ? "❚❚" : `${value}×`}
          </button>
        ))}
      </div>
    </div>
  );
}

function Resource({
  icon,
  value,
  rate,
  title,
}: {
  icon: string;
  value: number;
  rate: number;
  title: string;
}): React.JSX.Element {
  return (
    <div className="resource" title={`${title}: +${rate}/сек`}>
      <span className="resource-icon">{icon}</span>
      <span className="resource-value">{value}</span>
      <span className="resource-rate">+{Math.round(rate * 10) / 10}</span>
    </div>
  );
}

export { TopBar };
