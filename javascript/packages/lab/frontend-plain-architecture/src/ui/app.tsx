import type { FC } from "react";
import { SpecialComponent } from "./components/special-component-1";
import { SpecialComponent2 } from "./components/special-component-2";
import type { TAppRegistry } from "../domain/registry";

type TAppProps = {
  registry: TAppRegistry;
}

const App: FC<TAppProps> = ({ registry }) => {
  return (
    <div>
      <SpecialComponent />

      <SpecialComponent2 registry={registry} />
    </div>
  );
};

export { App };
