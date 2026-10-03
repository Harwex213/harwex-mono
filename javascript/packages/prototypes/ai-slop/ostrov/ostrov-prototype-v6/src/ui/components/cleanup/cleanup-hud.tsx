import { useSignals } from "@preact/signals-react/runtime";
import { ICONS } from "../../../core/icons";
import { getEnemy, getUnit } from "../../../core/units";
import { useStore } from "../../../store/store";
import { Icon } from "../icon";
import type { FC } from "react";
import type { TIslandState } from "../../../core/cleanup-sim";
import type { TUnitId } from "../../../core/units";
import type { TSetCleanupSpeedAction, TToggleCleanupPauseAction } from "../../../domain/registry";

/** Three HUD panels of the cleanup phase: the army, the enemy islands, the controls. */

const STATE_LABEL: Readonly<Record<TIslandState, string>> = {
  active: "",
  cleared: "зачищен",
  sinking: "тонет",
  sunk: "затонул",
};

const countKinds = (roster: readonly TUnitId[]) => {
  const counts = new Map<TUnitId, number>();
  for (const kind of roster) {
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }

  return [...counts.entries()];
};

/** Who came to fight, and how many of each still stand. */
const CleanupArmyPanel: FC = () => {
  useSignals();
  const store = useStore();
  const hud = store.battle.hud.value;
  const roster = store.battle.roster.value;

  if (!hud) {
    return null;
  }

  return (
    <div className="panel cleanup-panel cleanup-army">
      <div className="cleanup-panel__head">
        <Icon src={ICONS.army} size="m" />
        <span className="cleanup-panel__title">
          {"Армия"}
        </span>
        <span className="cleanup-panel__count">
          {`${hud.aliveTotal} / ${roster.length}`}
        </span>
      </div>

      <div className="cleanup-army__row">
        <Icon src={ICONS.stronghold} size="m" />
        <span className="cleanup-army__label">
          {hud.strongholdPct >= 0 ? `Постройки · твердыня ${hud.strongholdPct}%` : "Постройки"}
        </span>
        <span className="cleanup-army__alive">
          {`${hud.buildingsStanding}`}
        </span>
        <span className="cleanup-army__dead">
          {hud.buildingsTotal > hud.buildingsStanding ? `−${hud.buildingsTotal - hud.buildingsStanding}` : ""}
        </span>
      </div>

      {roster.length === 0 ? (
        <div className="cleanup-panel__empty">
          {"Некого выставить: армию набирают из населения."}
        </div>
      ) : null}

      {countKinds(roster).map(([kind, total]) => {
        const unit = getUnit(kind);
        const alive = hud.alive[kind] ?? 0;
        const dead = total - alive;

        return (
          <div className={`cleanup-army__row ${alive === 0 ? "cleanup-army__row--gone" : ""}`} key={kind}>
            <Icon src={unit.icon} size="m" />
            <span className="cleanup-army__label">
              {unit.label}
            </span>
            <span className="cleanup-army__alive">
              {`${alive}`}
            </span>
            <span className="cleanup-army__dead">
              {dead > 0 ? `−${dead}` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
};

/** The enemy islands of the level and what is left on each. */
const CleanupIslandsPanel: FC = () => {
  useSignals();
  const store = useStore();
  const hud = store.battle.hud.value;

  if (!hud) {
    return null;
  }

  const remaining = hud.islands.filter((island) => island.state === "active").length;

  return (
    <div className="panel cleanup-panel cleanup-islands">
      <div className="cleanup-panel__head">
        <Icon src={ICONS.skeleton} size="m" />
        <span className="cleanup-panel__title">
          {"Острова врага"}
        </span>
        <span className="cleanup-panel__count">
          {`${remaining} / ${hud.islands.length}`}
        </span>
      </div>

      {hud.islands.length === 0 ? (
        <div className="cleanup-panel__empty">
          {"Море вокруг чистое: здесь нечего зачищать."}
        </div>
      ) : null}

      {hud.islands.map((island) => (
        <div className={`cleanup-islands__row cleanup-islands__row--${island.state}`} key={island.id}>
          <div className="cleanup-islands__line">
            <span className="cleanup-islands__label">
              {island.label}
            </span>

            {island.state === "active" ? (
              <span className="cleanup-islands__alive">
                {`${island.alive} / ${island.total}`}
              </span>
            ) : (
              <span className="cleanup-islands__state">
                <Icon src={ICONS.check} />
                {STATE_LABEL[island.state]}
              </span>
            )}
          </div>

          <div className="cleanup-islands__line cleanup-islands__line--dim">
            <span className="cleanup-islands__kinds">
              {island.kinds.map((kind) => (
                <Icon key={kind} src={getEnemy(kind).icon} label={getEnemy(kind).label} />
              ))}
            </span>

            <span className="cleanup-islands__reward">
              {`+${island.reward} гекс.`}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
};

type TCleanupControlsRegistrySlice = {
  setCleanupSpeedAction: TSetCleanupSpeedAction;
  toggleCleanupPauseAction: TToggleCleanupPauseAction;
};

type TCleanupControlsProps = {
  registry: TCleanupControlsRegistrySlice;
};

/** The key hints and the clock: 1x, 2x and pause. */
const CleanupControlsPanel: FC<TCleanupControlsProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const speed = store.battle.speed.value;
  const paused = store.battle.paused.value;
  const hud = store.battle.hud.value;

  return (
    <div className="panel cleanup-panel cleanup-controls">
      <div className="cleanup-controls__clock">
        <button
          type="button"
          className={`button cleanup-controls__button ${!paused && speed === 1 ? "cleanup-controls__button--on" : ""}`}
          onClick={() => {
            registry.setCleanupSpeedAction(1);
            if (paused) {
              registry.toggleCleanupPauseAction();
            }
          }}
        >
          {"1×"}
        </button>

        <button
          type="button"
          className={`button cleanup-controls__button ${!paused && speed === 2 ? "cleanup-controls__button--on" : ""}`}
          onClick={() => {
            registry.setCleanupSpeedAction(2);
            if (paused) {
              registry.toggleCleanupPauseAction();
            }
          }}
        >
          {"2×"}
        </button>

        <button
          type="button"
          className={`button cleanup-controls__button ${paused ? "cleanup-controls__button--on" : ""}`}
          onClick={registry.toggleCleanupPauseAction}
        >
          {paused ? "Продолжить" : "Пауза"}
        </button>
      </div>

      <div className="cleanup-controls__hints">
        <span>
          <kbd>{"WASD"}</kbd>
          {" / стрелки — вести остров"}
        </span>
        <span>
          <kbd>{"Колесо"}</kbd>
          {" — масштаб"}
        </span>
        <span>
          <kbd>{"Пробел"}</kbd>
          {" — пауза, "}
          <kbd>{"1"}</kbd>
          {" "}
          <kbd>{"2"}</kbd>
          {" — скорость"}
        </span>
        <span className="cleanup-controls__hint-dim">
          {"Подведите остров вплотную: войска сражаются сами."}
        </span>
        <span className="cleanup-controls__hint-dim">
          {"Уйти из боя можно только за край карты: держите остров в полосе «Отступление». Кто стоит на чужих островах, останется там."}
        </span>
      </div>

      {hud && hud.retreatProgress > 0 ? (
        <div className="cleanup-retreat">
          {hud.inRetreatBand ? "Отступление" : "Отступление прервано"}
          <div className="cleanup-retreat__bar">
            <div className="cleanup-retreat__fill" style={{ width: `${Math.round(hud.retreatProgress * 100)}%` }} />
          </div>
        </div>
      ) : null}
    </div>
  );
};

export { CleanupArmyPanel, CleanupControlsPanel, CleanupIslandsPanel };
