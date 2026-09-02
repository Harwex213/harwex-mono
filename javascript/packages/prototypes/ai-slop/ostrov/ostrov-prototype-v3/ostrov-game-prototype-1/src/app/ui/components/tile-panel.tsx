import {
  BUILDING_DEFS,
  ENGINE_HALF_COST,
  PLAYERS_FACTION_ID,
  SQUAD_DEFS,
  UNIT_DEFS,
  bestSquadType,
  buildOptions,
  canAfford,
  canFoundPower,
  isBuilt,
  ownBarracksOn,
  unitsOnTile,
} from "../../../core/exports";
import { TERRAIN_LABELS } from "@hw/ostrov-island-system";
import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TBuilding, TGame, TPlayerId, TUnit } from "../../../core/exports";
import type {
  TFormArmyAction,
  TFoundPowerAction,
  TReinforceArmyAction,
  TSelectUnitAction,
  TStartBuildingAction,
  TTrainCivilianAction,
} from "../../domain/registry";

type TTilePanelRegistrySlice = {
  selectUnitAction: TSelectUnitAction;
  foundPowerAction: TFoundPowerAction;
  startBuildingAction: TStartBuildingAction;
  trainCivilianAction: TTrainCivilianAction;
  formArmyAction: TFormArmyAction;
  reinforceArmyAction: TReinforceArmyAction;
};

type TTilePanelProps = {
  registry: TTilePanelRegistrySlice;
};

const ownerName = (game: TGame, unit: TUnit | TBuilding) => {
  const faction = game.factions.find((found) => found.id === unit.factionId)!;

  if (unit.owner !== null) {
    return `${faction.name} · ${game.players[unit.owner].name}`;
  }

  return faction.discovered ? faction.name : "Неизвестная фракция";
};

const BuildingCard: FC<{ game: TGame; building: TBuilding; registry: TTilePanelRegistrySlice; activePlayer: TPlayerId; planning: boolean }> = ({
  game,
  building,
  registry,
  activePlayer,
  planning,
}) => {
  const activeOwner = building.owner === activePlayer;
  const def = BUILDING_DEFS[building.type];
  const built = isBuilt(building);

  return (
    <div className="card">
      <div className="card__title">
        <span className="glyph">{def.glyph}</span> {def.name}
        {built ? "" : " · стройка"}
      </div>
      <div className="muted">{ownerName(game, building)}</div>
      <p className="card__text">{def.summary}</p>

      {!built && building.type !== "engine" ? (
        <>
          <div className="bar">
            <div className="bar__fill" style={{ width: `${(building.progress / building.cost) * 100}%` }} />
          </div>
          <div className="muted">
            {building.progress} / {building.cost} производства. Строй-отряд должен стоять на гексе в конце хода.
          </div>
        </>
      ) : null}

      {building.engineHalves !== null ? (
        <div className="halves">
          {(["p1", "p2"] as const).map((seat) => {
            const half = building.engineHalves![seat];

            return (
              <div key={seat} className="halves__row">
                <span style={{ color: game.players[seat].accent }}>{game.players[seat].name}</span>
                <div className="bar">
                  <div className="bar__fill" style={{ width: `${(half / ENGINE_HALF_COST) * 100}%`, background: game.players[seat].accent }} />
                </div>
                <span className="muted">
                  {half} / {ENGINE_HALF_COST}
                </span>
              </div>
            );
          })}
          <div className="muted">Вложения — во вкладке «Остров».</div>
        </div>
      ) : null}

      {built && building.type === "power" && activeOwner && planning ? (
        <div className="actions">
          {(["settler", "builders"] as const).map((type) => {
            const unitDef = UNIT_DEFS[type];
            const reason = canAfford(game, activePlayer, type);

            return (
              <button key={type} className="btn btn--small" disabled={reason !== null} title={reason ?? unitDef.summary} onClick={() => registry.trainCivilianAction(type)}>
                Обучить: {unitDef.name} ({unitDef.productionCost}⚙ {unitDef.populationCost}☺)
              </button>
            );
          })}
        </div>
      ) : null}

      {built && building.type === "barracks" && building.factionId === PLAYERS_FACTION_ID && planning ? (
        <div className="actions">
          {(() => {
            const reason = canAfford(game, activePlayer, "army");
            const squad = SQUAD_DEFS[bestSquadType(game)];

            return (
              <button className="btn btn--small" disabled={reason !== null} title={reason ?? `Отряд: ${squad.name}`} onClick={() => registry.formArmyAction(building.id)}>
                Сформировать армию · {squad.name} ({UNIT_DEFS.army.productionCost}⚙ {UNIT_DEFS.army.metalsCost}⛏ {UNIT_DEFS.army.populationCost}☺)
              </button>
            );
          })()}
        </div>
      ) : null}
    </div>
  );
};

