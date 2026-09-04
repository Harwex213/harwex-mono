import { useSignals } from "@preact/signals-react/runtime";
import type { ImageNode } from "../../../shared/types.js";
import { imageUrl } from "../../state/bridge.js";
import { activeTab, imageStamps } from "../../state/graph-state.js";

function ImageBody({ node }: { node: ImageNode }): React.JSX.Element {
  useSignals();
  const tab = activeTab.value;
  if (!tab) {
    return <div className="node__body" />;
  }
  const stamp = imageStamps.value[node.id] ?? 0;

  return (
    <div className="node__body">
      <img className="node__image" src={imageUrl(tab.dir, node.id, stamp)} alt={node.caption} />
      {node.caption.length > 0 ? <p className="node__hint">{node.caption}</p> : null}
    </div>
  );
}

export { ImageBody };
