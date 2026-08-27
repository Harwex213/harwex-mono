import "@excalidraw/excalidraw/index.css";
import "./excalidraw-viewer.css";
import {
  CaptureUpdateAction,
  Excalidraw,
  getNonDeletedElements,
  getSceneVersion,
  THEME,
} from "@excalidraw/excalidraw";
import { useEffect, useRef, useState } from "react";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { FC } from "react";
import type { TExcalidrawDocument, TExcalidrawScene } from "@hw/harwex-notes-protocol";

type TExcalidrawViewerProps = {
  document: TExcalidrawDocument;
  // The drawing changed. Panning, zooming and selecting are not changes and never reach it,
  // so every call carries content to write. A drag reports each step of itself, which is
  // what a host that saves on a pause expects.
  onChange?: (scene: TExcalidrawScene) => void;
  // Reading only: the drawing shows but no tool can change it.
  readOnly?: boolean;
  // Left out, the viewer follows the operating system setting.
  theme?: "light" | "dark";
};

// A cheap fingerprint of a scene. `getSceneVersion` sums the element versions, which change
// on every edit and on nothing else; the file count catches an image whose data arrives
// after the element that holds it.
type TSceneStamp = {
  version: number;
  fileCount: number;
};

const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

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

// Excalidraw paints on a canvas, so it cannot follow the media query the rest of the app
// uses. Its theme has to be handed over as a prop and kept in sync by hand.
const useSystemTheme = (): "light" | "dark" => {
  const [isDark, setIsDark] = useState(() => {
    return window.matchMedia(DARK_SCHEME_QUERY).matches;
  });

  useEffect(() => {
    const query = window.matchMedia(DARK_SCHEME_QUERY);

    const handleChange = (event: MediaQueryListEvent) => {
      setIsDark(event.matches);
    };

    query.addEventListener("change", handleChange);

    return () => {
      query.removeEventListener("change", handleChange);
    };
  }, []);

  return isDark ? "dark" : "light";
};

const ExcalidrawViewer: FC<TExcalidrawViewerProps> = ({
  document,
  onChange,
  readOnly = false,
  theme,
}) => {
  const systemTheme = useSystemTheme();
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

    documentStampRef.current = stamp;

    const api = apiRef.current;

    if (api === null) {
      return;
    }

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
    const scene = {
      elements: nextElements as readonly Record<string, unknown>[],
      files: files as Record<string, unknown>,
    };

    documentStampRef.current = stampOf(nextElements, files);

    if (onChange) {
      onChange(scene);
    }
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
        theme={(theme ?? systemTheme) === "dark" ? THEME.DARK : THEME.LIGHT}
        viewModeEnabled={readOnly}
      />
    </div>
  );
};

export { ExcalidrawViewer };
export type { TExcalidrawViewerProps };
