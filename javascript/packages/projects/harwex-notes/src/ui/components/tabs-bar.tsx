import { useSignals } from "@preact/signals-react/runtime";
import { NodeIcon } from "./fs-icons";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TActivateTabAction, TCloseTabAction } from "../../domain/registry";

type TTabsBarRegistrySlice = {
  activateTabAction: TActivateTabAction;
  closeTabAction: TCloseTabAction;
};

type TTabsBarProps = {
  registry: TTabsBarRegistrySlice;
};

const TabsBar: FC<TTabsBarProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const openNodes = store.derived.openNodes.value;
  const activeId = store.tabs.activeId.value;

  return (
    <nav className="tabs">
      {openNodes.length === 0 ? (
        <span className="tabs__empty">{"No open notes"}</span>
      ) : null}

      {openNodes.map((node) => (
        <span
          className={`tab${node.id === activeId ? " tab--active" : ""}`}
          key={node.id}
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
