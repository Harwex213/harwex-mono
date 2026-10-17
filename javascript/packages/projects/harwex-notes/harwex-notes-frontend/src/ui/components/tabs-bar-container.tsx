import { useSignals } from "@preact/signals-react/runtime";
import { TabsBar } from "@hw/harwex-notes-components";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TAppRegistry } from "@hw/harwex-notes-protocol";
import type { TTabSaveState } from "@hw/harwex-notes-components";

// Tabs whose changes cannot reach the disk by themselves. Closing one loses them, so the
// user confirms first (TAB-9, SYNC-5).
const CONFIRM_CLOSE_STATES: ReadonlySet<TTabSaveState> = new Set(["conflict", "deleted", "failed"]);

type TTabsBarContainerProps = {
  registry: TAppRegistry;
};

const TabsBarContainer: FC<TTabsBarContainerProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const tabs = store.derived.openTabs.value;

  const closeTab = (nodeId: string) => {
    const tab = tabs.find((candidate) => candidate.id === nodeId);
    const isLossConfirmed =
      tab === undefined ||
      !CONFIRM_CLOSE_STATES.has(tab.saveState) ||
      window.confirm(`Close "${tab.name}"? Its unsaved changes will be lost.`);

    if (isLossConfirmed) {
      registry.closeTabAction(nodeId);
    }
  };

  return (
    <TabsBar
      activeId={store.tabs.activeId.value}
      registry={{ activateTabAction: registry.activateTabAction, closeTabAction: closeTab }}
      tabs={tabs}
    />
  );
};

export { TabsBarContainer };
