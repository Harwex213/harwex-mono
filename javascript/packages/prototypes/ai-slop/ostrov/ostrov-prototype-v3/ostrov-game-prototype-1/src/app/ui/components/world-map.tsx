import { BUILDING_DEFS, HEX_SIZE, PLAYERS_FACTION_ID, UNIT_DEFS, coastlinePath, hexPolygonPoints, hexToPoint, isBuilt, offsetToAxial, reachableTiles } from "../../../core/exports";
import { COLORS, TERRAIN_COLORS } from "../palette";
import { hexKey } from "@hw/ostrov-utils";
import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TGame, TGameIsland, TGameTile, TUnit } from "../../../core/exports";
import type { TClickTileAction } from "../../domain/registry";

const MAP_PADDING = 14;
const HEX_POINTS = hexPolygonPoints();
const SAND_POINTS = hexPolygonPoints(1.08);
const SEA_POINTS = hexPolygonPoints(0.94);

type TWorldMapRegistrySlice = {
  clickTileAction: TClickTileAction;
};

type TWorldMapProps = {
  registry: TWorldMapRegistrySlice;
};

const translateOf = (tile: { q: number; r: number }) => {
  const centre = hexToPoint(tile);

  return `translate(${centre.x.toFixed(2)} ${centre.y.toFixed(2)})`;
};

const viewBoxOf = (game: TGame) => {
  const corners = [
    offsetToAxial(game.xRange.min, game.yRange.min),
    offsetToAxial(game.xRange.max, game.yRange.min),
    offsetToAxial(game.xRange.min, game.yRange.max),
    offsetToAxial(game.xRange.max, game.yRange.max),
  ].map(hexToPoint);
  const left = Math.min(...corners.map((point) => point.x)) - HEX_SIZE - MAP_PADDING;
  const right = Math.max(...corners.map((point) => point.x)) + HEX_SIZE + MAP_PADDING;
  const top = Math.min(...corners.map((point) => point.y)) - HEX_SIZE - MAP_PADDING;
  const bottom = Math.max(...corners.map((point) => point.y)) + HEX_SIZE + MAP_PADDING;

  return { x: left, y: top, width: right - left, height: bottom - top };
};

/** The faction whose seat of power stands on the island, or any owner of a building there. */
const controllerOf = (game: TGame, island: TGameIsland) => {
  let fallback: string | null = null;

  for (const id of island.tileIds) {
    const tile = game.tiles[id]!;
    const building = tile.buildingId === null ? null : game.buildings[tile.buildingId];

    if (building === undefined || building === null) {
      continue;
    }

    // A natives camp does not own the players' island: it is an intruder there.
    if (island.home && building.factionId !== PLAYERS_FACTION_ID) {
      continue;
    }

    if (building.type === "power" || building.type === "core" || building.type === "camp") {
      return building.factionId;
    }

    fallback = fallback ?? building.factionId;
  }

  return fallback;
};

const colorOf = (game: TGame, factionId: string | null) => {
  if (factionId === null) {
    return null;
  }

  return game.factions.find((faction) => faction.id === factionId)?.color ?? null;
};

const Deposits: FC<{ tile: TGameTile }> = ({ tile }) => {
  const dots = 3;
  const filled = tile.depositsMax === 0 ? 0 : Math.ceil((tile.deposits / tile.depositsMax) * dots);

  return (
    <g className="map__deposits">
      {[0, 1, 2].map((index) => (
        <circle
          key={index}
          cx={(index - 1) * 5}
          cy={HEX_SIZE * 0.55}
          r={1.7}
          fill={index < filled ? COLORS.deposit : COLORS.depositEmpty}
        />
      ))}
    </g>
  );
};

