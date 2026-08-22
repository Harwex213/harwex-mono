import { useState } from "react";
import { imageUrl } from "../api/client.ts";
import { ancestorChain } from "../state/layout.ts";
import { useHarness } from "../state/harness.tsx";
import { formatBytes } from "./composer.tsx";
import { Markdown } from "./markdown.tsx";

/** Right-hand reader: the full answer plus what the harness actually sent. */
function Inspector() {
  const { state, select } = useHarness();
  const [showSentPrompt, setShowSentPrompt] = useState(false);
  const node = state.nodes.find((candidate) => {
    return candidate.id === state.selectedId;
  });

  if (!node) {
    return (
      <aside className="inspector inspector--empty">
        <p>Select a card to read its full answer and the prompt the harness built.</p>
      </aside>
    );
  }

  const chain = ancestorChain(state.nodes, node.id);

  return (
    <aside className="inspector">
      <nav className="inspector__path">
        {chain.map((ancestor) => {
          return (
            <button
              className="inspector__crumb"
              key={ancestor.id}
              type="button"
              onClick={() => {
                select(ancestor.id);
              }}
            >
              {ancestor.prompt.trim().split("\n")[0] || "Untitled"}
            </button>
          );
        })}
        <span className="inspector__crumb inspector__crumb--current">
          {node.prompt.trim().split("\n")[0] || "New question"}
        </span>
      </nav>

      <section className="inspector__block">
        <h2>Question</h2>
        <p className="inspector__prompt">{node.prompt || "(empty)"}</p>
        {node.images.length > 0 ? (
          <ul className="inspector__images">
            {node.images.map((image) => {
              return (
                <li key={image.id}>
                  <a href={imageUrl(image.id)} rel="noreferrer" target="_blank">
                    <img src={imageUrl(image.id)} alt={image.name} />
                  </a>
                  <span>
                    {image.name} · {formatBytes(image.bytes)}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      <section className="inspector__block">
        <h2>Answer</h2>
        {node.answer.trim().length > 0 ? (
          <Markdown text={node.answer} />
        ) : (
          <p className="inspector__muted">No answer yet.</p>
        )}
      </section>

      {node.thinking.trim().length > 0 ? (
        <section className="inspector__block">
          <h2>Reasoning</h2>
          <Markdown text={node.thinking} />
        </section>
      ) : null}

      <section className="inspector__block">
        <h2>Harness</h2>
        <dl className="inspector__facts">
          <dt>Context</dt>
          <dd>{node.contextUsed ?? "not sent yet"}</dd>
          <dt>Requested mode</dt>
          <dd>{node.contextMode}</dd>
          <dt>Session</dt>
          <dd className="inspector__mono">{node.sessionId ?? "—"}</dd>
          <dt>Depth</dt>
          <dd>{chain.length}</dd>
          {node.usage !== null ? (
            <>
              <dt>Model</dt>
              <dd>{node.usage.model}</dd>
              <dt>Tokens</dt>
              <dd>
                {node.usage.inputTokens.toLocaleString()} in ·{" "}
                {node.usage.outputTokens.toLocaleString()} out ·{" "}
                {node.usage.cacheReadTokens.toLocaleString()} cached
              </dd>
              <dt>Cost</dt>
              <dd>${node.usage.costUsd.toFixed(4)}</dd>
              <dt>Duration</dt>
              <dd>{(node.usage.durationMs / 1000).toFixed(1)} s</dd>
            </>
          ) : null}
        </dl>
        {node.toolCalls.length > 0 ? (
          <ul className="inspector__tools">
            {node.toolCalls.map((call) => {
              return (
                <li key={call.id}>
                  <strong>{call.name}</strong> {call.summary}
                </li>
              );
            })}
          </ul>
        ) : null}
        {node.sentPrompt !== null ? (
          <>
            <button
              className="button button--ghost"
              type="button"
              onClick={() => {
                setShowSentPrompt((shown) => {
                  return !shown;
                });
              }}
            >
              {showSentPrompt ? "Hide sent prompt" : "Show sent prompt"}
            </button>
            {showSentPrompt ? <pre className="inspector__sent">{node.sentPrompt}</pre> : null}
          </>
        ) : null}
      </section>
    </aside>
  );
}

export { Inspector };
