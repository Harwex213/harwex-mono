import { useSignals } from "@preact/signals-react/runtime";
import { useEffect } from "react";
import {
  activeTab,
  init,
  notice,
  setNotice,
  showNewTab,
  showSettings,
} from "../state/store.js";
import { NewTabDialog } from "./new-tab-dialog.js";
import { SettingsDialog } from "./settings-dialog.js";
import { TabBar } from "./tab-bar.js";
import { Workspace } from "./workspace.js";

function App(): React.JSX.Element {
  useSignals();

  useEffect(() => {
    void init();
  }, []);

  useEffect(() => {
    if (notice.value.length === 0) {
      return;
    }
    const timer = setTimeout(() => {
      setNotice("");
    }, 4000);
    return () => {
      clearTimeout(timer);
    };
  }, [notice.value]);

  const current = activeTab.value;
  return (
    <div className="app">
      <TabBar />
      {current ? <Workspace key={current.tab.id} state={current} /> : <Welcome />}
      {showNewTab.value ? <NewTabDialog /> : null}
      {showSettings.value ? <SettingsDialog /> : null}
      {notice.value.length > 0 ? <div className="notice">{notice.value}</div> : null}
    </div>
  );
}

function Welcome(): React.JSX.Element {
  useSignals();
  return (
    <div className="welcome">
      <h1>modelgen harness</h1>
      <p>
        Every tab is one model: one <code>.blend</code> file on disk, one headless Blender behind it,
        one agent building it from what you describe.
      </p>
      <button
        type="button"
        className="button button--primary"
        onClick={() => {
          showNewTab.value = true;
        }}
      >
        New model…
      </button>
    </div>
  );
}

export { App };
