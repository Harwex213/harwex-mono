import { Board } from "./components/board";
import { CardDock } from "./components/card-dock";
import { TilePanel } from "./components/tile-panel";
import { TurnCurtain } from "./components/turn-curtain";
import { TopBar } from "./components/top-bar";
import type { FC } from "react";
import type { TAppRegistry } from "../domain/registry";

type TAppProps = {
  registry: TAppRegistry;
};

const App: FC<TAppProps> = ({ registry }) => {
  return (
    <div className="app">
      <TopBar registry={registry} />

      <main className="stage">
        <Board registry={registry} />
        <TilePanel registry={registry} />
        <CardDock registry={registry} />
        <TurnCurtain />
      </main>
    </div>
  );
};

export { App };
