import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { LearnNode } from "../../shared/types.ts";
import { imageUrl } from "../api/client.ts";
import { useHarness } from "../state/harness.tsx";
import { Composer } from "./composer.tsx";
import { Markdown } from "./markdown.tsx";

const CONTEXT_LABEL: Record<string, string> = {
  root: "root",
  fork: "forked session",
  rebuild: "rebuilt transcript",
};

const STATUS_LABEL: Record<LearnNode["status"], string> = {
  draft: "draft",
  streaming: "answering",
  done: "answered",
  error: "failed",
  cancelled: "stopped",
};

type NodeCardProps = {
  node: LearnNode;
  depth: number;
  scale: number;
  selected: boolean;
  /** Reports the rendered height so the canvas can draw edges to real anchors. */
  onMeasure: (nodeId: string, height: number) => void;
};

function firstLine(text: string): string {
  const line = text.trim().split("\n")[0] ?? "";
  if (line.length <= 90) {
    return line;
  }
  return `${line.slice(0, 89)}…`;
}

function NodeCard({ node, depth, scale, selected, onMeasure }: NodeCardProps) {
  const root = useRef<HTMLElement | null>(null);
  const { createBranch, submit, cancel, remove, select, move, dispatch } = useHarness();
  const [showThinking, setShowThinking] = useState(false);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);

  useEffect(() => {
    const element = root.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(() => {
      onMeasure(node.id, element.offsetHeight);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [node.id, onMeasure]);

  const onHeaderPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest("button")) {
      return;
    }
    event.stopPropagation();
    select(node.id);
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: node.x,
      originY: node.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onHeaderPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) {
      return;
    }
    move(
      node.id,
      active.originX + (event.clientX - active.startX) / scale,
      active.originY + (event.clientY - active.startY) / scale,
    );
  };

  const onHeaderPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId === event.pointerId) {
      drag.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const isDraft = node.status === "draft";
  const isStreaming = node.status === "streaming";
  const classes = ["card", `card--${node.status}`];
  if (selected) {
    classes.push("card--selected");
  }
  if (node.collapsed) {
    classes.push("card--collapsed");
  }

  return (
    <article
      ref={root}
      className={classes.join(" ")}
      style={{ left: `${node.x}px`, top: `${node.y}px` }}
      onPointerDown={() => {
        select(node.id);
      }}
    >
      <header
        className="card__header"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
      >
        <span className={`card__status card__status--${node.status}`} />
        <span className="card__depth">L{depth}</span>
        <span className="card__title">
          {node.prompt.trim().length > 0 ? firstLine(node.prompt) : "New question"}
        </span>
        <button
          className="card__icon"
          type="button"
          title={node.collapsed ? "Expand" : "Collapse"}
          onClick={() => {
            dispatch({ type: "node/collapseToggled", id: node.id });
          }}
        >
          {node.collapsed ? "▸" : "▾"}
        </button>
        <button
          className="card__icon"
          type="button"
          title="Delete this card and everything under it"
          onClick={() => {
            remove(node.id);
          }}
        >
          ✕
        </button>
      </header>

      {node.collapsed ? null : (
        <div className="card__body">
          {isDraft ? (
            <Composer
              nodeId={node.id}
              prompt={node.prompt}
              images={node.images}
              placeholder={
                node.parentId === null
                  ? "What do you want to learn? Paste text or images."
                  : "What do you want to dig into from the answer above?"
              }
              submitLabel="Ask"
              autoFocus={selected}
            />
          ) : (
            <>
              <div className="card__prompt">
                <span className="card__prompt-label">Question</span>
                <p>{node.prompt}</p>
                {node.images.length > 0 ? (
                  <ul className="card__thumbs">
                    {node.images.map((image) => {
                      return (
                        <li key={image.id}>
                          <img src={imageUrl(image.id)} alt={image.name} />
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>

              {node.thinking.trim().length > 0 ? (
                <div className="card__thinking">
                  <button
                    className="card__thinking-toggle"
                    type="button"
                    onClick={() => {
                      setShowThinking((shown) => {
                        return !shown;
                      });
                    }}
                  >
                    {showThinking ? "Hide reasoning" : "Show reasoning"}
                  </button>
                  {showThinking ? <Markdown text={node.thinking} /> : null}
                </div>
              ) : null}

              {node.toolCalls.length > 0 ? (
                <ul className="card__tools">
                  {node.toolCalls.map((call) => {
                    return (
                      <li key={call.id} title={call.summary}>
                        {call.name}
                        {call.summary.length > 0 ? `: ${call.summary}` : ""}
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              <div className="card__answer">
                <Markdown text={node.answer} />
                {isStreaming && node.answer.length === 0 ? (
                  <p className="card__waiting">Thinking…</p>
                ) : null}
                {isStreaming ? <span className="card__caret" /> : null}
              </div>

              {node.error !== null ? <p className="card__error">{node.error}</p> : null}
            </>
          )}
        </div>
      )}

      {node.collapsed ? null : (
        <footer className="card__footer">
          <span className="card__badge">{STATUS_LABEL[node.status]}</span>
          {node.contextUsed !== null ? (
            <span className="card__badge card__badge--context">
              {CONTEXT_LABEL[node.contextUsed]}
            </span>
          ) : null}
          {node.usage !== null ? (
            <span className="card__badge" title={`${node.usage.model} · ${node.usage.numTurns} turns`}>
              {node.usage.outputTokens.toLocaleString()} out · $
              {node.usage.costUsd.toFixed(3)}
            </span>
          ) : null}
          <span className="card__spacer" />
          {isStreaming ? (
            <button
              className="button button--ghost"
              type="button"
              onClick={() => {
                cancel(node.id);
              }}
            >
              Stop
            </button>
          ) : null}
          {!isDraft && !isStreaming ? (
            <>
              <button
                className="button button--ghost"
                type="button"
                title="Edit the question and ask again"
                onClick={() => {
                  dispatch({ type: "node/patched", id: node.id, patch: { status: "draft" } });
                }}
              >
                Edit
              </button>
              <button
                className="button button--ghost"
                type="button"
                onClick={() => {
                  submit(node.id);
                }}
              >
                Retry
              </button>
            </>
          ) : null}
          {node.status === "done" || node.status === "cancelled" ? (
            <button
              className="button button--primary"
              type="button"
              onClick={() => {
                createBranch(node.id);
              }}
            >
              Branch
            </button>
          ) : null}
        </footer>
      )}
    </article>
  );
}

export { NodeCard };
