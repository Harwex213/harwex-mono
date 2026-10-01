import { signal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef } from "react";
import { createStage } from "./scene/stage";
import styles from "./App.module.css";

const swing = signal(true);
const dolly = signal(true);
const spin = signal(true);

const TOGGLES = [
  { label: "Swing", state: swing },
  { label: "Dolly", state: dolly },
  { label: "Spin", state: spin },
];

function App() {
  useSignals();
  const viewport = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!viewport.current) {
      return;
    }
    return createStage(viewport.current, {
      swing: () => swing.peek(),
      dolly: () => dolly.peek(),
      spin: () => spin.peek(),
    });
  }, []);

  return (
    <>
      <div ref={viewport} className={styles.viewport} />
      <div className={styles.panel}>
        {TOGGLES.map(({ label, state }) => (
          <button
            key={label}
            type="button"
            className={styles.toggle}
            aria-pressed={state.value}
            onClick={() => {
              state.value = !state.value;
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </>
  );
}

export { App };
