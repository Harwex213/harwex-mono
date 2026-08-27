import { signal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { MarkdownViewer } from "./markdown-viewer";
import type { TMarkdownDocument } from "@hw/harwex-notes-protocol";
import type {
  TMarkdownViewerLayout,
  TMarkdownViewerRegistrySlice,
} from "./markdown-viewer.types";
import type { TDemo } from "../../../dev/demo";

const NOTES_TEXT = `# Weekly notes

Some **bold**, some _italic_, some ~~struck~~ text and \`inline code\`.

## Tasks

- [x] Write the spec
- [ ] Implement the viewer
- [ ] Ship it

## Table

| Kind | Editable |
| --- | --- |
| Markdown | yes |
| HTML | no |

\`\`\`ts
const answer: number = 42;
\`\`\`

> A quote about nothing in particular.

An [external link](https://example.com), a [vault link](./other.md) and an image:

![Diagram](./diagram.png)

<script>alert("never runs")</script>
`;

const SECOND_TEXT = `# Second file

Just a paragraph, to show the editor swapping documents.
`;

const DISK_TEXT = `# Weekly notes

Changed on disk while the tab was open.
`;

const documentSignal = signal<TMarkdownDocument>({
  kind: "markdown",
  nodeId: "notes.md",
  text: NOTES_TEXT,
});
const edits = signal(0);
const readOnly = signal(false);
const layout = signal<TMarkdownViewerLayout>("split");
const theme = signal<"light" | "dark">("light");
const lastLink = signal("");

// A stand-in for the host store: the action writes the text back into the document the
// viewer is given, which is what the viewer has to tell from a real edit.
const registry: TMarkdownViewerRegistrySlice = {
  markdownDocumentChangedAction: (nodeId, text) => {
    if (documentSignal.peek().nodeId !== nodeId) {
      return;
    }

    edits.value++;
    documentSignal.value = { ...documentSignal.peek(), text };
  },
};

const openFile = (nodeId: string, text: string) => {
  edits.value = 0;
  documentSignal.value = { kind: "markdown", nodeId, text };
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
        <button onClick={() => openFile("notes.md", NOTES_TEXT)} type="button">
          {"Open notes.md"}
        </button>

        <button onClick={() => openFile("second.md", SECOND_TEXT)} type="button">
          {"Open second.md"}
        </button>

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
          {"Layout"}
          <select
            onChange={(event) => {
              layout.value = event.target.value as TMarkdownViewerLayout;
            }}
            value={layout.value}
          >
            <option value="split">{"split"}</option>
            <option value="source">{"source"}</option>
            <option value="rendered">{"rendered"}</option>
          </select>
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

        {lastLink.value === "" ? null : <span>{`last link: ${lastLink.value}`}</span>}
      </div>

      <div style={{ height: "70vh", border: "1px solid var(--color-border)" }}>
        <MarkdownViewer
          document={document}
          layout={layout.value}
          onLinkClick={(href, event) => {
            lastLink.value = href;

            if (!/^https?:\/\//i.test(href)) {
              event.preventDefault();
            }
          }}
          readOnly={readOnly.value}
          registry={registry}
          resolveImageUrl={(src) => `/vault/${src.replace(/^\.\//, "")}`}
          theme={theme.value}
        />
      </div>
    </div>
  );
};

const demo: TDemo = {
  title: "Markdown viewer",
  component: Demo,
};

export default demo;
