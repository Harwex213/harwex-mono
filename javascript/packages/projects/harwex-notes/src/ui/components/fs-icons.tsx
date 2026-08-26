import type { FC } from "react";
import type { TFsNodeKind } from "../../api/types";

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
    <svg className="fs__icon" height="14" viewBox="0 0 16 16" width="14">
      <path
        d="M1.5 4.2h4l1.3 1.6h7.7v7.7H1.5z"
        fill="currentColor"
        fillOpacity="0.18"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M1.5 4.2V2.9h3.4l1 1.3" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
};

const MarkdownIcon: FC = () => {
  return (
    <svg className="fs__icon" height="14" viewBox="0 0 16 16" width="14">
      <path
        d="M3 1.8h6.4L13 5.4v8.8H3z"
        fill="currentColor"
        fillOpacity="0.14"
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
    <svg className="fs__icon" height="14" viewBox="0 0 16 16" width="14">
      <path
        d="M2.4 2.4h11.2v11.2H2.4z"
        fill="currentColor"
        fillOpacity="0.14"
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

export { Chevron, NodeIcon };
