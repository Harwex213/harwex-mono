import { COLORS } from "../palette";
import { DECOR_BASE_SIZE, HEX_DEPTH, HEX_SIZE, hexPolygonPoints, hexToPoint } from "../../domain/hex/layout";
import { TileDecoration } from "./tile-decoration";
import { coastlinePath } from "../../domain/hex/outline";
import { hexKey } from "../../domain/hex/coords";
import type { CSSProperties, FC } from "react";
import type { TAxial } from "../../domain/hex/coords";
import type { TTile } from "../../domain/island/generator";
import type { TWorldIsland } from "../../domain/world/world";

const HEX_POINTS = hexPolygonPoints();
const SAND_POINTS = hexPolygonPoints(1.06);
const CLIFF_POINTS = hexPolygonPoints(1.04);
const DECOR_SCALE = HEX_SIZE / DECOR_BASE_SIZE;

/** Layers of rock under the top face. Each one is a little smaller, so the bottom tapers. */
const UNDERSIDE_LAYERS: readonly { drop: number; scale: number; fill: string }[] = [
  { drop: HEX_DEPTH * 3, scale: 0.62, fill: COLORS.cliffDeep },
  { drop: HEX_DEPTH * 2, scale: 0.86, fill: COLORS.cliffDark },
  { drop: HEX_DEPTH, scale: 1.04, fill: COLORS.cliff },
];

type TFloatingIslandProps = {
  worldIsland: TWorldIsland;
  /** Overrides the anchor. Used for the ghost preview of a move. */
  anchor?: TAxial;
  selected?: boolean;
  ghost?: boolean;
  /** Bob phase, so islands do not all rise and fall together. */
  phase?: number;
  onClick?: () => void;
};

const translateOf = (tile: TAxial) => {
  const centre = hexToPoint(tile);

  return `translate(${centre.x.toFixed(2)} ${centre.y.toFixed(2)})`;
};

/**
 * One island drawn at its anchor. The outer group carries a CSS transform so
 * a move glides instead of jumping; the inner group bobs on the spot.
 */
const FloatingIsland: FC<TFloatingIslandProps> = ({ worldIsland, anchor, selected, ghost, phase = 0, onClick }) => {
  const { island, owner } = worldIsland;
  const position = hexToPoint(anchor ?? worldIsland.anchor);
  const land = island.tiles.filter((tile: TTile) => tile.land);
  const landKeys = new Set(land.map((tile) => tile.key));
  const isLand = (q: number, r: number) => landKeys.has(hexKey(q, r));
  const outline = coastlinePath(land, isLand);
  const ringColor = owner === "player" ? COLORS.player : COLORS.neutral;

  const style: CSSProperties = {
    transform: `translate(${position.x.toFixed(2)}px, ${position.y.toFixed(2)}px)`,
  };
  const bobStyle: CSSProperties = { animationDelay: `${(-phase).toFixed(2)}s` };

  return (
    <g className={`island${ghost ? " island--ghost" : ""}`} style={style} data-owner={owner}>
      <g className="island__bob" style={bobStyle}>
        {ghost ? null : (
          <g className="island__shadow" fill={COLORS.shadow} filter="url(#island-shadow)">
            {land.map((tile) => (
              <polygon key={tile.key} transform={`${translateOf(tile)} translate(6 ${HEX_DEPTH * 5})`} points={HEX_POINTS} />
            ))}
          </g>
        )}

        {UNDERSIDE_LAYERS.map((layer) => (
          <g key={layer.drop} fill={layer.fill}>
            {land.map((tile) => (
              <polygon
                key={tile.key}
                transform={`${translateOf(tile)} translate(0 ${layer.drop})`}
                points={hexPolygonPoints(layer.scale)}
              />
            ))}
          </g>
        ))}

        <g fill={COLORS.cliffDark}>
          {land.map((tile) => (
            <polygon key={tile.key} transform={`${translateOf(tile)} translate(0 ${HEX_DEPTH})`} points={CLIFF_POINTS} />
          ))}
        </g>

        <g fill={COLORS.coast}>
          {land.map((tile) => (
            <polygon key={tile.key} transform={translateOf(tile)} points={SAND_POINTS} />
          ))}
        </g>

        <g>
          {land.map((tile) => (
            <g key={tile.key} transform={translateOf(tile)}>
              <polygon
                points={HEX_POINTS}
                fill={`url(#terrain-${tile.terrain})`}
                stroke="rgba(28, 46, 24, 0.28)"
                strokeWidth={1}
              />
              <g className="island__decor" transform={`scale(${DECOR_SCALE.toFixed(3)})`}>
                <TileDecoration terrain={tile.terrain!} seed={island.seed} q={tile.q} r={tile.r} />
              </g>
            </g>
          ))}
        </g>

        <path d={outline} fill="none" stroke="rgba(20, 40, 52, 0.55)" strokeWidth={1.8} strokeLinecap="round" />

        {selected ? (
          <path
            className="island__ring"
            d={outline}
            fill="none"
            stroke={ringColor}
            strokeWidth={3.2}
            strokeLinecap="round"
          />
        ) : null}

        {onClick ? (
          <g className="island__hits">
            {land.map((tile) => (
              <polygon key={tile.key} className="island__hit" transform={translateOf(tile)} points={HEX_POINTS} onClick={onClick} />
            ))}
          </g>
        ) : null}
      </g>
    </g>
  );
};

export { FloatingIsland };
