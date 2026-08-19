import { rouletteColour } from "../model/lobby";

type HistoryStripProps = {
  readonly history: readonly number[];
  readonly limit?: number;
};

function HistoryStrip({ history, limit = 6 }: HistoryStripProps) {
  return (
    <span className="lc-history">
      {history.slice(0, limit).map((result, index) => (
        <span
          key={`${result}-${index}`}
          className={`lc-history__item lc-history__item--${rouletteColour(result)}`}
        >
          {result}
        </span>
      ))}
    </span>
  );
}

export { HistoryStrip };
