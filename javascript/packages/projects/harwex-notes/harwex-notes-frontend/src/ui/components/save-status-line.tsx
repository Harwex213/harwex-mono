import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TAppSaveState } from "../../store/derived-state";

// One line for the app as a whole (DOC-6). "Offline" arrives with vault sync.
const STATUS_LABEL: Readonly<Record<TAppSaveState, string>> = {
  saved: "All changes saved",
  saving: "Saving…",
  failed: "Save failed",
};

const SaveStatusLine: FC = () => {
  useSignals();

  const store = useStore();
  const appSaveState = store.derived.appSaveState.value;

  return (
    <p aria-live="polite" className={`save-status save-status--${appSaveState}`} role="status">
      {STATUS_LABEL[appSaveState]}
    </p>
  );
};

export { SaveStatusLine };
