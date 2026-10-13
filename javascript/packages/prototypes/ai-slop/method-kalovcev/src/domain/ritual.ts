import type { TStore } from "../store/store";
import type { TPillarId } from "./pillars";

const togglePillarAction = (store: TStore, id: TPillarId) => {
  const done = store.ritual.done.peek();
  store.ritual.done.value = { ...done, [id]: !done[id] };
};

const resetDayAction = (store: TStore) => {
  store.ritual.done.value = {};
};

export { resetDayAction, togglePillarAction };
