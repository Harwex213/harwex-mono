import type { FC } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import type { TAppRegistry } from "../domain/registry";
import { useStore } from "../store/store";
import { HomeScreen } from "./components/home-screen";
import { JoinScreen } from "./components/join-screen";
import { NewPickScreen } from "./components/new-pick-screen";
import { PickScreen } from "./components/pick-screen";

type TAppProps = {
  registry: TAppRegistry;
};

const App: FC<TAppProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const route = store.route.value;

  return (
    <div className="app">
      <header className="topbar">
        <a className="logo" href="#/">
          <span className="logo-mark">CS2</span>
          Map Picker
        </a>
      </header>

      <main className="content">
        {store.metaError.value && <div className="error-banner">Сервер недоступен: {store.metaError.value}</div>}
        {route.name === "home" && <HomeScreen registry={registry} />}
        {route.name === "new" && <NewPickScreen registry={registry} />}
        {route.name === "join" && <JoinScreen registry={registry} />}
        {route.name === "pick" && <PickScreen key={route.id} registry={registry} />}
      </main>
    </div>
  );
};

export { App };
