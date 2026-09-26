import { useSignals } from "@preact/signals-react/runtime";
import { BattlePage } from "./pages/battle-page";
import { IslandPage } from "./pages/island-page";
import { MainMenuPage } from "./pages/main-menu-page";
import { WorldPage } from "./pages/world-page";
import { useStore } from "../store/store";
import "./app.css";
import type { FC } from "react";
import type { TAppRegistry } from "../domain/registry";

type TAppProps = {
  registry: TAppRegistry;
};

/**
 * One page at a time, picked by the route signal. Each page owns its own
 * teardown: a forgotten cleanup leaves a second render loop running on top of
 * the first.
 */
const App: FC<TAppProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const page = store.route.page.value;
  const started = store.game.started.value;

  // A deep link into the game before `startGame` has run has nothing to render,
  // so the menu answers for every route until the game exists.
  if (!started) {
    return <MainMenuPage registry={registry} />;
  }

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
