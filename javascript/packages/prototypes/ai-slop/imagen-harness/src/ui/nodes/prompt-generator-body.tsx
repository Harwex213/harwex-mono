import { useSignals } from "@preact/signals-react/runtime";
import type { PromptGeneratorNode } from "../../../shared/types.js";
import { runOf, runPromptGenerator } from "../../state/graph-state.js";
import { RunBadge } from "./run-badge.js";

function PromptGeneratorBody({ node }: { node: PromptGeneratorNode }): React.JSX.Element {
  useSignals();
  const running = runOf(node.id).status === "running";

  return (
    <div className="node__body">
      <button
        type="button"
        className="node__run"
        disabled={running}
        onClick={() => {
          void runPromptGenerator(node.id);
        }}
      >
        {running ? "running…" : node.outputId ? "rerun" : "start"}
      </button>
      <p className="node__hint">
        {node.outputId
          ? "A rerun overwrites the prompt it made."
          : "Wire notes or images in, then run."}
      </p>
      <RunBadge generatorId={node.id} />
    </div>
  );
}

export { PromptGeneratorBody };
