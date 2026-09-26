import "./turn-panel.css";

type TurnPanelProps = {
  turn: number;
  phase: string;
};

// The turn indicator: the number of the turn over the name of the phase. The
// card sizes to its content, so a long phase name widens it.
const TurnPanel = ({ turn, phase }: TurnPanelProps) => {
  return (
    <div className="ostrov-turn">
      <div className="ostrov-turn__count">Ход {turn}</div>
      {phase === "" ? null : <div className="ostrov-turn__phase">{phase}</div>}
    </div>
  );
};

export { TurnPanel };
export type { TurnPanelProps };
