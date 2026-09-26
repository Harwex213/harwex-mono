import { useSignals } from "@preact/signals-react/runtime";
import { getBiome } from "../../core/biomes";
import { eventChance } from "../../core/trail-events";
import { SCOUT_COST } from "../../domain/world-actions";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TMoveIslandAction, TScoutAction } from "../../domain/registry";

type TWorldCellPanelRegistrySlice = {
  moveIslandAction: TMoveIslandAction;
  scoutAction: TScoutAction;
};

type TWorldCellPanelProps = {
  registry: TWorldCellPanelRegistrySlice;
};

/**
 * What the selected cell is worth: the scouting report, the toxic trail left
 * in it, and the two things the spec lets a player do in this phase.
 */
const WorldCellPanel: FC<TWorldCellPanelProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const cell = store.derived.selectedCell.value;
  const here = store.derived.currentCell.value;
  const player = store.derived.humanPlayer.value;
  const moved = store.world.movedThisTurn.value;
  const players = store.game.players.value;

  if (!cell || !player || !here) {
    return null;
  }

  const isHere = cell.id === here.id;
  const isNeighbor = here.neighbors.includes(cell.id);
  const owner = cell.ownerId ? players.find((candidate) => candidate.id === cell.ownerId) : null;

  return (
    <aside className="panel world-panel">
      <h2 className="world-panel__title">
        {isHere ? "Ваш гекс" : cell.revealed ? "Разведанный гекс" : "Неразведанный гекс"}
      </h2>

      {cell.revealed ? (
        <>
          <p className="world-panel__row">
            {`Биом: ${getBiome(cell.biome).label}`}
          </p>

          <p className="world-panel__row">
            {`Островов: ${cell.islandCount}`}
          </p>
        </>
      ) : (
        <p className="world-panel__row">
          {"Ничего не известно. Разведка покажет биом и число островов."}
        </p>
      )}

      {owner ? (
        <p className="world-panel__row" style={{ color: owner.color }}>
          {`Здесь стоит ${owner.nickname}`}
        </p>
      ) : null}

      <p className="world-panel__row world-panel__trail">
        {`Токсичный шлейф: ${Math.round(cell.toxicTrail)}`}
      </p>

      <p className="world-panel__hint">
        {`Шанс события из шлейфа: ${Math.round(eventChance(cell.toxicTrail) * 100)}%`}
      </p>

      <div className="world-panel__buttons">
        <button
          type="button"
          className="button"
          disabled={player.resources.scouting < SCOUT_COST}
          onClick={registry.scoutAction}
        >
          {`Разведать соседей (🔭 ${SCOUT_COST})`}
        </button>

        <button
          type="button"
          className="button button--primary"
          disabled={!isNeighbor || moved}
          onClick={() => registry.moveIslandAction(cell.id)}
        >
          {moved ? "Уже перелетали" : "Перелететь сюда"}
        </button>
      </div>

      <p className="world-panel__hint">
        {"Остался на месте — вся токсичность острова уходит в шлейф этого гекса."}
      </p>
    </aside>
  );
};

export { WorldCellPanel };
