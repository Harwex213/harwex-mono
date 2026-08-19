import { useSignals } from "@preact/signals-react/runtime";
import { CATEGORY_LABELS, effectiveStatus, formatMoney, seatsFree } from "../model/lobby";
import { HistoryStrip } from "./HistoryStrip";
import { StatusPill } from "./StatusPill";
import { useRegistry, useStore } from "./context";

function DetailsPanel() {
  useSignals();
  const store = useStore();
  const registry = useRegistry();
  const table = store.selectedTable.value;
  const recent = store.recentlyPlayed.value;

  if (!table) {
    return (
      <aside className="lc-panel" data-testid="details-placeholder">
        <div className="lc-placeholder">
          <span className="lc-placeholder__mark">♠ ♥ ♦ ♣</span>
          <span>Pick a table to see its limits, dealer and last results.</span>
        </div>
      </aside>
    );
  }

  const provider = store.providerById.value.get(table.providerId);
  const status = effectiveStatus(table);
  const isJoined = store.joinedTableId.value === table.id;
  const isFavourite = store.favouriteIds.value.includes(table.id);

  return (
    <aside className="lc-panel" data-testid="details">
      <div className="lc-details__head">
        <div className="lc-details__eyebrow">
          <StatusPill status={status} />
          <span className="lc-details__dealer">{provider?.name ?? table.providerId}</span>
          <button
            type="button"
            className="lc-details__close"
            aria-label="Close table details"
            data-testid="close-details"
            onClick={() => registry.closeTable()}
          >
            ✕
          </button>
        </div>
        <h2 className="lc-details__name" data-testid="details-name">
          {table.name}
        </h2>
        <span className="lc-details__dealer">
          {CATEGORY_LABELS[table.category]} · dealer {table.dealer}
        </span>
      </div>

      <div className="lc-panel__scroll">
        <div className="lc-facts">
          <div className="lc-fact">
            <div className="lc-fact__label">Min bet</div>
            <div className="lc-fact__value">{formatMoney(table.minBet)}</div>
          </div>
          <div className="lc-fact">
            <div className="lc-fact__label">Max bet</div>
            <div className="lc-fact__value">{formatMoney(table.maxBet)}</div>
          </div>
          <div className="lc-fact">
            <div className="lc-fact__label">Free seats</div>
            <div className="lc-fact__value" data-testid="details-free-seats">
              {seatsFree(table)} / {table.seats}
            </div>
          </div>
          <div className="lc-fact">
            <div className="lc-fact__label">Watching</div>
            <div className="lc-fact__value">{table.watching}</div>
          </div>
        </div>

        <div className="lc-details__section">
          <h3 className="lc-filters__title">Languages</h3>
          <div className="lc-langs">
            {table.languages.map((language) => (
              <span key={language} className="lc-lang">
                {language}
              </span>
            ))}
          </div>
        </div>

        {table.history.length > 0 ? (
          <div className="lc-details__section">
            <h3 className="lc-filters__title">Last results</h3>
            <HistoryStrip history={table.history} limit={7} />
          </div>
        ) : null}

        {recent.length > 0 ? (
          <div className="lc-details__section">
            <h3 className="lc-filters__title">Recently played</h3>
            <ul className="lc-recent" data-testid="recently-played">
              {recent.map((played) => (
                <li key={played.id} className="lc-recent__item">
                  <span>{played.name}</span>
                  <span>{formatMoney(played.minBet)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="lc-details__actions">
        {isJoined ? (
          <button
            type="button"
            className="lc-button lc-button--wide"
            data-testid="leave"
            onClick={() => registry.leaveTable()}
          >
            Leave table
          </button>
        ) : (
          <button
            type="button"
            className="lc-button lc-button--primary lc-button--wide"
            data-testid="join"
            onClick={() => registry.joinTable(table.id)}
          >
            Take a seat · {formatMoney(table.minBet)}
          </button>
        )}
        <button
          type="button"
          className="lc-button lc-button--ghost lc-button--wide"
          data-testid="details-favourite"
          onClick={() => registry.toggleFavourite(table.id)}
        >
          {isFavourite ? "★ In favourites" : "☆ Add to favourites"}
        </button>
      </div>
    </aside>
  );
}

export { DetailsPanel };
