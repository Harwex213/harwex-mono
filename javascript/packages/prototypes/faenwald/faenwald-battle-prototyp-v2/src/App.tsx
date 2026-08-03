import { useSignals } from "@preact/signals-react/runtime";
import { PAGES, pageFor } from "./pages/pages";
import { hrefFor, route } from "./router/route-state";
import { ThemeSwitch } from "./theme/ThemeSwitch";
import styles from "./app.module.css";

function App() {
  // `useSignals` subscribes this component to every signal read below. The
  // repo has no Babel step, so the auto-tracking transform is unavailable and
  // each component that reads `.value` opts in by hand.
  useSignals();

  const page = pageFor(route.value);
  const Current = page.Component;

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <h1 className={styles.title}>Faenwald Battle — Prototype v2</h1>
        <nav className={styles.nav}>
          {PAGES.map((entry) => (
            <a
              className={entry.id === page.id ? `${styles.tab} ${styles.tabActive}` : styles.tab}
              href={hrefFor(entry.id)}
              key={entry.id}
            >
              {entry.title}
            </a>
          ))}
        </nav>
        <ThemeSwitch />
      </header>

      <main className={styles.main}>
        <Current />
      </main>
    </div>
  );
}

export { App };
