import { resources, type ResourceKind } from "@hw/colony-sim-v1-core";
import { RESOURCE_ICONS } from "./resource-icons";

// Amount first, icon second, right-aligned — the icons line up into a column and
// the digits grow leftwards into empty space. The icon carries the meaning, so the
// name only reaches the tooltip and assistive tech.
const ROWS: readonly ResourceKind[] = ["wood", "stone", "food"];

// What the colony owns is what its warehouses hold, so an empty readout is not a
// bug — it is a colony with nowhere to put anything yet.
function ResourcesPanel() {
  const stock = resources.value;

  return (
    <div className="panel resources">
      <div className="panel-title">Resources</div>
      <ul className="resource-list">
        {ROWS.map((kind) => {
          return (
            <li className="resource" key={kind} title={kind} aria-label={`${kind} ${stock[kind]}`}>
              <span className="resource-amount">{stock[kind]}</span>
              <span className="resource-icon" aria-hidden="true">
                {RESOURCE_ICONS[kind]}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export { ResourcesPanel };
