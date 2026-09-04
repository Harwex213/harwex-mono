import { useSignals } from "@preact/signals-react/runtime";
import type { ImageGeneratorNode } from "../../../shared/types.js";
import { IMAGE_DIMENSIONS, IMAGE_MODELS } from "../../../shared/types.js";
import { runImageGenerator, runOf, setDimensions, setModel } from "../../state/graph-state.js";
import { RunBadge } from "./run-badge.js";

function ImageGeneratorBody({ node }: { node: ImageGeneratorNode }): React.JSX.Element {
  useSignals();
  const running = runOf(node.id).status === "running";

  return (
    <div className="node__body">
      <label className="node__field">
        model
        <select
          value={node.model}
          onChange={(event) => {
            setModel(node.id, event.target.value);
          }}
        >
          {IMAGE_MODELS.map((model) => {
            return (
              <option key={model} value={model}>
                {model}
              </option>
            );
          })}
        </select>
      </label>
      <label className="node__field">
        size
        <select
          value={node.dimensions}
          onChange={(event) => {
            setDimensions(node.id, event.target.value);
          }}
        >
          {IMAGE_DIMENSIONS.map((size) => {
            return (
              <option key={size} value={size}>
                {size}
              </option>
            );
          })}
        </select>
      </label>
      <button
        type="button"
        className="node__run"
        disabled={running}
        onClick={() => {
          void runImageGenerator(node.id);
        }}
      >
        {running ? "running…" : "start"}
      </button>
      <p className="node__hint">Every run adds an image node of its own.</p>
      <RunBadge generatorId={node.id} />
    </div>
  );
}

export { ImageGeneratorBody };
