import { useState } from "react";
import "./html-viewer.css";
import type { FC } from "react";
import type { THtmlViewerProps } from "./html-viewer.types";

// Scripts run (HTML-3), but the page gets an opaque origin of its own: it cannot read the
// app's storage or DOM, and with no top-navigation token it cannot move the app away
// (HTML-4). Popups are allowed so a link with target="_blank" still opens a browser tab.
const FRAME_SANDBOX = "allow-scripts allow-forms allow-popups allow-modals";

const HtmlViewer: FC<THtmlViewerProps> = ({ document, name }) => {
  // Bumping the key remounts the frame, which loads the page again from the start.
  const [reloadCount, setReloadCount] = useState(0);

  const title = name ?? "HTML page";

  return (
    <div className="html-viewer">
      <div className="html-viewer__toolbar">
        <span className="html-viewer__name" title={title}>
          {title}
        </span>

        <span className="html-viewer__badge">{"Read-only"}</span>

        <button
          className="html-viewer__button"
          onClick={() => setReloadCount((count) => count + 1)}
          title="Run the page again from the start"
          type="button"
        >
          {"Reload"}
        </button>
      </div>

      <iframe
        className="html-viewer__frame"
        key={`${document.src}#${reloadCount}`}
        referrerPolicy="no-referrer"
        sandbox={FRAME_SANDBOX}
        src={document.src}
        title={title}
      />
    </div>
  );
};

export { HtmlViewer };
