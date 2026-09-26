import { useSignals } from "@preact/signals-react/runtime";
import { PHASES, phaseIndex } from "../../core/phases";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TEndPhaseAction, TSkipTaxAnimationAction } from "../../domain/registry";

/** Geometry of the phase wheel, in the SVG's own units. */
const WHEEL_RADIUS = 52;
const ICON_RADIUS = 33;
const QUARTER_DEG = 360 / PHASES.length;
const HALF_QUARTER_RAD = (QUARTER_DEG / 2 / 180) * Math.PI;
const SECTOR_EDGE = WHEEL_RADIUS * Math.sin(HALF_QUARTER_RAD);
const SECTOR_DEPTH = WHEEL_RADIUS * Math.cos(HALF_QUARTER_RAD);

/** The quarter that points north, which is always the phase in play. */
const NORTH_SECTOR = [
  "M 0 0",
  `L ${(-SECTOR_EDGE).toFixed(2)} ${(-SECTOR_DEPTH).toFixed(2)}`,
  `A ${WHEEL_RADIUS} ${WHEEL_RADIUS} 0 0 1 ${SECTOR_EDGE.toFixed(2)} ${(-SECTOR_DEPTH).toFixed(2)}`,
  "Z",
].join(" ");

type TEndTurnPanelRegistrySlice = {
  endPhaseAction: TEndPhaseAction;
  skipTaxAnimationAction: TSkipTaxAnimationAction;
};

type TEndTurnPanelProps = {
  registry: TEndTurnPanelRegistrySlice;
};

/**
 * The end-turn wheel of the reference: four phases around a disc, the one in
 * play always at north. While an animation owns the turn the same button skips
 * it instead of ending the phase.
 */
const EndTurnPanel: FC<TEndTurnPanelProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const current = phaseIndex(store.game.phase.value);
  const busy = store.ui.busy.value;

  return (
    <div className="panel end-turn-panel">
      <button
        type="button"
        className={`end-turn-wheel ${busy ? "end-turn-wheel--busy" : ""}`}
        onClick={busy ? registry.skipTaxAnimationAction : registry.endPhaseAction}
      >
        <span className="end-turn-wheel__banner">
          {busy ? "Пропустить" : "Готов"}
        </span>

        <svg className="end-turn-wheel__svg" viewBox="-60 -60 120 120" role="presentation">
          <circle className="wheel__disc" r={WHEEL_RADIUS} />

          <path className="wheel__active" d={NORTH_SECTOR} />

          {PHASES.map((phase, index) => (
            <line
              className="wheel__spoke"
              key={`spoke-${phase.id}`}
              x1={0}
              y1={0}
              x2={WHEEL_RADIUS * Math.sin(((index * QUARTER_DEG + QUARTER_DEG / 2) / 180) * Math.PI)}
              y2={-WHEEL_RADIUS * Math.cos(((index * QUARTER_DEG + QUARTER_DEG / 2) / 180) * Math.PI)}
            />
          ))}

          {/* The whole ring turns, and each icon turns back, so icons stay upright. */}
          <g className="wheel__icons" transform={`rotate(${-current * QUARTER_DEG})`}>
            {PHASES.map((phase, index) => {
              const angleRad = ((index * QUARTER_DEG) / 180) * Math.PI;
              const x = ICON_RADIUS * Math.sin(angleRad);
              const y = -ICON_RADIUS * Math.cos(angleRad);

              return (
                <g
                  className="wheel__icon"
                  key={phase.id}
                  transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${current * QUARTER_DEG})`}
                >
                  <text
                    className={index === current ? "wheel__emoji wheel__emoji--active" : "wheel__emoji"}
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    {phase.emoji}
                  </text>
                </g>
              );
            })}
          </g>

          <circle className="wheel__rim" r={WHEEL_RADIUS} />
        </svg>

        <span className="end-turn-wheel__caption">
          {PHASES[current]?.short ?? ""}
        </span>
      </button>
    </div>
  );
};

export { EndTurnPanel };
