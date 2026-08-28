import { useSignals } from "@preact/signals-react/runtime";
import { TabsBar } from "@hw/harwex-notes-components";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TAppRegistry } from "@hw/harwex-notes-protocol";

type TTabsBarContainerProps = {
  registry: TAppRegistry;
};

const TabsBarContainer: FC<TTabsBarContainerProps> = ({ registry }) => {
  useSignals();

  const store = useStore();

  return (
    <TabsBar
      activeId={store.tabs.activeId.value}
      registry={registry}
      tabs={store.derived.openTabs.value}
    />
  );
};

export { TabsBarContainer };
