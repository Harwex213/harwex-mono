import { useSignals } from "@preact/signals-react/runtime";
import { BattleArena } from "../components/battle-arena";
import { EndTurnPanel } from "../components/end-turn-panel";
import { NoticeToast } from "../components/notice-toast";
import { TurnPanel } from "../components/turn-panel";
import { getUnit } from "../../core/units";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TAppRegistry } from "../../domain/registry";

type TBattlePageProps = {
  registry: TAppRegistry;
};

/**
 * The clearing phase. The player drives their island with WASD into the other
 * islands of the level; the units fight on their own.
 */
const BattlePage: FC<TBattlePageProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const battle = store.battle.battle.value;
  const roster = store.battle.roster.value;

  if (!battle) {
    return null;
  }

  const ourUnits = battle.units.filter((unit) => unit.side === "player");
  const enemyUnits = battle.units.filter((unit) => unit.side === "enemy");
  const annexed = battle.islands.filter((island) => island.annexed).length;

  return (
    <div className="island-page battle-page">
      <BattleArena registry={registry} />

      <div className="island-page__top-center">
        <TurnPanel />
      </div>

      <div className="panel battle-hud">
        <div className="battle-hud__row">
          {`Наши: ${ourUnits.length} / ${roster.length}`}
        </div>

        <div className="battle-hud__row">
          {`Враги: ${enemyUnits.length}`}
        </div>

        <div className="battle-hud__row">
          {`Островов присоединено: ${annexed} / ${battle.islands.length}`}
        </div>

        <div className="battle-hud__row battle-hud__row--dim">
          {`Гексов получено: ${battle.annexedHexes}`}
        </div>

        <div className="battle-hud__hint">
          {"WASD — вести остров"}
        </div>
      </div>

      <div className="panel battle-roster">
        {[...new Set(roster)].map((unitId) => {
          const unit = getUnit(unitId);
          const alive = ourUnits.filter((candidate) => candidate.kind === unitId).length;

          return (
            <div className="battle-roster__row" key={unitId}>
              <span>
                {`${unit.emoji} ${unit.label}`}
              </span>

              <span className="battle-roster__count">
                {alive}
              </span>
            </div>
          );
        })}
      </div>

      <div className="island-page__bottom">
        <EndTurnPanel registry={registry} />
      </div>

      {battle.status !== "running" ? (
        <div className="modal-backdrop">
          <div className="panel modal">
            <h2 className="modal__title">
              {battle.status === "won" ? "Уровень зачищен" : "Остров потерял всех"}
            </h2>

            <p className="modal__text">
              {battle.status === "won"
                ? `Присоединено островов: ${annexed}. Остров вырастет на ${battle.annexedHexes} гексов.`
                : "Армия кончилась. Остров уходит зализывать раны, гексы остаются за врагом."}
            </p>

            <div className="modal__buttons">
              <button type="button" className="button button--primary" onClick={registry.endPhaseAction}>
                {"Следующий ход"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <NoticeToast />
    </div>
  );
};

export { BattlePage };
