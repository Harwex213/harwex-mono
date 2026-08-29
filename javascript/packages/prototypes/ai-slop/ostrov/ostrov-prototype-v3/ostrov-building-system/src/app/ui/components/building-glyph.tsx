import { COLORS } from "../palette";
import type { FC } from "react";
import type { Building } from "../../../core/exports";

type TBuildingGlyphProps = {
  building: Building;
};

/** A little house, drawn in the middle of its tile. Bigger at higher levels. */
const House: FC<{ scale: number; roof: string }> = ({ scale, roof }) => (
  <g transform={`scale(${scale.toFixed(2)})`}>
    <path d="M-14 4 L-14 -8 L0 -20 L14 -8 L14 4 Z" fill={COLORS.wall} />
    <path d="M0 4 L0 -20 L14 -8 L14 4 Z" fill={COLORS.wallShade} />
    <path d="M-17 -6 L0 -22 L17 -6 L13 -6 L0 -17 L-13 -6 Z" fill={roof} />
    <rect x={-4} y={-6} width={6} height={10} fill={COLORS.roofDark} rx={1} />
  </g>
);

/** Poles and a crossbeam while a building is under construction. */
const Scaffold: FC<{ scale: number }> = ({ scale }) => (
  <g transform={`scale(${scale.toFixed(2)})`} stroke={COLORS.scaffold} strokeWidth={2.2} strokeLinecap="round">
    <path d="M-14 6 L-14 -14 M14 6 L14 -14 M-14 -12 L14 -12 M-14 -2 L14 -2" />
    <path d="M-10 6 L10 -10" strokeWidth={1.4} opacity={0.7} />
  </g>
);

const BuildingGlyph: FC<TBuildingGlyphProps> = ({ building }) => {
  const scale = 0.9 + (building.level - 1) * 0.18;

  if (!building.isActive) {
    return <Scaffold scale={scale} />;
  }

  const roof = building.def.unique ? COLORS.selection : COLORS.roof;

  return (
    <g>
      <House scale={scale} roof={roof} />
      {building.level > 1 ? (
        <text y={16} textAnchor="middle" fontSize={9} fontWeight={700} fill="#1f2f26">
          {`ур. ${building.level}`}
        </text>
      ) : null}
    </g>
  );
};

export { BuildingGlyph };
