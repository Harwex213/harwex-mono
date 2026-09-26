import type { TStore } from "../store/store";
import type { TPointerAnchor } from "../store/ui-state";

/** How long a refusal stays over the canvas before it fades out. */
const NOTICE_LIFETIME_MS = 2200;

/**
 * One timer for the whole app: a second refusal replaces the first instead of
 * queueing behind it.
 */
let noticeTimeoutId: ReturnType<typeof setTimeout> | null = null;

/** Says out loud why a click did nothing. Not an error: a game rule. */
const showNotice = (store: TStore, text: string) => {
  store.ui.notice.value = text;

  if (noticeTimeoutId !== null) {
    clearTimeout(noticeTimeoutId);
  }

  noticeTimeoutId = setTimeout(() => {
    store.ui.notice.value = null;
    noticeTimeoutId = null;
  }, NOTICE_LIFETIME_MS);
};

const hoverHexAction = (store: TStore, hexId: string | null, anchor: TPointerAnchor | null) => {
  store.ui.hoveredHexId.value = hexId;
  store.ui.hoverAnchor.value = anchor;
};

const selectHexAction = (store: TStore, hexId: string) => {
  store.ui.selectedHexId.value = hexId;
};

const closeHexModalAction = (store: TStore) => {
  store.ui.selectedHexId.value = null;
};

const openTechModalAction = (store: TStore) => {
  store.ui.techModalOpen.value = true;
};

const closeTechModalAction = (store: TStore) => {
  store.ui.techModalOpen.value = false;
};

export {
  closeHexModalAction,
  closeTechModalAction,
  hoverHexAction,
  openTechModalAction,
  selectHexAction,
  showNotice,
};
