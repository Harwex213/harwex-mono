import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { gridTemplate } from "../data/layouts";
import { useEditor } from "../store/editor-context";
import type { SectionNode } from "../types";
import { ContainerView } from "./container-view";

interface SectionViewProps {
  section: SectionNode;
  index: number;
  total: number;
}

function SectionView({ section, index, total }: SectionViewProps): ReactNode {
  const { state, dispatch } = useEditor();
  const selected = state.selection?.kind === "section" && state.selection.id === section.id;

  function onSelect(event: MouseEvent<HTMLElement>): void {
    event.stopPropagation();
    dispatch({ type: "select", selection: { kind: "section", id: section.id } });
  }

  function tool(event: MouseEvent<HTMLButtonElement>, run: () => void): void {
    event.stopPropagation();
    run();
  }

  const outerStyle: CSSProperties = {
    paddingTop: `${section.style.paddingY}px`,
    paddingBottom: `${section.style.paddingY}px`,
  };

  const innerStyle: CSSProperties = {
    gridTemplateColumns: gridTemplate(section.layout),
    gap: `${section.style.gap}px`,
    maxWidth: section.style.maxWidth > 0 ? `${section.style.maxWidth}px` : "none",
  };

  const classes = ["tb-section", `tb-section--${section.style.background}`];

  if (selected) {
    classes.push("is-selected");
  }

  if (state.preview) {
    classes.push("is-preview");
  }

  return (
    <section className={classes.join(" ")} style={outerStyle} onClick={state.preview ? undefined : onSelect}>
      {state.preview ? null : (
        <span className="tb-section__tag">
          <span className="tb-section__name">{section.name}</span>
          <span className="tb-section__tools">
            <button
              type="button"
              className="tb-icon"
              title="Move up"
              disabled={index === 0}
              onClick={(event) => tool(event, () => dispatch({ type: "move-section", sectionId: section.id, offset: -1 }))}
            >
              ↑
            </button>
            <button
              type="button"
              className="tb-icon"
              title="Move down"
              disabled={index === total - 1}
              onClick={(event) => tool(event, () => dispatch({ type: "move-section", sectionId: section.id, offset: 1 }))}
            >
              ↓
            </button>
            <button
              type="button"
              className="tb-icon"
              title="Duplicate"
              onClick={(event) => tool(event, () => dispatch({ type: "duplicate-section", sectionId: section.id }))}
            >
              ⧉
            </button>
            <button
              type="button"
              className="tb-icon tb-icon--danger"
              title="Delete"
              onClick={(event) => tool(event, () => dispatch({ type: "delete-section", sectionId: section.id }))}
            >
              ✕
            </button>
          </span>
        </span>
      )}

      <div className="tb-section__inner" style={innerStyle}>
        {section.containers.map((container, position) => (
          <ContainerView key={container.id} container={container} position={position} />
        ))}
      </div>
    </section>
  );
}

export { SectionView };
