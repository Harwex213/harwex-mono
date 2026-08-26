import { Excalidraw, getSceneVersion, serializeAsJSON } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { useEffect, useMemo, useRef, type ComponentProps } from "react";
import { docsByPath, saveDoc, setDraft } from "../../state/doc-store.ts";

type ExcalidrawProps = ComponentProps<typeof Excalidraw>;
type ExcalidrawChangeHandler = NonNullable<ExcalidrawProps["onChange"]>;
type SceneElements = Parameters<ExcalidrawChangeHandler>[0];

type ExcalidrawEditorProps = {
  path: string;
};

// Long enough that a single drag is one write, short enough that a pause in
// drawing lands on disk before the user moves on.
const AUTOSAVE_DELAY_MS = 800;

type ParsedScene = {
  initialData: ExcalidrawProps["initialData"];
  version: number;
  error: string | null;
};

function parseScene(text: string): ParsedScene {
  if (text.trim().length === 0) {
    return { initialData: null, version: 0, error: null };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return {
      initialData: null,
      version: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const scene = raw as {
    elements?: unknown;
    appState?: Record<string, unknown>;
    files?: unknown;
  };
  const appState = { ...(scene.appState ?? {}) };
  // A scene saved elsewhere can carry `collaborators` as a plain object, while
  // Excalidraw expects a Map. It is never useful here, so drop it.
  delete appState.collaborators;
  const elements = Array.isArray(scene.elements) ? scene.elements : [];
  return {
    initialData: {
      elements,
      appState,
      files: scene.files,
      scrollToContent: true,
    } as ExcalidrawProps["initialData"],
    version: getSceneVersion(elements as SceneElements),
    error: null,
  };
}

function ExcalidrawEditor({ path }: ExcalidrawEditorProps) {
  const parsed = useMemo(() => {
    return parseScene(docsByPath.peek()[path]?.draftText ?? "");
  }, [path]);

  const lastVersionRef = useRef<number>(parsed.version);
  const pendingRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const commit = (): void => {
    const pending = pendingRef.current;
    if (pending === null) {
      return;
    }
    pendingRef.current = null;
    setDraft(path, pending);
    void saveDoc(path);
  };

  useEffect(() => {
    return () => {
      // A drawing abandoned mid-debounce still belongs on disk.
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      commit();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor is keyed by path
  }, [path]);

  const handleChange: ExcalidrawChangeHandler = (elements, appState, files) => {
    // `onChange` also fires on plain pointer movement. The scene version is the
    // cheap way to tell an actual edit from a cursor drifting across the canvas.
    const version = getSceneVersion(elements);
    if (version === lastVersionRef.current) {
      return;
    }
    lastVersionRef.current = version;
    pendingRef.current = serializeAsJSON(elements, appState, files, "local");
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      commit();
    }, AUTOSAVE_DELAY_MS);
  };

  if (parsed.error !== null) {
    return (
      <div className="editor-message editor-message-bad">
        {`${path} is not valid Excalidraw JSON: ${parsed.error}`}
      </div>
    );
  }

  return (
    <div className="excalidraw-host">
      <Excalidraw initialData={parsed.initialData} onChange={handleChange} theme="dark" />
    </div>
  );
}

export { ExcalidrawEditor };
