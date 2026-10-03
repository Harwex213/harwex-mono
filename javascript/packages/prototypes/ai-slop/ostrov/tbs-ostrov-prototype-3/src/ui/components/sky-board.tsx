import { useSignals } from "@preact/signals-react/runtime";
import { COLORS, TERRAIN_GRADIENTS } from "../palette";
import { FloatingIsland } from "./floating-island";
import { HEX_DEPTH, HEX_SIZE, hexPolygonPoints, hexToPoint } from "../../domain/hex/layout";
import { SKY_RADIUS, fitsAt, footprintOf, linksOf, occupancyOf } from "../../domain/world/world";
import { coastlinePath } from "../../domain/hex/outline";
import { insideGrid } from "../../domain/hex/grid";
import { TERRAIN_LIST } from "../../domain/island/terrain";
import { createGrid } from "../../domain/hex/grid";
import { hexDistance, hexKey } from "../../domain/hex/coords";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TAxial } from "../../domain/hex/coords";
import type { THoverTargetAction, TMoveToTargetAction, TSelectIslandAction } from "../../domain/registry";
import type { TWorldIsland } from "../../domain/world/world";

const BOARD_PADDING = 40;
const CELL_POINTS = hexPolygonPoints(0.94);
const HIT_POINTS = hexPolygonPoints(1);
const FOOTPRINT_POINTS = hexPolygonPoints(0.9);
const SKY_CELLS = createGrid(SKY_RADIUS);

type TSkyBoardRegistrySlice = {
  hoverTargetAction: THoverTargetAction;
  moveToTargetAction: TMoveToTargetAction;
  selectIslandAction: TSelectIslandAction;
};

type TSkyBoardProps = {
  registry: TSkyBoardRegistrySlice;
};

const viewBox = (() => {
  const points = SKY_CELLS.map(hexToPoint);
  const left = Math.min(...points.map((point) => point.x)) - HEX_SIZE - BOARD_PADDING;
  const right = Math.max(...points.map((point) => point.x)) + HEX_SIZE + BOARD_PADDING;
  const top = Math.min(...points.map((point) => point.y)) - HEX_SIZE - BOARD_PADDING;
  const bottom = Math.max(...points.map((point) => point.y)) + HEX_SIZE + HEX_DEPTH * 4 + BOARD_PADDING;

  return `${left.toFixed(1)} ${top.toFixed(1)} ${(right - left).toFixed(1)} ${(bottom - top).toFixed(1)}`;
})();

type TFootprintProps = {
  cells: TAxial[];
  className: string;
};

const Footprint: FC<TFootprintProps> = ({ cells, className }) => (
  <g className={className}>
    {cells.map((cell) => {
      const centre = hexToPoint(cell);

      return (
        <polygon
          key={hexKey(cell.q, cell.r)}
          transform={`translate(${centre.x.toFixed(2)} ${centre.y.toFixed(2)})`}
          points={FOOTPRINT_POINTS}
        />
      );
    })}
  </g>
);

/** Islands are painted back to front, so a near island covers the underside of a far one. */
const byDepth = (a: TWorldIsland, b: TWorldIsland) => a.anchor.r - b.anchor.r;

