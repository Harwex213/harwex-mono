import type { TLogDraft } from "../game/economy";
import type { TLogEntry } from "../game/types";
import type { TStore } from "../../store/store";

/** Newest first, and only the last few turns are worth keeping on screen. */
const LOG_LIMIT = 40;

const appendLog = (store: TStore, drafts: readonly TLogDraft[]): void => {
  if (drafts.length === 0) {
    return;
  }

  let nextId = store.viewState.nextLogId.peek();
  const entries: TLogEntry[] = drafts.map((draft) => {
    const entry = { ...draft, id: nextId };
    nextId += 1;

    return entry;
  });

  store.viewState.nextLogId.value = nextId;
  store.viewState.log.value = [...entries.reverse(), ...store.viewState.log.peek()].slice(0, LOG_LIMIT);
};

export { LOG_LIMIT, appendLog };