const UnitBadges: FC<{ game: TGame; units: TUnit[]; selectedUnitId: string | null }> = ({ game, units, selectedUnitId }) => {
  const shown = units.slice(0, 3);

  return (
    <g className="map__units">
      {shown.map((unit, index) => {
        const faction = game.factions.find((found) => found.id === unit.factionId)!;
        const accent = unit.owner === null ? null : game.players[unit.owner].accent;
        const offset = (index - (shown.length - 1) / 2) * 9;
        const selected = unit.id === selectedUnitId;

        return (
          <g key={unit.id} transform={`translate(${offset.toFixed(1)} ${-HEX_SIZE * 0.25})`}>
            <circle r={selected ? 6.5 : 5.5} fill={faction.color} stroke={accent ?? "rgba(0,0,0,0.5)"} strokeWidth={accent === null ? 0.8 : 1.8} />
            <text y={2.6} fontSize={7} textAnchor="middle" fill="#0b1219" fontWeight={700}>
              {UNIT_DEFS[unit.type].glyph}
            </text>
            {unit.type === "army" ? (
              <text y={-6.5} fontSize={5.5} textAnchor="middle" fill="#fff" fontWeight={700}>
                {unit.squads.length}
              </text>
            ) : null}
          </g>
        );
      })}
      {units.length > shown.length ? (
        <text x={HEX_SIZE * 0.55} y={-HEX_SIZE * 0.35} fontSize={6} fill="#fff" fontWeight={700}>
          +{units.length - shown.length}
        </text>
      ) : null}
    </g>
  );
};

