import "@excalidraw/excalidraw/index.css";
import "./excalidraw-viewer.css";
import {
  CaptureUpdateAction,
  Excalidraw,
  getNonDeletedElements,
  getSceneVersion,
  newElementWith,
  THEME,
} from "@excalidraw/excalidraw";
import {
  DEFAULT_EXCALIDRAW_STYLE,
  EXCALIDRAW_STYLE_KEYS,
  VAULT_LINK_PREFIX,
} from "@hw/harwex-notes-protocol";
import { useEffect, useRef, useState } from "react";
import { ExcalidrawLinkPicker } from "./excalidraw-link-picker";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawProps,
  UIAppState,
} from "@excalidraw/excalidraw/types";
import type { FC, KeyboardEvent } from "react";
import type { TExcalidrawScene, TExcalidrawStyle } from "@hw/harwex-notes-protocol";
import type { TExcalidrawViewerProps } from "./excalidraw-viewer.types";

// A cheap fingerprint of a scene. `getSceneVersion` sums the element versions, which change
// on every edit and on nothing else; the file count catches an image whose data arrives
// after the element that holds it. The style is part of the scene too (EX-7): a new stroke
// colour with nothing drawn yet is still a change worth saving.
type TSceneStamp = {
  version: number;
  fileCount: number;
  style: string;
};

type TLinkOpenHandler = NonNullable<ExcalidrawProps["onLinkOpen"]>;

const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

// The protocol carries the scene as opaque records. These two are the only place that hands
// them back to Excalidraw under its own types.
const asElements = (scene: TExcalidrawScene): readonly ExcalidrawElement[] => {
  return scene.elements as readonly ExcalidrawElement[];
};

const asFiles = (scene: TExcalidrawScene): BinaryFiles => {
  return scene.files as BinaryFiles;
};

// Copies the style keys out of Excalidraw's whole app state. It runs on every pointer move,
// so it copies values as they are instead of validating them; the backend validates.
const readStyle = (appState: Readonly<Record<string, unknown>>): TExcalidrawStyle => {
  const style: Record<string, unknown> = {};

  for (const key of EXCALIDRAW_STYLE_KEYS) {
    if (appState[key] !== undefined) {
      style[key] = appState[key];
    }
  }

  return style as TExcalidrawStyle;
};

// A file may set only some style keys, or none (one made on excalidraw.com, say). The rest
// come from the user's default, then from the app's own.
const readSceneStyle = (scene: TExcalidrawScene, defaultStyle: TExcalidrawStyle): TExcalidrawStyle => {
  return { ...DEFAULT_EXCALIDRAW_STYLE, ...defaultStyle, ...scene.appState };
};

const stampOf = (
  elements: readonly ExcalidrawElement[],
  files: BinaryFiles,
  style: TExcalidrawStyle
): TSceneStamp => {
  return {
    version: getSceneVersion(elements),
    fileCount: Object.keys(files).length,
    style: JSON.stringify(readStyle(style)),
  };
};

const isSameStamp = (left: TSceneStamp, right: TSceneStamp): boolean => {
  return left.version === right.version && left.fileCount === right.fileCount && left.style === right.style;
};

// A link names a vault file when it has the `vault:` prefix or no scheme at all (EX-9).
// Every other link (http, mailto) keeps Excalidraw's own behaviour.
const isVaultHref = (href: string): boolean => {
  const trimmed = href.trim();
  if (trimmed.startsWith(VAULT_LINK_PREFIX)) {
    return true;
  }

  return trimmed.length > 0 && !trimmed.startsWith("#") && !URL_SCHEME_PATTERN.test(trimmed);
};

const hasSelection = (appState: UIAppState): boolean => {
  return Object.values(appState.selectedElementIds).some(Boolean);
};

