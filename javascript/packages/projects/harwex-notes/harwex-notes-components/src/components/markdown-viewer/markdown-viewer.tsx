import "./markdown-viewer.css";
import { MarkdownRendered } from "./markdown-rendered";
import { MarkdownSourceEditor } from "./markdown-source-editor";
import type { FC } from "react";
import type { TMarkdownViewerProps } from "./markdown-viewer.types";

const MarkdownViewer: FC<TMarkdownViewerProps> = ({
  document,
  registry,
  layout = "split",
  theme = "light",
  readOnly = false,
  resolveImageUrl,
  onLinkClick,
}) => {
  const handleChange = (text: string) => {
    if (text === document.text) {
      return;
    }

    registry.markdownDocumentChangedAction(document.nodeId, text);
  };

  const showSource = layout !== "rendered";
  const showRendered = layout !== "source";

  return (
    <div
      className={`markdown-viewer markdown-viewer--${layout} markdown-viewer--${theme}`}
      data-theme={theme}
    >
      {showSource ? (
        <div className="markdown-viewer__pane markdown-viewer__pane--source">
          <MarkdownSourceEditor
            // The editor holds its own undo history, which belongs to one file.
            key={document.nodeId}
            onChange={handleChange}
            readOnly={readOnly}
            text={document.text}
            theme={theme}
          />
        </div>
      ) : null}

      {showRendered ? (
        <div className="markdown-viewer__pane markdown-viewer__pane--rendered">
          <MarkdownRendered
            onLinkClick={onLinkClick}
            resolveImageUrl={resolveImageUrl}
            text={document.text}
          />
        </div>
      ) : null}
    </div>
  );
};

export { MarkdownViewer };
