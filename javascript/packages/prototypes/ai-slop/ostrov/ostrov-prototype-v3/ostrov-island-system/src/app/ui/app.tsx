import { ConfigDump } from "./components/config-dump";
import { GeneratorPanel } from "./components/generator-panel";
import { IslandBoard } from "./components/island-board";
import { SeedControls } from "./components/seed-controls";
import type { FC } from "react";
import type { TAppRegistry } from "../domain/registry";

type TAppProps = {
  registry: TAppRegistry;
};

const App: FC<TAppProps> = ({ registry }) => {
  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">{"Настройка генератора острова"}</h1>
      </header>

      <SeedControls registry={registry} />

      <main className="app__main">
        <aside className="app__side">
          <GeneratorPanel registry={registry} />
        </aside>

        <IslandBoard registry={registry} />

        <aside className="app__side">
          <ConfigDump />
        </aside>
      </main>
    </div>
  );
};

export { App };
