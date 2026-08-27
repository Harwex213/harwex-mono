import { useSignals } from "@preact/signals-react/runtime";
import { NodeIcon } from "./fs-icons";
import { useStore } from "../../store/store";
import type { FC, MouseEvent } from "react";
import type { TActivateTabAction, TCloseTabAction } from "@hw/harwex-notes-protocol";

type TTabsBarRegistrySlice = {
  activateTabAction: TActivateTabAction;
  closeTabAction: TCloseTabAction;
};

type TTabsBarProps = {
  registry: TTabsBarRegistrySlice;
};

const MIDDLE_BUTTON = 1;

const TabsBar: FC<TTabsBarProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const openNodes = store.derived.openNodes.value;
  const activeId = store.tabs.activeId.value;

  // The browser starts autoscroll on a middle press, so the press is swallowed
  // and the tab closes on the release.
  const handleMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (event.button === MIDDLE_BUTTON) {
      event.preventDefault();
    }
  };

  const handleAuxClick = (event: MouseEvent<HTMLElement>, nodeId: string) => {
    if (event.button !== MIDDLE_BUTTON) {
      return;
    }

    event.preventDefault();

    registry.closeTabAction(nodeId);
  };

  return (
    <nav className="tabs">
      {openNodes.length === 0 ? (
        <span className="tabs__empty">{"No open notes"}</span>
      ) : null}

      {openNodes.map((node) => (
        <span
          className={`tab${node.id === activeId ? " tab--active" : ""}`}
          key={node.id}
          onAuxClick={(event) => handleAuxClick(event, node.id)}
          onMouseDown={handleMouseDown}
        >
          <button
            className="tab__label"
            onClick={() => registry.activateTabAction(node.id)}
            title={node.id}
            type="button"
          >
            <NodeIcon kind={node.kind} />

            <span className="tab__name">{node.name}</span>
          </button>

          <button
            aria-label={`Close ${node.name}`}
            className="tab__close"
            onClick={() => registry.closeTabAction(node.id)}
            type="button"
          >
            {"×"}
          </button>
        </span>
      ))}
    </nav>
  );
};

export { TabsBar };
