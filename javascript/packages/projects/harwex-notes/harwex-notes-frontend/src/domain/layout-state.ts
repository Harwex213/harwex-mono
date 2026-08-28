import { MAX_SIDEBAR_WIDTH_PX, MIN_SIDEBAR_WIDTH_PX } from "../store/layout-slice";
import type { TStore } from "../store/store";
import type { TApiClient } from "../api/api";

// The divider reports the width the pointer asks for. How wide a panel may get is the
// app's rule, not the pointer's, so the action is what holds the bounds.
const resizeSidebarAction = (store: TStore, _api: TApiClient, width: number) => {
  const clamped = Math.min(
    Math.max(Math.round(width), MIN_SIDEBAR_WIDTH_PX),
    MAX_SIDEBAR_WIDTH_PX
  );

  if (clamped === store.layout.sidebarWidth.peek()) {
    return;
  }

  store.layout.sidebarWidth.value = clamped;
};

export { resizeSidebarAction };
