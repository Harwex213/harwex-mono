import type { CSSProperties } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import { CATEGORY_ORDER, SORT_LABELS, categoryLabel } from "../model/lobby";
import type { SortKey } from "../model/types";
import { useRegistry, useStore } from "./context";

const SORT_KEYS: readonly SortKey[] = ["popularity", "min-bet", "name"];

function FiltersPanel() {
  useSignals();
  const store = useStore();
  const registry = useRegistry();
  const filters = store.filters.value;
  const counts = store.categoryCounts.value;

  return (
    <aside className="lc-panel">
      <div className="lc-panel__scroll">
        <div className="lc-filters__group">
          <h2 className="lc-filters__title">Search</h2>
          <input
            className="lc-search"
            type="search"
            placeholder="Table or dealer…"
            aria-label="Search tables"
            data-testid="search"
            value={filters.query}
            onChange={(event) => registry.setQuery(event.target.value)}
          />
        </div>

        <div className="lc-filters__group">
          <h2 className="lc-filters__title">Category</h2>
          <div className="lc-tabs">
            {CATEGORY_ORDER.map((category) => (
              <button
                key={category}
                type="button"
                className={category === filters.category ? "lc-tab lc-tab--active" : "lc-tab"}
                data-testid={`category-${category}`}
                onClick={() => registry.setCategory(category)}
              >
                <span>{categoryLabel(category)}</span>
                <span className="lc-tab__count">{counts.get(category) ?? 0}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="lc-filters__group">
          <h2 className="lc-filters__title">Providers</h2>
          <div className="lc-chips">
            {store.providerFacets.value.map((facet) => {
              const active = filters.providerIds.includes(facet.provider.id);
              return (
                <button
                  key={facet.provider.id}
                  type="button"
                  className={active ? "lc-chip lc-chip--active" : "lc-chip"}
                  style={{ "--chip-accent": facet.provider.accent } as CSSProperties}
                  data-testid={`provider-${facet.provider.id}`}
                  onClick={() => registry.toggleProvider(facet.provider.id)}
                >
                  <span className="lc-chip__dot" />
                  {facet.provider.name}
                  <span className="lc-tab__count">{facet.available}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="lc-filters__group">
          <h2 className="lc-filters__title">Sort by</h2>
          <select
            className="lc-select"
            aria-label="Sort tables"
            data-testid="sort"
            value={filters.sort}
            onChange={(event) => registry.setSort(event.target.value as SortKey)}
          >
            {SORT_KEYS.map((key) => (
              <option key={key} value={key}>
                {SORT_LABELS[key]}
              </option>
            ))}
          </select>
        </div>

        <div className="lc-filters__group">
          <h2 className="lc-filters__title">Show only</h2>
          <button
            type="button"
            className={filters.onlyAvailable ? "lc-switch lc-switch--on" : "lc-switch"}
            aria-pressed={filters.onlyAvailable}
            data-testid="toggle-available"
            onClick={() => registry.toggleOnlyAvailable()}
          >
            <span>Free seats</span>
            <span className="lc-switch__track">
              <span className="lc-switch__knob" />
            </span>
          </button>
          <button
            type="button"
            className={filters.onlyFavourites ? "lc-switch lc-switch--on" : "lc-switch"}
            aria-pressed={filters.onlyFavourites}
            data-testid="toggle-favourites"
            onClick={() => registry.toggleOnlyFavourites()}
          >
            <span>Favourites ({store.favouriteIds.value.length})</span>
            <span className="lc-switch__track">
              <span className="lc-switch__knob" />
            </span>
          </button>
        </div>

        <button
          type="button"
          className="lc-button lc-button--ghost lc-button--wide"
          data-testid="reset-filters"
          disabled={!store.hasActiveFilters.value}
          onClick={() => registry.resetFilters()}
        >
          Reset filters
        </button>
      </div>
    </aside>
  );
}

export { FiltersPanel };
