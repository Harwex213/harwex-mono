import { signal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { TextViewer } from "./text-viewer";
import type { TTextDocument } from "@hw/harwex-notes-protocol";
import type { TTextViewerRegistrySlice } from "./text-viewer.types";
import type { TDemo } from "../../../dev/demo";

// Markup stays text, and the long line does not wrap (TXT-1, TXT-2).
const TODO_TEXT = [
  "# not a heading, just a line that starts with a hash",
  "- **not bold** and <b>not a tag</b>",
  "",
  "A very long line that keeps going far past the right edge of the pane, so the editor has to scroll sideways instead of wrapping it onto the next line.",
  "\tA tab-indented line.",
  "",
].join("\n");

const DISK_TEXT = "Changed on disk while the tab was open.\n";

const documentSignal = signal<TTextDocument>({ kind: "text", nodeId: "todo.txt", text: TODO_TEXT });
const edits = signal(0);
const readOnly = signal(false);
const theme = signal<"light" | "dark">("light");

// A stand-in for the host store: the action writes the text back into the document.
const registry: TTextViewerRegistrySlice = {
  textDocumentChangedAction: (nodeId, text) => {
    if (documentSignal.peek().nodeId !== nodeId) {
      return;
    }

    edits.value++;
    documentSignal.value = { ...documentSignal.peek(), text };
  },
};

const changeOnDisk = () => {
  documentSignal.value = { ...documentSignal.peek(), text: DISK_TEXT };
};

const Demo = () => {
  useSignals();

  const document = documentSignal.value;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={changeOnDisk} type="button">
          {"Change the file on disk"}
        </button>

        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            checked={readOnly.value}
            onChange={(event) => {
              readOnly.value = event.target.checked;
            }}
            type="checkbox"
          />
          {"Read only"}
        </label>

        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {"Theme"}
          <select
            onChange={(event) => {
              theme.value = event.target.value as typeof theme.value;
            }}
            value={theme.value}
          >
            <option value="light">{"light"}</option>
            <option value="dark">{"dark"}</option>
          </select>
        </label>

        <span>{`${document.nodeId} · ${document.text.length} chars · ${edits.value} edits reported`}</span>
      </div>

      <div style={{ height: "70vh", border: "1px solid var(--color-border)" }}>
        <TextViewer
          document={document}
          readOnly={readOnly.value}
          registry={registry}
          theme={theme.value}
        />
      </div>
    </div>
  );
};

const demo: TDemo = {
  title: "Text viewer",
  component: Demo,
};

export default demo;
