import { useSignals } from "@preact/signals-react/runtime";
import { agentLabel } from "../../shared/agents.js";
import type { TabState } from "../../shared/types.js";
import { clearChat, closeChat } from "../state/store.js";

/** Big numbers read better short: 812, 4.3k, 1.2M. */
function formatTokens(tokens: number): string {
  if (tokens < 1000) {
    return String(tokens);
  }
  if (tokens < 1_000_000) {
    return `${(tokens / 1000).toFixed(tokens < 10_000 ? 1 : 0)}k`;
  }
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

/**
 * The bar above the conversation: which agent is building this model, what it
 * has spent so far, and the two ways out — **Clear** starts the session over
 * on the same agent, **Close** ends the conversation and hands the choice of
 * agent back.
 */
function ChatHeader({ state }: { state: TabState }): React.JSX.Element {
  useSignals();
  const tabId = state.tab.id;
  const started = state.conversationStarted;
  return (
    <header className="chat__header">
      <span className="chat__agent">{agentLabel(state.tab.agentKind)}</span>
      {started ? (
        <span
          className="chat__tokens"
          title={
            `${state.tokensUsed.toLocaleString()} tokens read for the first time in this conversation.\n` +
            `${state.tokensCached.toLocaleString()} more were re-read from the prompt cache: every tool call ` +
            `sends the whole prompt again, and that part bills at a fraction of the price.`
          }
        >
          {formatTokens(state.tokensUsed)} tokens
        </span>
      ) : null}
      <span className="chat__spacer" />
      {started ? (
        <button
          type="button"
          className="button button--small"
          title="Start a clean session with the same agent"
          disabled={state.running}
          onClick={() => {
            void clearChat(tabId);
          }}
        >
          Clear
        </button>
      ) : null}
      <button
        type="button"
        className="button button--small"
        title="End the conversation and choose an agent again"
        disabled={state.running}
        onClick={() => {
          void closeChat(tabId);
        }}
      >
        Close
      </button>
    </header>
  );
}

export { ChatHeader };
