import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
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
 * opens their island read-only.
 */
const PlayersPanel: FC<TPlayersPanelProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const players = store.game.players.value;
  const humanId = store.game.humanPlayerId.value;
  const viewedId = store.derived.viewedPlayer.value?.id ?? null;

  return (
    <div className="panel players-panel">
      {players.map((player) => {
        const buildings = player.island.hexes.filter((hex) => hex.building !== null).length;
        const isViewed = player.id === viewedId;

        return (
          <button
            key={player.id}
            type="button"
            className={`player-row ${isViewed ? "player-row--viewed" : ""}`}
            onClick={() => registry.navigateToIslandAction(player.id === humanId ? null : player.id)}
          >
            <span className="player-row__banner" style={{ background: player.color }} />

            <span className="player-row__body">
              <span className="player-row__nickname" style={{ color: player.color }}>
                {player.nickname}
              </span>

              <span className="player-row__stats">
                <span title="армия">
                  {`${player.army} ⚔️`}
                </span>

                <span title="здания">
                  {`${buildings} 🏠`}
                </span>

                <span title="технологии">
                  {`${player.techs} 📖`}
                </span>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
};

export { PlayersPanel };