const WorldMap: FC<TWorldMapProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const game = store.game.value;
  const selectedTileId = store.ui.selectedTileId.value;
  const selectedUnitId = store.ui.selectedUnitId.value;
  const activePlayer = store.ui.activePlayer.value;
  const box = viewBoxOf(game);

  const selectedUnit = selectedUnitId === null ? null : (game.units[selectedUnitId] ?? null);
  const reach = selectedUnit !== null && selectedUnit.owner === activePlayer && game.phase === "planning" ? reachableTiles(game, selectedUnit) : null;

  const unitsByTile = new Map<string, TUnit[]>();
  for (const unit of Object.values(game.units)) {
    const list = unitsByTile.get(unit.tileId) ?? [];
    list.push(unit);
    unitsByTile.set(unit.tileId, list);
  }

  const seaCells: { q: number; r: number }[] = [];
  for (let y = game.yRange.min; y <= game.yRange.max; y += 1) {
    for (let x = game.xRange.min; x <= game.xRange.max; x += 1) {
      const hex = offsetToAxial(x, y);

      if (game.posIndex[hexKey(hex.q, hex.r)] === undefined) {
        seaCells.push(hex);
      }
    }
  }

  const home = game.islands.find((island) => island.home)!;

  return (
    <svg className="map" viewBox={`${box.x.toFixed(1)} ${box.y.toFixed(1)} ${box.width.toFixed(1)} ${box.height.toFixed(1)}`} role="img" aria-label="Мир">
      <defs>
        <linearGradient id="ocean" gradientUnits="userSpaceOnUse" x1="0" y1={box.y} x2="0" y2={box.y + box.height}>
          <stop offset="0%" stopColor={COLORS.oceanTop} />
          <stop offset="100%" stopColor={COLORS.oceanBottom} />
        </linearGradient>
      </defs>

      <rect x={box.x - box.width} y={box.y - box.height} width={box.width * 3} height={box.height * 3} fill="url(#ocean)" />

      <g fill={COLORS.seaHex} stroke={COLORS.seaGrid} strokeWidth={0.6}>
        {seaCells.map((hex) => (
          <polygon key={hexKey(hex.q, hex.r)} transform={translateOf(hex)} points={SEA_POINTS} />
        ))}
      </g>

      {game.islands.map((island) => {
        const tiles = island.tileIds.map((id) => game.tiles[id]!);
        const own = new Set(tiles.map((tile) => hexKey(tile.q, tile.r)));
        const controller = controllerOf(game, island);
        const stroke = colorOf(game, controller) ?? COLORS.coastLine;

        return (
          <g key={island.id} className="map__island">
            <g fill={island.citadel ? COLORS.citadelGrid : COLORS.coast}>
              {tiles.map((tile) => (
                <polygon key={tile.id} transform={translateOf(tile)} points={SAND_POINTS} />
              ))}
            </g>

            {tiles.map((tile) => (
              <g key={tile.id} transform={translateOf(tile)}>
                <polygon
                  points={HEX_POINTS}
                  fill={island.citadel ? COLORS.citadelGround : TERRAIN_COLORS[tile.terrain]}
                  stroke={island.citadel ? COLORS.citadelGrid : "rgba(28, 46, 24, 0.22)"}
                  strokeWidth={0.8}
                />
                <Deposits tile={tile} />
              </g>
            ))}

            <path
              d={coastlinePath(tiles, (q, r) => own.has(hexKey(q, r)))}
              fill="none"
              stroke={stroke}
              strokeWidth={controller === null ? 1.4 : 2.4}
              strokeLinecap="round"
              opacity={0.95}
            />
          </g>
        );
      })}

      <g className="map__buildings">
        {Object.values(game.buildings).map((building) => {
          const tile = game.tiles[building.tileId]!;
          const color = colorOf(game, building.factionId) ?? "#fff";
          const built = isBuilt(building);

          return (
            <g key={building.id} transform={translateOf(tile)}>
              <rect x={-7} y={-13} width={14} height={11} rx={2} fill={built ? color : "rgba(255,255,255,0.35)"} stroke="rgba(0,0,0,0.55)" strokeWidth={0.7} strokeDasharray={built ? undefined : "1.5 1"} />
              <text y={-4.5} fontSize={8} textAnchor="middle" fill="#0b1219" fontWeight={700}>
                {BUILDING_DEFS[building.type].glyph}
              </text>
            </g>
          );
        })}
      </g>

      <g>
        {[...unitsByTile.entries()].map(([tileId, units]) => (
          <g key={tileId} transform={translateOf(game.tiles[tileId]!)}>
            <UnitBadges game={game} units={units} selectedUnitId={selectedUnitId} />
          </g>
        ))}
      </g>

      {reach !== null ? (
        <g className="map__reach">
          {[...reach.keys()].map((tileId) => {
            const tile = game.tiles[tileId]!;
            const hostile = (unitsByTile.get(tileId) ?? []).some((unit) => unit.factionId !== PLAYERS_FACTION_ID);

            return (
              <polygon
                key={tileId}
                transform={translateOf(tile)}
                points={HEX_POINTS}
                fill={hostile ? COLORS.reachHostile : COLORS.reach}
                stroke={hostile ? "#ff6060" : "#fff"}
                strokeWidth={1}
              />
            );
          })}
        </g>
      ) : null}

      {selectedTileId !== null && game.tiles[selectedTileId] !== undefined ? (
        <polygon transform={translateOf(game.tiles[selectedTileId]!)} points={HEX_POINTS} fill="none" stroke={COLORS.selection} strokeWidth={2.4} />
      ) : null}

      <g className="map__labels" fill={COLORS.label} textAnchor="middle">
        {game.islands.map((island) => {
          const tiles = island.tileIds.map((id) => game.tiles[id]!);
          const top = tiles.reduce((best, tile) => (tile.r < best.r ? tile : best), tiles[0]!);
          const centre = hexToPoint(top);
          const controller = controllerOf(game, island);
          const faction = controller === null ? null : game.factions.find((found) => found.id === controller)!;
          const name = faction === null ? null : faction.discovered || faction.id === PLAYERS_FACTION_ID ? faction.name : "Неизвестная фракция";

          return (
            <text key={island.id} x={centre.x.toFixed(1)} y={(centre.y - HEX_SIZE * 1.15).toFixed(1)} fontSize={HEX_SIZE * 0.55} className="map__label">
              {island.home ? "⌂ " : ""}
              {island.name}
              {name !== null ? ` · ${name}` : ""}
            </text>
          );
        })}
      </g>

      <g className="map__hits">
        {Object.values(game.tiles).map((tile) => (
          <polygon key={tile.id} className="map__hit" transform={translateOf(tile)} points={HEX_POINTS} onClick={() => registry.clickTileAction(tile.id)}>
            <title>{`${game.islands.find((island) => island.id === tile.islandId)!.name} · ${tile.terrain} · ископаемые ${tile.deposits}/${tile.depositsMax}${tile.islandId === home.id ? " · родной остров" : ""}`}</title>
          </polygon>
        ))}
      </g>
    </svg>
  );
};

export { WorldMap };
