import { useEffect } from "react";
import { ArmyInspector } from "./components/army-inspector";
import { ArmyList } from "./components/army-list";
import { CityPanel } from "./components/city-panel";
import { EventLog } from "./components/event-log";
import { MapCanvas } from "./components/map-canvas";
import { ResultBanner } from "./components/result-banner";
import { TerrainLegend } from "./components/terrain-legend";
import { TileInspector } from "./components/tile-inspector";
import { TurnPanel } from "./components/turn-panel";
import { ViewOptions } from "./components/view-options";
import { WorldPanel } from "./components/world-panel";
import type { TAppRegistry } from "../domain/registry";
import type { FC } from "react";

type TAppProps = {
  registry: TAppRegistry;
};

const App: FC<TAppProps> = ({ registry }) => {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        registry.endTurnAction();

        return;
      }
      if (event.code === "KeyN") {
        registry.selectNextArmyAction();

        return;
      }
      if (event.code === "Escape") {
        registry.selectArmyAction(-1);
      }
    };

    window.addEventListener("keydown", handleKey);

    return () => window.removeEventListener("keydown", handleKey);
  }, [registry]);

  return (
    <div className="app">
      <aside className="app__sidebar app__sidebar--left">
        <TurnPanel registry={registry} />
        <CityPanel registry={registry} />
        <WorldPanel registry={registry} />
      </aside>

      <main className="app__stage">
        <MapCanvas registry={registry} />
        <ResultBanner registry={registry} />
      </main>

      <aside className="app__sidebar app__sidebar--right">
        <ArmyInspector />
        <ArmyList registry={registry} />
        <TileInspector />
        <TerrainLegend />
        <EventLog />
        <ViewOptions registry={registry} />
      </aside>
    </div>
  );
};

export { App };
