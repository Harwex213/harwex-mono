import { effect } from "@preact/signals-react";
import { useEffect, useRef } from "react";
import { LEARNING_DURATION } from "../../domain/actions/research-actions";
import { createViewport, hitTest, renderScene } from "../render/snowflake-renderer";
import { useStore } from "../../store/store";
import type { FC, MouseEvent } from "react";
import type { TAppRegistry } from "../../domain/registry";

type TTechCanvasProps = {
  registry: TAppRegistry;
};

/** Pointer movement below this (in px) still counts as a click, not a drag. */
const DRAG_THRESHOLD = 4;
/** How long the hovered name takes to spread out, in ms. */
const HOVER_REVEAL_DURATION = 260;

type TDrag = {
  lastX: number;
  lastY: number;
  moved: number;
};

const TechCanvas: FC<TTechCanvasProps> = ({ registry }) => {
  const store = useStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<TDrag | null>(null);

  // The canvas redraws straight from signals; React only mounts the element.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    let frame = 0;

    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const now = performance.now();
      const hoveredId = store.viewState.hoveredId.value;
      const hoverReveal = hoveredId ? (now - store.viewState.hoveredAt.value) / HOVER_REVEAL_DURATION : 1;
      const learning = store.techState.learning.value;

      renderScene(ctx, rect.width, rect.height, {
        researched: store.techState.researched.value,
        hoveredId,
        hoverReveal,
        selectedId: store.viewState.selectedId.value,
        learning: learning ? { techId: learning.techId, progress: Math.min(1, (now - learning.startedAt) / LEARNING_DURATION) } : null,
        camera: store.viewState.camera.value,
      });

      // Animations keep the frame loop alive only while something is moving.
      cancelAnimationFrame(frame);
      if (hoverReveal < 1 || learning) {
        frame = requestAnimationFrame(() => {
          registry.advanceLearningAction(performance.now());
          draw();
        });
      }
    };

    // React's onWheel is passive, so preventDefault (no page scroll) needs a native listener.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      registry.zoomCanvasAction(Math.exp(-event.deltaY * 0.0015), {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    };

    const dispose = effect(draw);
    const observer = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      registry.resizeCanvasAction({ width: rect.width, height: rect.height });
      draw();
    });
    observer.observe(canvas);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(frame);
      dispose();
      observer.disconnect();
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [store, registry]);

  const nodeAt = (event: MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const viewport = createViewport(rect.width, rect.height, store.viewState.camera.peek());

    return hitTest(viewport, point);
  };

  return (
    <canvas
      ref={canvasRef}
      className="snowflake"
      aria-label="Снежинка технологий"
      onMouseDown={(event) => {
        dragRef.current = { lastX: event.clientX, lastY: event.clientY, moved: 0 };
      }}
      onMouseMove={(event) => {
        const drag = dragRef.current;
        if (drag && event.buttons === 1) {
          const dx = event.clientX - drag.lastX;
          const dy = event.clientY - drag.lastY;
          drag.lastX = event.clientX;
          drag.lastY = event.clientY;
          drag.moved += Math.abs(dx) + Math.abs(dy);
          registry.panCanvasAction(dx, dy);
          event.currentTarget.style.cursor = "grabbing";

          return;
        }

        const id = nodeAt(event);
        registry.hoverTechAction(id);
        event.currentTarget.style.cursor = id ? "pointer" : "grab";
      }}
      onMouseUp={(event) => {
        const drag = dragRef.current;
        dragRef.current = null;
        if (drag && drag.moved > DRAG_THRESHOLD) {
          event.currentTarget.style.cursor = "grab";

          return;
        }

        // A click on a node selects it; a click on empty paper closes the popup.
        registry.selectTechAction(nodeAt(event));
      }}
      onMouseLeave={() => {
        dragRef.current = null;
        registry.hoverTechAction(null);
      }}
    />
  );
};

export { TechCanvas };
