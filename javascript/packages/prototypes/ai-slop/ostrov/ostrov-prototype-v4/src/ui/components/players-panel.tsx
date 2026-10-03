import { useSignals } from "@preact/signals-react/runtime";
import { HUMAN_PLAYER_ID, useStore } from "../../store/store";
import type { FC } from "react";
import type { TIsland, TPlayer } from "../../core/exports";
import type { TNavigateAction } from "../../domain/registry";

/**
 * The four rows of `01-spec-image-3.png`: a coloured pennant, the nickname in
 * that colour, a status glyph, and the three counters underneath. Clicking a row
 * opens that player's island; a foreign island opens readonly (spec node-58).
 */

type TPlayersPanelRegistrySlice = {
  navigate: TNavigateAction;
};

type TPlayersPanelProps = {
  registry: TPlayersPanelRegistrySlice;
};

const HUMAN_STATUS_GLYPH = "⏳";
const AI_STATUS_GLYPH = "🤖";

/** The human's own counters are live state, not the stored snapshot the AI rows use. */
const countBuildings = (island: TIsland | null): number => {
  if (island === null) {
    return 0;
  }

  return Object.values(island.hexes).filter((hex) => hex.building !== null).length;
};

const PlayersPanel: FC<TPlayersPanelProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const players = store.game.players.value;
  const islands = store.game.islands.value;
  const researchedCount = store.game.researched.value.length;
  const viewedPlayerId = store.derived.viewedPlayerId.value;

  const countsFor = (player: TPlayer) => {
    if (!player.isHuman) {
      return { buildings: player.buildingCount, techs: player.techCount };
    }

    return { buildings: countBuildings(islands[player.id] ?? null), techs: researchedCount };
  };

  return (
    <div className="panel players-panel">
      {players.map((player) => {
        const counts = countsFor(player);
        const isViewed = player.id === viewedPlayerId;
        const rowClass = isViewed ? "players-panel__row players-panel__row--viewed" : "players-panel__row";

        return (
          <button
            key={player.id}
            type="button"
            className={rowClass}
            data-player={player.id}
            onClick={() => registry.navigate("island", player.id === HUMAN_PLAYER_ID ? null : player.id)}
          >
            <span className="players-panel__pennant" style={{ background: player.colour }} />

            <span className="players-panel__body">
              <span className="players-panel__name" style={{ color: player.colour }}>
                {player.nickname}
              </span>

              <span className="players-panel__counters">
                <span className="players-panel__counter">
                  {`⚔ ${player.army}`}
                </span>

                <span className="players-panel__counter">
                  {`🏠 ${counts.buildings}`}
                </span>

                <span className="players-panel__counter">
                  {`🏆 ${counts.techs}`}
                </span>
              </span>
            </span>

            <span className="players-panel__status">
              {player.isHuman ? HUMAN_STATUS_GLYPH : AI_STATUS_GLYPH}
            </span>
          </button>
        );
      })}
    </div>
  );
};

export type { TPlayersPanelRegistrySlice };
export { PlayersPanel };
