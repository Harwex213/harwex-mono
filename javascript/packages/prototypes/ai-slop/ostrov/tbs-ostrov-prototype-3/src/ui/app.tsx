import { ActionCards } from "./components/action-cards";
import { Hud } from "./components/hud";
import { IslandPanel } from "./components/island-panel";
import { SkyBoard } from "./components/sky-board";
import type { FC } from "react";
import type { TAppRegistry } from "../domain/registry";

type TAppProps = {
  registry: TAppRegistry;
};

const App: FC<TAppProps> = ({ registry }) => {
  return (
    <div className="app">
      <Hud registry={registry} />

      <main className="app__main">
        <SkyBoard registry={registry} />
        <IslandPanel />
      </main>

      <ActionCards registry={registry} />
    </div>
  );
};

export { App };
