import { useSignals } from "@preact/signals-react/runtime";
import { formatMoney } from "../model/lobby";
import { useRegistry, useStore } from "./context";

const TOP_UP_AMOUNT = 100;

function TopBar() {
  useSignals();
  const store = useStore();
  const registry = useRegistry();
  const stats = store.stats.value;
  const joined = store.joinedTable.value;

  return (
    <header className="lc-topbar">
      <div className="lc-brand">
        <span className="lc-brand__mark">LIVELOBBY</span>
        <span className="lc-brand__tag">live casino aggregator</span>
      </div>
      <div className="lc-topbar__stats">
        <div className="lc-stat">
          <div className="lc-stat__label">Tables</div>
          <div className="lc-stat__value" data-testid="stat-total">
            {stats.total}
          </div>
        </div>
        <div className="lc-stat">
          <div className="lc-stat__label">Open now</div>
          <div className="lc-stat__value" data-testid="stat-available">
            {stats.available}
          </div>
        </div>
        <div className="lc-stat">
          <div className="lc-stat__label">Free seats</div>
          <div className="lc-stat__value">{stats.seatsFree}</div>
        </div>
        <div className="lc-stat">
          <div className="lc-stat__label">Avg min bet</div>
          <div className="lc-stat__value">{formatMoney(stats.averageMinBet)}</div>
        </div>
      </div>
      <div className="lc-topbar__right">
        {joined ? (
          <span className="lc-seated" data-testid="seated-badge">
            Seated at {joined.name}
          </span>
        ) : null}
        <div className="lc-balance">
          <div className="lc-balance__label">Balance</div>
          <div className="lc-balance__value" data-testid="balance">
            {formatMoney(store.balance.value)}
          </div>
        </div>
        <button
          type="button"
          className="lc-button"
          data-testid="top-up"
          onClick={() => registry.topUpBalance(TOP_UP_AMOUNT)}
        >
          Top up {formatMoney(TOP_UP_AMOUNT)}
        </button>
      </div>
    </header>
  );
}

export { TopBar };
