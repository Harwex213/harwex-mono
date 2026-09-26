import { useSignals } from "@preact/signals-react/runtime";
import { BIOMES } from "../../core/exports";
import { cellDistance, moveRangeFor, revealCostFor } from "../../domain/world-actions";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TWorldCell } from "../../core/exports";
import type {
  TMoveIslandAction,
  TRevealCellAction,
  TSelectCellAction,
} from "../../domain/registry";

/**
 * The right-hand panel of the exploration page (spec node-46): everything the
 * player knows about the picked cell, and the two things the player may do with
 * it — scout it or fly there. Staying is the third option, so the panel also
 * prints what staying costs.
 */

type TCellPanelRegistrySlice = {
  selectCell: TSelectCellAction;
  revealCell: TRevealCellAction;
  moveIsland: TMoveIslandAction;
};

type TCellPanelProps = {
  registry: TCellPanelRegistrySlice;
};

const CLOSE_LABEL = "×";
const UNKNOWN_BIOME_RU = "Неизведано";
const TRAIL_LABEL_RU = "Токсичный шлейф";
const DISTANCE_LABEL_RU = "Расстояние";
const OCCUPANT_LABEL_RU = "Занят";
const NO_OCCUPANT_RU = "Никого";
const MOVE_LABEL_RU = "Лететь";
const HERE_RU = "Остров стоит здесь";
const UNREACHABLE_RU = "—";

/** The same grey the globe paints an unscouted tile with. */
const UNREVEALED_SWATCH = "#555b66";

const cellById = (cells: readonly TWorldCell[], cellId: number): TWorldCell | null => {
  return cells.find((candidate) => {
    return candidate.id === cellId;
  }) ?? null;
};

const CellPanel: FC<TCellPanelProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const selectedCellId = store.ui.selectedCellId.value;
  const cells = store.game.worldCells.value;
  const islandCellId = store.game.islandCellId.value;
  const researched = store.game.researched.value;
  const resources = store.game.resources.value;
  const moved = store.ui.explorationMoved.value;
  const players = store.game.players.value;
  const stayCost = store.derived.toxicityPoints.value;
  const cell = selectedCellId === null ? null : cellById(cells, selectedCellId);
  if (cell === null) {
    return null;
  }

  const current = cellById(cells, islandCellId);
  const isHere = cell.id === islandCellId;
  const distance = cellDistance(cells, islandCellId, cell.id);
  const revealCost = revealCostFor(researched);
  const canReveal = current !== null
    && current.neighbours.includes(cell.id)
    && cell.revealed === false
    && resources.scouting >= revealCost;
  const canMove = isHere === false && moved === false && distance > 0 && distance <= moveRangeFor(researched);
  const occupant = players.find((player) => {
    return player.id === cell.occupantId;
  });
  const biome = cell.revealed === true ? BIOMES[cell.biomeHint] : null;

  return (
    <div className="panel cell-panel">
      <button
        type="button"
        className="cell-panel__close"
        aria-label="Закрыть"
        onClick={() => registry.selectCell(null)}
      >
        {CLOSE_LABEL}
      </button>

      <div className="cell-panel__title">
        {`Гекс №${cell.id}`}
      </div>

      <div className="cell-panel__biome">
        <span
          className="cell-panel__swatch"
          style={{ background: biome === null ? UNREVEALED_SWATCH : biome.colours[0] }}
        />

        <span className="cell-panel__biome-name">
          {biome === null ? UNKNOWN_BIOME_RU : biome.nameRu}
        </span>
      </div>

      <div className="cell-panel__row">
        <span className="cell-panel__row-label">
          {TRAIL_LABEL_RU}
        </span>

        <span className="cell-panel__row-value cell-panel__row-value--toxic">
          {`☣️ ${cell.trail}`}
        </span>
      </div>

      <div className="cell-panel__row">
        <span className="cell-panel__row-label">
          {OCCUPANT_LABEL_RU}
        </span>

        <span className="cell-panel__row-value">
          {occupant === undefined ? NO_OCCUPANT_RU : occupant.nickname}
        </span>
      </div>

      <div className="cell-panel__row">
        <span className="cell-panel__row-label">
          {DISTANCE_LABEL_RU}
        </span>

        <span className="cell-panel__row-value">
          {distance < 0 ? UNREACHABLE_RU : `${distance}`}
        </span>
      </div>

      <div className="cell-panel__actions">
        <button
          type="button"
          className="cell-panel__reveal"
          disabled={canReveal === false}
          onClick={() => registry.revealCell(cell.id)}
        >
          {`Разведать (${revealCost} 🔭)`}
        </button>

        <button
          type="button"
          className="cell-panel__move"
          disabled={canMove === false}
          onClick={() => registry.moveIsland(cell.id)}
        >
          {MOVE_LABEL_RU}
        </button>
      </div>

      <div className="cell-panel__hint">
        {`Остаться: шлейф текущего гекса +${stayCost}`}
      </div>

      {isHere === false ? null : (
        <div className="cell-panel__here">
          {HERE_RU}
        </div>
      )}
    </div>
  );
};

export type { TCellPanelRegistrySlice };
export { CellPanel };
