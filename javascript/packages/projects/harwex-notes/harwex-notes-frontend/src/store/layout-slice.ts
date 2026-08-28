import { signal } from "@preact/signals-react";

// The vault panel keeps the width the reader drags it to, see TREE-7 in the specification.
// The default mirrors `--size-sidebar` in `app.css`: the shell is laid out at that width
// until the first drag replaces it.
const DEFAULT_SIDEBAR_WIDTH_PX = 260;
// The narrow end still shows a nested file name. The wide end still leaves the viewer the
// larger half of a 1024px window.
const MIN_SIDEBAR_WIDTH_PX = 180;
const MAX_SIDEBAR_WIDTH_PX = 560;

const createLayoutState = () => ({
  sidebarWidth: signal(DEFAULT_SIDEBAR_WIDTH_PX),
});

type TLayoutSlice = ReturnType<typeof createLayoutState>;

export type { TLayoutSlice };
export {
  DEFAULT_SIDEBAR_WIDTH_PX,
  MAX_SIDEBAR_WIDTH_PX,
  MIN_SIDEBAR_WIDTH_PX,
  createLayoutState,
};
