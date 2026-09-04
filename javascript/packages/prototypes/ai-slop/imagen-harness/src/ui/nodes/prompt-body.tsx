import { useSignals } from "@preact/signals-react/runtime";
import type { PromptNode } from "../../../shared/types.js";
import { patchNode, promptTexts } from "../../state/graph-state.js";

const PREVIEW_LENGTH = 180;

function PromptBody({ node }: { node: PromptNode }): React.JSX.Element {
  useSignals();
  const text = promptTexts.value[node.id] ?? "";
  const long = text.length > PREVIEW_LENGTH;
  const shown = node.expanded || !long ? text : `${text.slice(0, PREVIEW_LENGTH).trimEnd()}…`;

  return (
    <div className="node__body">
      {text.length > 0 ? (
        <p className="node__prompt">{shown}</p>
      ) : (
        <p className="node__hint">The generator has not written this one yet.</p>
      )}
      {long ? (
        <button
          type="button"
          className="node__more"
          onClick={() => {
            patchNode(node.id, { expanded: !node.expanded });
          }}
        >
          {node.expanded ? "show less" : "show more"}
        </button>
      ) : null}
    </div>
  );
}

export { PromptBody };
