import { useSignals } from "@preact/signals-react/runtime";
import { useEffect } from "react";
import type { FC } from "react";
import type { TDismissDeletedAction, TRestoreDeletedAction } from "../../domain/registry";
import { useStore } from "../../store/store";

const TOAST_MS = 5000;

type TUndoToastRegistrySlice = {
  restoreDeletedAction: TRestoreDeletedAction;
  dismissDeletedAction: TDismissDeletedAction;
};

type TUndoToastProps = {
  registry: TUndoToastRegistrySlice;
};

const UndoToast: FC<TUndoToastProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const deleted = store.lastDeleted.value;

  useEffect(() => {
    if (!deleted) {
      return;
    }

    const timer = window.setTimeout(registry.dismissDeletedAction, TOAST_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [deleted, registry]);

  return (
    <div className="undo-toast" data-open={deleted ? "true" : "false"} role="status">
      <span>{"Мысль удалена"}</span>
      <button type="button" className="undo-button" onClick={registry.restoreDeletedAction}>
        {"Вернуть"}
      </button>
    </div>
  );
};

export { UndoToast };
