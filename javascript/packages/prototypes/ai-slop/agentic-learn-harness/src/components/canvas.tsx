import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { NODE_FALLBACK_HEIGHT, NODE_WIDTH } from "../state/layout.ts";
import { useHarness } from "../state/harness.tsx";
import { Edges } from "./edges.tsx";
import { NodeCard } from "./node-card.tsx";

type View = {
  x: number;
  y: number;
  scale: number;
};

const MIN_SCALE = 0.25;
const MAX_SCALE = 1.6;
const INITIAL_VIEW: View = { x: 80, y: 80, scale: 0.85 };

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

function Canvas() {
  const { state, select, dispatch } = useHarness();
  const [view, setView] = useState<View>(INITIAL_VIEW);
  const heights = state.heights;
  const viewport = useRef<HTMLDivElement | null>(null);
  const pan = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const lastFocused = useRef<string | null>(null);

  const onMeasure = useCallback(
    (nodeId: string, height: number) => {
      dispatch({ type: "node/measured", id: nodeId, height });
    },
    [dispatch],
  );

  const depthOf = useCallback(
    (nodeId: string): number => {
      const byId = new Map(state.nodes.map((node) => {
        return [node.id, node];
      }));
      let depth = 0;
      let current = byId.get(nodeId)?.parentId ?? null;
      while (current !== null && depth < 200) {
        depth += 1;
        current = byId.get(current)?.parentId ?? null;
      }
      return depth;
    },
    [state.nodes],
  );

  // Bring a freshly created or freshly selected card into view.
  useEffect(() => {
    const selected = state.selectedId;
    if (selected === null || selected === lastFocused.current) {
      return;
    }
    lastFocused.current = selected;
    const node = state.nodes.find((candidate) => {
      return candidate.id === selected;
    });
    const box = viewport.current?.getBoundingClientRect();
    if (!node || !box) {
      return;
    }
    setView((current) => {
      const screenX = node.x * current.scale + current.x;
      const screenY = node.y * current.scale + current.y;
      const margin = 40;
      const inside =
        screenX > margin &&
        screenY > margin &&
        screenX + NODE_WIDTH * current.scale < box.width - margin &&
        screenY < box.height - 160;
      if (inside) {
        return current;
      }
      return {
        ...current,
        x: box.width / 2 - (node.x + NODE_WIDTH / 2) * current.scale,
        y: 140 - node.y * current.scale,
      };
    });
  }, [state.selectedId, state.nodes]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    // Capturing the pointer here would swallow the click on anything above the
    // canvas, so cards and the zoom controls opt out of panning.
    if (target.closest(".card, .canvas__controls")) {
      return;
    }
    if (event.button === 0) {
      select(null);
    }
    pan.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = pan.current;
    if (!active || active.pointerId !== event.pointerId) {
      return;
    }
    setView((current) => {
      return {
        ...current,
        x: active.originX + (event.clientX - active.startX),
        y: active.originY + (event.clientY - active.startY),
      };
    });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pan.current?.pointerId === event.pointerId) {
      pan.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  // Focusing a card's textarea makes the browser scroll this overflow-hidden
  // container to reveal it, which silently shifts the whole world out of view.
  // Panning is ours to own, so any scroll is undone immediately.
  useEffect(() => {
    const element = viewport.current;
    if (!element) {
      return;
    }
    const onScroll = () => {
      element.scrollTop = 0;
      element.scrollLeft = 0;
    };
    element.addEventListener("scroll", onScroll);
    return () => {
      element.removeEventListener("scroll", onScroll);
    };
  }, []);

  // React registers `wheel` passively, so preventDefault only works on a
  // listener we attach ourselves.
  useEffect(() => {
    const element = viewport.current;
    if (!element) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        const pointerX = event.clientX - box.left;
        const pointerY = event.clientY - box.top;
        setView((current) => {
          const scale = clampScale(current.scale * Math.exp(-event.deltaY / 240));
          const ratio = scale / current.scale;
          return {
            scale,
            x: pointerX - (pointerX - current.x) * ratio,
            y: pointerY - (pointerY - current.y) * ratio,
          };
        });
        return;
      }
      setView((current) => {
        return { ...current, x: current.x - event.deltaX, y: current.y - event.deltaY };
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", onWheel);
    };
  }, []);

  const fit = () => {
    const box = viewport.current?.getBoundingClientRect();
    if (!box || state.nodes.length === 0) {
      setView(INITIAL_VIEW);
      return;
    }
    const minX = Math.min(...state.nodes.map((node) => {
      return node.x;
    }));
    const maxX = Math.max(...state.nodes.map((node) => {
      return node.x + NODE_WIDTH;
    }));
    const minY = Math.min(...state.nodes.map((node) => {
      return node.y;
    }));
    const maxY = Math.max(...state.nodes.map((node) => {
      return node.y + (heights[node.id] ?? NODE_FALLBACK_HEIGHT);
    }));
    const scale = clampScale(
      Math.min((box.width - 120) / (maxX - minX), (box.height - 120) / (maxY - minY)),
    );
    setView({
      scale,
      x: box.width / 2 - ((minX + maxX) / 2) * scale,
      y: box.height / 2 - ((minY + maxY) / 2) * scale,
    });
  };

  return (
    <div
      className="canvas"
      ref={viewport}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        className="canvas__world"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        <Edges nodes={state.nodes} heights={heights} selectedId={state.selectedId} />
        {state.nodes.map((node) => {
          return (
            <NodeCard
              depth={depthOf(node.id)}
              key={node.id}
              node={node}
              onMeasure={onMeasure}
              scale={view.scale}
              selected={state.selectedId === node.id}
            />
          );
        })}
      </div>

      <div className="canvas__controls">
        <button
          className="button button--ghost"
          type="button"
          onClick={() => {
            setView((current) => {
              return { ...current, scale: clampScale(current.scale - 0.15) };
            });
          }}
        >
          −
        </button>
        <span className="canvas__zoom">{Math.round(view.scale * 100)}%</span>
        <button
          className="button button--ghost"
          type="button"
          onClick={() => {
            setView((current) => {
              return { ...current, scale: clampScale(current.scale + 0.15) };
            });
          }}
        >
          +
        </button>
        <button className="button button--ghost" type="button" onClick={fit}>
          Fit
        </button>
      </div>
    </div>
  );
}

export { Canvas };
