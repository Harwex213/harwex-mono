type ExcalidrawElement = Record<string, unknown> & {
  type: string;
  id: string;
  isDeleted?: boolean;
};

type ExcalidrawScene = {
  elements: ExcalidrawElement[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
};

/*
 * Accepts every shape an `.excalidraw` payload comes in: the file format
 * (`type: "excalidraw"`), a clipboard payload (`type: "excalidraw/clipboard"`),
 * a `{ data: { ... } }` wrapper written by some integrations, or a bare element
 * array. Missing `appState` and `files` are normal — the clipboard format omits
 * both.
 */
function parseScene(source: string | Buffer | object): ExcalidrawScene {
  let raw: unknown = source;
  if (typeof raw === "string" || Buffer.isBuffer(raw)) {
    raw = JSON.parse(raw.toString());
  }
  if (Array.isArray(raw)) {
    raw = { elements: raw };
  }
  if (raw === null || typeof raw !== "object") {
    throw new Error("Excalidraw scene must be a JSON object or an array of elements");
  }

  const record = raw as Record<string, unknown>;
  const inner = record.data;
  const holder = !Array.isArray(record.elements) && inner !== null && typeof inner === "object"
    ? inner as Record<string, unknown>
    : record;

  const elements = holder.elements;
  if (!Array.isArray(elements)) {
    throw new Error("Excalidraw scene has no `elements` array");
  }

  const live = (elements as ExcalidrawElement[]).filter((element) => {
    return !element.isDeleted;
  });
  if (live.length === 0) {
    throw new Error("Excalidraw scene has no visible elements");
  }

  const appState = holder.appState !== null && typeof holder.appState === "object"
    ? holder.appState as Record<string, unknown>
    : {};
  const files = holder.files !== null && typeof holder.files === "object"
    ? holder.files as Record<string, unknown>
    : {};

  return { elements: live, appState, files };
}

export { parseScene };
export type { ExcalidrawElement, ExcalidrawScene };
