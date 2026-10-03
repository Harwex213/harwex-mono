import "./turn-end-panel.css";

// One quarter of the turn wheel: the emoji the sector shows and the caption it
// puts under the circle while it is the current phase.
type TurnPhase = {
  id: string;
  icon: string;
  label: string;
};

type TurnEndPanelProps = {
  phases: readonly TurnPhase[];
  activePhaseId: string;
  endLabel: string;
  onEnd(): void;
  disabled?: boolean;
};

// The wheel is drawn in a 200 by 200 box. The centre is (100, 100) and a sector
// reaches 90 out of it, which leaves the ring its own stroke.
const sectorPaths = [
  "M 100 100 L 36.36 36.36 A 90 90 0 0 1 163.64 36.36 Z",
  "M 100 100 L 163.64 36.36 A 90 90 0 0 1 163.64 163.64 Z",
  "M 100 100 L 163.64 163.64 A 90 90 0 0 1 36.36 163.64 Z",
  "M 100 100 L 36.36 163.64 A 90 90 0 0 1 36.36 36.36 Z",
];

// The centroid of each quarter, where its emoji sits.
const iconSpots = [
  { x: 100, y: 48 },
  { x: 152, y: 100 },
  { x: 100, y: 152 },
  { x: 48, y: 100 },
];

const TurnEndPanel = (props: TurnEndPanelProps) => {
  const { phases, activePhaseId, endLabel, onEnd, disabled } = props;

  const activePhase = phases.find((phase) => {
    return phase.id === activePhaseId;
  });

  return (
    <div className="ostrov-turn-end">
      <button
        type="button"
        className="ostrov-turn-end__button"
        onClick={onEnd}
        disabled={disabled}
      >
        {endLabel}
      </button>

      <svg
        className="ostrov-turn-end__wheel"
        viewBox="0 0 200 200"
        role="presentation"
      >
        <circle cx="100" cy="100" r="90" fill="var(--ostrov-abyss)" />

        {sectorPaths.map((path, index) => {
          const phase = phases[index];
          const isActive = phase !== undefined && phase === activePhase;
          const modifier = isActive ? " ostrov-turn-end__sector--active" : "";

          return (
            <path
              key={path}
              className={`ostrov-turn-end__sector${modifier}`}
              d={path}
              fill={isActive ? "var(--ostrov-goldShadow)" : "var(--ostrov-abyss)"}
            />
          );
        })}

        <line
          className="ostrov-turn-end__divider"
          x1="36.36"
          y1="36.36"
          x2="163.64"
          y2="163.64"
          stroke="var(--ostrov-goldShadow)"
        />
        <line
          className="ostrov-turn-end__divider"
          x1="163.64"
          y1="36.36"
          x2="36.36"
          y2="163.64"
          stroke="var(--ostrov-goldShadow)"
        />

        <circle
          className="ostrov-turn-end__ring"
          cx="100"
          cy="100"
          r="90"
          fill="none"
          stroke="var(--ostrov-gold)"
        />

        {iconSpots.map((spot, index) => {
          const phase = phases[index];

          if (!phase) {
            return null;
          }

          return (
            <text
              key={phase.id}
              className="ostrov-turn-end__icon"
              x={spot.x}
              y={spot.y}
              fill="var(--ostrov-light)"
              textAnchor="middle"
              dominantBaseline="central"
            >
              {phase.icon}
            </text>
          );
        })}
      </svg>

      <p className="ostrov-turn-end__caption">{activePhase?.label ?? ""}</p>
    </div>
  );
};

export { TurnEndPanel };
export type { TurnEndPanelProps, TurnPhase };
