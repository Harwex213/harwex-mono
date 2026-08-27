import type { FC } from "react";
import type { TFsNodeKind } from "@hw/harwex-notes-protocol";

type TChevronProps = {
  isExpanded: boolean;
};

const Chevron: FC<TChevronProps> = ({ isExpanded }) => {
  return (
    <svg
      className={`fs__chevron${isExpanded ? " fs__chevron--open" : ""}`}
      height="12"
      viewBox="0 0 12 12"
      width="12"
    >
      <path d="M4 2.5 L8 6 L4 9.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
};

const FolderIcon: FC = () => {
  return (
    <svg className="fs__icon fs__icon--folder" height="14" viewBox="0 0 16 16" width="14">
      <path
        d="M1.5 4.2h4l1.3 1.6h7.7v7.7H1.5z"
        fill="currentColor"
        fillOpacity="0.3"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M1.5 4.2V2.9h3.4l1 1.3" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
};

const FileIcon: FC = () => {
  return (
    <svg className="fs__icon" height="14" viewBox="0 0 16 16" width="14">
      <path
        d="M3 1.8h6.4L13 5.4v8.8H3z"
        fill="currentColor"
        fillOpacity="0.22"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M9.2 1.8v3.8H13" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
};

const MarkdownIcon: FC = () => {
  return (
    <svg className="fs__icon fs__icon--markdown" height="14" viewBox="0 0 16 16" width="14">
      <path
        d="M3 1.8h6.4L13 5.4v8.8H3z"
        fill="currentColor"
        fillOpacity="0.22"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M9.2 1.8v3.8H13" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.2 11.6V8l1.6 2 1.6-2v3.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
};

const SketchIcon: FC = () => {
  return (
    <svg className="fs__icon fs__icon--sketch" height="14" viewBox="0 0 16 16" width="14">
      <path
        d="M2.4 2.4h11.2v11.2H2.4z"
        fill="currentColor"
        fillOpacity="0.22"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M4.4 10.6c1.4-3.6 2.6-3.6 3.6-1.4 1 2.2 2.2 2.2 3.6-1.4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.2"
      />
    </svg>
  );
};

const PLUS_PATH = "M12.5 9.6v4.2M10.4 11.7h4.2";

const NewNoteIcon: FC = () => {
  return (
    <svg className="fs__tool-icon fs__icon--markdown" height="15" viewBox="0 0 16 16" width="15">
      <path
        d="M2.6 1.8h5.8L11.4 4.8v4.2H2.6z"
        fill="currentColor"
        fillOpacity="0.22"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M8.2 1.8v3h3.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path
        d={PLUS_PATH}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
};

const NewSketchIcon: FC = () => {
  return (
    <svg className="fs__tool-icon fs__icon--sketch" height="15" viewBox="0 0 16 16" width="15">
      <path
        d="M2.2 2.2h9v6.8h-9z"
        fill="currentColor"
        fillOpacity="0.22"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M3.8 7.4c1.1-2.6 2-2.6 2.8-1 .8 1.6 1.7 1.6 2.8-1"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.2"
      />
      <path
        d={PLUS_PATH}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
};

const NewFolderIcon: FC = () => {
  return (
    <svg className="fs__tool-icon fs__icon--folder" height="15" viewBox="0 0 16 16" width="15">
      <path
        d="M1.4 4.2h3.6l1.2 1.5h5.4V11H1.4z"
        fill="currentColor"
        fillOpacity="0.3"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M1.4 4.2V3h3l0.9 1.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path
        d={PLUS_PATH}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
};

type TNodeIconProps = {
  kind: TFsNodeKind;
};

const NodeIcon: FC<TNodeIconProps> = ({ kind }) => {
  if (kind === "folder") {
    return <FolderIcon />;
  }

  if (kind === "markdown") {
    return <MarkdownIcon />;
  }

  return <SketchIcon />;
};

type TDraftIconProps = {
  kind: TFsNodeKind;
};

// A file draft has no kind until an extension is typed, so it shows a plain sheet.
const DraftIcon: FC<TDraftIconProps> = ({ kind }) => {
  if (kind === "file") {
    return <FileIcon />;
  }

  return <NodeIcon kind={kind} />;
};

export { Chevron, DraftIcon, NewFolderIcon, NewNoteIcon, NewSketchIcon, NodeIcon };
