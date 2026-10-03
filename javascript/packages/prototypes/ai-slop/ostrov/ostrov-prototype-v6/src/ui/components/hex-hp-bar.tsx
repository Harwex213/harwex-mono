import { HEX_SIZE } from "../../core/hex";
import { structureHp } from "../../core/structure-hp";
import type { FC } from "react";
import type { THex, TPlayer } from "../../core/types";

/** Sits just above the building sprite of `island-canvas.tsx` (its ART_SPAN and ART_LIFT). */
const BAR_TOP = -HEX_SIZE * 0.68 - HEX_SIZE * 0.08 - 6;
const BAR_WIDTH = HEX_SIZE * 0.9;
const BAR_HEIGHT = 5;

type THexHpBarProps = {
  player: TPlayer | null;
  hex: THex;
};

/**
 * A small hp bar over a building that battle has damaged. A building at full
 * health shows nothing, so the island stays clean. Ruins say so.
 */
const HexHpBar: FC<THexHpBarProps> = ({ player, hex }) => {
  const state = structureHp(player, hex);
  if (!state || state.hp >= state.max) {
    return null;
  }

  const share = state.hp / state.max;

  return (
    <g className="hex-hp" transform={`translate(${-BAR_WIDTH / 2} ${BAR_TOP})`}>
      <rect className="hex-hp__frame" x={-1.5} y={-1.5} width={BAR_WIDTH + 3} height={BAR_HEIGHT + 3} rx={1.5} />
      <rect className="hex-hp__track" width={BAR_WIDTH} height={BAR_HEIGHT} />
      <rect
        className={`hex-hp__fill ${share <= 0.35 ? "hex-hp__fill--low" : ""}`}
        width={BAR_WIDTH * share}
        height={BAR_HEIGHT}
      />
      {state.hp <= 0 ? (
        <text className="hex-hp__label" x={BAR_WIDTH / 2} y={-6}>
          {"руины"}
        </text>
      ) : null}
    </g>
  );
};

type THpLineProps = {
  player: TPlayer | null;
  hex: THex;
  className: string;
};

/** The hp of the building or stronghold as a text line, for the tooltip and the hex modal. */
const StructureHpLine: FC<THpLineProps> = ({ player, hex, className }) => {
  const state = structureHp(player, hex);
  if (!state) {
    return null;
  }

  let note = "";
  if (state.hp <= 0) {
    note = " — руины: не приносит дохода, пока не починится";
  } else if (state.hp < state.max) {
    note = " — чинится на 25% в конце хода";
  }

  return (
    <div className={`${className} hex-hp-line ${state.hp < state.max ? "hex-hp-line--damaged" : ""}`}>
      {`Прочность: ${Math.round(state.hp)} / ${state.max}${note}`}
    </div>
  );
};

export { HexHpBar, StructureHpLine };
