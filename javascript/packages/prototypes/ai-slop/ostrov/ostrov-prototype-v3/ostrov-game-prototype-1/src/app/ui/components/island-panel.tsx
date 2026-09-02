import { DIRECTION_LABELS, ENGINE_HALF_COST, engineOf, engineSteps, isBuilt, isBuildingUnlocked, islandMoveBlocker, touchingIslands } from "../../../core/exports";
import { ISLAND_TYPE_LABELS } from "@hw/ostrov-island-system";
import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TInvestEngineAction, TMoveIslandAction } from "../../domain/registry";

const INVEST_STEP = 10;

type TIslandPanelRegistrySlice = {
  investEngineAction: TInvestEngineAction;
  moveIslandAction: TMoveIslandAction;
};

type TIslandPanelProps = {
  registry: TIslandPanelRegistrySlice;
};

/** Home island, the shared engine with its two halves, and the six move buttons. */
const IslandPanel: FC<TIslandPanelProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const game = store.game.value;
  const activePlayer = store.ui.activePlayer.value;
  const home = game.islands.find((island) => island.home)!;
  const engine = engineOf(game);
  const ready = engine !== null && isBuilt(engine);
  const planning = game.phase === "planning";
  const touching = touchingIslands(game).map((id) => game.islands.find((island) => island.id === id)!);
  const seat = game.players[activePlayer];
  const selectedTileId = store.ui.selectedTileId.value;
  const selectedIsland = selectedTileId === null ? null : game.islands.find((island) => island.id === game.tiles[selectedTileId]?.islandId) ?? null;

  return (
    <div className="stack">
      <div className="card">
        <div className="card__title">⌂ {home.name} · родной остров</div>
        <div className="row">
          <span>{ISLAND_TYPE_LABELS[home.type]}</span>
          <span className="muted">{home.tileIds.length} гексов</span>
        </div>
        <div className="muted">
          {touching.length === 0 ? "Не касается других островов. Юниты не покинут его без плотов или двигателя." : `Касается: ${touching.map((island) => island.name).join(", ")}. Юниты могут переходить.`}
        </div>
      </div>

      <div className="card">
        <div className="card__title">⚙ Двигатель острова</div>

        {engine === null ? (
          <p className="card__text">
            {isBuildingUnlocked(game.research, "engine")
              ? "Не заложен. Поставьте строй-отряд на гекс родного острова и выберите «Двигатель острова»."
              : "Открывается технологией «Инженерия». Двигатель — единственный способ двигать остров к соседям."}
          </p>
        ) : (
          <>
            <p className="card__text">Две половины. Каждый игрок вкладывает производство в свою, в любом порядке и в любом темпе.</p>
            {(["p1", "p2"] as const).map((player) => {
              const half = engine.engineHalves![player];
              const own = player === activePlayer;
              const canInvest = planning && own && half < ENGINE_HALF_COST && seat.production > 0;

              return (
                <div key={player} className="halves__row">
                  <span style={{ color: game.players[player].accent }}>{game.players[player].name}</span>
                  <div className="bar">
                    <div className="bar__fill" style={{ width: `${(half / ENGINE_HALF_COST) * 100}%`, background: game.players[player].accent }} />
                  </div>
                  <span className="muted">
                    {half}/{ENGINE_HALF_COST}
                  </span>
                  <button
                    className="btn btn--small"
                    disabled={!canInvest}
                    title={own ? `Вложить до ${INVEST_STEP} производства (есть ${seat.production})` : "Переключитесь на этого игрока"}
                    onClick={() => registry.investEngineAction(INVEST_STEP)}
                  >
                    +{INVEST_STEP}⚙
                  </button>
                </div>
              );
            })}
          </>
        )}

        <div className="section">Движение</div>
        <div className="muted">
          {ready ? `Шагов за ход: ${engineSteps(game)}. Осталось: ${game.islandMovesLeft}.` : "Двигатель не готов."}
        </div>
        <div className="dirs">
          {DIRECTION_LABELS.map((label, direction) => {
            const blocker = planning ? islandMoveBlocker(game, direction) : "Только в фазе планирования";

            return (
              <button key={label} className="btn btn--small" disabled={blocker !== null} title={blocker ?? `Сдвинуть остров на ${label}`} onClick={() => registry.moveIslandAction(direction)}>
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {selectedIsland !== null && selectedIsland.id !== home.id ? (
        <div className="card">
          <div className="card__title">
            {selectedIsland.citadel ? "◈ " : ""}
            {selectedIsland.name}
          </div>
          <div className="row">
            <span>{ISLAND_TYPE_LABELS[selectedIsland.type]}</span>
            <span className="muted">{selectedIsland.tileIds.length} гексов</span>
          </div>
          {selectedIsland.citadel ? <p className="card__text">Сверхразвитый остров-город. Его ядро — цель партии.</p> : null}
        </div>
      ) : null}
    </div>
  );
};

export { IslandPanel };
