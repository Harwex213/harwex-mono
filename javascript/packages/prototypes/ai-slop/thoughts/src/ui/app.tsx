import type { FC } from "react";
import type { TAppRegistry } from "../domain/registry";
import { AddBar } from "./components/add-bar";
import { TabBar } from "./components/tab-bar";
import { ThoughtList } from "./components/thought-list";
import { UndoToast } from "./components/undo-toast";

type TAppProps = {
  registry: TAppRegistry;
};

const App: FC<TAppProps> = ({ registry }) => {
  return (
    <div className="app">
      <ThoughtList registry={registry} />
      <div className="dock">
        <UndoToast registry={registry} />
        <AddBar registry={registry} />
        <TabBar registry={registry} />
      </div>
    </div>
  );
};

export { App };
