import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef } from "react";
import type { GraphNode } from "../../shared/types.js";
import { canConnect, moveNode, nodeById, NODE_WIDTH, selectedId } from "../state/graph-state.js";
import { linkDraft } from "../state/linking.js";
import { measureNode, viewport } from "../state/viewport.js";
import { ImageBody } from "./nodes/image-body.js";
import { ImageGeneratorBody } from "./nodes/image-generator-body.js";
import { PromptBody } from "./nodes/prompt-body.js";
import { PromptGeneratorBody } from "./nodes/prompt-generator-body.js";
import { TextBody } from "./nodes/text-body.js";

const TITLES: Record<GraphNode["kind"], string> = {
  text: "text",
  "prompt-generator": "image prompt generator",
  prompt: "image prompt",
  "image-generator": "image generator",
  image: "image",
};

/** Pointing at a field, a button or a socket means the gesture is not a drag. */
const NO_DRAG = "textarea, input, select, button, .socket, .node__scroll";

interface NodeCardProps {
  node: GraphNode;
  onStartLink: (fromId: string, event: React.PointerEvent) => void;
}

function NodeCard({ node, onStartLink }: NodeCardProps): React.JSX.Element {
  useSignals();
  const hostRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; nodeX: number; nodeY: number } | null>(null);

  useEffect(() => {
    const element = hostRef.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(() => {
      measureNode(node.id, {
        width: element.offsetWidth,
        height: element.offsetHeight,
      });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [node.id]);

  const onPointerDown = (event: React.PointerEvent) => {
    selectedId.value = node.id;
    if (event.button !== 0 || (event.target as HTMLElement).closest(NO_DRAG)) {
      return;
    }
    event.stopPropagation();
    drag.current = { x: event.clientX, y: event.clientY, nodeX: node.x, nodeY: node.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const started = drag.current;
    if (!started) {
      return;
    }
    const scale = viewport.value.scale;
    moveNode(
      node.id,
      started.nodeX + (event.clientX - started.x) / scale,
      started.nodeY + (event.clientY - started.y) / scale,
    );
  };

  const onPointerUp = (event: React.PointerEvent) => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const selected = selectedId.value === node.id;
  const linkable = node.kind === "text" || node.kind === "prompt" || node.kind === "image";
  const draft = linkDraft.value;
  const source = draft ? nodeById(draft.fromId) : null;
  // A wire is being drawn and this input is one it could land on.
  const wanted = Boolean(source && canConnect(source, node));

  return (
    <div
      ref={hostRef}
      data-node-id={node.id}
      className={`node node--${node.kind}${selected ? " node--selected" : ""}`}
      style={{ left: node.x, top: node.y, width: NODE_WIDTH[node.kind] }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {node.kind === "text" ? null : (
        <span
          className={wanted ? "socket socket--in socket--target" : "socket socket--in"}
          data-socket-node={node.id}
          data-socket-side="in"
          title="Drop a wire here"
        />
      )}
      <span
        className={linkable ? "socket socket--out socket--live" : "socket socket--out"}
        data-socket-node={node.id}
        data-socket-side="out"
        title={linkable ? "Drag a wire from here" : "The generator wires this one itself"}
        onPointerDown={(event) => {
          if (linkable) {
            onStartLink(node.id, event);
          }
        }}
      />
      <div className="node__head">{TITLES[node.kind]}</div>
      <Body node={node} />
    </div>
  );
}

function Body({ node }: { node: GraphNode }): React.JSX.Element {
  if (node.kind === "text") {
    return <TextBody node={node} />;
  }
  if (node.kind === "prompt-generator") {
    return <PromptGeneratorBody node={node} />;
  }
  if (node.kind === "prompt") {
    return <PromptBody node={node} />;
  }
  if (node.kind === "image-generator") {
    return <ImageGeneratorBody node={node} />;
  }
  return <ImageBody node={node} />;
}

export { NodeCard };
