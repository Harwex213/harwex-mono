import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef, useState } from "react";
import {
  loadRecentProjects,
  openProject,
  pickProject,
  project,
  recentProjects,
  showProjects,
} from "../state/store.js";

/**
 * Where a project is chosen: a folder path typed in, the system folder
 * chooser, or one of the projects opened before. The same form is the first
 * screen of the app and the dialog behind the project button of the tab bar.
 */
function ProjectForm({ onCancel }: { onCancel?: () => void }): React.JSX.Element {
  useSignals();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    void loadRecentProjects();
  }, []);

  const submit = async (folder: string) => {
    if (folder.trim().length === 0 || busy) {
      return;
    }
    setBusy(true);
    await openProject(folder);
    setBusy(false);
  };

  const recent = recentProjects.value.filter((entry) => entry.path !== project.value?.path);
  return (
    <form
      className="dialog dialog--wide"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(value);
      }}
    >
      <h2>Open a project</h2>
      <p className="dialog__hint">
        A project is a folder with an <code>Assets/</code> directory: <code>blender/</code> for the models,{" "}
        <code>textures/&lt;Model&gt;/</code>, <code>material/</code>, <code>export/</code> and{" "}
        <code>references/</code>. The agent runs in that folder and follows its <code>CLAUDE.md</code>.
      </p>
      <label className="field">
        <span>Project folder</span>
        <input
          ref={inputRef}
          type="text"
          value={value}
          placeholder="~/Projects/my-game/GameProject"
          spellCheck={false}
          onChange={(event) => {
            setValue(event.target.value);
          }}
        />
      </label>
      <div className="dialog__row">
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => {
            void pickProject();
          }}
        >
          Choose a folder…
        </button>
      </div>
      {recent.length > 0 ? (
        <div className="recent">
          <span className="recent__title">Recent</span>
          {recent.map((entry) => {
            return (
              <button
                key={entry.path}
                type="button"
                className="recent__item"
                disabled={busy}
                title={entry.path}
                onClick={() => {
                  void submit(entry.path);
                }}
              >
                <span className="recent__name">{entry.name}</span>
                <span className="recent__path">{entry.path}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="dialog__actions">
        {onCancel ? (
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        <button type="submit" className="button button--primary" disabled={busy || value.trim().length === 0}>
          {busy ? "Opening…" : "Open project"}
        </button>
      </div>
    </form>
  );
}

/** The first screen, before any project is open. */
function ProjectWelcome(): React.JSX.Element {
  return (
    <div className="welcome">
      <h1>assets harness</h1>
      <ProjectForm />
    </div>
  );
}

/** The same form over the window, to switch to another project. */
function ProjectDialog(): React.JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        showProjects.value = false;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const close = () => {
    showProjects.value = false;
  };
  return (
    <div
      className="modal"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          close();
        }
      }}
    >
      <ProjectForm onCancel={close} />
    </div>
  );
}

export { ProjectDialog, ProjectWelcome };
