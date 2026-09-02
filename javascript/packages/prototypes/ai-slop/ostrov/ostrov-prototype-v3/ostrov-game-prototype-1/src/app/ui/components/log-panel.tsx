import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { FC } from "react";

const LogPanel: FC = () => {
  useSignals();
  const store = useStore();
  const game = store.game.value;

  return (
    <ul className="log">
      {game.log.map((entry) => (
        <li key={entry.id} className={`log__entry log__entry--${entry.tone}`}>
          <span className="log__turn">х.{entry.turn}</span>
          <span>{entry.text}</span>
        </li>
      ))}
    </ul>
  );
};

export { LogPanel };
