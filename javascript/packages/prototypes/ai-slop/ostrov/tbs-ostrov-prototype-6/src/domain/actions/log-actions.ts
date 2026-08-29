import { createLogEntry } from "../../store/store";
import type { TStore } from "../../store/store";

/** Newest first, and short: the panel is a sidebar, not a history. */
const LOG_LIMIT = 60;

const pushLog = (store: TStore, text: string): void => {
  const entry = createLogEntry(store.metaState.round.peek(), text);
  store.metaState.log.value = [entry, ...store.metaState.log.peek()].slice(0, LOG_LIMIT);
};

export { pushLog };
