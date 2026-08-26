import type { TApi } from "../api/types";
import type { TStore } from "../store/store";

const loadTreeAction = async (store: TStore, api: TApi) => {
  store.fs.isLoading.value = true;
  store.fs.error.value = null;

  try {
    const nodes = await api.fetchTree();

    store.fs.nodes.value = nodes;
    store.fs.expandedIds.value = nodes
      .filter((node) => node.kind === "folder" && node.parentId === null)
      .map((node) => node.id);
  } catch (error) {
    store.fs.error.value = error instanceof Error ? error.message : "Unknown error";
  } finally {
    store.fs.isLoading.value = false;
  }
};

const toggleFolderAction = (store: TStore, _api: TApi, nodeId: string) => {
  const expandedIds = store.fs.expandedIds.peek();
  if (expandedIds.includes(nodeId)) {
    store.fs.expandedIds.value = expandedIds.filter((id) => id !== nodeId);

    return;
  }

  store.fs.expandedIds.value = [...expandedIds, nodeId];
};

export { loadTreeAction, toggleFolderAction };
