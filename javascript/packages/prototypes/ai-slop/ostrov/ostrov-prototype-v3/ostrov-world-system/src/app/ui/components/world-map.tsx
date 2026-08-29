import { COLORS, TERRAIN_COLORS } from "../palette";
import { HEX_SIZE, hexPolygonPoints, hexToPoint } from "../../../core/hex/layout";
import { coastlinePath } from "../../../core/hex/outline";
import { offsetToAxial } from "../../../core/hex/offset";
import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TOffset, TPlacedIsland, TPoint, TWorldTile, World } from "../../../core/exports";
import type { TSelectIslandAction, TSelectTileAction } from "../../domain/registry";

const MAP_PADDING = 12;

/** How far a name sits above the middle of its island. */
const LABEL_LIFT = 6;

const HEX_POINTS = hexPolygonPoints();
const SAND_POINTS = hexPolygonPoints(1.08);
const SEA_POINTS = hexPolygonPoints(0.94);

/** An island nobody selected fades out while another one is selected. */
const DIMMED_OPACITY = 0.35;

type TWorldMapRegistrySlice = {
  selectTileAction: TSelectTileAction;
  selectIslandAction: TSelectIslandAction;
};

type TWorldMapProps = {
  registry: TWorldMapRegistrySlice;
};

const pointOfCell = (cell: TOffset) => hexToPoint(offsetToAxial(cell));

const viewBoxOf = (cells: readonly TOffset[]) => {
  const points = cells.map(pointOfCell);
  const left = Math.min(...points.map((point) => point.x)) - HEX_SIZE - MAP_PADDING;
  const right = Math.max(...points.map((point) => point.x)) + HEX_SIZE + MAP_PADDING;
  const top = Math.min(...points.map((point) => point.y)) - HEX_SIZE - MAP_PADDING;
  const bottom = Math.max(...points.map((point) => point.y)) + HEX_SIZE + MAP_PADDING;

  return { x: left, y: top, width: right - left, height: bottom - top };
};

const centroidOf = (island: TPlacedIsland): TPoint => {
  const points = island.tiles.map((tile) => hexToPoint(tile));
  const total = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });

  return { x: total.x / points.length, y: total.y / points.length };
};

const translateOf = (tile: { q: number; r: number }) => {
  const centre = hexToPoint(tile);

  return `translate(${centre.x.toFixed(2)} ${centre.y.toFixed(2)})`;
};

type TIslandShapeProps = {
  island: TPlacedIsland;
  world: World;
  selected: boolean;
  dimmed: boolean;
  selectedKey: string | null;
  onTile: (key: string) => void;
};

const IslandShape: FC<TIslandShapeProps> = ({ island, world, selected, dimmed, selectedKey, onTile }) => {
  // The coastline asks what lies over each edge. Only this island counts as
  // land: a neighbour two steps away must not close the gap between them.
  const own = new Set(island.tiles.map((tile) => `${tile.q},${tile.r}`));
  const isLand = (q: number, r: number) => own.has(`${q},${r}`);

  return (
    <g className="map__island" opacity={dimmed ? DIMMED_OPACITY : 1}>
      <g fill={COLORS.coast}>
        {island.tiles.map((tile) => (
          <polygon key={tile.key} transform={translateOf(tile)} points={SAND_POINTS} />
        ))}
      </g>

      {island.tiles.map((tile) => (
        <polygon
          key={tile.key}
          transform={translateOf(tile)}
          points={HEX_POINTS}
          fill={TERRAIN_COLORS[tile.terrain]}
          stroke="rgba(28, 46, 24, 0.22)"
          strokeWidth={0.8}
        />
      ))}

      <path
        d={coastlinePath(island.tiles, isLand)}
        fill="none"
        stroke={selected ? COLORS.selection : COLORS.coastLine}
        strokeWidth={selected ? 2.6 : 1.6}
        strokeLinecap="round"
      />

      <g className="map__hits">
        {island.tiles.map((tile) => (
          <polygon
            key={tile.key}
            className="map__hit"
            transform={translateOf(tile)}
            points={HEX_POINTS}
            onClick={() => onTile(tile.key)}
          >
            <title>{`${island.name} · ${tile.x}, ${tile.y}`}</title>
          </polygon>
        ))}
      </g>

      {selectedKey !== null && world.tileByKey(selectedKey)?.islandId === island.id ? (
        <polygon
          className="map__selection"
          transform={translateOf(world.tileByKey(selectedKey) as TWorldTile)}
          points={HEX_POINTS}
          fill="none"
          stroke={COLORS.selection}
          strokeWidth={2.4}
        />
      ) : null}
    </g>
  );
};

const WorldMap: FC<TWorldMapProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const world = store.worldState.world.value;
  const selectedKey = store.worldState.selectedKey.value;
  const selectedIslandId = store.worldState.selectedIslandId.value;

  const cells = world.cells();
  const box = viewBoxOf(cells);
  const sea = cells.filter((cell) => !world.isLand(cell.x, cell.y));

  return (
    <svg
      className="map"
      viewBox={`${box.x.toFixed(1)} ${box.y.toFixed(1)} ${box.width.toFixed(1)} ${box.height.toFixed(1)}`}
      role="img"
      aria-label={`Мир ${world.seedText}`}
    >
      <defs>
        <linearGradient id="ocean" gradientUnits="userSpaceOnUse" x1="0" y1={box.y} x2="0" y2={box.y + box.height}>
          <stop offset="0%" stopColor={COLORS.oceanTop} />
          <stop offset="100%" stopColor={COLORS.oceanBottom} />
        </linearGradient>
      </defs>

      {/* Larger than the viewBox on purpose. The SVG keeps its aspect ratio
          inside a box of any shape, which leaves letterbox bars beside or above
          the map, and an oversized rect paints them as more ocean. */}
      <rect
        x={box.x - box.width}
        y={box.y - box.height}
        width={box.width * 3}
        height={box.height * 3}
        fill="url(#ocean)"
      />

      <g className="map__sea" fill={COLORS.seaHex} stroke={COLORS.seaGrid} strokeWidth={0.6}>
        {sea.map((cell) => (
          <polygon key={`${cell.x}:${cell.y}`} transform={translateOf(offsetToAxial(cell))} points={SEA_POINTS} />
        ))}
      </g>

      {world.islands.map((island) => (
        <IslandShape
          key={island.id}
          island={island}
          world={world}
          selected={island.id === selectedIslandId}
          dimmed={selectedIslandId !== null && island.id !== selectedIslandId}
          selectedKey={selectedKey}
          onTile={registry.selectTileAction}
        />
      ))}

      <g className="map__labels" fill={COLORS.label} textAnchor="middle">
        {world.islands.map((island) => {
          const centre = centroidOf(island);

          return (
            <text
              key={island.id}
              className="map__label"
              x={centre.x.toFixed(1)}
              y={(centre.y - HEX_SIZE - LABEL_LIFT).toFixed(1)}
              fontSize={HEX_SIZE * 0.8}
              onClick={() => registry.selectIslandAction(island.id)}
            >
              {island.name}
            </text>
          );
        })}
      </g>
    </svg>
  );
};

export { WorldMap };
