import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { FC } from "react";

const EventLog: FC = () => {
  useSignals();
  const store = useStore();

  const log = store.gameState.log.value;

  return (
    <section className="panel panel--log">
      <h2 className="panel__title">
        {"Хроника"}
      </h2>

      {log.length === 0 ? (
        <p className="panel__empty">
          {"Пока ничего не произошло."}
        </p>
      ) : (
        <ol className="log">
          {log.map((entry) => (
            <li key={entry.id} className={`log__entry log__entry--${entry.tone}`}>
              <span className="log__turn">
                {entry.turn}
              </span>
              <span className="log__text">
                {entry.text}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};

export { EventLog };
