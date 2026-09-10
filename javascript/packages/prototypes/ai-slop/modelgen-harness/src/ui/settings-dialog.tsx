import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useState } from "react";
import type { Settings } from "../../shared/types.js";
import { saveSettings, settings, showSettings } from "../state/store.js";

const FIELDS: { key: keyof Settings; label: string; hint: string }[] = [
  {
    key: "claudeCodePath",
    label: "claude code executable",
    hint: "Found on this machine by default. Empty uses the claude bundled with the Claude Agent SDK. Sign in once with `claude`.",
  },
  {
    key: "codexPath",
    label: "codex executable",
    hint: "Empty uses the codex bundled with the Codex SDK. Sign in once with `codex login`.",
  },
  {
    key: "blenderPath",
    label: "Blender executable",
    hint: "Blender 5.1 with the Blender MCP extension installed and enabled.",
  },
];

function SettingsDialog(): React.JSX.Element {
  useSignals();
  const [draft, setDraft] = useState<Settings | null>(settings.value);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        showSettings.value = false;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!draft) {
    return <div className="modal" />;
  }

  return (
    <div
      className="modal"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          showSettings.value = false;
        }
      }}
    >
      <form
        className="dialog dialog--wide"
        onSubmit={(event) => {
          event.preventDefault();
          void saveSettings(draft);
        }}
      >
        <h2>Settings</h2>
        {FIELDS.map((field) => {
          return (
            <label key={field.key} className="field">
              <span>{field.label}</span>
              <input
                type="text"
                value={draft[field.key]}
                spellCheck={false}
                onChange={(event) => {
                  setDraft({ ...draft, [field.key]: event.target.value });
                }}
              />
              <small>{field.hint}</small>
            </label>
          );
        })}
        <div className="dialog__actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              showSettings.value = false;
            }}
          >
            Cancel
          </button>
          <button type="submit" className="button button--primary">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

export { SettingsDialog };
