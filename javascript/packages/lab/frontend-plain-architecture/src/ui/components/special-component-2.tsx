import type { TClickButtonAction } from "../../domain/registry";
import type { FC } from "react";

type TSpecialComponent2RegistrySlice = {
  clickButtonAction: TClickButtonAction;
};

type TSpecialComponent2Props = {
  registry: TSpecialComponent2RegistrySlice,
}

const SpecialComponent2: FC<TSpecialComponent2Props> = ({ registry }) => {
  return (
    <button onClick={registry.clickButtonAction}>
      {"Click me"}
    </button>
  );
};

export { SpecialComponent2 };
