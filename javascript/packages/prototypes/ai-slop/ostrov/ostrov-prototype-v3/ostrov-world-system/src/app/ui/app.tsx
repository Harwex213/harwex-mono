import { SeedControls } from "./components/seed-controls";
import { WorldMap } from "./components/world-map";
import { WorldPanel } from "./components/world-panel";
import type { FC } from "react";
import type { TAppRegistry } from "../domain/registry";

type TAppProps = {
  registry: TAppRegistry;
};

const App: FC<TAppProps> = ({ registry }) => {
  return (
    <div className="app">
      <header className="app__bar">
        <h1 className="app__title">{"Генератор мира"}</h1>

        <SeedControls registry={registry} />
      </header>

      <main className="app__main">
        <aside className="app__side">
          <WorldPanel registry={registry} />
        </aside>

        <WorldMap registry={registry} />
      </main>
    </div>
  );
};

export { App };
