import type { Entry, FileKind } from "../../shared/contract.ts";

type TreeRowProps = {
  entry: Entry;
  depth: number;
  index: number;
  isSelected: boolean;
  isExpanded: boolean;
  isLoading: boolean;
  isOpen: boolean;
  onSelect: (path: string) => void;
  onActivate: (entry: Entry) => void;
};

const KIND_LABEL: Record<FileKind, string> = {
  excalidraw: "drawing",
  html: "html",
  markdown: "markdown",
  text: "text",
};

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg className={expanded ? "tree-chevron open" : "tree-chevron"} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M4 2.5 L8 6 L4 9.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FolderIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg className="tree-icon icon-dir" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d={
          expanded
            ? "M1.5 4.5h4l1.4 1.6h7.6v7.4h-13z"
            : "M1.5 3.5h4.6l1.3 1.5h7.1v8.5h-13z"
        }
        fill="currentColor"
        opacity="0.85"
      />
    </svg>
  );
}

function FileIcon({ kind }: { kind: FileKind }) {
  if (kind === "excalidraw") {
    return (
      <svg className="tree-icon icon-excalidraw" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2.5 12.5 C5 6.5 8 11 11 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="12.6" cy="3.4" r="1.4" fill="currentColor" />
      </svg>
    );
  }
  if (kind === "markdown") {
    return (
      <svg className="tree-icon icon-markdown" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path d="M4 10.5V6l2 2.4L8 6v4.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M10.6 6v3.2m0 0 1.3-1.3m-1.3 1.3L9.3 7.9" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "html") {
    return (
      <svg className="tree-icon icon-html" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M6 4 L2.5 8 L6 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M10 4 L13.5 8 L10 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg className="tree-icon icon-text" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2.5h5.5L12.5 5.5v8h-8.5z" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.8 7.5h5m-5 2.4h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function TreeRow(props: TreeRowProps) {
  const { entry, depth, index, isSelected, isExpanded, isLoading, isOpen } = props;
  const isDirectory = entry.type === "dir";
  const classNames = ["tree-row"];
  if (isSelected) {
    classNames.push("selected");
  }
  if (isOpen) {
    classNames.push("open-in-tab");
  }

  return (
    <div
      className={classNames.join(" ")}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={isSelected}
      aria-expanded={isDirectory ? isExpanded : undefined}
      aria-busy={isLoading ? true : undefined}
      // Roving tabindex: the whole panel is one tab stop.
      tabIndex={isSelected ? 0 : -1}
      data-index={index}
      title={entry.path.length === 0 ? entry.name : entry.path}
      onMouseDown={() => {
        props.onSelect(entry.path);
      }}
      onClick={() => {
        // A single click is enough to fold a directory; a file needs a double
        // click, or Enter. Letting both handlers fire on a directory would
        // toggle it twice and leave it exactly as it was.
        if (isDirectory) {
          props.onActivate(entry);
        }
      }}
      onDoubleClick={() => {
        if (!isDirectory) {
          props.onActivate(entry);
        }
      }}
    >
      {Array.from({ length: depth }, (_unused, level) => {
        return <span className="tree-guide" key={level} />;
      })}
      <span className="tree-chevron-slot">
        {isDirectory ? <Chevron expanded={isExpanded} /> : null}
      </span>
      {isDirectory ? <FolderIcon expanded={isExpanded} /> : <FileIcon kind={entry.fileKind ?? "text"} />}
      <span className="tree-name">{entry.name}</span>
      {!isDirectory && entry.fileKind !== null ? (
        <span className="tree-kind">{KIND_LABEL[entry.fileKind]}</span>
      ) : null}
    </div>
  );
}

export { TreeRow };
