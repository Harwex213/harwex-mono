import { useSignals } from "@preact/signals-react/runtime";
import { disconnect, edges, nodeById } from "../state/graph-state.js";
import { linkDraft } from "../state/linking.js";
import { sizeOf } from "../state/viewport.js";

interface Point {
  x: number;
  y: number;
}

/** A wire leaves an output on the right and arrives at an input on the left. */
function curve(from: Point, to: Point): string {
  const reach = Math.max(60, Math.abs(to.x - from.x) * 0.5);
  return `M ${from.x} ${from.y} C ${from.x + reach} ${from.y}, ${to.x - reach} ${to.y}, ${to.x} ${to.y}`;
}

function outputPoint(id: string): Point | null {
  const node = nodeById(id);
  if (!node) {
    return null;
  }
  const size = sizeOf(id);
  return { x: node.x + size.width, y: node.y + size.height / 2 };
}

function inputPoint(id: string): Point | null {
  const node = nodeById(id);
  if (!node) {
    return null;
  }
  return { x: node.x, y: node.y + sizeOf(id).height / 2 };
}

function EdgesLayer(): React.JSX.Element {
  useSignals();
  const draft = linkDraft.value;
  const from = draft ? outputPoint(draft.fromId) : null;

  return (
    <svg className="edges" width={1} height={1} overflow="visible">
      {edges.value.map((edge) => {
        const start = outputPoint(edge.from);
        const end = inputPoint(edge.to);
        if (!start || !end) {
          return null;
        }
        const owned = nodeById(edge.to)?.kind === "prompt";
        const path = curve(start, end);
        return (
          <g key={edge.id} className={owned ? "edge edge--owned" : "edge"}>
            <path className="edge__line" d={path} />
            <path
              className="edge__hit"
              d={path}
              onContextMenu={(event) => {
                // The canvas menu would open on top of the wire otherwise.
                event.preventDefault();
                event.stopPropagation();
                disconnect(edge.id);
              }}
            >
              <title>{owned ? "This link is fixed" : "Right click to unlink"}</title>
            </path>
          </g>
        );
      })}
      {from && draft ? (
        <path className="edge__preview" d={curve(from, { x: draft.x, y: draft.y })} />
      ) : null}
    </svg>
  );
}

export { EdgesLayer };
