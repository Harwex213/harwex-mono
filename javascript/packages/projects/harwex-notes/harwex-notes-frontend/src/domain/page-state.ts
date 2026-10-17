import { flushDocumentsAction } from "./documents-state";
import { flushPendingViewports } from "./excalidraw-state";
import { flushTreeState } from "./session-state";
import type { TStore } from "../store/store";
import type { TApiClient } from "../api/api";

// Leaving the browser tab saves at once (DOC-3). When the page is closing, this is also
// the last attempt to write what is still pending (APP-6). View state goes too: the
// expanded folders, the selected row and the viewport of each drawing.
const pageHiddenAction = (store: TStore, api: TApiClient) => {
  flushDocumentsAction(store, api);
  flushTreeState(store);
  flushPendingViewports(store, api);
};

export { pageHiddenAction };
