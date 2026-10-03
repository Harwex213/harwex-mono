import { useSignals } from "@preact/signals-react/runtime";
import { BattlePage } from "./pages/battle-page";
import { IslandPage } from "./pages/island-page";
import { WorldPage } from "./pages/world-page";
import { SlotModal } from "./components/slot-modal";
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
  const pageView = page === "world"
    ? <WorldPage registry={registry} />
    : page === "battle"
      ? <BattlePage registry={registry} />
      : <IslandPage registry={registry} />;

  // The toxicity slot opens when the tax phase ends, over whatever page is on
  // screen, and stays until its button takes the player to the world map.
  return (
    <>
      {pageView}

      <SlotModal registry={registry} />
    </>
  );
};

export { App };
