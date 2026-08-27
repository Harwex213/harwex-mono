import { signal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { ConflictModal } from "./conflict-modal";
import type { CSSProperties } from "react";
import type { TConflict, TConflictModalRegistrySlice } from "./conflict-modal.types";
import type { TDemo } from "../../../dev/demo";

const PLAN: TConflict = { id: "projects/harwex-notes/plan", name: "plan.md", kind: "markdown" };
const JOURNAL: TConflict = { id: "journal/08-26", name: "2026-08-26.md", kind: "markdown" };
const ARCH: TConflict = {
  id: "projects/harwex-notes/arch",
  name: "architecture.excalidraw",
  kind: "excalidraw",
};
const LONG_NAME: TConflict = {
  id: "projects/ostrov/todo",
  name: "a-rather-long-file-name-that-has-to-wrap-inside-the-title.md",
  kind: "markdown",
};

const FILES: readonly TConflict[] = [PLAN, JOURNAL, ARCH, LONG_NAME];

// The host's dark palette, scoped to the demo frame so the playground itself stays light.
const DARK_TOKENS: CSSProperties = {
  "--color-canvas": "#17181a",
  "--color-surface": "#1e2023",
  "--color-surface-sunken": "#24272b",
  "--color-border": "#32353a",
  "--color-border-strong": "#4a4e55",
  "--color-text": "#e6e5e1",
  "--color-text-muted": "#9fa0a2",
  "--color-text-faint": "#74767a",
  "--color-accent": "#7fb0e8",
  "--color-accent-subtle": "#24303d",
  "--color-danger": "#e08b80",
} as CSSProperties;

// A stand-in for the host store. The host keeps the conflicts in a queue (CONF-5); the
// modal receives the head of the queue and how many wait behind it.
const queue = signal<readonly TConflict[]>([PLAN, ARCH]);
const theme = signal<"light" | "dark">("light");
const scratch = signal("Type here while the modal is open: the rest of the app keeps working.");
const log = signal<readonly string[]>([]);

const report = (line: string) => {
  log.value = [line, ...log.peek()].slice(0, 8);
};

const raiseConflict = (file: TConflict) => {
  if (queue.peek().some((conflict) => conflict.id === file.id)) {
    report(`${file.name} is already in the queue`);

    return;
  }

  queue.value = [...queue.peek(), file];
  report(`conflict raised: ${file.name}`);
};

const dropConflict = (nodeId: string) => {
  queue.value = queue.peek().filter((conflict) => conflict.id !== nodeId);
};

// Either choice clears the conflict and the next one in the queue takes its place (CONF-7).
const registry: TConflictModalRegistrySlice = {
  overwriteConflictAction: (nodeId) => {
    report(`overwrite ${nodeId}`);
    dropConflict(nodeId);
  },
  discardConflictAction: (nodeId) => {
    report(`discard ${nodeId}`);
    dropConflict(nodeId);
  },
};

const reset = () => {
  queue.value = [PLAN, ARCH];
  log.value = [];
};

const Demo = () => {
  useSignals();

  const head = queue.value[0] ?? null;
  const waitingCount = Math.max(0, queue.value.length - 1);

  const frameStyle: CSSProperties = {
    ...(theme.value === "dark" ? DARK_TOKENS : {}),
    position: "relative",
    display: "flex",
    flexDirection: "column",
    minHeight: 420,
    // Pulls the panel up into the short demo frame; the host keeps the default offset.
    ...({ "--conflict-top": "24px" } as CSSProperties),
    background: "var(--color-canvas, #f6f6f4)",
    color: "var(--color-text, #1d1c1a)",
    border: "1px solid var(--color-border, #d9d7d1)",
    borderRadius: 8,
    overflow: "hidden",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
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

        <button onClick={reset} type="button">
          {"Reset"}
        </button>

        <span>{"Escape and clicks outside do nothing · a choice ends the modal · the queue advances"}</span>
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ opacity: 0.7 }}>{"Raise a conflict on:"}</span>
        {FILES.map((file) => (
          <button key={file.id} onClick={() => raiseConflict(file)} type="button">
            {file.name}
          </button>
        ))}
      </div>

      <div style={frameStyle}>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
          <span style={{ opacity: 0.6 }}>{"Another open file (CONF-9: still editable):"}</span>
          <textarea
            onChange={(event) => {
              scratch.value = event.target.value;
            }}
            rows={6}
            style={{ font: "inherit", padding: 8 }}
            value={scratch.value}
          />
        </div>

        {/* The modal positions itself against the viewport. The demo confines it to the frame
            by giving the wrapper a containing block via transform on the frame's child. */}
        <div style={{ position: "absolute", inset: 0, transform: "translateZ(0)", pointerEvents: "none" }}>
          <ConflictModal conflict={head} registry={registry} waitingCount={waitingCount} />
        </div>
      </div>

      <pre style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>
        {[
          `queue: ${queue.value.map((conflict) => conflict.name).join(", ") || "—"}`,
          `waiting behind the head: ${waitingCount}`,
          "",
          ...log.value,
        ].join("\n")}
      </pre>
    </div>
  );
};

const demo: TDemo = {
  title: "Conflict modal",
  component: Demo,
};

export default demo;
