import { useSignals } from "@preact/signals-react/runtime";
import type { TabState } from "../../shared/types.js";
import { harness } from "../state/bridge.js";
import { restartBlender, saveTab } from "../state/store.js";
import { Chat } from "./chat.js";
import { Composer } from "./composer.js";
import { Viewer } from "./viewer/viewer.js";

/**
 * One tab's room: the model on the left, the conversation on the right, as
 * the wireframe draws it. The header carries what the file needs — its path,
 * the state of its Blender, and Save.
 */
function Workspace({ state }: { state: TabState }): React.JSX.Element {
  useSignals();
  const tabId = state.tab.id;
  return (
    <section className="workspace">
      <header className="workspace__header">
        <button
          type="button"
          className="workspace__path"
          title="Show the file in Finder"
          onClick={() => {
            void harness.tabs.reveal(tabId);
          }}
        >
          {state.tab.blendPath}
        </button>
        <span className={`blender blender--${state.blender}`} title={state.blenderMessage}>
          Blender {state.blender}
        </span>
        {state.blender === "failed" || state.blender === "stopped" ? (
          <button
            type="button"
            className="button button--small"
            onClick={() => {
              void restartBlender(tabId);
            }}
          >
            Restart Blender
          </button>
        ) : null}
        <span className="workspace__spacer" />
        <span className={state.dirty ? "saved saved--dirty" : "saved"}>{state.dirty ? "Unsaved changes" : "Saved"}</span>
        <button
          type="button"
          className="button button--small button--primary"
          disabled={state.blender !== "ready" || state.running || !state.dirty}
          title="Write the .blend to disk"
          onClick={() => {
            void saveTab(tabId);
          }}
        >
          Save
        </button>
      </header>
      <div className="workspace__body">
        <Viewer tabId={tabId} stamp={state.modelStamp} />
        <aside className="chat">
          <Chat tabId={tabId} />
          <Composer state={state} />
        </aside>
      </div>
    </section>
  );
}

export { Workspace };
