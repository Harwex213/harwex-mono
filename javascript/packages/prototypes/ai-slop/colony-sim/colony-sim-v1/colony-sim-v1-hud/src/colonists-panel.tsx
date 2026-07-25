import { useEngine } from "./engine-context";
import { colonistRoster, colonistsOpen, selection } from "@hw/colony-sim-v1-core";

// What the bottom bar's colonists tab opens. Rows are selection shortcuts: they
// dispatch the same `select` command a canvas click does, so the inspector and the
// on-canvas marker follow the roster for free.
function ColonistsPanel() {
  const engine = useEngine();
  if (!colonistsOpen.value) {
    return null;
  }
  const rows = colonistRoster.value;
  const selected = selection.value;
  const selectedId = selected && selected.kind === "entity" ? selected.id : null;

  return (
    <div className="panel colonists">
      <div className="panel-head">
        <span className="panel-title">Colonists</span>
        <button
          type="button"
          className="panel-close"
          aria-label="close"
          onClick={() => engine.dispatch({ type: "toggleColonists" })}
        >
          ✕
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="panel-empty">no colonists</div>
      ) : (
        <ul className="roster">
          {rows.map((row) => {
            return (
              <li key={row.id}>
                <button
                  type="button"
                  className={row.id === selectedId ? "roster-row active" : "roster-row"}
                  title={`hunger ${row.hunger} · fatigue ${row.fatigue}`}
                  onClick={() => engine.dispatch({ type: "select", selection: { kind: "entity", id: row.id } })}
                >
                  <span className="roster-name">{row.title}</span>
                  <span className="roster-job">{row.job}</span>
                  <span className="roster-needs">
                    {row.hunger} / {row.fatigue}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export { ColonistsPanel };
