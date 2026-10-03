import { HEX_DEPTH, HEX_SIZE, hexPolygonPoints, hexToPoint } from "../../../core/hex/layout";
import { TERRAIN_LIST } from "@hw/ostrov-island-system";
import { hexKey } from "@hw/ostrov-utils";
import { coastlinePath } from "../../../core/hex/outline";
import { useSignals } from "@preact/signals-react/runtime";
import { buildingDef } from "../../../core/exports";
import { COLORS, TERRAIN_GRADIENTS } from "../palette";
import { useStore } from "../../store/store";
import { BuildingGlyph } from "./building-glyph";
import type { FC } from "react";
import type { TTile } from "@hw/ostrov-island-system";
import type { TClickTileAction } from "../../domain/registry";

const BOARD_PADDING = 10;
const SELECTION_LIFT = 6;

const HEX_POINTS = hexPolygonPoints();
const SAND_POINTS = hexPolygonPoints(1.06);
const CLIFF_POINTS = hexPolygonPoints(1.04);
const SEA_POINTS = hexPolygonPoints(0.9);

type TBoardRegistrySlice = {
  clickTileAction: TClickTileAction;
};

type TBoardProps = {
  registry: TBoardRegistrySlice;
};

const viewBoxOf = (tiles: readonly TTile[]) => {
  const points = tiles.map(hexToPoint);
  const left = Math.min(...points.map((point) => point.x)) - HEX_SIZE - BOARD_PADDING;
  const right = Math.max(...points.map((point) => point.x)) + HEX_SIZE + BOARD_PADDING;
  const top = Math.min(...points.map((point) => point.y)) - HEX_SIZE - BOARD_PADDING;
  const bottom = Math.max(...points.map((point) => point.y)) + HEX_SIZE + HEX_DEPTH + BOARD_PADDING;

  return { x: left, y: top, width: right - left, height: bottom - top };
};

/**
 * The island with its buildings. With a catalog card armed, every land tile is
 * tinted green where the building may go and red where it may not.
 */
const Board: FC<TBoardProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const island = store.gameState.island.value;
  const settlement = store.gameState.settlement.value;
  const selectedKey = store.gameState.selectedKey.value;
  const pickedKind = store.gameState.pickedKind.value;

  const land = island.landTiles();
  const water = island.waterTiles();
  const isLand = (q: number, r: number) => island.isLand(hexKey(q, r));
  const selectedTile = land.find((tile) => tile.key === selectedKey) ?? null;
  const box = viewBoxOf(island.tiles);
  const picked = pickedKind ? buildingDef(pickedKind) : null;

  const translateOf = (tile: TTile) => {
    const centre = hexToPoint(tile);
    const lift = tile.key === selectedKey ? SELECTION_LIFT : 0;

    return `translate(${centre.x.toFixed(2)} ${(centre.y - lift).toFixed(2)})`;
  };

  return (
    <svg
      className={`board${picked ? " board--placing" : ""}`}
      viewBox={`${box.x.toFixed(1)} ${box.y.toFixed(1)} ${box.width.toFixed(1)} ${box.height.toFixed(1)}`}
      role="img"
      aria-label={`Остров ${island.name}`}
    >
      <defs>
        <linearGradient id="ocean" gradientUnits="userSpaceOnUse" x1="0" y1={box.y} x2="0" y2={box.y + box.height}>
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

      {/* Oversized on purpose: it paints the letterbox bars as more ocean. */}
      <rect x={box.x - box.width} y={box.y - box.height} width={box.width * 3} height={box.height * 3} fill="url(#ocean)" />

      <g className="board__sea">
        {water.map((tile) => (
          <polygon key={tile.key} transform={translateOf(tile)} points={SEA_POINTS} fill={COLORS.seaHex} />
        ))}
      </g>

      <g className="board__cliffs" fill={COLORS.cliffDark}>
        {land.map((tile) => (
          <polygon key={tile.key} transform={`${translateOf(tile)} translate(0 ${HEX_DEPTH})`} points={CLIFF_POINTS} />
        ))}
      </g>

      <g className="board__sand" fill={COLORS.coast}>
        {land.map((tile) => (
          <polygon key={tile.key} transform={translateOf(tile)} points={SAND_POINTS} />
        ))}
      </g>

      <g className="board__tiles">
        {land.map((tile) => {
          const building = settlement.buildingAt(tile.key);
          const check = picked ? settlement.canPlace(picked, tile) : null;

          return (
            <g key={tile.key} transform={translateOf(tile)}>
              <polygon
                points={HEX_POINTS}
                fill={`url(#terrain-${tile.terrain})`}
                stroke="rgba(28, 46, 24, 0.28)"
                strokeWidth={1.2}
              />
              {check ? (
                <polygon
                  className="board__hint"
                  points={HEX_POINTS}
                  fill={check.ok ? COLORS.okGlow : COLORS.badGlow}
                  opacity={check.ok ? 0.42 : 0.22}
                />
              ) : null}
              {building ? (
                <g className="board__decor">
                  <BuildingGlyph building={building} />
                </g>
              ) : null}
            </g>
          );
        })}
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
          stroke={COLORS.selection}
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
            onClick={() => registry.clickTileAction(tile.key)}
          />
        ))}
      </g>
    </svg>
  );
};

export { Board };
