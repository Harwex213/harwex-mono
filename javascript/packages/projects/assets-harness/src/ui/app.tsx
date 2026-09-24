import { useSignals } from "@preact/signals-react/runtime";
import { useEffect } from "react";
import {
  activeTab,
  init,
  notice,
  project,
  setNotice,
  showAssets,
  showNewTab,
  showProjects,
  showSettings,
} from "../state/store.js";
import { AssetsPanel } from "./assets-panel.js";
import { NewTabDialog } from "./new-tab-dialog.js";
import { ProjectDialog, ProjectWelcome } from "./project-picker.js";
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
      {project.value ? (
        <div className="app__body">
          {showAssets.value ? <AssetsPanel /> : null}
          {current ? <Workspace key={current.tab.id} state={current} /> : <Welcome />}
        </div>
      ) : (
        <ProjectWelcome />
      )}
      {showNewTab.value ? <NewTabDialog /> : null}
      {showProjects.value ? <ProjectDialog /> : null}
      {showSettings.value ? <SettingsDialog /> : null}
      {notice.value.length > 0 ? <div className="notice">{notice.value}</div> : null}
    </div>
  );
}

/** A project is open, no model is. */
function Welcome(): React.JSX.Element {
  useSignals();
  return (
    <div className="welcome">
      <h1>{project.value?.name}</h1>
      <p>
        Every tab is one model of the project: one <code>Assets/blender/&lt;Model&gt;.blend</code>, one
        headless Blender behind it, one agent working on it in the project folder, by the project's
        conventions. Pick a model on the left, or make a new one.
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
