import { useSignals } from "@preact/signals-react/runtime";
import type { NoticeKind } from "../model/types";
import { useRegistry, useStore } from "./context";

const MARKS: Record<NoticeKind, string> = {
  "success": "✓",
  "error": "!",
  "info": "i",
};

function NoticeBar() {
  useSignals();
  const store = useStore();
  const registry = useRegistry();
  const notice = store.notice.value;

  if (!notice) {
    return null;
  }

  return (
    <div className={`lc-notice lc-notice--${notice.kind}`} role="status" data-testid="notice">
      <span className="lc-notice__mark">{MARKS[notice.kind]}</span>
      <span data-testid="notice-text">{notice.text}</span>
      <button
        type="button"
        className="lc-notice__dismiss"
        aria-label="Dismiss notice"
        data-testid="notice-dismiss"
        onClick={() => registry.dismissNotice()}
      >
        ✕
      </button>
    </div>
  );
}

export { NoticeBar };
