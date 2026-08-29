import { useSignals } from "@preact/signals-react/runtime";
import { COLORS, TERRAIN_GRADIENTS } from "../palette";
import { FloatingIsland } from "./floating-island";
import { HEX_DEPTH, HEX_SIZE, hexPolygonPoints, hexToPoint } from "../../domain/hex/layout";
import { SKY_RADIUS, linksOf, moveTargetsOf } from "../../domain/world/world";
import { TERRAIN_LIST } from "../../domain/island/terrain";
import { createGrid } from "../../domain/hex/grid";
import { hexKey } from "../../domain/hex/coords";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TAxial } from "../../domain/hex/coords";
import type { THoverTargetAction, TMoveToTargetAction, TSelectIslandAction } from "../../domain/registry";
import type { TWorldIsland } from "../../domain/world/world";

const BOARD_PADDING = 40;
const CELL_POINTS = hexPolygonPoints(0.94);
const TARGET_POINTS = hexPolygonPoints(0.8);
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

/** A flight route: a curve from one anchor to another that sags a little in the middle. */
const routePath = (from: TAxial, to: TAxial) => {
  const a = hexToPoint(from);
  const b = hexToPoint(to);
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2 + 10;

  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${midX.toFixed(1)} ${midY.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
};

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
  const targets = mode === "move" ? moveTargetsOf(world, player.id) : [];
  const hoveredKey = hovered ? hexKey(hovered.q, hovered.r) : null;
  const links = linksOf(world);

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

      {mode === "move" ? (
        <g className="sky__routes" fill="none" stroke={COLORS.target} strokeLinecap="round">
          {targets.map((target) => {
            const key = hexKey(target.q, target.r);
            const active = key === hoveredKey;

            return (
              <path
                key={key}
                d={routePath(player.anchor, target)}
                strokeWidth={active ? 3.5 : 1.4}
                opacity={active ? 1 : 0.3}
                strokeDasharray={active ? "none" : "6 8"}
              />
            );
          })}
        </g>
      ) : null}

      {mode === "move" ? (
        <g className="sky__targets">
          {targets.map((target) => {
            const key = hexKey(target.q, target.r);
            const centre = hexToPoint(target);

            return (
              <polygon
                key={key}
                className={`sky__target${key === hoveredKey ? " sky__target--hover" : ""}`}
                transform={`translate(${centre.x.toFixed(2)} ${centre.y.toFixed(2)})`}
                points={TARGET_POINTS}
                onMouseEnter={() => registry.hoverTargetAction(target)}
                onMouseLeave={() => registry.hoverTargetAction(null)}
                onClick={() => registry.moveToTargetAction(target)}
              />
            );
          })}
        </g>
      ) : null}

      {mode === "move" && hovered ? <FloatingIsland worldIsland={player} anchor={hovered} ghost /> : null}
    </svg>
  );
};

export { SkyBoard };
