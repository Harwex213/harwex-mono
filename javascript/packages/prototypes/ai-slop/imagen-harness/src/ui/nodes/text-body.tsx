import type { TextNode } from "../../../shared/types.js";
import { patchNode } from "../../state/graph-state.js";

function TextBody({ node }: { node: TextNode }): React.JSX.Element {
  return (
    <div className="node__body">
      <textarea
        className="node__text"
        value={node.text}
        placeholder="Write what the picture should show…"
        spellCheck={false}
        onChange={(event) => {
          patchNode(node.id, { text: event.target.value });
        }}
      />
    </div>
  );
}

export { TextBody };