const UnitCard: FC<{ game: TGame; unit: TUnit; selected: boolean; own: boolean; registry: TTilePanelRegistrySlice; planning: boolean }> = ({
  game,
  unit,
  selected,
  own,
  registry,
  planning,
}) => {
  const def = UNIT_DEFS[unit.type];
  const faction = game.factions.find((found) => found.id === unit.factionId)!;

  return (
    <div className={`card card--unit ${selected ? "card--selected" : ""} ${own ? "card--own" : ""}`} onClick={() => registry.selectUnitAction(unit.id)}>
      <div className="card__title">
        <span className="glyph" style={{ background: faction.color }}>
          {def.glyph}
        </span>{" "}
        {def.name}
        {own ? <span className="muted"> · ходов {unit.movesLeft}</span> : null}
      </div>
      <div className="muted">{ownerName(game, unit)}</div>

      {unit.type === "army" ? (
        <ul className="squads">
          {unit.squads.map((squad) => (
            <li key={squad.id} className="squads__row">
              <span>{SQUAD_DEFS[squad.type].name}</span>
              <div className="bar bar--thin">
                <div className="bar__fill bar__fill--hp" style={{ width: `${(squad.hp / squad.hpMax) * 100}%` }} />
              </div>
              <span className="muted">
                {squad.hp}/{squad.hpMax}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {own && selected && planning ? (
        <div className="actions">
          {unit.type === "settler" ? (
            <button className="btn btn--small btn--primary" disabled={canFoundPower(game, unit) !== null} title={canFoundPower(game, unit) ?? ""} onClick={() => registry.foundPowerAction(unit.id)}>
              ★ Основать Центр Власти
            </button>
          ) : null}

          {unit.type === "builders" ? (
            <div className="buildlist">
              {buildOptions(game, unit).map((option) => {
                const buildingDef = BUILDING_DEFS[option.type];

                return (
                  <button
                    key={option.type}
                    className="btn btn--small"
                    disabled={option.reason !== null || unit.movesLeft <= 0}
                    title={option.reason ?? buildingDef.summary}
                    onClick={() => registry.startBuildingAction(unit.id, option.type)}
                  >
                    {buildingDef.glyph} {buildingDef.name} · {buildingDef.cost}⚙{option.reason !== null ? ` — ${option.reason}` : ""}
                  </button>
                );
              })}
              {unit.movesLeft <= 0 ? <div className="muted">Отряд уже действовал в этом ходу.</div> : null}
            </div>
          ) : null}

          {unit.type === "army" ? (
            <button
              className="btn btn--small"
              disabled={ownBarracksOn(game, unit.tileId) === null || canAfford(game, unit.owner!, "army") !== null || unit.squads.length >= 6}
              title={ownBarracksOn(game, unit.tileId) === null ? "Пополнение только на своих казармах" : (canAfford(game, unit.owner!, "army") ?? "")}
              onClick={() => registry.reinforceArmyAction(unit.id)}
            >
              Пополнить отрядом «{SQUAD_DEFS[bestSquadType(game)].name}» ({UNIT_DEFS.army.productionCost}⚙ {UNIT_DEFS.army.metalsCost}⛏ {UNIT_DEFS.army.populationCost}☺)
            </button>
          ) : null}

          <div className="muted">{unit.movesLeft > 0 ? "Кликните по подсвеченному гексу, чтобы переместить." : "Ходы закончились."}</div>
        </div>
      ) : null}
    </div>
  );
};

const TilePanel: FC<TTilePanelProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const game = store.game.value;
  const tileId = store.ui.selectedTileId.value;
  const selectedUnitId = store.ui.selectedUnitId.value;
  const activePlayer = store.ui.activePlayer.value;
  const planning = game.phase === "planning";

  if (tileId === null || game.tiles[tileId] === undefined) {
    return (
      <div className="empty">
        <p>Выберите гекс на карте.</p>
        <p className="muted">Свои юниты отмечены цветной обводкой игрока. Поселенец основывает Центр Власти, строй-отряд закладывает здания, армия воюет.</p>
      </div>
    );
  }

  const tile = game.tiles[tileId]!;
  const island = game.islands.find((found) => found.id === tile.islandId)!;
  const building = tile.buildingId === null ? null : (game.buildings[tile.buildingId] ?? null);
  const units = unitsOnTile(game, tileId);

  return (
    <div className="stack">
      <div className="card card--tile">
        <div className="card__title">
          {island.name} {island.home ? "· родной остров" : island.citadel ? "· Цитадель" : ""}
        </div>
        <div className="row">
          <span>{TERRAIN_LABELS[tile.terrain]}</span>
          <span className="muted">{tile.coastal ? "побережье" : "внутренний гекс"}</span>
        </div>
        <div className="row">
          <span>Ископаемые</span>
          <span>
            {tile.deposits} / {tile.depositsMax}
          </span>
        </div>
        <div className="bar">
          <div className="bar__fill bar__fill--deposit" style={{ width: `${tile.depositsMax === 0 ? 0 : (tile.deposits / tile.depositsMax) * 100}%` }} />
        </div>
        <div className="muted">Ископаемые конечны: мастерская, ферма и рудник сжигают по одному за ход.</div>
      </div>

      {building !== null ? (
        <BuildingCard game={game} building={building} registry={registry} activePlayer={activePlayer} planning={planning} />
      ) : (
        <div className="muted">Здания нет.</div>
      )}

      {units.length > 0 ? (
        <div className="stack">
          <div className="section">Юниты на гексе</div>
          {units.map((unit) => (
            <UnitCard key={unit.id} game={game} unit={unit} selected={unit.id === selectedUnitId} own={unit.owner === activePlayer} registry={registry} planning={planning} />
          ))}
        </div>
      ) : (
        <div className="muted">Юнитов нет.</div>
      )}
    </div>
  );
};

export { TilePanel };
