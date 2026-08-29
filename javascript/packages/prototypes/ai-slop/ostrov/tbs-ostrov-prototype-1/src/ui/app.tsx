import { BOARD_RADIUS } from "../domain/hex/grid";
import { GeneratorPanel } from "./components/generator-panel";
import { IslandBoard } from "./components/island-board";
import { IslandSummary } from "./components/island-summary";
import { SeedControls } from "./components/seed-controls";
import { TileInspector } from "./components/tile-inspector";
import type { FC } from "react";
import type { TAppRegistry } from "../domain/registry";

type TAppProps = {
  registry: TAppRegistry;
};

const App: FC<TAppProps> = ({ registry }) => {
  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">{"Генератор острова"}</h1>
        <p className="app__subtitle">{`Аксиальные координаты, гексагональное поле радиуса ${BOARD_RADIUS}`}</p>
      </header>

      <SeedControls registry={registry} />

      <main className="app__main">
        <aside className="app__side">
          <GeneratorPanel registry={registry} />
        </aside>

        <IslandBoard registry={registry} />

        <aside className="app__side">
          <IslandSummary />
          <TileInspector />
        </aside>
      </main>
    </div>
  );
};

export { App };
