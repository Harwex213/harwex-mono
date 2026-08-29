import { ArenaCanvas } from "./components/arena-canvas";
import { ControlBar } from "./components/control-bar";
import { EventLog } from "./components/event-log";
import { InspectorPanel } from "./components/inspector-panel";
import { ResultBanner } from "./components/result-banner";
import { ShopPanel } from "./components/shop-panel";
import { SquadPanel } from "./components/squad-panel";
import { TopBar } from "./components/top-bar";
import "./app.css";
import type { FC } from "react";
import type { TAppRegistry } from "../domain/registry";

type TAppProps = {
  registry: TAppRegistry;
};

const App: FC<TAppProps> = ({ registry }) => {
  return (
    <div className="app">
      <header className="topbar">
        <h1 className="topbar__title">
          {"Остров — автобой"}
        </h1>

        <TopBar />
      </header>

      <main className="stage">
        <section className="stage__arena">
          <div className="arena__frame">
            <ArenaCanvas registry={registry} />

            <ResultBanner registry={registry} />
          </div>

          <ControlBar registry={registry} />
        </section>

        <aside className="stage__side">
          <ShopPanel registry={registry} />

          <SquadPanel registry={registry} />

          <InspectorPanel />

          <EventLog />
        </aside>
      </main>
    </div>
  );
};

export { App };
