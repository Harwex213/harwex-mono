import { useSignals } from "@preact/signals-react/runtime";
import { useEffect } from "react";
import { BattleBanner, BattleCanvas, BattleHud } from "../battle-canvas/battle-canvas";
import { EndTurnPanel } from "../components/end-turn-panel";
import { PlayersPanel } from "../components/players-panel";
import { TurnPill } from "../components/turn-pill";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TAppRegistry } from "../../domain/registry";

/**
 * The clearing phase (plan §3.8). The battle canvas fills the page and the same
 * panels as the island and world pages float over it at the same positions, so
 * the four phases read as one screen.
 */

type TBattlePageProps = {
  registry: TAppRegistry;
};

const RETREAT_LABEL_RU = "Отступить";

const BattlePage: FC<TBattlePageProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const toast = store.ui.toast.value;

  // A hard reload lands on `#/battle` with no level. The phase still says
  // `clearing`, so the level is rebuilt here rather than left empty.
  useEffect(() => {
    if (store.game.phase.peek() !== "clearing") {
      return;
    }

    if (store.game.battle.peek() !== null) {
      return;
    }

    registry.startBattle();
  }, [registry, store]);

  return (
    <div className="battle-page">
      <div className="battle-page__canvas-slot">
        <BattleCanvas registry={registry} />
      </div>

      <PlayersPanel registry={registry} />

      <TurnPill />

      <BattleHud />

      <EndTurnPanel registry={registry} />

      <button
        type="button"
        className="battle-page__retreat"
        onClick={() => registry.retreat()}
      >
        {RETREAT_LABEL_RU}
      </button>

      <BattleBanner />

      {toast === null ? null : (
        <div className="battle-page__toast">
          {toast}
        </div>
      )}
    </div>
  );
};

export { BattlePage };
