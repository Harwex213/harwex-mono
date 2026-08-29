import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";

const EventLog = () => {
  useSignals();
  const store = useStore();
  const log = store.viewState.log.value;

  return (
    <section className="panel panel--log">
      <h2 className="panel__title">
        {"Хроника"}
      </h2>

      <ul className="log">
        {log.map((entry) => (
          <li className={`log__entry log__entry--${entry.tone}`} key={entry.id}>
            <span className="log__turn">
              {`х.${entry.turn}`}
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