const ExcalidrawViewer: FC<TExcalidrawViewerProps> = ({
  document,
  registry,
  theme = "light",
  readOnly = false,
  defaultStyle = {},
  viewport = null,
  linkTargets = [],
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
  const editorStampRef = useRef(
    stampOf(asElements(document.scene), asFiles(document.scene), readSceneStyle(document.scene, defaultStyle))
  );
  const documentStampRef = useRef(editorStampRef.current);
  // The first scroll is Excalidraw placing the drawing, not the user moving it.
  const isViewportLiveRef = useRef(false);
  // The elements a "Link to file" pick applies to, or null while the picker is closed.
  const [linkElementIds, setLinkElementIds] = useState<readonly string[] | null>(null);

  useEffect(() => {
    const elements = asElements(document.scene);
    const files = asFiles(document.scene);
    const style = readSceneStyle(document.scene, defaultStyle);
    const stamp = stampOf(elements, files, style);

    // A different drawing: the instance is keyed on the node, so it remounts and reads
    // `initialData` itself.
    if (nodeIdRef.current !== document.nodeId) {
      nodeIdRef.current = document.nodeId;
      isHandOverPendingRef.current = true;
      isViewportLiveRef.current = false;
      editorStampRef.current = stamp;
      documentStampRef.current = stamp;
      setLinkElementIds(null);

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
    api.updateScene({
      elements,
      // Only the style keys are set; `updateScene` merges them into the editor's state.
      appState: style as unknown as AppState,
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    api.addFiles(Object.values(files) as BinaryFileData[]);
    // `defaultStyle` only fills keys a file lacks, and a change to it is not a new scene.
  }, [document]);

  const handleChange = (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles
  ) => {
    const style = readStyle(appState as unknown as Record<string, unknown>);
    const stamp = stampOf(elements, files, style);

    // The scene the viewer handed over, coming back. Excalidraw repairs what it is given —
    // it fills in a missing order index, for one — so the stamp it reports is its own.
    if (isHandOverPendingRef.current) {
      isHandOverPendingRef.current = false;
      isViewportLiveRef.current = true;
      editorStampRef.current = stamp;

      return;
    }

    // Excalidraw reports a change on every pointer move, panning and zooming included.
    // Neither is an edit (EX-6), and neither changes the stamp.
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
      appState: style,
    };

    documentStampRef.current = stampOf(nextElements, files, style);

    registry.excalidrawDocumentChangedAction(document.nodeId, scene);
  };

  const handleScrollChange = (scrollX: number, scrollY: number, zoom: { value: number }) => {
    if (!isViewportLiveRef.current) {
      return;
    }

    registry.excalidrawViewportChangedAction(document.nodeId, { scrollX, scrollY, zoom: zoom.value });
  };

  // Excalidraw would open a link without a scheme as a page of this app, which would
  // navigate the app away (APP-1). A vault link opens a tab instead (EX-9).
  const handleLinkOpen: TLinkOpenHandler = (element, event) => {
    const link = element.link ?? "";
    if (!isVaultHref(link)) {
      return;
    }

    event.preventDefault();
    registry.openVaultLinkAction(document.nodeId, link);
  };

  const openLinkPicker = () => {
    const api = apiRef.current;
    if (api === null || readOnly) {
      return;
    }

    const selected = Object.entries(api.getAppState().selectedElementIds)
      .filter(([, isSelected]) => isSelected)
      .map(([id]) => id);

    if (selected.length === 0) {
      return;
    }

    setLinkElementIds(selected);
  };

  // The link is written as an edit, so it can be undone and it saves (EX-2).
  const applyLink = (path: string) => {
    const api = apiRef.current;
    const ids = new Set(linkElementIds ?? []);

    setLinkElementIds(null);

    if (api === null || ids.size === 0) {
      return;
    }

    const link = `${VAULT_LINK_PREFIX}${path}`;
    const elements = api.getSceneElementsIncludingDeleted().map((element) => {
      return ids.has(element.id) ? newElementWith(element, { link }) : element;
    });

    api.updateScene({ elements, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  };

  // Cmd+Shift+K (Ctrl+Shift+K elsewhere) next to Excalidraw's own Cmd+K link editor.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const isChord = (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey;
    if (!isChord || event.key.toLowerCase() !== "k" || linkElementIds !== null) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    openLinkPicker();
  };

  const renderTopRightUI = (_isMobile: boolean, appState: UIAppState) => {
    if (readOnly || !hasSelection(appState)) {
      return null;
    }

    return (
      <button
        className="excalidraw-viewer__link-button"
        onClick={openLinkPicker}
        title={"Link the selection to a file of the vault (⇧⌘K)"}
        type="button"
      >
        {"Link to file…"}
      </button>
    );
  };

  const initialAppState: Partial<AppState> = {
    ...(readSceneStyle(document.scene, defaultStyle) as Partial<AppState>),
    viewBackgroundColor: "transparent",
  };

  if (viewport !== null) {
    initialAppState.scrollX = viewport.scrollX;
    initialAppState.scrollY = viewport.scrollY;
    initialAppState.zoom = { value: viewport.zoom as AppState["zoom"]["value"] };
  }

  return (
    <div className="excalidraw-viewer" onKeyDownCapture={handleKeyDown}>
      <Excalidraw
        excalidrawAPI={(api) => {
          apiRef.current = api;
        }}
        initialData={{
          appState: initialAppState,
          elements: asElements(document.scene),
          files: asFiles(document.scene),
          scrollToContent: viewport === null,
        }}
        // `initialData` is read once, on mount, so a different drawing needs a new instance.
        key={document.nodeId}
        onChange={handleChange}
        onLinkOpen={handleLinkOpen}
        onScrollChange={handleScrollChange}
        renderTopRightUI={renderTopRightUI}
        theme={theme === "dark" ? THEME.DARK : THEME.LIGHT}
        viewModeEnabled={readOnly}
      />

      {linkElementIds === null ? null : (
        <ExcalidrawLinkPicker
          onClose={() => setLinkElementIds(null)}
          onPick={applyLink}
          paths={linkTargets}
        />
      )}
    </div>
  );
};

export { ExcalidrawViewer };
