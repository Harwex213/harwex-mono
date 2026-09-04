import { useSignals } from "@preact/signals-react/runtime";
import { runOf } from "../../state/graph-state.js";

/** What the generator is doing, or what went wrong the last time it ran. */
function RunBadge({ generatorId }: { generatorId: string }): React.JSX.Element | null {
  useSignals();
  const run = runOf(generatorId);
  if (run.status === "idle" || run.status === "done") {
    return null;
  }
  return (
    <p className={`run run--${run.status}`} title={run.note}>
      {run.status === "running" ? "● " : "▲ "}
      {run.note}
    </p>
  );
}

export { RunBadge };
