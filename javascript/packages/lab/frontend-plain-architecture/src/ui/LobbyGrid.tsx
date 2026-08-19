import { useSignals } from "@preact/signals-react/runtime";
import { SORT_LABELS, categoryLabel } from "../model/lobby";
import { TableCard } from "./TableCard";
import { useRegistry, useStore } from "./context";

function LobbyGrid() {
  useSignals();
  const store = useStore();
  const registry = useRegistry();
  const tables = store.visibleTables.value;
  const filters = store.filters.value;

  return (
    <main className="lc-panel">
      <div className="lc-lobby__head">
        <h1 className="lc-lobby__title">{categoryLabel(filters.category)}</h1>
        <span className="lc-lobby__count" data-testid="result-count">
          {tables.length} tables
        </span>
        <span className="lc-lobby__sort">{SORT_LABELS[filters.sort]}</span>
      </div>
      <div className="lc-panel__scroll">
        {tables.length === 0 ? (
          <div className="lc-empty" data-testid="empty-state">
            <span className="lc-empty__title">No table matches these filters</span>
            <span>Widen the search, or drop a provider from the selection.</span>
            <button
              type="button"
              className="lc-button"
              data-testid="empty-reset"
              onClick={() => registry.resetFilters()}
            >
              Reset filters
            </button>
          </div>
        ) : (
          <div className="lc-grid">
            {tables.map((table) => (
              <TableCard key={table.id} table={table} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

export { LobbyGrid };
