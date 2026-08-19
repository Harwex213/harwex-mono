import type { CSSProperties } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import { CATEGORY_LABELS, effectiveStatus, formatMoney } from "../model/lobby";
import type { LiveTable } from "../model/types";
import { HistoryStrip } from "./HistoryStrip";
import { SeatMeter } from "./SeatMeter";
import { StatusPill } from "./StatusPill";
import { useRegistry, useStore } from "./context";

type TableCardProps = {
  readonly table: LiveTable;
};

function TableCard({ table }: TableCardProps) {
  useSignals();
  const store = useStore();
  const registry = useRegistry();
  const provider = store.providerById.value.get(table.providerId);
  const isFavourite = store.favouriteIds.value.includes(table.id);
  const isSelected = store.selectedTableId.value === table.id;
  const status = effectiveStatus(table);

  const classNames = ["lc-card"];
  if (isSelected) {
    classNames.push("lc-card--selected");
  }
  if (status === "offline") {
    classNames.push("lc-card--offline");
  }

  return (
    <div
      className={classNames.join(" ")}
      data-testid={`card-${table.id}`}
      data-selected={isSelected}
    >
      <div className={`lc-card__stage lc-card__stage--${table.category}`}>
        <div className="lc-card__stage-top">
          {status === "offline" ? null : (
            <span className="lc-live">
              <span className="lc-live__dot" />
              LIVE
            </span>
          )}
          {table.hd ? <span className="lc-hd">HD</span> : null}
          <button
            type="button"
            className={isFavourite ? "lc-favourite lc-favourite--on" : "lc-favourite"}
            aria-label={isFavourite ? `Remove ${table.name} from favourites` : `Add ${table.name} to favourites`}
            aria-pressed={isFavourite}
            data-testid={`favourite-${table.id}`}
            onClick={() => registry.toggleFavourite(table.id)}
          >
            {isFavourite ? "★" : "☆"}
          </button>
        </div>
        <span className="lc-card__dealer">Dealer {table.dealer}</span>
      </div>
      <button
        type="button"
        className="lc-card__body"
        data-testid={`open-${table.id}`}
        onClick={() => registry.selectTable(table.id)}
      >
        <span className="lc-card__name">{table.name}</span>
        <span className="lc-card__meta">
          <span className="lc-provider" style={{ "--provider-accent": provider?.accent } as CSSProperties}>
            <span className="lc-provider__dot" />
            {provider?.name ?? table.providerId}
          </span>
          <span>{CATEGORY_LABELS[table.category]}</span>
          <StatusPill status={status} />
        </span>
        <span className="lc-card__limits">
          <span>
            Min <strong>{formatMoney(table.minBet)}</strong>
          </span>
          <span>
            Max <strong>{formatMoney(table.maxBet)}</strong>
          </span>
        </span>
        <SeatMeter seats={table.seats} seatsTaken={table.seatsTaken} watching={table.watching} />
        {table.history.length > 0 ? <HistoryStrip history={table.history} /> : null}
      </button>
    </div>
  );
}

export { TableCard };
