import type { TStore } from "../store/store";

const clickButtonAction = (store: TStore) => {
  store.buttonState.count.value = store.buttonState.count.peek() + 1;
};

export { clickButtonAction };
