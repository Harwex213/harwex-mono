import { useSignals } from "@preact/signals-react/runtime";
import { dirtySignal, docsByPath, saveDoc } from "../state/doc-store.ts";
import { activateTab, activePath, closeTab, openPaths } from "../state/tabs-store.ts";
import {
  htmlSourceOn,
  markdownPreviewOn,
  toggleHtmlSource,
  toggleMarkdownPreview,
} from "../state/view-store.ts";

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

function Tab({ path }: { path: string }) {
  useSignals();
  const isActive = activePath.value === path;
  const isDirty = dirtySignal(path).value;
  const classNames = ["tab"];
  if (isActive) {
    classNames.push("active");
  }

  return (
    <div
      className={classNames.join(" ")}
      role="tab"
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      title={path}
      onClick={() => {
        activateTab(path);
      }}
      onAuxClick={(event) => {
        // Middle click closes, as in every editor with tabs.
        if (event.button === 1) {
          event.preventDefault();
          closeTab(path);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activateTab(path);
        }
      }}
    >
      <span className="tab-name">{basename(path)}</span>
      <span className={isDirty ? "tab-dot visible" : "tab-dot"} aria-hidden={!isDirty} />
      <button
        type="button"
        className="tab-close"
        aria-label={`Close ${basename(path)}`}
        onClick={(event) => {
          event.stopPropagation();
          closeTab(path);
        }}
      >
        &times;
      </button>
    </div>
  );
}

function Toolbar() {
  useSignals();
  const path = activePath.value;
  if (path === null) {
    return null;
  }
  const doc = docsByPath.value[path];
  if (doc === undefined || doc.status !== "ready") {
    return null;
  }

  return (
    <div className="tab-tools">
      {doc.fileKind === "markdown" ? (
        <button
          type="button"
          className={markdownPreviewOn(path) ? "tool active" : "tool"}
          aria-pressed={markdownPreviewOn(path)}
          onClick={() => {
            toggleMarkdownPreview(path);
          }}
        >
          preview
        </button>
      ) : null}
      {doc.fileKind === "html" ? (
        <button
          type="button"
          className={htmlSourceOn(path) ? "tool active" : "tool"}
          aria-pressed={htmlSourceOn(path)}
          onClick={() => {
            toggleHtmlSource(path);
          }}
        >
          source
        </button>
      ) : null}
      {doc.fileKind === "excalidraw" ? (
        <span className="tool-note">autosaves</span>
      ) : (
        <button
          type="button"
          className="tool"
          disabled={doc.saving}
          onClick={() => {
            void saveDoc(path);
          }}
        >
          {doc.saving ? "saving..." : "save"}
        </button>
      )}
    </div>
  );
}

function TabBar() {
  useSignals();
  const paths = openPaths.value;

  return (
    <div className="tab-bar">
      <div className="tab-strip" role="tablist" aria-label="Open files">
        {paths.length === 0 ? <span className="tab-hint">no open files</span> : null}
        {paths.map((path) => {
          return <Tab key={path} path={path} />;
        })}
      </div>
      <Toolbar />
    </div>
  );
}

export { TabBar };
