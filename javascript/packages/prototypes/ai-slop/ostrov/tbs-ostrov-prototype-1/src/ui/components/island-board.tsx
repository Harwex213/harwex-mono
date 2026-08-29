import { useSignals } from "@preact/signals-react/runtime";
import { COLORS, TERRAIN_GRADIENTS } from "../palette";
import { HEX_DEPTH, HEX_SIZE, hexPolygonPoints, hexToPoint } from "../../domain/hex/layout";
import { TERRAIN_LIST } from "../../domain/island/terrain";
import { SeaMarks, TileDecoration } from "./tile-decoration";
import { coastlinePath } from "../../domain/hex/outline";
import { hexKey } from "../../domain/hex/coords";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TSelectTileAction } from "../../domain/registry";
import type { TTile } from "../../domain/island/generator";

const BOARD_PADDING = 34;

/** How far a selected tile lifts off the board. */
const SELECTION_LIFT = 6;

const HEX_POINTS = hexPolygonPoints();
const SAND_POINTS = hexPolygonPoints(1.06);
const CLIFF_POINTS = hexPolygonPoints(1.04);
const SURF_POINTS = hexPolygonPoints(1.2);
const SEA_POINTS = hexPolygonPoints(0.9);

type TIslandBoardRegistrySlice = {
  selectTileAction: TSelectTileAction;
};

type TIslandBoardProps = {
  registry: TIslandBoardRegistrySlice;
};

const viewBoxOf = (tiles: readonly TTile[]) => {
  const points = tiles.map(hexToPoint);
  const left = Math.min(...points.map((point) => point.x)) - HEX_SIZE - BOARD_PADDING;
  const right = Math.max(...points.map((point) => point.x)) + HEX_SIZE + BOARD_PADDING;
  const top = Math.min(...points.map((point) => point.y)) - HEX_SIZE - BOARD_PADDING;
  const bottom = Math.max(...points.map((point) => point.y)) + HEX_SIZE + HEX_DEPTH + BOARD_PADDING;

  return { x: left, y: top, width: right - left, height: bottom - top };
};

const IslandBoard: FC<TIslandBoardProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const island = store.islandState.island.value;
  const selectedKey = store.islandState.selectedKey.value;

  const { tiles, seed } = island;
  const land = tiles.filter((tile) => tile.land);
  const water = tiles.filter((tile) => !tile.land);
  const landKeys = new Set(land.map((tile) => tile.key));
  const isLand = (q: number, r: number) => landKeys.has(hexKey(q, r));
  const selectedTile = land.find((tile) => tile.key === selectedKey) ?? null;
  const box = viewBoxOf(tiles);

  const translateOf = (tile: TTile) => {
    const centre = hexToPoint(tile);
    const lift = tile.key === selectedKey ? SELECTION_LIFT : 0;

    return `translate(${centre.x.toFixed(2)} ${(centre.y - lift).toFixed(2)})`;
  };

  return (
    <svg
      className="board"
      viewBox={`${box.x.toFixed(1)} ${box.y.toFixed(1)} ${box.width.toFixed(1)} ${box.height.toFixed(1)}`}
      role="img"
      aria-label={`Остров ${island.name}`}
    >
      <defs>
        <linearGradient id="ocean" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={COLORS.oceanTop} />
          <stop offset="100%" stopColor={COLORS.oceanBottom} />
        </linearGradient>
        {TERRAIN_LIST.map((terrain) => (
          <linearGradient key={terrain} id={`terrain-${terrain}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TERRAIN_GRADIENTS[terrain][0]} />
            <stop offset="100%" stopColor={TERRAIN_GRADIENTS[terrain][1]} />
          </linearGradient>
        ))}
      </defs>

      {/* Wider than the viewBox on purpose. The board is capped to the viewport
          height, which leaves bars of empty element beside the hexagon, and an
          over-wide rect paints them as more ocean. Only the width is stretched,
          so the vertical gradient is untouched. */}
      <rect x={box.x - box.width} y={box.y} width={box.width * 3} height={box.height} fill="url(#ocean)" />

      <g className="board__sea">
        {water.map((tile) => (
          <g key={tile.key} transform={translateOf(tile)}>
            <polygon points={SEA_POINTS} fill={COLORS.seaHex} />
            <SeaMarks seed={seed} q={tile.q} r={tile.r} />
          </g>
        ))}
      </g>

      <g className="board__surf" fill={COLORS.seaHexEdge} opacity={0.4}>
        {land.map((tile) => (
          <polygon key={tile.key} transform={translateOf(tile)} points={SURF_POINTS} />
        ))}
      </g>

      <g className="board__cliffs" fill={COLORS.cliffDark}>
        {land.map((tile) => (
          <polygon
            key={tile.key}
            transform={`${translateOf(tile)} translate(0 ${HEX_DEPTH})`}
            points={CLIFF_POINTS}
          />
        ))}
      </g>

      <g className="board__sand" fill={COLORS.coast}>
        {land.map((tile) => (
          <polygon key={tile.key} transform={translateOf(tile)} points={SAND_POINTS} />
        ))}
      </g>

      <g className="board__tiles">
        {land.map((tile) => (
          <g key={tile.key} transform={translateOf(tile)}>
            <polygon
              points={HEX_POINTS}
              fill={`url(#terrain-${tile.terrain})`}
              stroke="rgba(28, 46, 24, 0.28)"
              strokeWidth={1.2}
            />
            <g className="board__decor">
              <TileDecoration terrain={tile.terrain!} seed={seed} q={tile.q} r={tile.r} />
            </g>
          </g>
        ))}
      </g>

      <path
        className="board__coast"
        d={coastlinePath(land, isLand)}
        fill="none"
        stroke="rgba(20, 40, 52, 0.55)"
        strokeWidth={2.6}
        strokeLinecap="round"
      />

      {selectedTile ? (
        <polygon
          className="board__selection"
          transform={translateOf(selectedTile)}
          points={HEX_POINTS}
          fill="none"
          stroke="#ffd479"
          strokeWidth={3.5}
        />
      ) : null}

      <g className="board__hits">
        {land.map((tile) => (
          <polygon
            key={tile.key}
            className="board__hit"
            transform={translateOf(tile)}
            points={HEX_POINTS}
            onClick={() => registry.selectTileAction(tile.key)}
          />
        ))}
      </g>
    </svg>
  );
};

export { IslandBoard };
