import type { TStore } from "../store/store";
import { api } from "./api";

const selectMap = (store: TStore, mapId: string | null) => {
  store.pick.selectedMap.value = mapId;
  store.pick.actionError.value = null;
};

const confirmMap = async (store: TStore) => {
  const session = store.session.peek();
  const mapId = store.pick.selectedMap.peek();
  if (!session || !mapId) {
    return;
  }

  store.pick.busy.value = true;
  try {
    store.pick.view.value = await api.act(session.id, session.token, mapId);
    store.pick.selectedMap.value = null;
    store.pick.actionError.value = null;
  } catch (error) {
    store.pick.actionError.value = (error as Error).message;
  } finally {
    store.pick.busy.value = false;
  }
};

export { selectMap, confirmMap };
