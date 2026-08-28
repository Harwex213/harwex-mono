import type { FC } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import { FsViewer } from "@hw/harwex-notes-components";
import type { TAppRegistry } from "@hw/harwex-notes-protocol";
import { useStore } from "../../store/store";

type TFsViewerContainerProps = {
  registry: TAppRegistry;
};

const FsViewerContainer: FC<TFsViewerContainerProps> = ({ registry }) => {
  useSignals();

  const store = useStore();

  return (
    <FsViewer
      activeId={store.tabs.activeId.value}
      draft={store.fs.draft.value}
      error={store.fs.error.value}
      expandedIds={store.fs.expandedIds.value}
      isBusy={store.fs.isBusy.value}
      isLoading={store.fs.isLoading.value}
      nodes={store.fs.nodes.value}
      registry={registry}
      selectedId={store.fs.selectedId.value}
    />
  );
};

export { FsViewerContainer };
