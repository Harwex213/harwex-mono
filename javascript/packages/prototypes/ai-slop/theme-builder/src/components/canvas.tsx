import { useEffect, useRef, useState } from "react";
import type { CSSProperties, DragEvent, ReactNode, RefObject } from "react";
import { themeVariables } from "../data/theme";
import { endDrag, getDrag } from "../dnd/drag-state";
import { useActivePage, useEditor } from "../store/editor-context";
import type { BreakpointId, SectionLayoutId } from "../types";
import { SectionView } from "./section-view";

const FRAME_WIDTH: Record<BreakpointId, number> = {
  desktop: 1320,
  tablet: 834,
  mobile: 390,
};

interface SectionGapProps {
  index: number;
}

function SectionGap({ index }: SectionGapProps): ReactNode {
  const { dispatch } = useEditor();
  const [over, setOver] = useState(false);

  function onDragOver(event: DragEvent<HTMLDivElement>): void {
    const drag = getDrag();

    if (drag?.kind !== "new-section") {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setOver(true);
  }

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    const drag = getDrag();

    setOver(false);

    if (drag?.kind !== "new-section") {
      return;
    }

    event.preventDefault();
    dispatch({ type: "add-section", layout: drag.layout as SectionLayoutId, index });
    endDrag();
  }

  return (
    <div
      className={over ? "tb-gap is-over" : "tb-gap"}
      onDragOver={onDragOver}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <button
        type="button"
        className="tb-gap__btn"
        onClick={() => dispatch({ type: "add-section", layout: "single", index })}
      >
        ＋ Section
      </button>
    </div>
  );
}

const FRAME_MARGIN = 48;

/**
 * A 1320px desktop frame does not fit between the two panels. The frame is
 * zoomed down to fit instead of scrolled sideways; `zoom` keeps the layout box
 * in sync, so drop-position maths stays in plain viewport coordinates.
 */
function useFitZoom(width: number): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const element = ref.current;

    if (!element) {
      return;
    }

    function measure(available: number): void {
      setZoom(Math.min(1, (available - FRAME_MARGIN) / width));
    }

    const observer = new ResizeObserver((entries) => measure(entries[0].contentRect.width));

    observer.observe(element);
    measure(element.clientWidth);

    return () => observer.disconnect();
  }, [width]);

  return [ref, zoom];
}

function Canvas(): ReactNode {
  const { state, dispatch } = useEditor();
  const page = useActivePage();
  const width = FRAME_WIDTH[state.breakpoint];
  const [scrollRef, zoom] = useFitZoom(width);

  const frameStyle: CSSProperties = {
    ...(themeVariables(state.doc.theme) as CSSProperties),
    width: `${width}px`,
    zoom,
  };

  return (
    <main
      className="tb-canvas"
      onClick={() => dispatch({ type: "select", selection: null })}
      onDragEnd={endDrag}
    >
      <div className="tb-canvas__scroll" ref={scrollRef}>
        <div className="tb-frame" data-bp={state.breakpoint} style={frameStyle}>
          {state.preview ? null : <SectionGap index={0} />}
          {page.sections.map((section, index) => (
            <div key={section.id}>
              <SectionView section={section} index={index} total={page.sections.length} />
              {state.preview ? null : <SectionGap index={index + 1} />}
            </div>
          ))}
          {page.sections.length === 0 ? (
            <div className="tb-frame__empty">
              This page is empty. Drop a section layout from the Add panel to begin.
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}

export { Canvas };
