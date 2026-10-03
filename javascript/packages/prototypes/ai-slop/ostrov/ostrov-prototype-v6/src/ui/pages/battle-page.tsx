import { useSignals } from "@preact/signals-react/runtime";
import { CleanupCanvas } from "../components/cleanup/cleanup-canvas";
import { CleanupArmyPanel, CleanupControlsPanel, CleanupIslandsPanel } from "../components/cleanup/cleanup-hud";
import { CleanupSummary } from "../components/cleanup/cleanup-summary";
import { EndTurnPanel } from "../components/end-turn-panel";
import { NoticeToast } from "../components/notice-toast";
import { PlayersPanel } from "../components/players-panel";
import { TurnPanel } from "../components/turn-panel";
import { WaitingOverlay } from "../components/waiting-overlay";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TAppRegistry } from "../../domain/registry";

type TBattlePageProps = {
  registry: TAppRegistry;
};

/**
 * The cleanup phase. The player steers their island with WASD into the enemy
 * hex islands of the level; the units fight on their own. "Готов" ends the
 * level early; the results modal then hands the turn on.
 */
const BattlePage: FC<TBattlePageProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const sim = store.battle.sim.value;
  const result = store.battle.result.value;
  const isWaiting = store.derived.isHumanReady.value;
  // The players list takes the army's place while anyone is ready, so the
  // check marks fill in here as on the other pages.
  const showPlayers = store.game.ready.value.length > 0;

  // "Готов" opens only once the battle has ended: by victory, by defeat or by
  // a retreat through the map border. Until then the wheel is locked.
  const isBattleOver = result !== null;
  const endTurnSlice = {
    endPhaseAction: isBattleOver ? registry.endPhaseAction : () => undefined,
    skipTaxAnimationAction: registry.skipTaxAnimationAction,
  };

  return (
    <div className={`island-page battle-page ${isWaiting ? "island-page--waiting" : ""}`}>
      {sim ? <CleanupCanvas registry={registry} /> : null}

      <div className="island-page__top-center">
        <TurnPanel />
      </div>

      <div className="cleanup-page__left">
        {showPlayers ? <PlayersPanel registry={registry} /> : <CleanupArmyPanel />}
      </div>

      <div className="cleanup-page__right">
        <CleanupIslandsPanel />
      </div>

      <div className="island-page__bottom">
        <CleanupControlsPanel registry={registry} />

        <div
          className={`cleanup-end ${isBattleOver ? "" : "cleanup-end--locked"}`}
          title={isBattleOver ? undefined : "Бой идёт. Уйти можно только за край карты."}
          aria-disabled={!isBattleOver}
          inert={!isBattleOver}
        >
          <EndTurnPanel registry={endTurnSlice} />
        </div>
      </div>

      {/* The results stay hidden while the player waits; taking "Готов" back brings them again. */}
      {isWaiting ? null : <CleanupSummary registry={registry} />}

      <WaitingOverlay />

      <NoticeToast />
    </div>
  );
};

export { BattlePage };
