import { useSignals } from "@preact/signals-react/runtime";
import { BuildMenu } from "./components/build-menu";
import { EventLog } from "./components/event-log";
import { Legend } from "./components/legend";
import { MapCanvas } from "./components/map-canvas";
import { ResourceBar } from "./components/resource-bar";
import { TileInspector } from "./components/tile-inspector";
import { TurnPanel } from "./components/turn-panel";
import { useStore } from "../store/store";
import "./app.css";
import type { TAppRegistry } from "../domain/registry";
import type { FC } from "react";

type TAppProps = {
  registry: TAppRegistry;
};

const App: FC<TAppProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const victory = store.gameState.victory.value;
  const population = store.gameState.population.value;

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="topbar__title">
          {"Остров"}
        </h1>

        <ResourceBar />

        <TurnPanel registry={registry} />
      </header>

      {victory && (
        <div className="banner">
          {`Остров процветает: ${population} колонистов. Нажмите «Новый остров», чтобы начать заново.`}
        </div>
      )}

      <main className="stage">
        <div className="stage__map">
          <MapCanvas registry={registry} />

          <Legend registry={registry} />

          <EventLog />
        </div>

        <aside className="stage__side">
          <TileInspector registry={registry} />

          <BuildMenu registry={registry} />
        </aside>
      </main>
    </div>
  );
};

export { App };
