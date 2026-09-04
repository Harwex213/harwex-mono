import { useSignals } from "@preact/signals-react/runtime";
import type { Recent } from "../../shared/types.js";
import { forgetRecent, openRecent, recents } from "../state/graph-state.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long ago, in the roughest terms that are still true. */
function since(at: number): string {
  const gap = Date.now() - at;
  if (gap < MINUTE) {
    return "just now";
  }
  if (gap < HOUR) {
    const minutes = Math.round(gap / MINUTE);
    return `${minutes} min ago`;
  }
  if (gap < DAY) {
    const hours = Math.round(gap / HOUR);
    return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  }
  const days = Math.round(gap / DAY);
  if (days === 1) {
    return "yesterday";
  }
  if (days < 30) {
    return `${days} days ago`;
  }
  return new Date(at).toLocaleDateString();
}

function summary(entry: Recent): string {
  if (entry.missing) {
    return "not on disk";
  }
  const nodes = entry.nodeCount === 1 ? "1 node" : `${entry.nodeCount} nodes`;
  return entry.isOpen ? `${nodes} · open` : `${nodes} · ${since(entry.lastOpenedAt)}`;
}

interface RecentsListProps {
  /** Called after a row is opened, so a menu holding the list can close itself. */
  onPick?: () => void;
  empty: string;
}

function RecentsList({ onPick, empty }: RecentsListProps): React.JSX.Element {
  useSignals();
  const entries = recents.value;

  if (entries.length === 0) {
    return <p className="recents__empty">{empty}</p>;
  }

  return (
    <ul className="recents">
      {entries.map((entry) => {
        return (
          <li key={entry.dir} className={entry.missing ? "recent recent--missing" : "recent"}>
            <button
              type="button"
              className="recent__open"
              title={entry.dir}
              onClick={() => {
                void openRecent(entry.dir);
                onPick?.();
              }}
            >
              <span className="recent__name">{entry.name}</span>
              <span className="recent__dir">{entry.dir}</span>
              <span className="recent__meta">{summary(entry)}</span>
            </button>
            <button
              type="button"
              className="recent__forget"
              title="Forget this directory. Its files are left alone."
              onClick={(event) => {
                event.stopPropagation();
                void forgetRecent(entry.dir);
              }}
            >
              ×
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export { RecentsList };
