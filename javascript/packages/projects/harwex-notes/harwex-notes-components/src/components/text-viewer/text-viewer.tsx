import "./text-viewer.css";
import { MarkdownSourceEditor } from "../markdown-viewer/markdown-source-editor";
import type { FC } from "react";
import type { TTextViewerProps } from "./text-viewer.types";

// A plain text file in one editor: no preview, no syntax colouring, no wrapping (TXT-1,
// TXT-2). The editor is the Markdown source editor in its plain mode.
const TextViewer: FC<TTextViewerProps> = ({
  document,
  registry,
  theme = "light",
  readOnly = false,
}) => {
  const handleChange = (text: string) => {
    if (text === document.text) {
      return;
    }

    registry.textDocumentChangedAction(document.nodeId, text);
  };

  return (
    <div className={`text-viewer text-viewer--${theme}`} data-theme={theme}>
      <MarkdownSourceEditor
        className="text-viewer__editor"
        // The editor holds its own undo history, which belongs to one file.
        key={document.nodeId}
        onChange={handleChange}
        plain
        readOnly={readOnly}
        text={document.text}
        theme={theme}
      />
    </div>
  );
};

export { TextViewer };
