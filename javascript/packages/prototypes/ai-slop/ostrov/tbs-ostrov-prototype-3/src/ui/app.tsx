import { ActionCards } from "./components/action-cards";
import { SkyBoard } from "./components/sky-board";
import type { FC } from "react";
import type { TAppRegistry } from "../domain/registry";

type TAppProps = {
  registry: TAppRegistry;
};

const App: FC<TAppProps> = ({ registry }) => {
  return (
    <div className="app">
      <SkyBoard registry={registry} />
      <ActionCards registry={registry} />
    </div>
  );
};

export { App };
