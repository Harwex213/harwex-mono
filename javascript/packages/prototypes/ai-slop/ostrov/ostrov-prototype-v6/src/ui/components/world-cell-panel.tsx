import { useSignals } from "@preact/signals-react/runtime";
import { getBiome } from "../../core/biomes";
import { ICONS } from "../../core/icons";
import { eventChance } from "../../core/trail-events";
import { cellVisibility, moveCheck, scoutCheck } from "../../core/world-rules";
import { useStore } from "../../store/store";
import { Icon } from "./icon";
import type { FC } from "react";
import type { TMoveIslandAction, TScoutAction } from "../../domain/registry";

type TWorldCellPanelRegistrySlice = {
  moveIslandAction: TMoveIslandAction;
  scoutAction: TScoutAction;
};

type TWorldCellPanelProps = {
  registry: TWorldCellPanelRegistrySlice;
};

const VISIBILITY_TITLE = {
  frontier: "Неразведанный гекс",
  fogged: "Гекс в тумане",
} as const;

const KIND_TITLE = {
  void: "Облака",
  island: "Дикий остров",
  settlement: "Поселение",
} as const;

/**
 * What the selected cell is worth: the scouting report, the toxic trail left
 * in it, and the two things the spec lets a player do in this phase. Scouting
 * costs more the farther the cell is from the island.
 */
const WorldCellPanel: FC<TWorldCellPanelProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const world = store.world.world.value;
  const cell = store.derived.selectedCell.value;
  const here = store.derived.currentCell.value;
  const player = store.derived.humanPlayer.value;
  const moved = store.world.movedThisTurn.value;
  const players = store.game.players.value;
  // Scouting and the flight belong to the scout phase, before "Готов".
  const isLocked = store.game.phase.value !== "scout" || store.derived.isHumanReady.value;

  if (!world || !cell || !player || !here) {
    return null;
  }

  const isHere = cell.id === here.id;
  const visibility = cellVisibility(world, cell);
  const scout = scoutCheck(world, player.cellId, cell.id, player.resources.scouting);
  const move = moveCheck(world, player.cellId, cell.id, moved);
  const owner = cell.revealed && cell.ownerId ? players.find((candidate) => candidate.id === cell.ownerId) : null;
  const title = isHere
    ? "Ваш гекс"
    : owner
      ? `Остров: ${owner.nickname}`
      : visibility === "revealed"
        ? KIND_TITLE[cell.kind]
        : VISIBILITY_TITLE[visibility];

  return (
    <aside className="panel world-panel">
      <h2 className="world-panel__title">
        {title}
      </h2>

      <p className={`world-cell__state world-cell__state--${visibility}`}>
        {visibility === "revealed" ? "Разведан" : visibility === "frontier" ? "Можно разведать" : "Туман войны"}
        {scout.distance > 0 ? ` · перелётов до острова: ${scout.distance}` : ""}
      </p>

      {cell.revealed && cell.kind === "void" ? (
        <p className="world-panel__row">
          {"Облака над морем. Здесь пусто, но пролететь можно."}
        </p>
      ) : null}

      {cell.revealed && cell.kind === "settlement" ? (
        <p className="world-panel__row world-cell__row">
          <Icon src={ICONS.village} label="Поселение" />
          {"Поселение — скоро"}
        </p>
      ) : null}

      {cell.revealed && cell.kind === "island" ? (
        <>
          <p className="world-panel__row">
            {`Остров · ${getBiome(cell.biome).label}`}
          </p>

          <p className="world-panel__row world-cell__row">
            <Icon src={cell.cleared ? ICONS.check : ICONS.skeleton} label="Дикие острова" />
            {cell.cleared || cell.islandCount === 0 ? "Зачищен" : `Диких островов: ${cell.islandCount}`}
          </p>

          {cell.cleared || cell.islandCount === 0 ? null : (
            <p className="world-panel__hint">
              {cell.activated
                ? "Острова проснулись: зачистка в конце хода, пока стоите здесь."
                : "Прилетите сюда — острова проснутся, и в конце хода начнётся зачистка."}
            </p>
          )}
        </>
      ) : null}

      {cell.revealed ? null : (
        <p className="world-panel__row">
          {"Под туманом облака, остров или поселение. Разведка покажет, что здесь."}
        </p>
      )}

      {owner ? (
        <p className="world-panel__row world-cell__row" style={{ color: owner.color }}>
          <Icon src={ICONS.stronghold} label="Остров игрока" />
          {`Здесь стоит ${owner.nickname}`}
        </p>
      ) : null}

      {cell.revealed ? (
        <>
          <p className="world-panel__row world-panel__trail world-cell__row">
            <Icon src={ICONS.toxicity} label="Токсичный шлейф" />
            {`Токсичный шлейф: ${Math.round(cell.toxicTrail)}`}
          </p>

          <p className="world-panel__hint">
            {`Шанс события из шлейфа: ${Math.round(eventChance(cell.toxicTrail) * 100)}%`}
          </p>
        </>
      ) : null}

      <div className="world-panel__buttons">
        {cell.revealed ? null : (
          <button
            type="button"
            className="button world-cell__scout"
            disabled={isLocked || !scout.ok}
            onClick={() => registry.scoutAction(cell.id)}
          >
            {"Разведать гекс"}
            <span className="world-cell__cost">
              <Icon src={ICONS.scouting} label="Разведка" />
              {`${scout.cost}`}
            </span>
          </button>
        )}

        {cell.revealed || scout.ok ? null : (
          <p className="world-panel__hint world-cell__reason">
            {scout.reason}
          </p>
        )}

        {isHere ? null : (
          <button
            type="button"
            className="button button--primary"
            disabled={isLocked || !move.ok}
            onClick={() => registry.moveIslandAction(cell.id)}
          >
            {moved ? "Уже перелетали" : "Перелететь сюда"}
          </button>
        )}

        {isHere || move.ok || moved ? null : (
          <p className="world-panel__hint world-cell__reason">
            {move.reason}
          </p>
        )}
      </div>

      <p className="world-panel__hint">
        {`Разведка: ${player.resources.scouting}. Цена гекса растёт на 1 каждые 2 перелёта от острова.`}
      </p>

      <p className="world-panel__hint">
        {"Остался на месте — вся токсичность острова уходит в шлейф этого гекса."}
      </p>
    </aside>
  );
};

export { WorldCellPanel };
