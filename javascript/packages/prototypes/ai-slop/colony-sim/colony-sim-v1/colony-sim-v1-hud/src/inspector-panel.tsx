import { useEngine } from "./engine-context";
import { selectionDetails } from "@hw/colony-sim-v1-core";

// Details of whatever is selected. Sits at the opposite end of the bottom bar from
// the colonists panel, so the two can be open at once without overlapping.
function InspectorPanel() {
  const engine = useEngine();
  const details = selectionDetails.value;
  if (!details) {
    return null;
  }

  return (
    <div className="panel inspector">
      <div className="panel-head">
        <span className="panel-title">{details.title}</span>
        <button
          type="button"
          className="panel-close"
          aria-label="close"
          onClick={() => engine.dispatch({ type: "select", selection: null })}
        >
          ✕
        </button>
      </div>
      {details.rows.map(([label, value]) => {
        return (
          <div className="detail-row" key={label}>
            <span className="detail-label">{label}</span>
            <span>{value}</span>
          </div>
        );
      })}
    </div>
  );
}

export { InspectorPanel };
