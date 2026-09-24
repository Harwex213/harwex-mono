import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef, useState } from "react";
import { harness } from "../state/bridge.js";
import { assets, createTab, showNewTab } from "../state/store.js";

/**
 * A tab needs a model. A name is a model of the project, which the convention
 * keeps at `Assets/blender/<Name>.blend`: an existing one opens, a new one is
 * created. A path, typed or picked, opens a `.blend` wherever it is.
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

  const pick = async () => {
    const picked = await harness.tabs.pickPath();
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
          One tab is one <code>.blend</code>. A name goes to{" "}
          <code>{assets.value ? `${assets.value.assetsPath}/blender/` : "Assets/blender/"}</code> — name it in
          CamelCase, the way the project's models are named. A path opens that file instead.
        </p>
        <label className="field">
          <span>Model name or path</span>
          <input
            ref={inputRef}
            type="text"
            value={value}
            placeholder="BonusWheel"
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
              void pick();
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
