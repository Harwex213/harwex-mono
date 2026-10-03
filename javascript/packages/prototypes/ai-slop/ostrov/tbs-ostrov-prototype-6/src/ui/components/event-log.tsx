import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";

const EventLog = () => {
  useSignals();
  const store = useStore();
  const log = store.metaState.log.value;

  return (
    <section className="panel panel--log">
      <header className="panel__head">
        <h2 className="panel__title">
          {"Хроника"}
        </h2>
      </header>

      <ul className="log">
        {log.map((entry) => (
          <li key={entry.id} className="log__row">
            <span className="log__round">
              {`Р${entry.round}`}
            </span>

            <span className="log__text">
              {entry.text}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
};

export { EventLog };
