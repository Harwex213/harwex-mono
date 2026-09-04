import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef, useState } from "react";
import { harness } from "../state/bridge.js";
import {
  activeTab,
  activeTabId,
  closeTab,
  createTab,
  refreshRecents,
  selectTab,
  tabs,
} from "../state/graph-state.js";
import { RecentsList } from "./recents-list.js";

function TabBar(): React.JSX.Element {
  useSignals();
  const current = activeTab.value;
  const [showRecents, setShowRecents] = useState(false);
  const recentsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showRecents) {
      return;
    }
    const onPress = (event: PointerEvent) => {
      if (!recentsRef.current?.contains(event.target as Node)) {
        setShowRecents(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowRecents(false);
      }
    };
    document.addEventListener("pointerdown", onPress);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPress);
      document.removeEventListener("keydown", onKey);
    };
  }, [showRecents]);

  return (
    <header className="tab-bar">
      <div className="tab-bar__tabs">
        {tabs.value.map((tab) => {
          const active = tab.id === activeTabId.value;
          return (
            <div
              key={tab.id}
              className={active ? "tab tab--active" : "tab"}
              onClick={() => {
                void selectTab(tab.id);
              }}
              title={tab.dir}
            >
              <span className="tab__name">{tab.name}</span>
              <button
                type="button"
                className="tab__close"
                title="Close this canvas"
                onClick={(event) => {
                  event.stopPropagation();
                  void closeTab(tab.id);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="tab-bar__add"
          title="Open a working directory as a new canvas"
          onClick={() => {
            void createTab();
          }}
        >
          +
        </button>
        <div className="tab-bar__recents" ref={recentsRef}>
          <button
            type="button"
            className={showRecents ? "tab-bar__add tab-bar__add--on" : "tab-bar__add"}
            title="Open a directory this app has worked in before"
            onClick={() => {
              if (!showRecents) {
                void refreshRecents();
              }
              setShowRecents(!showRecents);
            }}
          >
            ⟲
          </button>
          {showRecents ? (
            <div className="drop">
              <p className="drop__title">Previous working directories</p>
              <RecentsList
                empty="None yet. The + button picks the first one."
                onPick={() => {
                  setShowRecents(false);
                }}
              />
            </div>
          ) : null}
        </div>
      </div>
      {current ? (
        <button
          type="button"
          className="tab-bar__dir"
          title="Show the working directory"
          onClick={() => {
            void harness.tabs.reveal(current.dir);
          }}
        >
          {current.dir}
        </button>
      ) : null}
    </header>
  );
}

export { TabBar };
