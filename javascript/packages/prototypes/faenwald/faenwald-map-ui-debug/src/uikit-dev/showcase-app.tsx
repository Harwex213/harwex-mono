import { useState } from "react";
import { TooltipProvider } from "../uikit";
import s from "./showcase-app.module.css";

type TShowcaseEntry = {
  name: string;
  render: () => React.ReactNode;
};

const modules = import.meta.glob<{ default: TShowcaseEntry }>(
  "../ui/kit/**/*.showcase.tsx",
  { eager: true },
);

const entries: TShowcaseEntry[] = Object.values(modules)
  .map((m) => m.default)
  .filter(Boolean)
  .sort((a, b) => a.name.localeCompare(b.name));

export function ShowcaseApp() {
  const [selected, setSelected] = useState(entries[0]?.name);
  const active = entries.find((e) => e.name === selected);

  return (
    <TooltipProvider>
      <div className={s.layout}>
        <nav className={s.sidebar}>
          <h1 className={s.title}>UI Kit</h1>
          <p className={s.count}>{entries.length} components</p>
          <ul className={s.navList}>
            {entries.map((e) => (
              <li key={e.name}>
                <button
                  className={`${s.navItem} ${selected === e.name ? s.navItemActive : ""}`}
                  onClick={() => setSelected(e.name)}
                >
                  {e.name}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <main className={s.main}>
          {active ? (
            <>
              <h2 className={s.componentName}>{active.name}</h2>
              <div className={s.componentArea}>{active.render()}</div>
            </>
          ) : (
            <p className={s.empty}>Select a component</p>
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}
