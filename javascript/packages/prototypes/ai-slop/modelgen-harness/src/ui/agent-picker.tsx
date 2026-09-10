import { useSignals } from "@preact/signals-react/runtime";
import { AGENTS } from "../../shared/agents.js";
import { setTabAgentKind } from "../state/store.js";

/**
 * The Clear state of the right panel: no conversation yet, so the one thing to
 * settle is who builds the model. The choice is fixed from the first message
 * on — the agent holds the session that remembers what it built — and comes
 * back only when the conversation is closed.
 */
function AgentPicker({ tabId }: { tabId: string }): React.JSX.Element {
  useSignals();
  return (
    <div className="agent-picker">
      <h3>Choose an agent</h3>
      <div className="agent-picker__options">
        {AGENTS.map((agent) => {
          return (
            <button
              key={agent.kind}
              type="button"
              className="agent-option"
              onClick={() => {
                void setTabAgentKind(tabId, agent.kind);
              }}
            >
              <span className="agent-option__name">{agent.label}</span>
              <span className="agent-option__hint">{agent.hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { AgentPicker };
