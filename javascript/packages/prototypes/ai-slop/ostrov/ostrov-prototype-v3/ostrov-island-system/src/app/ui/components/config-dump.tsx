import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";

/**
 * The current config as the object `generateIsland` would take. It is here so
 * a tuned setup can be copied into code; nothing is persisted.
 */
const ConfigDump = () => {
  useSignals();

  const store = useStore();
  const config = store.islandState.config.value;
  const seedText = store.islandState.seedText.value;

  return (
    <section className="panel">
      <h2 className="panel__title">{"Конфиг"}</h2>
      <pre className="config-dump">{JSON.stringify({ seedText, ...config }, null, 2)}</pre>
    </section>
  );
};

export { ConfigDump };
