import { HEX_SIZE } from "../../../core/hex/layout";
import { createRng, mixSeed } from "@hw/ostrov-utils";
import type { TRng } from "@hw/ostrov-utils";
import type { TTerrain } from "../../../core/island/terrain";
import { COLORS } from "../palette";
import type { FC } from "react";

type TScatterPoint = {
  x: number;
  y: number;
  scale: number;
};

/**
 * Points inside the circle that fits into a hex. `sqrt` on the radius spreads
 * the points evenly instead of bunching them around the centre.
 */
const scatter = (rng: TRng, count: number, spread: number): TScatterPoint[] => {
  const points: TScatterPoint[] = [];

  for (let index = 0; index < count; index += 1) {
    const angle = rng.range(0, Math.PI * 2);
    const radius = HEX_SIZE * spread * Math.sqrt(rng.next());

    points.push({
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle) * 0.72,
      scale: rng.range(0.8, 1.15),
    });
  }

  // Painter order: whatever stands lower on the tile is nearer, so it goes last.
  return points.sort((a, b) => a.y - b.y);
};

const Tree: FC<TScatterPoint> = ({ x, y, scale }) => (
  <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${scale.toFixed(2)})`}>
    <rect x={-1.4} y={-8} width={2.8} height={8} rx={1.2} fill={COLORS.trunk} />
    <path d="M0 -26 L9 -5 L-9 -5 Z" fill={COLORS.canopyDark} />
    <path d="M0 -30 L6.5 -14 L-6.5 -14 Z" fill={COLORS.canopy} />
  </g>
);

const Peak: FC<TScatterPoint> = ({ x, y, scale }) => (
  <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${scale.toFixed(2)})`}>
    <path d="M0 -44 L26 0 L-26 0 Z" fill={COLORS.rock} />
    <path d="M0 -44 L26 0 L0 0 Z" fill={COLORS.rockDark} />
    <path d="M0 -44 L8.5 -30 L3.5 -26.5 L-2 -31 L-7.5 -27.5 Z" fill={COLORS.snow} />
  </g>
);

const Tuft: FC<TScatterPoint> = ({ x, y, scale }) => (
  <path
    d="M0 0 q 2.5 -5 4.5 -6.5 M0 0 q -2.5 -5.5 -4.5 -7 M0 0 q 0.5 -6 1 -8.5"
    transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${scale.toFixed(2)})`}
    stroke={COLORS.tuft}
    strokeWidth={1.6}
    strokeLinecap="round"
    fill="none"
  />
);

/** A rounded grassy hill. The lighter dome on top is the sunlit side. */
const Mound: FC<TScatterPoint> = ({ x, y, scale }) => (
  <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${scale.toFixed(2)})`}>
    <path d="M-17 2 q 17 -21 34 0 Z" fill={COLORS.mound} />
    <path d="M-11 -3 q 11 -13 21 -2 q -10 -4 -21 2 Z" fill={COLORS.moundTop} />
  </g>
);

/** Dry grass on flat ground: a short dash, and now and then a stone. */
const DryGrass: FC<TScatterPoint> = ({ x, y, scale }) => (
  <path
    d="M-7 0 h 14 M-3 4 h 8"
    transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${scale.toFixed(2)})`}
    stroke={COLORS.dryGrass}
    strokeWidth={1.6}
    strokeLinecap="round"
    fill="none"
  />
);

type TSeaMarksProps = {
  seed: number;
  q: number;
  r: number;
};

/** A couple of wave strokes, so the open water is not a flat field of hexes. */
const SeaMarks: FC<TSeaMarksProps> = ({ seed, q, r }) => {
  const rng = createRng(mixSeed(seed, q, r, 0x5ea));
  const marks = scatter(rng, rng.int(1, 3), 0.4);

  return (
    <g stroke={COLORS.seaHexEdge} strokeWidth={2} strokeLinecap="round" fill="none" opacity={0.5}>
      {marks.map((mark, index) => (
        <path
          key={index}
          d="M-9 0 q 4.5 -4 9 0 t 9 0"
          transform={`translate(${mark.x.toFixed(1)} ${mark.y.toFixed(1)}) scale(${mark.scale.toFixed(2)})`}
        />
      ))}
    </g>
  );
};

type TTileDecorationProps = {
  terrain: TTerrain;
  seed: number;
  q: number;
  r: number;
};

const TileDecoration: FC<TTileDecorationProps> = ({ terrain, seed, q, r }) => {
  const rng = createRng(mixSeed(seed, q, r));

  if (terrain === "forest") {
    return (
      <g>
        {scatter(rng, rng.int(4, 6), 0.52).map((point, index) => (
          <Tree key={index} {...point} />
        ))}
      </g>
    );
  }

  if (terrain === "hills") {
    return (
      <g>
        {scatter(rng, rng.int(2, 4), 0.4).map((point, index) => (
          <Mound key={index} {...point} />
        ))}
      </g>
    );
  }

  if (terrain === "plains") {
    const rows = scatter(rng, rng.int(4, 6), 0.56);
    const stoneCount = rng.int(0, 2);

    return (
      <g>
        {rows.map((point, index) => (
          <DryGrass key={index} {...point} />
        ))}
        {rows.slice(0, stoneCount).map((point, index) => (
          <ellipse
            key={`stone-${index}`}
            cx={point.x + rng.range(-8, 8)}
            cy={point.y + rng.range(-5, 5)}
            rx={3.2}
            ry={2.1}
            fill={COLORS.stone}
          />
        ))}
      </g>
    );
  }

  if (terrain === "mountain") {
    const peaks = scatter(rng, rng.int(2, 3), 0.32).map((point, index) => ({
      ...point,
      // The first peak is the massif, the rest are foothills beside it.
      scale: index === 0 ? point.scale * 0.9 : point.scale * 0.5,
    }));

    return (
      <g>
        {peaks.map((point, index) => (
          <Peak key={index} {...point} />
        ))}
      </g>
    );
  }

  const tufts = scatter(rng, rng.int(5, 8), 0.58);
  const flowerCount = rng.int(2, 4);

  return (
    <g>
      {tufts.map((point, index) => (
        <Tuft key={index} {...point} />
      ))}
      {tufts.slice(0, flowerCount).map((point, index) => (
        <circle
          key={`flower-${index}`}
          cx={point.x + rng.range(-6, 6)}
          cy={point.y + rng.range(-4, 4)}
          r={1.7}
          fill={COLORS.flower[index % COLORS.flower.length]}
        />
      ))}
    </g>
  );
};

export { SeaMarks, TileDecoration };
