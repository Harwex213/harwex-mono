import { EmpirePanel } from "./components/empire-panel";
import { TechCanvas } from "./components/tech-canvas";
import { TechPopup } from "./components/tech-popup";
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
          {"Остров — снежинка технологий"}
        </h1>

        <button type="button" className="button topbar__restart" onClick={() => registry.restartAction()}>
          {"Заново"}
        </button>
      </header>

      <main className="stage">
        <section className="stage__canvas">
          <TechCanvas registry={registry} />

          <TechPopup registry={registry} />
        </section>

        <aside className="stage__side">
          <EmpirePanel />
        </aside>
      </main>
    </div>
  );
};

export { App };
