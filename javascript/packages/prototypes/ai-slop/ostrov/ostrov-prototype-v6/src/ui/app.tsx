import { useSignals } from "@preact/signals-react/runtime";
import { BattlePage } from "./pages/battle-page";
import { IslandPage } from "./pages/island-page";
import { MainMenuPage } from "./pages/main-menu-page";
import { WorldPage } from "./pages/world-page";
import { useStore } from "../store/store";
import type { FC } from "react";
import type { TAppRegistry } from "../domain/registry";
import "./app.css";

type TAppProps = {
  registry: TAppRegistry;
};

const App: FC<TAppProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const page = store.route.page.value;

  if (page === "island") {
    return <IslandPage registry={registry} />;
  }

  if (page === "world") {
    return <WorldPage registry={registry} />;
  }

  if (page === "battle") {
    return <BattlePage registry={registry} />;
  }

  return <MainMenuPage registry={registry} />;
};

export { App };
