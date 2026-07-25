import type { ResourceKind } from "../sim/components";
import { resources } from "./signals";

// Amount first, icon second, right-aligned — the icons line up into a column and
// the digits grow leftwards into empty space. The icon carries the meaning, so the
// name only reaches the tooltip and assistive tech.
const ROWS: readonly { kind: ResourceKind; icon: string; label: string }[] = [
  { kind: "wood", icon: "🪵", label: "wood" },
  { kind: "stone", icon: "🪨", label: "stone" },
  { kind: "food", icon: "🍗", label: "food" },
];

function ResourcesPanel() {
  const stock = resources.value;

  return (
    <div className="panel resources">
      <div className="panel-title">Resources</div>
      <ul className="resource-list">
        {ROWS.map((row) => {
          return (
            <li className="resource" key={row.kind} title={row.label} aria-label={`${row.label} ${stock[row.kind]}`}>
              <span className="resource-amount">{stock[row.kind]}</span>
              <span className="resource-icon" aria-hidden="true">
                {row.icon}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export { ResourcesPanel };
