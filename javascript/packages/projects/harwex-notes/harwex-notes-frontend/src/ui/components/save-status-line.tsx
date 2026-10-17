import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TAppSaveState } from "../../store/derived-state";

type TStatus = TAppSaveState | "offline";

// One line for the app as a whole (DOC-6). Lost contact with the vault outranks the save
// state, because no save can land until it is back (SYNC-7).
const STATUS_LABEL: Readonly<Record<TStatus, string>> = {
  saved: "All changes saved",
  saving: "Saving…",
  failed: "Save failed",
  offline: "Offline",
};

const SaveStatusLine: FC = () => {
  useSignals();

  const store = useStore();
  const status: TStatus = store.sync.status.value === "offline" ? "offline" : store.derived.appSaveState.value;

  return (
    <p aria-live="polite" className={`save-status save-status--${status}`} role="status">
      {STATUS_LABEL[status]}
    </p>
  );
};

export { SaveStatusLine };
