import { useSignals } from "@preact/signals-react/runtime";
import { ConflictModal } from "@hw/harwex-notes-components";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TConflictModalRegistrySlice } from "@hw/harwex-notes-components";

type TConflictModalContainerProps = {
  registry: TConflictModalRegistrySlice;
};

// One conflict at a time, with a count of the others that wait (CONF-2, CONF-5).
const ConflictModalContainer: FC<TConflictModalContainerProps> = ({ registry }) => {
  useSignals();

  const store = useStore();

  return (
    <ConflictModal
      conflict={store.derived.activeConflict.value}
      registry={registry}
      waitingCount={store.derived.waitingConflictCount.value}
    />
  );
};

export { ConflictModalContainer };
