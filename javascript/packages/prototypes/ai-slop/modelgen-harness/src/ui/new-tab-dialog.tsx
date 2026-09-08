import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef, useState } from "react";
import { harness } from "../state/bridge.js";
import { createTab, showNewTab } from "../state/store.js";

/**
 * A tab needs a `.blend` path. Type one, or pick it with the system chooser —
 * an existing file to keep working on, or a new name for a fresh model.
 */
function NewTabDialog(): React.JSX.Element {
  useSignals();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        showNewTab.value = false;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const submit = async (blendPath: string) => {
    if (blendPath.trim().length === 0 || busy) {
      return;
    }
    setBusy(true);
    const created = await createTab(blendPath);
    setBusy(false);
    if (!created) {
      inputRef.current?.focus();
    }
  };

  const pick = async (mode: "existing" | "fresh") => {
    const picked = await harness.tabs.pickPath(mode);
    if (picked) {
      setValue(picked);
      await submit(picked);
    }
  };

  return (
    <div
      className="modal"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          showNewTab.value = false;
        }
      }}
    >
      <form
        className="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(value);
        }}
      >
        <h2>New model</h2>
        <p className="dialog__hint">
          One tab is one <code>.blend</code>. Give the path of the file to create or continue.
        </p>
        <label className="field">
          <span>Path to the .blend</span>
          <input
            ref={inputRef}
            type="text"
            value={value}
            placeholder="~/Models/lamp.blend"
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
              void pick("fresh");
            }}
          >
            Choose a new file…
          </button>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => {
              void pick("existing");
            }}
          >
            Open an existing file…
          </button>
        </div>
        <div className="dialog__actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              showNewTab.value = false;
            }}
          >
            Cancel
          </button>
          <button type="submit" className="button button--primary" disabled={busy || value.trim().length === 0}>
            {busy ? "Opening…" : "Open tab"}
          </button>
        </div>
      </form>
    </div>
  );
}

export { NewTabDialog };
