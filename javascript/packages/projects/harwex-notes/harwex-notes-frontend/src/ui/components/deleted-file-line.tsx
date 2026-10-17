import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TRestoreDocumentAction } from "@hw/harwex-notes-protocol";

type TDeletedFileLineRegistrySlice = {
  restoreDocumentAction: TRestoreDocumentAction;
};

type TDeletedFileLineProps = {
  registry: TDeletedFileLineRegistrySlice;
};

// The active file was deleted on disk while it had unsaved changes. Its tab stays, saving
// is stopped, and one action writes the content back (SYNC-5). Shown next to the tab bar
// (FEED-4).
const DeletedFileLine: FC<TDeletedFileLineProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const activeId = store.tabs.activeId.value;
  const entry = store.derived.activeEntry.value;

  if (activeId === null || entry === null || entry.status !== "ready" || entry.save.state !== "deleted") {
    return null;
  }

  const message = entry.save.message;

  return (
    <p className="deleted-file" role="alert">
      <span className="deleted-file__text">
        {message === null ? `${entry.save.name} was deleted on disk` : `Cannot write it back: ${message}`}
      </span>

      <button
        className="deleted-file__restore"
        onClick={() => registry.restoreDocumentAction(activeId)}
        type="button"
      >
        {"Write it back"}
      </button>
    </p>
  );
};

export { DeletedFileLine };
