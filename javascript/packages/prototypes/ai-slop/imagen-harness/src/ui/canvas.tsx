import { signal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef } from "react";
import type { NodeKind } from "../../shared/types.js";
import {
  addNode,
  connect,
  copyNode,
  deleteNode,
  nodes,
  pasteImage,
  selectedId,
  setNotice,
} from "../state/graph-state.js";
import { contentInView, fitContent } from "../state/framing.js";
import { linkDraft } from "../state/linking.js";
import {
  panBy,
  setCanvasSize,
  setScale,
  toWorld,
  viewport,
  zoomAt,
} from "../state/viewport.js";
import { EdgesLayer } from "./edges-layer.js";
import { Minimap } from "./minimap.js";
import { NodeCard } from "./node-card.js";

interface MenuState {
  screenX: number;
  screenY: number;
  worldX: number;
  worldY: number;
  nodeId: string | null;
}

const menu = signal<MenuState | null>(null);

/** Everything that sits on the canvas and answers a press itself. */
const NOT_THE_CANVAS =
  "[data-node-id], .zoom-bar, .lost, .minimap, button, input, select, textarea";

function canvasBox(): DOMRect | null {
  return document.querySelector(".canvas")?.getBoundingClientRect() ?? null;
}

/**
 * Draws a wire from an output socket until the pointer is let go. It only lands
 * on an input socket: a drop anywhere else, a card included, wires nothing.
 */
