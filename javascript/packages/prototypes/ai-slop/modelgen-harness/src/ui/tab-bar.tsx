import { useSignals } from "@preact/signals-react/runtime";
import type { TabState } from "../../shared/types.js";
import {
  activeTabId,
  closeTab,
  selectTab,
  showNewTab,
  showSettings,
  tabs,
} from "../state/store.js";

function statusTitle(state: TabState): string {
  if (state.running) {
    return "The agent is working";
  }
  if (state.blender === "ready") {
    return state.dirty ? "Unsaved changes" : "Saved";
  }
  return `Blender ${state.blender}: ${state.blenderMessage}`;
}

function TabBar(): React.JSX.Element {
  useSignals();
  return (
    <header className="tab-bar">
      <div className="tab-bar__tabs">
        {tabs.value.map((state) => {
          const active = state.tab.id === activeTabId.value;
          return (
            <div
              key={state.tab.id}
              className={active ? "tab tab--active" : "tab"}
              onClick={() => {
                void selectTab(state.tab.id);
              }}
              title={state.tab.blendPath}
            >
              <span
                className={`tab__dot tab__dot--${state.running ? "running" : state.blender}`}
                title={statusTitle(state)}
              />
              <span className="tab__name">
                {state.tab.name}
                {state.dirty ? <span className="tab__dirty" title="Unsaved changes">•</span> : null}
              </span>
              <button
                type="button"
                className="tab__close"
                title="Close this model (it has to be saved first)"
                onClick={(event) => {
                  event.stopPropagation();
                  void closeTab(state.tab.id);
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
          title="Open or create a model"
          onClick={() => {
            showNewTab.value = true;
          }}
        >
          +
        </button>
      </div>
      <button
        type="button"
        className="tab-bar__settings"
        title="Settings: API key, models, Blender"
        onClick={() => {
          showSettings.value = true;
        }}
      >
        ⚙
      </button>
    </header>
  );
}

export { TabBar };
