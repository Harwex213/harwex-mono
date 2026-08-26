import { Excalidraw, THEME } from "@excalidraw/excalidraw";
import { useEffect, useState } from "react";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import type { FC } from "react";
import type { TExcalidrawDocument } from "../../api/types";

type TExcalidrawViewerProps = {
  document: TExcalidrawDocument;
};

const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

// Excalidraw paints on a canvas, so it cannot follow the media query the rest of the app
// uses. Its theme has to be handed over as a prop and kept in sync by hand.
const useIsDarkScheme = (): boolean => {
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

  return isDark;
};

const ExcalidrawViewer: FC<TExcalidrawViewerProps> = ({ document }) => {
  const isDark = useIsDarkScheme();

  return (
    <div className="sketch">
      <Excalidraw
        initialData={{
          appState: { viewBackgroundColor: "transparent" },
          // The protocol carries the scene as opaque records; this is the one place that
          // hands them back to Excalidraw under its own types.
          elements: document.scene.elements as readonly ExcalidrawElement[],
          files: document.scene.files as BinaryFiles,
          scrollToContent: true,
        }}
        // `initialData` is read once, on mount, so a different sketch needs a new instance.
        key={document.nodeId}
        theme={isDark ? THEME.DARK : THEME.LIGHT}
        viewModeEnabled
      />
    </div>
  );
};

export { ExcalidrawViewer };
