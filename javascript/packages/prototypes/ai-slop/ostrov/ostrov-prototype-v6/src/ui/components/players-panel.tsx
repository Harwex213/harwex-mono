import { useSignals } from "@preact/signals-react/runtime";
import { ICONS } from "../../core/icons";
import { hasStronghold, STRONGHOLD_LABEL } from "../../core/stronghold";
import { useStore } from "../../store/store";
import { Icon } from "./icon";
import type { FC } from "react";
import type { TNavigateToIslandAction } from "../../domain/registry";

type TPlayersPanelRegistrySlice = {
  navigateToIslandAction: TNavigateToIslandAction;
};

type TPlayersPanelProps = {
  registry: TPlayersPanelRegistrySlice;
};

/**
 * Nickname, army, buildings and technologies per player. Clicking a rival
 * opens their island read-only. Before the game starts the rows cannot be
 * picked, and each row shows a check mark once that player's stronghold
 * stands. In play the same check marks show who has pressed "Готов" in the
 * current phase, from the first ready player until the phase moves on.
 */
const PlayersPanel: FC<TPlayersPanelProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const players = store.game.players.value;
  const humanId = store.game.humanPlayerId.value;
  const viewedId = store.derived.viewedPlayer.value?.id ?? null;
  const isSetup = store.game.stage.value !== "play";
  const ready = store.game.ready.value;
  const showChecks = isSetup || ready.length > 0;

  return (
    <div className="panel players-panel">
      {players.map((player) => {
        const buildings = player.island.hexes.filter((hex) => hex.building !== null).length;
        const isViewed = player.id === viewedId;
        const isDone = isSetup ? hasStronghold(player) : ready.includes(player.id);
        const doneTitle = isSetup ? `${STRONGHOLD_LABEL} поставлена` : "Готов";
        const pendingTitle = isSetup ? `${STRONGHOLD_LABEL} ещё не поставлена` : "Ещё не готов";

        return (
          <button
            key={player.id}
            type="button"
            className={`player-row ${isViewed ? "player-row--viewed" : ""}`}
            disabled={isSetup}
            onClick={() => registry.navigateToIslandAction(player.id === humanId ? null : player.id)}
          >
            <span className="player-row__banner" style={{ background: player.color }} />

            <span className="player-row__body">
              <span className="player-row__nickname" style={{ color: player.color }}>
                {player.nickname}
              </span>

              <span className="player-row__stats">
                <span title="армия">
                  {player.army}
                  <Icon src={ICONS.army} />
                </span>

                <span title="здания">
                  {buildings}
                  <Icon src={ICONS.building} />
                </span>

                <span title="технологии">
                  {player.techs}
                  <Icon src={ICONS.science} />
                </span>
              </span>
            </span>

            {showChecks ? (
              <span
                className={`player-row__check ${isDone ? "player-row__check--done" : ""}`}
                title={isDone ? doneTitle : pendingTitle}
              >
                {isDone ? <Icon src={ICONS.check} size="m" /> : null}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
};

export { PlayersPanel };
