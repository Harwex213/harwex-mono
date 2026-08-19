import { STATUS_LABELS } from "../model/lobby";
import type { TableStatus } from "../model/types";

// Reads no signal, so it needs no `useSignals()`: the status arrives as a prop.

type StatusPillProps = {
  readonly status: TableStatus;
};

function StatusPill({ status }: StatusPillProps) {
  return <span className={`lc-status lc-status--${status}`}>{STATUS_LABELS[status]}</span>;
}

export { StatusPill };