const SkyBoard: FC<TSkyBoardProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const world = store.gameState.world.value;
  const mode = store.gameState.mode.value;
  const hovered = store.gameState.hoveredTarget.value;
  const selectedId = store.gameState.selectedIslandId.value;

  const player = world.islands.find((entry) => entry.owner === "player")!;
  const moving = mode === "move";
  const range = store.gameState.moveRange.value;
  const links = linksOf(world);
  /** Anchors the island can fly to this turn; the hover surface. */
  const zone = moving
    ? SKY_CELLS.filter((cell) => {
        const steps = hexDistance(cell, player.anchor);

        return steps > 0 && steps <= range;
      })
    : [];
  /** Every sky cell the island may cover after the move: its coast pushed out by `range`. */
  const coast = footprintOf(player);
  const reach = moving ? SKY_CELLS.filter((cell) => coast.some((tile) => hexDistance(cell, tile) <= range)) : [];
  const inZone = (q: number, r: number) => {
    return insideGrid({ q, r }, SKY_RADIUS) && coast.some((tile) => hexDistance({ q, r }, tile) <= range);
  };
  const zoneOutline = moving ? coastlinePath(reach, inZone) : "";
  const fits = moving && hovered ? fitsAt(player, hovered, occupancyOf(world.islands, player.id)) : false;

  return (
    <svg className={`sky${mode === "move" ? " sky--move" : ""}`} viewBox={viewBox} role="img" aria-label="Небо с островами">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={COLORS.skyTop} />
          <stop offset="100%" stopColor={COLORS.skyBottom} />
        </linearGradient>
        <filter id="island-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <filter id="cloud-blur" x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        {TERRAIN_LIST.map((terrain) => (
          <linearGradient key={terrain} id={`terrain-${terrain}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TERRAIN_GRADIENTS[terrain][0]} />
            <stop offset="100%" stopColor={TERRAIN_GRADIENTS[terrain][1]} />
          </linearGradient>
        ))}
      </defs>

      <rect x={-2000} y={-2000} width={4000} height={4000} fill="url(#sky)" />

      <g className="sky__clouds" fill={COLORS.cloud} filter="url(#cloud-blur)">
        <ellipse className="sky__cloud sky__cloud--a" cx={-320} cy={-260} rx={120} ry={28} />
        <ellipse className="sky__cloud sky__cloud--b" cx={260} cy={-40} rx={150} ry={32} />
        <ellipse className="sky__cloud sky__cloud--c" cx={-120} cy={300} rx={170} ry={30} />
        <ellipse className="sky__cloud sky__cloud--d" cx={380} cy={220} rx={110} ry={24} />
      </g>

      <g className="sky__cells" fill={COLORS.skyCell} stroke={COLORS.skyCellEdge} strokeWidth={1}>
        {SKY_CELLS.map((cell) => {
          const centre = hexToPoint(cell);

          return <polygon key={hexKey(cell.q, cell.r)} transform={`translate(${centre.x.toFixed(2)} ${centre.y.toFixed(2)})`} points={CELL_POINTS} />;
        })}
      </g>

      <g className="sky__islands">
        {[...world.islands].sort(byDepth).map((entry, index) => (
          <FloatingIsland
            key={entry.id}
            worldIsland={entry}
            selected={entry.id === selectedId}
            moving={moving && entry.owner === "player"}
            phase={index * 0.9}
            onClick={() => registry.selectIslandAction(entry.id)}
          />
        ))}
      </g>

      <g className="sky__links">
        {links.map((link) => {
          const a = hexToPoint(link.cellFrom);
          const b = hexToPoint(link.cellTo);

          return (
            <g key={`${link.from.id}-${link.to.id}`} className="sky__link">
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(40, 28, 14, 0.55)" strokeWidth={9} strokeLinecap="round" />
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={COLORS.link} strokeWidth={6} strokeLinecap="round" />
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={COLORS.trunk} strokeWidth={6} strokeDasharray="3 4" />
            </g>
          );
        })}
      </g>

      {moving ? <path className="sky__zone" d={zoneOutline} /> : null}

      {moving ? (
        <g className="sky__hits">
          {zone.map((cell) => {
            const centre = hexToPoint(cell);

            return (
              <polygon
                key={hexKey(cell.q, cell.r)}
                className="sky__hit"
                transform={`translate(${centre.x.toFixed(2)} ${centre.y.toFixed(2)})`}
                points={HIT_POINTS}
                onMouseEnter={() => registry.hoverTargetAction(cell)}
                onMouseLeave={() => registry.hoverTargetAction(null)}
                onClick={() => registry.moveToTargetAction(cell)}
              />
            );
          })}
        </g>
      ) : null}

      {moving && hovered && fits ? <FloatingIsland worldIsland={player} anchor={hovered} ghost /> : null}

      {moving && hovered ? (
        <Footprint cells={footprintOf(player, hovered)} className={`sky__footprint${fits ? "" : " sky__footprint--blocked"}`} />
      ) : null}
    </svg>
  );
};

export { SkyBoard };
