import { signal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { ExcalidrawViewer } from "./excalidraw-viewer";
import type { TExcalidrawDocument, TExcalidrawScene } from "@hw/harwex-notes-protocol";
import type { TExcalidrawViewerRegistrySlice } from "./excalidraw-viewer.types";
import type { TDemo } from "../../../dev/demo";

// Every element Excalidraw does not find is filled in by its own restore step, so a fixture
// only has to carry what makes the shape. The fixtures hold no text: Excalidraw measures a
// text element against the fonts it registers when it mounts, and a scene written by hand
// before that mount bakes widths that clip the last glyph.
const baseElement = (seed: number) => {
  return {
    angle: 0,
    backgroundColor: "transparent",
    boundElements: null,
    fillStyle: "solid",
    frameId: null,
    groupIds: [],
    isDeleted: false,
    link: null,
    locked: false,
    opacity: 100,
    roughness: 1,
    roundness: null,
    seed,
    strokeColor: "#1e1e1e",
    strokeStyle: "solid",
    strokeWidth: 2,
    updated: 1,
    version: 1,
    versionNonce: seed,
  };
};

const FLOW_SCENE: TExcalidrawScene = {
  elements: [
    {
      ...baseElement(101),
      backgroundColor: "#ffec99",
      height: 90,
      id: "flow-box",
      roundness: { type: 3 },
      type: "rectangle",
      width: 200,
      x: 60,
      y: 80,
    },
    {
      ...baseElement(102),
      endArrowhead: "arrow",
      height: 0,
      id: "flow-arrow",
      lastCommittedPoint: null,
      points: [
        [0, 0],
        [120, 0],
      ],
      startArrowhead: null,
      type: "arrow",
      width: 120,
      x: 270,
      y: 125,
    },
    {
      ...baseElement(103),
      backgroundColor: "#b2f2bb",
      height: 120,
      id: "flow-disk",
      type: "ellipse",
      width: 160,
      x: 400,
      y: 65,
    },
  ],
  files: {},
};

const SECOND_SCENE: TExcalidrawScene = {
  elements: [
    {
      ...baseElement(201),
      backgroundColor: "#a5d8ff",
      height: 140,
      id: "second-diamond",
      type: "diamond",
      width: 220,
      x: 80,
      y: 60,
    },
  ],
  files: {},
};

// What the host would have on disk after the last save.
const DISK_SCENE: TExcalidrawScene = {
  elements: [
    {
      ...baseElement(301),
      backgroundColor: "#ffc9c9",
      height: 100,
      id: "disk-box",
      roundness: { type: 3 },
      type: "rectangle",
      width: 320,
      x: 60,
      y: 70,
    },
    {
      ...baseElement(302),
      height: 0,
      id: "disk-rule",
      lastCommittedPoint: null,
      points: [
        [0, 0],
        [320, 0],
      ],
      type: "line",
      width: 320,
      x: 60,
      y: 200,
    },
  ],
  files: {},
};

const documentSignal = signal<TExcalidrawDocument>({
  kind: "excalidraw",
  nodeId: "flow.excalidraw",
  scene: FLOW_SCENE,
});
const edits = signal(0);
const readOnly = signal(false);
const theme = signal<"light" | "dark">("light");

// A stand-in for the host store: the action the app registers writes the scene back into
// the document the viewer is given, which is what the viewer has to tell from a real edit.
const registry: TExcalidrawViewerRegistrySlice = {
  excalidrawDocumentChangedAction: (nodeId, scene) => {
    if (documentSignal.peek().nodeId !== nodeId) {
      return;
    }

    edits.value++;
    documentSignal.value = { ...documentSignal.peek(), scene };
  },
};

const openDrawing = (nodeId: string, scene: TExcalidrawScene) => {
  edits.value = 0;
  documentSignal.value = { kind: "excalidraw", nodeId, scene };
};

// Stands in for the file changing underneath the viewer, with the tab left open.
const changeOnDisk = () => {
  documentSignal.value = { ...documentSignal.peek(), scene: DISK_SCENE };
};

const Demo = () => {
  useSignals();

  const document = documentSignal.value;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={() => openDrawing("flow.excalidraw", FLOW_SCENE)} type="button">
          {"Open flow.excalidraw"}
        </button>

        <button onClick={() => openDrawing("second.excalidraw", SECOND_SCENE)} type="button">
          {"Open second.excalidraw"}
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

        <span>{`${document.nodeId} \u00b7 ${document.scene.elements.length} elements \u00b7 ${edits.value} edits reported`}</span>
      </div>

      <div style={{ height: "70vh" }}>
        <ExcalidrawViewer
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
  title: "Excalidraw viewer",
  component: Demo,
};

export default demo;