function startLink(fromId: string, event: React.PointerEvent): void {
  const box = canvasBox();
  if (!box) {
    return;
  }
  event.stopPropagation();
  event.preventDefault();
  const at = toWorld(event.clientX, event.clientY, box);
  linkDraft.value = { fromId, x: at.x, y: at.y };

  const onMove = (moveEvent: PointerEvent) => {
    const point = toWorld(moveEvent.clientX, moveEvent.clientY, box);
    linkDraft.value = { fromId, x: point.x, y: point.y };
  };
  const onUp = (upEvent: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    linkDraft.value = null;
    const element = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
    const socket = element?.closest("[data-socket-side]");
    if (socket?.getAttribute("data-socket-side") !== "in") {
      return;
    }
    const toId = socket.getAttribute("data-socket-node");
    if (toId) {
      connect(fromId, toId);
    }
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function Canvas(): React.JSX.Element {
  useSignals();
  const hostRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pan = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const pinch = useRef<{ distance: number; x: number; y: number } | null>(null);
  const view = viewport.value;

  useEffect(() => {
    const element = hostRef.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(() => {
      setCanvasSize({ width: element.clientWidth, height: element.clientHeight });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const onPointerDown = (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest(".menu")) {
      return;
    }
    // A press anywhere else puts the menu away, including one on a node.
    menu.value = null;
    // A card or a control on top of the canvas handles its own press. Panning
    // from here would capture the pointer and the click would never arrive.
    if ((event.target as HTMLElement).closest(NOT_THE_CANVAS)) {
      return;
    }
    // Only the left button pans. Capturing the right one would retarget the
    // context menu that follows it to the canvas, and a wire would never see it.
    if (event.button !== 0) {
      return;
    }
    selectedId.value = null;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) {
      pan.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      return;
    }
    // A second finger turns the gesture into a pinch, so the pan stops here.
    pan.current = null;
    pinch.current = null;
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const tracked = pointers.current.get(event.pointerId);
    if (!tracked) {
      return;
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size >= 2) {
      const [first, second] = [...pointers.current.values()];
      if (!first || !second) {
        return;
      }
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      const midX = (first.x + second.x) / 2;
      const midY = (first.y + second.y) / 2;
      const box = canvasBox();
      const previous = pinch.current;
      if (previous && box && previous.distance > 0) {
        zoomAt(midX, midY, distance / previous.distance, box);
        panBy(midX - previous.x, midY - previous.y);
      }
      pinch.current = { distance, x: midX, y: midY };
      return;
    }

    const panning = pan.current;
    if (panning && panning.pointerId === event.pointerId) {
      panBy(event.clientX - panning.x, event.clientY - panning.y);
      pan.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    }
  };

  const endPointer = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) {
      pinch.current = null;
    }
    if (pan.current?.pointerId === event.pointerId) {
      pan.current = null;
    }
  };

  const onWheel = (event: React.WheelEvent) => {
    const box = canvasBox();
    if (!box) {
      return;
    }
    // A trackpad pinch reaches the page as a wheel with ctrl held, on every platform.
    if (event.ctrlKey || event.metaKey) {
      zoomAt(event.clientX, event.clientY, Math.exp(-event.deltaY * 0.01), box);
      return;
    }
    panBy(-event.deltaX, -event.deltaY);
  };

  const onContextMenu = (event: React.MouseEvent) => {
    const box = canvasBox();
    if (!box) {
      return;
    }
    event.preventDefault();
    const card = (event.target as HTMLElement).closest("[data-node-id]");
    const at = toWorld(event.clientX, event.clientY, box);
    menu.value = {
      screenX: event.clientX - box.left,
      screenY: event.clientY - box.top,
      worldX: at.x,
      worldY: at.y,
      nodeId: card?.getAttribute("data-node-id") ?? null,
    };
  };

  return (
    <div
      ref={hostRef}
      className={linkDraft.value ? "canvas canvas--linking" : "canvas"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onWheel={onWheel}
      onContextMenu={onContextMenu}
    >
      <div
        className="world"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        <EdgesLayer />
        {nodes.value.map((node) => {
          return <NodeCard key={node.id} node={node} onStartLink={startLink} />;
        })}
      </div>
      <ZoomBar />
      <Minimap />
      {contentInView.value ? null : <Lost />}
      {menu.value ? <Menu state={menu.value} /> : null}
    </div>
  );
}

/**
 * The way back when the canvas has been dragged off past every card. It is the
 * only thing on screen at that point, so it says what happened as well as
 * offering the fix.
 */
function Lost(): React.JSX.Element {
  return (
    <div className="lost">
      <p className="lost__line">Nothing is in view.</p>
      <button type="button" className="lost__button" onClick={fitContent}>
        Return to content
      </button>
    </div>
  );
}

function ZoomBar(): React.JSX.Element {
  useSignals();
  const step = (factor: number) => {
    const box = canvasBox();
    if (box) {
      setScale(viewport.value.scale * factor, box);
    }
  };
  return (
    <div className="zoom-bar">
      <button type="button" onClick={() => step(0.8)} title="Zoom out">
        −
      </button>
      <span>{Math.round(viewport.value.scale * 100)}%</span>
      <button type="button" onClick={() => step(1.25)} title="Zoom in">
        +
      </button>
      <button
        type="button"
        onClick={() => {
          viewport.value = { x: 0, y: 0, scale: 1 };
        }}
        title="Back to 100% at the origin"
      >
        reset
      </button>
      <button type="button" onClick={fitContent} title="Frame every node (Cmd/Ctrl + 1)">
        fit
      </button>
    </div>
  );
}

function Menu({ state }: { state: MenuState }): React.JSX.Element {
  const create = (kind: NodeKind) => {
    addNode(kind, state.worldX, state.worldY);
    menu.value = null;
  };

  if (state.nodeId) {
    const nodeId = state.nodeId;
    return (
      <div className="menu" style={{ left: state.screenX, top: state.screenY }}>
        <button
          type="button"
          onClick={() => {
            void copyNode(nodeId);
            menu.value = null;
          }}
        >
          Copy content
        </button>
        <button
          type="button"
          className="menu__danger"
          onClick={() => {
            void deleteNode(nodeId);
            menu.value = null;
          }}
        >
          Delete node
        </button>
      </div>
    );
  }

  return (
    <div className="menu" style={{ left: state.screenX, top: state.screenY }}>
      <button type="button" onClick={() => create("text")}>
        Text node
      </button>
      <button type="button" onClick={() => create("prompt-generator")}>
        Image prompt generator node
      </button>
      <button type="button" onClick={() => create("image-generator")}>
        Image generator node
      </button>
      <button
        type="button"
        onClick={() => {
          void pasteImage(state.worldX, state.worldY).then((pasted) => {
            if (!pasted) {
              setNotice("There is no image on the clipboard.");
            }
          });
          menu.value = null;
        }}
      >
        Paste image as a node
      </button>
    </div>
  );
}

export { Canvas };
