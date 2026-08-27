import "@excalidraw/excalidraw/index.css";
import "./excalidraw-viewer.css";
import {
  CaptureUpdateAction,
  Excalidraw,
  getNonDeletedElements,
  getSceneVersion,
  THEME,
} from "@excalidraw/excalidraw";
import { useEffect, useRef } from "react";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { FC } from "react";
import type { TExcalidrawScene } from "@hw/harwex-notes-protocol";
import type { TExcalidrawViewerProps } from "./excalidraw-viewer.types";

// A cheap fingerprint of a scene. `getSceneVersion` sums the element versions, which change
// on every edit and on nothing else; the file count catches an image whose data arrives
// after the element that holds it.
type TSceneStamp = {
  version: number;
  fileCount: number;
};

// The protocol carries the scene as opaque records. These two are the only place that hands
// them back to Excalidraw under its own types.
const asElements = (scene: TExcalidrawScene): readonly ExcalidrawElement[] => {
  return scene.elements as readonly ExcalidrawElement[];
};

const asFiles = (scene: TExcalidrawScene): BinaryFiles => {
  return scene.files as BinaryFiles;
};

const stampOf = (elements: readonly ExcalidrawElement[], files: BinaryFiles): TSceneStamp => {
  return { version: getSceneVersion(elements), fileCount: Object.keys(files).length };
};

const isSameStamp = (left: TSceneStamp, right: TSceneStamp): boolean => {
  return left.version === right.version && left.fileCount === right.fileCount;
};

const ExcalidrawViewer: FC<TExcalidrawViewerProps> = ({
  document,
  registry,
  theme,
  readOnly = false,
}) => {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const nodeIdRef = useRef(document.nodeId);
  // Excalidraw reports a scene back as soon as it takes it, with its own repairs applied:
  // once when it loads, and once for every scene the viewer pushes into it. Neither is an
  // edit, so the report that follows a hand-over is skipped rather than compared.
  const isHandOverPendingRef = useRef(true);
  // What the editor last reported, and what the host and the viewer last agreed on. They
  // differ because the emitted scene drops the elements the user deleted, so each direction
  // needs its own fingerprint to tell a real change from its own echo.
  const editorStampRef = useRef(stampOf(asElements(document.scene), asFiles(document.scene)));
  const documentStampRef = useRef(editorStampRef.current);

  useEffect(() => {
    const elements = asElements(document.scene);
    const files = asFiles(document.scene);
    const stamp = stampOf(elements, files);

    // A different drawing: the instance is keyed on the node, so it remounts and reads
    // `initialData` itself.
    if (nodeIdRef.current !== document.nodeId) {
      nodeIdRef.current = document.nodeId;
      isHandOverPendingRef.current = true;
      editorStampRef.current = stamp;
      documentStampRef.current = stamp;

      return;
    }

    // The host handing back the edit the viewer just made. Pushing it into the editor
    // would throw away the user's selection and their undo history for nothing.
    if (isSameStamp(stamp, documentStampRef.current)) {
      return;
    }

    const api = apiRef.current;

    // The editor has not mounted yet, so it still reads this scene as its `initialData`.
    // The stamp stays behind as well, or the scene after this one is taken for an echo.
    if (api === null) {
      return;
    }

    documentStampRef.current = stamp;
    isHandOverPendingRef.current = true;
    // The scene changed underneath the user, so it is not theirs to undo.
    api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
    api.addFiles(Object.values(files) as BinaryFileData[]);
  }, [document]);

  const handleChange = (
    elements: readonly ExcalidrawElement[],
    _appState: unknown,
    files: BinaryFiles
  ) => {
    const stamp = stampOf(elements, files);

    // The scene the viewer handed over, coming back. Excalidraw repairs what it is given —
    // it fills in a missing order index, for one — so the stamp it reports is its own.
    if (isHandOverPendingRef.current) {
      isHandOverPendingRef.current = false;
      editorStampRef.current = stamp;

      return;
    }

    // Excalidraw reports a change on every pointer move, panning and zooming included.
    if (isSameStamp(stamp, editorStampRef.current)) {
      return;
    }

    editorStampRef.current = stamp;

    // A deleted element stays in the scene as a tombstone so the user can undo it. That is
    // editor state, not content, and writing it would grow the file with every deletion.
    const nextElements = getNonDeletedElements(elements);
    const scene: TExcalidrawScene = {
      elements: nextElements as readonly Record<string, unknown>[],
      files: files as Record<string, unknown>,
    };

    documentStampRef.current = stampOf(nextElements, files);

    registry.excalidrawDocumentChangedAction(document.nodeId, scene);
  };

  return (
    <div className="excalidraw-viewer">
      <Excalidraw
        excalidrawAPI={(api) => {
          apiRef.current = api;
        }}
        initialData={{
          appState: { viewBackgroundColor: "transparent" },
          elements: asElements(document.scene),
          files: asFiles(document.scene),
          scrollToContent: true,
        }}
        // `initialData` is read once, on mount, so a different drawing needs a new instance.
        key={document.nodeId}
        onChange={handleChange}
        theme={theme === "dark" ? THEME.DARK : THEME.LIGHT}
        viewModeEnabled={readOnly}
      />
    </div>
  );
};

export { ExcalidrawViewer };
