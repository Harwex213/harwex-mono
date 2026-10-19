import type { TStore } from "../store/index";

function toggleLabels(store: TStore): void {
  store.labels.showLabels.value = !store.labels.showLabels.peek();
}

export { toggleLabels };
