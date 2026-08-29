import { GeneratorPanel } from "./components/generator-panel";
import { HexInspector } from "./components/hex-inspector";
import { IslandList } from "./components/island-list";
import { MapCanvas } from "./components/map-canvas";
import { MapSummary } from "./components/map-summary";
import { TerrainLegend } from "./components/terrain-legend";
import { ViewOptions } from "./components/view-options";
import type { TAppRegistry } from "../domain/registry";
import type { FC } from "react";

type TAppProps = {
  registry: TAppRegistry;
};

const App: FC<TAppProps> = ({ registry }) => {
  return (
    <div className="app">
      <aside className="app__sidebar app__sidebar--left">
        <GeneratorPanel registry={registry} />
        <ViewOptions registry={registry} />
      </aside>

      <main className="app__stage">
        <MapCanvas registry={registry} />
      </main>

      <aside className="app__sidebar app__sidebar--right">
        <MapSummary />
        <HexInspector />
        <IslandList registry={registry} />
        <TerrainLegend />
      </aside>
    </div>
  );
};

export { App };
